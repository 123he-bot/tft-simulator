#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_trend.py —— 从 data/archive 快照生成 data/trend.json。

用途：
  - 多日趋势：每个快照一份 S18 阵容 / 装备 / 符文评级分布；
  - 版本差异：最近两份快照的阵容档位、装备评级、符文评级变化。

用法：
  python tools/build_trend.py            # 只生成 data/trend.json
  python tools/build_trend.py --rebuild  # 生成后重建 data.bundle.js（CI 每日任务用）

快照由 crawl_cdragon.py 在每次抓取后写入 data/archive/snapshot_*.json，
本脚本只读取本地文件，不联网、不推断缺失数据。
"""
import argparse
import glob
import json
import os
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
ARC = os.path.join(DATA, 'archive')
OUT = os.path.join(DATA, 'trend.json')


def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def snapshots():
    if not os.path.isdir(ARC):
        return []
    files = sorted(glob.glob(os.path.join(ARC, 'snapshot_*.json')))
    out = []
    for p in files:
        try:
            out.append((os.path.basename(p), load(p)))
        except Exception as e:
            print('跳过损坏快照', os.path.basename(p), e)
    return out


def grade_items(d):
    """按 data_center.js 的同一口径计算装备评级：同类按平均名次分位。

    样本 >=300 且同类 >=6 件才评级：S 前 12% / A 12-35% / B 35-65% / C 65-85% / D 后 15%。
    返回 {id: {name, category, grade, avgPlace, total}}。
    """
    st = d.get('s18Stats') or {}
    items = st.get('items') or {}
    cat = {c.get('id'): c for c in (items.get('catalog') or [])}
    rows = []
    for s in (items.get('stats') or []):
        c = cat.get(s.get('id'))
        if not c:
            continue
        rows.append({
            'id': s.get('id'), 'name': c.get('name') or s.get('id'),
            'category': c.get('category') or 'misc',
            'total': s.get('total') or 0, 'avgPlace': s.get('avgPlace'),
        })
    by_cat = {}
    for r in rows:
        if r['total'] >= 300 and r['avgPlace'] is not None:
            by_cat.setdefault(r['category'], []).append(r)
    out = {}
    for cat_name, arr in by_cat.items():
        arr.sort(key=lambda x: x['avgPlace'])
        if len(arr) < 6:
            continue
        for i, r in enumerate(arr):
            p = i / len(arr)
            r['grade'] = 'S' if p < 0.12 else 'A' if p < 0.35 else 'B' if p < 0.65 else 'C' if p < 0.85 else 'D'
            out[r['id']] = r
    return out


def aug_map(d):
    """OP.GG 专家评级：{id: {name, grade}}，未评级不收录。"""
    st = d.get('s18Stats') or {}
    out = {}
    for e in ((st.get('augments') or {}).get('items') or []):
        if e.get('id') and e.get('opTier'):
            out[e['id']] = {'name': e.get('name') or e['id'], 'grade': e['opTier']}
    return out


def comp_map(d):
    """S18 真实阵容：{id: {name, tier}}。"""
    s18 = ((d.get('comps') or {}).get('s18')) or {}
    out = {}
    for c in (s18.get('comps') or []):
        if c.get('id') and c.get('tier'):
            out[c['id']] = {'name': c.get('name') or c['id'], 'tier': c['tier']}
    return out


def counts(values, order):
    m = {}
    for v in values:
        if v:
            m[v] = m.get(v, 0) + 1
    return {k: m.get(k, 0) for k in order if m.get(k)}


def metrics(fname, d):
    comps = comp_map(d)
    items = grade_items(d)
    augs = aug_map(d)
    meta_tiers = (d.get('meta') or {}).get('tiers') or {}
    return {
        'file': fname,
        'archivedAt': d.get('__archivedAt') or '',
        'patch': d.get('__patch') or '',
        'metaTiers': {k: len(v or []) for k, v in meta_tiers.items() if v},
        'comps': counts([c['tier'] for c in comps.values()], ['OP', 'S', 'A', 'B', 'C', 'D']) if comps else None,
        'compTotal': len(comps) or None,
        'itemGrades': counts([i['grade'] for i in items.values()], ['S', 'A', 'B', 'C', 'D']) if items else None,
        'itemTotal': len(items) or None,
        'augGrades': counts([a['grade'] for a in augs.values()], ['OP', 'S', 'A', 'B', 'C', 'D']) if augs else None,
        'augTotal': len(augs) or None,
    }


def diff_maps(old, new, label, value_key):
    """通用差异：新增 / 移除 / 值变化（最多各 40 条，避免 trend.json 过大）。"""
    added = [dict(new[k], id=k) for k in sorted(set(new) - set(old))]
    removed = [dict(old[k], id=k) for k in sorted(set(old) - set(new))]
    changed = []
    for k in sorted(set(old) & set(new)):
        a, b = old[k], new[k]
        if a.get(value_key) != b.get(value_key):
            changed.append({'id': k, 'name': b.get('name') or a.get('name') or k,
                            'from': a.get(value_key), 'to': b.get(value_key)})
    return {'label': label, 'added': added[:40], 'removed': removed[:40],
            'changed': changed[:60], 'addedCount': len(added),
            'removedCount': len(removed), 'changedCount': len(changed)}


def build_diff(old_name, old, new_name, new):
    old_comps, new_comps = comp_map(old), comp_map(new)
    old_items, new_items = grade_items(old), grade_items(new)
    old_augs, new_augs = aug_map(old), aug_map(new)

    movers = []
    for k in set(old_items) & set(new_items):
        a, b = old_items[k], new_items[k]
        if a.get('avgPlace') is None or b.get('avgPlace') is None:
            continue
        movers.append({'id': k, 'name': b.get('name') or a.get('name') or k,
                       'from': round(a['avgPlace'], 3), 'to': round(b['avgPlace'], 3),
                       'delta': round(b['avgPlace'] - a['avgPlace'], 3)})
    movers.sort(key=lambda x: abs(x['delta']), reverse=True)

    def meta_counts(d):
        return {k: len(v or []) for k, v in ((d.get('meta') or {}).get('tiers') or {}).items() if v}

    return {
        'from': {'file': old_name, 'archivedAt': old.get('__archivedAt') or '', 'patch': old.get('__patch') or ''},
        'to': {'file': new_name, 'archivedAt': new.get('__archivedAt') or '', 'patch': new.get('__patch') or ''},
        'metaTiers': {'from': meta_counts(old), 'to': meta_counts(new)},
        'comps': diff_maps(old_comps, new_comps, '阵容档位', 'tier'),
        'items': diff_maps(old_items, new_items, '装备评级', 'grade'),
        'itemMovers': movers[:12],
        'augments': diff_maps(old_augs, new_augs, '符文评级', 'grade'),
        'comparable': {
            'comps': bool(old_comps and new_comps),
            'items': bool(old_items and new_items),
            'augments': bool(old_augs and new_augs),
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rebuild', action='store_true', help='生成后重建 js/data.bundle.js')
    args = ap.parse_args()

    snaps = snapshots()
    points = [metrics(name, d) for name, d in snaps]
    diff = build_diff(snaps[-2][0], snaps[-2][1], snaps[-1][0], snaps[-1][1]) if len(snaps) >= 2 else None
    payload = {
        'generatedAt': time.strftime('%Y-%m-%d %H:%M:%S'),
        'snapshotCount': len(points),
        'snapshots': points,
        'diff': diff,
        'note': '快照来自每次数据抓取后归档的 data/archive/snapshot_*.json，最多保留 50 份；'
                'S18 真实统计自 2026-11-12 起才有快照，之后每日自动累积。',
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
    print('已写入', OUT, '（快照 %d 份）' % len(points))

    if args.rebuild:
        import importlib.util
        spec = importlib.util.spec_from_file_location('crawl_set18', os.path.join(ROOT, 'tools', 'crawl_set18.py'))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        m.rebuild_bundle()


if __name__ == '__main__':
    main()
