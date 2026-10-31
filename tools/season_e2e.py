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
          /* 回到 S17 后载入一份 S3 存档，验证赛季 UI 同步 */
          setSeason('s17');
          setTimeout(function () {
            var snapData = W.TFT.state.serialize('e2e', 'test');
            snapData.season = 's3';
            W.TFT.state.loadFrom(snapData);
            setTimeout(function () {
              R.load = { season: W.TFT.state.season, slug: W.TFT.D.currentSlug,
                select: d().getElementById('seasonSelect').value,
                metaSet: W.TFT.D.meta.set,
                badge: (d().querySelector('.hero-badge') || {}).textContent || '' };
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
                W.TFT.AI.openSettings();
                var pbtn = d().querySelector('.set-preset[data-k="deepseek"]');
                if (pbtn) pbtn.click();
                R.preset = { count: d().querySelectorAll('.set-preset').length,
                  base: (d().getElementById('setBaseUrl') || {}).value,
                  model: (d().getElementById('setModel') || {}).value };
                W.TFT.UI.closeModal();
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
    check('首页全部工具宫格 18 项', grid.get('found') is True and grid.get('items') == 18,
          '%s / %s' % (grid.get('found'), grid.get('items')))
    check('首页宫格每条含图标/标题/分组', grid.get('svgs') == 18 and grid.get('titles') == 18
          and grid.get('grp') == 18,
          'svg=%s title=%s grp=%s' % (grid.get('svgs'), grid.get('titles'), grid.get('grp')))
    check('首页宫格与工具中心同源计数', '18' in grid.get('count', ''), grid.get('count'))

    check('载入 S3 存档后下拉同步', load.get('select') == 's3', load.get('select'))
    check('载入 S3 存档后数据同步', load.get('slug') == 's3' and load.get('metaSet') == 'S3',
          '%s/%s' % (load.get('slug'), load.get('metaSet')))
    check('载入 S3 存档后首页同步', 'S3' in load.get('badge', '') and '本地推断' in load.get('badge', ''),
          load.get('badge'))

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

    simui, pwr, shr = result.get('simUI', {}), result.get('powerUI', {}), result.get('shareUI', {})
    check('战斗沙盒含胜负横幅与单位血条',
          simui.get('verdict') == 1 and simui.get('rosters', 0) >= 2 and simui.get('chips') == 3,
          'verdict=%s rosters=%s chips=%s' % (simui.get('verdict'), simui.get('rosters'), simui.get('chips')))
    check('战力计算器含圆形评分卡', pwr.get('score') == 1 and pwr.get('hero') == 1,
          'score=%s hero=%s' % (pwr.get('score'), pwr.get('hero')))
    check('社区分享弹窗含代码框与预览卡', shr.get('code') == 1 and shr.get('preview') == 1,
          'code=%s preview=%s' % (shr.get('code'), shr.get('preview')))

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
