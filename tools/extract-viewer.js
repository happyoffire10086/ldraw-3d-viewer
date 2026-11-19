// 从参考站导出的 refsite-raw.html 提取中性版 viewer.html：
// - 保留 head + CSS + importmap 配置 + body UI
// - 保留 HCP_PUBLISH（中性品牌：title 通用、watermark 清空、qr 清空、keyId 清空、pack 清空）
// - 保留 HCP_I18N（多语言，原样）
// - 删除 16 个内嵌数据块（data-sf 脚本，参考站模型数据）
// - 删除 fetch 拦截器（static 包专用）
// - 保留主应用 IIFE（three.js + LDRLoader + app 全部内联）
// - 注入 viewer-optimize.js（draw-call 合并优化）
//
// 用法:
//   node extract-viewer.js [refsite-raw.html路径] [输出路径]
//   默认输入 ./refsite-raw.html，输出 ../viewer.html
//
// 说明：refsite-raw.html 是某个公开的 buildinginstructions.js 衍生站点的快照，
// 仅作为提取脚本的输入，不随本仓库提交。
'use strict';
const fs = require('fs');
const path = require('path');

const src = process.argv[2] || path.resolve(__dirname, 'refsite-raw.html');
const dst = process.argv[3] || path.resolve(__dirname, '..', 'viewer.html');

let html = fs.readFileSync(src, 'utf8');

// 1. 数据块开始标记 → head
const dataStart = html.indexOf('<script type="text/plain" data-sf="data/allPartsSummary.json"');
if (dataStart < 0) throw new Error('未找到数据块起点');
let head = html.slice(0, dataStart);

// 2. HCP_PUBLISH（单行脚本）
const pubIdx = html.indexOf('<script>window.HCP_PUBLISH=');
if (pubIdx < 0) throw new Error('未找到 HCP_PUBLISH');
const pubEnd = html.indexOf('</script>', pubIdx) + '</script>'.length;
let publish = html.slice(pubIdx, pubEnd);

// 3. HCP_I18N（单行脚本）
const i18nIdx = html.indexOf('<script>window.HCP_I18N=');
if (i18nIdx < 0) throw new Error('未找到 HCP_I18N');
const i18nEnd = html.indexOf('</script>', i18nIdx) + '</script>'.length;
const i18n = html.slice(i18nIdx, i18nEnd);

// 4. 主应用 IIFE 到文件末尾
const mainIdx = html.indexOf('<script>(()=>{var zt=');
if (mainIdx < 0) throw new Error('未找到主应用脚本');
let main = html.slice(mainIdx);

// ---- 中性品牌 ----
head = head.replace(/<title>[^<]*<\/title>/, '<title>LDraw 3D 说明书</title>');

// 水印清空（源里是 JSON 转义字面量 \u5f69\u62fc&\u5927\u767d\u83dc DIY = 彩拼&大白菜 DIY）
publish = publish.replace(/"text": "\\u5f69\\u62fc&\\u5927\\u767d\\u83dc DIY"/, '"text": ""');

// 二维码清空
publish = publish.replace(/"qr": "data:image\/png;base64,[^"]*"/, '"qr": ""');

// keyId 清空（参考站 DRM 字段）
publish = publish.replace(/"keyId":\s*"[^"]*"/, '"keyId": ""');

// pack 清空（参考站内置模型清单，改由 /api/listModels 动态提供）
const packStart = publish.indexOf('"pack": [');
if (packStart >= 0) {
  const packTail = publish.indexOf('};', packStart);
  if (packTail >= 0) {
    publish = publish.slice(0, packStart) + '"pack": []' + publish.slice(packTail);
  }
}

// ---- 注入性能优化脚本（在 main IIFE 之前）----
const optimizeScript = '<script src="js/viewer-optimize.js"></script>';

// ---- 主应用 w 回调注入优化调用（模型加载完成后合并 draw call）----
const wMarker = 'qn.add(Fe),Fe.updateMatrixWorld(!0),mf(),';
if (main.indexOf(wMarker) < 0) throw new Error('未找到 w 回调注入点（qn.add(Fe)...mf()）');
main = main.replace(wMarker, wMarker + '__jimuOptimize&&__jimuOptimize(Fe),');

// ---- 组装 ----
const out = head + '\n' + publish + '\n' + i18n + '\n' + optimizeScript + '\n' + main;
fs.writeFileSync(dst, out, 'utf8');

const kb = Math.round(out.length / 1024);
console.log('written:', dst);
console.log('size:', out.length, 'bytes (' + kb + ' KB)');
