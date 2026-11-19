# ldraw-3d-viewer

A web-based 2D/3D building-instruction viewer for LDraw `.mpd` / `.ldr` models, with step navigation, part list and color swapping.

## Contents

- `viewer.html` — single-file viewer (three.js + LDrawLoader inlined)
- `js/viewer-optimize.js` — draw-call merging (per-step, per-color)
- `tools/ldraw-to-hcp.js` — flatten hierarchical LDraw into step JSON
- `tools/build-viewer-data.js` — batch-generate `viewer-data/`
- `tools/extract-viewer.js` — extract a neutral `viewer.html` from a reference-site snapshot
- `sample/demo.ldr` — minimal demo model

## Quick start

1. Lay out an LDraw site directory (`models/` + optional `ldraw_custom/`) and a model list JSON `[{"name","file"}]`.
2. `node tools/build-viewer-data.js --site <dir> --models <models.json>`
3. Serve `viewer.html` + `js/` + the site, exposing the API table below, then open `viewer.html?file=models/<name>.mpd`.

| Endpoint | Returns |
| --- | --- |
| `/api/listModels` | model list |
| `/api/model?m=N` or `?file=<path>` | step JSON |
| `/api/modelText?m=N` or `?file=<path>` | flattened LDraw text |
| `/api/partsBundle` | custom parts |
| `/api/allPartsSummary` | all part names |
| `/ldraw/LDConfig.ldr` | color config |
| `/ldraw/**` | part geometry |

## Parts library

Not bundled. Download from <https://library.ldraw.org/> (complete zip: <https://library.ldraw.org/library/updates/complete.zip>) and serve it under `/ldraw/**`.

## Credits

- [buildinginstructions.js](https://github.com/LasseD/buildinginstructions.js) — original viewer logic
- [three.js](https://threejs.org/) — WebGL engine
- [LDraw](https://www.ldraw.org/) — format & official parts library

## License

Our code (`tools/*`, `js/*`, `sample/*`): MIT. `viewer.html` derives from buildinginstructions.js (Unlicense) and bundles three.js (MIT). The LDraw parts library is CC BY 4.0 and is not distributed here.
