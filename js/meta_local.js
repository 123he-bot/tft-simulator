/* ============ meta_local.js —— 非 MetaTFT 赛季的本地推断阵容榜 ============ */
/* 仅使用该赛季官方真实字段（棋子 / 费用 / 羁绊阈值 / 职业 / 射程）做规则推断，
   不引入任何伪造胜率或遥测口径；界面需明确标注「本地推断 · 非 MetaTFT 胜率」。 */
window.TFT = window.TFT || {};
(function (TFT) {
  'use strict';
  const D = TFT.D;
  const LM = TFT.LocalMeta = {};
  const CACHE = {};
  const MAX_COMPS = 24;
  const SIZE = 8;

  function needOf(def, count) {
    if (!def || !def.levels || !def.levels.length) return count;
    const ups = def.levels.filter(l => l.min > count).sort((a, b) => a.min - b.min);
    return ups.length ? ups[0].min : def.levels[def.levels.length - 1].min;
  }
  function styleOf(def, count) {
    if (!def || !def.levels) return 0;
    let st = 0;
    def.levels.forEach(l => { if (count >= l.min) st = l.style || 1; });
    return st;
  }
  function rowOf(c) {
    const role = c.role || '';
    const rng = Number(c.range || 1);
    if (/Tank/i.test(role)) return 3;
    if (rng <= 1) return 2;
    if (rng <= 2) return 2;
    return 1;
  }
  /* 站位：按职业/射程分行，列居中排布且不重叠 */
  function positionMapOf(units, byName) {
    const cols = [3, 4, 2, 5, 1, 6, 2, 5, 0, 6, 1, 4];
    const used = {};
    const out = [];
    units.forEach(function (u, i) {
      const c = byName[u.name] || {};
      let row = rowOf(c);
      used[row] = used[row] || [];
      let col = cols[i % cols.length];
      while (used[row].indexOf(col) >= 0) col = (col + 1) % 7;
      used[row].push(col);
      out.push([row, col, u.name]);
    });
    return out;
  }

  function buildOne(carry, champs, traitDef, byName) {
    const picked = [carry];
    const coreTraits = carry.traits || [];
    const pool = champs.filter(c => c.id !== carry.id)
      .sort((a, b) => (b.cost - a.cost) || String(a.name).localeCompare(String(b.name), 'zh'));

    const countsNow = function () {
      const m = {};
      picked.forEach(p => (p.traits || []).forEach(t => { m[t] = (m[t] || 0) + 1; }));
      return m;
    };

    while (picked.length < SIZE) {
      const counts = countsNow();
      let best = null, bestScore = -1e9;
      pool.forEach(function (c) {
        if (picked.some(p => p.id === c.id)) return;
        let sc = (c.cost || 1) * 2;
        (c.traits || []).forEach(function (t) {
          const cur = counts[t] || 0;
          const def = traitDef(t);
          if (!def) return;
          const hit = (def.levels || []).find(l => l.min === cur + 1);
          if (hit) sc += 9 * (hit.style || 1);
          else if (cur > 0) sc += 3;
        });
        if ((c.traits || []).some(t => coreTraits.indexOf(t) >= 0)) sc += 5;
        if (sc > bestScore) { bestScore = sc; best = c; }
      });
      if (!best) break;
      picked.push(best);
    }

    const counts = countsNow();
    const traits = Object.keys(counts).map(function (t) {
      const def = traitDef(t);
      return {
        name: t, active: counts[t], need: needOf(def, counts[t]),
        style: styleOf(def, counts[t])
      };
    }).sort((a, b) => (b.style - a.style) || (b.active - a.active));

    const units = picked.map(function (c, i) {
      const isMain = i === 0;
      return {
        name: c.name, cost: c.cost || 1,
        star: isMain ? (c.cost >= 4 ? 2 : 3) : (c.cost <= 2 ? 2 : 1),
        items: []
      };
    });

    const costSum = units.reduce((a, u) => a + u.cost, 0);
    const styleSum = traits.filter(t => t.style > 0).reduce((a, t) => a + t.style, 0);
    const score = costSum * 1.5 + styleSum * 6 + (carry.cost >= 5 ? 6 : 0);

    const mainTrait = traits.filter(t => t.style > 0)[0] || traits[0] || { name: '' };

    return {
      id: '', cluster: null,
      name: (mainTrait.name ? mainTrait.name + '·' : '') + carry.name,
      mainC: carry.name,
      units: units,
      traits: traits,
      positionMap: positionMapOf(units, byName),
      positioning: '按职业 / 射程自动排布（本地推断）',
      counters: { '克制': [], '被克制': [] },
      source: '本地推断',
      tier: '', strength: null,
      _score: score
    };
  }

  LM.build = function (slug) {
    slug = slug || D.currentSlug;
    if (CACHE[slug]) return CACHE[slug];

    const season = (D.raw || {})[slug] || null;
    const champs = (season && season.champions) || [];
    const tdefs = (season && season.traits) || [];
    const traitDef = n => tdefs.find(t => t.name === n) || null;
    const byName = {};
    champs.forEach(c => { byName[c.name] = c; });

    const empty = {
      set: String(slug || '').toUpperCase(), updatedAt: '', source: '本地推断',
      tiers: { S: [], A: [], B: [], C: [] }, traitRanking: [],
      heatCurve: { labels: [], series: [] }, counterGraph: { edges: [] },
      note: '本地推断：按该赛季真实棋子 / 羁绊 / 费用规则生成，不含胜率数据。'
    };
    if (!champs.length) { CACHE[slug] = empty; return empty; }

    /* 候选主C：3 费及以上，按费用降序 */
    const carries = champs.filter(c => (c.cost || 0) >= 3)
      .sort((a, b) => (b.cost - a.cost) || String(a.name).localeCompare(String(b.name), 'zh'))
      .slice(0, 40);

    const built = [], seen = {};
    carries.forEach(function (carry) {
      const cp = buildOne(carry, champs, traitDef, byName);
      const sig = cp.units.map(u => u.name).sort().join('|');
      if (seen[sig]) return;
      seen[sig] = true;
      built.push(cp);
    });

    built.sort((a, b) => b._score - a._score);
    const list = built.slice(0, MAX_COMPS);
    const n = list.length;

    /* 档位与强度：按本地分数排名切档（best 强度值最小，与 MetaTFT 排序口径一致） */
    list.forEach(function (cp, i) {
      const pct = n <= 1 ? 0 : i / (n - 1);
      cp.tier = pct < 0.15 ? 'S' : pct < 0.4 ? 'A' : pct < 0.75 ? 'B' : 'C';
      cp.strength = Number((-1.2 + 2.4 * pct).toFixed(2));
      cp.id = 'lm_' + slug + '_' + i;
      delete cp._score;
    });

    const tiers = { S: [], A: [], B: [], C: [] };
    list.forEach(cp => tiers[cp.tier].push(cp));

    /* 羁绊热度：统计各羁绊在榜单阵容中被激活的次数 */
    const traitHit = {};
    list.forEach(function (cp) {
      cp.traits.filter(t => t.active >= t.need).forEach(function (t) {
        traitHit[t.name] = (traitHit[t.name] || 0) + 1;
      });
    });
    const traitRanking = Object.keys(traitHit).map(k => ({ name: k, count: traitHit[k] }))
      .sort((a, b) => b.count - a.count).slice(0, 14);

    const meta = {
      set: String(slug || '').toUpperCase(), updatedAt: '', source: '本地推断',
      tiers: tiers, traitRanking: traitRanking,
      heatCurve: { labels: [], series: [] },
      counterGraph: { edges: [] },
      note: '本地推断：按该赛季真实棋子 / 羁绊 / 费用规则生成，不含胜率数据。'
    };
    CACHE[slug] = meta;
    return meta;
  };
})(window.TFT);
