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
import json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
ASSETS = os.path.join(ROOT, 'assets', 'icons')
URL = 'https://op.gg/zh-cn/tft/meta-trends/champion?version=18.5'
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'}


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode('utf-8', 'replace')


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
        """排除 PvE 野怪（英文名 / 峡谷野怪羁绊）与同角色形态变体。"""
        nm = c.get('name') or ''
        if not re.search(r'[\u4e00-\u9fff]', nm):
            return False
        if any((t.get('apiName') == 'DA_18_Riftbeast') for t in (c.get('traits') or [])):
            return False
        return True

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

    payload = {'set': 'S18', 'name': '自然之力', 'champions': out_champs, 'traits': out_traits}
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


def localize(payload):
    """把 op.gg 图标下载到 assets/icons/，并把 JSON 内链接改写为本地路径。"""
    os.makedirs(ASSETS, exist_ok=True)
    jobs, seen = [], {}

    def register(url):
        if not url or not str(url).startswith('http'):
            return None
        base = url.split('?')[0].rsplit('/', 1)[-1]
        if not base:
            return None
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
    p = build()
    localize(p)
