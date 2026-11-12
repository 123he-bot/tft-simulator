#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""赛季切换回归测试（无第三方依赖）

用法：
    D:\\python.exe tools\\season_e2e.py            # 自动起本地静态服务并跑一次
    D:\\python.exe tools\\season_e2e.py --keep     # 保留临时 harness 便于排查

做的事情：在本地起静态服务 -> 用无头 Chrome/Edge 打开 harness 页面 -> 在 iframe 内
切换赛季、载入存档、打开详情 -> 断言徽章 / KPI / 榜单 / 装备 / 补丁下拉 / 赛季同步。
"""
import argparse
import http.server
import json
import os
import re
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HARNESS = '__e2e_season.html'
BROWSERS = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
]

HARNESS_HTML = r"""<!doctype html>
<meta charset="utf-8">
<title>season-e2e</title>
<body>
<pre id="out">boot</pre>
<iframe id="f" src="index.html" style="width:1280px;height:900px"></iframe>
<script>
var out = document.getElementById('out'), f = document.getElementById('f'), W = null, R = {};
function d() { return f.contentDocument; }
function setSeason(slug) {
  var sel = d().getElementById('seasonSelect');
  sel.value = slug;
  sel.dispatchEvent(new W.Event('change', { bubbles: true }));
}
function snap() {
  var D = W.TFT.D, ps = d().getElementById('patchSelect');
  var tiers = D.meta.tiers || {}, total = 0;
  Object.keys(tiers).forEach(function (k) { total += (tiers[k] || []).length; });
  return {
    slug: D.currentSlug,
    metaSet: D.meta.set,
    metaSource: D.meta.source,
    badge: (d().querySelector('.hero-badge') || {}).textContent || '',
    comps: total,
    patchDisplay: ps.style.display || 'inline',
    patchOpts: ps.options.length
  };
}
/* 依次切标签统计数量，最后回到首页 */
function tabs() {
  var M = W.TFT.Main;
  M.setTab('champions');
  var champ = d().querySelectorAll('#champList .grid-card').length;
  M.setTab('augments');
  var aug = d().querySelectorAll('#augmentList .aug-card').length;
  M.setTab('items');
  var items = d().querySelectorAll('#itemList .item-card').length;
  M.setTab('forge');
  var ornn = d().querySelectorAll('#ornnList .item-card').length;
  M.go('home');
  return { champ: champ, aug: aug, items: items, ornn: ornn,
    tabIcons: d().querySelectorAll('#tabBar .tab svg').length };
}
function localComp() {
  var cp = (W.TFT.D.meta.tiers.S || [])[0];
  if (!cp) return { found: false };
  var items = 0, hasItems = 0;
  (cp.units || []).forEach(function (u) {
    var n = (u.items || []).length; items += n; if (n) hasItems++;
  });
  W.TFT.Main.openCompDetail(cp.id);
  var body = d().querySelector('#modalBody');
  var txt = body ? body.textContent.replace(/\s+/g, ' ') : '';
  W.TFT.UI.closeModal();
  return { found: true, name: cp.name, confidence: cp.confidence || '', items: items,
    unitsWithItems: hasItems, detailHasNoCounter: /暂无/.test(txt),
    detailHasConfidence: /推断置信度/.test(txt) };
}
function compDetail() {
  var list = W.TFT.D.meta.tiers.S || [];
  var cp = list[0];
  for (var i = 0; i < list.length; i++) {
    var cc = list[i].counters || {};
    if ((cc['被克制'] || []).length) { cp = list[i]; break; }
  }
  if (!cp) return { found: false };
  W.TFT.Main.openCompDetail(cp.id);
  var body = d().querySelector('#modalBody');
  var txt = body ? body.textContent.replace(/\s+/g, ' ') : '';
  var out = { found: true,
    hasPace: /运营节奏/.test(txt) && /关键节点/.test(txt),
    paceRows: body ? body.querySelectorAll('.pace-row:not(.head)').length : 0,
    nodes: body ? body.querySelectorAll('.node-line').length : 0,
    posGrids: body ? body.querySelectorAll('.pos-grid').length : 0,
    hasAdvice: /应对建议/.test(txt) };
  W.TFT.UI.closeModal();
  return out;
}
function moreCenter() {
  var mm = d().getElementById('moreMenu'), btn = d().getElementById('btnMore');
  if (!mm || !btn) return { found: false };
  btn.click();
  var items = mm.querySelectorAll('.mm-item'), acts = 0;
  for (var i = 0; i < items.length; i++) if (items[i].dataset.act) acts++;
  var search = mm.querySelector('#moreSearch'), empty = mm.querySelector('#mmEmpty');
  var res = { found: true, items: items.length, acts: acts, cols: mm.querySelectorAll('.mm-col').length, groups: mm.querySelectorAll('.mm-group').length,
    hasHead: !!mm.querySelector('.mm-head'), hasSearch: !!search, hasAll: !!mm.querySelector('#mmAll'),
    count: (mm.querySelector('#moreCount') || {}).textContent || '' };
  if (search) {
    var q1 = ((items[0].querySelector('.mm-txt b') || {}).textContent || '').trim().slice(0, 2);
    search.value = q1;
    search.dispatchEvent(new W.Event('input', { bubbles: true }));
    var vis1 = 0; for (var j = 0; j < items.length; j++) if (items[j].style.display !== 'none') vis1++;
    search.value = 'zzzz-no-match';
    search.dispatchEvent(new W.Event('input', { bubbles: true }));
    var vis0 = 0; for (var k = 0; k < items.length; k++) if (items[k].style.display !== 'none') vis0++;
    res.filterHit = vis1; res.filterNone = vis0;
    res.emptyShown = empty ? !empty.classList.contains('hidden') : false;
    search.value = '';
    search.dispatchEvent(new W.Event('input', { bubbles: true }));
  }
  btn.click();
  res.closed = mm.classList.contains('hidden');
  return res;
}
function homeGrid() {
  var g = d().getElementById('homeGridNav'), cnt = d().getElementById('homeToolsCount');
  if (!g) return { found: false };
  var items = g.querySelectorAll('.grid-nav-item'), svgs = 0, titles = 0, grp = 0;
  for (var i = 0; i < items.length; i++) {
    if (items[i].querySelector('.gn-ico svg')) svgs++;
    var b = items[i].querySelector('.gn-body b');
    if (b && b.textContent.trim()) titles++;
    if (items[i].querySelector('.gn-grp')) grp++;
  }
  return { found: true, items: items.length, svgs: svgs, titles: titles, grp: grp,
    count: cnt ? cnt.textContent : '', firstAct: items[0] ? items[0].dataset.homeAct : '' };
}
function dcRows() { return d().querySelectorAll('#dcBody .dc-table tbody tr').length; }
function dataCenter() {
  var M = W.TFT.Main, v = d().getElementById('viewData');
  M.go('data');
  var res = {
    visible: !!v && !v.classList.contains('hidden'),
    tabs: v ? v.querySelectorAll('.dc-tab').length : 0,
    hero: v ? v.querySelectorAll('.dc-hs').length : 0,
    rows: dcRows(),
    kpis: v ? v.querySelectorAll('#dcBody .dc-kpi').length : 0,
    note: v ? !!v.querySelector('.dc-note') : false,
    chartCards: v ? v.querySelectorAll('#dcBody .dc-chart-card').length : 0,
    chartBars: v ? v.querySelectorAll('#dcBody .dc-bar-fill').length : 0,
    title: v ? ((v.querySelector('.dc-title') || {}).textContent || '') : ''
  };
  var cg = v.querySelector('#dcBody [data-dc-act="chartgrade"]');
  if (cg) {
    res.cgOrig = dcRows();
    cg.click();
    res.cgOn = !!v.querySelector('#dcBody [data-dc-act="chartgrade"].on');
    res.cgHash = f.contentWindow.location.hash;
    res.cgRows = dcRows();
    var cgOn = v.querySelector('#dcBody [data-dc-act="chartgrade"].on');
    if (cgOn) cgOn.click();
    res.cgOffRows = dcRows();
  }
  var cc = v.querySelector('#dcBody [data-dc-act="chartcost"][data-key="5"]');
  if (cc) {
    cc.click();
    res.ccOn = !!v.querySelector('#dcBody [data-dc-act="chartcost"][data-key="5"].on');
    res.ccHash = f.contentWindow.location.hash;
    var ccOn = v.querySelector('#dcBody [data-dc-act="chartcost"][data-key="5"].on');
    if (ccOn) ccOn.click();
  }
  var ct = v.querySelector('#dcBody [data-dc-act="charttrait"]');
  if (ct) {
    ct.click();
    res.ctOn = !!v.querySelector('#dcBody [data-dc-act="charttrait"].on');
    res.ctHash = f.contentWindow.location.hash;
    var ctOn = v.querySelector('#dcBody [data-dc-act="charttrait"].on');
    if (ctOn) ctOn.click();
  }
  var t = v.querySelector('[data-dc-act="tier"][data-key="platinum"]');
  if (t) { t.click(); res.tierRows = dcRows(); }
  var c = v.querySelector('[data-dc-act="cost"][data-key="5"]');
  if (c) { c.click(); res.costOn = !!v.querySelector('[data-dc-act="cost"][data-key="5"].on'); res.costRows = dcRows(); v.querySelector('[data-dc-act="cost"][data-key="5"]').click(); }
  var ut = v.querySelector('.dc-tab[data-key="units"]'); if (ut) ut.click();
  res.unitRows = dcRows();
  var ur = v.querySelector('#dcBody .dc-row');
  if (ur) { ur.click(); res.unitModal = !!d().querySelector('#modalBody .dc-detail-head'); W.TFT.UI.closeModal(); }
  var it = v.querySelector('.dc-tab[data-key="items"]'); if (it) it.click();
  res.itemRows = dcRows();
  res.itemGrades = v.querySelectorAll('#dcBody .dc-grade').length;
  res.itemDist = v.querySelectorAll('#dcBody .dc-dist-card').length;
  var ic = v.querySelector('#dcBody [data-dc-act="chartcat"]');
  if (ic) {
    ic.click();
    res.icOn = !!v.querySelector('#dcBody [data-dc-act="chartcat"].on');
    res.icHash = f.contentWindow.location.hash;
    var icOn = v.querySelector('#dcBody [data-dc-act="chartcat"].on');
    if (icOn) icOn.click();
  }
  var ia = v.querySelector('[data-dc-act="icat"][data-key="artifact"]');
  if (ia) { ia.click(); res.artifactRows = dcRows(); res.artifactOn = !!v.querySelector('[data-dc-act="icat"][data-key="artifact"].on'); }
  var ir = v.querySelector('#dcBody .dc-row');
  if (ir) { ir.click(); res.itemModal = !!d().querySelector('#modalBody .dc-detail-head'); W.TFT.UI.closeModal(); }
  res.itemHash = f.contentWindow.location.hash;
  f.contentWindow.location.hash = '#data/items?tier=master&cat=artifact&isort=total';
  W.TFT.DataCenter.render();
  res.deepTier = !!v.querySelector('[data-dc-act="tier"][data-key="master"].on');
  res.deepCat = !!v.querySelector('[data-dc-act="icat"][data-key="artifact"].on');
  res.deepSort = (v.querySelector('[data-dc-act="isort"]') || {}).value;
  res.deepRows = dcRows();
  f.contentWindow.location.hash = '#data/items';
  W.TFT.DataCenter.render();
  res.memTier = !!v.querySelector('[data-dc-act="tier"][data-key="master"].on');
  res.memCat = !!v.querySelector('[data-dc-act="icat"][data-key="artifact"].on');
  res.memSort = (v.querySelector('[data-dc-act="isort"]') || {}).value;
  var ta = v.querySelector('[data-dc-act="tier"][data-key="all"]'); if (ta) ta.click();
  var tt = v.querySelector('.dc-tab[data-key="traits"]'); if (tt) tt.click();
  res.traitRows = dcRows();
  res.traitGrades = v.querySelectorAll('#dcBody .dc-grade').length;
  res.traitDist = v.querySelectorAll('#dcBody .dc-dist-card').length;
  var tgd = v.querySelector('#dcBody [data-dc-act="charttgrade"]');
  if (tgd) {
    res.tgOrig = dcRows();
    tgd.click();
    res.tgOn = !!v.querySelector('#dcBody [data-dc-act="charttgrade"].on');
    res.tgHash = f.contentWindow.location.hash;
    res.tgRows = dcRows();
    var tgdOn = v.querySelector('#dcBody [data-dc-act="charttgrade"].on');
    if (tgdOn) tgdOn.click();
    res.tgOffRows = dcRows();
  }
  var tg = v.querySelector('[data-dc-act="tgraded"]');
  if (tg) { tg.click(); res.traitGradedRows = dcRows(); res.traitGradedOn = !!v.querySelector('[data-dc-act="tgraded"].on'); }
  var tr = v.querySelector('#dcBody .dc-row');
  if (tr) {
    tr.click();
    res.traitModal = !!d().querySelector('#modalBody .dc-detail-head');
    res.traitModalRows = d().querySelectorAll('#modalBody .dc-table tbody tr').length;
    W.TFT.UI.closeModal();
  }
  var et = v.querySelector('.dc-tab[data-key="explorer"]'); if (et) et.click();
  var picks = v.querySelectorAll('[data-dc-act="cmptoggle"]');
  if (picks.length >= 2) { picks[0].click(); }
  picks = v.querySelectorAll('[data-dc-act="cmptoggle"]');
  if (picks.length >= 2) { picks[1].click(); }
  res.cmpPicked = v.querySelectorAll('[data-dc-act="cmptoggle"].on').length;
  res.cmpHash = f.contentWindow.location.hash;
  var cb = v.querySelector('[data-dc-act="cmpopen"]');
  if (cb) {
    cb.click();
    res.cmpCols = d().querySelectorAll('#modalBody .dc-cmp-head').length;
    res.cmpBest = d().querySelectorAll('#modalBody .dc-cmp-val.is-best').length;
    res.cmpUnits = d().querySelectorAll('#modalBody .dc-cmp-unit').length;
    W.TFT.UI.closeModal();
  }
  var cmpIds = [];
  v.querySelectorAll('#dcBody tr[data-dc-act="comp"]').forEach(function (r) {
    if (cmpIds.length < 2 && cmpIds.indexOf(r.getAttribute('data-id')) < 0) cmpIds.push(r.getAttribute('data-id'));
  });
  f.contentWindow.location.hash = '#data/explorer?tier=all&cmp=' + cmpIds.map(encodeURIComponent).join(',');
  W.TFT.DataCenter.render();
  res.cmpDeepPicked = v.querySelectorAll('[data-dc-act="cmptoggle"].on').length;
  res.cmpDeepOn = !(v.querySelector('[data-dc-act="cmpopen"]') || {}).disabled;
  var rr = v.querySelector('[data-dc-act="reset"]');
  if (rr) { rr.click(); res.cmpAfterReset = v.querySelectorAll('[data-dc-act="cmptoggle"].on').length; }
  var at = v.querySelector('.dc-tab[data-key="augments"]'); if (at) at.click();
  res.augRows = dcRows();
  res.augGrades = v.querySelectorAll('#dcBody .dc-grade').length;
  res.augDist = v.querySelectorAll('#dcBody .dc-dist-card').length;
  res.augTierChips = v.querySelectorAll('[data-dc-act="atier"]').length;
  var ar = v.querySelector('[data-dc-act="ararity"][data-key="prismatic"]');
  if (ar) { ar.click(); res.prismRows = dcRows(); res.prismOn = ar.classList.contains('on'); }
  var aug = v.querySelector('#dcBody .dc-row');
  if (aug) { aug.click(); res.augModal = !!d().querySelector('#modalBody .dc-detail-head'); W.TFT.UI.closeModal(); }
  /* 仅有评级开关 */
  var rsta = v.querySelector('#dcBody [data-dc-act="reset"]'); if (rsta) rsta.click();
  res.augAllRows = dcRows();
  var rated = v.querySelector('[data-dc-act="arated"]');
  if (rated) {
    rated.click();
    res.augRatedOn = !!v.querySelector('#dcBody [data-dc-act="arated"].on');
    res.augRatedRows = dcRows();
    var dash = 0;
    v.querySelectorAll('#dcBody .dc-aug-table tbody tr').forEach(function (r) {
      if (r.cells[0] && r.cells[0].textContent.trim() === '—') dash++;
    });
    res.augRatedDash = dash;
    var ratedOn = v.querySelector('#dcBody [data-dc-act="arated"].on');
    if (ratedOn) ratedOn.click();
  }
  /* 符文来源筛选：历史继承 / S18 新增 */
  var legacy = v.querySelector('[data-dc-act="aorigin"][data-key="legacy"]');
  if (legacy) {
    legacy.click();
    res.augLegacyOn = !!v.querySelector('#dcBody [data-dc-act="aorigin"][data-key="legacy"].on');
    res.augLegacyRows = dcRows();
    var badOrigin = 0;
    v.querySelectorAll('#dcBody .dc-aug-table tbody tr').forEach(function (r) {
      var tx = r.cells[1] ? r.cells[1].textContent : '';
      if (tx.indexOf('继承') < 0 && tx.indexOf('历史') < 0) badOrigin++;
    });
    res.augLegacyBad = badOrigin;
  }
  var created = v.querySelector('[data-dc-act="aorigin"][data-key="new"]');
  if (created) { created.click(); res.augNewRows = dcRows(); }
  res.exportBtns = v.querySelectorAll('#dcBody .dc-export').length;
  /* 装备目录同名去重（P0 回归）：DA_ 与旧 id 同名只保留 DA_，其余历史同名变体保留 */
  var rawItems = (W.TFT.D.itemsFull || []).filter(function (i) {
    return !i.sets || !i.sets.length || i.sets.indexOf('s18') >= 0;
  });
  res.itemRawCount = rawItems.length;
  res.itemCount = W.TFT.D.officialItems('s18').length;
  res.itemDedupeDrop = rawItems.length - res.itemCount;
  res.itemMixedDup = (function () {
    var byName = {}, mixed = 0;
    W.TFT.D.officialItems('s18').forEach(function (i) {
      var k = (i.category || '') + '|' + (i.name || i.id);
      (byName[k] = byName[k] || []).push(i.id);
    });
    Object.keys(byName).forEach(function (k) {
      var ids = byName[k];
      if (ids.length > 1 && ids.some(function (id) { return /^DA_/.test(id); })
        && ids.some(function (id) { return !/^DA_/.test(id); })) mixed++;
    });
    return mixed;
  })();
  /* 趋势与口径页 */
  var ttab = v.querySelector('.dc-tab[data-key="trends"]');
  if (ttab) {
    ttab.click();
    res.trendKpis = v.querySelectorAll('#dcBody .dc-kpi').length;
    res.trendCards = v.querySelectorAll('#dcBody .dc-trend-card').length;
    res.trendLines = v.querySelectorAll('#dcBody .dc-trend-wrap svg path').length;
    res.trendDiffCards = v.querySelectorAll('#dcBody .dc-diff-card').length;
    res.trendTierbar = !!v.querySelector('.dc-tierbar');
  }
  var atab = v.querySelector('.dc-tab[data-key="about"]');
  if (atab) {
    atab.click();
    res.aboutHero = !!v.querySelector('#dcBody .dc-about-hero');
    res.aboutRows = v.querySelectorAll('#dcBody .dc-about-table tbody tr').length;
    res.aboutTierbar = !!v.querySelector('.dc-tierbar');
  }
  M.go('home');
  res.backHome = d().getElementById('viewData').classList.contains('hidden');
  return res;
}
function finish() { out.textContent = JSON.stringify(R); }
f.onload = function () {
  W = f.contentWindow;
  setTimeout(function () {
    try {
      setSeason('s17');
      setTimeout(function () {
        R.s17 = snap(); R.s17Tabs = tabs(); R.detail = compDetail();
        setSeason('s3');
        setTimeout(function () {
          R.s3 = snap(); R.s3Tabs = tabs(); R.s3Comp = localComp();
          R.grid = homeGrid(); R.more = moreCenter();
          /* S18（第三方源接入）——赛季下拉可见、棋子/羁绊数量、来源标注 */
          setSeason('s18');
          var hs18 = d().getElementById('homeSource');
          R.s18 = {
            selectValue: d().getElementById('seasonSelect').value,
            champs: W.TFT.D.champions().length,
            traits: W.TFT.D.traits().length,
            srcNote: hs18 ? hs18.textContent.indexOf('S18 来源') >= 0 : false,
            compSrc: hs18 ? hs18.textContent.indexOf('S18 阵容') >= 0 : false,
            realSource: W.TFT.D.meta.source || '',
            augs: W.TFT.D.augmentList('s18').length,
            itemStats: ((W.TFT.D.raw || {}).s18Stats || { items: {} }).items
              ? (((W.TFT.D.raw || {}).s18Stats || {}).items || {}).stats.length : 0,
            tierOP: ((W.TFT.D.meta.tiers || {}).OP || []).length,
            stats: d().querySelectorAll('#homeTierGrid .cc-metrics').length,
            enTag: W.TFT.D.champions().every(function (c) { return c.ability && c.ability.lang === 'en'; }),
            comps: (function () { var t = W.TFT.D.meta.tiers || {}, n = 0;
              Object.keys(t).forEach(function (k) { n += (t[k] || []).length; }); return n; })()
          };
          var cpO = (W.TFT.D.meta.tiers.OP || [])[0];
          if (cpO) {
            W.TFT.Main.openCompDetail(cpO.id);
            var mb = d().getElementById('modalBody');
            R.s18.detail = {
              found: !!mb,
              units: mb ? mb.querySelectorAll('.unit-line').length : 0,
              items: mb ? mb.querySelectorAll('.ur-it').length : 0,
              icons: mb ? mb.querySelectorAll('.ur-it img').length : 0,
              stats: mb ? mb.textContent.indexOf('真实对局统计') >= 0 : false,
              src: mb ? mb.textContent.indexOf('OP.GG 实时数据') >= 0 : false,
              noEngine: mb ? mb.textContent.indexOf('出装为引擎推荐') < 0 : false,
              desc: mb ? mb.querySelectorAll('.cd-desc').length : 0,
              descText: mb ? (mb.querySelector('.cd-desc') || {}).textContent || '' : '',
              core: mb ? mb.querySelectorAll('.core-card').length : 0,
              coreImgs: mb ? mb.querySelectorAll('.core-card .core-icon').length : 0,
              coreItems: mb ? mb.querySelectorAll('.core-card .ur-it').length : 0
            };
            W.TFT.UI.closeModal();
          }
          R.dc = dataCenter();
          /* 回到 S17 后载入一份 S3 存档，验证赛季 UI 同步 */
          setSeason('s17');
          var si = d().getElementById('searchInput');
          if (si) { si.value = '战'; si.dispatchEvent(new Event('input', { bubbles: true })); }
          setTimeout(function () {
            var sg = d().getElementById('searchSuggest');
            R.suggest = { hidden: sg.classList.contains('hidden'),
              head: sg.querySelectorAll('.sug-head').length,
              items: sg.querySelectorAll('.suggest-item').length,
              icons: sg.querySelectorAll('.sug-ico').length };
            sg.classList.add('hidden');
            var snapData = W.TFT.state.serialize('e2e', 'test');
            snapData.season = 's3';
            W.TFT.state.loadFrom(snapData);
            setTimeout(function () {
              R.load = { season: W.TFT.state.season, slug: W.TFT.D.currentSlug,
                select: d().getElementById('seasonSelect').value,
                metaSet: W.TFT.D.meta.set,
                badge: (d().querySelector('.hero-badge') || {}).textContent || '',
                heroTags: d().querySelectorAll('.hero-tag').length,
                hsTitle: (d().querySelector('.hs-title') || {}).textContent || '' };
              R.homeTier = { top1: d().querySelectorAll('#homeTierGrid .home-top1').length,
                titles: d().querySelectorAll('#homeTierGrid .home-tier-title').length };
              var sol = W.TFT.Solver.solve({ level: 8, gold: 50, hp: 60, threat: '' });
              R.solver = { routes: sol.routes.length, names: sol.routes.map(function (r) { return r.name; }),
                intents: sol.routes.map(function (r) { return r.intent; }),
                steps: (sol.routes[0] || {}).steps ? sol.routes[0].steps.length : 0,
                why: (sol.routes[0] || {}).why ? sol.routes[0].why.length : 0,
                equip: ((sol.routes[0] || {}).equip || []).length,
                equipNeed: (sol.routes[0] || {}).equipNeed,
                equipItems: ((sol.routes[0] || {}).equip || []).reduce(function (s, r) { return s + r.items.length; }, 0),
                hit: (sol.routes[0] || {}).hit, gap: (sol.routes[0] || {}).gap };
              W.TFT.Main.openSolver();
              setTimeout(function () {
                var box = d().querySelector('#modalBody');
                var ttl = d().querySelector('#modalTitle');
                var txt = ((ttl ? ttl.textContent : '') + ' ' + (box ? box.textContent : '')).replace(/\s+/g, ' ');
                R.solverUI = { hasTitle: /求解这一局/.test(txt), hasWhy: /为什么是这套/.test(txt),
                  hasSteps: /(现在|本回合|随后)/.test(txt), cards: d().querySelectorAll('#svWrap .op-card').length,
                  hero: d().querySelectorAll('#svWrap .sv-hero').length,
                  equipNodes: box ? box.querySelectorAll('.sv-equip').length : -1,
                  bodyLen: box ? box.innerHTML.length : -1 };
                var lg = W.TFT.Solver.addLog(sol.routes[0], sol.ctx);
                var sc = W.TFT.Solver.scoreLog(lg);
                var cpX = (W.TFT.D.meta.tiers.S || [])[0];
                if (cpX) W.TFT.Main.loadComp(cpX);
                var ob = {};
                W.TFT.state.boardList().forEach(function (u, i) {
                  ob[u._pos] = { uid: 'ou' + i, champId: u.champId, star: u.star, items: [] };
                });
                W.TFT.state.opponents = [{ id: 'op_test', name: '测试对手', hp: 100, level: 8, board: ob }];
                var pos = W.TFT.Solver.positioning();
                if (pos.ok) W.TFT.Solver.applyPositions(pos);
                var cv = W.TFT.Solver.cardCanvas(sol.routes[0], { seasonLabel: 'TEST', time: 'T' });
                var sumX = W.TFT.Solver.logSummary();
                R.adv = { logs: W.TFT.Solver.logs().length, score: sc.score, cov: sc.coverage,
                  posOk: pos.ok, posReason: pos.reason || '', tried: pos.tried || 0,
                  rate: pos.ok ? pos.best.rate : null, opps: pos.opponents || 0,
                  cw: cv.width, ch: cv.height, cardReady: !!cv._ready,
                  sumCount: sumX.count, sumAvg: sumX.avg,
                  png: cv.toDataURL('image/png').indexOf('data:image/png') === 0 };
                W.TFT.UI.closeModal();
                /* 第二批界面深化：战斗沙盒 / 战力计算器 / 社区分享结构断言 */
                W.TFT.Battle.openSim();
                var simRunBtn = d().getElementById('simRun');
                if (simRunBtn) simRunBtn.click();
                R.simUI = { verdict: d().querySelectorAll('.sim-verdict').length,
                  rosters: d().querySelectorAll('.sim-unit').length,
                  chips: d().querySelectorAll('.sim-verdict .sv-chip').length };
                W.TFT.UI.closeModal();
                W.TFT.Power.openCalc();
                R.powerUI = { score: d().querySelectorAll('.pc-score').length,
                  hero: d().querySelectorAll('.pc-hero').length };
                W.TFT.UI.closeModal();
                W.TFT.Main.openCommunity();
                R.shareUI = { code: d().querySelectorAll('.sh-code').length,
                  preview: d().querySelectorAll('.sh-preview').length };
                W.TFT.UI.closeModal();
                W.TFT.Main.openSaves();
                R.savesUI = { hero: d().querySelectorAll('.svl-hero').length,
                  importBtn: !!d().getElementById('svImport'),
                  stats: d().querySelectorAll('.svl-stat').length };
                W.TFT.UI.closeModal();
                W.TFT.AI.openSettings();
                var pbtn = d().querySelector('.set-preset[data-k="deepseek"]');
                if (pbtn) pbtn.click();
                R.preset = { count: d().querySelectorAll('.set-preset').length,
                  hero: d().querySelectorAll('.set-hero').length,
                  base: (d().getElementById('setBaseUrl') || {}).value,
                  model: (d().getElementById('setModel') || {}).value };
                W.TFT.UI.closeModal();
                W.TFT.Main.openOpponents();
                R.oppUI = { sum: d().querySelectorAll('.opp-sum').length,
                  items: d().querySelectorAll('.opp-sum .os-item').length,
                  tabs: d().querySelectorAll('.opp-tab[data-opp]').length };
                W.TFT.UI.closeModal();
                W.TFT.Review.open();
                R.reviewUI = { hero: d().querySelectorAll('.rv-hero').length,
                  stats: d().querySelectorAll('.rv-stat').length };
                W.TFT.UI.closeModal();
                /* 第四批界面深化：段位榜 / 神器适配榜 / 羁绊天梯（固定用 S18 验证段位快照） */
                var prevSlug = W.TFT.D.currentSlug;
                W.TFT.D.setSeason('s18');
                W.TFT.Main.openMeta();
                R.metaUI = { toolbar: d().querySelectorAll('#modalBody .meta-toolbar').length,
                  kpi: d().querySelectorAll('#metaKpi .mk').length,
                  tiers: d().querySelectorAll('#metaTier option').length,
                  cards: d().querySelectorAll('#metaList .comp-card').length,
                  metrics: d().querySelectorAll('#metaList .cc-metrics').length,
                  play: d().querySelectorAll('#metaList .cc-play').length };
                var mtier = d().getElementById('metaTier');
                if (mtier) { mtier.value = 'diamond'; mtier.dispatchEvent(new W.Event('change', { bubbles: true })); }
                R.metaUI.diamond = d().querySelectorAll('#metaList .comp-card').length;
                var mq = d().getElementById('metaQ');
                if (mq) { mq.value = '斗士'; mq.dispatchEvent(new W.Event('input', { bubbles: true })); }
                R.metaUI.search = d().querySelectorAll('#metaList .comp-card').length;
                W.TFT.UI.closeModal();
                W.TFT.Main.openArtifactBoard();
                R.artUI = { rows: d().querySelectorAll('#abList .ab-row').length,
                  only: d().querySelectorAll('#abOnly').length };
                W.TFT.UI.closeModal();
                W.TFT.Main.openTraitLadder();
                R.ladderUI = { rows: d().querySelectorAll('#modalBody .tl-row').length,
                  heads: d().querySelectorAll('#modalBody .tl-name').length };
                W.TFT.UI.closeModal();
                W.TFT.D.setSeason(prevSlug);
                W.TFT.Main.openRollSim();
                R.rollUI = { stats: d().querySelectorAll('.rs-stat').length };
                W.TFT.UI.closeModal();
                W.TFT.Main.openCharts();
                R.chartUI = { stats: d().querySelectorAll('.ch-stat').length };
                W.TFT.UI.closeModal();
                W.TFT.Main.openCardQuiz();
                R.quizUI = { modes: d().querySelectorAll('#modalBody .qz-mode').length,
                  boards: d().querySelectorAll('#modalBody .qz-board, #modalBody .qz-empty').length };
                var timedBtn = d().querySelector('#modalBody [data-qmode="timed"]');
                if (timedBtn) timedBtn.click();
                R.quizUI.prog = d().querySelectorAll('.qz-prog').length;
                R.quizUI.timedProg = d().querySelectorAll('.qz-prog.timed').length;
                R.quizUI.timer = d().querySelectorAll('#qzTimer').length;
                R.quizUI.opts = d().querySelectorAll('.qz-opt').length;
                W.TFT.UI.closeModal();
                W.TFT.Main.openOptimizer();
                R.optUI = { sum: d().querySelectorAll('.opm-sum').length,
                  cards: d().querySelectorAll('#optWrap .op-card').length };
                W.TFT.UI.closeModal();
                W.TFT.UI.toast('e2e-test', 'ok');
                var toasts = d().querySelectorAll('#toastRoot .toast');
                var lastT = toasts[toasts.length - 1];
                R.toastUI = { ico: lastT ? lastT.querySelectorAll('.toast-ico.ti-ok').length : 0,
                  msg: lastT ? (lastT.querySelector('.toast-msg') || {}).textContent || '' : '' };
                finish();
              }, 600);
            }, 400);
          }, 700);
        }, 700);
      }, 700);
    } catch (e) { R.error = String(e); finish(); }
  }, 1800);
};
</script>
</body>
"""


def find_browser():
    for p in BROWSERS:
        if os.path.exists(p):
            return p
    raise SystemExit('未找到 Chrome / Edge，可在脚本里补充路径')


def serve(root):
    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=root, **kw)

        def log_message(self, *a):
            pass

    httpd = socketserver.ThreadingTCPServer(('127.0.0.1', 0), QuietHandler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def dump_dom(browser, url, timeout=45):
    with tempfile.NamedTemporaryFile(delete=False, suffix='.html') as tmp:
        path = tmp.name
    try:
        subprocess.run([
            browser, '--headless=new', '--disable-gpu', '--no-sandbox',
            '--virtual-time-budget=15000', '--dump-dom', url,
        ], stdout=open(path, 'w', encoding='utf-8'), stderr=subprocess.DEVNULL,
            timeout=timeout, check=False)
        with open(path, encoding='utf-8', errors='replace') as fh:
            return fh.read()
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def run(keep=False):
    browser = find_browser()
    harness_path = os.path.join(ROOT, HARNESS)
    with open(harness_path, 'w', encoding='utf-8') as fh:
        fh.write(HARNESS_HTML)
    httpd = None
    try:
        httpd, port = serve(ROOT)
        dom = dump_dom(browser, 'http://127.0.0.1:%d/%s' % (port, HARNESS))
        m = re.search(r'<pre id="out">(.*?)</pre>', dom, re.S)
        if not m:
            print('FAIL 未取到 harness 输出（页面可能未加载完成）')
            return 1
        try:
            result = json.loads(m.group(1))
        except ValueError:
            print('FAIL harness 输出不是合法 JSON：%s' % m.group(1)[:300])
            return 1
    finally:
        if httpd:
            httpd.shutdown()
            httpd.server_close()
        if not keep:
            try:
                os.remove(harness_path)
            except OSError:
                pass

    if result.get('error'):
        print('FAIL 页面脚本异常：%s' % result['error'])
        return 1

    checks = []

    def check(name, ok, detail=''):
        checks.append((name, ok, detail))

    s17, s17t = result.get('s17', {}), result.get('s17Tabs', {})
    s3, s3t, cp = result.get('s3', {}), result.get('s3Tabs', {}), result.get('s3Comp', {})
    load = result.get('load', {})

    check('S17 徽章为真实数据', '数据可溯源' in s17.get('badge', ''), s17.get('badge'))
    check('S17 榜单 69 套', s17.get('comps') == 69, s17.get('comps'))
    check('S17 补丁下拉可用', s17.get('patchDisplay') != 'none' and s17.get('patchOpts', 0) > 1,
          '%s/%s' % (s17.get('patchDisplay'), s17.get('patchOpts')))
    check('S17 海克斯 276 条', s17t.get('aug') == 276, s17t.get('aug'))
    check('S17 神器 21 件', s17t.get('ornn') == 21, s17t.get('ornn'))
    check('素材标签含 6 个图标', s17t.get('tabIcons') == 6, s17t.get('tabIcons'))

    check('S3 徽章为本地推断', '本地推断' in s3.get('badge', ''), s3.get('badge'))
    check('S3 榜单 24 套', s3.get('comps') == 24, s3.get('comps'))
    check('S3 棋子 57 个', s3t.get('champ') == 57, s3t.get('champ'))
    check('S3 海克斯 238 条', s3t.get('aug') == 238, s3t.get('aug'))
    check('S3 神器 17 件', s3t.get('ornn') == 17, s3t.get('ornn'))
    check('S3 补丁下拉隐藏', s3.get('patchDisplay') == 'none' and s3.get('patchOpts') == 0,
          '%s/%s' % (s3.get('patchDisplay'), s3.get('patchOpts')))
    check('S3 推断阵容带置信度', bool(cp.get('confidence')), cp.get('confidence'))
    check('S3 推断阵容预填出装', cp.get('items', 0) > 0 and cp.get('unitsWithItems', 0) > 0,
          '%s 件 / %s 人' % (cp.get('items'), cp.get('unitsWithItems')))
    check('S3 详情页克制显示暂无', cp.get('detailHasNoCounter') is True)
    check('S3 详情页显示置信度', cp.get('detailHasConfidence') is True)

    detail = result.get('detail', {})

    s18 = result.get('s18', {})
    check('S18 出现在赛季下拉', s18.get('selectValue') == 's18', s18.get('selectValue'))
    check('S18 棋子 65 个', s18.get('champs') == 65, s18.get('champs'))
    check('S18 羁绊 35 条', s18.get('traits') == 35, s18.get('traits'))
    check('S18 首页标注来源为第三方', s18.get('srcNote') is True)
    check('S18 技能文本标记为英文原文', s18.get('enTag') is True)
    check('S18 阵容榜单为 OP.GG 实时数据', 'OP.GG' in (s18.get('realSource') or ''), s18.get('realSource'))
    check('S18 实时阵容不少于 50 套', s18.get('comps') >= 50, s18.get('comps'))
    check('S18 含 OP 档阵容', s18.get('tierOP', 0) > 0, s18.get('tierOP'))
    check('S18 首页卡片展示真实统计', s18.get('stats', 0) > 0, s18.get('stats'))
    check('S18 首页标注阵容数据来源', s18.get('compSrc') is True)
    check('S18 强化符文已补齐', s18.get('augs', 0) >= 250, s18.get('augs'))
    check('S18 装备统计已补齐', s18.get('itemStats', 0) >= 100, s18.get('itemStats'))
    s18d = s18.get('detail') or {}
    check('S18 阵容详情可打开', s18d.get('found') is True)
    check('S18 详情展示全部上阵单位', s18d.get('units', 0) >= 8, s18d.get('units'))
    check('S18 详情展示真实出装', s18d.get('items', 0) >= 10 and s18d.get('icons', 0) >= 10,
          '%s 件 / %s 图标' % (s18d.get('items'), s18d.get('icons')))
    check('S18 详情标注真实对局统计', s18d.get('stats') is True)
    check('S18 详情标注 OP.GG 来源', s18d.get('src') is True)
    check('S18 详情不再标注引擎推荐', s18d.get('noEngine') is True)
    check('S18 详情展示阵容说明', s18d.get('desc', 0) >= 1)
    check('阵容说明含主C与真实统计', '主C' in (s18d.get('descText') or '') and '登顶率' in (s18d.get('descText') or ''),
          (s18d.get('descText') or '')[:40])
    check('S18 详情展示核心棋子', s18d.get('core', 0) >= 1, s18d.get('core'))
    check('核心棋子含图标与出装', s18d.get('coreImgs', 0) >= 1 and s18d.get('coreItems', 0) >= 1,
          '%s 图标 / %s 件' % (s18d.get('coreImgs'), s18d.get('coreItems')))
    check('攻略页含运营节奏与关键节点', detail.get('found') is True and detail.get('hasPace') is True,
          'found=%s pace=%s' % (detail.get('found'), detail.get('hasPace')))
    check('运营节奏表至少 4 行', detail.get('paceRows', 0) >= 4, detail.get('paceRows'))
    check('关键节点 / 避坑 3 条', detail.get('nodes', 0) >= 3, detail.get('nodes'))
    check('站位卡含第二种变体', detail.get('posGrids', 0) >= 2, detail.get('posGrids'))
    check('克制卡含应对建议', detail.get('hasAdvice') is True, detail.get('hasAdvice'))

    more = result.get('more', {})
    check('工具中心渲染正常',
          more.get('found') is True and more.get('hasHead') is True and more.get('hasSearch') is True
          and more.get('hasAll') is True and more.get('cols', 0) == 3 and more.get('groups', 0) == 4,
          'cols=%s groups=%s head=%s' % (more.get('cols'), more.get('groups'), more.get('hasHead')))
    check('工具中心工具数 17', more.get('items') == 17 and more.get('acts') == 17
          and more.get('count') == '17', '%s / %s / %s' % (more.get('items'), more.get('acts'), more.get('count')))
    check('工具中心搜索可用', more.get('filterHit', 0) >= 1 and more.get('filterNone') == 0
          and more.get('emptyShown') is True,
          'hit=%s none=%s empty=%s' % (more.get('filterHit'), more.get('filterNone'), more.get('emptyShown')))
    check('工具中心可正常收起', more.get('closed') is True)

    grid = result.get('grid', {})
    check('首页全部工具宫格 21 项', grid.get('found') is True and grid.get('items') == 21,
          '%s / %s' % (grid.get('found'), grid.get('items')))
    check('首页宫格每条含图标/标题/分组', grid.get('svgs') == 21 and grid.get('titles') == 21
          and grid.get('grp') == 21,
          'svg=%s title=%s grp=%s' % (grid.get('svgs'), grid.get('titles'), grid.get('grp')))
    check('首页宫格与工具中心同源计数', '21' in grid.get('count', ''), grid.get('count'))

    dc = result.get('dc', {})
    check('数据中心可打开且七页签', dc.get('visible') is True and dc.get('tabs') == 7
          and '数据中心' in (dc.get('title') or ''), '%s / %s / %s' % (dc.get('visible'), dc.get('tabs'), dc.get('title')))
    check('数据中心首屏 KPI / 表格 / 口径', dc.get('hero') == 4 and dc.get('kpis') == 4
          and dc.get('rows', 0) > 0 and dc.get('note') is True,
          'hero=%s kpi=%s rows=%s note=%s' % (dc.get('hero'), dc.get('kpis'), dc.get('rows'), dc.get('note')))
    check('数据中心段位 / 费用筛选生效', dc.get('tierRows', 0) > 0 and dc.get('costOn') is True
          and dc.get('costRows', 999) <= dc.get('rows', 0),
          'tier=%s cost=%s/%s' % (dc.get('tierRows'), dc.get('costOn'), dc.get('costRows')))
    check('棋子大数据可下钻', dc.get('unitRows', 0) > 0 and dc.get('unitModal') is True,
          'rows=%s modal=%s' % (dc.get('unitRows'), dc.get('unitModal')))
    check('装备评级含真实统计与筛选', dc.get('itemRows', 0) >= 100 and dc.get('itemGrades', 0) > 0
          and dc.get('artifactRows', 0) > 0 and dc.get('artifactOn') is True and dc.get('itemModal') is True,
          'rows=%s grade=%s art=%s modal=%s' % (dc.get('itemRows'), dc.get('itemGrades'), dc.get('artifactRows'), dc.get('itemModal')))
    check('筛选状态写入分享链接', 'data/items' in (dc.get('itemHash') or '')
          and 'cat=artifact' in (dc.get('itemHash') or ''), dc.get('itemHash'))
    check('深链还原段位 / 类型 / 排序', dc.get('deepTier') is True and dc.get('deepCat') is True
          and dc.get('deepSort') == 'total' and dc.get('deepRows', 0) > 0,
          'tier=%s cat=%s sort=%s rows=%s' % (dc.get('deepTier'), dc.get('deepCat'), dc.get('deepSort'), dc.get('deepRows')))
    check('再次进入记住筛选', dc.get('memTier') is True and dc.get('memCat') is True
          and dc.get('memSort') == 'total', 'tier=%s cat=%s sort=%s' % (dc.get('memTier'), dc.get('memCat'), dc.get('memSort')))
    check('羁绊评级页签有评级与样本', dc.get('traitRows', 0) >= 20 and dc.get('traitGrades', 0) > 0,
          'rows=%s grades=%s' % (dc.get('traitRows'), dc.get('traitGrades')))
    check('羁绊仅看有评级可筛选', dc.get('traitGradedOn') is True and 0 < dc.get('traitGradedRows', 0) < dc.get('traitRows', 0),
          'on=%s rows=%s/%s' % (dc.get('traitGradedOn'), dc.get('traitGradedRows'), dc.get('traitRows')))
    check('羁绊详情可下钻阵容', dc.get('traitModal') is True and dc.get('traitModalRows', 0) > 0,
          'modal=%s rows=%s' % (dc.get('traitModal'), dc.get('traitModalRows')))
    check('阵容可勾选对比并打开面板', dc.get('cmpPicked') == 2 and dc.get('cmpCols') == 2
          and dc.get('cmpUnits', 0) > 0, 'picked=%s cols=%s best=%s units=%s' % (dc.get('cmpPicked'), dc.get('cmpCols'), dc.get('cmpBest'), dc.get('cmpUnits')))
    check('对比面板高亮最优指标', dc.get('cmpBest', 0) > 0, dc.get('cmpBest'))
    check('对比状态写入链接并可通过深链还原', 'cmp=' in (dc.get('cmpHash') or '')
          and dc.get('cmpDeepPicked') == 2 and dc.get('cmpDeepOn') is True,
          'hash=%s deep=%s on=%s' % (dc.get('cmpHash'), dc.get('cmpDeepPicked'), dc.get('cmpDeepOn')))
    check('重置清空对比选择', dc.get('cmpAfterReset') == 0, dc.get('cmpAfterReset'))
    check('检索器首屏含三张概览图', dc.get('chartCards') == 3 and dc.get('chartBars', 0) >= 15,
          'cards=%s bars=%s' % (dc.get('chartCards'), dc.get('chartBars')))
    check('装备/羁绊/符文页含分布图', dc.get('itemDist', 0) >= 1 and dc.get('traitDist', 0) >= 1
          and dc.get('augDist', 0) >= 2,
          'item=%s trait=%s aug=%s' % (dc.get('itemDist'), dc.get('traitDist'), dc.get('augDist')))
    check('点击检索器图表可联动筛选并写回链接',
          dc.get('cgOn') is True and 'grades=' in (dc.get('cgHash') or '')
          and 0 < dc.get('cgRows', 0) < dc.get('cgOrig', 0) and dc.get('cgOffRows') == dc.get('cgOrig')
          and dc.get('ccOn') is True and 'costs=5' in (dc.get('ccHash') or '')
          and dc.get('ctOn') is True and 'trait=' in (dc.get('ctHash') or ''),
          'grade on=%s hash=%s rows=%s/%s off=%s；cost on=%s；trait on=%s'
          % (dc.get('cgOn'), dc.get('cgHash'), dc.get('cgRows'), dc.get('cgOrig'), dc.get('cgOffRows'),
             dc.get('ccOn'), dc.get('ctOn')))
    check('点击装备类型图例可筛选并写回链接',
          dc.get('icOn') is True and 'cat=' in (dc.get('icHash') or ''),
          'on=%s hash=%s' % (dc.get('icOn'), dc.get('icHash')))
    check('点击羁绊评级图可筛选并写回链接',
          dc.get('tgOn') is True and 'tgrade=' in (dc.get('tgHash') or '')
          and 0 < dc.get('tgRows', 0) < dc.get('tgOrig', 0) and dc.get('tgOffRows') == dc.get('tgOrig'),
          'on=%s hash=%s rows=%s/%s off=%s'
          % (dc.get('tgOn'), dc.get('tgHash'), dc.get('tgRows'), dc.get('tgOrig'), dc.get('tgOffRows')))
    check('强化符文梯度榜含专家评级', dc.get('augRows', 0) >= 200 and dc.get('augGrades', 0) > 0
          and dc.get('augTierChips', 0) >= 5 and dc.get('prismRows', 0) > 0 and dc.get('augModal') is True,
          'rows=%s grade=%s chips=%s prism=%s modal=%s' % (dc.get('augRows'), dc.get('augGrades'), dc.get('augTierChips'), dc.get('prismRows'), dc.get('augModal')))
    check('装备目录同名去重（回归）',
          dc.get('itemRawCount', 0) > dc.get('itemCount', 0) > 0
          and dc.get('itemDedupeDrop', 0) > 0 and dc.get('itemMixedDup') == 0,
          'raw=%s kept=%s drop=%s mixed=%s' % (dc.get('itemRawCount'), dc.get('itemCount'),
                                               dc.get('itemDedupeDrop'), dc.get('itemMixedDup')))
    check('符文「仅有评级」开关生效',
          dc.get('augRatedOn') is True and 0 < dc.get('augRatedRows', 0) < dc.get('augAllRows', 0)
          and dc.get('augRatedDash') == 0,
          'on=%s rows=%s/%s dash=%s' % (dc.get('augRatedOn'), dc.get('augRatedRows'), dc.get('augAllRows'), dc.get('augRatedDash')))
    check('符文历史来源可筛选',
          dc.get('augLegacyOn') is True and 0 < dc.get('augLegacyRows', 0) < dc.get('augAllRows', 0)
          and dc.get('augLegacyBad') == 0 and 0 < dc.get('augNewRows', 0) < dc.get('augAllRows', 0),
          'legacy=%s bad=%s new=%s all=%s' % (dc.get('augLegacyRows'), dc.get('augLegacyBad'), dc.get('augNewRows'), dc.get('augAllRows')))
    check('数据页提供 CSV 导出', dc.get('exportBtns', 0) >= 1, dc.get('exportBtns'))
    check('趋势页含三张趋势图与差异卡',
          dc.get('trendKpis') == 4 and dc.get('trendCards') == 3
          and dc.get('trendLines', 0) >= 3 and dc.get('trendDiffCards', 0) >= 1,
          'kpis=%s cards=%s lines=%s diff=%s' % (dc.get('trendKpis'), dc.get('trendCards'), dc.get('trendLines'), dc.get('trendDiffCards')))
    check('趋势/口径页隐藏段位栏', dc.get('trendTierbar') is False and dc.get('aboutTierbar') is False,
          '%s/%s' % (dc.get('trendTierbar'), dc.get('aboutTierbar')))
    check('数据口径页可打开', dc.get('aboutHero') is True and dc.get('aboutRows', 0) >= 8,
          '%s/%s' % (dc.get('aboutHero'), dc.get('aboutRows')))
    check('数据中心可返回首页', dc.get('backHome') is True)

    check('载入 S3 存档后下拉同步', load.get('select') == 's3', load.get('select'))
    check('载入 S3 存档后数据同步', load.get('slug') == 's3' and load.get('metaSet') == 'S3',
          '%s/%s' % (load.get('slug'), load.get('metaSet')))
    check('载入 S3 存档后首页同步', 'S3' in load.get('badge', '') and '本地推断' in load.get('badge', ''),
          load.get('badge'))
    check('首页首屏含特性标签与数据侧栏',
          load.get('heroTags') == 3 and '站内数据' in load.get('hsTitle', ''),
          'tags=%s title=%s' % (load.get('heroTags'), load.get('hsTitle')))
    ht = result.get('homeTier', {})
    check('首页榜单含榜首卡与分档标题', ht.get('top1') == 1 and ht.get('titles') == 2,
          'top1=%s titles=%s' % (ht.get('top1'), ht.get('titles')))
    sug = result.get('suggest', {})
    check('搜索联想含头部与类型图标',
          sug.get('hidden') is False and sug.get('head') == 1
          and sug.get('items', 0) >= 1 and sug.get('icons') == sug.get('items'),
          'hidden=%s head=%s items=%s icons=%s' % (sug.get('hidden'), sug.get('head'), sug.get('items'), sug.get('icons')))

    sol, ui = result.get('solver', {}), result.get('solverUI', {})
    check('求解器给出 3 条路线', sol.get('routes') == 3, '%s %s' % (sol.get('routes'), sol.get('intents')))
    check('每条路线含回合动作', sol.get('steps', 0) >= 2, sol.get('steps'))
    check('每条路线含可解释依据', sol.get('why', 0) >= 4, sol.get('why'))
    check('命中概率为合理值', isinstance(sol.get('hit'), (int, float)) and 0 <= sol.get('hit') <= 1, sol.get('hit'))
    check('求解弹窗渲染正常', ui.get('hasTitle') and ui.get('hasSteps') and ui.get('cards') == 3,
          '%s / cards=%s / equipNodes=%s / len=%s' % (ui.get('hasTitle'), ui.get('cards'), ui.get('equipNodes'), ui.get('bodyLen')))
    check('弹窗含“为什么是这套”', ui.get('hasWhy') is True)
    check('路线含装备分配（按阵容方案）', sol.get('equip', 0) >= 2 and sol.get('equipItems', 0) >= 3,
          '%s 人 / %s 件 / 缺 %s 件' % (sol.get('equip'), sol.get('equipItems'), sol.get('equipNeed')))

    adv = result.get('adv', {})
    check('决策记录写入并评分', adv.get('logs', 0) >= 1 and 0 <= adv.get('score', -1) <= 100,
          'logs=%s score=%s cov=%s' % (adv.get('logs'), adv.get('score'), adv.get('cov')))
    check('路线卡可导出 PNG', adv.get('cw') == 1200 and adv.get('ch') == 760 and adv.get('png') is True,
          '%sx%s png=%s' % (adv.get('cw'), adv.get('ch'), adv.get('png')))
    check('路线卡带图标就绪回调', adv.get('cardReady') is True)
    check('求解弹窗含装备分配区', ui.get('equipNodes', 0) >= 1, 'nodes=%s' % ui.get('equipNodes'))
    check('求解弹窗含首选摘要卡', ui.get('hero') == 1, 'hero=%s' % ui.get('hero'))
    check('多局评分可汇总对比', adv.get('sumCount', 0) >= 1 and 0 <= adv.get('sumAvg', -1) <= 100,
          'count=%s avg=%s' % (adv.get('sumCount'), adv.get('sumAvg')))
    check('站位求解可对比对手并给出胜率',
          (adv.get('posOk') is True and adv.get('tried', 0) >= 2 and 0 <= (adv.get('rate') or -1) <= 1)
          or (adv.get('posOk') is False and bool(adv.get('posReason'))),
          'ok=%s tried=%s rate=%s %s' % (adv.get('posOk'), adv.get('tried'), adv.get('rate'), adv.get('posReason')))

    pre = result.get('preset', {})
    check('大模型设置含 4 个预设', pre.get('count') == 4, pre.get('count'))
    check('点击预设自动填入 Base URL / 模型名',
          pre.get('base') == 'https://api.deepseek.com' and pre.get('model') == 'deepseek-chat',
          '%s / %s' % (pre.get('base'), pre.get('model')))
    check('大模型设置含连接状态卡', pre.get('hero') == 1, 'hero=%s' % pre.get('hero'))

    simui, pwr, shr = result.get('simUI', {}), result.get('powerUI', {}), result.get('shareUI', {})
    sv = result.get('savesUI', {})
    check('存档弹窗含统计卡与导入按钮', sv.get('hero') == 1 and sv.get('importBtn') is True and sv.get('stats') == 3,
          'hero=%s import=%s stats=%s' % (sv.get('hero'), sv.get('importBtn'), sv.get('stats')))
    check('战斗沙盒含胜负横幅与单位血条',
          simui.get('verdict') == 1 and simui.get('rosters', 0) >= 2 and simui.get('chips') == 3,
          'verdict=%s rosters=%s chips=%s' % (simui.get('verdict'), simui.get('rosters'), simui.get('chips')))
    check('战力计算器含圆形评分卡', pwr.get('score') == 1 and pwr.get('hero') == 1,
          'score=%s hero=%s' % (pwr.get('score'), pwr.get('hero')))
    check('社区分享弹窗含代码框与预览卡', shr.get('code') == 1 and shr.get('preview') == 1,
          'code=%s preview=%s' % (shr.get('code'), shr.get('preview')))
    mui, aui, lui = result.get('metaUI', {}), result.get('artUI', {}), result.get('ladderUI', {})
    check('阵容榜含段位工具栏与 KPI', mui.get('toolbar') == 1 and mui.get('kpi') == 5
          and mui.get('tiers') == 6,
          'bar=%s kpi=%s tiers=%s' % (mui.get('toolbar'), mui.get('kpi'), mui.get('tiers')))
    check('阵容卡片含四指标与玩法标签', mui.get('cards', 0) > 0
          and mui.get('metrics', 0) == mui.get('cards') and mui.get('play', 0) >= mui.get('cards'),
          'cards=%s metrics=%s play=%s' % (mui.get('cards'), mui.get('metrics'), mui.get('play')))
    check('切换钻石档位与榜内搜索可用', mui.get('diamond', 0) > 0 and mui.get('search', -1) >= 0,
          'diamond=%s search=%s' % (mui.get('diamond'), mui.get('search')))
    check('神器适配榜可聚合装备', aui.get('rows', 0) > 0 and aui.get('only') == 1,
          'rows=%s only=%s' % (aui.get('rows'), aui.get('only')))
    check('羁绊天梯可列出羁绊', lui.get('rows', 0) > 0 and lui.get('heads', 0) == lui.get('rows'),
          'rows=%s heads=%s' % (lui.get('rows'), lui.get('heads')))
    oui, rvi, rli = result.get('oppUI', {}), result.get('reviewUI', {}), result.get('rollUI', {})
    check('对手多棋盘含总览条', oui.get('sum') == 1 and oui.get('items') == 4 and oui.get('tabs', 0) >= 1,
          'sum=%s items=%s tabs=%s' % (oui.get('sum'), oui.get('items'), oui.get('tabs')))
    check('复盘笔记含汇总卡', rvi.get('hero') == 1 and rvi.get('stats') == 4,
          'hero=%s stats=%s' % (rvi.get('hero'), rvi.get('stats')))
    check('抽卡模拟器含统计条', rli.get('stats') == 4, 'stats=%s' % rli.get('stats'))
    cui, qzi, omi = result.get('chartUI', {}), result.get('quizUI', {}), result.get('optUI', {})
    check('数据图表含总览统计条', cui.get('stats') == 5, 'stats=%s' % cui.get('stats'))
    check('认卡竞速含双模式与本机榜', qzi.get('modes') == 2 and qzi.get('boards', 0) >= 1,
          'modes=%s boards=%s' % (qzi.get('modes'), qzi.get('boards')))
    check('认卡竞速 40 秒模式含计时与选项', qzi.get('timedProg') == 1 and qzi.get('timer') == 1
          and qzi.get('opts') == 4,
          'timed=%s timer=%s opts=%s' % (qzi.get('timedProg'), qzi.get('timer'), qzi.get('opts')))
    check('阵容优化器含状态总览条', omi.get('sum') == 1 and omi.get('cards', 0) >= 1,
          'sum=%s cards=%s' % (omi.get('sum'), omi.get('cards')))
    tst = result.get('toastUI', {})
    check('Toast 含类型图标与文本', tst.get('ico') == 1 and tst.get('msg') == 'e2e-test',
          'ico=%s msg=%s' % (tst.get('ico'), tst.get('msg')))

    # index.html 资源引用一致性：版本号格式统一、同一资源不重复版本、本地文件存在
    with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as fh:
        html = fh.read()
    refs = re.findall(r'(?:src|href)="([^"]+)"', html)
    local_refs = [r for r in refs if not r.startswith(('http://', 'https://', '//', '#', 'data:', 'mailto:', 'javascript:'))]
    missing, bad_ver, vers = [], [], {}
    for r in local_refs:
        path = r.split('?', 1)[0]
        if not os.path.exists(os.path.join(ROOT, path.lstrip('./'))):
            missing.append(path)
        if '?v=' in r:
            base, ver = r.split('?v=', 1)
            base = base.lstrip('./')
            ver = ver.split('&', 1)[0]
            if not re.match(r'^\d+\.\d+\.\d+$', ver):
                bad_ver.append(r)
            vers.setdefault(base, set()).add(ver)
    multi = sorted(p for p, vs in vers.items() if len(vs) > 1)
    check('index.html 本地资源均存在', not missing, ','.join(missing[:3]))
    check('index.html 版本引用一致', not bad_ver and not multi and 'js/data.bundle.js' in vers,
          'bad=%s multi=%s bundle=%s' % (bad_ver[:2], multi[:2], sorted(vers.get('js/data.bundle.js') or [])))

    width = max(len(n) for n, _, _ in checks)
    failed = 0
    for name, ok, detail in checks:
        flag = 'PASS' if ok else 'FAIL'
        extra = '' if detail in (None, '') else '  <- %s' % detail
        print('%s  %-*s%s' % (flag, width, name, extra))
        if not ok:
            failed += 1
    print('-' * 60)
    print('%d 项通过，%d 项失败' % (len(checks) - failed, failed))
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='赛季切换回归测试')
    ap.add_argument('--keep', action='store_true', help='保留临时 harness 文件')
    args = ap.parse_args()
    sys.exit(run(keep=args.keep))
