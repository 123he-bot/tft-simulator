# -*- coding: utf-8 -*-
"""
crawl_comps.py —— 抓取 S18「阵容推荐」真实数据并生成 data/comps.json。

数据源：op.gg 中文站 Meta 阵容页（https://op.gg/zh-cn/tft/meta-trends/comps?version=18.5）
该页 RSC 内嵌全部 representative 阵容，包含真实对局统计
（平均名次 / 登顶率 / 前四率 / 出场率 / 场次）、真实棋子星级与出装、真实站位。

段位口径：OP.GG 的 tier 参数分别对应「全段位 / 铂金 / 翡翠 / 钻石 / 大师 / 大师+」，
每个档位是独立对局样本（近 24 小时），阵容集合与统计各不相同，因此逐档抓取并存为快照。

产出：
  data/comps.json           # 按赛季分组的真实阵容榜（含段位快照与装备图标目录）
  assets/icons/opgg_*.png   # 从 op.gg 下载的装备图标（本地化，避免外链失效）

用法： python tools/crawl_comps.py
"""
import json, os, re, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
ASSETS = os.path.join(ROOT, 'assets', 'icons')
PATCH = '18.5'
BASE_URL = 'https://op.gg/zh-cn/tft/meta-trends/comps?version=' + PATCH
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'}

# (接口参数, 展示名) —— 宗师/王者近 24 小时样本不足，OP.GG 返回空榜，故不纳入
TIERS = [
    ('all', '全段位'),
    ('platinum', '铂金'),
    ('emerald', '翡翠'),
    ('diamond', '钻石'),
    ('master', '大师'),
    ('master+', '大师+'),
]


def tier_url(tier):
    q = 'master%2B' if tier == 'master+' else tier
    return BASE_URL + '&tier=' + q


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


def badge_map(comp):
    """OP.GG 的玩法标签：difficulty / tempo / reroll / honey / ppm。"""
    out = {}
    for b in comp.get('badge') or []:
        k = (b or {}).get('key')
        if k:
            out[k] = b.get('value')
    return out


def snapshot_entry(comp):
    stat = comp.get('stat') or {}
    deck = stat.get('deck') or {}
    return {
        'avgPlace': round(num(deck.get('avgPlacement')), 2),
        'winRate': round(num(deck.get('winRate')), 4),
        'top4Rate': round(num(deck.get('top4Rate')), 4),
        'pickRate': round(num(deck.get('pickRate')), 6),
        'games': int(num(deck.get('compsCount'), 0)),
        'opScore': round(num(stat.get('opScore')), 2),
        'tier': stat.get('opTier') or 'C',
        'badge': badge_map(comp),
    }


