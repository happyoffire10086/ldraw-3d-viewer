// 生成查看器数据（models.json + m{N}.json + m{N}.text.txt + partsBundle.json + allPartsSummary.json + glbs.json）
// 用法:
//   node build-viewer-data.js --site <siteDir> --models <models.json> [--out <dir>]
//     --site   : LDraw 站点目录（含 models/、ldraw_custom/ 子目录）
//     --models : 模型清单 JSON 文件（数组 [{name, file}]，file 相对 site）
//     --out    : 输出目录（默认 <site>/viewer-data）
//
// 示例:
//   node build-viewer-data.js --site ../demo-site --models ../demo-site/models.config.json
'use strict';
const fs = require('fs');
const path = require('path');
const { flatten, normalizeCase } = require('./ldraw-to-hcp.js');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const SITE = arg('--site');
const MODELS_JSON = arg('--models');
if (!SITE || !MODELS_JSON) {
  console.error('用法: node build-viewer-data.js --site <siteDir> --models <models.json> [--out <dir>]');
  process.exit(1);
}
const OUT = arg('--out') || path.join(SITE, 'viewer-data');
const MODELS = JSON.parse(fs.readFileSync(MODELS_JSON, 'utf8'));

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const modelsJson = [];
  const allUniqueParts = new Set();

  MODELS.forEach((m, idx) => {
    const src = path.join(SITE, m.file);
    const raw = fs.readFileSync(src, 'utf8');
    const flat = flatten(normalizeCase(raw));

    fs.writeFileSync(path.join(OUT, `m${idx}.json`), JSON.stringify(flat.json));
    fs.writeFileSync(path.join(OUT, `m${idx}.text.txt`), flat.text);

    for (const p of flat.json.uniqueParts) allUniqueParts.add(p);

    modelsJson.push({
      idx,
      path: m.file,
      name: m.name,
      hasAngles: false,
      hasThumb: false,
      partCount: flat.leaves.length,
      settings: {
        mode: '3d',
        partIgnore: [],
        defaultAngle: { lat: 30, lon: 45 },
        lockAngle: false,
        stepAnim: true,
        colorSwap: [],
        name: m.name,
      },
    });

    console.log(`m${idx}  ${m.name.padEnd(12)} steps=${String(flat.json.stepInfos.length).padStart(4)} leaves=${String(flat.leaves.length).padStart(6)} unique=${flat.json.uniqueParts.length}`);
  });

  fs.writeFileSync(path.join(OUT, 'models.json'), JSON.stringify(modelsJson));

  // partsBundle：自定义零件（ldraw_custom/），可选
  const bundle = { version: 'static', files: {} };
  const customDir = path.join(SITE, 'ldraw_custom');
  if (fs.existsSync(customDir)) {
    for (const f of fs.readdirSync(customDir)) {
      if (!f.toLowerCase().endsWith('.dat')) continue;
      bundle.files['parts/' + f.toLowerCase()] = fs.readFileSync(path.join(customDir, f), 'utf8');
    }
  }
  fs.writeFileSync(path.join(OUT, 'partsBundle.json'), JSON.stringify(bundle));

  fs.writeFileSync(path.join(OUT, 'allPartsSummary.json'), JSON.stringify([...allUniqueParts].sort()));
  fs.writeFileSync(path.join(OUT, 'glbs.json'), '[]');

  console.log('\n已生成到', OUT);
  console.log('models:', modelsJson.length, '| partsBundle:', Object.keys(bundle.files).length, '| uniqueParts:', allUniqueParts.size);
}

main();
