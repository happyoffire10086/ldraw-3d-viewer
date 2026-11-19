# ldraw-3d-viewer

一个基于 Web 的 LDraw 积木模型 2D/3D 说明书查看器。加载 LDraw `.mpd`/`.ldr` 模型，按搭建步骤（`0 STEP`）逐步展示零件，支持 3D 旋转/缩放、步骤导航、零件清单、颜色切换。

核心能力：

- **单文件查看器** `viewer.html`（内联 three.js + LDrawLoader，零构建依赖）
- **步骤数据转换器** `tools/ldraw-to-hcp.js`：把 LDraw 层级模型展平成逐步 JSON
- **数据生成器** `tools/build-viewer-data.js`：批量生成查看器所需数据
- **渲染优化** `js/viewer-optimize.js`：draw-call 批量合并，把每零件一个 draw call 降到每步每色一个

## 目录结构

```
ldraw-3d-viewer/
├── viewer.html               # 查看器（生成物，也可直接使用）
├── js/
│   └── viewer-optimize.js    # draw-call 合并优化（运行时加载）
├── tools/
│   ├── ldraw-to-hcp.js       # LDraw → 步骤 JSON 转换器
│   ├── build-viewer-data.js  # 批量生成 viewer-data
│   └── extract-viewer.js     # 从参考站快照提取 viewer.html
└── sample/
    └── demo.ldr              # 最小演示模型
```

## 快速开始

1. 准备一个 LDraw 站点目录（含 `models/` 和可选的 `ldraw_custom/`），例如：

   ```
   demo-site/
   ├── models/
   │   ├── my-model.mpd
   │   └── models.config.json   # [{"name":"我的模型","file":"models/my-model.mpd"}]
   └── ldraw_custom/            # 自定义零件（可选）
   ```

2. 生成查看器数据：

   ```bash
   node tools/build-viewer-data.js --site demo-site --models demo-site/models/models.config.json
   # 产出 demo-site/viewer-data/{models.json, m0.json, m0.text.txt, ...}
   ```

3. 用静态服务器托管 `viewer.html` + `js/` + `demo-site/`，并提供查看器所需的 HTTP 接口：

   | 接口 | 返回 | 说明 |
   | --- | --- | --- |
   | `GET /api/listModels` | `models.json` | 模型清单 |
   | `GET /api/model?m=N` 或 `?file=<path>` | `m{N}.json` | 步骤数据 |
   | `GET /api/modelText?m=N` 或 `?file=<path>` | `m{N}.text.txt` | 展平后的 LDraw 文本 |
   | `GET /api/partsBundle` | `partsBundle.json` | 自定义零件 |
   | `GET /api/allPartsSummary` | `allPartsSummary.json` | 全部零件名 |
   | `GET /ldraw/LDConfig.ldr` | 颜色配置 | 见下方零件库 |
   | `GET /ldraw/**` | 零件几何 | 见下方零件库 |

   打开 `viewer.html?file=models/my-model.mpd` 或直接 `viewer.html`（显示模型大纲）。

## 零件库

查看器通过 `/ldraw/**` 加载 LDraw 零件几何。**本仓库不包含零件库**，请从官方地址下载：

- LDraw 官方零件库（LDraw Parts Library）：<https://library.ldraw.org/>
- 完整零件库下载：<https://library.ldraw.org/library/updates/complete.zip>

零件库解压后按 LDraw 标准布局托管（`parts/`、`p/`、`p/48/`），或参考你自己的后端把 `/ldraw/**` 映射到实际磁盘布局。

## 数据转换

`tools/ldraw-to-hcp.js` 把 LDraw 层级模型（`0 FILE` 子模型 + `0 STEP` 步骤）展平成查看器需要的扁平步骤数据：

- `flatten(text)` → 返回 `{ text, json, leaves }`：`text` 是展平后的扁平 MPD（每步一个虚拟子模型），`json` 是步骤数据，`leaves` 是叶子零件列表
- 展平会递归展开子模型、累计世界矩阵、按全局 `0 STEP` 分组、把 `0 ROTSTEP` 当作段落分隔符

## 渲染优化

`js/viewer-optimize.js` 在模型加载完成后按「颜色」把同一步内的零件合并成几个大网格，消除每零件一个 draw call 的性能问题：

- 实测：42321 零件的模型 draw call 从 **126963 降到 18**，旋转卡顿消除
- 合并只作用于几何（position/条件线控制点/UV），不破坏步骤导航（步骤按 group 级显隐）

## 许可证

- 本仓库自研代码（`tools/*`、`js/viewer-optimize.js`、`sample/*`）：MIT，见 [LICENSE](LICENSE)
- `viewer.html` 派生于 [buildinginstructions.js](https://github.com/HazenBabcock/buildinginstructions)（Unlicense / 公有领域）及其衍生站点的打包产物，内联 [three.js](https://github.com/mrdoob/three.js)（MIT）与 three.js 示例里的 LDrawLoader
- LDraw 零件库遵循其自身的 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可，请从官方渠道下载

## 致谢

- [buildinginstructions.js](https://github.com/HazenBabcock/buildinginstructions) — 说明书画布与步骤导航的原始实现
- [three.js](https://threejs.org/) — WebGL 渲染引擎
- [LDraw](https://www.ldraw.org/) — 零件格式标准与官方零件库
