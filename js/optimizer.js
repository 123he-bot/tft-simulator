/* ============ optimizer.js —— 阵容优化引擎（纯规则，无伪造胜率） ============ */
window.TFT = window.TFT || {};
(function (TFT) {
  'use strict';
  const U = TFT.U, D = TFT.D;
  const Opt = TFT.Optimize = {};

  /* ---- 权重配置 ---- */
  const TIER_W = { S: 5, A: 4, B: 3, C: 2, D: 1 };
  const STYLE_W = { 4: 12, 3: 8, 2: 5, 1: 3 };       // 羁绊 style → 分
  const GOLD_PER_D = 2;                               // 一次刷新 2 金
  const BUY_COST_PER = 2;                             // 粗估买一张卡 2 金（含 D 成本）

  /* ---- 辅助：把 boardList/benchList 转成 champId → 拥有数（按星级累计） ---- */
  function ownedDict(units) {
    const m = {};
    (units || []).forEach(function (u) {
      if (!u) return;
      const cid = u.champId || ((D.champByName && D.champByName(u.name)) || {}).id;
      if (!cid) return;
      m[cid] = (m[cid] || 0) + (u.star || 1);
    });
    return m;
  }

  /* ---- 辅助：给定 champId 数组，算激活羁绊列表 ---- */
  function activeTraitsOfIds(unitIds) {
    const counts = {};
    (unitIds || []).forEach(function (cid) {
      const c = D.champ(cid);
      if (!c) return;
      (c.traits || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    const defs = D.traits();
    const out = [];
    Object.keys(counts).forEach(function (name) {
      const def = defs.find(t => t.name === name);
      if (!def || !def.levels || !def.levels.length) return;
      let level = null;
      def.levels.forEach(function (lv) { if (counts[name] >= lv.min) level = lv; });
      if (!level) return;
      out.push({
        name: name,
        count: counts[name],
        min: level.min,
        style: level.style || 1,
        prismatic: (level.style || 1) >= 4
      });
    });
    out.sort(function (a, b) {
      if (b.style !== a.style) return b.style - a.style;
      return b.count - a.count;
    });
    return out;
  }

  /* 对外：给一套 champId 打分，返回 { score, traits, maxCost, unique, traitScore } */
  Opt.scoreUnitIds = function (unitIds) {
    const traits = activeTraitsOfIds(unitIds);
    let traitScore = traits.reduce(function (s, t) { return s + (STYLE_W[t.style] || 3); }, 0);
    let maxCost = 0, totalCost = 0, unique = 0;
    const seen = new Set();
    (unitIds || []).forEach(function (cid) {
      const c = D.champ(cid);
      if (!c) return;
      totalCost += c.cost;
      if (c.cost > maxCost) maxCost = c.cost;
      if (!seen.has(cid)) { seen.add(cid); unique += 1; }
    });
    return {
      score: traitScore * 10 + maxCost * 3 + unique * 1.2,
      traitScore: traitScore,
      traits: traits,
      maxCost: maxCost,
      totalCost: totalCost,
      unique: unique
    };
  };

  /* 辅助：算 owned 和 meta comp 的匹配度（重叠棋子占 meta comp 的比例） */
  function matchRatio(ownedIds, metaUnits) {
    if (!metaUnits || !metaUnits.length) return 0;
    const ownedSet = new Set(ownedIds);
    let hit = 0;
    metaUnits.forEach(function (mu) {
      const c = D.champByName(mu.name);
      if (c && ownedSet.has(c.id)) hit += 1;
    });
    return hit / metaUnits.length;
  }

  /*
   * 主函数：候选目标阵容
   * 输入 currentUnits：[{champId, name, star}, ...] 可以是 boardList + benchList 合并
   * 返回 top 候选数组（已按匹配度 + 强度排序）
   */
  Opt.transitions = function (currentUnits, opts) {
    opts = opts || {};
    const owned = ownedDict(currentUnits);
    const ownedIds = Object.keys(owned);
    /* 阵容数据来自 D.meta.tiers（按 S/A/B/C 分档），展平成一套 */
    const tiersMap = (D.meta && D.meta.tiers) ? D.meta.tiers : {};
    const meta = [];
    Object.keys(tiersMap).forEach(function (t) {
      (tiersMap[t] || []).forEach(function (cp) { meta.push(cp); });
    });
    if (!meta.length) return [];

    const scored = meta.map(function (cp) {
      const mr = matchRatio(ownedIds, cp.units);
      const tw = TIER_W[cp.tier] || 2;
      // strength 是负数（-0.1 ~ -1.0），偏移成 0~1 参与排序
      const str = ((cp.strength || 0) + 1.2) / 1.2;
      const score = mr * 60 + tw * 10 + str * 5;
      return { cp: cp, mr: mr, score: score };
    }).sort(function (a, b) { return b.score - a.score; });

    return scored.slice(0, opts.topN || 8).map(function (s) {
      const unitIds = s.cp.units
        .map(function (mu) { return (D.champByName(mu.name) || {}).id; })
        .filter(Boolean);
      const sc = Opt.scoreUnitIds(unitIds);
      return {
        id: s.cp.id,
        name: s.cp.name,
        tier: s.cp.tier,
        matchRatio: Math.round(s.mr * 100),
        transitionScore: Math.round(s.score),
        traitScore: Math.round(sc.traitScore),
        finalScore: Math.round(sc.score),
        traits: sc.traits,
        mainC: s.cp.mainC,
        units: s.cp.units,
        positionMap: s.cp.positionMap,
        strength: s.cp.strength,
        counters: s.cp.counters,
        source: s.cp.source
      };
    });
  };

  /*
   * 辅助：粗估 D 牌成本（按「已拥有数 vs 目标数」算还需刷新次数）
   */
  function refreshEstimate(targetCost, haveCount, poolSize, oddsAtLevel, level) {
    // 简化版：按 level 下该费用概率 / poolSize / 2（一半概率拿到）算期望 D 次数
    if (!poolSize || !oddsAtLevel) return 0;
    const chance = (oddsAtLevel / 100) / poolSize;
    const need = Math.max(0, targetCost - haveCount);
    if (!need) return 0;
    const expectedRolls = Math.ceil(need / Math.max(chance * 5, 0.01));
    return expectedRolls * GOLD_PER_D;
  }

  /*
   * 过渡步骤：给定目标阵容 + 当前 state，算具体该做什么
   * 返回 { target, keepCount, toGet:[], toSell:[], goldNeeded, expNeeded, levelNow, levelTarget, strategy }
   */
  Opt.nextSteps = function (currentUnits, targetComp, state) {
    const s = state || { level: 8, gold: 0 };
    const owned = ownedDict(currentUnits);
    const ownedIds = Object.keys(owned);

    const targetUnits = targetComp.units || [];
    const targetChamps = targetUnits.map(function (mu) {
      return D.champByName(mu.name) || null;
    }).filter(Boolean);

    // ① 要拿 / 要升星
    const toGet = [];
    // ② 可以卖（不在目标里，或星级不足的重复）
    const toSell = [];

    const inTarget = new Set(targetChamps.map(function (c) { return c.id; }));
    const needStar = {};
    targetUnits.forEach(function (mu) {
      const c = D.champByName(mu.name);
      if (c) needStar[c.id] = Math.max(needStar[c.id] || 1, mu.star || 1);
    });

    (currentUnits || []).forEach(function (u) {
      const cid = u.champId || ((D.champByName && D.champByName(u.name)) || {}).id;
      if (!cid) return;
      const ch = D.champ(cid);
      if (!inTarget.has(cid)) {
        toSell.push({
          champId: cid,
          name: ch ? ch.name : u.name,
          cost: ch ? ch.cost : 1,
          star: u.star || 1,
          reason: '不在目标阵容'
        });
      } else if ((u.star || 1) < (needStar[cid] || 1)) {
        toGet.push({
          champId: cid,
          name: ch ? ch.name : u.name,
          cost: ch ? ch.cost : 1,
          star: needStar[cid] || 1,
          reason: '需升星到 ' + needStar[cid] + '★'
        });
      }
    });

    targetChamps.forEach(function (c) {
      if (!ownedIds.includes(c.id)) {
        toGet.push({
          champId: c.id,
          name: c.name,
          cost: c.cost,
          star: 1,
          reason: '缺失核心棋子'
        });
      }
    });

    // 去重 toGet（同名同星保留一条，cost 取最大）
    const seenGet = {};
    const toGetClean = toGet.filter(function (g) {
      const k = g.champId + '_' + g.star;
      if (seenGet[k]) return false;
      seenGet[k] = g;
      return true;
    }).sort(function (a, b) { return b.cost - a.cost || b.star - a.star; });

    // 去重 toSell（同名同星只保留一条，数一下重复数量）
    const seenSell = {};
    const toSellClean = toSell.filter(function (g) {
      const k = g.champId + '_' + g.star;
      if (seenSell[k]) { seenSell[k].dup = (seenSell[k].dup || 1) + 1; return false; }
      seenSell[k] = g;
      return true;
    }).sort(function (a, b) { return b.star - a.star || b.cost - a.cost; });

    // ③ 金币估算
    const levelNow = s.level || 8;
    const pool = U.poolStatus();
    const odds = U.rollOdds(levelNow);
    let goldNeeded = 0;
    toGetClean.forEach(function (g) {
      const chance = (odds[(g.cost - 1)] / 100);
      const poolSize = Object.keys(pool).filter(function (id) {
        const ch = D.champ(id); return ch && ch.cost === g.cost;
      }).length;
      const goldForThis = refreshEstimate(chance > 0 ? 1 : 0, 0, poolSize, chance, levelNow) + BUY_COST_PER;
      goldNeeded += goldForThis;
    });
    // 卖出回补
    const sellRefund = toSellClean.reduce(function (sum, t) {
      // 简化：1星 2金，2星 6金，3星 15金
      const refund = (t.star || 1) === 1 ? 2 : (t.star === 2 ? 6 : 15);
      const extra = (t.dup || 1) * refund;
      return sum + extra;
    }, 0);

    // ④ 等级 / 经验估算
    const currentPop = (currentUnits || []).length;
    const levelTarget = Math.min(11, targetChamps.length);
    let expNeeded = 0;
    let goldForLevel = 0;
    for (let lv = levelNow; lv < levelTarget; lv++) {
      expNeeded += U.expToNext(lv);
      goldForLevel += Math.ceil(U.expToNext(lv) / 2); // 粗估每 2 经验 ≈ 1 金（不算利息和连胜）
    }

    // ⑤ 下一步策略
    let strategy = '先 D 牌找缺失棋子';
    if (expNeeded > 0 && s.gold >= goldForLevel && currentPop < levelTarget && currentPop >= levelNow) {
      strategy = '金币足够上人口（' + levelNow + ' → ' + levelTarget + '），优先上人口';
    } else if (toGetClean.length === 0) {
      strategy = '目标阵容已基本成型，可以继续 D 找升星';
    } else if (toGetClean.length <= 2 && sellRefund >= 20) {
      strategy = '卖掉低优先级棋子回收 ' + sellRefund + ' 金币再 D';
    }

    return {
      target: targetComp.name,
      tier: targetComp.tier,
      matchRatio: targetComp.matchRatio,
      keepCount: Object.keys(owned).filter(function (cid) { return inTarget.has(cid); }).length,
      targetSize: targetChamps.length,
      toGet: toGetClean,
      toSell: toSellClean,
      sellRefund: sellRefund,
      goldNeeded: Math.max(0, goldNeeded - sellRefund),
      expNeeded: expNeeded,
      goldForLevel: goldForLevel,
      levelNow: levelNow,
      levelTarget: levelTarget,
      strategy: strategy,
      finalScore: targetComp.finalScore,
      traits: targetComp.traits
    };
  };

  /* 辅助：读取当前 state 合并成 currentUnits 数组 */
  Opt.currentUnits = function () {
    const board = (TFT.state && TFT.state.boardList) ? TFT.state.boardList() : [];
    const bench = (TFT.state && TFT.state.benchList) ? TFT.state.benchList() : [];
    return board.concat(bench).map(function (u) {
      if (!u) return null;
      return { champId: u.champId, name: (D.champ(u.champId) || {}).name, star: u.star || 1 };
    }).filter(Boolean);
  };

})(window.TFT);
