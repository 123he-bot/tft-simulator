/* ============ data_center.js —— 数据中心：检索器 / 棋子大数据 / 装备评级 / 强化符文梯度榜 ============ */
window.TFT = window.TFT || {};
(function (TFT) {
  'use strict';

  const U = TFT.U, D = TFT.D;
  const $ = U.$, $$ = U.$$;
  const DC = TFT.DataCenter = {};

  /* ==================== 常量与状态 ==================== */
  const TABS = [
    { key: 'explorer', name: '数据检索器', short: '检索' },
    { key: 'units', name: '棋子大数据', short: '棋子' },
    { key: 'items', name: '装备评级', short: '装备' },
    { key: 'traits', name: '羁绊评级', short: '羁绊' },
    { key: 'augments', name: '强化符文梯度榜', short: '符文' }
  ];
  const COSTS = [1, 2, 3, 4, 5];
  const ITEM_CATS = [
    { key: 'all', label: '全部' }, { key: 'completed', label: '成装' },
    { key: 'artifact', label: '神器' }, { key: 'emblem', label: '纹章' },
    { key: 'radiant', label: '光明装' }, { key: 'component', label: '组件' }
  ];
  const CAT_LABEL = { completed: '成装', artifact: '神器', emblem: '纹章', radiant: '光明装', component: '组件', support: '辅助', misc: '其他' };
  const RARITIES = [
    { key: 'all', label: '全部稀有度' }, { key: 'prismatic', label: '棱彩' },
    { key: 'gold', label: '金' }, { key: 'silver', label: '银' }
  ];
  const AUG_TIERS = ['OP', 'S', 'A', 'B', 'C'];
  const GRADE_RANK = { OP: 0, S: 1, A: 2, B: 3, C: 4, D: 5, '—': 6 };
  const GRADE_COLOR = { OP: '#ffcf6b', S: '#f0c25a', A: '#3fd99a', B: '#4f8cff', C: '#8f83f5', D: '#5d697d', '—': '#3a4454' };
  const CAT_COLOR = {
    completed: '#2fe0ee', artifact: '#f0c25a', emblem: '#8f83f5',
    radiant: '#fb923c', component: '#4f8cff', support: '#3fd99a', misc: '#5d697d'
  };
  const RARITY_RANK = { prismatic: 0, gold: 1, silver: 2, unknown: 3 };

  const S = DC.state = {
    tab: 'explorer', tier: null, q: '',
    costs: [], trait: '', sort: 'avgPlace', compare: [], grades: [],
    unitCosts: [], unitTrait: '', unitMainOnly: false, unitSort: 'comps',
    itemCat: 'all', itemSort: 'grade',
    traitGraded: false, traitSort: 'grade', traitGrade: '',
    augRarity: 'all', augTier: 'all', augTrait: '', augSort: 'grade'
  };

  const cache = { comps: {}, units: {} };
  const DC_KEY = 'tft.dc.filters';
  const URL_SORTS = {
    explorer: ['avgPlace', 'top4', 'win', 'pick', 'games'],
    units: ['comps', 'main', 'core', 'avgPlace', 'pickShare'],
    items: ['grade', 'avgPlace', 'top4', 'win', 'total'],
    traits: ['grade', 'games', 'avgPlace', 'top4'],
    augments: ['grade', 'rarity', 'fit', 'name']
  };

  /* ==================== 状态 ⇄ URL / 本地记忆 ==================== */
  function readParams(sp) {
    const o = {};
    const nums = function (raw, allowed) {
      return String(raw || '').split(',').map(Number).filter(function (n) { return allowed.indexOf(n) >= 0; });
    };
    if (sp.has('costs')) o.costs = nums(sp.get('costs'), COSTS);
    if (sp.has('trait')) o.trait = sp.get('trait');
    if (sp.has('sort')) o.sort = sp.get('sort');
    if (sp.has('cmp')) o.cmp = String(sp.get('cmp') || '').split(',').filter(Boolean).slice(0, 3);
    if (sp.has('grades')) o.grades = String(sp.get('grades') || '').split(',').filter(function (g) { return GRADE_RANK[g] != null; });
    if (sp.has('ucosts')) o.ucosts = nums(sp.get('ucosts'), COSTS);
    if (sp.has('utrait')) o.utrait = sp.get('utrait');
    if (sp.has('umain')) o.umain = sp.get('umain') === '1';
    if (sp.has('usort')) o.usort = sp.get('usort');
    if (sp.has('cat')) o.cat = sp.get('cat');
    if (sp.has('isort')) o.isort = sp.get('isort');
    if (sp.has('tgraded')) o.tgraded = sp.get('tgraded') === '1';
    if (sp.has('tsort')) o.tsort = sp.get('tsort');
    if (sp.has('tgrade')) o.tgrade = sp.get('tgrade');
    if (sp.has('ararity')) o.ararity = sp.get('ararity');
    if (sp.has('atier')) o.atier = sp.get('atier');
    if (sp.has('afit')) o.afit = sp.get('afit');
    if (sp.has('asort')) o.asort = sp.get('asort');
    if (sp.has('q')) o.q = sp.get('q');
    return o;
  }

  function applyFilters(o) {
    if (!o) return;
    if (o.costs) S.costs = o.costs.slice();
    if (o.trait != null) S.trait = String(o.trait);
    if (URL_SORTS.explorer.indexOf(o.sort) >= 0) S.sort = o.sort;
    if (o.cmp) S.compare = o.cmp.filter(function (id, i, arr) { return arr.indexOf(id) === i; }).slice(0, 3);
    if (o.grades) S.grades = o.grades.slice();
    if (o.ucosts) S.unitCosts = o.ucosts.slice();
    if (o.utrait != null) S.unitTrait = String(o.utrait);
    if (o.umain != null) S.unitMainOnly = !!o.umain;
    if (URL_SORTS.units.indexOf(o.usort) >= 0) S.unitSort = o.usort;
    if (ITEM_CATS.some(function (c) { return c.key === o.cat; })) S.itemCat = o.cat;
    if (URL_SORTS.items.indexOf(o.isort) >= 0) S.itemSort = o.isort;
    if (o.tgraded != null) S.traitGraded = !!o.tgraded;
    if (URL_SORTS.traits.indexOf(o.tsort) >= 0) S.traitSort = o.tsort;
    if (o.tgrade === '' || ['S', 'A', 'B', 'C', 'D', '—'].indexOf(o.tgrade) >= 0) S.traitGrade = String(o.tgrade);
    if (RARITIES.some(function (r) { return r.key === o.ararity; })) S.augRarity = o.ararity;
    if (o.atier === 'all' || AUG_TIERS.indexOf(o.atier) >= 0) S.augTier = o.atier;
    if (o.afit != null) S.augTrait = String(o.afit);
    if (URL_SORTS.augments.indexOf(o.asort) >= 0) S.augSort = o.asort;
    if (o.q != null) S.q = String(o.q).slice(0, 60);
  }

  function tabFilters() {
    if (S.tab === 'units') return { ucosts: S.unitCosts.slice(), utrait: S.unitTrait, umain: S.unitMainOnly, usort: S.unitSort };
    if (S.tab === 'items') return { cat: S.itemCat, isort: S.itemSort };
    if (S.tab === 'traits') return { tgraded: S.traitGraded, tsort: S.traitSort, tgrade: S.traitGrade };
    if (S.tab === 'augments') return { ararity: S.augRarity, atier: S.augTier, afit: S.augTrait, asort: S.augSort };
    return { costs: S.costs.slice(), trait: S.trait, sort: S.sort, cmp: S.compare.slice(), grades: S.grades.slice() };
  }

  function queryString() {
    const p = ['tier=' + encodeURIComponent(S.tier || 'all')];
    if (S.q) p.push('q=' + encodeURIComponent(S.q));
    const f = tabFilters();
    if (f.costs && f.costs.length) p.push('costs=' + f.costs.slice().sort().join(','));
    if (f.trait) p.push('trait=' + encodeURIComponent(f.trait));
    if (f.sort) p.push('sort=' + encodeURIComponent(f.sort));
    if (f.cmp && f.cmp.length) p.push('cmp=' + f.cmp.map(encodeURIComponent).join(','));
    if (f.grades && f.grades.length) p.push('grades=' + f.grades.map(encodeURIComponent).join(','));
    if (f.ucosts && f.ucosts.length) p.push('ucosts=' + f.ucosts.slice().sort().join(','));
    if (f.utrait) p.push('utrait=' + encodeURIComponent(f.utrait));
    if (f.umain) p.push('umain=1');
    if (f.usort) p.push('usort=' + encodeURIComponent(f.usort));
    if (f.cat) p.push('cat=' + encodeURIComponent(f.cat));
    if (f.isort) p.push('isort=' + encodeURIComponent(f.isort));
    if (f.tgraded) p.push('tgraded=1');
    if (f.tsort) p.push('tsort=' + encodeURIComponent(f.tsort));
    if (f.tgrade) p.push('tgrade=' + encodeURIComponent(f.tgrade));
    if (f.ararity) p.push('ararity=' + encodeURIComponent(f.ararity));
    if (f.atier) p.push('atier=' + encodeURIComponent(f.atier));
    if (f.afit) p.push('afit=' + encodeURIComponent(f.afit));
    if (f.asort) p.push('asort=' + encodeURIComponent(f.asort));
    return p.join('&');
  }

  function syncUrl() {
    const h = '#data/' + S.tab + '?' + queryString();
    if (location.hash === h) return;
    try { history.replaceState(null, '', h); } catch (e) { }
  }

  function saveMemory() {
    try {
      const all = JSON.parse(localStorage.getItem(DC_KEY) || '{}') || {};
      all.tier = S.tier;
      all[S.tab] = tabFilters();
      localStorage.setItem(DC_KEY, JSON.stringify(all));
    } catch (e) { }
  }

  function restoreMemory() {
    let all = null;
    try { all = JSON.parse(localStorage.getItem(DC_KEY) || 'null'); } catch (e) { all = null; }
    if (!all) return;
    const tiers = tierList().map(function (t) { return t.key; });
    if (all.tier && tiers.indexOf(all.tier) >= 0) S.tier = all.tier;
    applyFilters(all[S.tab]);
  }

  /* ==================== 基础工具 ==================== */
  function fp(v, d) {
    if (v == null || !isFinite(v)) return '—';
    return (v * 100).toFixed(d == null ? 1 : d) + '%';
  }
  function fplace(v) { return v == null || !isFinite(v) ? '—' : (Math.round(v * 100) / 100).toFixed(2); }
  function fnum(v) { return v == null || !isFinite(v) ? '—' : U.num(Math.round(v)); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function compSnap() {
    const cd = D.compData && D.compData[D.currentSlug];
    return cd && cd.snapshots && cd.snapshots.tiers ? cd.snapshots : null;
  }
  function sd() { return (D.raw && D.raw.s18Stats) || null; }
  function hasRealS18() { return D.currentSlug === 's18' && !!sd() && !!sd().items; }

  function tierList() {
    const snap = compSnap();
    if (!snap || !snap.tiers) return [{ key: 'all', label: '全段位' }];
    return Object.keys(snap.tiers).map(function (k) {
      return { key: k, label: (snap.tiers[k] && snap.tiers[k].label) || k };
    });
  }
  function initTier() {
    const opts = tierList().map(function (t) { return t.key; });
    if (S.tier && opts.indexOf(S.tier) >= 0) return;
    const prefer = (TFT.Main && TFT.Main.homeTier) || '';
    if (prefer && opts.indexOf(prefer) >= 0) S.tier = prefer;
    else if (opts.indexOf('diamond') >= 0) S.tier = 'diamond';
    else S.tier = opts[0] || 'all';
  }
  function tierLabel() {
    const hit = tierList().filter(function (t) { return t.key === S.tier; })[0];
    return hit ? hit.label : '全部段位';
  }

  /* ==================== 阵容数据 ==================== */
  function compsForTier(tier) {
    const slug = D.currentSlug;
    const key = slug + '|' + (tier || 'all');
    if (cache.comps[key]) return cache.comps[key];
    const cd = D.compData && D.compData[slug];
    const t = tier || 'all';
    let list;
    if (cd && cd.comps && cd.comps.length) {
      const entries = cd.snapshots && cd.snapshots.tiers && cd.snapshots.tiers[t] && cd.snapshots.tiers[t].entries;
      if (entries && Object.keys(entries).length) {
        list = cd.comps.map(function (cp) {
          const e = entries[cp.id];
          if (!e) return null;
          return Object.assign({}, cp, {
            avgPlace: e.avgPlace, winRate: e.winRate, top4Rate: e.top4Rate,
            pickRate: e.pickRate, games: e.games, opScore: e.opScore,
            tier: e.tier || cp.tier, badge: e.badge || cp.badge
          });
        }).filter(Boolean);
      } else {
        list = cd.comps.slice();
      }
    } else {
      // 历史赛季：使用站内 Meta / 本地推断阵容，仅展示结构，不伪造对局统计
      const meta = D.metaForSeason(slug);
      list = [];
      Object.keys(meta.tiers || {}).forEach(function (tierKey) {
        (meta.tiers[tierKey] || []).forEach(function (cp) {
          list.push(Object.assign({}, cp, { tier: cp.tier || tierKey, _legacy: true }));
        });
      });
    }
    cache.comps[key] = list;
    return list;
  }

  function wavg(list, field) {
    let s = 0, w = 0;
    list.forEach(function (cp) {
      const g = Number(cp.games) || 0;
      if (!g) return;
      s += (Number(cp[field]) || 0) * g;
      w += g;
    });
    return w ? s / w : null;
  }

  function traitOptions(list) {
    const map = {};
    list.forEach(function (cp) {
      (cp.traits || []).forEach(function (t) { if (t && t.name) map[t.name] = (map[t.name] || 0) + 1; });
    });
    return Object.keys(map).sort(function (a, b) { return map[b] - map[a]; });
  }

  function compHay(cp) {
    const parts = [cp.name || '', cp.mainC || ''];
    (cp.units || []).forEach(function (u) {
      parts.push(u.name || '');
      (u.items || []).forEach(function (id) {
        const it = D.item(id);
        if (it && it.name) parts.push(it.name);
      });
    });
    (cp.traits || []).forEach(function (t) { parts.push(t.name || ''); });
    return parts.join(' ').toLowerCase();
  }

  function matchQ(hay, q) {
    const tokens = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    return tokens.every(function (t) { return hay.indexOf(t) >= 0; });
  }

  function champOf(id) {
    const hit = (D.champ && D.champ(id)) || (D.champByName && D.champByName(id)) || null;
    if (hit) return hit;
    const st = sd();
    const cs = (st && st.champions) || [];
    for (let j = 0; j < cs.length; j++) if (cs[j].id === id) return cs[j];
    return null;
  }
  function champTraits(id) {
    const c = champOf(id);
    return (c && c.traits) || [];
  }
  function champName(id, fallback) {
    const c = champOf(id);
    return (c && c.name) || fallback || id || '—';
  }
  function champIcon(id) {
    const c = champOf(id);
    return (c && (c.icon || c.tileIcon)) || '';
  }
  function itemInfo(id) {
    return D.item(id) || (D.itemByName && D.itemByName(id)) || null;
  }

  function unitAgg(tier) {
    const key = D.currentSlug + '|' + (tier || 'all');
    if (cache.units[key]) return cache.units[key];
    const comps = compsForTier(tier);
    const map = {};
    comps.forEach(function (cp) {
      const g = Number(cp.games) || 0;
      (cp.units || []).forEach(function (u) {
        const id = u.id || u.name;
        let a = map[id];
        if (!a) {
          a = map[id] = {
            id: id, name: u.name || id, cost: Number(u.cost) || 0,
            comps: 0, mainC: 0, core: 0, games: 0, placeW: 0, top4W: 0, winW: 0,
            items: {}, best: null
          };
        }
        a.comps += 1;
        if (u.tag === 'main' || cp.mainC === u.name) a.mainC += 1;
        if (u.core) a.core += 1;
        a.games += g;
        a.placeW += (Number(cp.avgPlace) || 0) * g;
        a.top4W += (Number(cp.top4Rate) || 0) * g;
        a.winW += (Number(cp.winRate) || 0) * g;
        (u.items || []).forEach(function (it) { a.items[it] = (a.items[it] || 0) + 1; });
        if (!a.best || (Number(cp.avgPlace) || 99) < (Number(a.best.avgPlace) || 99)) {
          a.best = { id: cp.id, name: cp.name, avgPlace: cp.avgPlace, tier: cp.tier, games: cp.games };
        }
      });
    });
    const rows = Object.keys(map).map(function (k) {
      const a = map[k];
      a.avgPlace = a.games ? a.placeW / a.games : null;
      a.top4Rate = a.games ? a.top4W / a.games : null;
      a.winRate = a.games ? a.winW / a.games : null;
      a.pickShare = comps.length ? a.comps / comps.length : 0;
      a.mainRate = a.comps ? a.mainC / a.comps : 0;
      a.coreRate = a.comps ? a.core / a.comps : 0;
      a.traits = champTraits(a.id);
      a.topItems = Object.keys(a.items).sort(function (x, y) { return a.items[y] - a.items[x]; }).slice(0, 3).map(function (id) {
        const it = itemInfo(id);
        return { id: id, name: (it && it.name) || id, icon: (it && it.icon) || '', count: a.items[id] };
      });
      return a;
    });
    cache.units[key] = rows;
    return rows;
  }

  /* ==================== 装备数据 ==================== */
  function itemRowsReal() {
    const st = sd();
    if (!st || !st.items) return null;
    const catMap = {};
    (st.items.catalog || []).forEach(function (c) { catMap[c.id] = c; });
    const rows = [];
    (st.items.stats || []).forEach(function (s) {
      const c = catMap[s.id];
      if (!c) return;
      rows.push({
        id: s.id, name: c.name, category: c.category, icon: c.icon,
        desc: c.desc, stat: c.stat, recipeNames: c.recipeNames || [],
        total: s.total, win: s.win, top4: s.top4,
        avgPlace: s.avgPlace, winRate: s.winRate, top4Rate: s.top4Rate,
        wearers: s.wearers || []
      });
    });
    // 评级：同类装备内按平均名次分位（样本 >=300，且同类 >=6 件），S 最好；仅用于排序
    const byCat = {};
    rows.forEach(function (r) {
      if (r.total >= 300 && isFinite(r.avgPlace)) (byCat[r.category] = byCat[r.category] || []).push(r);
    });
    Object.keys(byCat).forEach(function (cat) {
      const arr = byCat[cat].sort(function (a, b) { return a.avgPlace - b.avgPlace; });
      if (arr.length < 6) return;
      arr.forEach(function (r, i) {
        const p = i / arr.length;
        r.grade = p < 0.12 ? 'S' : p < 0.35 ? 'A' : p < 0.65 ? 'B' : p < 0.85 ? 'C' : 'D';
      });
    });
    rows.forEach(function (r) { if (!r.grade) r.grade = '—'; });
    return rows;
  }

  function itemRowsFromComps(tier) {
    const comps = compsForTier(tier);
    const map = {};
    comps.forEach(function (cp) {
      const g = Number(cp.games) || 0;
      (cp.units || []).forEach(function (u) {
        (u.items || []).forEach(function (id) {
          let a = map[id];
          if (!a) {
            const it = itemInfo(id) || {};
            a = map[id] = { id: id, name: it.name || id, icon: it.icon || '', category: it.category || 'misc', desc: it.desc || '', recipeNames: it.recipeNames || [], total: 0, placeW: 0, top4W: 0, winW: 0, comps: 0, wearers: [] };
          }
          a.comps += 1;
          a.total += g;
          a.placeW += (Number(cp.avgPlace) || 0) * g;
          a.top4W += (Number(cp.top4Rate) || 0) * g;
          a.winW += (Number(cp.winRate) || 0) * g;
          if (a.wearers.length < 8 && !a.wearers.some(function (w) { return w.id === u.id; })) {
            a.wearers.push({ id: u.id, name: u.name, total: g, avgPlace: cp.avgPlace, top4Rate: cp.top4Rate });
          }
        });
      });
    });
    return Object.keys(map).map(function (k) {
      const a = map[k];
      a.avgPlace = a.total ? a.placeW / a.total : null;
      a.top4Rate = a.total ? a.top4W / a.total : null;
      a.winRate = a.total ? a.winW / a.total : null;
      a.grade = '—';
      return a;
    });
  }

  /* ==================== 羁绊数据 ==================== */
  let traitMeta = null;
  function traitInfo(name) {
    if (D.currentSlug !== 's18') return null;
    if (!traitMeta) {
      traitMeta = {};
      ((sd() && sd().traits) || []).forEach(function (t) { if (t && t.name) traitMeta[t.name] = t; });
    }
    return traitMeta[name] || null;
  }
  function traitIcon(name) {
    const t = traitInfo(name);
    return t && t.icon ? t.icon : '';
  }

  function traitAgg(tier) {
    const key = 'trait|' + (D.currentSlug || '') + '|' + (tier || 'all');
    if (cache.comps[key]) return cache.comps[key];
    const comps = compsForTier(tier);
    const map = {};
    comps.forEach(function (cp) {
      const g = Number(cp.games) || 0;
      (cp.traits || []).forEach(function (t) {
        if (!t || !t.name) return;
        let a = map[t.name];
        if (!a) a = map[t.name] = { name: t.name, comps: 0, games: 0, placeW: 0, top4W: 0, winW: 0, activeW: 0, activeN: 0, best: null };
        a.comps += 1;
        a.games += g;
        a.placeW += (Number(cp.avgPlace) || 0) * g;
        a.top4W += (Number(cp.top4Rate) || 0) * g;
        a.winW += (Number(cp.winRate) || 0) * g;
        a.activeW += (Number(t.active) || 0) * g;
        a.activeN += g;
        if (!a.best || (Number(cp.games) || 0) > (Number(a.best.games) || 0)) a.best = cp;
      });
    });
    const totalGames = comps.reduce(function (s, cp) { return s + (Number(cp.games) || 0); }, 0);
    const list = Object.keys(map).map(function (k) {
      const a = map[k];
      a.avgPlace = a.games ? a.placeW / a.games : null;
      a.top4Rate = a.games ? a.top4W / a.games : null;
      a.winRate = a.games ? a.winW / a.games : null;
      a.active = a.activeN ? a.activeW / a.activeN : null;
      a.share = totalGames ? a.games / totalGames : null;
      a.grade = '—';
      return a;
    });
    // 评级：仅对有足够样本的羁绊（>=800 局且 >=2 套阵容）按加权均名分位
    const valid = list.filter(function (a) { return a.games >= 800 && a.comps >= 2 && isFinite(a.avgPlace); })
      .sort(function (x, y) { return x.avgPlace - y.avgPlace; });
    if (valid.length >= 6) {
      valid.forEach(function (a, i) {
        const p = i / valid.length;
        a.grade = p < 0.15 ? 'S' : p < 0.4 ? 'A' : p < 0.7 ? 'B' : p < 0.9 ? 'C' : 'D';
      });
    }
    list.sort(function (x, y) {
      const gx = x.grade === '—' ? 9 : 'SABCD'.indexOf(x.grade);
      const gy = y.grade === '—' ? 9 : 'SABCD'.indexOf(y.grade);
      return gx - gy || (y.games || 0) - (x.games || 0);
    });
    cache.comps[key] = list;
    return list;
  }

  function renderTraits() {
    const all = traitAgg(S.tier);
    const q = S.q;
    const base = all.filter(function (a) {
      if (S.traitGraded && a.grade === '—') return false;
      if (q && !matchQ(a.name.toLowerCase(), q)) return false;
      return true;
    });
    const list = base.filter(function (a) { return !S.traitGrade || a.grade === S.traitGrade; });
    const sorters = {
      grade: function (x, y) {
        const gx = x.grade === '—' ? 9 : 'SABCD'.indexOf(x.grade);
        const gy = y.grade === '—' ? 9 : 'SABCD'.indexOf(y.grade);
        return gx - gy || (x.avgPlace || 99) - (y.avgPlace || 99);
      },
      games: function (x, y) { return y.games - x.games; },
      avgPlace: function (x, y) { return (x.avgPlace || 99) - (y.avgPlace || 99); },
      top4: function (x, y) { return (y.top4Rate || 0) - (x.top4Rate || 0); }
    };
    list.sort(sorters[S.traitSort] || sorters.grade);
    const comps = compsForTier(S.tier);
    const games = comps.reduce(function (s, cp) { return s + (Number(cp.games) || 0); }, 0);
    const graded = all.filter(function (a) { return a.grade !== '—'; }).length;
    const hasStats = games > 0;
    const top4 = wavg(list, 'top4Rate');

    const gradeMap = countBy(base, function (a) { return a.grade; });
    const gradeDist = ['S', 'A', 'B', 'C', 'D', '—'].filter(function (g) { return gradeMap[g]; })
      .map(function (g) {
        return { label: g === '—' ? '未评级' : g + ' 级', value: gradeMap[g], color: GRADE_COLOR[g], act: 'charttgrade', key: g, on: S.traitGrade === g };
      });

    const rows = list.map(function (a) {
      const icon = traitIcon(a.name);
      return '<tr class="dc-row" tabindex="0" data-dc-act="traitinfo" data-key="' + esc(a.name) + '" title="查看该羁绊的阵容">' +
        '<td>' + gtag(a.grade) + '</td>' +
        '<td><div class="dc-name dc-with-av"><span class="dc-av">' + (icon ? '<img src="' + esc(icon) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') + '</span>' +
          '<span><b>' + esc(a.name) + '</b><i>' + (a.active ? '平均激活 ' + (Math.round(a.active * 10) / 10) : '—') + ' · ' + a.comps + ' 套阵容</i></span></div></td>' +
        '<td class="num strong">' + (hasStats ? fnum(a.games) : '—') + '</td>' +
        '<td class="num">' + (hasStats ? fp(a.share) : '—') + '</td>' +
        '<td class="num">' + fplace(a.avgPlace) + '</td>' +
        '<td class="num">' + fp(a.top4Rate) + '</td>' +
        '<td class="num">' + fp(a.winRate) + '</td>' +
        '<td class="dc-col-opt dim">' + esc(a.best ? a.best.name : '—') + '</td>' +
        '</tr>';
    }).join('');

    return '<section class="dc-panel">' +
      '<div class="dc-toolbar">' + searchBox('搜索羁绊') +
        chip('tgraded', '', '仅看有评级', S.traitGraded) +
        selectBox('dcTSort', 'tsort', [
          { key: 'grade', label: '评级优先' }, { key: 'games', label: '样本局数 ↓' },
          { key: 'avgPlace', label: '平均名次 ↑' }, { key: 'top4', label: '前四率 ↓' }
        ], S.traitSort, '排序') +
        '<button type="button" class="btn btn-xs dc-reset" data-dc-act="reset">重置</button>' +
      '</div>' +
      kpis([
        { v: all.length, k: '羁绊数', s: '当前赛季收录' },
        { v: graded, k: '有评级', s: '样本 ≥800 局' },
        { v: hasStats ? fnum(games) : '—', k: '阵容样本', s: hasStats ? comps.length + ' 套阵容合计' : '该赛季无对局统计' },
        { v: hasStats ? fp(top4) : '—', k: '加权前四率', s: '当前筛选按局数加权' }
      ]) +
      '<div class="dc-charts one">' + distCard('羁绊评级分布', '点击筛选评级', gradeDist) + '</div>' +
      '<div class="dc-table-wrap"><table class="dc-table"><thead><tr>' +
        '<th>评级</th><th>羁绊</th><th class="num">样本局数</th><th class="num">登场占比</th><th class="num">均名</th><th class="num">前四</th><th class="num">登顶</th><th class="dc-col-opt">代表阵容</th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="8"><div class="dc-empty">当前筛选下没有羁绊。试试关闭「仅看有评级」。</div></td></tr>') + '</tbody></table></div>' +
      note('羁绊评级口径：统计包含该羁绊的阵容对局，按对局数加权均名 / 前四率 / 登顶率；同一局会同时计入多个羁绊，因此登场占比不可相加。样本不足 800 局或少于 2 套阵容不评级（显示 —），评级按当前段位内的加权均名分位计算。' + (hasStats ? '' : ' 当前赛季没有对局统计，仅展示羁绊结构。')) +
    '</section>';
  }

  /* ==================== 强化符文数据 ==================== */
  let s18TraitNames = null;
  function fitTraits(desc) {
    if (!s18TraitNames) {
      const st = sd();
      s18TraitNames = ((st && st.traits) || []).map(function (t) { return t.name; })
        .filter(function (n) { return n && n.length >= 2; })
        .sort(function (a, b) { return b.length - a.length; });
    }
    const out = [];
    for (let i = 0; i < s18TraitNames.length; i++) {
      const n = s18TraitNames[i];
      if (out.some(function (x) { return x.indexOf(n) >= 0; })) continue;
      if (desc.indexOf(n) >= 0) out.push(n);
      if (out.length >= 4) break;
    }
    return out;
  }

  function augRowsReal() {
    const st = sd();
    const expert = (st && st.augments && st.augments.items) || [];
    const byId = {}, byName = {}, nameCnt = {};
    expert.forEach(function (e) {
      if (e.id) byId[e.id] = e;
      if (e.name) {
        if (!byName[e.name]) { byName[e.name] = e; nameCnt[e.name] = 0; }
        nameCnt[e.name]++;
      }
    });
    // 主体：官方全量目录（含描述 / 稀有度 / 图标）；专家评级优先按 id 连接，名称仅在双方唯一时兜底
    const base = D.augmentList(D.currentSlug) || [];
    const officialCnt = {};
    base.forEach(function (a) { officialCnt[a.name] = (officialCnt[a.name] || 0) + 1; });
    // 官方部分描述缺数值变量（如「获得%物理加成」），回退到 OP.GG 的完整中文描述
    const brokenDesc = /[\u4e00-\u9fa5]%|获得%|造成%|持续秒|为%|和%|，%|提升%。/;
    const rows = base.map(function (a) {
      const e = byId[a.id] || (officialCnt[a.name] === 1 && nameCnt[a.name] === 1 ? byName[a.name] : null) || null;
      let desc = a.desc || (e && e.desc) || '';
      if (brokenDesc.test(desc) && e && e.desc && /[\u4e00-\u9fa5]/.test(e.desc) && /\d/.test(e.desc)) {
        desc = e.desc;
      }
      return {
        id: a.id, name: a.name, rarityKey: a.rarityKey, rarity: a.rarity,
        grade: (e && e.opTier) || '—', desc: desc, icon: a.icon || (e && e.icon) || '',
        fit: (a.traits && a.traits.length) ? a.traits.slice(0, 4) : fitTraits(desc),
        fitScore: null, real: true, expert: !!e
      };
    });
    return rows;
  }

  function augRowsLegacy(tier) {
    const list = D.augmentList(D.currentSlug) || [];
    const comps = compsForTier(tier);
    const cover = {};
    comps.forEach(function (cp) {
      (cp.traits || []).forEach(function (t) { if (t && t.name) cover[t.name] = (cover[t.name] || 0) + 1; });
    });
    return list.map(function (a) {
      const fit = a.traits || [];
      const c = fit.reduce(function (s, t) { return s + (cover[t] || 0); }, 0);
      const score = comps.length && fit.length ? clamp(c / (comps.length * fit.length), 0, 1) : 0;
      return {
        id: a.id, name: a.name, rarityKey: a.rarityKey, rarity: a.rarity,
        grade: '—', desc: a.desc || '', icon: a.icon || '', fit: fit,
        fitScore: score, real: false
      };
    });
  }

  /* ==================== 渲染：外壳 ==================== */
  function esc(v) { return U.esc(v); }
  function chip(act, key, label, on, extra) {
    return '<button type="button" class="dc-chip' + (on ? ' on' : '') + '" data-dc-act="' + act + '" data-key="' + esc(key) + '"' + (extra || '') + '>' + label + '</button>';
  }
  function gtag(g) {
    const raw = (g == null || g === '') ? '—' : String(g);
    const k = raw === '—' ? 'na' : raw.toLowerCase();
    return '<span class="dc-grade g-' + esc(k) + '">' + esc(raw) + '</span>';
  }
  function chipTag(n) { return '<span class="dc-tag">' + esc(n) + '</span>'; }
  function avatars(list, max) {
    const arr = (list || []).slice(0, max || 3);
    if (!arr.length) return '<span class="dim">—</span>';
    return '<span class="dc-avatars">' + arr.map(function (x) {
      const icon = x.icon || champIcon(x.id);
      return '<span class="dc-av" title="' + esc(x.name) + '">' +
        (icon ? '<img src="' + esc(icon) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">' : '') +
        '</span>';
    }).join('') + '</span>';
  }
  function kpis(items) {
    return '<div class="dc-kpis">' + items.map(function (x) {
      return '<div class="dc-kpi"><div class="dc-kpi-v">' + x.v + '</div><div class="dc-kpi-k">' + esc(x.k) + '</div>' +
        (x.s ? '<div class="dc-kpi-s">' + esc(x.s) + '</div>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function selectBox(id, act, options, value, label) {
    return '<label class="dc-field"><span>' + esc(label) + '</span><select id="' + id + '" data-dc-act="' + act + '">' +
      options.map(function (o) {
        return '<option value="' + esc(o.key) + '"' + (o.key === value ? ' selected' : '') + '>' + esc(o.label) + '</option>';
      }).join('') + '</select></label>';
  }
  function searchBox(placeholder) {
    return '<label class="dc-search"><span>⌕</span><input id="dcSearch" type="text" autocomplete="off" placeholder="' +
      esc(placeholder) + '" value="' + esc(S.q) + '"></label>';
  }
  function note(html) { return '<div class="dc-note">' + html + '</div>'; }

  /* ==================== 图表组件（纯 CSS 条形 / 分布条） ==================== */
  function countBy(list, fn) {
    const m = {};
    (list || []).forEach(function (x) {
      const k = fn(x);
      if (k == null || k === '') return;
      m[k] = (m[k] || 0) + 1;
    });
    return m;
  }

  function barChart(title, sub, rows, opt) {
    const o = opt || {};
    const max = (rows || []).reduce(function (m, r) { return Math.max(m, Number(r.value) || 0); }, 0) || 1;
    return '<div class="dc-chart-card">' +
      '<div class="dc-chart-head"><b>' + esc(title) + '</b><em>' + esc(sub) + '</em></div>' +
      '<div class="dc-bars">' + (rows || []).map(function (r, i) {
        const v = Number(r.value) || 0;
        const pct = v > 0 ? Math.max(2, (v / max) * 100) : 0;
        const cls = 'dc-bar-row' + (r.act ? ' actable' : '') + (r.on ? ' on' : '');
        const attrs = r.act
          ? ' role="button" tabindex="0" data-dc-act="' + r.act + '" data-key="' + esc(String(r.key)) + '" aria-pressed="' + (r.on ? 'true' : 'false') + '"'
          : '';
        return '<div class="' + cls + '"' + attrs + ' title="' + esc(r.label + '：' + v + (o.unit || '') + (r.act ? '（点击筛选）' : '')) + '">' +
          '<span class="dc-bar-label">' + esc(r.label) + '</span>' +
          '<span class="dc-bar-track"><i class="dc-bar-fill' + (r.cls ? ' ' + r.cls : '') + '" style="--w:' + pct.toFixed(1) + '%;animation-delay:' + (i * 28) + 'ms"></i></span>' +
          '<b class="dc-bar-val">' + fnum(v) + '</b></div>';
      }).join('') + '</div></div>';
  }

  function distCard(title, sub, rows) {
    const vis = (rows || []).filter(function (r) { return (Number(r.value) || 0) > 0; });
    const attrsOf = function (r, extra) {
      return r.act
        ? ' role="button" tabindex="0" data-dc-act="' + r.act + '" data-key="' + esc(String(r.key)) + '" aria-pressed="' + (r.on ? 'true' : 'false') + '"' + (extra || '')
        : '';
    };
    return '<div class="dc-chart-card dc-dist-card">' +
      '<div class="dc-chart-head"><b>' + esc(title) + '</b><em>' + esc(sub) + '</em></div>' +
      '<div class="dc-dist-bar" role="img" aria-label="' + esc(title + '：' + (vis.length ? vis.map(function (r) { return r.label + ' ' + r.value; }).join('，') : '暂无数据')) + '">' +
        (vis.length ? vis.map(function (r) {
          return '<i class="dc-dist-seg' + (r.act ? ' actable' : '') + '" style="flex:' + (Number(r.value) || 0) + ';background:' + (r.color || 'var(--panel-4)') + '"' + attrsOf(r) + ' title="' + esc(r.label + ' ' + r.value + (r.act ? '（点击筛选）' : '')) + '"></i>';
        }).join('') : '<i class="dc-dist-seg" style="flex:1"></i>') +
      '</div>' +
      '<div class="dc-dist-legend">' + (rows || []).map(function (r) {
        return '<span class="dc-dist-item' + (r.act ? ' actable' : '') + (r.on ? ' on' : '') + '"' + attrsOf(r) + '><i style="background:' + (r.color || 'var(--panel-4)') + '"></i>' + esc(r.label) + '<b>' + fnum(Number(r.value) || 0) + '</b></span>';
      }).join('') + '</div>' +
    '</div>';
  }

  function gradeRowsOf(map, order) {
    return (order || ['S', 'A', 'B', 'C', 'D', '—']).filter(function (g) { return map[g]; }).map(function (g) {
      return { label: g === '—' ? '未评级' : g + ' 级', value: map[g], cls: 'g-' + (g === '—' ? 'na' : g.toLowerCase()), key: g };
    });
  }

  function renderShell() {
    const root = $('#viewData');
    if (!root) return;
    initTier();
    const slug = (D.currentSlug || '').toUpperCase();
    const st = sd();
    const comps = compsForTier(S.tier);
    const units = unitAgg(S.tier);
    const items = hasRealS18() ? itemRowsReal() : itemRowsFromComps(S.tier);
    const augs = hasRealS18() ? augRowsReal() : augRowsLegacy(S.tier);
    const cd = D.compData && D.compData[D.currentSlug];
    const meta = D.meta || {};
    const real = !!(cd && cd.comps && cd.comps.length);
    const heroStats = [
      { v: comps.length || '—', k: real ? '真实阵容' : '站内阵容', s: real ? 'OP.GG 段位快照' : 'Meta / 本地推断' },
      { v: units.length || '—', k: '上场棋子', s: '当前段位聚合' },
      { v: (items && items.length) || '—', k: hasRealS18() ? '装备统计' : '装备条目', s: hasRealS18() ? '真实对局样本' : '阵容携带聚合' },
      { v: (augs && augs.length) || '—', k: '强化符文', s: hasRealS18() ? '含专家评级' : '站内适配排序' }
    ];
    const patch = (st && st.patch) || (cd && cd.patch) || meta.updatedAt || '—';
    const fetched = (st && st.fetchedAt) || (cd && cd.fetchedAt) || meta.fetchedAt || meta.updatedAt || '';
    root.innerHTML =
      '<section class="dc-hero">' +
        '<div class="dc-hero-main">' +
          '<div class="dc-kicker">DATA CENTER · ' + esc(slug) + ' · PATCH ' + esc(patch) + '</div>' +
          '<h1 class="dc-title">数据中心</h1>' +
          '<p class="dc-sub">把当前赛季的真实阵容、装备对局统计、羁绊表现与强化符文拆成可检索的数据表：先看结论，再下钻到阵容、棋子与携带者。</p>' +
          '<div class="dc-hero-tags"><span>阵容 ' + comps.length + ' 套</span><span>段位 ' + esc(tierLabel()) + '</span><span>更新 ' + esc(String(fetched).slice(0, 16) || '—') + '</span><span>不估算缺失数据</span></div>' +
        '</div>' +
        '<div class="dc-hero-stats">' + heroStats.map(function (x) {
          return '<div class="dc-hs"><b>' + esc(String(x.v)) + '</b><span>' + esc(x.k) + '</span><em>' + esc(x.s) + '</em></div>';
        }).join('') + '</div>' +
      '</section>' +
      '<nav class="dc-tabs" id="dcTabs">' + TABS.map(function (t) {
        return '<button type="button" class="dc-tab' + (S.tab === t.key ? ' on' : '') + '" data-dc-act="tab" data-key="' + t.key + '">' +
          '<b>' + esc(t.name) + '</b><i>' + esc(t.short) + '</i></button>';
      }).join('') + '</nav>' +
      '<div class="dc-tierbar"><span class="dc-field-label">段位</span>' + tierList().map(function (t) {
        return chip('tier', t.key, t.label, S.tier === t.key);
      }).join('') + '<span class="dc-tier-note">筛选联动五张数据表</span>' +
        '<button type="button" class="btn btn-xs dc-share" data-dc-act="share">复制筛选链接</button></div>' +
      '<div id="dcBody"></div>';
    renderBody();
  }

  function renderBody() {
    const body = $('#dcBody');
    if (!body) return;
    let out;
    if (S.tab === 'units') out = renderUnits();
    else if (S.tab === 'items') out = renderItems();
    else if (S.tab === 'traits') out = renderTraits();
    else if (S.tab === 'augments') out = renderAugments();
    else out = renderExplorer();
    body.innerHTML = out;
    const input = $('#dcSearch');
    if (input && S._focusSearch) {
      input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) { }
      S._focusSearch = false;
    }
    syncUrl();
    saveMemory();
  }

  /* ==================== 渲染：数据检索器 ==================== */
  function explorerCharts(list) {
    const gm = countBy(list, function (cp) { return cp.tier || '—'; });
    const gradeRows = gradeRowsOf(gm, ['OP', 'S', 'A', 'B', 'C', 'D', '—']).map(function (r) {
      r.act = 'chartgrade';
      r.on = S.grades.indexOf(r.key) >= 0;
      return r;
    });
    const cm = {};
    list.forEach(function (cp) {
      (cp.units || []).forEach(function (u) {
        const c = Number(u.cost) || 0;
        if (c >= 1 && c <= 5) cm[c] = (cm[c] || 0) + 1;
      });
    });
    const costRows = COSTS.map(function (c) {
      return { label: c + ' 费', value: cm[c] || 0, cls: 'c' + c, act: 'chartcost', key: c, on: S.costs.indexOf(c) >= 0 };
    });
    const tm = {};
    list.forEach(function (cp) {
      (cp.traits || []).forEach(function (t) { if (t && t.name) tm[t.name] = (tm[t.name] || 0) + 1; });
    });
    const traitRows = Object.keys(tm).sort(function (a, b) { return tm[b] - tm[a]; }).slice(0, 6)
      .map(function (n) { return { label: n, value: tm[n], cls: 'trait', act: 'charttrait', key: n, on: S.trait === n }; });
    return '<div class="dc-charts">' +
      barChart('阵容评级分布', list.length + ' 套 · 点击筛选', gradeRows, { unit: ' 套' }) +
      barChart('上阵费用分布', '点击筛选费用', costRows, { unit: ' 次' }) +
      barChart('核心羁绊热度', '点击筛选羁绊', traitRows, { unit: ' 套' }) +
      '</div>';
  }

  function renderExplorer() {
    const comps = compsForTier(S.tier);
    const costs = S.costs;
    const q = S.q;
    const base = comps.filter(function (cp) {
      if (costs.length && !(cp.units || []).some(function (u) { return costs.indexOf(Number(u.cost)) >= 0; })) return false;
      if (S.trait && !(cp.traits || []).some(function (t) { return t.name === S.trait; })) return false;
      if (q && !matchQ(compHay(cp), q)) return false;
      return true;
    });
    const list = base.filter(function (cp) {
      return !S.grades.length || S.grades.indexOf(cp.tier || '—') >= 0;
    });
    const sorters = {
      avgPlace: function (a, b) { return (a.avgPlace || 99) - (b.avgPlace || 99); },
      top4: function (a, b) { return (b.top4Rate || 0) - (a.top4Rate || 0); },
      win: function (a, b) { return (b.winRate || 0) - (a.winRate || 0); },
      pick: function (a, b) { return (b.pickRate || 0) - (a.pickRate || 0); },
      games: function (a, b) { return (b.games || 0) - (a.games || 0); }
    };
    list.sort(sorters[S.sort] || sorters.avgPlace);

    const games = list.reduce(function (s, cp) { return s + (Number(cp.games) || 0); }, 0);
    const hasStats = list.some(function (cp) { return Number(cp.games) > 0; });
    const strong = list.filter(function (cp) { return cp.tier === 'S' || cp.tier === 'OP'; }).length;
    const rows = list.map(function (cp) {
      const traits = (cp.traits || []).slice().sort(function (a, b) { return (b.style || 0) - (a.style || 0); }).slice(0, 3);
      const picked = S.compare.indexOf(cp.id) >= 0;
      return '<tr class="dc-row' + (picked ? ' picked' : '') + '" tabindex="0" data-dc-act="comp" data-id="' + esc(cp.id) + '" title="查看阵容详情">' +
        '<td class="dc-col-pick"><button type="button" class="dc-pick' + (picked ? ' on' : '') + '" data-dc-act="cmptoggle" data-id="' + esc(cp.id) + '" aria-pressed="' + picked + '" title="' + (picked ? '移出对比' : '加入对比（最多 3 套）') + '">' + (picked ? '✓' : '+') + '</button></td>' +
        '<td>' + gtag(cp.tier) + '</td>' +
        '<td><div class="dc-name"><b>' + esc(cp.name) + '</b><i>' + esc(cp.mainC || '—') + ' · ' + (cp.units || []).length + ' 人 · ' + (cp.games ? fnum(cp.games) + ' 局' : '—') + '</i></div></td>' +
        '<td class="dc-col-opt"><div class="dc-tags">' + (traits.length ? traits.map(function (t) { return chipTag(t.name); }).join('') : '<span class="dim">—</span>') + '</div></td>' +
        '<td class="num strong">' + fplace(cp.avgPlace) + '</td>' +
        '<td class="num">' + fp(cp.top4Rate) + '</td>' +
        '<td class="num">' + fp(cp.winRate) + '</td>' +
        '<td class="num dc-col-opt">' + fp(cp.pickRate, 2) + '</td>' +
        '<td class="num">' + fnum(cp.games) + '</td>' +
        '</tr>';
    }).join('');

    return '<section class="dc-panel">' +
      '<div class="dc-toolbar">' + searchBox('搜索阵容 / 主C / 棋子 / 羁绊 / 装备') +
        '<div class="dc-chips"><span class="dc-field-label">费用</span>' + COSTS.map(function (c) {
          return chip('cost', c, c + '费', S.costs.indexOf(c) >= 0);
        }).join('') + '</div>' +
        selectBox('dcTrait', 'trait', [{ key: '', label: '全部羁绊' }].concat(traitOptions(comps).map(function (n) { return { key: n, label: n }; })), S.trait, '羁绊') +
        selectBox('dcSort', 'sort', [
          { key: 'avgPlace', label: '平均名次 ↑' }, { key: 'top4', label: '前四率 ↓' },
          { key: 'win', label: '登顶率 ↓' }, { key: 'pick', label: '选取率 ↓' }, { key: 'games', label: '对局数 ↓' }
        ], S.sort, '排序') +
        '<button type="button" class="btn btn-xs dc-cmp-open" data-dc-act="cmpopen"' + (S.compare.length < 2 ? ' disabled' : '') + '>对比已选 ' + S.compare.length + '/3</button>' +
        '<button type="button" class="btn btn-xs dc-reset" data-dc-act="reset">重置</button>' +
      '</div>' +
      kpis([
        { v: list.length, k: '匹配阵容', s: '共 ' + comps.length + ' 套' },
        { v: hasStats ? fnum(games) : '—', k: '对局样本', s: hasStats ? '当前筛选合计' : '该赛季无对局统计' },
        { v: fplace(wavg(list, 'avgPlace')), k: '加权均名', s: '按对局数加权' },
        { v: fp(wavg(list, 'top4Rate')), k: '加权前四率', s: strong + ' 套 S/OP' }
      ]) +
      explorerCharts(base) +
      '<div class="dc-table-wrap"><table class="dc-table"><thead><tr>' +
        '<th class="dc-col-pick">对比</th><th>评级</th><th>阵容</th><th class="dc-col-opt">核心羁绊</th><th class="num">均名</th><th class="num">前四</th><th class="num">登顶</th><th class="num dc-col-opt">选取</th><th class="num">对局</th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="9"><div class="dc-empty">当前筛选下没有阵容。试试放宽费用 / 羁绊条件。</div></td></tr>') + '</tbody></table></div>' +
      note('阵容与段位快照来自 OP.GG 中文站（' + esc(tierLabel()) + '，补丁 ' + esc(((D.compData && D.compData[D.currentSlug] && D.compData[D.currentSlug].patch) || (D.meta && D.meta.updatedAt) || '—')) + '）。均名越低越好；选取率为该段位阵容出场占比，非棋子选取率。' + (hasStats ? '' : ' 当前赛季没有对局统计，表格仅展示阵容结构。')) +
    '</section>';
  }

  /* ==================== 渲染：棋子大数据 ==================== */
  function renderUnits() {
    const all = unitAgg(S.tier);
    const q = S.q;
    const list = all.filter(function (u) {
      if (S.unitCosts.length && S.unitCosts.indexOf(u.cost) < 0) return false;
      if (S.unitTrait && u.traits.indexOf(S.unitTrait) < 0) return false;
      if (S.unitMainOnly && u.mainC <= 0) return false;
      if (q && !matchQ([u.name, u.id, u.traits.join(' ')].join(' ').toLowerCase(), q)) return false;
      return true;
    });
    const sorters = {
      comps: function (a, b) { return b.comps - a.comps; },
      main: function (a, b) { return b.mainC - a.mainC || b.comps - a.comps; },
      core: function (a, b) { return b.coreRate - a.coreRate || b.comps - a.comps; },
      avgPlace: function (a, b) { return (a.avgPlace || 99) - (b.avgPlace || 99); },
      pickShare: function (a, b) { return b.pickShare - a.pickShare; }
    };
    list.sort(sorters[S.unitSort] || sorters.comps);
    const traitOpts = (function () {
      const m = {};
      all.forEach(function (u) { u.traits.forEach(function (t) { m[t] = (m[t] || 0) + 1; }); });
      return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; });
    })();
    const rows = list.map(function (u, i) {
      return '<tr class="dc-row" tabindex="0" data-dc-act="unit" data-id="' + esc(u.id) + '" title="查看棋子详情">' +
        '<td class="rank">' + (i + 1) + '</td>' +
        '<td><div class="dc-name dc-with-av"><span class="dc-av lg">' + (champIcon(u.id) ? '<img src="' + esc(champIcon(u.id)) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') + '</span>' +
          '<span><b>' + esc(u.name) + '</b><i>' + esc(u.traits.slice(0, 2).join(' · ') || '—') + '</i></span></div></td>' +
        '<td><span class="dc-cost c' + (u.cost || 0) + '">' + (u.cost || '?') + '费</span></td>' +
        '<td class="num strong">' + u.comps + '</td>' +
        '<td class="num">' + fp(u.pickShare) + '</td>' +
        '<td class="num">' + (u.mainC || '—') + '</td>' +
        '<td class="num">' + fp(u.coreRate) + '</td>' +
        '<td class="num">' + fplace(u.avgPlace) + '</td>' +
        '<td class="num">' + fp(u.top4Rate) + '</td>' +
        '<td><div class="dc-items-cell">' + (u.topItems.length ? u.topItems.map(function (it) {
          return '<span class="dc-item-chip" title="' + esc(it.name) + ' ×' + it.count + '">' + (it.icon ? '<img src="' + esc(it.icon) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') + '</span>';
        }).join('') : '<span class="dim">—</span>') + '</div></td>' +
        '</tr>';
    }).join('');

    return '<section class="dc-panel">' +
      '<div class="dc-toolbar">' + searchBox('搜索棋子 / 羁绊') +
        '<div class="dc-chips"><span class="dc-field-label">费用</span>' + COSTS.map(function (c) {
          return chip('ucost', c, c + '费', S.unitCosts.indexOf(c) >= 0);
        }).join('') + '</div>' +
        selectBox('dcUTrait', 'utrait', [{ key: '', label: '全部羁绊' }].concat(traitOpts.map(function (n) { return { key: n, label: n }; })), S.unitTrait, '羁绊') +
        selectBox('dcUSort', 'usort', [
          { key: 'comps', label: '登场套数 ↓' }, { key: 'main', label: '主C次数 ↓' },
          { key: 'core', label: '核心率 ↓' }, { key: 'avgPlace', label: '平均名次 ↑' }, { key: 'pickShare', label: '登场率 ↓' }
        ], S.unitSort, '排序') +
        chip('umain', '1', '仅主C', S.unitMainOnly) +
        '<button type="button" class="btn btn-xs dc-reset" data-dc-act="reset">重置</button>' +
      '</div>' +
      kpis([
        { v: list.length, k: '覆盖棋子', s: '当前筛选' },
        { v: list.filter(function (u) { return u.mainC > 0; }).length, k: '有主C记录', s: '至少 1 套阵容' },
        { v: list.length ? fp(list[0].pickShare) : '—', k: '最高登场率', s: list.length ? list[0].name : '—' },
        { v: fplace(list.length ? Math.min.apply(null, list.map(function (u) { return u.avgPlace || 99; })) : null), k: '最佳均名', s: '当前筛选' }
      ]) +
      '<div class="dc-table-wrap"><table class="dc-table"><thead><tr>' +
        '<th class="rank">#</th><th>棋子</th><th>费用</th><th class="num">登场套数</th><th class="num">登场率</th><th class="num">主C</th><th class="num">核心率</th><th class="num">均名</th><th class="num">前四</th><th>常见装备</th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="10"><div class="dc-empty">当前筛选下没有棋子。</div></td></tr>') + '</tbody></table></div>' +
      note('登场率 = 携带该棋子的阵容套数 ÷ 当前段位阵容总数（' + compsForTier(S.tier).length + ' 套）；核心率 = 被标记为核心 / 主C 的阵容占比。这是阵容覆盖率，不是对局选取率。') +
    '</section>';
  }

  /* ==================== 渲染：装备评级 ==================== */
  function renderItems() {
    const real = hasRealS18();
    const all = real ? itemRowsReal() : itemRowsFromComps(S.tier);
    const q = S.q;
    const base = (all || []).filter(function (r) {
      if (q) {
        const hay = [r.name, r.desc, (r.wearers || []).map(function (w) { return w.name; }).join(' '), (r.recipeNames || []).join(' ')].join(' ').toLowerCase();
        if (!matchQ(hay, q)) return false;
      }
      return true;
    });
    const list = base.filter(function (r) { return S.itemCat === 'all' || r.category === S.itemCat; });
    const sorters = {
      grade: function (a, b) { return (GRADE_RANK[a.grade] || 6) - (GRADE_RANK[b.grade] || 6) || (a.avgPlace || 99) - (b.avgPlace || 99); },
      avgPlace: function (a, b) { return (a.avgPlace || 99) - (b.avgPlace || 99); },
      top4: function (a, b) { return (b.top4Rate || 0) - (a.top4Rate || 0); },
      win: function (a, b) { return (b.winRate || 0) - (a.winRate || 0); },
      total: function (a, b) { return (b.total || 0) - (a.total || 0); }
    };
    list.sort(sorters[S.itemSort] || sorters.grade);
    const totalGames = list.reduce(function (s, r) { return s + (Number(r.total) || 0); }, 0);
    const top4W = list.reduce(function (s, r) { return s + (Number(r.top4Rate) || 0) * (Number(r.total) || 0); }, 0);
    const best = list.filter(function (r) { return r.grade === 'S' || r.grade === 'A'; }).length;
    const catMap = countBy(base, function (r) { return r.category || 'misc'; });
    const catRows = Object.keys(catMap).sort(function (a, b) { return catMap[b] - catMap[a]; })
      .map(function (k) {
        return { label: CAT_LABEL[k] || k, value: catMap[k], color: CAT_COLOR[k] || '#5d697d', act: 'chartcat', key: k, on: S.itemCat === k };
      });
    const rows = list.map(function (r) {
      return '<tr class="dc-row" tabindex="0" data-dc-act="item" data-id="' + esc(r.id) + '" title="查看装备详情">' +
        '<td>' + gtag(r.grade) + '</td>' +
        '<td><div class="dc-name dc-with-av"><span class="dc-av lg">' + (r.icon ? '<img src="' + esc(r.icon) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">' : '') + '</span>' +
          '<span><b>' + esc(r.name) + '</b><i>' + esc(CAT_LABEL[r.category] || r.category || '—') + '</i></span></div></td>' +
        '<td class="num">' + fnum(r.total) + '</td>' +
        '<td class="num">' + fp(r.top4Rate) + '</td>' +
        '<td class="num">' + fp(r.winRate) + '</td>' +
        '<td class="num strong">' + fplace(r.avgPlace) + '</td>' +
        '<td class="dc-col-opt">' + avatars(r.wearers, 4) + '</td>' +
        '<td class="dc-col-opt"><div class="dc-recipe">' + (r.recipeNames && r.recipeNames.length ? r.recipeNames.map(function (n) { return chipTag(n); }).join('') : '<span class="dim">—</span>') + '</div></td>' +
        '</tr>';
    }).join('');

    return '<section class="dc-panel">' +
      '<div class="dc-toolbar">' + searchBox('搜索装备 / 携带者 / 配方') +
        '<div class="dc-chips">' + ITEM_CATS.map(function (c) {
          return chip('icat', c.key, c.label, S.itemCat === c.key);
        }).join('') + '</div>' +
        selectBox('dcISort', 'isort', [
          { key: 'grade', label: '评级优先' }, { key: 'avgPlace', label: '平均名次 ↑' },
          { key: 'top4', label: '前四率 ↓' }, { key: 'win', label: '登顶率 ↓' }, { key: 'total', label: '出场数 ↓' }
        ], S.itemSort, '排序') +
        '<button type="button" class="btn btn-xs dc-reset" data-dc-act="reset">重置</button>' +
      '</div>' +
      kpis([
        { v: list.length, k: '装备条目', s: real ? 'S18 真实统计' : '阵容携带聚合' },
        { v: fnum(totalGames), k: '出场样本', s: '当前筛选合计' },
        { v: totalGames ? fp(top4W / totalGames) : '—', k: '加权前四率', s: '按出场数加权' },
        { v: best, k: 'S/A 评级', s: real ? '同类装备内分位' : '样本不足不评级' }
      ]) +
      '<div class="dc-charts one">' + distCard('装备类型分布', '点击筛选类型', catRows) + '</div>' +
      '<div class="dc-table-wrap"><table class="dc-table"><thead><tr>' +
        '<th>评级</th><th>装备</th><th class="num">出场</th><th class="num">前四</th><th class="num">登顶</th><th class="num">均名</th><th class="dc-col-opt">常见携带者</th><th class="dc-col-opt">配方</th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="8"><div class="dc-empty">当前筛选下没有装备。</div></td></tr>') + '</tbody></table></div>' +
      note(real
        ? '装备统计来自 OP.GG 中文站 S18（补丁 ' + esc((sd() && sd().patch) || '—') + '，全球 ' + esc((sd() && sd().tierScope) || 'ALL') + ' 段位）。评级在同类装备内按平均名次分位：S 前 12%、A 前 35%、B 前 65%、C 前 85%，其余 D；样本 <300 或同类不足 6 件不评级。'
        : '当前赛季没有官方装备对局统计，这里按阵容携带情况聚合，均名来自携带该装备的阵容；不生成胜率评级。') +
    '</section>';
  }

  /* ==================== 渲染：强化符文梯度榜 ==================== */
  function renderAugments() {
    const real = hasRealS18();
    if (!real && S.augSort === 'grade') S.augSort = 'fit';
    const all = real ? augRowsReal() : augRowsLegacy(S.tier);
    const q = S.q;
    const list = (all || []).filter(function (a) {
      if (S.augRarity !== 'all' && a.rarityKey !== S.augRarity) return false;
      if (real && S.augTier !== 'all' && a.grade !== S.augTier) return false;
      if (S.augTrait && a.fit.indexOf(S.augTrait) < 0) return false;
      if (q && !matchQ([a.name, a.desc].join(' ').toLowerCase(), q)) return false;
      return true;
    });
    const sorters = {
      grade: function (a, b) { return (GRADE_RANK[a.grade] || 6) - (GRADE_RANK[b.grade] || 6) || (RARITY_RANK[a.rarityKey] || 3) - (RARITY_RANK[b.rarityKey] || 3) || String(a.name).localeCompare(String(b.name), 'zh'); },
      rarity: function (a, b) { return (RARITY_RANK[a.rarityKey] || 3) - (RARITY_RANK[b.rarityKey] || 3) || (GRADE_RANK[a.grade] || 6) - (GRADE_RANK[b.grade] || 6); },
      fit: function (a, b) { return (b.fitScore || 0) - (a.fitScore || 0) || b.fit.length - a.fit.length; },
      name: function (a, b) { return String(a.name).localeCompare(String(b.name), 'zh'); }
    };
    list.sort(sorters[S.augSort] || sorters.grade);
    const fitOpts = (function () {
      const m = {};
      (all || []).forEach(function (a) { a.fit.forEach(function (t) { m[t] = (m[t] || 0) + 1; }); });
      return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; });
    })();
    const rated = (all || []).filter(function (a) { return a.grade !== '—'; }).length;
    const sTier = (all || []).filter(function (a) { return a.grade === 'OP' || a.grade === 'S'; }).length;
    const rarityMap = countBy(list, function (a) { return a.rarityKey || 'unknown'; });
    const rarityRows = [
      { label: '棱彩', value: rarityMap.prismatic || 0, color: '#c084fc' },
      { label: '金', value: rarityMap.gold || 0, color: '#f0c25a' },
      { label: '银', value: rarityMap.silver || 0, color: '#cbd5e1' }
    ];
    const gradeMap = countBy(list, function (a) { return a.grade || '—'; });
    const augGradeRows = ['OP', 'S', 'A', 'B', 'C', 'D', '—'].filter(function (g) { return gradeMap[g]; })
      .map(function (g) { return { label: g === '—' ? '未评级' : g + ' 级', value: gradeMap[g], color: GRADE_COLOR[g] }; });
    const rows = list.map(function (a) {
      return '<tr class="dc-row" tabindex="0" data-dc-act="aug" data-id="' + esc(a.id) + '" title="查看符文详情">' +
        '<td>' + (real ? gtag(a.grade) : '<span class="dc-fit">' + Math.round((a.fitScore || 0) * 100) + '</span>') + '</td>' +
        '<td><div class="dc-name dc-with-av"><span class="dc-av lg aug">' + (a.icon ? '<img src="' + esc(a.icon) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">' : '') + '</span>' +
          '<span><b>' + esc(a.name) + '</b><i>' + esc(a.rarity || '—') + '</i></span></div></td>' +
        '<td class="dc-col-rarity"><span class="dc-rarity r-' + esc(a.rarityKey || 'unknown') + '">' + esc(a.rarity || '—') + '</span></td>' +
        '<td class="dc-col-fit"><div class="dc-tags">' + (a.fit.length ? a.fit.map(function (t) { return chipTag(t); }).join('') : '<span class="dim">通用</span>') + '</div></td>' +
        '<td class="dc-desc dc-col-desc">' + esc(a.desc || '—') + '</td>' +
        '</tr>';
    }).join('');

    return '<section class="dc-panel">' +
      '<div class="dc-toolbar">' + searchBox('搜索符文名称 / 描述') +
        '<div class="dc-chips">' + RARITIES.map(function (r) {
          return chip('ararity', r.key, r.label, S.augRarity === r.key);
        }).join('') + '</div>' +
        (real ? '<div class="dc-chips"><span class="dc-field-label">评级</span>' + ['all'].concat(AUG_TIERS).map(function (g) {
          return chip('atier', g, g === 'all' ? '全部' : g, S.augTier === g);
        }).join('') + '</div>' : '') +
        selectBox('dcAFit', 'afit', [{ key: '', label: '全部羁绊' }].concat(fitOpts.map(function (n) { return { key: n, label: n }; })), S.augTrait, '适配羁绊') +
        selectBox('dcASort', 'asort', real ? [
          { key: 'grade', label: '评级优先' }, { key: 'rarity', label: '稀有度' },
          { key: 'fit', label: '适配羁绊数' }, { key: 'name', label: '名称' }
        ] : [
          { key: 'fit', label: '适配分 ↓' }, { key: 'rarity', label: '稀有度' }, { key: 'name', label: '名称' }
        ], S.augSort, '排序') +
        '<button type="button" class="btn btn-xs dc-reset" data-dc-act="reset">重置</button>' +
      '</div>' +
      kpis([
        { v: list.length, k: '符文条目', s: '当前筛选' },
        { v: real ? rated : '—', k: '有专家评级', s: real ? 'OP.GG 专家榜' : '当前赛季无评级' },
        { v: real ? sTier : '—', k: 'OP / S 级', s: real ? '高优先级' : '—' },
        { v: list.filter(function (a) { return a.fit.length > 0; }).length, k: '有羁绊关联', s: '描述命中 S18 羁绊' }
      ]) +
      '<div class="dc-charts' + (real ? ' two' : ' one') + '">' +
        distCard('稀有度分布', '当前筛选 ' + list.length + ' 条', rarityRows) +
        (real ? distCard('专家评级分布', 'OP.GG 专家榜', augGradeRows) : '') +
      '</div>' +
      '<div class="dc-table-wrap"><table class="dc-table dc-aug-table">' +
        '<colgroup><col class="c-grade"><col class="c-name"><col class="c-rarity"><col class="c-fit"><col class="c-desc"></colgroup>' +
        '<thead><tr>' +
        '<th>' + (real ? '评级' : '适配分') + '</th><th>符文</th><th class="dc-col-rarity">稀有度</th><th class="dc-col-fit">适配羁绊</th><th class="dc-col-desc">描述</th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="5"><div class="dc-empty">当前筛选下没有符文。</div></td></tr>') + '</tbody></table></div>' +
      note(real
        ? '符文目录与描述来自 Riot 官方 CommunityDragon S18 全量目录（' + (all || []).length + ' 条），少量官方缺数值的描述回退到 OP.GG 文本；专家评级来自 OP.GG 专家榜（源版本 ' + esc((sd() && sd().augments && sd().augments.tierSourceVersion) || '—') + '，仅覆盖部分符文）。「适配羁绊」优先取官方关联羁绊，缺失时按描述文本匹配，仅用于筛选，不代表胜率。'
        : '当前赛季没有官方符文胜率数据。「适配分」= 符文关联羁绊在阵容中的覆盖度，仅用于站内排序，不是胜率或强度结论。') +
    '</section>';
  }

  /* ==================== 弹窗：棋子 / 装备 / 符文 ==================== */
  function modalKpis(items) {
    return '<div class="dc-kpis modal">' + items.map(function (x) {
      return '<div class="dc-kpi"><div class="dc-kpi-v">' + x.v + '</div><div class="dc-kpi-k">' + esc(x.k) + '</div></div>';
    }).join('') + '</div>';
  }
  function bindModalCompLinks() {
    $$('#modalBody [data-dc-mcomp]').forEach(function (el) {
      el.onclick = function () {
        const id = el.getAttribute('data-dc-mcomp');
        TFT.UI.closeModal();
        setTimeout(function () { TFT.Main.openCompDetail(id); }, 70);
      };
    });
  }

  function openUnit(id) {
    const u = unitAgg(S.tier).filter(function (x) { return x.id === id; })[0];
    if (!u) return;
    const related = compsForTier(S.tier).filter(function (cp) {
      return (cp.units || []).some(function (x) { return (x.id || x.name) === id; });
    }).sort(function (a, b) { return (a.avgPlace || 99) - (b.avgPlace || 99); });
    const itemsHtml = u.topItems.length ? u.topItems.map(function (it) {
      return '<div class="dc-item-line"><span class="dc-av lg">' + (it.icon ? '<img src="' + esc(it.icon) + '" alt="" referrerpolicy="no-referrer">' : '') + '</span>' +
        '<b>' + esc(it.name) + '</b><em>出现在 ' + it.count + ' 套</em></div>';
    }).join('') : '<div class="dc-empty">该棋子没有记录到装备。</div>';
    const rows = related.map(function (cp) {
      return '<tr class="dc-row" data-dc-mcomp="' + esc(cp.id) + '">' +
        '<td>' + gtag(cp.tier) + '</td><td>' + esc(cp.name) + '</td>' +
        '<td class="num">' + fplace(cp.avgPlace) + '</td><td class="num">' + fp(cp.top4Rate) + '</td><td class="num">' + fnum(cp.games) + '</td></tr>';
    }).join('');
    const html =
      '<div class="dc-detail-head"><span class="dc-av xl">' + (champIcon(id) ? '<img src="' + esc(champIcon(id)) + '" alt="" referrerpolicy="no-referrer">' : '') + '</span>' +
        '<div><h3>' + esc(u.name) + ' <span class="dc-cost c' + u.cost + '">' + (u.cost || '?') + '费</span></h3>' +
        '<p>' + esc(u.traits.join(' · ') || '—') + '</p></div></div>' +
      modalKpis([
        { v: u.comps, k: '登场套数' }, { v: fp(u.pickShare), k: '阵容登场率' },
        { v: u.mainC, k: '主C次数' }, { v: fplace(u.avgPlace), k: '加权均名' }
      ]) +
      '<div class="dc-detail-grid"><div><div class="dc-subhead">常见装备</div>' + itemsHtml + '</div>' +
      '<div><div class="dc-subhead">最佳阵容</div>' + (u.best ? '<div class="dc-best" data-dc-mcomp="' + esc(u.best.id) + '">' + gtag(u.best.tier) + '<b>' + esc(u.best.name) + '</b><em>均名 ' + fplace(u.best.avgPlace) + '</em></div>' : '<div class="dc-empty">—</div>') + '</div></div>' +
      '<div class="dc-subhead">相关阵容 · ' + related.length + ' 套</div>' +
      '<div class="dc-table-wrap"><table class="dc-table"><thead><tr><th>评级</th><th>阵容</th><th class="num">均名</th><th class="num">前四</th><th class="num">对局</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      note('统计口径：' + esc(tierLabel()) + ' · 阵容覆盖率（' + compsForTier(S.tier).length + ' 套），非对局选取率。');
    TFT.UI.modal({ title: '棋子详情 · ' + u.name, size: 'wide', body: html });
    bindModalCompLinks();
  }

  function openItem(id) {
    const real = hasRealS18();
    const r = (real ? itemRowsReal() : itemRowsFromComps(S.tier)).filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    const wearers = (r.wearers || []).slice(0, 10);
    const rows = wearers.map(function (w) {
      return '<tr><td><div class="dc-name dc-with-av"><span class="dc-av">' + (champIcon(w.id) ? '<img src="' + esc(champIcon(w.id)) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') + '</span><b>' + esc(w.name) + '</b></div></td>' +
        '<td class="num">' + fnum(w.total) + '</td><td class="num">' + fplace(w.avgPlace) + '</td><td class="num">' + fp(w.top4Rate) + '</td></tr>';
    }).join('');
    const html =
      '<div class="dc-detail-head"><span class="dc-av xl">' + (r.icon ? '<img src="' + esc(r.icon) + '" alt="" referrerpolicy="no-referrer">' : '') + '</span>' +
        '<div><h3>' + esc(r.name) + ' <span class="dc-cat">' + esc(CAT_LABEL[r.category] || r.category || '—') + '</span></h3>' +
        '<p>' + esc(r.desc || r.stat || '—') + '</p></div></div>' +
      modalKpis([
        { v: gtag(r.grade), k: '评级' }, { v: fnum(r.total), k: '出场样本' },
        { v: fp(r.top4Rate), k: '前四率' }, { v: fplace(r.avgPlace), k: '平均名次' }
      ]) +
      (r.recipeNames && r.recipeNames.length ? '<div class="dc-subhead">合成配方</div><div class="dc-recipe">' + r.recipeNames.map(function (n) { return chipTag(n); }).join('') + '</div>' : '') +
      '<div class="dc-subhead">常见携带者 · ' + wearers.length + '</div>' +
      '<div class="dc-table-wrap"><table class="dc-table"><thead><tr><th>棋子</th><th class="num">场次</th><th class="num">均名</th><th class="num">前四</th></tr></thead><tbody>' + (rows || '<tr><td colspan="4"><div class="dc-empty">暂无携带者数据</div></td></tr>') + '</tbody></table></div>' +
      note(real ? '装备统计来自 OP.GG 中文站 S18（全球 ' + esc((sd() && sd().tierScope) || 'ALL') + ' 段位）；评级为同口径平均名次分位，样本 <300 不评级。' : '当前赛季无官方装备统计，数据由阵容携带聚合，均名来自携带该装备的阵容。');
    TFT.UI.modal({ title: '装备详情 · ' + r.name, size: 'wide', body: html });
  }

  function openTrait(name) {
    const a = traitAgg(S.tier).filter(function (x) { return x.name === name; })[0];
    if (!a) return;
    const related = compsForTier(S.tier).filter(function (cp) {
      return (cp.traits || []).some(function (t) { return t && t.name === name; });
    }).sort(function (x, y) { return (Number(y.games) || 0) - (Number(x.games) || 0); });
    const icon = traitIcon(name);
    const rows = related.map(function (cp) {
      return '<tr class="dc-row" data-dc-mcomp="' + esc(cp.id) + '">' +
        '<td>' + gtag(cp.tier) + '</td><td>' + esc(cp.name) + '</td>' +
        '<td class="num">' + fplace(cp.avgPlace) + '</td><td class="num">' + fp(cp.top4Rate) + '</td><td class="num">' + fnum(cp.games) + '</td></tr>';
    }).join('');
    const html =
      '<div class="dc-detail-head"><span class="dc-av xl">' + (icon ? '<img src="' + esc(icon) + '" alt="" referrerpolicy="no-referrer">' : '') + '</span>' +
        '<div><h3>' + esc(name) + ' ' + gtag(a.grade) + '</h3>' +
        '<p>平均激活 ' + (a.active ? (Math.round(a.active * 10) / 10) : '—') + ' · 收录 ' + a.comps + ' 套阵容</p></div></div>' +
      modalKpis([
        { v: a.grade, k: '评级' }, { v: fnum(a.games), k: '样本局数' },
        { v: fp(a.top4Rate), k: '加权前四率' }, { v: fplace(a.avgPlace), k: '加权均名' }
      ]) +
      '<div class="dc-subhead">包含该羁绊的阵容 · ' + related.length + '</div>' +
      '<div class="dc-table-wrap"><table class="dc-table"><thead><tr><th>评级</th><th>阵容</th><th class="num">均名</th><th class="num">前四</th><th class="num">对局</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="5"><div class="dc-empty">暂无阵容</div></td></tr>') + '</tbody></table></div>' +
      note('口径：统计包含「' + name + '」的阵容对局并按对局数加权，同一局可能同时计入多个羁绊；样本不足 800 局或少于 2 套阵容不评级。');
    TFT.UI.modal({ title: '羁绊详情 · ' + name, size: 'wide', body: html });
    bindModalCompLinks();
  }

  /* ==================== 弹窗：阵容对比 ==================== */
  const CMP_METRICS = [
    { k: '平均名次', sub: '越低越好', get: function (cp) { return cp.avgPlace; }, fmt: fplace, low: true },
    { k: '前四率', get: function (cp) { return cp.top4Rate; }, fmt: function (v) { return fp(v); } },
    { k: '登顶率', get: function (cp) { return cp.winRate; }, fmt: function (v) { return fp(v); } },
    { k: '选取率', get: function (cp) { return cp.pickRate; }, fmt: function (v) { return fp(v, 2); } },
    { k: '对局样本', get: function (cp) { return cp.games; }, fmt: fnum }
  ];

  function pickedComps() {
    const all = compsForTier(S.tier);
    return S.compare.map(function (id) {
      return all.filter(function (cp) { return cp.id === id; })[0];
    }).filter(Boolean);
  }

  function toggleCompare(id) {
    if (!id) return;
    const i = S.compare.indexOf(id);
    if (i >= 0) S.compare.splice(i, 1);
    else if (S.compare.length >= 3) {
      if (TFT.UI.toast) TFT.UI.toast('最多同时对比 3 套阵容', 'err');
      return;
    } else S.compare.push(id);
    renderBody();
  }

  function bestValue(list, m) {
    const vals = list.map(function (cp) {
      const v = Number(m.get(cp));
      return isFinite(v) && v > 0 ? v : null;
    }).filter(function (v) { return v != null; });
    const uniq = vals.filter(function (v, i) { return vals.indexOf(v) === i; });
    if (uniq.length < 2) return null;
    return m.low ? Math.min.apply(null, uniq) : Math.max.apply(null, uniq);
  }

  function cmpUnits(cp) {
    let us = (cp.coreUnits && cp.coreUnits.length ? cp.coreUnits : (cp.units || []).filter(function (u) {
      return u.core || u.tag === 'main' || u.tag === 'sub';
    }));
    if (!us.length) us = (cp.units || []).slice();
    us = us.slice().sort(function (a, b) { return (b.cost || 0) - (a.cost || 0); }).slice(0, 6);
    return us.map(function (u) {
      const id = u.id || u.name;
      const icon = u.icon || champIcon(id);
      const its = (u.items || []).slice(0, 3).map(function (iid) {
        const it = itemInfo(iid);
        if (!it) return '';
        return '<span class="dc-cmp-it" title="' + esc(it.name || iid) + '">' +
          (it.icon ? '<img src="' + esc(it.icon) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') + '</span>';
      }).join('');
      return '<div class="dc-cmp-unit"><span class="dc-av">' + (icon ? '<img src="' + esc(icon) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') + '</span>' +
        '<span class="dc-cmp-uname">' + esc(u.name || id) + '</span>' +
        '<span class="dc-cost c' + (Number(u.cost) || 0) + '">' + (u.cost || '?') + '</span>' +
        (its ? '<span class="dc-cmp-its">' + its + '</span>' : '') + '</div>';
    }).join('') || '<span class="dim">—</span>';
  }

  function cmpTraits(cp) {
    const ts = (cp.traits || []).slice().sort(function (a, b) {
      return (b.style || 0) - (a.style || 0) || (b.active || 0) - (a.active || 0);
    }).slice(0, 4);
    if (!ts.length) return '<span class="dim">—</span>';
    return ts.map(function (t) {
      return '<span class="dc-tag">' + esc(t.name) + ' ' + esc(String(t.active || 0) + '/' + String(t.need || 0)) + '</span>';
    }).join('');
  }

  function openCompare() {
    const list = pickedComps();
    if (list.length < 2) {
      if (TFT.UI.toast) TFT.UI.toast('至少勾选 2 套阵容再对比', 'err');
      return;
    }
    const cells = [];
    cells.push('<div class="dc-cmp-corner">对比项</div>');
    list.forEach(function (cp) {
      cells.push('<div class="dc-cmp-head">' +
        '<div class="dc-cmp-h1">' + gtag(cp.tier) + '<b>' + esc(cp.name) + '</b></div>' +
        '<i>' + esc(cp.mainC || '—') + ' · ' + (cp.units || []).length + ' 人</i></div>');
    });
    CMP_METRICS.forEach(function (m) {
      const best = bestValue(list, m);
      cells.push('<div class="dc-cmp-label">' + esc(m.k) + (m.sub ? '<em>' + esc(m.sub) + '</em>' : '') + '</div>');
      list.forEach(function (cp) {
        const v = m.get(cp);
        const hit = best != null && Number(v) === best;
        cells.push('<div class="dc-cmp-val' + (hit ? ' is-best' : '') + '">' + m.fmt(v) + '</div>');
      });
    });
    cells.push('<div class="dc-cmp-label">核心棋子</div>');
    list.forEach(function (cp) { cells.push('<div class="dc-cmp-cell">' + cmpUnits(cp) + '</div>'); });
    cells.push('<div class="dc-cmp-label">核心羁绊</div>');
    list.forEach(function (cp) { cells.push('<div class="dc-cmp-cell"><div class="dc-tags">' + cmpTraits(cp) + '</div></div>'); });
    cells.push('<div class="dc-cmp-label">操作</div>');
    list.forEach(function (cp) {
      cells.push('<div class="dc-cmp-cell"><button type="button" class="btn btn-xs" data-dc-mcomp="' + esc(cp.id) + '">查看攻略</button></div>');
    });
    const html =
      '<div class="dc-cmp-scroll"><div class="dc-cmp-grid" style="--n:' + list.length + '">' + cells.join('') + '</div></div>' +
      note('对比数据来自当前段位「' + esc(tierLabel()) + '」快照；每行数值中的高亮为该对比组最优，样本为 0 或缺失的项不参与比较。最多同时对比 3 套，窄屏可横向滑动查看全部列。');
    TFT.UI.modal({ title: '阵容对比 · ' + list.length + ' 套', size: 'wide', body: html });
    bindModalCompLinks();
  }

  function openAugment(id) {
    const real = hasRealS18();
    const a = (real ? augRowsReal() : augRowsLegacy(S.tier)).filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    const html =
      '<div class="dc-detail-head"><span class="dc-av xl aug">' + (a.icon ? '<img src="' + esc(a.icon) + '" alt="" referrerpolicy="no-referrer">' : '') + '</span>' +
        '<div><h3>' + esc(a.name) + '</h3><p><span class="dc-rarity r-' + esc(a.rarityKey || 'unknown') + '">' + esc(a.rarity || '—') + '</span>' +
        (real ? ' <span class="dc-grade g-' + esc(String(a.grade || '—').toLowerCase()) + '">' + esc(a.grade || '—') + '</span>' : '') + '</p></div></div>' +
      (real ? modalKpis([{ v: esc(a.grade || '—'), k: '专家评级' }, { v: a.fit.length, k: '适配羁绊' }, { v: esc((sd() && sd().patch) || '—'), k: '数据补丁' }]) : '') +
      '<div class="dc-subhead">符文描述</div><p class="dc-desc-full">' + esc(a.desc || '—') + '</p>' +
      '<div class="dc-subhead">适配羁绊</div><div class="dc-tags">' + (a.fit.length ? a.fit.map(function (t) { return chipTag(t); }).join('') : '<span class="dim">通用 / 未匹配到特定羁绊</span>') + '</div>' +
      note(real ? '专家评级来自 OP.GG 专家榜（源版本 ' + esc((sd() && sd().augments && sd().augments.tierSourceVersion) || '—') + '）；适配羁绊由描述文本匹配，仅用于筛选。' : '适配分基于符文关联羁绊在当前段位阵容中的覆盖度，不是胜率。');
    TFT.UI.modal({ title: '强化符文 · ' + a.name, size: '', body: html });
  }

  /* ==================== 交互 ==================== */
  function copyShareLink() {
    syncUrl();
    const url = location.origin + location.pathname + location.search + location.hash;
    const done = function (ok) {
      if (TFT.UI && TFT.UI.toast) TFT.UI.toast(ok ? '筛选链接已复制' : '复制失败，请手动复制地址栏', ok ? 'ok' : 'err');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); });
    } else done(false);
  }

  function switchTab(key) {
    if (!TABS.some(function (t) { return t.key === key; })) key = 'explorer';
    S.tab = key;
    S.q = '';
    try { history.replaceState(null, '', '#data/' + key); } catch (e) { }
    renderShell();
  }

  function resetFilters() {
    S.q = '';
    if (S.tab === 'explorer') { S.costs = []; S.trait = ''; S.sort = 'avgPlace'; S.compare = []; S.grades = []; }
    else if (S.tab === 'units') { S.unitCosts = []; S.unitTrait = ''; S.unitMainOnly = false; S.unitSort = 'comps'; }
    else if (S.tab === 'items') { S.itemCat = 'all'; S.itemSort = 'grade'; }
    else if (S.tab === 'traits') { S.traitGraded = false; S.traitSort = 'grade'; S.traitGrade = ''; }
    else if (S.tab === 'augments') { S.augRarity = 'all'; S.augTier = 'all'; S.augTrait = ''; S.augSort = 'grade'; }
    renderBody();
  }

  function onClick(e) {
    const el = e.target.closest('[data-dc-act]');
    if (!el) return;
    const act = el.getAttribute('data-dc-act');
    const key = el.getAttribute('data-key');
    if (act === 'tab') { switchTab(key); return; }
    if (act === 'share') { copyShareLink(); return; }
    if (act === 'tier') {
      S.tier = key;
      S.trait = '';
      S.unitTrait = '';
      S.compare = [];
      S.grades = [];
      S.traitGrade = '';
      renderShell();
      return;
    }
    if (act === 'comp') { TFT.Main.openCompDetail(el.getAttribute('data-id')); return; }
    if (act === 'cmptoggle') { toggleCompare(el.getAttribute('data-id')); return; }
    if (act === 'cmpopen') { openCompare(); return; }
    if (act === 'unit') { openUnit(el.getAttribute('data-id')); return; }
    if (act === 'item') { openItem(el.getAttribute('data-id')); return; }
    if (act === 'aug') { openAugment(el.getAttribute('data-id')); return; }
    if (act === 'traitinfo') { openTrait(key); return; }
    if (act === 'tgraded') { S.traitGraded = !S.traitGraded; renderBody(); return; }
    if (act === 'reset') { resetFilters(); return; }
    if (act === 'cost') {
      const c = Number(key), i = S.costs.indexOf(c);
      if (i >= 0) S.costs.splice(i, 1); else S.costs.push(c);
      renderBody(); return;
    }
    if (act === 'ucost') {
      const c = Number(key), i = S.unitCosts.indexOf(c);
      if (i >= 0) S.unitCosts.splice(i, 1); else S.unitCosts.push(c);
      renderBody(); return;
    }
    if (act === 'umain') { S.unitMainOnly = !S.unitMainOnly; renderBody(); return; }
    if (act === 'icat') { S.itemCat = key; renderBody(); return; }
    if (act === 'ararity') { S.augRarity = key; renderBody(); return; }
    if (act === 'atier') { S.augTier = key; renderBody(); return; }
    if (act === 'chartgrade') {
      const i = S.grades.indexOf(key);
      if (i >= 0) S.grades.splice(i, 1); else S.grades.push(key);
      renderBody(); return;
    }
    if (act === 'chartcost') {
      const c = Number(key), i = S.costs.indexOf(c);
      if (i >= 0) S.costs.splice(i, 1); else S.costs.push(c);
      renderBody(); return;
    }
    if (act === 'charttrait') { S.trait = (S.trait === key ? '' : key); renderBody(); return; }
    if (act === 'chartcat') { S.itemCat = (S.itemCat === key ? 'all' : key); renderBody(); return; }
    if (act === 'charttgrade') { S.traitGrade = (S.traitGrade === key ? '' : key); renderBody(); return; }
  }

  function onChange(e) {
    const el = e.target.closest('[data-dc-act]');
    if (!el) return;
    const act = el.getAttribute('data-dc-act');
    if (act === 'trait') { S.trait = el.value; renderBody(); }
    else if (act === 'sort') { S.sort = el.value; renderBody(); }
    else if (act === 'utrait') { S.unitTrait = el.value; renderBody(); }
    else if (act === 'usort') { S.unitSort = el.value; renderBody(); }
    else if (act === 'isort') { S.itemSort = el.value; renderBody(); }
    else if (act === 'tsort') { S.traitSort = el.value; renderBody(); }
    else if (act === 'afit') { S.augTrait = el.value; renderBody(); }
    else if (act === 'asort') { S.augSort = el.value; renderBody(); }
  }

  const lazyBody = U.debounce(function () {
    if (S.q) S._focusSearch = true;
    renderBody();
  }, 260);

  function onInput(e) {
    if (e.target && e.target.id === 'dcSearch') {
      S.q = e.target.value;
      lazyBody();
    }
  }

  function onKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('tr[data-dc-act], [data-dc-act][role="button"]');
    if (!row) return;
    e.preventDefault();
    row.click();
  }

  DC.init = function () {
    const root = $('#viewData');
    if (!root || root._dcBound) return;
    root._dcBound = true;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKeydown);
  };

  DC.render = function () {
    DC.init();
    const raw = location.hash.slice(1);
    const m = /^data\/(\w+)(?:\?(.*))?$/.exec(raw);
    const tab = m && TABS.some(function (t) { return t.key === m[1]; }) ? m[1] : 'explorer';
    const hasQuery = !!(m && m[2] != null);
    S.tab = tab;
    S.q = '';
    initTier();
    if (hasQuery) {
      const sp = new URLSearchParams(m[2]);
      const t = sp.get('tier');
      const tiers = tierList().map(function (x) { return x.key; });
      if (t && tiers.indexOf(t) >= 0) S.tier = t;
      applyFilters(readParams(sp));
    } else {
      restoreMemory();
    }
    renderShell();
  };

  DC.open = function (tab) {
    const key = TABS.some(function (t) { return t.key === tab; }) ? tab : 'explorer';
    S.tab = key;
    S.q = '';
    try { history.replaceState(null, '', '#data/' + key); } catch (e) { }
    if (TFT.Main && TFT.Main.go) TFT.Main.go('data');
    else { try { location.hash = '#data/' + key; } catch (e) { } }
  };
})(window.TFT);
