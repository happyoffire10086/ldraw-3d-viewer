// LDraw MPD → HCP 说明书数据 (m{N}.json) 转换器
// 用法:
//   node ldraw-to-hcp.js <input.mpd|.ldr>            # 打印 m{N}.json 结构
//   node ldraw-to-hcp.js <input> --out <file>        # 写盘(需宽权限)
//   node ldraw-to-hcp.js --validate                  # 用参考站自带 m1.text.txt 校验输出 == m1.json
'use strict';
const fs = require('fs');
const zlib = require('zlib');

// ---------- LDraw 解析 ----------
function parseMpd(text) {
  const lines = text.split(/\r?\n/);
  const files = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^0\s+FILE\s+(.+?)\s*$/);
    if (m) {
      current = { name: m[1].trim(), lines: [] };
      files.push(current);
      continue;
    }
    if (current === null) {
      current = { name: '__main__', lines: [] };
      files.push(current);
    }
    current.lines.push(line);
  }
  if (files.length === 0) files.push({ name: '__main__', lines });
  return files;
}

// 解析 "1 <color> <12矩阵数> <file>" 行
function parseLine1(line) {
  const t = line.trim();
  const parts = t.split(/\s+/);
  if (parts[0] !== '1' || parts.length < 15) return null;
  const color = parseInt(parts[1], 10);
  if (isNaN(color)) return null;
  const matrix = parts.slice(2, 14).join(' ');
  const file = parts.slice(14).join(' ');
  return { color, matrix, file };
}

// 归一化大小写：把 0 FILE 名与 1 行引用的文件名转小写
// （本机 parts 库全小写，生产 Linux 大小写敏感；参考站 LDRLoader 用原始大小写 fetch，会 404）
function normalizeCase(text) {
  return text.split(/\r?\n/).map(line => {
    const t = line.trim();
    const fm = t.match(/^0\s+FILE\s+(.+?)\s*$/);
    if (fm) return '0 FILE ' + fm[1].toLowerCase();
    const p = parseLine1(t);
    if (p) return `1 ${p.color} ${p.matrix} ${p.file.toLowerCase()}`;
    return line;
  }).join('\n');
}

// ---------- LDraw 矩阵（12 个数：x y z a b c d e f g h i） ----------
// 标准矩阵（列向量约定）:
//   [ a b c x ]
//   [ d e f y ]
//   [ g h i z ]
//   [ 0 0 0 1 ]
function parseMatrix(str) {
  const n = str.trim().split(/\s+/).map(Number);
  if (n.length < 12 || n.some(isNaN)) return null;
  return { x: n[0], y: n[1], z: n[2], a: n[3], b: n[4], c: n[5], d: n[6], e: n[7], f: n[8], g: n[9], h: n[10], i: n[11] };
}
function identityMatrix() {
  return { x: 0, y: 0, z: 0, a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, g: 0, h: 0, i: 1 };
}
// W = P * C（先应用 C，再应用 P）
function multiplyMatrix(P, C) {
  return {
    a: P.a * C.a + P.b * C.d + P.c * C.g,
    b: P.a * C.b + P.b * C.e + P.c * C.h,
    c: P.a * C.c + P.b * C.f + P.c * C.i,
    d: P.d * C.a + P.e * C.d + P.f * C.g,
    e: P.d * C.b + P.e * C.e + P.f * C.h,
    f: P.d * C.c + P.e * C.f + P.f * C.i,
    g: P.g * C.a + P.h * C.d + P.i * C.g,
    h: P.g * C.b + P.h * C.e + P.i * C.h,
    i: P.g * C.c + P.h * C.f + P.i * C.i,
    x: P.a * C.x + P.b * C.y + P.c * C.z + P.x,
    y: P.d * C.x + P.e * C.y + P.f * C.z + P.y,
    z: P.g * C.x + P.h * C.y + P.i * C.z + P.z,
  };
}
function matrixToStr(M) {
  return `${M.x} ${M.y} ${M.z} ${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f} ${M.g} ${M.h} ${M.i}`;
}

