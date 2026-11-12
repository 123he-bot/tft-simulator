# -*- coding: utf-8 -*-
"""
crawl_set18.py —— 抓取 Set18「自然之力 / Enchanted Wilds」数据并生成 data/s18.json。

官方 CDragon 的 cdragon/tft/*.json 目前仍止于 Set17（Set18 处于新引擎分支，尚未进入该 JSON），
因此本脚本改从 op.gg 的中文站抓取其内嵌的 RSC 数据（来源为 Riot 游戏文件），
棋子中文名、羁绊中文名与说明、费用、基础数值、攻击距离均为真实数据；
技能文本 op.gg 中文站仍为英文原文，按项目约定标注「未汉化」而不做臆造翻译。

产出：
  data/s18.json             # 与应用其它赛季同结构的赛季数据
  data/source_set18.json    # 抓取溯源信息（来源 URL / 时间 / 条目数）

用法： python tools/crawl_set18.py
"""
import hashlib, json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
ASSETS = os.path.join(ROOT, 'assets', 'icons')
CACHE = os.path.join(ROOT, '.cache')
URL = 'https://op.gg/zh-cn/tft/meta-trends/champion?version=18.5'
AUG_URL = 'https://op.gg/zh-cn/tft/meta-trends/augments'
ITEM_URL = 'https://op.gg/zh-cn/tft/meta-trends/item'
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'}
RARITY_CN = {'silver': '银', 'gold': '金', 'prismatic': '棱彩'}
CAT_MAP = {'core': 'completed', 'radiant': 'radiant', 'artifact': 'artifact',
           'emblem': 'emblem', 'component': 'component', 'support': 'support'}


def fetch(url):
    """抓取页面；失败重试 3 次，仍失败则回退到本地缓存（保证 CI 网络抖动时可用）。"""
    os.makedirs(CACHE, exist_ok=True)
    cache = os.path.join(CACHE, hashlib.md5(url.encode()).hexdigest() + '.html')
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:
                text = r.read().decode('utf-8', 'replace')
            with open(cache, 'w', encoding='utf-8') as f:
                f.write(text)
            return text
        except Exception as e:
            last = e
            print('下载失败(%d/3)：%s' % (attempt + 1, str(e)[:120]))
            time.sleep(2 + attempt * 2)
    if os.path.exists(cache):
        print('使用本地缓存：', cache)
        return open(cache, encoding='utf-8').read()
    raise last


def decode_rsc(html):
    """把 Next.js 的 self.__next_f.push([1,"..."]) 流拼成一段可读文本。"""
    out = []
    for m in re.finditer(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)', html):
        out.append(json.loads('"' + m.group(1) + '"'))
    return ''.join(out)


def enclosing_object(text, pos):
    """从 pos 向左定位最小外层 JSON 对象起点，再向右配对到终点；失败返回 None。"""
    depth = 0
    i = pos
    while i > 0:
        ch = text[i]
        if ch == '}':
            depth += 1
        elif ch == '{':
            if depth == 0:
                break
            depth -= 1
        i -= 1
    if text[i] != '{':
        return None
    depth, j = 0, i
    while j < len(text):
        ch = text[j]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                break
        j += 1
    return text[i:j + 1]


def collect(text, key):
    """收集所有含指定 apiName 字段的对象，按 apiName 去重。"""
    found = {}
    for m in re.finditer(r'"apiName":"(DA_[^"]+)"', text):
        raw = enclosing_object(text, m.start())
        if not raw:
            continue
        try:
            obj = json.loads(raw)
        except Exception:
            continue
        api = obj.get('apiName') or m.group(1)
        if key not in obj:
            continue
        if api not in found or len(raw) > len(json.dumps(found[api], ensure_ascii=False)):
            found[api] = obj
    return found


def total_counts(text):
    d = {}
    for m in re.finditer(r'"characterId":"(DA_[^"]+)","totalCount":(\d+)', text):
        d[m.group(1)] = max(d.get(m.group(1), 0), int(m.group(2)))
    return d


