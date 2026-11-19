// 查看器性能优化：把参考站 LDRLoader 的「每零件 1 mesh + 2 line」结构，
// 在每个步骤组（step group）内按颜色/材质合并，大幅降低 draw call。
// 参考站 LDRLoader 无任何合并（大模型 12.7 万 draw call），且每个零件
// 有独立的 material 实例（即使同色）。此脚本按「颜色 hex + 透明 + side」
// 分组三角形、按「条件线 + 边缘色 hex」分组线段，保留 118 个 step group
// 的步骤导航语义（导航按 group 级显隐，不受影响）。
//
// 注入点：viewer.html 主应用 w 回调（模型加载完成）里
//   qn.add(Fe),Fe.updateMatrixWorld(!0),mf(),__jimuOptimize&&__jimuOptimize(Fe),
// 由 extract-viewer.js 在打包时注入该调用与 <script src="js/viewer-optimize.js">。
(function () {
  'use strict';
  if (window.__jimuOptimize) return; // 防重复加载

  function isDrawable(o) {
    return (o.isMesh || o.isLineSegments) && o.material && o.geometry &&
      o.geometry.attributes && o.geometry.attributes.position;
  }

  function getMat(o) {
    return Array.isArray(o.material) ? o.material[0] : o.material;
  }

  function colorHex(c) {
    return (c && c.getHexString) ? c.getHexString() : '';
  }

  // 合并一组 BufferGeometry（合并所有 attribute：position / control0 / control1 / uv …）
  function mergeGeometries(geoms) {
    if (!geoms || !geoms.length) return null;
    if (geoms.length === 1) return geoms[0];
    var first = geoms[0];
    var merged = new first.constructor();

    var names = Object.keys(first.attributes);
    var totalVerts = 0;
    for (var i = 0; i < geoms.length; i++) totalVerts += geoms[i].attributes.position.count;

    for (var a = 0; a < names.length; a++) {
      var name = names[a];
      var attr0 = first.attributes[name];
      var itemSize = attr0.itemSize;
      var ArrayCtor = attr0.array.constructor;
      var mergedArray = new ArrayCtor(totalVerts * itemSize);
      var off = 0;
      for (var i = 0; i < geoms.length; i++) {
        var attr = geoms[i].attributes[name];
        if (attr) {
          mergedArray.set(attr.array, off * itemSize);
          off += attr.count;
        }
      }
      var AttrCtor = attr0.constructor;
      var newAttr = new AttrCtor(mergedArray, itemSize);
      if ('normalized' in attr0) newAttr.normalized = attr0.normalized;
      merged.setAttribute(name, newAttr);
    }

    // 索引（三角形有 index；线段通常无 index）
    if (first.index) {
      var totalIdx = 0;
      for (var i = 0; i < geoms.length; i++) {
        totalIdx += geoms[i].index ? geoms[i].index.count : geoms[i].attributes.position.count;
      }
      var IdxCtor = first.index.array.constructor;
      var mergedIdx = new IdxCtor(totalIdx);
      var idxOff = 0, vertOff = 0;
      for (var i = 0; i < geoms.length; i++) {
        var g = geoms[i];
        var cnt = g.attributes.position.count;
        if (g.index) {
          var arr = g.index.array;
          for (var j = 0; j < arr.length; j++) mergedIdx[idxOff + j] = arr[j] + vertOff;
          idxOff += arr.length;
        } else {
          for (var j = 0; j < cnt; j++) mergedIdx[idxOff + j] = vertOff + j;
          idxOff += cnt;
        }
        vertOff += cnt;
      }
      merged.setIndex(new first.index.constructor(mergedIdx, 1));
    }

    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }

  function mergeGroups(group, items) {
    var byKey = new Map();
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!byKey.has(it.key)) byKey.set(it.key, []);
      byKey.get(it.key).push(it);
    }
    byKey.forEach(function (arr) {
      if (arr.length < 2) return;
      var merged = mergeGeometries(arr.map(function (x) { return x.geom; }));
      if (!merged) return;
      var m = new arr[0].sample.constructor(merged, arr[0].mat);
      m.frustumCulled = false;
      if (arr[0].cond) m.isConditionalLine = true;
      group.add(m);
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].sample.parent) arr[i].sample.parent.remove(arr[i].sample);
      }
    });
  }

  // 合并一个 step group 内部的所有 mesh / line
  function optimizeStepGroup(group) {
    var Mat4 = null, invGroup = null;
    var tris = [];  // {geom, key, mat, sample}
    var lines = []; // {geom, key, mat, cond, sample}

    group.traverse(function (obj) {
      if (obj === group || !isDrawable(obj)) return;

      if (!Mat4) {
        Mat4 = obj.matrixWorld.constructor; // THREE.Matrix4
        invGroup = new Mat4().copy(group.matrixWorld).invert();
      }
      // obj 相对 step group 的变换（把中间 group 的变换也折算进来）
      var rel = new Mat4().multiplyMatrices(invGroup, obj.matrixWorld);
      var geom = obj.geometry.clone();
      geom.applyMatrix4(rel);
      var mat = getMat(obj);

      if (obj.isMesh) {
        var c = (obj.userData && obj.userData.origColor) || (mat && mat.color) || null;
        var trans = !!(mat && (mat.transparent || (mat.opacity !== undefined && mat.opacity < 1)));
        var side = mat ? mat.side : 0;
        tris.push({
          geom: geom,
          key: colorHex(c) + '|' + (trans ? '1' : '0') + '|' + side,
          mat: mat,
          sample: obj
        });
      } else {
        var e2 = (obj.userData && obj.userData.origEdgeColor) ||
          (mat && (mat.color || (mat.uniforms && mat.uniforms.diffuse && mat.uniforms.diffuse.value))) || null;
        var cond = !!(obj.isConditionalLine || (mat && mat.isLDrawConditionalLineMaterial));
        lines.push({
          geom: geom,
          key: (cond ? 'c' : 'n') + '|' + colorHex(e2),
          mat: mat,
          cond: cond,
          sample: obj
        });
      }
    });

    mergeGroups(group, tris);
    mergeGroups(group, lines);
  }

  function countDrawables(root) {
    var n = 0;
    root.traverse(function (o) { if (isDrawable(o)) n++; });
    return n;
  }

  // Fe = wrapper（Fe.children[0] = T = LDRLoader 根，T.children = 各 step group）
  window.__jimuOptimize = function (Fe) {
    try {
      var T = Fe && Fe.children && Fe.children[0];
      if (!T || !T.children || !T.children.length) return;
      var before = countDrawables(Fe);
      for (var i = 0; i < T.children.length; i++) {
        var g = T.children[i];
        if (g && g.traverse) optimizeStepGroup(g);
      }
      var after = countDrawables(Fe);
      try { console.log('[jimu-optimize] drawables ' + before + ' -> ' + after); } catch (e) {}
    } catch (e) {
      try { console.warn('[jimu-optimize] failed:', e); } catch (e2) {}
    }
  };
})();
