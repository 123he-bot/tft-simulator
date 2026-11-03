# -*- coding: utf-8 -*-
"""
crawl_comps.py —— 抓取 S18「阵容推荐」真实数据并生成 data/comps.json。

数据源：op.gg 中文站 Meta 阵容页（https://op.gg/zh-cn/tft/meta-trends/comps?version=18.5）
该页 RSC 内嵌全部 51 套 representative 阵容，包含真实对局统计
（平均名次 / 胜率 / 前四率 / 选取率 / 场次）、真实棋子星级与出装、真实站位。

产出：
  data/comps.json           # 按赛季分组的真实阵容榜（含装备图标目录）
  assets/icons/opgg_*.png   # 从 op.gg 下载的装备图标（本地化，避免外链失效）

用法： python tools/crawl_comps.py
"""
import json, os, re, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
ASSETS = os.path.join(ROOT, 'assets', 'icons')
PATCH = '18.5'
URL = 'https://op.gg/zh-cn/tft/meta-trends/comps?version=' + PATCH
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'}


def fetch(url):
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception as ex:
            last = ex
            time.sleep(2 + attempt * 2)
    raise last


def decode_rsc(html):
    out = []
    for m in re.finditer(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)', html):
        out.append(json.loads('"' + m.group(1) + '"'))
    return ''.join(out)


def brace_spans(text):
    """扫描 { } 配对，正确跳过字符串与转义字符。"""
    stack = []
    in_str = False
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        if in_str:
            if c == '\\':
                i += 2
                continue
            if c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == '{':
                stack.append(i)
            elif c == '}':
                if stack:
                    yield stack.pop(), i + 1
        i += 1


def parse_comps(text):
    comps, seen = [], set()
    for s, e in brace_spans(text):
        seg = text[s:e]
        if '"originHash"' not in seg or len(seg) > 120000:
            continue
        try:
            obj = json.loads(seg)
        except Exception:
            continue
        stat = obj.get('stat') or {}
        oh = stat.get('originHash')
        if not oh or oh in seen:
            continue
        seen.add(oh)
        comps.append(obj)
    return comps


def num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def load_json(name):
    with open(os.path.join(DATA, name), encoding='utf-8') as f:
        return json.load(f)


def need_style(trait_def, count):
    """按赛季真实羁绊阈值计算「还差几个」与激活档位。"""
    if not trait_def or not trait_def.get('levels'):
        return count, 0
    ups = sorted([l['min'] for l in trait_def['levels'] if l['min'] > count])
    need = ups[0] if ups else max(l['min'] for l in trait_def['levels'])
    style = 0
    for l in trait_def['levels']:
        if count >= l['min']:
            style = l.get('style') or 1
    return need, style


def auto_row(champ):
    role = (champ or {}).get('role') or ''
    rng = num((champ or {}).get('range'), 1)
    if 'Tank' in role:
        return 3
    return 2 if rng <= 2 else 1


def build_position(units, champ_by_name):
    """op.gg 的 cell：x=1..7 列、y=1..4 行（y=4 为前排）。缺失时按职业/射程补位。"""
    cols = [3, 4, 2, 5, 1, 6, 0, 3, 4, 2, 5, 1]
    used = {}
    out = []
    for u in units:
        cell = u.get('cell') or {}
        x, y = cell.get('x'), cell.get('y')
        if x and y:
            mr, col = int(y) - 1, int(x) - 1
            used.setdefault(mr, set()).add(col)
            out.append([mr, col, u['name']])
    for u in units:
        if any(p[2] == u['name'] for p in out):
            continue
        mr = auto_row(champ_by_name.get(u['name']))
        used.setdefault(mr, set())
        col = cols[len(out) % len(cols)]
        guard = 0
        while col in used[mr] and guard < 7:
            col = (col + 1) % 7
            guard += 1
        used[mr].add(col)
        out.append([mr, col, u['name']])
    return out