def num(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def plain(text):
    """去掉 op.gg 的 %i:xxx% 占位符与空括号，与其它赛季文本风格保持一致。"""
    t = re.sub(r'<br\s*/?>', '\n', text or '')
    t = re.sub(r'%i:[^%]*%', '', t)
    t = re.sub(r'\(\s*\)', '', t)
    return t.strip()


def preserve_previous(payload):
    """若本次解析出的羁绊为空（上游页面结构偶发变化），保留上次的羁绊与棋子关联，避免数据退化。"""
    p = os.path.join(DATA, 's18.json')
    if not os.path.exists(p):
        return payload
    try:
        old = json.load(open(p, encoding='utf-8'))
    except Exception:
        return payload
    old_traits = old.get('traits') or []
    if payload.get('traits') or not old_traits:
        return payload
    print('警告：本次未解析到羁绊，保留上次 %d 条羁绊与棋子关联' % len(old_traits))
    payload['traits'] = old_traits
    old_champ_traits = {(c.get('id') or c.get('name')): c.get('traits') for c in old.get('champions') or []}
    for c in payload.get('champions') or []:
        if not c.get('traits'):
            c['traits'] = old_champ_traits.get(c.get('id') or c.get('name')) or []
    return payload


def build():
    print('下载', URL)
    html = fetch(URL)
    text = decode_rsc(html)
    champs = collect(text, 'cost')
    traits = collect(text, 'effects')
    counts = total_counts(text)
    print('解析到棋子', len(champs), '/ 羁绊', len(traits), '/ 对局样本', len(counts))

    trait_zh = {api: (t.get('name') or api) for api, t in traits.items()}
    trait_order = {api: i for i, api in enumerate(traits)}

    def playable(c):
        """S18 的峡谷野怪同样是可上场单位（有费用/羁绊），因此全部保留。"""
        return bool(c.get('name') and c.get('traits'))

    def base_name(nm):
        return re.sub(r'\s*[\(（][^\)）]*[\)）]\s*$', '', nm)

    # 同名多形态（如拉克丝随羁绊切换、魔战士 AD/AP 双形态）只保留一版：
    # 基础形态（apiName 含 _Base）优先，否则取对局样本最多的一版
    best = {}
    for api, c in champs.items():
        if not c.get('name') or not c.get('traits') or not playable(c):
            continue
        nm = base_name(c['name'])
        cur = best.get(nm)
        if cur is None:
            best[nm] = api
            continue
        cur_base = '_Base' in cur or 'Base' in cur
        new_base = 'Base' in api
        if new_base and not cur_base:
            best[nm] = api
        elif not cur_base and not new_base and counts.get(api, 0) > counts.get(cur, 0):
            best[nm] = api

    out_champs = []
    used_traits = set()
    for nm, api in best.items():
        c = champs[api]
        st = c.get('stats') or {}
        ab = c.get('ability') or {}
        tlist = []
        for t in (c.get('traits') or []):
            a = t.get('apiName')
            used_traits.add(a)
            tlist.append(trait_zh.get(a) or t.get('name') or a)
        out_champs.append({
            'id': api,
            'name': nm,
            'cost': int(num(c.get('cost'), 0)),
            'traits': tlist,
            'hp': num(st.get('hp')), 'mana': num(st.get('mana')),
            'initialMana': num(st.get('initialMana')) or 0,
            'armor': num(st.get('armor')), 'mr': num(st.get('magicResist')),
            'ad': num(st.get('damage')), 'as': num(st.get('attackSpeed')),
            'range': num(st.get('range')),
            'role': c.get('role') or '',
            'ability': {
                'name': ab.get('name') or '',
                'desc': plain(ab.get('desc')),
                'lang': 'en',
            },
            'icon': c.get('tileIcon') or c.get('squareIcon') or c.get('icon') or '',
            'splash': c.get('imageUrl') or '',
        })
    out_champs.sort(key=lambda x: (-x['cost'], x['name']))

    out_traits = []
    for api, t in sorted(traits.items(), key=lambda kv: kv[1].get('name') or ''):
        if api not in used_traits:
            continue
        levels = []
        for e in (t.get('effects') or []):
            mx = e.get('maxUnits')
            if mx and mx >= 25000:
                mx = None
            levels.append({'min': e.get('minUnits'), 'max': mx,
                           'style': e.get('style') or 1, 'vars': e.get('variables') or {}})
        if not levels:
            continue
        out_traits.append({
            'name': t.get('name') or api,
            'desc': plain(t.get('desc')),
            'icon': t.get('icon') or t.get('imageUrl') or '',
            'levels': levels,
        })

    payload = preserve_previous({'set': 'S18', 'name': '自然之力', 'champions': out_champs, 'traits': out_traits})
    src = {
        'generatedAt': time.strftime('%Y-%m-%d %H:%M:%S'),
        'sources': [{'url': URL, 'note': 'op.gg 中文站内嵌 RSC 数据（原始来源为 Riot 游戏文件）'}],
        'champions': len(out_champs), 'traits': len(out_traits),
        'caveats': [
            '官方 CommunityDragon cdragon/tft JSON 目前仍止于 Set17，Set18 由第三方站点取得',
            '技能文本为英文原文，未作机器翻译，界面标注「技能文本为英文原文」',
            '同名多形态棋子（拉克丝、魔战士双形态）仅保留对局样本最多的一版',
        ],
    }
    with open(os.path.join(DATA, 's18.json'), 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    with open(os.path.join(DATA, 'source_set18.json'), 'w', encoding='utf-8') as f:
        json.dump(src, f, ensure_ascii=False, indent=1)
    print('已写入 data/s18.json：%d 棋子 / %d 羁绊' % (len(out_champs), len(out_traits)))
    return payload


def match_object(text, start):
    """从 start 处的 { 向右配对，返回完整 JSON 对象文本；失败返回 None。"""
    depth, i, in_str, esc = 0, start, False, False
    while i < len(text):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    return text[start:i + 1]
        i += 1
    return None


def rsc_payload(url, marker):
    """抓取 op.gg 页面并解析 marker 对应的 RSC data 对象。"""
    print('下载', url)
    text = decode_rsc(fetch(url))
    i = text.find(marker)
    raw = match_object(text, i) if i >= 0 else None
    if not raw:
        raise RuntimeError('未能从 %s 解析 %s' % (url, marker))
    return json.loads(raw)


def build_catalog(s18_payload):
    """抓取 S18 强化符文目录 / 专家评级、装备目录 / 真实对局统计。

    数据均在 op.gg 页面内嵌 RSC 中，原始来源为 Riot 游戏文件；
    只搬运页面已给出的字段，不做任何推断补全。
    """
    aug = rsc_payload(AUG_URL, '{"tab":"augments"')
    item = rsc_payload(ITEM_URL, '{"tab":"item"')

    # ---- 强化符文：目录（中文名 / 描述 / 稀有度）+ 专家评级 ----
    tier_map = {x.get('key'): x.get('opTier') for x in (aug.get('augments') or [])}
    src_ver = next(iter({x.get('sourceVersion') for x in (aug.get('augments') or []) if x.get('sourceVersion')}), '')
    augs = []
    for e in (aug.get('metadata') or {}).get('augments') or []:
        rid = e.get('apiName') or e.get('key')
        if not rid:
            continue
        rarity = e.get('tier') or ''
        augs.append({
            'id': rid,
            'name': e.get('name') or rid,
            'rarityKey': rarity,
            'tier': RARITY_CN.get(rarity, '特殊'),
            'opTier': tier_map.get(e.get('key')) or None,
            'desc': plain(e.get('description'))[:400],
            'icon': e.get('imageUrl') or '',
        })
    rated = sum(1 for x in augs if x['opTier'])
    print('S18 强化符文：%d 条（含专家评级 %d 条，评级源版本 %s）' % (len(augs), rated, src_ver or '—'))

    # ---- 装备：目录 + 真实统计（出场 / 前四 / 登顶 / 均名 / 携带者） ----
    md = item.get('metadata') or {}
    name_by_key = {(e.get('key') or e.get('apiName')): (e.get('name') or e.get('key'))
                   for e in (md.get('items') or [])}
    cat = []
    for e in (md.get('items') or []):
        kid = e.get('key') or e.get('apiName')
        if not kid:
            continue
        comp = [c for c in (e.get('compositions') or []) if c]
        cat.append({
            'id': kid,
            'name': e.get('name') or kid,
            'category': CAT_MAP.get(e.get('category'), e.get('category') or 'misc'),
            'recipe': comp,
            'recipeNames': [(name_by_key.get(c) or c) for c in comp],
            'desc': plain(e.get('description'))[:300],
            'stat': plain(e.get('statDescription'))[:200],
            'icon': e.get('imageUrl') or '',
        })
    cat_by_id = {x['id']: x for x in cat}

    champ_meta = md.get('champions') or []
    champ_names = {(c.get('key') or c.get('apiName')): (c.get('name') or c.get('key')) for c in champ_meta}
    local_champ = {(c.get('id') or ''): (c.get('icon') or '') for c in (s18_payload or {}).get('champions') or []}
    local_trait = {(t.get('name') or ''): (t.get('icon') or '') for t in (s18_payload or {}).get('traits') or []}
    champions = []
    for c in champ_meta:
        cid = c.get('key') or c.get('apiName')
        if not cid:
            continue
        champions.append({
            'id': cid, 'name': c.get('name') or cid,
            'cost': int(num(c.get('cost'), 0) or 0),
            'icon': local_champ.get(cid) or c.get('tileImageUrl') or c.get('imageUrl') or '',
        })
    traits = []
    for t in (md.get('traits') or []):
        tid = t.get('key') or t.get('apiName')
        nm = t.get('name') or tid
        if not nm:
            continue
        traits.append({'id': tid, 'name': nm, 'icon': local_trait.get(nm) or t.get('imageUrl') or ''})

    stats, unresolved = [], 0
    for e in (item.get('items') or []):
        kid = e.get('itemId') or e.get('key')
        if kid not in cat_by_id:
            unresolved += 1
            continue
        wearers = []
        for w in sorted(e.get('champions') or [], key=lambda x: -(x.get('totalCount') or 0))[:8]:
            wid = w.get('characterId') or w.get('key')
            wearers.append({
                'id': wid,
                'name': champ_names.get(wid) or wid,
                'total': w.get('totalCount') or 0,
                'avgPlace': w.get('avgPlacement'),
                'top4Rate': w.get('top4Rate'),
            })
        stats.append({
            'id': kid,
            'total': e.get('totalCount') or 0,
            'win': e.get('winCount') or 0,
            'top4': e.get('top4Count') or 0,
            'avgPlace': e.get('avgPlacement'),
            'winRate': e.get('winRate'),
            'top4Rate': e.get('top4Rate'),
            'wearers': wearers,
        })
    print('S18 装备：目录 %d 件 / 有统计 %d 件 / 未匹配 %d 件' % (len(cat), len(stats), unresolved))

    ctx = item.get('context') or {}
    return {
        'set': 'S18',
        'source': 'OP.GG 中文站',
        'sourceUrl': ITEM_URL,
        'sourceUrls': [AUG_URL, ITEM_URL],
        'fetchedAt': time.strftime('%Y-%m-%d %H:%M:%S'),
        'patch': ctx.get('version') or '',
        'region': ctx.get('region') or '',
        'tierScope': ctx.get('tier') or '',
        'augments': {'tierSourceVersion': src_ver, 'items': augs},
        'items': {'catalog': cat, 'stats': stats, 'unresolved': unresolved},
        'champions': champions,
        'traits': traits,
    }


def localize_catalog(cat):
    """把 S18 符文 / 装备图标下载到本地，保证离线可用；已存在的文件跳过。"""
    os.makedirs(ASSETS, exist_ok=True)
    jobs, seen = [], {}
    # 磁盘上已有图标：小写名 -> 实际文件名，复用其大小写，避免产生大小写重复文件
    existing = {n.lower(): n for n in os.listdir(ASSETS)}

    def register(url):
        if not url or not str(url).startswith('http'):
            return None
        base = url.split('?')[0].rsplit('/', 1)[-1]
        if not base:
            return None
        base = existing.get(base.lower(), base)
        if base in seen and seen[base] != url:
            base = hashlib.md5(url.encode()).hexdigest()[:8] + '_' + base
        seen[base] = url
        jobs.append((url, base))
        return 'assets/icons/' + base

    for e in cat['augments']['items'] + cat['items']['catalog']:
        loc = register(e.get('icon'))
        if loc:
            e['icon'] = loc
    for e in cat['traits'] + cat['champions']:
        loc = register(e.get('icon'))
        if loc:
            e['icon'] = loc

    uniq = {u: fn for u, fn in jobs}

    def one(job):
        url, fn = job
        dst = os.path.join(ASSETS, fn)
        if os.path.exists(dst) and os.path.getsize(dst) > 100:
            return 'skip'
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as r, open(dst, 'wb') as f:
                f.write(r.read())
            return 'ok' if os.path.getsize(dst) > 100 else 'empty'
        except Exception:
            return 'fail'

    stats = {}
    with ThreadPoolExecutor(max_workers=16) as ex:
        for r in ex.map(one, uniq.items()):
            stats[r] = stats.get(r, 0) + 1
    print('S18 符文/装备图标本地化：', stats, '去重图标', len(uniq))

    # 下载失败的图标回退到远程地址，避免出现破图
    remote = {'assets/icons/' + fn: url for url, fn in uniq.items()}
    for group in (cat['augments']['items'], cat['items']['catalog'], cat['traits'], cat['champions']):
        for e in group:
            loc = e.get('icon') or ''
            if loc in remote:
                dst = os.path.join(ROOT, loc.replace('/', os.sep))
                if not os.path.exists(dst) or os.path.getsize(dst) <= 100:
                    e['icon'] = remote[loc]


def merge_full_catalogs(cat):
    """把 S18 符文 / 装备并入全量目录（sets=['s18']），供搜索与素材库直接使用。"""
    ap = os.path.join(DATA, 'augments.full.json')
    old = json.load(open(ap, encoding='utf-8')) if os.path.exists(ap) else []
    old = [x for x in old if 's18' not in (x.get('sets') or [])]
    for a in cat['augments']['items']:
        old.append({
            'id': a['id'], 'name': a['name'], 'en': None,
            'tier': a['tier'], 'rarityKey': a['rarityKey'], 'desc': a['desc'],
            'effects': {}, 'traits': [], 'icon': a['icon'], 'sets': ['s18'],
        })
    with open(ap, 'w', encoding='utf-8') as f:
        json.dump(old, f, ensure_ascii=False, indent=1)
    print('augments.full.json 已并入 S18：', len(cat['augments']['items']), '条，总计', len(old))

    ip = os.path.join(DATA, 'items.full.json')
    old = json.load(open(ip, encoding='utf-8')) if os.path.exists(ip) else []
    old = [x for x in old if 's18' not in (x.get('sets') or [])]
    for it in cat['items']['catalog']:
        old.append({
            'id': it['id'], 'name': it['name'], 'en': None, 'category': it['category'],
            'composition': it['recipe'], 'compositionNames': it['recipeNames'],
            'desc': it['desc'], 'icon': it['icon'], 'sets': ['s18'],
        })
    with open(ip, 'w', encoding='utf-8') as f:
        json.dump(old, f, ensure_ascii=False, indent=1)
    print('items.full.json 已并入 S18：', len(cat['items']['catalog']), '件，总计', len(old))


def update_source(cat):
    """把 S18 计数与来源写回 source.json，首页口径说明与数据页共用。"""
    p = os.path.join(DATA, 'source.json')
    src = json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}
    sets = src.get('sets') or []
    if 's18' not in sets:
        sets.append('s18')
    src['sets'] = sets
    per = src.get('perSet') or {}
    per['s18'] = {'augments': len(cat['augments']['items']), 'items': len(cat['items']['catalog'])}
    src['perSet'] = per
    extra = src.get('extraSource') or {}
    extra['S18'] = {
        'source': 'OP.GG 中文站（页面内嵌 RSC，原始来源为 Riot 游戏文件）',
        'url': ITEM_URL,
        'fetchedAt': cat['fetchedAt'],
        'augments': len(cat['augments']['items']),
        'items': len(cat['items']['catalog']),
        'note': 'S18 尚未进入 CommunityDragon cdragon/tft JSON；符文专家评级源版本 ' + (cat['augments'].get('tierSourceVersion') or '—'),
    }
    src['extraSource'] = extra
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(src, f, ensure_ascii=False, indent=1)


def rebuild_bundle():
    """用本地 data/*.json 重建 js/data.bundle.js（不重新抓取 CDragon）。"""
    import importlib.util
    spec = importlib.util.spec_from_file_location('crawl_cdragon', os.path.join(ROOT, 'tools', 'crawl_cdragon.py'))
    cc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cc)
    aug = json.load(open(os.path.join(DATA, 'augments.full.json'), encoding='utf-8'))
    items = json.load(open(os.path.join(DATA, 'items.full.json'), encoding='utf-8'))
    cc.rebuild_bundle(aug, items)


