/* ============ recommend.js —— 出装推荐引擎（本地规则 · 可解释 · 非官方方案） ============
   设计原则：
   1. 只使用站内真实字段（职业 role / 射程 range / 法力 mana / 费用 cost / 装备 recipe / 羁绊 traits）
   2. 不编造胜率类数据，输出明确标注为「引擎推荐」
   3. 每条推荐都可追溯到权重来源（角色定位 + 属性轴），界面给出原因
*/
window.TFT = window.TFT || {};
(function (TFT) {
  'use strict';
  const D = TFT.D;
  const R = TFT.Recommend = {};

  /* ---------- 基础小件 → 属性轴 ---------- */
  const COMP_AXIS = {
    bf_sword: 'ad', recurve_bow: 'as', nlrod: 'ap', tear: 'mana',
    chain_vest: 'armor', negatron_cloak: 'mr', giants_belt: 'hp', sparring_gloves: 'crit'
  };
  const AXES = ['ad', 'as', 'ap', 'mana', 'crit', 'hp', 'armor', 'mr'];
  const AXIS_CN = { ad: '攻击力', as: '攻速', ap: '法强', mana: '回蓝', crit: '暴击', hp: '生命', armor: '护甲', mr: '魔抗' };

  /* ---------- 职业 → 属性权重（每件装备最多 2 个小件，故满分 2） ---------- */
  const ROLE_W = {
    ADCarry: { ad: 1.0, as: 0.85, crit: 0.70, mana: 0.28, hp: 0.10, armor: 0.05, mr: 0.05, ap: 0 },
    ADReaper: { ad: 1.0, crit: 0.85, as: 0.62, mana: 0.22, hp: 0.10, armor: 0.07, mr: 0.05, ap: 0 },
    ADFighter: { ad: 0.58, hp: 0.62, as: 0.48, armor: 0.44, mr: 0.28, crit: 0.20, mana: 0.14, ap: 0 },
    ADCaster: { ad: 0.42, mana: 0.72, as: 0.44, ap: 0.32, crit: 0.18, hp: 0.12, armor: 0.05, mr: 0.05 },
    ADTank: { hp: 0.90, armor: 0.85, mr: 0.68, ad: 0.18, as: 0.10, crit: 0.05, mana: 0.05, ap: 0 },
    ADSpecialist: { ad: 0.70, as: 0.58, crit: 0.44, hp: 0.24, armor: 0.14, mr: 0.10, mana: 0.18, ap: 0 },
    APCarry: { ap: 1.0, mana: 0.72, crit: 0.52, hp: 0.12, armor: 0.05, mr: 0.05, ad: 0, as: 0.14 },
    APCaster: { ap: 0.90, mana: 0.82, crit: 0.38, hp: 0.12, armor: 0.05, mr: 0.05, ad: 0, as: 0.10 },
    APFighter: { ap: 0.58, hp: 0.62, armor: 0.44, mr: 0.34, mana: 0.38, crit: 0.18, ad: 0, as: 0.10 },
    APTank: { hp: 0.90, mr: 0.85, armor: 0.78, ap: 0.18, mana: 0.10, crit: 0.05, ad: 0, as: 0 },
    APReaper: { ap: 0.95, crit: 0.62, mana: 0.48, hp: 0.14, armor: 0.05, mr: 0.05, ad: 0, as: 0.10 },
    HFighter: { ad: 0.48, ap: 0.48, hp: 0.58, as: 0.38, armor: 0.34, mr: 0.24, crit: 0.20, mana: 0.14 }
  };

  const ROLE_CN = {
    ADFighter: 'AD 战士', ADCarry: 'AD 主C', ADCaster: 'AD 法系', ADTank: 'AD 坦克',
    ADSpecialist: 'AD 特工', ADReaper: 'AD 收割', APFighter: 'AP 战士', APCarry: 'AP 主C',
    APCaster: 'AP 法师', APTank: 'AP 坦克', APReaper: 'AP 收割', HFighter: '混合战士'
  };
  R.roleLabel = r => ROLE_CN[r] || '通用';

  /* ---------- 装备上下文加成（只在对应定位下生效，不改变属性轴主逻辑） ---------- */
  const ITEM_CTX = {
    infinity_edge: { carry: 6, adCarry: 4 },
    giant_slayer: { adCarry: 4, rangedCarry: 2 },
    last_whisper: { adCarry: 4 },
    death_blade: { adCarry: 4 },
    rapid_firecannon: { rangedCarry: 6, asCarry: 2 },
    runaans_hurricane: { rangedCarry: 4 },
    guinsoo: { asCarry: 6 },
    titans_resolve: { meleeCarry: 5 },
    bloodthirster: { meleeCarry: 4 },
    steraks_gage: { meleeCarry: 4 },
    edge_of_night: { meleeCarry: 4 },
    hand_of_justice: { carry: 3 },
    hextech_gunblade: { apCarry: 3, meleeCarry: 2 },
    rabadon: { apCarry: 7 },
    archangel: { apCarry: 5 },
    jeweled_gauntlet: { apCarry: 4, critAP: 4 },
    morellonomicon: { apCarry: 4, antiHeal: 2 },
    ionic_spark: { apCarry: 2, tank: 2 },
    blue_buff: { manaHeavy: 7 },
    spear_of_shojin: { manaHeavy: 4, ranged: 2 },
    warmogs: { tank: 6 },
    bramble_vest: { tank: 6 },
    gargoyle: { tank: 5 },
    dragons_claw: { tank: 5, tankMR: 3 },
    spirit_visage: { tank: 4 },
    sunfire_cape: { tank: 4 },
    unending_despair: { tank: 2 },
    frozen_heart: { support: 5 },
    redemption: { support: 5 },
    chalice: { support: 4 },
    knights_vow: { support: 3 },
    banshees_veil: { support: 2, carry: 1 },
    wits_end: { meleeCarry: 2 },
    nashors_tooth: { apCarry: 2, asCarry: 2 }
  };
  /* 不推荐：随机装备 / 依赖未知纹章 */
  const BANNED = { thieves_gloves: 1 };

  /* ---------- 装备属性向量：每个小件记 1 点 ---------- */
  const _vecCache = {};
  function itemVec(it) {
    if (_vecCache[it.id]) return _vecCache[it.id];
    const v = { ad: 0, as: 0, ap: 0, mana: 0, crit: 0, hp: 0, armor: 0, mr: 0 };
    (it.recipe || []).forEach(function (c) { const a = COMP_AXIS[c]; if (a) v[a] += 1; });
    _vecCache[it.id] = v;
    return v;
  }

  /* 可推荐的成品装备（含配方、非随机、非纹章），按当前赛季目录构建
     官方装备用小件英文 id（TFT_Item_*），需先按小件中文名映射回属性轴 id */
  const _poolBySeason = {};
  function seasonCandidateItems(slug) {
    const comps = (D.itemsForSeason(slug).components || []);
    const legacyComps = (D.items.components || []);
    const translate = {};
    comps.forEach(function (c) {
      if (COMP_AXIS[c.id]) { translate[c.id] = c.id; return; }
      const lg = legacyComps.find(l => l.name === c.name);
      if (lg) translate[c.id] = lg.id;
    });
    const pool = [];
    const seen = {};
    (D.items.completed || []).forEach(function (it) {
      if (!it || !it.id || BANNED[it.id]) return;
      if ((it.recipe || []).length !== 2 || !it.recipe.every(c => !!COMP_AXIS[c])) return;
      pool.push(it); seen[it.name] = true;
    });
    (D.itemsForSeason(slug).completed || []).forEach(function (it) {
      if (!it || !it.id || BANNED[it.id] || seen[it.name]) return;
      const r = (it.recipe || []).map(cid => translate[cid] || cid);
      if (r.length !== 2 || !r.every(c => !!COMP_AXIS[c])) return;
      /* 克隆一份并写入属性轴小件 id，避免改动共享的赛季装备对象 */
      pool.push({ id: it.id, name: it.name, icon: it.icon, stat: it.stat, desc: it.desc, recipe: r });
    });
    return pool;
  }
  function candidateItems() {
    const slug = D.currentSlug || 's17';
    if (_poolBySeason[slug]) return _poolBySeason[slug];
    _poolBySeason[slug] = seasonCandidateItems(slug);
    return _poolBySeason[slug];
  }
  R.candidateItems = candidateItems;

  /* ---------- 按定位调整权重 ---------- */
  function weightsFor(champ, tag) {
    const base = ROLE_W[champ.role] || ROLE_W.HFighter;
    const w = {};
    AXES.forEach(a => w[a] = base[a] || 0);

    const range = Number(champ.range) || 1;
    const mana = Number(champ.mana) || 0;

    if (range >= 3) { w.as *= 1.18; w.crit *= 1.10; }
    else { w.hp *= 1.10; w.armor *= 1.10; }

    if (mana >= 60) { w.mana *= 1.32; w.ap *= 1.12; }
    else if (mana > 0 && mana <= 30) { w.mana *= 0.55; }

    if (tag === 'main' || tag === 'sub') {
      w.ad *= 1.12; w.ap *= 1.12; w.as *= 1.12; w.crit *= 1.12;
      w.hp *= 0.80; w.armor *= 0.80; w.mr *= 0.80;
    } else if (tag === 'tank') {
      w.hp *= 1.30; w.armor *= 1.30; w.mr *= 1.30;
      w.ad *= 0.45; w.ap *= 0.45; w.as *= 0.50; w.crit *= 0.45;
    } else if (tag === 'other') {
      w.ad *= 0.85; w.ap *= 0.85; w.as *= 0.85; w.crit *= 0.85;
      w.hp *= 1.10; w.armor *= 1.10; w.mr *= 1.10;
    }
    return w;
  }

  function flagsFor(champ, tag) {
    const range = Number(champ.range) || 1;
    const mana = Number(champ.mana) || 0;
    const role = champ.role || '';
    const carry = tag === 'main' || tag === 'sub';
    const ap = /^AP/.test(role);
    const ad = /^AD/.test(role) || role === 'HFighter';
    return {
      carry: carry,
      adCarry: carry && ad,
      apCarry: carry && ap,
      rangedCarry: carry && range >= 3,
      meleeCarry: carry && range <= 1,
      asCarry: carry && (role.indexOf('Carry') >= 0 || role.indexOf('Reaper') >= 0 || role === 'ADSpecialist'),
      critAP: ap && carry,
      manaHeavy: mana >= 60,
      ranged: range >= 3,
      tank: tag === 'tank',
      tankMR: tag === 'tank' && /^AP/.test(role),
      support: tag === 'other' && !carry,
      antiHeal: carry
    };
  }

  function scoreItem(it, w, flags, used) {
    const v = itemVec(it);
    let s = 0;
    AXES.forEach(function (a) { s += (w[a] || 0) * v[a]; });
    s = s * 10;
    const ctx = ITEM_CTX[it.id];
    if (ctx) Object.keys(ctx).forEach(function (k) { if (flags[k]) s += ctx[k]; });
    if (used && used[it.id]) s -= 7;
    return s;
  }

  function pickItems(champ, tag, count, used) {
    const w = weightsFor(champ, tag);
    const flags = flagsFor(champ, tag);
    const list = candidateItems().map(function (it) {
      return { it: it, s: scoreItem(it, w, flags, used) };
    }).sort((a, b) => b.s - a.s);
    const out = [];
    for (let i = 0; i < list.length && out.length < count; i++) {
      const id = list[i].it.id;
      if (used[id]) continue;
      out.push(list[i].it);
      used[id] = (used[id] || 0) + 1;
    }
    return { items: out, w: w, flags: flags };
  }

  function reasonOf(champ, tag, w) {
    const top = AXES.slice().sort((a, b) => w[b] - w[a]).filter(a => w[a] >= 0.18).slice(0, 3).map(a => AXIS_CN[a]);
    return R.roleLabel(champ.role) + ' · 优先 ' + (top.join(' / ') || '通用属性');
  }

  /* 承载分：用于选出副C */
  function carryScore(champ) {
    const role = champ.role || '';
    let s = (champ.cost || 1) * 10;
    if (/Carry|Reaper/.test(role)) s += 30;
    if (role === 'ADSpecialist') s += 18;
    if (/Fighter/.test(role)) s += 10;
    if (/Tank/.test(role)) s -= 12;
    s += (Number(champ.ad) || 0) * 0.5 + (Number(champ.ap) || 0) * 0.5;
    return s;
  }
  function tankScore(champ) {
    let s = (Number(champ.hp) || 0) * 0.12 + (Number(champ.armor) || 0) * 2.2 + (Number(champ.mr) || 0) * 2.2;
    if (/Tank/.test(champ.role || '')) s += 45;
    if (Number(champ.range) === 1) s += 10;
    return s;
  }

  /* ==================== 对外主入口 ==================== */
  /* plan(cp) → { compId, units:[{name,cost,star,champ,role,roleLabel,items:[{id,name,stat,icon}],reason,tag,manual}], summary } */
  R.plan = function (cp) {
    if (!cp) return { compId: null, units: [], summary: { total: 0, manual: 0, engine: 0 } };
    const compId = cp.id || '';
    const overrides = (TFT.Store && TFT.Store.itemPlan) ? (TFT.Store.itemPlan(compId) || {}) : {};
    const units = (cp.units || []).slice();
    const info = units.map(function (u) {
      const champ = D.champByName(u.name) || {};
      return {
        name: u.name, cost: u.cost || champ.cost || 0, star: u.star || 1,
        champ: champ, role: champ.role || null, roleLabel: R.roleLabel(champ.role)
      };
    });

    /* 1) 定位分配：主C / 主坦 / 副C / 补充 */
    const mainName = cp.mainC && info.some(x => x.name === cp.mainC) ? cp.mainC
      : (info.slice().sort((a, b) => carryScore(b.champ) - carryScore(a.champ))[0] || {}).name;
    const tags = {};
    if (mainName) tags[mainName] = 'main';

    const rest = info.filter(x => x.name !== mainName);
    let tankName = null, subName = null;
    if (rest.length) {
      tankName = rest.slice().sort((a, b) => tankScore(b.champ) - tankScore(a.champ))[0].name;
      tags[tankName] = 'tank';
    }
    const rest2 = rest.filter(x => x.name !== tankName);
    if (rest2.length) {
      subName = rest2.slice().sort((a, b) => carryScore(b.champ) - carryScore(a.champ))[0].name;
      tags[subName] = 'sub';
    }
    info.forEach(x => { if (!tags[x.name]) tags[x.name] = 'other'; });

    /* 2) 分配件数：主C 3 / 主坦 2 / 副C 2 / 其余 4 费以上最多 1，总量上限 9 */
    const UNITS_CAP = 9;
    const planMap = {};
    const used = {};
    let total = 0;

    const alloc = [
      { name: mainName, n: 3 },
      { name: tankName, n: 2 },
      { name: subName, n: 2 }
    ];
    alloc.forEach(function (a) {
      if (!a.name) return;
      const rec = info.find(x => x.name === a.name);
      if (!rec || !rec.champ.id && !rec.champ.name) return;
      const usedN = Math.min(a.n, Math.max(0, UNITS_CAP - total));
      if (!usedN) return;
      const res = pickItems(rec.champ, tags[a.name], usedN, used);
      planMap[a.name] = { items: res.items, reason: reasonOf(rec.champ, tags[a.name], res.w), tag: tags[a.name] };
      total += res.items.length;
    });

    /* 3) 高费补充位补 1 件 */
    info.slice().sort((a, b) => (b.cost - a.cost)).forEach(function (rec) {
      if (planMap[rec.name] || total >= UNITS_CAP) return;
      if ((rec.cost || 0) < 4) return;
      if (!rec.champ || !rec.champ.name) return;
      const res = pickItems(rec.champ, tags[rec.name], 1, used);
      if (!res.items.length) return;
      planMap[rec.name] = { items: res.items, reason: reasonOf(rec.champ, tags[rec.name], res.w), tag: tags[rec.name] };
      total += res.items.length;
    });

    /* 4) 合并手动覆盖 */
    let manualCount = 0, engineCount = 0;
    const outUnits = info.map(function (rec) {
      const p = planMap[rec.name] || { items: [], reason: '', tag: tags[rec.name] };
      const ov = overrides[rec.name];
      let items, manual = false;
      if (ov && ov.length) {
        items = ov.map(id => D.item(id)).filter(Boolean).slice(0, 3)
          .map(it => ({ id: it.id, name: it.name, stat: it.stat || it.desc || '', icon: it.icon || null }));
        manual = true; manualCount++;
      } else {
        items = p.items.map(it => ({ id: it.id, name: it.name, stat: it.stat || it.desc || '', icon: it.icon || null }));
        if (items.length) engineCount++;
      }
      return {
        name: rec.name, cost: rec.cost, star: rec.star, champ: rec.champ,
        role: rec.role, roleLabel: rec.roleLabel,
        tag: p.tag, reason: manual ? '手动方案 · 已覆盖引擎推荐' : p.reason,
        items: items, manual: manual
      };
    });

    return {
      compId: compId,
      units: outUnits,
      summary: { total: total, manual: manualCount, engine: engineCount, itemCount: outUnits.reduce((s, u) => s + u.items.length, 0) }
    };
  };

  /* 单棋子推荐（供战力计算器等其它模块复用） */
  R.forChampion = function (champ, count) {
    const used = {};
    const res = pickItems(champ || {}, 'main', count || 3, used);
    return {
      items: res.items.map(it => ({ id: it.id, name: it.name, stat: it.stat || it.desc || '', icon: it.icon || null })),
      reason: reasonOf(champ || {}, 'main', res.w)
    };
  };
})(window.TFT);
