#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
patch_diff.py —— 比较两个补丁快照的差异，输出人类可读的变更报告。

用法：
  python3 tools/patch_diff.py                              # 比较最新两份快照
  python3 tools/patch_diff.py <old> <new>                  # 指定两份快照路径
  python3 tools/patch_diff.py --snapshot                   # 对当前 data.bundle.js 生成一份临时快照再和最新归档比

差异维度：
  - 棋子属性变化（cost/role/range/mana/ad/ap/hp/armor/mr/items 列表增删）
  - 羁绊阈值变化（levels.min / levels.style 增改）
  - 装备配方变化（composition 增删）
  - 阵容 tier 分布变化（meta.tiers 的 S/A/B/C 数量增减）
"""
import argparse, json, os, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
ARC = os.path.join(DATA, 'archive')


def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def list_snapshots():
    if not os.path.isdir(ARC):
        return []
    files = sorted([os.path.join(ARC, f) for f in os.listdir(ARC) if f.endswith('.json')])
    return files


def snapshot_current():
    """临时从 data.bundle.js 提取当前 bundle，用于和归档对比。"""
    src = os.path.join(ROOT, 'js', 'data.bundle.js')
    if not os.path.exists(src):
        print('找不到 data.bundle.js')
        sys.exit(1)
    with open(src, encoding='utf-8') as f:
        raw = f.read()
    i = raw.find('window.TFT_DATA = ')
    if i < 0:
        print('data.bundle.js 格式异常')
        sys.exit(1)
    json_str = raw[i + len('window.TFT_DATA = '):].rstrip().rstrip(';')
    bundle = json.loads(json_str)
    slim = {k: v for k, v in bundle.items() if k not in ('itemsFull', 'augmentsFull')}
    return slim


def champ_key(c):
    return c.get('name') or c.get('id') or ''


def diff_champions(old_set, new_set, slug):
    """比较一个赛季内的棋子变化，返回 [(champ, change_desc), ...]"""
    old_map = {champ_key(c): c for c in (old_set.get('champions') or [])}
    new_map = {champ_key(c): c for c in (new_set.get('champions') or [])}
    changes = []

    added = set(new_map) - set(old_map)
    removed = set(old_map) - set(new_map)
    common = set(old_map) & set(new_map)

    for name in sorted(added):
        c = new_map[name]
        changes.append((name, f'🆕 新增棋子 · cost={c.get("cost")} role={c.get("role")}'))
    for name in sorted(removed):
        changes.append((name, f'❌ 删除棋子'))

    attrs = ['cost', 'role', 'range', 'mana', 'ad', 'ap', 'hp', 'armor', 'mr']
    for name in sorted(common):
        o = old_map[name]; n = new_map[name]
        diffs = []
        for a in attrs:
            if o.get(a) != n.get(a):
                diffs.append(f'{a}: {o.get(a)}→{n.get(a)}')
        if diffs:
            changes.append((name, '🔄 ' + ', '.join(diffs)))
    return changes


def diff_traits(old_set, new_set):
    old_map = {t.get('name') or t.get('apiName') or '': t for t in (old_set.get('traits') or [])}
    new_map = {t.get('name') or t.get('apiName') or '': t for t in (new_set.get('traits') or [])}
    changes = []
    added = set(new_map) - set(old_map)
    removed = set(old_map) - set(new_map)
    common = set(old_map) & set(new_map)

    for name in sorted(added):
        changes.append((name, f'🆕 新增羁绊'))
    for name in sorted(removed):
        changes.append((name, f'❌ 删除羁绊'))
    for name in sorted(common):
        o_lv = old_map[name].get('levels') or []
        n_lv = new_map[name].get('levels') or []
        if o_lv != n_lv:
            changes.append((name, f'🔄 羁绊阈值变化 {o_lv} → {n_lv}'))
    return changes


def diff_items(old, new):
    old_map = {i.get('id'): i for i in (old.get('items') or {}).get('completed') or []}
    new_map = {i.get('id'): i for i in (new.get('items') or {}).get('completed') or []}
    changes = []
    common = set(old_map) & set(new_map)
    for id_ in sorted(common):
        o = old_map[id_]; n = new_map[id_]
        if (o.get('recipe') or []) != (n.get('recipe') or []):
            changes.append((id_, f'🔄 装备配方 {o.get("recipe")} → {n.get("recipe")}'))
        elif o.get('name') != n.get('name'):
            changes.append((id_, f'🔄 装备名称 {o.get("name")} → {n.get("name")}'))
    return changes


def diff_meta(old_meta, new_meta):
    old_tiers = (old_meta or {}).get('tiers') or {}
    new_tiers = (new_meta or {}).get('tiers') or {}
    lines = []
    for tier in 'SABC':
        oc = len(old_tiers.get(tier) or [])
        nc = len(new_tiers.get(tier) or [])
        if oc != nc:
            delta = nc - oc
            lines.append((tier, f'🔄 {tier} 档阵容数 {oc} → {nc}（{"+" if delta > 0 else ""}{delta}）'))
    return lines


def compare(old_data, new_data, old_path, new_path):
    print('=' * 70)
    print(f'补丁差异报告')
    print(f'  旧快照: {os.path.basename(old_path)}  (archived {old_data.get("__archivedAt", "")})')
    print(f'  新快照: {os.path.basename(new_path)}  (archived {new_data.get("__archivedAt", "")})')
    print('=' * 70)

    # Meta tier 变化（整体）
    meta_changes = diff_meta(old_data.get('meta'), new_data.get('meta'))
    if meta_changes:
        print('\n📊 阵容档位变化：')
        for t, line in meta_changes:
            print(f'  {line}')

    # 每个赛季的棋子/羁绊变化
    season_slugs = [s for s in (set(old_data) | set(new_data))
                    if s.startswith('s') and isinstance(old_data.get(s) or new_data.get(s), dict)
                    and (old_data.get(s) or {}).get('champions') is not None]

    for slug in sorted(season_slugs):
        old_set = old_data.get(slug, {}) or {}
        new_set = new_data.get(slug, {}) or {}
        champ_changes = diff_champions(old_set, new_set, slug)
        trait_changes = diff_traits(old_set, new_set)
        if champ_changes or trait_changes:
            print(f'\n🔧 赛季 {slug.upper()} 变化：')
            for name, desc in champ_changes[:20]:
                print(f'  [{name}] {desc}')
            if len(champ_changes) > 20:
                print(f'  ... 还有 {len(champ_changes) - 20} 条')
            for name, desc in trait_changes:
                print(f'  [羁绊:{name}] {desc}')

    # 装备配方变化（全局）
    item_changes = diff_items(old_data, new_data)
    if item_changes:
        print('\n🔨 装备配方变化：')
        for id_, desc in item_changes[:15]:
            print(f'  [{id_}] {desc}')
        if len(item_changes) > 15:
            print(f'  ... 还有 {len(item_changes) - 15} 条')

    if not any([meta_changes, item_changes]) and not any(
        diff_champions(old_data.get(s, {}), new_data.get(s, {}), s) +
        diff_traits(old_data.get(s, {}), new_data.get(s, {}))
        for s in season_slugs
    ):
        print('\n✅ 无显著差异（或首次对比）')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('paths', nargs='*', help='旧快照路径 新快照路径（不传则用最新两份归档）')
    ap.add_argument('--current', action='store_true', help='对当前 bundle 生成临时快照再和最新归档比')
    args = ap.parse_args()

    if args.current:
        snaps = list_snapshots()
        if not snaps:
            print('没有任何归档快照，无法对比')
            sys.exit(1)
        old_path = snaps[-1]
        new_data = snapshot_current()
        compare(load(old_path), new_data, old_path, 'CURRENT')
        return

    if len(args.paths) == 2:
        old_path, new_path = args.paths
        compare(load(old_path), load(new_path), old_path, new_path)
    else:
        snaps = list_snapshots()
        if len(snaps) < 2:
            print(f'归档快照不足（只有 {len(snaps)} 份），无法自动对比')
            print('  提示：运行 `python3 tools/crawl_cdragon.py` 会自动归档一份')
            sys.exit(0)
        old_path, new_path = snaps[-2], snaps[-1]
        compare(load(old_path), load(new_path), old_path, new_path)


if __name__ == '__main__':
    main()