def localize(payload):
    """把 op.gg 图标下载到 assets/icons/，并把 JSON 内链接改写为本地路径。"""
    os.makedirs(ASSETS, exist_ok=True)
    jobs, seen = [], {}
    # 磁盘上已有图标：小写名 -> 实际文件名，复用其大小写，避免产生大小写重复文件
    existing = {n.lower(): n for n in os.listdir(ASSETS)}

    def register(url):
        if not url or not str(url).startswith('http'):
            return None
        base = url.split('?')[0].rsplit('/', 1)[-1]
        if not base:
            return None
        base = existing.get(base.lower(), base)
        if base in seen and seen[base] != url:
            base = str(abs(hash(url)) % 0xfffffff) + '_' + base
        seen[base] = url
        jobs.append((url, base))
        return 'assets/icons/' + base

    for group in ('champions', 'traits'):
        for it in payload[group]:
            loc = register(it.get('icon'))
            if loc:
                it['icon'] = loc
    for it in payload['champions']:
        sp = it.get('splash')
        it['splash'] = sp if sp and sp.startswith('http') else it.get('splash')

    def one(job):
        url, name = job
        dst = os.path.join(ASSETS, name)
        if os.path.exists(dst) and os.path.getsize(dst) > 200:
            return 'skip'
        last = 'fail'
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers=UA)
                with urllib.request.urlopen(req, timeout=60) as r, open(dst, 'wb') as f:
                    f.write(r.read())
                if os.path.getsize(dst) > 200:
                    return 'ok'
                last = 'fail:' + name
            except Exception:
                last = 'fail:' + name
            time.sleep(1 + attempt)
        if os.path.exists(dst) and os.path.getsize(dst) == 0:
            os.remove(dst)
        return last

    stats = {}
    with ThreadPoolExecutor(max_workers=12) as ex:
        for r in ex.map(one, jobs):
            k = r.split(':')[0]
            stats[k] = stats.get(k, 0) + 1
            if k == 'fail':
                print('  下载失败', r)
    print('图标本地化：', stats)
    with open(os.path.join(DATA, 's18.json'), 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    # --stats-only：只刷新强化符文 / 装备统计（专家评级），目录与 bundle 交给官方抓取步骤重建（CI 每日任务用）
    # --catalog-only：只刷新强化符文 / 装备目录与统计，不重抓棋子羁绊
    stats_only = '--stats-only' in sys.argv
    if '--catalog-only' in sys.argv or stats_only:
        p = json.load(open(os.path.join(DATA, 's18.json'), encoding='utf-8'))
        print('仅刷新 S18 强化符文 / 装备统计' if stats_only else '仅刷新 S18 强化符文 / 装备目录')
    else:
        p = build()
        localize(p)
    cat = build_catalog(p)
    localize_catalog(cat)
    with open(os.path.join(DATA, 's18_stats.json'), 'w', encoding='utf-8') as f:
        json.dump(cat, f, ensure_ascii=False, indent=1)
    print('已写入 data/s18_stats.json')
    if stats_only:
        print('完成：data/s18_stats.json 已更新（目录与 bundle 由官方抓取步骤重建）')
    else:
        merge_full_catalogs(cat)
        update_source(cat)
        rebuild_bundle()
        print('完成：data/s18_stats.json 与 js/data.bundle.js 已更新')