// ---------- 展平层级模型 → 叶子零件（世界矩阵 + 全局步） ----------
// 返回 [{ color, matrix, file, step }]，其中 step 为深度优先全局步序号
function flattenLeaves(text) {
  const files = parseMpd(text);
  const fileMap = new Map(files.map(f => [f.name.toLowerCase(), f]));
  const main = files[0];

  // 递归展开子模型，返回叶子列表（局部矩阵 + 相对步偏移）
  // memo key = fileName|inheritedColor（结果只依赖这两者）
  const memo = new Map();
  function expandSub(fileName, inheritedColor) {
    const key = fileName.toLowerCase() + '|' + inheritedColor;
    if (memo.has(key)) return memo.get(key);
    const sub = fileMap.get(fileName.toLowerCase());
    const result = [];
    if (sub) {
      let stepOffset = 0;
      for (const line of sub.lines) {
        const t = line.trim();
        if (/^0\s+STEP/.test(t)) { stepOffset++; continue; }
        const p = parseLine1(t);
        if (!p) continue;
        const m = parseMatrix(p.matrix);
        if (!m) continue;
        const curColor = p.color === 16 ? inheritedColor : p.color;
        const childKey = p.file.toLowerCase();
        if (fileMap.has(childKey)) {
          for (const cl of expandSub(childKey, curColor)) {
            result.push({ color: cl.color, matrix: multiplyMatrix(m, cl.matrix), file: cl.file, step: stepOffset + cl.step });
          }
        } else {
          result.push({ color: curColor === 16 ? 0 : curColor, matrix: m, file: p.file, step: stepOffset });
        }
      }
    }
    memo.set(key, result);
    return result;
  }

  const leaves = [];
  let step = 0;
  for (const line of main.lines) {
    const t = line.trim();
    if (/^0\s+STEP/.test(t)) { step++; continue; }
    if (/^0\s+(FILE|!?MPD)/.test(t)) continue;
    const p = parseLine1(t);
    if (!p) continue;
    const m = parseMatrix(p.matrix);
    if (!m) continue;
    const curColor = p.color === 16 ? 16 : p.color;
    const childKey = p.file.toLowerCase();
    if (fileMap.has(childKey)) {
      for (const cl of expandSub(childKey, curColor)) {
        leaves.push({ color: cl.color, matrix: multiplyMatrix(m, cl.matrix), file: cl.file, step: step + cl.step });
      }
    } else {
      leaves.push({ color: curColor === 16 ? 0 : curColor, matrix: m, file: p.file, step });
    }
  }
  return leaves;
}

// ---------- 展平 → 扁平 MPD 文本 + mN.json（匹配参考站结构） ----------
// 结构：主文件 = 每步一个虚拟子模型引用；虚拟子模型 = 该步叶子零件（世界矩阵）
function flatten(text) {
  const files = parseMpd(text);
  const mainName = files[0].name.toLowerCase();
  const leaves = flattenLeaves(text);
  const maxStep = leaves.reduce((mx, l) => Math.max(mx, l.step), 0);
  const byStep = new Map();
  for (const leaf of leaves) {
    if (!byStep.has(leaf.step)) byStep.set(leaf.step, []);
    byStep.get(leaf.step).push(leaf);
  }

  // 扁平 MPD 文本
  const identity = '0 0 0 1 0 0 0 1 0 0 0 1';
  let out = `0 FILE ${mainName}\n`;
  for (let s = 0; s <= maxStep; s++) {
    if (s > 0) out += '0 STEP\n';
    out += `1 16 ${identity} _step${s}.ldr\n`;
  }
  for (let s = 0; s <= maxStep; s++) {
    out += `0 FILE _step${s}.ldr\n`;
    for (const leaf of (byStep.get(s) || [])) {
      out += `1 ${leaf.color} ${matrixToStr(leaf.matrix)} ${leaf.file}\n`;
    }
  }

  const stepCount = maxStep + 1;
  // parts = 虚拟子模型引用（每步一个）
  const parts = [];
  for (let s = 0; s < stepCount; s++) {
    parts.push({
      color: 0,
      name: `_step${s}.ldr`,
      stepIndex: s,
      moduleIndex: 0,
      paragraphIndex: 0,
      partLine: `1 x ${identity} _step${s}.ldr`,
    });
  }

  // expandedParts = 叶子零件（按步分组顺序展平）
  const expandedParts = [];
  const expandedSteps = [];
  for (let s = 0; s < stepCount; s++) {
    const stepLeaves = byStep.get(s) || [];
    const idx = [];
    for (const leaf of stepLeaves) {
      idx.push(expandedParts.length);
      expandedParts.push({
        color: leaf.color,
        name: leaf.file,
        stepIndex: s,
        moduleIndex: 0,
        paragraphIndex: 0,
        partLine: `1 x ${identity} _step${s}.ldr`,
      });
    }
    expandedSteps.push(idx);
  }

  // boundaries = parts 累计（每步 1 个虚拟子模型）
  const boundaries = [];
  for (let s = 0; s <= stepCount; s++) boundaries.push(s);

  const stepInfos = [];
  for (let s = 0; s < stepCount; s++) {
    stepInfos.push({
      stepIndex: s,
      start: s,
      end: s + 1,
      moduleIndex: 0,
      paragraphIndex: 0,
      isEmpty: (byStep.get(s) || []).length === 0,
      angle: null,
    });
  }

  const uniqueParts = [...new Set(leaves.map(l => l.file))].sort();

  const json = {
    parts,
    expandedParts,
    expandedSteps,
    boundaries,
    stepInfos,
    paragraphs: [{ startStep: 0, endStep: stepCount, moduleIndex: 0, paragraphIndex: 0, isRemovePrevious: false }],
    modules: [{ startStep: 0, endStep: stepCount, moduleIndex: 0 }],
    subModels: Array.from({ length: stepCount }, (_, s) => `_step${s}.ldr`),
    uniqueParts,
    angles: {},
  };

  return { text: out, json, leaves };
}

