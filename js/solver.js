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

})(window.TFT);
