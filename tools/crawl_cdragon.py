#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
crawl_cdragon.py —— 从 Riot 官方 CommunityDragon CDN 抓取金铲铲之战（TFT）真实数据并落盘。

数据来源（官方，多语言，可在浏览器直连校验）：
  https://raw.communitydragon.org/latest/cdragon/tft/zh_cn.json   # 官方中文数据
  https://raw.communitydragon.org/latest/cdragon/tft/en_us.json   # 官方英文数据（英文名对齐）

产出：
  data/augments.full.json   # 全量真实海克斯强化目录（含官方中文描述、变量数值、所属羁绊、稀有度）
  data/items.full.json      # 全量真实装备目录（含合成配方、说明、分类）
  data/source.json          # 抓取溯源信息（来源 URL / 时间 / 各集合条目数）
  js/data.bundle.js         # 由 data/*.json 重新打包的运行时数据（window.TFT_DATA）

用法：
  python3 tools/crawl_cdragon.py            # 使用本地缓存（/tmp/cd）或自动下载后重建
  python3 tools/crawl_cdragon.py --refresh  # 强制重新下载
"""
import hashlib, json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
ASSETS = os.path.join(ROOT, 'assets', 'icons')
CACHE = '/tmp/cd'
CDN = 'https://raw.communitydragon.org/latest/cdragon/tft'
ICON_BASE = 'https://raw.communitydragon.org/latest/game/'

# 应用支持的赛季 slug 按官方 setData.name 归并（同一赛季的官方主模式 + PAIRS /
# TURBO / PVEMODE / 活动变体共享同一 name，一并抓取以获得最全的真实数据）。
NAME_TO_SLUG = {
    'Galaxies': 's3', 'Set7': 's7', 'Set13': 's13', 'Set14': 's14',
    'Set15': 's15', 'Set16': 's16', 'Set17': 's17',
}
SETS = {slug: name for name, slug in NAME_TO_SLUG.items()}  # slug -> 官方集合名
TIER_LABEL = {'silver': '银', 'gold': '金', 'prismatic': '棱彩', None: '特殊'}


def fetch(locale, refresh=False):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, locale + '.json')
    if refresh or not os.path.exists(path) or os.path.getsize(path) < 1000:
        url = f'{CDN}/{locale}.json'
        print('下载', url)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=180) as r, open(path, 'wb') as f:
            f.write(r.read())
    return json.load(open(path, encoding='utf-8'))


def icon_url(p):
    if not p:
        return None
    p = p.split('?')[0]
    if p.endswith('.tex'):
        p = p[:-4] + '.png'
    return ICON_BASE + p


def fmt_num(v):
    if v is None:
        return ''
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    if abs(f - round(f)) < 1e-6:
        return str(int(round(f)))
    return ('%.2f' % f).rstrip('0').rstrip('.')


def resolve_desc(desc, variables):
    """把官方描述里的 @变量@ 代入真实数值，并清理富文本标签。"""
    if not desc:
        return ''
    s = desc.replace('<br>', '\n').replace('<br/>', '\n').replace('<br />', '\n')

    def repl(m):
        inner = m.group(1)
        mult = 1.0
        name = inner
        if '*' in inner:
            name, k = inner.split('*', 1)
            try:
                mult = float(k)
            except ValueError:
                mult = 1.0
        name = name.strip()
        v = variables.get(name)
        if v is None:
            for kk, vv in variables.items():
                if kk.lower() == name.lower():
                    v, name = vv, kk
                    break
        if v is None:
            return ''
        return fmt_num(v * mult)

    s = re.sub(r'@([A-Za-z0-9_.:]+(?:\*[0-9.]+)?)@', repl, s)
    s = re.sub(r'%i:[^%]*%', '', s)
    s = re.sub(r'\{\{[^}]*\}\}', '', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = re.sub(r'\(\s*\)', '', s)
    s = re.sub(r'[ \t]+', ' ', s)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()


def pick_star_value(vals):
    """技能数值数组按 2★ 展示（无 2★ 时回退 1★）。"""
    if isinstance(vals, list) and vals:
        return vals[1] if len(vals) > 1 else vals[0]
    return vals


def augment_rarity(api, entry, zh_name):
    """优先用图标名尾部的罗马数字/数字（Riot 约定 1=银 2=金 3=棱彩），其次看 api/中文名。"""
    low = api.lower()
    base = (entry.get('icon') or '').rsplit('/', 1)[-1].lower()
    base = re.sub(r'\.(tex|png)$', '', base)
    namelow = (zh_name or '').lower()

    tier = None
    m = re.search(r'(i{1,3})$', base)          # 罗马数字后缀 i / ii / iii
    if m:
        tier = len(m.group(1))
    elif base and base[-1] in '123':           # 数字后缀 1 / 2 / 3
        tier = int(base[-1])
    if tier == 3:
        return 'prismatic'
    if tier == 2:
        return 'gold'
    if tier == 1:
        return 'silver'

    if 'prismatic' in low or re.search(r'(iii|Ⅲ)\s*$', namelow):
        return 'prismatic'
    if 'gold' in low or re.search(r'(ii|Ⅱ)\s*$', namelow):
        return 'gold'
    if 'silver' in low or re.search(r'(^|\s)(i|Ⅰ)\s*$', namelow):
        return 'silver'
    return None


def item_category(entry):
    tags = [str(t) for t in (entry.get('tags') or [])]
    api = entry.get('apiName') or ''
    icon = (entry.get('icon') or '').lower()
    if 'component' in tags:
        return 'component'
    if 'ornn' in icon or 'Ornn' in api:
        return 'artifact'
    if 'Emblem' in api or 'Spatula' in api or '纹章' in (entry.get('name') or ''):
        return 'emblem'
    if 'Support' in api:
        return 'support'
    if 'Consumable' in api:
        return 'consumable'
    if entry.get('composition'):
        return 'completed'
    return 'misc'


def build(zh, en, refresh=False):
    en_items = {i.get('apiName'): i for i in en.get('items', []) if i.get('apiName')}
    zh_items = {}
    for i in zh.get('items', []):
        if i.get('apiName'):
            zh_items[i['apiName']] = i

    # 按官方集合名归并该赛季的全部官方变体（主模式 + PAIRS/TURBO/PVEMODE/活动）
    set_by_name = {}
    for d in zh.get('setData', []):
        nm = d.get('name')
        if nm in NAME_TO_SLUG:
            set_by_name.setdefault(nm, []).append(d)

    augment_sets, item_sets = {}, {}
    for slug, nm in SETS.items():
        variants = set_by_name.get(nm, [])
        if not variants:
            print('  跳过（官方无该集合）:', slug, nm)
            continue
        for d in variants:
            for aid in d.get('augments', []):
                augment_sets.setdefault(aid, set()).add(slug)
            for iid in d.get('items', []):
                item_sets.setdefault(iid, set()).add(slug)
        n_aug = len({a for d in variants for a in d.get('augments', [])})
        n_it = len({i for d in variants for i in d.get('items', [])})
        print(f'  {slug}（{nm}，{len(variants)} 个官方变体）: 海克斯 {n_aug} / 装备 {n_it}')

    # ---- 海克斯强化目录（真实描述 + 真实变量数值 + 稀有度 + 所属羁绊）----
    augments = []
    for api, sets in sorted(augment_sets.items()):
        e = zh_items.get(api)
        if not e or not e.get('isAugment'):
            continue
        evars = e.get('effects') or {}
        if not isinstance(evars, dict):
            evars = {}
        rk = augment_rarity(api, e, e.get('name'))
        en_e = en_items.get(api, {})
        # 官方名称里也可能含 @变量@ 占位符（如「在@LargeQuestRounds@场…」），同样代入真实数值
        zh_name = resolve_desc(e.get('name') or api, evars) or (e.get('name') or api)
        augments.append({
            'id': api,
            'name': zh_name,
            'en': en_e.get('name') or None,
            'tier': TIER_LABEL.get(rk, '特殊'),
            'rarityKey': rk,
            'desc': resolve_desc(e.get('desc'), evars)[:400],
            'effects': {k: v for k, v in evars.items()},
            'traits': [],
            'icon': icon_url(e.get('icon')),
            'sets': sorted(sets),
        })

    # ---- 装备目录（真实合成配方 + 分类 + 说明）----
    items = []
    for api, sets in sorted(item_sets.items()):
        e = zh_items.get(api)
        if not e or e.get('isAugment'):
            continue
        comp = [c for c in (e.get('composition') or []) if c]
        comp_names = [(zh_items.get(c, {}).get('name') or c) for c in comp]
        en_e = en_items.get(api, {})
        items.append({
            'id': api,
            'name': e.get('name') or api,
            'en': en_e.get('name') or None,
            'category': item_category(e),
            'composition': comp,
            'compositionNames': comp_names,
            'desc': resolve_desc(e.get('desc'), {})[:300],
            'icon': icon_url(e.get('icon')),
            'sets': sorted(sets),
        })

    # 羁绊关联：把海克斯的 associatedTraits 映射成中文羁绊名
    trait_name = {}
    for d in zh.get('setData', []):
        for t in d.get('traits', []):
            if t.get('apiName'):
                trait_name.setdefault(t['apiName'], t.get('name'))
    for a in augments:
        e = zh_items.get(a['id'], {})
        names = []
        for tr in (e.get('associatedTraits') or []):
            n = trait_name.get(tr)
            if n and n not in names:
                names.append(n)
        a['traits'] = names

    return augments, items, set_by_name


def localize_assets():
    """把棋子 / 羁绊 / 装备图标下载到本地 assets/icons/，让界面不依赖远程 CDN 也能显示图片。
    会就地改写 data/*.json 里的 icon 字段为本地相对路径（幂等：已是本地路径则跳过）。"""
    os.makedirs(ASSETS, exist_ok=True)
    jobs, seen = [], {}

    BAD = {'none', 'null', 'undefined', ''}

    def register(url):
        if not url or not str(url).startswith('http'):
            return None
        base = url.split('?')[0].rsplit('/', 1)[-1]
        if base.lower() in BAD:            # 官方源里偶有的坏图标 URL（.../None）
            return None
        if base in seen and seen[base] != url:
            base = hashlib.md5(url.encode()).hexdigest()[:8] + '_' + base
        seen[base] = url
        jobs.append((url, base))
        return 'assets/icons/' + base

    def rewrite(lst):
        for it in lst or []:
            ic = it.get('icon')
            if ic and str(ic).rstrip('/').split('/')[-1].lower() in BAD:
                it['icon'] = None          # 坏图标直接置空，交给界面文字兜底
                continue
            loc = register(ic)
            if loc:
                it['icon'] = loc

    for slug in SETS:
        p = os.path.join(DATA, slug + '.json')
        if not os.path.exists(p):
            continue
        d = json.load(open(p, encoding='utf-8'))
        rewrite(d.get('champions'))
        rewrite(d.get('traits'))
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, indent=1)

    ip = os.path.join(DATA, 'items.json')
    if os.path.exists(ip):
        it = json.load(open(ip, encoding='utf-8'))
        base = it.get('iconBase') or ''
        for k in ('components', 'completed', 'artifacts'):
            for e in it.get(k, []):
                loc = register(base + (e.get('icon') or ''))
                if loc:
                    e['icon'] = loc
        with open(ip, 'w', encoding='utf-8') as f:
            json.dump(it, f, ensure_ascii=False, indent=1)

    uniq = {u: fn for u, fn in jobs}

    def one(item):
        url, fn = item
        dst = os.path.join(ASSETS, fn)
        if os.path.exists(dst) and os.path.getsize(dst) > 100:
            return 'skip'
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=60) as r:
                b = r.read()
            if b[:8] == b'\x89PNG\r\n\x1a\n' or b[:3] == b'\xff\xd8\xff':
                with open(dst, 'wb') as f:
                    f.write(b)
                return 'ok'
            return 'notimg'
        except Exception:
            return 'fail'

    stats = {}
    with ThreadPoolExecutor(max_workers=16) as ex:
        for r in ex.map(one, uniq.items()):
            stats[r] = stats.get(r, 0) + 1
    print('图标本地化：', stats, '去重图标', len(uniq))


def rebuild_bundle(augments, items):
    def load(name):
        p = os.path.join(DATA, name)
        return json.load(open(p, encoding='utf-8'))

    bundle = {
        'augments': load('augments.json'),
        'items': load('items.json'),
        'meta': load('meta.json'),
    }
    for slug in SETS:
        p = os.path.join(DATA, slug + '.json')
        if os.path.exists(p):
            bundle[slug] = load(slug + '.json')
    bundle['augmentsFull'] = augments
    bundle['itemsFull'] = items
    bundle['source'] = load('source.json')

    out = os.path.join(ROOT, 'js', 'data.bundle.js')
    with open(out, 'w', encoding='utf-8') as f:
        f.write('/* AUTO-GENERATED from /data/*.json by tools/crawl_cdragon.py. Do not edit by hand. */\n')
        f.write('window.TFT_DATA = ')
        json.dump(bundle, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    print('已重建', out, '(', round(os.path.getsize(out) / 1024), 'KB )')


def season_stats():
    """读取本地各赛季文件，统计棋子/羁绊数量，作为「已爬取数据」的一部分记录。"""
    stats = {}
    for slug in SETS:
        p = os.path.join(DATA, slug + '.json')
        if not os.path.exists(p):
            continue
        d = json.load(open(p, encoding='utf-8'))
        stats[slug] = {'name': d.get('name'), 'champions': len(d.get('champions', [])), 'traits': len(d.get('traits', []))}
    return stats


def archive_snapshot():
    """把当前 bundle 归档到 data/archive/YYYY-MM-DD_HH-MM.json，作为补丁对比的基准快照。
    首次运行会自动创建 data/archive 目录，后续每次 run 都会存档一份。"""
    src = os.path.join(ROOT, 'js', 'data.bundle.js')
    if not os.path.exists(src):
        print('archive: data.bundle.js 不存在，跳过归档')
        return None
    arc_dir = os.path.join(ROOT, 'data', 'archive')
    os.makedirs(arc_dir, exist_ok=True)
    stamp = time.strftime('%Y-%m-%d_%H-%M')
    out = os.path.join(arc_dir, f'snapshot_{stamp}.json')
    # 从 data.bundle.js 提取 window.TFT_DATA = {...}; 的 JSON
    with open(src, encoding='utf-8') as f:
        raw = f.read()
    marker = 'window.TFT_DATA = '
    i = raw.find(marker)
    if i < 0:
        print('archive: 找不到 marker，跳过')
        return None
    json_str = raw[i + len(marker):].rstrip().rstrip(';')
    bundle = json.loads(json_str)
    # 只存核心字段，过滤掉 itemsFull/augmentsFull（占空间大，diff 不需要）
    slim = {}
    for k in bundle:
        if k in ('itemsFull', 'augmentsFull'):
            continue
        slim[k] = bundle[k]
    slim['__archivedAt'] = stamp
    slim['__patch'] = (bundle.get('meta') or {}).get('updatedAt') or ''
    slim['__source'] = (bundle.get('source') or {}).get('fetchedAt') or ''
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(slim, f, ensure_ascii=False, separators=(',', ':'))
    print(f'archive: 已归档 {out} ({round(os.path.getsize(out)/1024)} KB)')
    # 保留最多 50 份
    files = sorted([os.path.join(arc_dir, f) for f in os.listdir(arc_dir) if f.endswith('.json')])
    if len(files) > 50:
        for old in files[:-50]:
            os.remove(old)
            print(f'archive: 清理旧快照 {os.path.basename(old)}')
    return out


def main():
    refresh = '--refresh' in sys.argv
    zh = fetch('zh_cn', refresh)
    en = fetch('en_us', refresh)
    print('官方数据版本 zh_cn / en_us 已就绪')
    augments, items, _ = build(zh, en, refresh)

    per_set_aug, per_set_item = {}, {}
    for a in augments:
        for s in a.get('sets', []):
            per_set_aug[s] = per_set_aug.get(s, 0) + 1
    for i in items:
        for s in i.get('sets', []):
            per_set_item[s] = per_set_item.get(s, 0) + 1

    source = {
        'source': 'Riot CommunityDragon（官方）',
        'sourceUrls': [f'{CDN}/zh_cn.json', f'{CDN}/en_us.json'],
        'fetchedAt': time.strftime('%Y-%m-%d %H:%M:%S'),
        'locale': 'zh_cn',
        'sets': list(SETS.keys()),
        'counts': {'augments': len(augments), 'items': len(items)},
        'perSet': {s: {'augments': per_set_aug.get(s, 0), 'items': per_set_item.get(s, 0)} for s in SETS},
        'seasons': season_stats(),
    }
    for name, obj in (('augments.full.json', augments), ('items.full.json', items), ('source.json', source)):
        p = os.path.join(DATA, name)
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, indent=1)
        print('已写入', p, '(', round(os.path.getsize(p) / 1024), 'KB )')

    localize_assets()
    rebuild_bundle(augments, items)
    archive_snapshot()


if __name__ == '__main__':
    main()
