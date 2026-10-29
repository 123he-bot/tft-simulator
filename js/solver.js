/* ============ solver.js —— 局面求解器（规则 + 牌池概率推算，不含任何官方胜率） ============ */
window.TFT = window.TFT || {};
(function (TFT) {
  'use strict';
  const D = TFT.D, U = TFT.U;
  const S = TFT.Solver = {};

  const ROLL_COST = 2;      // 一次刷新 2 金
  const SLOTS = 5;          // 商店 5 个槽位

  /* 当前赛季梯度榜里的全部阵容（含本地推断） */
  function allComps() {
    const tiers = (D.meta && D.meta.tiers) || {};
    const out = [];
    Object.keys(tiers).forEach(function (t) {
      (tiers[t] || []).forEach(function (cp) { out.push(cp); });
    });
    return out;
  }

  function champOf(mu) { return D.champByName(mu.name); }

  /* 单槽命中某张棋子的概率：该费用出现率 × 该棋子在费用池中的剩余占比 */
  function hitChance(champ, level) {
    if (!champ) return 0;
    const odds = U.rollOdds(level) || [];
    const pCost = (odds[champ.cost - 1] || 0) / 100;
    if (pCost <= 0) return 0;
    const sameCost = D.champions().filter(function (c) { return c.cost === champ.cost; });
    const pool = U.poolStatus();
    const total = sameCost.reduce(function (s, c) { return s + (pool[c.id] || 0); }, 0);
    if (!total) return 0;
    return pCost * ((pool[champ.id] || 0) / total);
  }

  /* 一次刷新至少命中 needed 中任意一张的概率 */
  function rollHit(needed, level) {
    let miss = 1;
    needed.forEach(function (c) { miss *= Math.pow(1 - hitChance(c, level), SLOTS); });
    return 1 - miss;
  }

  function pct(x) { return (Math.round(x * 1000) / 10).toFixed(1) + '%'; }

  function tierOf(cp) { return cp.tier || 'B'; }

  /* 单个候选的投入 / 概率测算 */
  function measure(cand, ctx) {
    const plan = TFT.Optimize.nextSteps(ctx.units, cand, { level: ctx.level, gold: ctx.gold });
    const neededChamps = (plan.toGet || []).map(function (g) { return D.champ(g.champId); }).filter(Boolean);
    const hit = neededChamps.length ? rollHit(neededChamps, ctx.level) : 1;
    const expectedRolls = neededChamps.length ? (hit > 0 ? Math.ceil(1 / hit) : 999) : 0;
    const buyCost = (plan.toGet || []).reduce(function (s, g) { return s + (g.cost || 1); }, 0);
    const rollGold = expectedRolls * ROLL_COST;
    const levelGold = plan.levelNow < plan.levelTarget ? plan.goldForLevel : 0;
    const netGold = Math.max(0, rollGold + buyCost + levelGold - (plan.sellRefund || 0));
    const gap = Math.max(0, netGold - ctx.gold);
    const affordableRolls = Math.floor(Math.max(0, ctx.gold + (plan.sellRefund || 0) - buyCost - levelGold) / ROLL_COST);
    const completeProb = neededChamps.length ? (1 - Math.pow(1 - hit, Math.max(0, affordableRolls))) : 1;

    return {
      plan: plan,
      hit: hit,
      expectedRolls: expectedRolls,
      rollGold: rollGold,
      buyCost: buyCost,
      netGold: netGold,
      gap: gap,
      affordableRolls: affordableRolls,
      completeProb: completeProb,
      neededChamps: neededChamps
    };
  }

  /* 风险等级：只看“钱够不够 / 概率高不高 / 血线” */
  function riskOf(m, ctx) {
    const notes = [];
    let score = 0;
    if (m.gap > 0) {
      score += 2;
      notes.push('还差 ' + m.gap + ' 金才能按期望完成，需要先吃 1~2 回合利息或卖牌');
    }
    if (m.hit > 0 && m.hit < 0.12) {
      score += 1;
      notes.push('当前等级单刷命中率仅 ' + pct(m.hit) + '，属于低概率事件，不要 all-in');
    }
    if (ctx.hp <= 40) {
      score += 2;
      notes.push('血量 ' + ctx.hp + '，容错低，应优先即时战力而不是长期经济');
    } else if (ctx.hp <= 60) {
      score += 1;
      notes.push('血量 ' + ctx.hp + '，可以再吃 1 回合利息，但别拖到 30 以下');
    }
    if (m.completeProb < 0.5 && m.gap > 0) score += 1;
    const level = score >= 4 ? '高' : score >= 2 ? '中' : '低';
    return { level: level, notes: notes };
  }

  /* 三条回合动作 */
  function stepsOf(route, ctx) {
    const p = route.plan;
    const steps = [];
    const getNames = (p.toGet || []).map(function (g) { return g.name; });

    if ((p.toSell || []).length && p.sellRefund > 0) {
      const names = p.toSell.map(function (s) { return s.name + (s.star > 1 ? '★'.repeat(s.star) : ''); });
      steps.push({
        when: '现在',
        action: '卖掉 ' + names.slice(0, 3).join('、') + (names.length > 3 ? ' 等' : '') + '，回收 ' + p.sellRefund + ' 金',
        detail: '这些棋子不在目标阵容里，留着只占格子和经济'
      });
    }

    if (p.levelNow < p.levelTarget) {
      if (ctx.gold >= p.goldForLevel) {
        steps.push({
          when: '本回合',
          action: '上人口 ' + p.levelNow + ' → ' + p.levelTarget,
          detail: '需 ' + p.expNeeded + ' 经验，约 ' + p.goldForLevel + ' 金；人口越高，高费卡出现率越高'
        });
      } else {
        steps.push({
          when: '本回合',
          action: '存钱到 ' + p.goldForLevel + ' 金再上人口',
          detail: '当前 ' + ctx.gold + ' 金，差 ' + Math.max(0, p.goldForLevel - ctx.gold) + ' 金；先吃利息不要 D'
        });
      }
    }

    if (getNames.length) {
      steps.push({
        when: '随后',
        action: 'D 牌找 ' + getNames.slice(0, 4).join('、') + (getNames.length > 4 ? ' 等 ' + getNames.length + ' 张' : ''),
        detail: p.levelNow + ' 级下单刷命中 ' + pct(route.hit) + '，期望 ' + route.expectedRolls + ' 刷（约 ' + route.rollGold + ' 金）；' +
          (route.affordableRolls > 0 ? '现有金币最多支撑 ' + route.affordableRolls + ' 刷' : '现有金币不足一刷，先攒钱')
      });
    } else {
      const mc = D.champByName(route.mainC);
      steps.push({
        when: '随后',
        action: '停止 D 牌，把金币转成终局战力',
        detail: '目标阵容棋子已齐，继续刷只会摊薄经济'
      });
      if (mc && mc.cost <= 3) {
        steps.push({
          when: '优先级',
          action: '把 ' + route.mainC + ' 追到 3★',
          detail: '低费核心追三星的单卡提升最大，通常优于拉人口'
        });
      } else if (p.levelNow < 9) {
        steps.push({
          when: '优先级',
          action: '上 9 人口，补第 9 个棋子',
          detail: '阵容已成型时，人口是边际收益最高的方向'
        });
      } else {
        steps.push({
          when: '优先级',
          action: '保持经济，准备终局站位',
          detail: '人口与棋子都到位后，胜负主要取决于站位与装备对位'
        });
      }
    }

    if (ctx.threat) {
      const weak = (route.counters && route.counters['被克制']) || [];
      if (weak.indexOf(ctx.threat) >= 0) {
        steps.push({
          when: '注意',
          action: '对手「' + ctx.threat + '」克制本阵容',
          detail: '梯度数据里这套阵容被它克制，建议改走另一条路线，或提前做针对性装备/站位'
        });
      } else {
        const strong = (route.counters && route.counters['克制']) || [];
        if (strong.indexOf(ctx.threat) >= 0) {
          steps.push({
            when: '机会',
            action: '本阵容克制对手「' + ctx.threat + '」',
            detail: '对位占优，可以更主动地压人口、打连胜'
          });
        }
      }
    }

    /* 成型后的装备收尾（阵容方案里已有的出装，不额外编造） */
    const mainUnit = (route.units || []).find(function (u) { return u.name === route.mainC; }) ||
      (route.units || [])[0];
    const itemNames = mainUnit && mainUnit.items ?
      mainUnit.items.map(function (it) { return it.name; }).filter(Boolean) : [];
    if (itemNames.length) {
      steps.push({
        when: '成型后',
        action: '给 ' + mainUnit.name + ' 做装备：' + itemNames.join(' / '),
        detail: '出装来自该阵容方案；装备到位通常比多追一个二星更影响战力'
      });
    }

    if (steps.length < 2) {
      steps.push({
        when: '本回合',
        action: '留 ' + ctx.gold + ' 金吃利息，观察装备散件与对手',
        detail: '当前没有必须立刻执行的操作，先保经济再等关键棋子'
      });
    }

    return steps.slice(0, 4);
  }

  /* “为什么”清单：全部来自站内真实字段 */
  function whyOf(route, ctx) {
    const p = route.plan;
    const why = [];
    if (route.traits && route.traits.length) {
      why.push('羁绊：' + route.traits.slice(0, 3).map(function (t) {
        return t.name + ' ' + t.count + '/' + t.min;
      }).join('、') + '，其中 ' + route.traits.filter(function (t) { return t.style >= 3; }).length + ' 条达到金/棱镜档');
    }
    why.push('成型度：已保留 ' + p.keepCount + '/' + p.targetSize + ' 个目标棋子，匹配度 ' + route.matchRatio + '%');
    if (route.neededChamps.length) {
      const key = route.neededChamps.slice().sort(function (a, b) { return b.cost - a.cost; })[0];
      why.push('牌池：核心缺口 ' + key.name + '（' + key.cost + ' 费）单槽 ' + pct(hitChance(key, ctx.level)) +
        '，一次刷新命中 ' + pct(route.hit) + '；剩余 ' + ((U.poolStatus()[key.id] || 0)) + ' 张可抓');
    }
    why.push('经济：按期望需 ' + route.netGold + ' 金（含买牌 ' + route.buyCost + ' 金 / 刷新 ' + route.rollGold + ' 金），' +
      '现有 ' + ctx.gold + ' 金，缺口 ' + route.gap + ' 金');
    why.push('评级：' + tierOf(route) + ' 档 · 终局评分 ' + route.finalScore + '（站内规则引擎口径，不含官方胜率）');
    return why;
  }

  /*
   * 主入口
   * input: {units, level, gold, hp, threat}
   * 返回 {routes:[{intent,name,tier,mainC,...}], note}
   */
  S.solve = function (input) {
    input = input || {};
    const ctx = {
      units: input.units || (TFT.Optimize ? TFT.Optimize.currentUnits() : []),
      level: input.level || (TFT.state && TFT.state.level) || 8,
      gold: input.gold == null ? ((TFT.state && TFT.state.gold) || 0) : input.gold,
      hp: input.hp == null ? ((TFT.state && TFT.state.hp) || 100) : input.hp,
      threat: input.threat || ''
    };

    const candidates = TFT.Optimize.transitions(ctx.units, { topN: 12 });
    if (!candidates.length) return { routes: [], note: '当前赛季没有可用的阵容数据，请先切换赛季' };

    const measured = candidates.map(function (c) {
      const m = measure(c, ctx);
      const route = {
        id: c.id, name: c.name, tier: c.tier, mainC: c.mainC, matchRatio: c.matchRatio,
        finalScore: c.finalScore, strength: c.strength, traits: c.traits, units: c.units,
        counters: c.counters, source: c.source, positionMap: c.positionMap,
        plan: m.plan, hit: m.hit, expectedRolls: m.expectedRolls, rollGold: m.rollGold,
        buyCost: m.buyCost, netGold: m.netGold, gap: m.gap,
        affordableRolls: m.affordableRolls, completeProb: m.completeProb,
        neededChamps: m.neededChamps
      };
      route.risk = riskOf(m, ctx);
      return route;
    });

    /* 三种意图各挑一套（同一套只出现一次） */
    const intents = [
      {
        key: 'steady', label: '稳健成型',
        pick: measured.slice().sort(function (a, b) {
          return b.matchRatio - a.matchRatio || a.gap - b.gap || b.finalScore - a.finalScore;
        })
      },
      {
        key: 'power', label: '强度上限',
        pick: measured.slice().sort(function (a, b) {
          return b.finalScore - a.finalScore || a.gap - b.gap;
        })
      },
      {
        key: 'econ', label: '经济优先',
        pick: measured.slice().sort(function (a, b) {
          return a.gap - b.gap || a.buyCost - b.buyCost || b.matchRatio - a.matchRatio;
        })
      }
    ];

    const routes = [];
    const used = {};
    intents.forEach(function (it) {
      const hit = it.pick.find(function (r) { return !used[r.id]; });
      if (!hit) return;
      used[hit.id] = true;
      hit.intent = it.label;
      hit.steps = stepsOf(hit, ctx);
      hit.why = whyOf(hit, ctx);
      routes.push(hit);
    });

    return {
      routes: routes,
      ctx: ctx,
      note: '全部结论由站内规则引擎 + 牌池概率推算，不含官方胜率数据'
    };
  };

  /* 供调试 / 测试用 */
  S.hitChance = hitChance;
  S.allComps = allComps;

  /* ==================== 决策记录 / 复盘评分 ==================== */
  const LOG_KEY = 'tft.solverlog.v1';

  S.logs = function () {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { return []; }
  };

  S.addLog = function (route, ctx) {
    const list = S.logs();
    const entry = {
      id: 'lg_' + Date.now(),
      time: new Date().toLocaleString('zh-CN'),
      season: (D.currentSlug || '').toUpperCase(),
      compId: route.id, name: route.name, tier: route.tier, intent: route.intent,
      level: ctx.level, gold: ctx.gold, hp: ctx.hp,
      hit: route.hit, gap: route.gap,
      units: (route.units || []).map(function (u) { return u.name; })
    };
    list.unshift(entry);
    localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(0, 20)));
    return entry;
  };

  S.deleteLog = function (id) {
    localStorage.setItem(LOG_KEY, JSON.stringify(S.logs().filter(function (l) { return l.id !== id; })));
  };

  /*
   * 复盘评分：只用“计划阵容 vs 当前棋盘”的真实重合度 + 体系档位，
   * 不引入任何虚构的胜率或对手数据。
   */
  S.scoreLog = function (log) {
    const planned = log.units || [];
    const owned = {};
    TFT.state.boardList().forEach(function (u) {
      const c = D.champ(u.champId);
      if (c) owned[c.name] = (owned[c.name] || 0) + 1;
    });
    let hit = 0;
    planned.forEach(function (n) { if (owned[n]) { hit++; owned[n]--; } });
    const coverage = planned.length ? hit / planned.length : 0;
    const tierW = { S: 100, A: 85, B: 70, C: 55 }[log.tier] || 60;
    const sameSeason = String(log.season || '') === String(D.currentSlug || '').toUpperCase();
    return {
      score: sameSeason ? Math.round(coverage * 70 + tierW * 0.3) : 0,
      coverage: Math.round(coverage * 100),
      hit: hit, planned: planned.length, tierW: tierW, sameSeason: sameSeason,
      note: !sameSeason ? '赛季已切换，评分不适用'
        : coverage >= 0.8 ? '基本按计划成型'
        : coverage >= 0.5 ? '成型一半，回看是否中途变阵'
        : '严重偏离计划，回看当时的 D 牌与经济决策'
    };
  };

  /* ==================== 路线卡（Canvas 导出） ==================== */
  function fitText(g, text, maxW) {
    if (g.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  S.cardCanvas = function (route, meta) {
    meta = meta || {};
    const W = 1200, H = 760;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const FONT = '"Microsoft YaHei","PingFang SC",sans-serif';
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0b1220'); bg.addColorStop(1, '#181026');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = '#f43f5e'; g.fillRect(0, 0, W, 6);
    g.textBaseline = 'top';

    g.fillStyle = '#94a3b8'; g.font = '600 22px ' + FONT;
    g.fillText('求解这一局 · ' + (meta.seasonLabel || '') + ' · ' + (meta.time || ''), 60, 44);
    g.fillStyle = '#f1f5f9'; g.font = '800 58px ' + FONT;
    g.fillText(fitText(g, route.name, 1080), 60, 84);

    g.fillStyle = '#22d3ee'; g.font = '600 26px ' + FONT;
    g.fillText(route.intent + ' · ' + route.tier + ' 档 · 匹配 ' + route.matchRatio + '%', 60, 162);

    const metrics = [
      ['单刷命中', pct(route.hit)],
      ['成型概率', pct(route.completeProb)],
      ['期望缺口', route.gap + ' 金'],
      ['风险', route.risk.level]
    ];
    metrics.forEach(function (m, i) {
      const x = 60 + i * 270;
      g.fillStyle = '#0f172a'; g.fillRect(x, 210, 240, 96);
      g.strokeStyle = '#1e293b'; g.strokeRect(x, 210, 240, 96);
      g.fillStyle = '#94a3b8'; g.font = '500 20px ' + FONT;
      g.fillText(m[0], x + 20, 226);
      g.fillStyle = '#f1f5f9'; g.font = '800 34px ' + FONT;
      g.fillText(m[1], x + 20, 256);
    });

    g.fillStyle = '#f1f5f9'; g.font = '700 26px ' + FONT;
    g.fillText('行动顺序', 60, 344);
    let y = 390;
    route.steps.forEach(function (s, i) {
      g.fillStyle = '#f59e0b'; g.font = '700 21px ' + FONT;
      g.fillText((i + 1) + '. [' + s.when + ']', 60, y);
      g.fillStyle = '#cbd5e1'; g.font = '400 21px ' + FONT;
      g.fillText(fitText(g, s.action, 930), 240, y);
      y += 44;
    });

    g.fillStyle = '#f1f5f9'; g.font = '700 26px ' + FONT;
    g.fillText('依据', 60, y + 8);
    y += 54;
    route.why.slice(0, 4).forEach(function (w) {
      g.fillStyle = '#0ea5e9'; g.fillText('·', 60, y);
      g.fillStyle = '#94a3b8'; g.font = '400 20px ' + FONT;
      g.fillText(fitText(g, w, 1000), 86, y);
      y += 38;
    });

    g.fillStyle = '#475569'; g.font = '400 18px ' + FONT;
    g.fillText('全部结论由站内规则引擎 + 牌池概率推算，不含官方胜率 · 金铲铲 AI 多智能体阵容模拟器', 60, H - 52);

    return cv;
  };

  /* ==================== 站位求解（复用战斗模拟） ==================== */
  function withPos(list, map) {
    return list.map(function (u, i) { return Object.assign({}, u, { _pos: map[i] }); });
  }

  S.positioning = function () {
    const units = TFT.state.boardList();
    if (!units.length) return { ok: false, reason: '棋盘为空，先摆好棋子再优化站位' };
    if (!TFT.Battle) return { ok: false, reason: '战斗模拟模块未加载' };
    const opps = (TFT.state.opponents || []).filter(function (o) {
      return o.board && Object.keys(o.board).length;
    });
    if (!opps.length) return { ok: false, reason: '还没有对手阵容：先在「对局设置 / 对手」里摆一套，才能算对位胜负' };

    const baseMap = units.map(function (u) { return u._pos; });

    function evaluate(map) {
      let wins = 0, margin = 0;
      opps.forEach(function (o) {
        const res = TFT.Battle.simulate(withPos(units, map), TFT.state.opponentBoardList(o.id));
        if (res.winner === 'A') wins++;
        margin += res.A.survivors - res.B.survivors;
      });
      return { rate: wins / opps.length, margin: margin / opps.length };
    }

    /* 候选 1：当前站位 */
    const candidates = [{ tag: '当前', map: baseMap.slice() }];

    /* 候选 2：前排 / 后排模板（近战前置，远程后置，中间列优先） */
    const frontCols = [3, 2, 4, 1, 5, 0, 6];
    const backCols = [3, 2, 4, 1, 5, 0, 6];
    const frontSlots = [], backSlots = [];
    [4, 5].forEach(function (r) { frontCols.forEach(function (c) { frontSlots.push(r + '-' + c); }); });
    [7, 6].forEach(function (r) { backCols.forEach(function (c) { backSlots.push(r + '-' + c); }); });
    const order = units.map(function (u, i) { return { i: i, range: (D.champ(u.champId) || {}).range || 1 }; })
      .sort(function (a, b) { return a.range - b.range; });
    const tpl = new Array(units.length);
    let fi = 0, bi = 0;
    order.forEach(function (o) {
      tpl[o.i] = o.range <= 1 ? frontSlots[fi++] : backSlots[bi++];
    });
    if (tpl.every(Boolean)) candidates.push({ tag: '前后排模板', map: tpl });

    /* 候选 3：当前站位两两交换（最多 40 组） */
    let swaps = 0;
    for (let i = 0; i < baseMap.length && swaps < 40; i++) {
      for (let j = i + 1; j < baseMap.length && swaps < 40; j++) {
        const m = baseMap.slice();
        const t = m[i]; m[i] = m[j]; m[j] = t;
        candidates.push({ tag: '交换 ' + i + '-' + j, map: m });
        swaps++;
      }
    }

    let best = null;
    candidates.forEach(function (c) {
      const r = evaluate(c.map);
      c.rate = r.rate; c.margin = r.margin;
      if (!best || r.rate > best.rate || (r.rate === best.rate && r.margin > best.margin)) best = c;
    });
    const before = candidates[0];

    const changes = [];
    units.forEach(function (u, i) {
      if (best.map[i] !== baseMap[i]) {
        changes.push({
          name: (D.champ(u.champId) || {}).name || u.champId,
          from: baseMap[i], to: best.map[i]
        });
      }
    });

    return {
      ok: true,
      before: { rate: before.rate, margin: before.margin },
      best: { rate: best.rate, margin: best.margin, map: best.map, tag: best.tag },
      changes: changes,
      tried: candidates.length,
      opponents: opps.length,
      units: units
    };
  };

  S.applyPositions = function (p) {
    if (!p || !p.ok) return false;
    const next = {};
    p.units.forEach(function (u, i) {
      const copy = Object.assign({}, u);
      delete copy._pos;
      next[p.best.map[i]] = copy;
    });
    TFT.state.board = next;
    if (TFT.Board && TFT.Board.renderBoard) TFT.Board.renderBoard();
    if (TFT.Board && TFT.Board.commit) TFT.Board.commit('positioning');
    return true;
  };

})(window.TFT);
