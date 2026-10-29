/* ============ storage.js —— 静态数据访问层 TFT.D + localStorage 存档 / 导入导出 ============ */
window.TFT = window.TFT || {};
(function (TFT) {
  'use strict';
  const U = TFT.U;

  /* ==================== 数据访问层 ==================== */
  const RAW = window.TFT_DATA || {};
  const D = TFT.D = {
    raw: RAW,
    currentSlug: null,
    seasonObj: null,
    items: RAW.items || { components: [], completed: [], artifacts: [] },
    itemsFull: RAW.itemsFull || [],
    augments: RAW.augments || { silver: [], gold: [], prismatic: [] },
    augmentsFull: RAW.augmentsFull || [],
    source: RAW.source || null,
    meta: RAW.meta || { tiers: {} }
  };
  D.SEASON_ORDER = ['s17', 's16', 's15', 's14', 's13', 's7', 's3'];
  D.SEASON_LABEL = { s17: 'S17 当前赛季', s16: 'S16', s15: 'S15', s14: 'S14', s13: 'S13', s7: 'S7', s3: 'S3' };
  D.PATCHES = ['14.18', '14.17', '14.16', '14.15', '14.14', '14.13'];

  /* ---------- 描述文本规范化：清理官方数据的转义/占位符残留，保证界面与 AI 输出可读 ---------- */
  function normDesc(s) {
    let x = String(s == null ? '' : s);
    x = x.replace(/%%/g, '%');
    x = x.replace(/\{\{[^}]*\}\}/g, '');
    x = x.replace(/%i:[^%]*%/g, '');
    x = x.replace(/@[A-Za-z0-9_.:*]+@/g, '');
    x = x.replace(/—\s*\([^)]{0,24}\)/g, '');
    x = x.replace(/\(\s*[—\-−\s]*\)/g, '');
    x = x.replace(/None(?=%)/g, '（数值）');
    x = x.replace(/\?(?=%)/g, '（数值）');
    x = x.replace(/—/g, '（数值）');
    x = x.replace(/[ \t]{2,}/g, ' ');
    x = x.replace(/\s+([，。；、）)])/g, '$1');
    x = x.replace(/([（(])\s+/g, '$1');
    return x.trim();
  }
  (function normalizeDescs() {
    D.SEASON_ORDER.forEach(function (slug) {
      const d = RAW[slug]; if (!d) return;
      (d.traits || []).forEach(function (t) { if (t && t.desc) t.desc = normDesc(t.desc); });
      (d.champions || []).forEach(function (c) {
        if (c && c.ability && c.ability.desc) c.ability.desc = normDesc(c.ability.desc);
      });
    });
    (D.augmentsFull || []).forEach(function (a) { if (a && a.desc) a.desc = normDesc(a.desc); });
    (D.itemsFull || []).forEach(function (i) { if (i) { if (i.desc) i.desc = normDesc(i.desc); if (i.stat) i.stat = normDesc(i.stat); } });
    const L = D.items;
    [].concat(L.components || [], L.completed || [], L.artifacts || []).forEach(function (i) {
      if (i) { if (i.desc) i.desc = normDesc(i.desc); if (i.stat) i.stat = normDesc(i.stat); }
    });
  })();

  D.seasons = function () {
    return D.SEASON_ORDER.filter(s => RAW[s]).map(s => ({ slug: s, name: (RAW[s].name ? s.toUpperCase() + ' ' + RAW[s].name : s.toUpperCase()) }));
  };
  D.setSeason = function (slug) {
    D.currentSlug = slug;
    D.seasonObj = RAW[slug] || null;
  };
  D.champions = () => (D.seasonObj && D.seasonObj.champions) || [];
  D.champ = function (id) { return D.champions().find(c => c.id === id) || null; };
  D.champByName = function (name) { return D.champions().find(c => c.name === name) || null; };
  D.traits = () => (D.seasonObj && D.seasonObj.traits) || [];
  D.trait = function (name) { return D.traits().find(t => t.name === name) || null; };

  D.allItems = function () {
    return [].concat(D.items.components || [], D.items.completed || [], D.items.artifacts || []);
  };
  D.item = function (id) {
    return D.allItems().find(i => i.id === id) ||
      D.officialItems(D.currentSlug).find(i => i.id === id) || null;
  };
  D.itemByName = function (name) {
    return D.allItems().find(i => i.name === name) ||
      D.officialItems(D.currentSlug).find(i => i.name === name) || null;
  };
  D.completedByRecipe = function (a, b) {
    const pool = (D.itemsForSeason(D.currentSlug).completed || []).concat(D.items.completed || []);
    return pool.find(function (it) {
      const r = it.recipe || [];
      return (r[0] === a && r[1] === b) || (r[0] === b && r[1] === a);
    }) || null;
  };
  D.componentsFor = function (itemId) {
    const it = D.item(itemId); return (it && it.recipe) || [];
  };

  /* ---------- 海克斯强化：官方全量真实数据（按当前赛季筛选） ---------- */
  const AUG_TIER_RANK = { prismatic: 0, gold: 1, silver: 2, unknown: 3 };
  const AUG_EFFECT_MAP = { InterestCap: 'interestCap', NumItems: 'extraItem', NumComponents: 'extraItem' };
  const AUG_EFFECT_LABEL = {
    Gold: '金币', Health: '生命值', AttackSpeed: '攻击速度', XP: '经验', AD: '攻击力',
    NumComponents: '装备组件', NumItems: '装备', DamageAmp: '伤害增幅', AP: '法术强度',
    Resists: '双抗', BonusHealth: '生命值', NumUnits: '人口', Heal: '治疗', AS: '攻击速度',
    Mana: '法力值', BonusAP: '法术强度', BonusAD: '攻击力', BonusAS: '攻击速度', InterestCap: '利息上限',
    Duration: '持续时间', ShieldDuration: '护盾时长', CritChance: '暴击率', ManaRegen: '法力回复',
    Rerolls: '刷新次数', MaxStacks: '最大层数', NumChamps: '棋子数量', NumReforgers: '重铸次数',
    Delay: '延迟', Rounds: '回合数'
  };
  function fmtAugVal(v) {
    const f = Number(v);
    if (!isFinite(f)) return String(v);
    return (Math.abs(f - Math.round(f)) < 1e-6) ? String(Math.round(f)) : f.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }
  function mapOfficialAugment(a) {
    const effects = Object.keys(a.effects || {}).map(function (k) {
      return { k: k, v: a.effects[k], label: (AUG_EFFECT_LABEL[k] || k) + ' ' + fmtAugVal(a.effects[k]), mapKey: AUG_EFFECT_MAP[k] || null };
    });
    const traits = a.traits || [];
    return {
      id: a.id, name: a.name, en: a.en || null,
      rarity: a.tier || '特殊', rarityKey: a.rarityKey || 'unknown', tier: a.tier || '特殊',
      desc: a.desc || '', tags: traits.length ? traits.slice() : ['通用'],
      effects: effects, traits: traits, fit: traits.slice(), icon: a.icon || null, sets: a.sets || []
    };
  }
  function legacyAugmentList() {
    return [].concat(
      (D.augments.silver || []).map(a => Object.assign({ rarity: '银', rarityKey: 'silver', effects: (a.effects || []).map(e => Object.assign({ mapKey: e.k }, e)) }, a)),
      (D.augments.gold || []).map(a => Object.assign({ rarity: '金', rarityKey: 'gold', effects: (a.effects || []).map(e => Object.assign({ mapKey: e.k }, e)) }, a)),
      (D.augments.prismatic || []).map(a => Object.assign({ rarity: '棱彩', rarityKey: 'prismatic', effects: (a.effects || []).map(e => Object.assign({ mapKey: e.k }, e)) }, a))
    );
  }
  D._augCache = {};
  D.augmentList = function (slug) {
    if (!D.augmentsFull.length) return D._augLegacy || (D._augLegacy = legacyAugmentList());
    slug = slug || D.currentSlug;
    if (D._augCache[slug]) return D._augCache[slug];
    const list = D.augmentsFull
      .filter(a => !a.sets || !a.sets.length || a.sets.indexOf(slug) >= 0)
      .map(mapOfficialAugment);
    list.sort((x, y) => ((AUG_TIER_RANK[x.rarityKey] || 3) - (AUG_TIER_RANK[y.rarityKey] || 3)) ||
      String(x.name).localeCompare(String(y.name), 'zh'));
    D._augCache[slug] = list;
    return list;
  };
  D.augment = function (id) { return D.augmentList().find(a => a.id === id) || null; };

  /* 计算海克斯强化中「单位明确、可建模」的真实数值修正（其余仅作说明展示，不臆造数值） */
  D.augmentMods = function (ids) {
    const mods = { interestCap: 5, interestPer: 10, maxLevel: 9, goldPerRound: 0, extraItem: 0,
      hpBonus: 0, adBonus: 0, apBonus: 0, asBonus: 0, oddsBoost: 0, reforge: 0, expBonus: 0, traitBoost: [] };
    (ids || []).forEach(function (id) {
      const a = D.augment(id); if (!a) return;
      (a.effects || []).forEach(function (ef) {
        const k = ef.mapKey; if (!k) return;
        const v = Number(ef.v) || 0;
        if (k === 'interestCap') mods.interestCap = Math.max(mods.interestCap, v);
        else if (k === 'extraItem') mods.extraItem += v;
        else if (mods[k] != null) mods[k] += v;
      });
    });
    return mods;
  };

  /* ---------- 装备：官方全量真实目录（按当前赛季筛选，用于搜索与 AI 事实来源） ---------- */
  D._itemCache = {};
  D.officialItems = function (slug) {
    if (!D.itemsFull.length) return [];
    slug = slug || D.currentSlug;
    if (D._itemCache[slug]) return D._itemCache[slug];
    const list = D.itemsFull
      .filter(i => !i.sets || !i.sets.length || i.sets.indexOf(slug) >= 0)
      .map(function (i) {
        return {
          id: i.id, name: i.name, en: i.en || null, category: i.category,
          recipe: i.composition || [], recipeNames: i.compositionNames || [],
          desc: i.desc || '', stat: i.desc || '', icon: i.icon || null, sets: i.sets || []
        };
      });
    D._itemCache[slug] = list;
    return list;
  };

  /* 按赛季分组的装备目录（装备面板 / 合成图谱跟随赛季切换） */
  D._setItemCache = {};
  D.itemsForSeason = function (slug) {
    slug = slug || D.currentSlug;
    if (D._setItemCache[slug]) return D._setItemCache[slug];
    const out = { components: [], completed: [], artifacts: [] };
    const full = D.officialItems(slug);
    if (!full.length) {
      out.components = (D.items.components || []).slice();
      out.completed = (D.items.completed || []).slice();
      out.artifacts = (D.items.artifacts || []).slice();
    } else {
      full.forEach(function (i) {
        if (i.category === 'component') out.components.push(i);
        else if (i.category === 'artifact') out.artifacts.push(i);
        else if (i.category === 'completed') out.completed.push(i);
      });
    }
    D._setItemCache[slug] = out;
    return out;
  };

  /* 抓取溯源信息（数据来源 / 时间 / 条目数） */
  D.sourceInfo = function () { return D.source || null; };

  /* ==================== 站内真实数据聚合（TFT.Analytics） ====================
     仅统计数据源中真实存在的字段，不引入任何外部/伪造统计口径 */
  const An = TFT.Analytics = {};

  /* 棋子费用与职业分布（真实） */
  An.championCostDist = function () {
    const byCost = {}, byRole = {};
    D.champions().forEach(function (c) {
      byCost[c.cost] = (byCost[c.cost] || 0) + 1;
      const r = c.role || '其它';
      byRole[r] = (byRole[r] || 0) + 1;
    });
    return { byCost: byCost, byRole: byRole };
  };

  /* 装备类别分布（真实 category 字段） */
  An.itemCategoryDist = function () {
    const m = {};
    (D.itemsFull || []).forEach(function (it) { const k = (it && it.category) || '其它'; m[k] = (m[k] || 0) + 1; });
    return m;
  };

  /* 海克斯层级分布（真实 rarityKey 字段） */
  An.augmentTierDist = function (slug) {
    const m = {};
    (D.augmentList(slug || D.currentSlug) || []).forEach(function (a) { const k = a.rarityKey || 'unknown'; m[k] = (m[k] || 0) + 1; });
    return m;
  };

  /* 各赛季真实条目数（来自 source.json） */
  An.perSetCounts = function () {
    const per = (D.source && D.source.perSet) || {};
    const se = (D.source && D.source.seasons) || {};
    return Object.keys(per).map(function (s) {
      return {
        slug: s, augments: per[s].augments, items: per[s].items,
        champions: (se[s] || {}).champions, traits: (se[s] || {}).traits
      };
    });
  };

  /* 数据规模总览（真实条目数） */
  An.overview = function () {
    const src = D.source || {};
    return {
      augments: D.augmentList(D.currentSlug).length || D.augmentsFull.length,
      items: D.officialItems(D.currentSlug).length || D.itemsFull.length,
      champions: D.champions().length,
      traits: D.traits().length,
      seasons: (src.sets || []).length,
      fetchedAt: src.fetchedAt || '',
      source: src.source || ''
    };
  };

  /* ==================== localStorage 持久化 ==================== */
  const K = TFT.Store = {};
  K.KEYS = { saves: 'tft.saves.v1', notes: 'tft.notes.v1', prefs: 'tft.prefs.v1', current: 'tft.current.v1', itemPlans: 'tft.itemplans.v1' };

  function read(k, dft) {
    try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : dft; } catch (e) { return dft; }
  }
  function write(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { TFT.UI.toast('本地存储写入失败：' + e.message, 'err'); return false; }
  }

  /* ---- 页面偏好 ---- */
  K.prefs = function () {
    const stored = read(K.KEYS.prefs, {});
    const p = Object.assign({
      autoMerge: true, theme: 'dark', rangeToggle: false, apiUrl: '', apiKey: '', apiModel: '',
      llmBaseUrl: 'https://api.deepseek.com', llmKey: '', llmModel: 'deepseek-chat',
      llmTemp: 0.7, llmStream: true, llmPersona: true,
      lastView: 'home', quizBest: null
    }, stored);
    /* 迁移：老版本只有预留的 CrewAI 配置（apiUrl/apiKey/apiModel）时，复用为默认大模型配置 */
    if (stored.llmBaseUrl == null) {
      if (stored.apiUrl) p.llmBaseUrl = stored.apiUrl;
      if (stored.apiKey) p.llmKey = stored.apiKey;
      if (stored.apiModel) p.llmModel = stored.apiModel;
    }
    return p;
  };
  K.setPrefs = function (patch) { const p = K.prefs(); Object.assign(p, patch); write(K.KEYS.prefs, p); return p; };

  /* ---- 当前棋盘状态（刷新不丢失） ---- */
  K.saveCurrent = function (state) { write(K.KEYS.current, state); };
  K.loadCurrent = function () { return read(K.KEYS.current, null); };

  /* ---- 阵容存档 ---- */
  K.saves = () => read(K.KEYS.saves, []);
  K.addSave = function (save) {
    const list = K.saves();
    list.unshift(save);
    write(K.KEYS.saves, list.slice(0, 100));
    return list;
  };
  K.deleteSave = function (id) { const list = K.saves().filter(s => s.id !== id); write(K.KEYS.saves, list); return list; };

  /* ---- 复盘笔记 ---- */
  K.notes = () => read(K.KEYS.notes, []);
  K.addNote = function (note) { const l = K.notes(); l.unshift(note); write(K.KEYS.notes, l.slice(0, 200)); return l; };
  K.deleteNote = function (id) { const l = K.notes().filter(n => n.id !== id); write(K.KEYS.notes, l); return l; };

  /* ---- 阵容出装手动覆盖（按阵容 id → 棋子名 → 装备 id 数组） ---- */
  K.itemPlans = () => read(K.KEYS.itemPlans, {});
  K.itemPlan = function (compId) { return (K.itemPlans() || {})[compId] || null; };
  K.setItemPlan = function (compId, champName, ids) {
    if (!compId || !champName) return null;
    const all = K.itemPlans() || {};
    const one = all[compId] || {};
    if (ids && ids.length) one[champName] = ids.slice(0, 3);
    else delete one[champName];
    if (Object.keys(one).length) all[compId] = one; else delete all[compId];
    write(K.KEYS.itemPlans, all);
    return all;
  };
  K.clearItemPlan = function (compId) {
    const all = K.itemPlans() || {};
    delete all[compId];
    write(K.KEYS.itemPlans, all);
    return all;
  };

  /* ==================== 导入 / 导出 ==================== */
  K.download = function (filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = U.el('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };
  K.exportJSON = function (name) {
    const snap = TFT.state.serialize(name || '未命名阵容', '导出');
    const fname = 'tft-' + (name || 'comp') + '-' + new Date().toISOString().slice(0, 10) + '.json';
    K.download(fname, JSON.stringify(snap, null, 2));
    TFT.UI.toast('已导出阵容 JSON：' + fname, 'ok');
  };
  K.readFile = function (file, cb) {
    const fr = new FileReader();
    fr.onload = function () {
      try { cb(null, JSON.parse(fr.result)); }
      catch (e) { cb(new Error('JSON 解析失败：' + e.message)); }
    };
    fr.onerror = function () { cb(new Error('文件读取失败')); };
    fr.readAsText(file, 'utf-8');
  };

  /* 校验导入数据版本 */
  K.validateImport = function (data) {
    const warn = [];
    if (!data || typeof data !== 'object') return { ok: false, errors: ['不是合法的 JSON 对象'], warn: [] };
    if (!data.state && !data.board) return { ok: false, errors: ['缺少 state/board 字段，不是本模拟器导出的阵容'], warn: [] };
    const snap = data.state || data;
    if (snap.version && snap.version !== TFT.APP_VERSION) warn.push('文件版本 ' + snap.version + ' 与当前版本 ' + TFT.APP_VERSION + ' 不一致，可能部分字段缺失');
    if (snap.season && snap.season !== D.currentSlug) warn.push('文件来自赛季 ' + String(snap.season).toUpperCase() + '，当前为 ' + D.currentSlug.toUpperCase() + '，将尝试自动转换棋子');
    return { ok: true, errors: [], warn: warn, state: snap };
  };

  /* ==================== 导出棋盘 PNG（只含棋盘/羁绊/备战区） ==================== */
  K.exportImage = function () {
    if (!window.html2canvas) { TFT.UI.toast('html2canvas 未加载，无法导出图片', 'err'); return; }
    const wrap = U.el('div', 'export-wrap');
    wrap.style.cssText = 'position:fixed;left:-99999px;top:0;width:920px;padding:20px;background:linear-gradient(180deg,#0b1220,#070c16);color:#e8f0ff;font-family:inherit;z-index:-1';
    const season = D.currentSlug ? D.currentSlug.toUpperCase() : '';
    wrap.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
      '<div style="font-size:18px;font-weight:800;background:linear-gradient(90deg,#22d3ee,#f5c542);-webkit-background-clip:text;background-clip:text;color:transparent">金铲铲 AI 阵容模拟器 · ' + U.esc(season) + '</div>' +
      '<div style="font-size:11px;color:#93a4c4">' + new Date().toLocaleString('zh-CN') + '</div></div>';
    const boardBlock = U.$('.board-block');
    const benchBlock = U.$('.bench-block');
    const traitsPanel = U.$('.traits-panel');
    if (boardBlock) wrap.appendChild(boardBlock.cloneNode(true));
    const row = U.el('div'); row.style.cssText = 'display:flex;gap:10px;margin-top:10px';
    if (benchBlock) row.appendChild(benchBlock.cloneNode(true));
    if (traitsPanel) { const tp = traitsPanel.cloneNode(true); tp.style.flex = '1'; row.appendChild(tp); }
    wrap.appendChild(row);
    const summary = U.el('div');
    summary.style.cssText = 'margin-top:10px;font-size:11px;color:#93a4c4;display:flex;gap:14px;flex-wrap:wrap';
    const st = TFT.state;
    summary.innerHTML = '<span>等级 <b style="color:#22d3ee">' + st.level + '</b></span><span>金币 <b style="color:#f5c542">' + st.gold +
      '</b></span><span>血量 <b style="color:#34d399">' + st.hp + '</b></span><span>回合 <b style="color:#e8f0ff">' + st.stage +
      '</b></span><span>人口 <b style="color:#22d3ee">' + TFT.state.boardList().length + '/' + st.level + '</b></span>';
    wrap.appendChild(summary);
    document.body.appendChild(wrap);
    setTimeout(function () {
      window.html2canvas(wrap, { backgroundColor: '#070c16', scale: 2, useCORS: true, logging: false })
        .then(function (canvas) {
          canvas.toBlob(function (blob) {
            const url = URL.createObjectURL(blob);
            const a = U.el('a'); a.href = url; a.download = 'tft-board-' + Date.now() + '.png';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1500);
            TFT.UI.toast('已导出棋盘 PNG 图片', 'ok');
          });
        })
        .catch(function (err) { TFT.UI.toast('截图失败：' + err.message, 'err'); })
        .finally(function () { wrap.remove(); });
    }, 320);
  };

})(window.TFT);
