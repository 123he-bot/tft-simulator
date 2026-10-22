/* ============ board.js —— 全局对局状态、棋盘/备战区/羁绊/牌池/经济面板渲染与规则 ============ */
window.TFT = window.TFT || {};
(function (TFT) {
  'use strict';
  const U = TFT.U;
  TFT.APP_VERSION = '1.4.0';

  const ROWS = 8, COLS = 7, PLAYER_ROW_START = 4; // 上 4 行敌方半场，下 4 行我方棋盘
  const BENCH_MAX = 5, MAX_AUGMENTS = 3, MAX_ITEMS = 3;
  TFT.LIMITS = { ROWS, COLS, PLAYER_ROW_START, BENCH_MAX, MAX_AUGMENTS, MAX_ITEMS };

  /* ==================== 全局状态 ==================== */
  const stageList = (function () {
    const out = [];
    for (let s = 1; s <= 7; s++) {
      const rounds = s === 1 ? 4 : 7;
      for (let r = 1; r <= rounds; r++) out.push(s + '-' + r);
    }
    out.push('加时赛');
    return out;
  })();
  TFT.STAGES = stageList;

  const state = TFT.state = {
    version: TFT.APP_VERSION,
    season: 's17',
    patch: '14.18',
    board: {},          // "r-c" -> unit（仅我方半场 r>=4）
    bench: [null, null, null, null, null],
    augments: [],       // augment id 数组（最多 3）
    level: 8, gold: 50, hp: 100, stage: '4-1', streak: 0,
    opponents: [],      // [{id,name,hp,level,board:{}}]
    focusOpponent: null,
    notes: [],
    chat: [],
    selected: null,     // 选中的单位 uid（键盘删除等）
    rangeOn: false,
    autoMerge: true,
    craftLog: [],
    dirty: false
  };
  TFT.getState = () => state;

  /* 单位工厂 */
  state.mkUnit = function (champId, star) {
    return { uid: U.uid('u'), champId: champId, star: star || 1, items: [] };
  };
  const posKey = (r, c) => r + '-' + c;
  state.posKey = posKey;
  state.isPlayerRow = (r) => r >= PLAYER_ROW_START;
  state.unitAt = function (r, c) { return state.board[posKey(r, c)] || null; };
  state.putAt = function (r, c, unit) { state.board[posKey(r, c)] = unit; };
  state.takeAt = function (r, c) { const u = state.board[posKey(r, c)]; delete state.board[posKey(r, c)]; return u || null; };
  state.findCellOf = function (uid) {
    for (const k in state.board) if (state.board[k] && state.board[k].uid === uid) { const p = k.split('-'); return { r: +p[0], c: +p[1] }; }
    return null;
  };
  state.findBenchIdx = function (uid) { return state.bench.findIndex(b => b && b.uid === uid); };
  state.boardList = function () {
    return Object.keys(state.board).filter(k => state.board[k]).sort((a, b) => {
      const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
      return pa[0] - pb[0] || pa[1] - pb[1];
    }).map(k => Object.assign({}, state.board[k], { _pos: k }));
  };
  state.benchList = () => state.bench.filter(Boolean);
  state.detach = function (uid) {
    const p = state.findCellOf(uid);
    if (p) { state.takeAt(p.r, p.c); return true; }
    const i = state.findBenchIdx(uid);
    if (i >= 0) { state.bench[i] = null; return true; }
    return false;
  };
  state.opponentBoardList = function (oid) {
    const o = state.opponents.find(x => x.id === oid);
    if (!o) return [];
    return Object.keys(o.board).filter(k => o.board[k]).map(k => Object.assign({}, o.board[k], { _pos: k }));
  };
  state.allUnits = function () { return state.boardList().concat(state.benchList()); };

  /* 清空 / 重置 */
  state.clearBoard = function () {
    Object.keys(state.board).forEach(k => {
      const u = state.board[k];
      if (u && u.items) u.items.forEach(it => TFT.Board.returnItem(it));
    });
    state.board = {};
  };
  state.resetAll = function () {
    state.clearBoard();
    state.bench.forEach(function (b) { if (b && b.items) b.items.forEach(it => TFT.Board.returnItem(it)); });
    state.bench = [null, null, null, null, null];
    state.augments = [];
    state.level = 8; state.gold = 50; state.hp = 100; state.stage = '4-1'; state.streak = 0;
    state.craftLog = []; state.selected = null;
    state.opponents.forEach(o => { o.board = {}; o.hp = 100; });
  };

  /* ==================== 序列化：完整对局 JSON ==================== */
  state.serialize = function (name, action) {
    const traits = U.calcTraits(state.boardList(), state.benchList());
    const pool = U.poolStatus();
    const mods = TFT.D.augmentMods(state.augments);
    const champRef = function (u) {
      const c = TFT.D.champ(u.champId);
      return {
        uid: u.uid,
        champId: u.champId,
        name: c ? c.name : u.champId,
        cost: c ? c.cost : null,
        star: u.star || 1,
        traits: c ? c.traits : [],
        items: (u.items || []).map(function (id) { const it = TFT.D.item(id); return { id: id, name: it ? it.name : id, recipe: it ? (it.recipe || null) : null }; }),
        pos: u._pos || (u._bench != null ? 'bench-' + u._bench : null)
      };
    };
    return {
      app: '金铲铲 AI 多智能体阵容模拟器',
      version: TFT.APP_VERSION,
      savedAt: new Date().toISOString(),
      name: name || '未命名阵容',
      action: action || 'snapshot',
      season: state.season,
      patch: state.patch,
      player: {
        level: state.level, gold: state.gold, hp: state.hp, stage: state.stage, streak: state.streak,
        population: state.boardList().length + ' / ' + state.level,
        interest: TFT.Board.interestOf(state.gold)
      },
      board: state.boardList().map(function (u) { const o = champRef(u); o.row = +u._pos.split('-')[0]; o.col = +u._pos.split('-')[1]; return o; }),
      bench: state.benchList().map(function (u, i) { const o = champRef(u); o.benchSlot = i; return o; }),
      augments: state.augments.map(function (id) {
        const a = TFT.D.augment(id);
        return a ? { id: a.id, name: a.name, tier: a.rarity, desc: a.desc, effects: a.effects } : { id: id };
      }),
      augmentMods: mods,
      activeTraits: traits.filter(t => t.active).map(t => ({ name: t.name, count: t.count, level: t.level ? t.level.min : null, desc: t.def ? t.def.desc : '' })),
      inactiveTraits: traits.filter(t => !t.active).map(t => ({ name: t.name, count: t.count, needMore: t.needMore, nextMin: t.nextMin })),
      poolRemaining: Object.keys(pool).map(function (id) {
        const c = TFT.D.champ(id);
        return { champId: id, name: c ? c.name : id, cost: c ? c.cost : null, remaining: pool[id], total: c ? U.POOL_PER_CHAMP[c.cost] : null };
      }).filter(x => x.remaining < x.total),
      opponents: state.opponents.map(function (o) {
        return {
          id: o.id, name: o.name, hp: o.hp, level: o.level,
          board: state.opponentBoardList(o.id).map(function (u) {
            const c = TFT.D.champ(u.champId);
            return { name: c ? c.name : u.champId, cost: c ? c.cost : null, star: u.star || 1, traits: c ? c.traits : [], items: (u.items || []).map(i => (TFT.D.item(i) || {}).name || i), pos: u._pos };
          })
        };
      }),
      craftLog: state.craftLog.slice(-20)
    };
  };

  /* 从序列化数据恢复 */
  state.loadFrom = function (snap) {
    if (!snap) return;
    if (snap.season && TFT.D.raw[snap.season]) { state.season = snap.season; TFT.D.setSeason(snap.season); }
    state.patch = snap.patch || state.patch;
    state.board = {}; state.bench = [null, null, null, null, null];
    const p = snap.player || {};
    state.level = U.clamp(p.level || 8, 1, 11);
    state.gold = p.gold || 0; state.hp = p.hp == null ? 100 : p.hp;
    state.stage = p.stage || '4-1'; state.streak = p.streak || 0;
    const resolve = function (name, uid) {
      let c = TFT.D.champByName(name);
      if (!c && snap.season && TFT.D.raw[snap.season]) c = (TFT.D.raw[snap.season].champions || []).find(x => x.name === name);
      return c ? c.id : null;
    };
    (snap.board || []).forEach(function (b) {
      const cid = b.champId || resolve(b.name); if (!cid) return;
      const u = state.mkUnit(cid, b.star || 1);
      u.items = (b.items || []).map(i => (i && i.id) || (TFT.D.itemByName(i && i.name || i) || {}).id).filter(Boolean).slice(0, MAX_ITEMS);
      state.putAt(b.row, b.col, u);
    });
    (snap.bench || []).forEach(function (b, i) {
      const cid = b.champId || resolve(b.name); if (!cid) return;
      const u = state.mkUnit(cid, b.star || 1);
      u.items = (b.items || []).map(i => (i && i.id) || (TFT.D.itemByName(i && i.name || i) || {}).id).filter(Boolean).slice(0, MAX_ITEMS);
      if (i < BENCH_MAX) state.bench[i] = u;
    });
    state.augments = (snap.augments || []).map(function (a) {
      if (!a) return null;
      if (a.id) return a.id;
      const found = TFT.D.augmentList().find(x => x.name === a.name);
      return found ? found.id : null;
    }).filter(Boolean).slice(0, MAX_AUGMENTS);
    // 载入阵容后若上阵人口超过当前等级，自动补足等级，避免误报「人口超限」
    const loadedPop = state.boardList().length;
    if (loadedPop > state.level) state.level = U.clamp(loadedPop, 1, 11);
    state.opponents = (snap.opponents || []).map(function (o, i) {
      const ob = {};
      (o.board || []).forEach(function (b) {
        const cid = b.champId || resolve(b.name); if (!cid) return;
        const pos = b.pos || ('5-' + (i % 7));
        ob[pos] = { uid: U.uid('uo'), champId: cid, star: b.star || 1, items: (b.items || []).map(x => (TFT.D.itemByName(x) || {}).id).filter(Boolean) };
      });
      return { id: o.id || U.uid('op'), name: o.name || ('对手 ' + (i + 1)), hp: o.hp == null ? 100 : o.hp, level: o.level || 8, board: ob };
    });
  };

  /* ==================== 升星 / 出售 规则 ==================== */
  const Board = TFT.Board = {};

  /* 真实存储单位（棋盘 + 备战区，非副本） */
  Board.allReal = function () {
    const out = [];
    Object.keys(state.board).forEach(k => { if (state.board[k]) out.push(state.board[k]); });
    state.bench.forEach(b => { if (b) out.push(b); });
    return out;
  };

  /* 同名同星合并：3 个 1★→2★；3 个 2★→3★ */
  Board.tryMerge = function (uid) {
    const all = Board.allReal();
    const target = all.find(u => u.uid === uid);
    if (!target) return false;
    const star = target.star || 1;
    if (star >= 3) return false;
    const same = all.filter(u => u.champId === target.champId && (u.star || 1) === star);
    if (same.length < 3) return false;
    // 保留 target，移除另外两个（装备自动回库）
    same.filter(u => u.uid !== uid).slice(0, 2).forEach(function (o) {
      (o.items || []).forEach(it => Board.returnItem(it));
      state.detach(o.uid);
    });
    target.star = star + 1;
    const c = TFT.D.champ(target.champId);
    TFT.UI.toast('升星成功：' + (c ? c.name : '') + ' → ' + target.star + '★', 'ok');
    return true;
  };

  /* 自动升星（递归检查，可能连锁） */
  Board.autoMergeScan = function () {
    if (!state.autoMerge) return false;
    let changed = false, again = true;
    while (again) {
      again = false;
      const all = Board.allReal();
      const byKey = {};
      all.forEach(function (u) { const k = u.champId + '|' + (u.star || 1); (byKey[k] = byKey[k] || []).push(u); });
      for (const k in byKey) {
        if (byKey[k].length >= 3 && (byKey[k][0].star || 1) < 3) {
          if (Board.tryMerge(byKey[k][0].uid)) { changed = true; again = true; break; }
        }
      }
    }
    return changed;
  };

  /* 出售返还金币：一星原价；2~5 费二星/三星扣 1 金币 */
  Board.sellValue = function (unit) {
    const c = TFT.D.champ(unit.champId); if (!c) return 0;
    const cost = c.cost, star = unit.star || 1;
    let cop = 3 ** (star - 1);
    let g = cost * cop;
    if (star >= 2 && cost >= 2) g -= 1;
    return Math.max(1, Math.round(g));
  };
  Board.sell = function (uid) {
    const all = state.allUnits();
    const u = all.find(x => x.uid === uid); if (!u) return 0;
    const c = TFT.D.champ(u.champId);
    const g = Board.sellValue(u);
    (u.items || []).forEach(it => Board.returnItem(it));
    const p = state.findCellOf(uid);
    if (p) state.takeAt(p.r, p.c); else { const i = state.findBenchIdx(uid); if (i >= 0) state.bench[i] = null; }
    state.gold += g;
    TFT.UI.toast('出售 ' + (c ? c.name : '') + '（' + (u.star || 1) + '★）获得 ' + g + ' 金币', 'ok');
    return g;
  };

  /* 装备：库存只增不减的“素材库”概念——取下即回库由 drag 层管理 */
  Board.returnItem = function (itemId) { /* 素材库为无限库存，无需真正回收；保留钩子便于后续扩展 */ };

  /* ==================== 经济 ==================== */
  Board.mods = () => TFT.D.augmentMods(state.augments);
  Board.interestOf = function (gold) {
    const m = Board.mods();
    return U.clamp(Math.floor((gold || 0) / m.interestPer), 0, m.interestCap);
  };

  /* ==================== D 牌概率（含牌池消耗修正） ==================== */
  const Odds = TFT.Odds = {};
  Odds.base = (level) => U.rollOdds(U.clamp(level, 1, 11));

  /* 各费用总张数（当前赛季） */
  Odds.poolTotalByCost = function () {
    const t = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    TFT.D.champions().forEach(c => { t[c.cost] += U.POOL_PER_CHAMP[c.cost] || 0; });
    return t;
  };
  /* 已被拿走的张数（我方 + 对手 + 手工修正） */
  Odds.ownedByCost = function (manual) {
    const o = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const add = function (u) { const c = TFT.D.champ(u.champId); if (c) o[c.cost] += (u.star || 1); };
    state.boardList().forEach(add); state.benchList().forEach(add);
    state.opponents.forEach(op => state.opponentBoardList(op.id).forEach(add));
    if (manual) Object.keys(manual).forEach(function (id) { const c = TFT.D.champ(id); if (c) o[c.cost] += Number(manual[id]) || 0; });
    return o;
  };
  /* 修正后的每费用概率：base[cost] * 剩余张数/总张数 */
  Odds.adjusted = function (level, manual) {
    const base = Odds.base(level), total = Odds.poolTotalByCost(), owned = Odds.ownedByCost(manual);
    const out = {};
    for (let cost = 1; cost <= 5; cost++) {
      const remain = Math.max(0, total[cost] - owned[cost]);
      const ratio = total[cost] ? remain / total[cost] : 0;
      out[cost] = { base: base[cost - 1], ratio: ratio, adjusted: base[cost - 1] * ratio, remain: remain, total: total[cost] };
    }
    return out;
  };
  /* 单个棋子出现在一次刷新某格的概率 */
  Odds.champChance = function (champId, level, manual) {
    const c = TFT.D.champ(champId); if (!c) return 0;
    const adj = Odds.adjusted(level, manual);
    const costTotal = Odds.poolTotalByCost()[c.cost];
    const costRemain = adj[c.cost].remain;
    const pool = U.poolStatus();
    const champRemain = pool[champId] == null ? 0 : pool[champId];
    if (!costTotal || !costRemain) return 0;
    return (adj[c.cost].adjusted / 100) * (champRemain / costRemain);
  };

  /* ==================== 渲染：棋盘 ==================== */
  const el = {};
  function cache() {
    el.board = U.$('#board'); el.bench = U.$('#bench');
    el.traits = U.$('#traitsPanel'); el.pool = U.$('#poolList');
    el.economy = U.$('#economyTips');
  }

  Board.renderBoard = function () {
    if (!el.board) cache();
    const focus = state.opponents.find(o => o.id === state.focusOpponent) || state.opponents[0] || null;
    let html = '';
    for (let r = 0; r < ROWS; r++) {
      const odd = r % 2 === 1;
      html += '<div class="hex-row' + (odd ? ' odd' : '') + '">';
      for (let c = 0; c < COLS; c++) {
        const isEnemy = r < PLAYER_ROW_START;
        let inner = '';
        if (isEnemy) {
          const u = focus ? TFT.stateEnemyUnit(focus, r, c) : null;
          if (u) inner = '<div class="cell-wrap">' + U.champCardHTML(u, { compact: true }) + '</div>';
        } else {
          const u = state.unitAt(r, c);
          if (u) inner = '<div class="cell-wrap">' + U.champCardHTML(u, {}) + '</div>';
        }
        const cls = 'hex' + (isEnemy ? ' enemy' : '');
        html += '<div class="' + cls + '" data-r="' + r + '" data-c="' + c + '" data-zone="' + (isEnemy ? 'enemy' : 'player') + '">' +
          (r === 0 && c === 3 ? '<span class="hex-enemy-tag">敌方半场' + (focus ? ' · ' + U.esc(focus.name) : '') + '</span>' : '') +
          inner + '</div>';
      }
      html += '</div>';
    }
    el.board.innerHTML = html;
    Board.bindCellEvents();
    Board.renderRangeHighlights();
  };

  /* 敌方半场（镜像映射：对手 row0..3 → 我方显示 row 0..3） */
  TFT.stateEnemyUnit = function (opp, r, c) {
    const u = opp.board[r + '-' + c];
    return u || null;
  };

  Board.bindCellEvents = function () {
    U.$$('#board .hex').forEach(function (cell) {
      U.$$('.champ-card', cell).forEach(function (card) {
        Board.bindCardHover(card);
        card.addEventListener('click', function (e) {
          e.stopPropagation();
          Board.selectUnit(card.dataset.uid);
          if (state.rangeOn) Board.renderRangeHighlights(); else TFT.Main.openChampDetail(card.dataset.champ);
        });
        card.addEventListener('contextmenu', function (e) { e.preventDefault(); TFT.Main.openChampDetail(card.dataset.champ); });
      });
      if (cell.dataset.zone === 'player') {
        cell.addEventListener('click', function () {
          if (state.selected && !state.rangeOn) { state.selected = null; Board.renderAll(); }
        });
      }
    });
  };

  Board.selectUnit = function (uid) {
    state.selected = state.selected === uid ? null : uid;
    U.$$('.champ-card').forEach(c => c.classList.toggle('sel', c.dataset.uid === state.selected));
  };

  /* 攻击范围可视化 */
  Board.renderRangeHighlights = function () {
    U.$$('#board .hex').forEach(h => h.classList.remove('range-hl', 'assassin'));
    if (!state.rangeOn || !state.selected) return;
    const u = state.allUnits().find(x => x.uid === state.selected); if (!u) return;
    const c = TFT.D.champ(u.champId); if (!c) return;
    const pos = state.findCellOf(u.uid); if (!pos) return;
    const range = Math.max(1, Math.round(c.range || 1));
    const isAssassin = /assassin|刺客/i.test(c.role || '') || (c.traits || []).some(t => /刺客/.test(t));
    U.$$('#board .hex').forEach(function (h) {
      const r = +h.dataset.r, cc = +h.dataset.c;
      if (isAssassin) { if (r < PLAYER_ROW_START) { h.classList.add('range-hl', 'assassin'); } return; }
      const d = Math.abs(r - pos.r) + Math.abs(cc - pos.c);
      if (d > 0 && d <= range) h.classList.add('range-hl');
    });
  };

  /* ==================== 渲染：备战区 ==================== */
  Board.renderBench = function () {
    if (!el.bench) cache();
    let html = '';
    for (let i = 0; i < BENCH_MAX; i++) {
      const u = state.bench[i];
      html += '<div class="bench-slot" data-bench="' + i + '">' +
        (u ? '<div class="cell-wrap">' + U.champCardHTML(u, { compact: true }) + '</div>' : '') + '</div>';
    }
    el.bench.innerHTML = html;
    U.$$('#bench .champ-card').forEach(function (card) {
      Board.bindCardHover(card);
      card.addEventListener('click', function (e) {
        e.stopPropagation(); Board.selectUnit(card.dataset.uid);
        if (state.rangeOn) Board.renderRangeHighlights();
      });
      card.addEventListener('contextmenu', function (e) { e.preventDefault(); TFT.Main.openChampDetail(card.dataset.champ); });
    });
  };

  /* ==================== 棋子 Tooltip ==================== */
  Board.bindCardHover = function (card) {
    TFT.UI.bindTip(card, function () {
      const champ = TFT.D.champ(card.dataset.champ); if (!champ) return null;
      const pool = U.poolStatus();
      const remain = pool[champ.id] == null ? '-' : pool[champ.id];
      const s = champ;
      return '<div class="tt-head">' +
        (champ.icon ? '<img src="' + champ.icon + '">' : '') +
        '<div><div class="tt-name">' + U.esc(s.name) + '</div><div class="tt-cost">' + s.cost + ' 费 · ' + U.esc(s.role || '') + '</div></div></div>' +
        '<div class="tt-traits">' + (s.traits || []).map(t => '<span class="mini-tag">' + U.esc(t) + '</span>').join('') + '</div>' +
        '<div class="tt-stat">' +
        '<span class="k">生命值</span><span class="v">' + U.num(s.hp) + '</span>' +
        '<span class="k">攻击力</span><span class="v">' + U.num(s.ad) + '</span>' +
        '<span class="k">护甲 / 魔抗</span><span class="v">' + U.num(s.armor) + ' / ' + U.num(s.mr) + '</span>' +
        '<span class="k">攻击距离</span><span class="v">' + (s.range || 1) + ' 格</span>' +
        '<span class="k">法力值</span><span class="v">' + (s.initialMana || 0) + '/' + (s.mana || 0) + '</span>' +
        '<span class="k">攻速</span><span class="v">' + (s.as || 0.6) + '</span>' +
        '</div>' +
        '<div class="tt-ability"><b>' + U.esc(s.ability ? s.ability.name : '') + '</b>：' + U.esc((s.ability ? s.ability.desc : '') || '').slice(0, 160) + '</div>' +
        '<div class="tt-pool">全局牌池剩余：' + remain + ' 张</div>';
    });
  };

  /* ==================== 渲染：羁绊面板 ==================== */
  Board.renderTraits = function () {
    if (!el.traits) cache();
    const traits = U.calcTraits(state.boardList(), state.benchList());
    const active = traits.filter(t => t.active);
    const inactive = traits.filter(t => !t.active && t.count > 0);
    U.$('#traitSummary').textContent = '已激活 ' + active.length + ' 个羁绊';
    let html = '';
    traits.forEach(function (t) {
      const key = U.styleKey(t.level, t.def);
      const cls = 'trait-chip ' + (t.active ? 'on ' + key : 'off');
      html += '<span class="' + cls + '" data-trait="' + U.esc(t.name) + '">' +
        (t.def && t.def.icon ? '<img src="' + t.def.icon + '">' : '<span class="tc-fb">' + U.esc(t.name.slice(0, 1)) + '</span>') +
        '<span>' + U.esc(t.name) + '</span><span class="cnt">' + t.count + '</span>' +
        (t.level ? '<span class="dim">/' + t.level.min + '</span>' : (t.nextMin ? '<span class="dim">差' + t.needMore + '</span>' : '')) +
        '</span>';
    });
    if (!html) html = '<span class="dim">拖拽棋子到棋盘后自动计算羁绊</span>';
    el.traits.innerHTML = html;
    U.$$('#traitsPanel .trait-chip').forEach(function (chip) {
      const t = traits.find(x => x.name === chip.dataset.trait);
      TFT.UI.bindTip(chip, function () {
        if (!t || !t.def) return null;
        return '<div class="tt-name">' + U.esc(t.name) + '</div>' +
          '<div class="tt-cost">上场 ' + t.count + ' 人' + (t.emblems ? '（含 ' + t.emblems + ' 个转职）' : '') + '</div>' +
          '<div style="margin-top:4px;color:#cfe3ff">' + U.esc((t.def.desc || '').replace(/\n/g, '<br>')) + '</div>' +
          '<div style="margin-top:4px;color:var(--cyan)">' + (t.def.levels || []).map(l => l.min + (l.max && l.max !== l.min ? '~' + l.max : '') + '人 / ' + l.min + '档').join(' · ') + '</div>' +
          (t.active ? '' : '<div style="margin-top:4px;color:var(--orange)">还差 ' + t.needMore + ' 枚棋子激活下一层羁绊</div>');
      });
    });
    /* 羁绊断点提示 */
    const bp = traits.filter(t => !t.active && t.nextMin && t.needMore <= 2);
    if (bp.length) TFT.UI.toast(bp.map(t => t.name + ' 还差 ' + t.needMore + ' 枚激活下一档').join('；'), 'warn', 3200);
  };

  /* ==================== 渲染：牌池面板 ==================== */
  Board.renderPool = function () {
    if (!el.pool) cache();
    const pool = U.poolStatus();
    const onBoard = {};
    state.allUnits().forEach(u => { onBoard[u.champId] = true; });
    const champs = TFT.D.champions().slice().sort(function (a, b) {
      const oa = onBoard[a.id] ? 0 : 1, ob = onBoard[b.id] ? 0 : 1;
      return oa - ob || a.cost - b.cost || a.name.localeCompare(b.name, 'zh');
    });
    let html = '', used = 0, totalUsed = 0;
    champs.forEach(function (c) {
      const total = U.POOL_PER_CHAMP[c.cost], remain = pool[c.id];
      const taken = total - remain;
      if (taken > 0) { used++; totalUsed += taken; }
      if (!onBoard[c.id] && taken === 0) return; // 未涉及的不展示，避免过长
      const cls = remain <= 3 ? 'low' : remain >= total * 0.7 ? 'high' : '';
      html += '<div class="pool-row ' + cls + '"><span class="left">' + c.cost + '费 ' + U.esc(c.name) + '</span><span class="right">' + remain + '/' + total + '</span></div>';
    });
    el.pool.innerHTML = html || '<span class="dim">牌池未被占用</span>';
    U.$('#poolSummary').textContent = '占用 ' + totalUsed + ' 张 / 涉及 ' + used + ' 名英雄';
  };

  /* ==================== 渲染：经济提示 ==================== */
  Board.renderEconomy = function () {
    if (!el.economy) cache();
    const m = Board.mods();
    const interest = Board.interestOf(state.gold);
    const nextTier = (Math.floor(state.gold / m.interestPer) + 1) * m.interestPer;
    const dropTier = Math.max(0, Math.floor(state.gold / m.interestPer)) * m.interestPer;
    const tips = [];
    tips.push('<div class="tip ' + (interest >= m.interestCap ? 'ok' : '') + '">💰 <span>当前 <b>' + state.gold + '</b> 金币，利息 <b>+' + interest + '</b>（上限 ' + m.interestCap + '）</span></div>');
    if (state.gold < 10) tips.push('<div class="tip">📉 <span>金币较少，建议优先存到 <b>10</b> 吃满 1 利息</span></div>');
    else if (interest < m.interestCap) tips.push('<div class="tip ok">📈 <span>距下一档利息还需 <b>' + (nextTier - state.gold) + '</b> 金币（存到 ' + nextTier + ' 可得 ' + Math.min(m.interestCap, interest + 1) + ' 利息）</span></div>');
    else tips.push('<div class="tip ok">🏦 <span>已吃满利息上限，存钱收益最大化，继续存钱即可</span></div>');
    if (state.gold % m.interestPer !== 0) tips.push('<div class="tip warn">⚠️ <span>当前 D 到 ' + dropTier + ' 金币会丢失 <b>1</b> 点利息</span></div>');
    if (m.goldPerRound) tips.push('<div class="tip ok">🎁 <span>海克斯提供每回合 +<b>' + m.goldPerRound + '</b> 金币</span></div>');
    if (m.maxLevel > 9) tips.push('<div class="tip ok">🔼 <span>海克斯使最高等级提升到 <b>' + m.maxLevel + '</b></span></div>');
    const pop = state.boardList().length;
    if (pop > state.level) tips.push('<div class="tip warn">🚨 <span>上阵人口 <b>' + pop + '</b> 超过当前等级 <b>' + state.level + '</b>，请下阵棋子</span></div>');
    el.economy.innerHTML = tips.join('');
  };

  /* ==================== 渲染：状态面板 ==================== */
  Board.renderState = function () {
    U.$('#levelVal').textContent = state.level;
    U.$('#goldVal').textContent = state.gold;
    U.$('#hpVal').textContent = state.hp;
    U.$('#streakVal').textContent = state.streak;
    U.$('#stageSelect').value = state.stage;
    const m = Board.mods();
    const expNeed = U.expToNext(state.level, m.maxLevel);
    U.$('#levelExp').textContent = state.level >= m.maxLevel ? '已达最高等级' : '升级还需 ' + expNeed + ' 经验';
    U.$('#levelExp').className = 'ctl-sub' + (state.level >= m.maxLevel ? ' ok' : '');
    U.$('#interestInfo').textContent = '利息 +' + Board.interestOf(state.gold) + ' / 上限 ' + m.interestCap;
    const hpEl = U.$('#hpWarn');
    hpEl.textContent = state.hp <= 0 ? '本局失败' : state.hp <= 30 ? '血量告急，优先保血' : state.hp <= 60 ? '血量偏低，注意容错' : '状态良好';
    hpEl.className = 'ctl-sub' + (state.hp <= 0 ? ' bad' : state.hp <= 30 ? ' bad' : state.hp <= 60 ? ' warn' : ' ok');
    U.$('#streakInfo').textContent = state.streak >= 0 ? '连胜 ' + state.streak : '连败 ' + Math.abs(state.streak);
    const pop = state.boardList().length;
    const badge = U.$('#popBadge');
    badge.textContent = '人口 ' + pop + '/' + state.level;
    badge.className = 'badge ' + (pop > state.level ? 'badge-danger' : 'badge-info');
  };

  /* ==================== 全量渲染 ==================== */
  Board.renderAll = function () {
    Board.renderBoard();
    Board.renderBench();
    Board.renderTraits();
    Board.renderPool();
    Board.renderEconomy();
    Board.renderState();
    if (TFT.Main && TFT.Main.refreshTab) TFT.Main.refreshTab();
  };

  /* 变更提交：序列化 + 持久化 + 刷新 */
  Board.commit = function (reason) {
    state.dirty = true;
    TFT.Store.saveCurrent(state.serialize('自动保存', reason || 'change'));
    Board.renderAll();
    if (TFT.AI) TFT.AI.updateCtxBadge();
  };

  /* 等级/金币/血量/连胜 步进 */
  Board.step = function (key, delta) {
    const m = Board.mods();
    if (key === 'level') state.level = U.clamp(state.level + delta, 1, m.maxLevel);
    if (key === 'gold') state.gold = Math.max(0, state.gold + delta);
    if (key === 'hp') state.hp = U.clamp(state.hp + delta, 0, 100);
    if (key === 'streak') state.streak = U.clamp(state.streak + delta, -10, 20);
    Board.commit('step-' + key);
  };

  TFT.BoardInit = function () { cache(); };

})(window.TFT);