// ---------- 转换 ----------
function convert(text, options = {}) {
  const files = parseMpd(text);
  // 子模型查找不区分大小写（LDraw 文件名在多数平台大小写不敏感；本模型含 "PLATFORM.LDR" vs "platform.ldr" 混用）
  const fileMap = new Map(files.map(f => [f.name.toLowerCase(), f]));
  const main = files[0];
  const subModels = files.slice(1).map(f => f.name);

  // 主文件 → parts（顶层引用，按 0 STEP 分步）
  const parts = [];
  let stepIndex = 0;
  for (const line of main.lines) {
    const t = line.trim();
    if (/^0\s+STEP/.test(t)) { stepIndex++; continue; }
    if (/^0\s+(FILE|!?MPD)/.test(t)) continue;
    const p = parseLine1(t);
    if (!p) continue;
    parts.push({
      color: p.color === 16 ? 0 : p.color,
      name: p.file,
      stepIndex,
      moduleIndex: 0,
      paragraphIndex: 0,
      partLine: `1 x ${p.matrix} ${p.file}`,
    });
  }
  const stepCount = stepIndex + 1;

  // 递归展开子模型 → expandedParts（叶子 .dat 零件 + 解析颜色）
  const expandedParts = [];
  function expand(fileName, refColor, parentColor, stepIdx, partLine) {
    const sub = fileMap.get(fileName.toLowerCase());
    if (!sub) {
      // 叶子零件（.dat 不在 MPD 里）
      const resolved = refColor === 16 ? (parentColor === 16 ? 0 : parentColor) : refColor;
      expandedParts.push({
        color: resolved,
        name: fileName,
        stepIndex: stepIdx,
        moduleIndex: 0,
        paragraphIndex: 0,
        partLine,
      });
      return;
    }
    const curColor = refColor === 16 ? parentColor : refColor;
    for (const line of sub.lines) {
      const p = parseLine1(line);
      if (p) expand(p.file, p.color, curColor, stepIdx, partLine);
    }
  }
  for (const part of parts) {
    expand(part.name, part.color === 0 ? 16 : part.color, 16, part.stepIndex, part.partLine);
  }

  // expandedSteps = 按步分组
  const expandedSteps = [];
  for (let s = 0; s < stepCount; s++) {
    expandedSteps.push(expandedParts.filter(p => p.stepIndex === s));
  }

  // boundaries = parts 按步的累计数
  const boundaries = [0];
  let acc = 0;
  const partsByStep = new Map();
  for (const p of parts) partsByStep.set(p.stepIndex, (partsByStep.get(p.stepIndex) || 0) + 1);
  for (let s = 0; s < stepCount; s++) {
    acc += partsByStep.get(s) || 0;
    boundaries.push(acc);
  }

  // stepInfos
  const stepInfos = [];
  for (let s = 0; s < stepCount; s++) {
    stepInfos.push({
      stepIndex: s,
      start: boundaries[s],
      end: boundaries[s + 1],
      moduleIndex: 0,
      paragraphIndex: 0,
      isEmpty: boundaries[s + 1] - boundaries[s] === 0,
      angle: null,
    });
  }

  // uniqueParts = 叶子零件名（首现顺序去重）
  const uniqueParts = [];
  const seen = new Set();
  for (const p of expandedParts) {
    if (!seen.has(p.name)) { seen.add(p.name); uniqueParts.push(p.name); }
  }
  uniqueParts.sort();

  return {
    parts,
    expandedParts,
    expandedSteps,
    boundaries,
    stepInfos,
    paragraphs: [{ startStep: 0, endStep: stepCount, moduleIndex: 0, paragraphIndex: 0, isRemovePrevious: false }],
    modules: [{ startStep: 0, endStep: stepCount, moduleIndex: 0 }],
    subModels,
    uniqueParts,
    angles: {},
  };
}