def main():
    pages = {}
    for key, label in TIERS:
        url = tier_url(key)
        print('下载', label, url)
        html = fetch(url)
        comps = parse_comps(decode_rsc(html))
        print('  %s 解析到 %d 套' % (label, len(comps)))
        pages[key] = comps
    if not pages.get('all'):
        raise SystemExit('未解析到任何阵容，页面结构可能已变化')

    # 去重合并：先 all 的顺序，再补各档位独有阵容
    pool, order = {}, []
    for key, _label in TIERS:
        for comp in pages[key]:
            oh = (comp.get('stat') or {}).get('originHash')
            if not oh or oh in pool:
                continue
            pool[oh] = comp
            order.append(oh)

    snapshots = {}
    for key, label in TIERS:
        entries = {}
        for comp in pages[key]:
            oh = (comp.get('stat') or {}).get('originHash')
            if oh:
                entries['og_' + oh] = snapshot_entry(comp)
        snapshots[key] = {
            'label': label,
            'url': tier_url(key),
            'count': len(entries),
            'entries': entries,
        }
    print('合并后阵容', len(order))

    season = load_json('s18.json')
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
    for oh in order:
        comp = pool[oh]
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
                    # OP.GG 的神器 apiName 形如 DA_Artifact_Dawncore，据此与成装区分
                    'artifact': 'Artifact' in api,
                    '_remote': im.get('imageUrl') or '',
                }

    missing_units = set()
    out_comps = []
    for oh in order:
        comp = pool[oh]
        cid = 'og_' + oh
        primary = snapshots['all']['entries'].get(cid)
        if not primary:
            for key, _label in TIERS:
                primary = snapshots[key]['entries'].get(cid)
                if primary:
                    break
        if not primary:
            continue
        badge = {}
        for key, _label in TIERS:
            b = snapshots[key]['entries'].get(cid, {}).get('badge') or {}
            if b:
                badge = b
                break

        units, pos_units = [], []
        name_alias = {}
        for u in comp.get('units') or []:
            ch = resolve_champ(u.get('key'), (u.get('meta') or {}).get('name'))
            if not ch:
                missing_units.add(u.get('key'))
                continue
            raw_name = (u.get('meta') or {}).get('name') or ''
            if raw_name and raw_name != ch['name']:
                name_alias[raw_name] = ch['name']
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
            # OP.GG 会把「日蚀骑士 + 月蚀骑士」合并成聚合羁绊（如「日月双蚀」），
            # 这类不在站内真实羁绊表里的名字会让图标/阈值查询落空，直接跳过。
            if name not in trait_def:
                print('skip unknown trait:', name)
                continue
            active = int(num(t.get('numUnits'), 0))
            need, style = need_style(trait_def.get(name), active)
            if not style:
                style = int(num(t.get('style'), 0))
            traits.append({'name': name, 'active': active, 'need': need, 'style': style})

        core = [u for u in units if u['core']]
        comp_name = (comp.get('name') or {}).get('zh_CN') or (comp.get('name') or {}).get('en_US') or ''
        # OP.GG 阵容名常带英文野怪名（Sentinel / Krug 等），按站内官方目录统一替换为中文
        for raw, zh in sorted(name_alias.items(), key=lambda x: -len(x[0])):
            comp_name = re.sub(r'(?<![A-Za-z])' + re.escape(raw) + r'(?![A-Za-z])', zh, comp_name)
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

        # 费用分布（真实棋子费用统计）
        cost_curve = {}
        for u in tagged:
            c = int(u.get('cost') or 1)
            cost_curve[str(c)] = cost_curve.get(str(c), 0) + 1
        # 升级节奏：OP.GG 的 early/middle level + reroll 刷新等级
        early = comp.get('early') or {}
        middle = comp.get('middle') or {}
        leveling = {
            'early': int(num(early.get('level'), 0)),
            'mid': int(num(middle.get('level'), 0)),
            'reroll': int(num(badge.get('reroll'), 0)),
        }

        desc = (f'围绕 {"、".join(active_names) if active_names else "当前羁绊组合"} 展开，主C {mainC}'
                f'（{main_unit.get("cost") or 1} 费 / {main_unit.get("star") or 1} 星'
                f'{("，出装 " + main_items) if main_items else ""}）。核心棋子：'
                f'{"、".join(u["name"] for u in core_units)}。{pop} 人口成型，OP.GG 采样 '
                f'{int(num(primary.get("games"), 0))} 场：平均名次 {primary["avgPlace"]}'
                f'、登顶率 {round(num(primary.get("winRate")) * 100, 1)}%、前四率 '
                f'{round(num(primary.get("top4Rate")) * 100, 1)}%、出场率 '
                f'{round(num(primary.get("pickRate")) * 100, 2)}%。')
        out_comps.append({
            'id': cid,
            'name': (comp.get('name') or {}).get('zh_CN') or (comp.get('name') or {}).get('en_US') or '未命名阵容',
            'mainC': mainC,
            'tier': primary.get('tier') or 'C',
            'strength': primary.get('avgPlace') or 99,
            'avgPlace': primary.get('avgPlace') or 0,
            'winRate': primary.get('winRate') or 0,
            'top4Rate': primary.get('top4Rate') or 0,
            'pickRate': primary.get('pickRate') or 0,
            'games': primary.get('games') or 0,
            'opScore': primary.get('opScore') or 0,
            'badge': badge,
            'leveling': leveling,
            'costCurve': cost_curve,
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
        'sourceUrl': BASE_URL,
        'fetchedAt': fetched_at,
        'patch': PATCH,
        'note': '阵容、出装、站位与胜率类统计均来自 OP.GG 实时对局采样（近 24 小时窗口）；本站未做任何推断或补全。',
        'winRateNote': 'winRate 为登顶率（第一名占比），不是前四率；pickRate 为出场率。',
        'itemCatalog': catalog,
        's18': {
            'set': 'S18',
            'patch': PATCH,
            'source': 'OP.GG 实时阵容榜（中文站）',
            'sourceUrl': BASE_URL,
            'updatedAt': PATCH,
            'fetchedAt': fetched_at,
            'note': 'OP.GG representative 阵容，统计口径为近 24 小时对局样本；补丁 %s。' % PATCH,
            'metricNote': '平均名次 / 登顶率 / 前四率 / 出场率 / 场次均来自 OP.GG 对局样本；'
                          '段位切换为独立样本，阵容集合可能不同。',
            'snapshots': {
                'fetchedAt': fetched_at,
                'note': 'OP.GG 仅提供近 24 小时窗口；各段位独立采样。',
                'order': [k for k, _ in TIERS],
                'tiers': snapshots,
            },
            'comps': out_comps,
        },
    }
    with open(os.path.join(DATA, 'comps.json'), 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print('已写入 data/comps.json：%d 套阵容 / %d 件装备' % (len(out_comps), len(catalog)))


if __name__ == '__main__':
    main()
