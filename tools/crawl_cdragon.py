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
  python3 tools/crawl_cdragon.py              # 使用本地缓存（%TEMP%/cd）或自动下载后重建
  python3 tools/crawl_cdragon.py --refresh    # 强制重新下载官方数据
  python3 tools/crawl_cdragon.py --rebuild-sets   # 按官方数据强制重写全部 data/sN.json
  python3 tools/crawl_cdragon.py --no-archive     # 跳过补丁快照归档（CI 用）

新赛季：官方 setData 里出现编号更大的 SetN 时，脚本会自动生成 data/sN.json 并打进 bundle，
前端赛季下拉按 bundle 里实际存在的赛季自动生成，无需再改代码。
"""
import hashlib, json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
ASSETS = os.path.join(ROOT, 'assets', 'icons')
CACHE = os.environ.get('CD_CACHE') or os.path.join(os.environ.get('TEMP', os.path.expanduser('~')), 'cd')
CDN = 'https://raw.communitydragon.org/latest/cdragon/tft'
ICON_BASE = 'https://raw.communitydragon.org/latest/game/'

# 历史上已收录的官方集合名 -> 应用赛季 slug；除此之外，官方新增的 SetN（N 大于已知最大编号）
# 会在每次运行时自动发现并生成 data/sN.json，新赛季无需再改代码。
NAME_TO_SLUG = {
    'Galaxies': 's3', 'Set7': 's7', 'Set13': 's13', 'Set14': 's14',
    'Set15': 's15', 'Set16': 's16', 'Set17': 's17',
}
SETS = {}  # slug -> 官方集合名，运行时由 discover_sets() 填充
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
    supported = set(SETS.values())
    for d in zh.get('setData', []):
        nm = d.get('name')
        if nm in supported:
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


def discover_sets(zh):
    """从官方 setData 里发现可用集合：历史白名单 + 编号大于已知最大 Set 的新赛季。"""
    mapping = dict(NAME_TO_SLUG)
    known = set(NAME_TO_SLUG.values())
    max_known = max(int(re.match(r'^Set(\d+)$', nm).group(1)) for nm in NAME_TO_SLUG
                    if re.match(r'^Set(\d+)$', nm))
    names = sorted({d.get('name') for d in zh.get('setData', []) if d.get('name')})
    for nm in names:
        m = re.match(r'^Set(\d+)$', nm)
        if not m:
            continue
        slug = 's' + m.group(1)
        if int(m.group(1)) > max_known and slug not in known:
            mapping[nm] = slug
            print('  发现新赛季', nm, '->', slug)
    return mapping


def is_playable(c):
    """只保留可上场的棋子：费用 1~5 且至少一个羁绊（排除召唤物/野怪/锻造器/PVE/周年活动单位）。"""
    api = c.get('apiName') or ''
    if 'Event' in api or 'PVE' in api:
        return False
    try:
        cost = float(c.get('cost') or 0)
    except (TypeError, ValueError):
        cost = 0
    return bool(api) and 1 <= cost <= 5 and bool(c.get('traits'))


def season_payload(zh, set_name, slug):
    """把官方 setData 的棋子 / 羁绊转换成应用使用的 data/<slug>.json 结构。"""
    variants = [d for d in zh.get('setData', []) if d.get('name') == set_name]
    if not variants:
        return None
    trait_meta, champs = {}, {}
    for v in variants:
        for t in v.get('traits', []):
            api = t.get('apiName')
            if api:
                trait_meta.setdefault(api, t)
        for c in v.get('champions', []):
            api = c.get('apiName')
            if api and api not in champs:
                champs[api] = c
    trait_names = {api: (t.get('name') or api) for api, t in trait_meta.items()}

    out_champs = []
    for api, c in champs.items():
        if not is_playable(c):
            continue
        st, ab = c.get('stats') or {}, c.get('ability') or {}
        variables = {}
        for v in (ab.get('variables') or []):
            nm, val = v.get('name'), v.get('value')
            if nm and isinstance(val, list) and val:
                variables[nm] = val[1] if len(val) > 1 else val[0]
        out_champs.append({
            'id': api,
            'name': c.get('name') or api,
            'cost': int(float(c.get('cost') or 0)),
            'traits': [trait_names.get(t, t) for t in (c.get('traits') or [])],
            'hp': st.get('hp'), 'mana': st.get('mana'), 'initialMana': st.get('initialMana'),
            'armor': st.get('armor'), 'mr': st.get('magicResist'), 'ad': st.get('damage'),
            'as': st.get('attackSpeed'), 'range': st.get('range'),
            'role': c.get('role') or '',
            'ability': {'name': ab.get('name') or '', 'desc': resolve_desc(ab.get('desc'), variables)},
            'icon': icon_url(c.get('squareIcon') or c.get('icon')),
            'splash': icon_url(c.get('icon')),
        })
    out_champs.sort(key=lambda x: (-x['cost'], x['name']))

    out_traits = []
    seen_names = set()
    for api, t in trait_meta.items():
        nm = t.get('name') or api
        if nm in seen_names:
            continue  # 同一羁绊在不同官方变体里 api 不同，按中文名去重
        seen_names.add(nm)
        levels = []
        for e in (t.get('effects') or []):
            levels.append({'min': e.get('minUnits'), 'max': e.get('maxUnits'),
                           'style': e.get('style') or 1, 'vars': e.get('variables') or {}})
        out_traits.append({'name': t.get('name') or api, 'desc': resolve_desc(t.get('desc'), {}),
                           'icon': icon_url(t.get('icon')), 'levels': levels})
    out_traits.sort(key=lambda x: x['name'])

    return {'set': slug.upper(), 'name': set_name, 'champions': out_champs, 'traits': out_traits}


def write_season_files(zh, force=False):
    """为「本地还没有」的赛季生成 data/<slug>.json；已有文件默认不动，避免无意改动线上数据。
    --rebuild-sets 可强制按官方数据重写全部赛季文件。"""
    added = []
    for slug, nm in SETS.items():
        p = os.path.join(DATA, slug + '.json')
        if os.path.exists(p) and not force:
            continue
        payload = season_payload(zh, nm, slug)
        if not payload or not payload['champions']:
            print('  跳过（官方数据不足）:', slug, nm)
            continue
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=1)
        print('  已生成', slug, ':', len(payload['champions']), '棋子 /', len(payload['traits']), '羁绊')
        added.append(slug)
    return added


def localize_assets(augments=None, items=None):
    """把棋子 / 羁绊 / 装备 / 海克斯图标下载到本地 assets/icons/，让界面不依赖远程 CDN 也能显示图片。
    会就地改写 data/*.json 里的 icon 字段为本地相对路径（幂等：已是本地路径则跳过）。
    augments / items 为内存中的全量目录（会直接进入 bundle），也一并改写。"""
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
        it['iconBase'] = ''   # icon 已改写为本地相对路径，运行时不再拼接远程 base
        with open(ip, 'w', encoding='utf-8') as f:
            json.dump(it, f, ensure_ascii=False, indent=1)

    # 全量目录（augmentsFull / itemsFull 直接进入 bundle）的图标也本地化
    for e in augments or []:
        loc = register(e.get('icon'))
        if loc:
            e['icon'] = loc
    for e in items or []:
        loc = register(e.get('icon'))
        if loc:
            e['icon'] = loc

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
    force_sets = '--rebuild-sets' in sys.argv
    no_archive = '--no-archive' in sys.argv
    zh = fetch('zh_cn', refresh)
    en = fetch('en_us', refresh)
    print('官方数据版本 zh_cn / en_us 已就绪')

    global SETS
    mapping = discover_sets(zh)
    SETS = {slug: nm for nm, slug in mapping.items()}

    # 新赛季（官方新增、本地还没有 data/sN.json）自动生成，历史赛季默认不动
    write_season_files(zh, force=force_sets)
    # 新生成文件里的图标需要重新走一遍本地化，因此 SETS 需在 localize_assets 之前就绪

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
    localize_assets(augments, items)
    for name, obj in (('augments.full.json', augments), ('items.full.json', items), ('source.json', source)):
        p = os.path.join(DATA, name)
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, indent=1)
        print('已写入', p, '(', round(os.path.getsize(p) / 1024), 'KB )')

    rebuild_bundle(augments, items)
    if not no_archive:
        archive_snapshot()


if __name__ == '__main__':
    main()