// ---------- 校验：用参考站自带数据验证 ----------
function validate(refHtmlPath) {
  if (!refHtmlPath) { console.error('用法: node ldraw-to-hcp.js --validate <refsite-raw.html路径>'); return false; }
  const raw = fs.readFileSync(refHtmlPath, 'utf8');
  const blockRe = /<script[^>]*type="text\/plain"[^>]*data-sf="([^"]*)"[^>]*data-enc="([^"]*)"[^>]*>([\s\S]*?)<\/script>/g;
  const blocks = {};
  let m;
  while ((m = blockRe.exec(raw)) !== null) {
    let buf = Buffer.from(m[3].trim(), 'base64');
    if (m[2] === 'gzip') buf = zlib.gunzipSync(buf);
    blocks[m[1]] = buf.toString('utf8');
  }
  const text = blocks['data/m1.text.txt'];
  const expected = JSON.parse(blocks['data/m1.json']);
  const got = convert(text);

  let ok = true;
  function cmp(name, a, b) {
    const ja = JSON.stringify(a), jb = JSON.stringify(b);
    if (ja === jb) { console.log('OK   ' + name + '  (' + (typeof a === 'object' ? (Array.isArray(a) ? a.length + ' 项' : '对象') : a) + ')'); }
    else { ok = false; console.log('DIFF ' + name + '  实际长度=' + ja.length + ' 期望=' + jb.length); }
  }
  cmp('parts', got.parts, expected.parts);
  cmp('expandedParts', got.expandedParts, expected.expandedParts);
  cmp('expandedSteps', got.expandedSteps, expected.expandedSteps);
  cmp('boundaries', got.boundaries, expected.boundaries);
  cmp('stepInfos', got.stepInfos, expected.stepInfos);
  cmp('paragraphs', got.paragraphs, expected.paragraphs);
  cmp('modules', got.modules, expected.modules);
  cmp('subModels', got.subModels, expected.subModels);
  cmp('uniqueParts', got.uniqueParts, expected.uniqueParts);
  cmp('angles', got.angles, expected.angles);
  console.log('\n整体:', ok ? '✅ 全部匹配' : '❌ 存在差异');
  if (!ok) {
    // 打印第一个差异的详细信息
    for (const [name, a, b] of [['parts', got.parts, expected.parts], ['expandedParts', got.expandedParts, expected.expandedParts], ['expandedSteps', got.expandedSteps, expected.expandedSteps], ['boundaries', got.boundaries, expected.boundaries], ['stepInfos', got.stepInfos, expected.stepInfos], ['subModels', got.subModels, expected.subModels], ['uniqueParts', got.uniqueParts, expected.uniqueParts]]) {
      const ja = JSON.stringify(a), jb = JSON.stringify(b);
      if (ja !== jb) {
        console.log('\n--- 首个差异字段: ' + name + ' ---');
        if (Array.isArray(a) && Array.isArray(b)) {
          for (let i = 0; i < Math.max(a.length, b.length); i++) {
            if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
              console.log('索引', i, '\n  实际:', JSON.stringify(a[i]).slice(0, 400));
              console.log('  期望:', JSON.stringify(b[i]).slice(0, 400));
              break;
            }
          }
        }
        break;
      }
    }
  }
  return ok;
}

// ---------- CLI ----------
function main() {
  const args = process.argv.slice(2);
  if (args.includes('--validate')) {
    validate(args[args.indexOf('--validate') + 1]);
    return;
  }
  const input = args.find(a => !a.startsWith('--'));
  if (!input) { console.log('用法: node ldraw-to-hcp.js <input.mpd> [--validate]'); return; }
  const text = fs.readFileSync(input, 'utf8');
  const out = convert(text);
  const summary = {
    parts: out.parts.length,
    expandedParts: out.expandedParts.length,
    expandedSteps: out.expandedSteps.length,
    stepCount: out.stepInfos.length,
    subModels: out.subModels.length,
    uniqueParts: out.uniqueParts,
  };
  console.log(JSON.stringify(summary, null, 1));
  const outFlag = args.indexOf('--out');
  if (outFlag >= 0 && args[outFlag + 1]) {
    fs.writeFileSync(args[outFlag + 1], JSON.stringify(out));
    console.log('已写入', args[outFlag + 1]);
  } else {
    // 打印结构摘要（不打印全量，避免刷屏）
    console.log('\nparts[0]:', JSON.stringify(out.parts[0]));
    console.log('expandedParts[0]:', JSON.stringify(out.expandedParts[0]));
    console.log('expandedSteps 各步长度:', out.expandedSteps.map(s => s.length).join(', '));
  }
}

if (require.main === module) main();
module.exports = { parseMpd, parseLine1, convert, normalizeCase, flatten, flattenLeaves, parseMatrix, identityMatrix, multiplyMatrix, matrixToStr };
