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
  return { champ: champ, aug: aug, items: items, ornn: ornn };
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
function finish() { out.textContent = JSON.stringify(R); }
f.onload = function () {
  W = f.contentWindow;
  setTimeout(function () {
    try {
      setSeason('s17');
      setTimeout(function () {
        R.s17 = snap(); R.s17Tabs = tabs();
        setSeason('s3');
        setTimeout(function () {
          R.s3 = snap(); R.s3Tabs = tabs(); R.s3Comp = localComp();
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
              finish();
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

    check('载入 S3 存档后下拉同步', load.get('select') == 's3', load.get('select'))
    check('载入 S3 存档后数据同步', load.get('slug') == 's3' and load.get('metaSet') == 'S3',
          '%s/%s' % (load.get('slug'), load.get('metaSet')))
    check('载入 S3 存档后首页同步', 'S3' in load.get('badge', '') and '本地推断' in load.get('badge', ''),
          load.get('badge'))

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