def main():
    print('下载', URL)
    html = fetch(URL)
    text = decode_rsc(html)
    comps = parse_comps(text)
    print('解析到阵容', len(comps))
    if not comps:
        raise SystemExit('未解析到任何阵容，页面结构可能已变化')

    season = load_json('s18.json')
    items_legacy = load_json('items.json')
    champ_by_id = {c['id']: c for c in season['champions']}
    champ_by_name = {c['name']: c for c in season['champions']}
    trait_def = {t['name']: t for t in season['traits']}

    def base_name(nm):
        return re.sub(r'\s*[（(][^）)]*[）)]\s*$', '', nm or '')

    def resolve_champ(api, meta_name):
        c = champ_by_id.get(api)
        if c:
            return c
        nm = base_name(meta_name)
        c = champ_by_name.get(nm)
        if c:
            return c
        for k, v in champ_by_name.items():
            if base_name(k) == nm:
                return v
        return None

    # 装备：统一用 op_<apiName> 作为站内 id，图标本地化
    item_catalog = {}
    for comp in comps:
        for u in comp.get('units') or []:
            for im in u.get('itemMetas') or []:
                if not im or not im.get('apiName'):
                    continue
                api = im['apiName']
                if api in item_catalog:
                    continue
                item_catalog[api] = {
                    'id': 'op_' + api,
                    'apiName': api,
                    'name': im.get('name') or api,
                    'icon': 'assets/icons/opgg_' + api + '.png',
                    'stat': '',
                    '_remote': im.get('imageUrl') or '',
                }

    missing_units = set()
    out_comps = []
    for comp in comps:
        stat = comp.get('stat') or {}
        deck = stat.get('deck') or {}
        units, pos_units = [], []
        for u in comp.get('units') or []:
            ch = resolve_champ(u.get('key'), (u.get('meta') or {}).get('name'))
            if not ch:
                missing_units.add(u.get('key'))
                continue
            item_ids = []
            for im in u.get('itemMetas') or []:
                api = (im or {}).get('apiName')
                if api and api in item_catalog:
                    item_ids.append('op_' + api)
            unit = {
                'name': ch['name'], 'id': ch['id'], 'cost': ch.get('cost') or 1,
                'star': int(num(u.get('tier'), 1)),
                'items': item_ids, 'core': bool(u.get('isCore')),
                'cell': u.get('cell'),
            }
            units.append(unit)
            pos_units.append({'name': ch['name'], 'cost': ch.get('cost') or 1, 'items': item_ids})

        traits = []
        for t in comp.get('traits') or []:
            name = (t.get('meta') or {}).get('name') or t.get('key') or ''
            active = int(num(t.get('numUnits'), 0))
            need, style = need_style(trait_def.get(name), active)
            if not style:
                style = int(num(t.get('style'), 0))
            traits.append({'name': name, 'active': active, 'need': need, 'style': style})

        core = [u for u in units if u['core']]
        comp_name = (comp.get('name') or {}).get('zh_CN') or (comp.get('name') or {}).get('en_US') or ''
        # 阵容名通常为「羁绊 主C」，以名末棋子作为主C；否则回到 isCore 首位
        name_tail = comp_name.split()[-1] if comp_name else ''
        main_unit = {}
        if name_tail and any(u['name'] == name_tail for u in units):
            main_unit = next(u for u in units if u['name'] == name_tail)
        elif core:
            main_unit = core[0]
        elif units:
            main_unit = units[0]
        mainC = main_unit.get('name') or ''

        # 主C / 主坦 / 副C / 补充
        tagged = []
        core_names = [u['name'] for u in core]
        non_core = [u for u in units if not u['core']]
        tank = None
        if non_core:
            tank = sorted(non_core, key=lambda u: -(
                (champ_by_name.get(u['name']) or {}).get('hp', 0) * 0.12 +
                (champ_by_name.get(u['name']) or {}).get('armor', 0) * 2.2 +
                (champ_by_name.get(u['name']) or {}).get('mr', 0) * 2.2))[0]
        for u in units:
            if u['name'] == mainC:
                tag = 'main'
            elif u['name'] in core_names:
                tag = 'sub'
            elif tank and u['name'] == tank['name']:
                tag = 'tank'
            else:
                tag = 'other'
            tagged.append((u, tag))

        position = build_position(pos_units, champ_by_name)
        tagged = [dict(u, **{'tag': tag}) for u, tag in tagged]
        core_units = [u for u in tagged if u['core']]
        if not core_units:
            core_units = [u for u in tagged if u['tag'] in ('main', 'sub', 'tank')][:3]
        core_units.sort(key=lambda u: ({'main': 0, 'sub': 1, 'tank': 2}.get(u['tag'], 3), -(u['cost'] or 1)))
        item_name = {v['id']: v['name'] for v in item_catalog.values()}
        active_names = [t['name'] for t in sorted(
            [x for x in traits if x['style'] >= 1], key=lambda x: -x['active'])][:3]
        main_items = '、'.join(item_name.get(i, i) for i in main_unit.get('items') or [])
        pop = len(tagged)
        desc = (f'围绕 {"、".join(active_names) if active_names else "当前羁绊组合"} 展开，主C {mainC}'
                f'（{main_unit.get("cost") or 1} 费 / {main_unit.get("star") or 1} 星'
                f'{("，出装 " + main_items) if main_items else ""}）。核心棋子：'
                f'{"、".join(u["name"] for u in core_units)}。{pop} 人口成型，OP.GG 采样 '
                f'{int(num(deck.get("compsCount"), 0))} 场：平均名次 {round(num(deck.get("avgPlacement")), 2)}'
                f'、胜率 {round(num(deck.get("winRate")) * 100, 1)}%、前四率 '
                f'{round(num(deck.get("top4Rate")) * 100, 1)}%。')
        out_comps.append({
            'id': 'og_' + stat['originHash'],
            'name': (comp.get('name') or {}).get('zh_CN') or (comp.get('name') or {}).get('en_US') or '未命名阵容',
            'mainC': mainC,
            'tier': stat.get('opTier') or 'C',
            'strength': round(num(deck.get('avgPlacement'), 99), 2),
            'avgPlace': round(num(deck.get('avgPlacement')), 2),
            'winRate': round(num(deck.get('winRate')), 4),
            'top4Rate': round(num(deck.get('top4Rate')), 4),
            'pickRate': round(num(deck.get('pickRate')), 6),
            'games': int(num(deck.get('compsCount'), 0)),
            'opScore': round(num(stat.get('opScore')), 2),
            'units': tagged,
            'coreUnits': core_units,
            'description': desc,
            'descriptionSource': '基于 OP.GG 真实阵容字段自动生成',
            'traits': traits,
            'positionMap': position,
            'positioning': 'OP.GG 实战站位（按真实对局采样）',
            'counters': {'克制': [], '被克制': []},
            'source': 'OP.GG 实时数据',
            'sourceReal': True,
            'teamCode': comp.get('teamCode') or '',
        })

    out_comps.sort(key=lambda c: (c['avgPlace'], c['name']))
    print('映射成功阵容', len(out_comps), '未解析单位', missing_units or '无')

    # 下载装备图标
    os.makedirs(ASSETS, exist_ok=True)

    def one(pair):
        api, it = pair
        dst = os.path.join(ASSETS, 'opgg_' + api + '.png')
        url = it.pop('_remote', '')
        if os.path.exists(dst) and os.path.getsize(dst) > 200:
            return 'skip'
        if not url:
            return 'no-url'
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers=UA)
                with urllib.request.urlopen(req, timeout=60) as r, open(dst, 'wb') as f:
                    f.write(r.read())
                if os.path.getsize(dst) > 200:
                    return 'ok'
            except Exception:
                time.sleep(1 + attempt)
        if os.path.exists(dst) and os.path.getsize(dst) == 0:
            os.remove(dst)
        return 'fail'

    jobs = list(item_catalog.items())
    stats = {}
    with ThreadPoolExecutor(max_workers=10) as ex:
        for r in ex.map(one, jobs):
            stats[r] = stats.get(r, 0) + 1
    print('装备图标本地化', stats)

    catalog = sorted(item_catalog.values(), key=lambda x: x['name'])
    fetched_at = time.strftime('%Y-%m-%d %H:%M:%S')

    payload = {
        'source': 'OP.GG 实时阵容榜（中文站）',
        'sourceUrl': URL,
        'fetchedAt': fetched_at,
        'patch': PATCH,
        'note': '阵容、出装、站位与胜率类统计均来自 OP.GG 实时对局采样；本站未做任何推断或补全。',
        'itemCatalog': catalog,
        's18': {
            'set': 'S18',
            'patch': PATCH,
            'source': 'OP.GG 实时阵容榜（中文站）',
            'sourceUrl': URL,
            'updatedAt': PATCH,
            'fetchedAt': fetched_at,
            'note': '51 套 representative 阵容，统计口径为 OP.GG 对局样本；补丁 %s。' % PATCH,
            'comps': out_comps,
        },
    }
    with open(os.path.join(DATA, 'comps.json'), 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print('已写入 data/comps.json：%d 套阵容 / %d 件装备' % (len(out_comps), len(catalog)))


if __name__ == '__main__':
    main()
