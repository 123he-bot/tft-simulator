/* ============ main.js —— 主控：六大素材标签面板 / 全局浮层工具 / 全站事件绑定 / 初始化 ============ */
window.TFT = window.TFT || {};
(function (TFT) {
  'use strict';
  const U = TFT.U, S = TFT.state, D = TFT.D, B = TFT.Board;
  const Main = TFT.Main = {};
  const $ = U.$, $$ = U.$$;

  /* ==================== 常量 ==================== */
  const ROLE_LABEL = {
    ADFighter: 'AD 战士', ADCarry: 'AD 主C', ADCaster: 'AD 法系', ADTank: 'AD 坦克',
    ADSpecialist: 'AD 特工', ADReaper: 'AD 收割', APFighter: 'AP 战士', APCarry: 'AP 主C',
    APCaster: 'AP 法师', APTank: 'AP 坦克', APReaper: 'AP 收割', HFighter: '混合战士'
  };
  const roleLabel = (r) => ROLE_LABEL[r] || (r || '其它');
  const COST_LIST = [1, 2, 3, 4, 5];

  /* MetaTFT 真实集群数据：逐阵容胜率/场均名次已被官方归档，改用真实对线数据推导的相对强度展示 */
  function strengthLabel(s) { return (s == null) ? '—' : ((s > 0 ? '+' : '') + Number(s).toFixed(2)); }

  const tabState = {
    active: 'champions',
    champCost: 0, champTrait: '', champRole: '', champQ: '',
    augTier: '', augQ: '',
    itemCat: 'components',
    oddsLevel: 8, oddsManual: {},
    forgeSlots: [null, null], history: [],
    te: { trait: '', must: '', emblem: '', results: [] }
  };

  const uiState = { season: 's17', patch: '14.18' };

  /* ==================== 小工具 ==================== */
  function pool() { return U.poolStatus(); }

  function playerCells() {
    const out = [];
    for (let r = TFT.LIMITS.PLAYER_ROW_START; r < TFT.LIMITS.ROWS; r++)
      for (let c = 0; c < TFT.LIMITS.COLS; c++) out.push({ r: r, c: c });
    return out;
  }
  function firstEmptyPlayerCell() {
    return playerCells().find(p => !S.unitAt(p.r, p.c)) || null;
  }
  function firstEmptyBench() {
    const i = S.bench.findIndex(b => !b);
    return i >= 0 ? i : -1;
  }

  /* 棋库卡片（可拖拽） */
  function libChampCard(c) {
    const remain = pool()[c.id];
    return '<div class="grid-card" data-drag="champ" data-champ="' + U.esc(c.id) + '" title="' + U.esc(c.name + ' · ' + roleLabel(c.role)) + '">' +
      (remain == null ? '' : '<div class="pool-badge">' + remain + '</div>') +
      '<div class="champ-card compact" data-champ="' + U.esc(c.id) + '" data-cost="' + c.cost + '" data-star="1">' +
      '<div class="avatar-fb">' + U.esc(c.name.slice(0, 1)) + '</div>' +
      (c.icon ? '<img class="avatar" src="' + U.champIcon(c) + '" alt="">' : '') +
      '<div class="cost">' + c.cost + '</div>' +
      '<div class="name">' + U.esc(c.name) + '</div>' +
      '</div></div>';
  }

  /* 装备卡片（可拖拽） */
  function itemCard(it) {
    const url = U.itemIcon(it);
    return '<div class="item-card" data-drag="item" data-item="' + U.esc(it.id) + '">' +
      (url ? '<img src="' + url + '" alt="">' : '<div class="it-fb">装</div>') +
      '<div class="inm">' + U.esc(it.name) + '</div></div>';
  }
  function bindItemTip(cardEl) {
    TFT.UI.bindTip(cardEl, function () {
      const it = D.item(cardEl.dataset.item); if (!it) return null;
      const recipe = (it.recipe || []).map(id => (D.item(id) || {}).name || id);
      return '<div class="tt-head">' +
        (U.itemIcon(it) ? '<img src="' + U.itemIcon(it) + '">' : '') +
        '<div><div class="tt-name">' + U.esc(it.name) + '</div><div class="tt-cost">' +
        (recipe.length ? '配方：' + U.esc(recipe.join(' + ')) : (D.items.artifacts || []).some(a => a.id === it.id) ? '奥恩神器' : '基础小件') +
        '</div></div></div>' +
        '<div style="color:#cfe3ff">' + U.esc(it.stat || it.desc || '') + '</div>';
    });
  }

  /* ==================== 棋子库 Tab ==================== */
  function renderChampFilters() {
    const cf = $('#champCostFilters');
    cf.innerHTML = '<button class="fbtn' + (tabState.champCost === 0 ? ' on' : '') + '" data-cost="0">全部</button>' +
      COST_LIST.map(c => '<button class="fbtn' + (tabState.champCost === c ? ' on' : '') + '" data-cost="' + c + '">' + c + ' 费</button>').join('');

    const tf = $('#champTraitFilter');
    const names = D.traits().map(t => t.name).sort((a, b) => a.localeCompare(b, 'zh'));
    tf.innerHTML = '<option value="">全部羁绊</option>' + names.map(n => '<option value="' + U.esc(n) + '">' + U.esc(n) + '</option>').join('');
    tf.value = tabState.champTrait || '';

    const rf = $('#champRoleFilter');
    const roles = [];
    D.champions().forEach(c => { if (c.role && roles.indexOf(c.role) < 0) roles.push(c.role); });
    roles.sort();
    rf.innerHTML = '<option value="">全部职业</option>' + roles.map(r => '<option value="' + U.esc(r) + '">' + U.esc(roleLabel(r)) + '</option>').join('');
    rf.value = tabState.champRole || '';
  }

  function renderChampions() {
    renderChampFilters();
    $('#champSearch').value = tabState.champQ || '';
    const q = (tabState.champQ || '').toLowerCase();
    const list = D.champions().filter(function (c) {
      if (tabState.champCost && c.cost !== tabState.champCost) return false;
      if (tabState.champTrait && (c.traits || []).indexOf(tabState.champTrait) < 0) return false;
      if (tabState.champRole && c.role !== tabState.champRole) return false;
      if (q && c.name.toLowerCase().indexOf(q) < 0 && (c.traits || []).join('').toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'zh'));

    const box = $('#champList');
    box.innerHTML = list.length ? list.map(libChampCard).join('') : '<div class="dim" style="padding:12px">没有符合条件的棋子</div>';
    $$('#champList .item-card').forEach(() => { });
    $$('#champList .grid-card').forEach(function (gc) {
      const c = D.champ(gc.dataset.champ);
      TFT.UI.bindTip(gc, function () {
        if (!c) return null;
        const s = c;
        return '<div class="tt-head">' + (c.icon ? '<img src="' + c.icon + '">' : '') +
          '<div><div class="tt-name">' + U.esc(s.name) + '</div><div class="tt-cost">' + s.cost + ' 费 · ' + U.esc(roleLabel(s.role)) + '</div></div></div>' +
          '<div class="tt-traits">' + (s.traits || []).map(t => '<span class="mini-tag">' + U.esc(t) + '</span>').join('') + '</div>' +
          '<div class="tt-stat">' +
          '<span class="k">生命值</span><span class="v">' + U.num(s.hp) + '</span>' +
          '<span class="k">攻击力</span><span class="v">' + U.num(s.ad) + '</span>' +
          '<span class="k">护甲/魔抗</span><span class="v">' + U.num(s.armor) + '/' + U.num(s.mr) + '</span>' +
          '<span class="k">攻击距离</span><span class="v">' + (s.range || 1) + ' 格</span>' +
          '<span class="k">攻速</span><span class="v">' + (s.as || 0.6) + '</span>' +
          '<span class="k">牌池剩余</span><span class="v">' + (pool()[s.id] == null ? '-' : pool()[s.id]) + '</span>' +
          '</div>' +
          '<div class="tt-ability"><b>' + U.esc(s.ability ? s.ability.name : '') + '</b>：' + U.esc(((s.ability ? s.ability.desc : '') || '').replace(/—[^—]*/g, 'n')).slice(0, 140) + '</div>' +
          '<div class="dim" style="margin-top:4px">左键拖到棋盘上阵 · 点击查看详情</div>';
      });
      gc.addEventListener('click', function () { Main.openChampDetail(gc.dataset.champ); });
    });
  }

  /* ==================== 海克斯 Tab ==================== */
  function renderAugments() {
    const tf = $('#augmentTierFilter');
    const tiers = [['', '全部'], ['棱彩', '棱彩'], ['金', '金色'], ['银', '银色'], ['特殊', '特殊']];
    tf.innerHTML = tiers.map(t => '<button class="fbtn' + (tabState.augTier === t[0] ? ' on' : '') +
      '" data-rarity="' + t[0] + '">' + t[1] + '</button>').join('');
    $('#augmentSearch').value = tabState.augQ || '';

    const q = (tabState.augQ || '').toLowerCase();
    const list = D.augmentList().filter(function (a) {
      if (tabState.augTier && a.rarity !== tabState.augTier) return false;
      if (q && (a.name || '').toLowerCase().indexOf(q) < 0 && (a.desc || '').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });

    /* 已选区域 */
    const sel = $('#augmentSelected');
    const chosen = S.augments.map(id => D.augment(id)).filter(Boolean);
    sel.innerHTML = chosen.length
      ? chosen.map(a => '<span class="aslot"><b style="color:var(--cyan)">' + U.esc(a.name) + '</b><span class="dim">' + a.rarity + '</span><span class="x" data-rm="' + U.esc(a.id) + '">✕</span></span>').join('')
      : '<span class="empty">未选择海克斯（最多 3 个，勾选后实时影响经济与属性修正）</span>';
    $$('#augmentSelected [data-rm]').forEach(b => b.onclick = function () {
      S.augments = S.augments.filter(x => x !== b.dataset.rm);
      B.commit('augment-remove');
    });

    const box = $('#augmentList');
    const TIER_COLOR = { silver: '#94a3b8', gold: '#f5c542', prismatic: '#a855f7', unknown: '#8b9bb4' };
    box.innerHTML = list.length ? list.map(function (a) {
      const on = S.augments.indexOf(a.id) >= 0;
      return '<div class="aug-card ' + a.rarityKey + (on ? ' on' : '') + '" data-aug="' + U.esc(a.id) + '">' +
        '<div class="an"><span>' + U.esc(a.name) + '</span><span class="at" style="color:' +
        (TIER_COLOR[a.rarityKey] || '#8b9bb4') + '">' + U.esc(a.rarity) + '</span></div>' +
        '<div class="ad">' + U.esc(a.desc || '') + '</div></div>';
    }).join('') : '<div class="dim" style="padding:12px">没有符合条件的效果</div>';

    $$('#augmentList .aug-card').forEach(function (card) {
      const a = D.augment(card.dataset.aug);
      TFT.UI.bindTip(card, function () {
        if (!a) return null;
        return '<div class="tt-name">' + U.esc(a.name) + '（' + a.rarity + '）</div>' +
          '<div style="color:#cfe3ff;margin-top:4px">' + U.esc(a.desc || '') + '</div>' +
          ((a.effects || []).length ? '<div class="tt-pool">数值修正：' + U.esc(a.effects.map(e => e.label).join('、')) + '</div>' : '') +
          ((a.fit || []).length ? '<div class="dim">适配体系：' + U.esc(a.fit.join('、')) + '</div>' : '');
      });
      card.addEventListener('click', function () {
        if (!a) return;
        if (S.augments.indexOf(a.id) >= 0) S.augments = S.augments.filter(x => x !== a.id);
        else if (S.augments.length >= TFT.LIMITS.MAX_AUGMENTS) { TFT.UI.toast('海克斯最多选择 3 个', 'warn'); return; }
        else S.augments.push(a.id);
        B.commit('augment-toggle');
      });
    });
  }

  /* ==================== 装备 Tab ==================== */
  function renderItems() {
    const cats = [['components', '基础小件'], ['completed', '成品装备'], ['artifacts', '奥恩神器']];
    $('#itemCatTabs').innerHTML = cats.map(c => '<button class="fbtn' + (tabState.itemCat === c[0] ? ' on' : '') +
      '" data-cat="' + c[0] + '">' + c[1] + '</button>').join('');
    const list = D.items[tabState.itemCat] || [];
    $('#itemList').innerHTML = list.map(itemCard).join('');
    $$('#itemList .item-card').forEach(function (c) { bindItemTip(c); });
  }

  /* ==================== 合成图谱 Tab ==================== */
  const Forge = TFT.Forge = {};
  Forge.refreshHistory = function () { renderForgeHistory(); };

  Forge.setSlot = function (idx, itemId) {
    if (idx !== 0 && idx !== 1) return;
    if (!D.item(itemId)) return;
    tabState.forgeSlots[idx] = itemId;
    renderForgeCore();
    const r = Forge.match();
    if (r && r.completed) {
      tabState.history.unshift({ a: tabState.forgeSlots[0], b: tabState.forgeSlots[1], out: r.completed.id, time: Date.now() });
      tabState.history = tabState.history.slice(0, 40);
      renderForgeHistory();
      TFT.UI.toast('合成成功：' + r.completed.name, 'ok');
    }
  };
  Forge.match = function () {
    const a = tabState.forgeSlots[0], b = tabState.forgeSlots[1];
    if (!a || !b) return { completed: null };
    const ca = D.item(a), cb = D.item(b);
    const isComp = it => (D.items.components || []).some(x => x.id === (it && it.id));
    if (ca && ca.id === 'spatula') return { completed: null, emblem: cb ? cb.name : '' };
    if (cb && cb.id === 'spatula') return { completed: null, emblem: ca ? ca.name : '' };
    if (isComp(ca) && isComp(cb)) return { completed: D.completedByRecipe(ca.id, cb.id) };
    return { completed: null };
  };

  function forgeSlotHTML(idx) {
    const id = tabState.forgeSlots[idx];
    const it = id ? D.item(id) : null;
    const url = it ? U.itemIcon(it) : null;
    return url ? '<img src="' + url + '" alt="">' : '<span>' + (idx === 0 ? '小件 A' : '小件 B') + '</span>';
  }
  function renderForgeCore() {
    $('#forgeSlot0').innerHTML = forgeSlotHTML(0);
    $('#forgeSlot1').innerHTML = forgeSlotHTML(1);
    const res = Forge.match();
    const box = $('#forgeResult');
    if (res.completed) {
      box.className = 'forge-result match';
      box.innerHTML = (U.itemIcon(res.completed) ? '<img src="' + U.itemIcon(res.completed) + '">' : '<span>' + U.esc(res.completed.name) + '</span>');
      box.title = res.completed.name + '：' + (res.completed.stat || '');
    } else if (res.emblem) {
      box.className = 'forge-result';
      box.innerHTML = '<span>转职<br>纹章</span>';
      box.title = '金铲铲 + ' + res.emblem + ' = 合成对应转职纹章';
    } else {
      box.className = 'forge-result ' + (tabState.forgeSlots[0] && tabState.forgeSlots[1] ? 'miss' : '');
      box.innerHTML = '<span>?</span>';
      box.title = '';
    }
  }
  function renderForgeHistory() {
    const box = $('#forgeHistory'); if (!box) return;
    box.innerHTML = tabState.history.length ? tabState.history.map(function (h) {
      const a = D.item(h.a), b = D.item(h.b), o = D.item(h.out);
      const ic = it => it && U.itemIcon(it) ? '<img src="' + U.itemIcon(it) + '">' : '<span class="dim">·</span>';
      return '<div class="hrow">' + ic(a) + '<span>+</span>' + ic(b) + '<span>=</span>' + ic(o) +
        '<span style="margin-left:auto">' + U.esc(o ? o.name : '') + '</span></div>';
    }).join('') : '<div class="dim">还没有合成记录</div>';
  }

  function renderForge() {
    const comps = D.items.components || [];
    $('#forgeComponents').innerHTML = comps.map(itemCard).join('');
    $$('#forgeComponents .item-card').forEach(c => bindItemTip(c));
    $('#ornnList').innerHTML = (D.items.artifacts || []).map(itemCard).join('');
    $$('#ornnList .item-card').forEach(c => bindItemTip(c));
    renderForgeCore();
    renderForgeHistory();
    $('#forgeSlot0').onclick = function () { tabState.forgeSlots[0] = null; renderForgeCore(); };
    $('#forgeSlot1').onclick = function () { tabState.forgeSlots[1] = null; renderForgeCore(); };
    $('#forgeResult').onclick = function () {
      const r = Forge.match();
      if (r.completed) TFT.UI.toast(r.completed.name + '：' + (r.completed.stat || ''), 'ok', 3600);
      else TFT.UI.toast('拖拽两件基础小件到左侧格子试配方', 'warn');
    };
  }

  /* ==================== D 牌概率 Tab ==================== */
  /* 理论概率表行（#pane-odds 与抽卡模拟器共用） */
  function oddsTableHTML(adj) {
    return COST_LIST.map(function (cost) {
      const d = adj[cost];
      const w = U.clamp(d.adjusted, 0, 100);
      return '<div class="odds-row" data-cost="' + cost + '" title="基础 ' + d.base.toFixed(1) + '% · 牌池剩余 ' + d.remain + '/' + d.total + '">' +
        '<span class="dim">' + cost + ' 费</span>' +
        '<div class="odds-bar"><span style="width:' + w.toFixed(1) + '%"></span></div>' +
        '<span style="color:var(--cyan);font-weight:700">' + d.adjusted.toFixed(1) + '%</span></div>';
    }).join('');
  }

  function renderOdds() {
    const lv = $('#oddsLevel');
    if (!lv.options.length) lv.innerHTML = Array.from({ length: 11 }, (_, i) => '<option value="' + (i + 1) + '">' + (i + 1) + ' 级</option>').join('');
    lv.value = tabState.oddsLevel;

    const adj = TFT.Odds.adjusted(tabState.oddsLevel, tabState.oddsManual);
    $('#oddsTable').innerHTML = oddsTableHTML(adj);

    /* 已消耗卡牌修正 */
    const st = pool();
    const inPlay = {};
    S.allUnits().forEach(u => { inPlay[u.champId] = (inPlay[u.champId] || 0) + (u.star || 1); });
    S.opponents.forEach(o => S.opponentBoardList(o.id).forEach(u => { inPlay[u.champId] = (inPlay[u.champId] || 0) + (u.star || 1); }));
    const ids = Object.keys(inPlay).sort((a, b) => {
      const ca = D.champ(a), cb = D.champ(b); return (ca ? ca.cost : 9) - (cb ? cb.cost : 9);
    });
    $('#oddsOwned').innerHTML = ids.length ? ids.map(function (id) {
      const c = D.champ(id); if (!c) return '';
      return '<div class="owned-row"><span>' + c.cost + '费 ' + U.esc(c.name) + '</span>' +
        '<input type="number" min="0" value="' + (tabState.oddsManual[id] || 0) + '" data-own="' + U.esc(id) + '">' +
        '<span class="owns-core">场上已占 ' + inPlay[id] + ' 张 · 池余 ' + (st[id] == null ? '-' : st[id]) + '</span></div>';
    }).join('') : '<div class="dim">场内暂无棋子，无需修正</div>';
    $$('#oddsOwned [data-own]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        const v = Math.max(0, Number(inp.value) || 0);
        if (v) tabState.oddsManual[inp.dataset.own] = v; else delete tabState.oddsManual[inp.dataset.own];
        renderOdds();
      });
    });

    const best = COST_LIST.slice().sort((a, b) => adj[b].adjusted - adj[a].adjusted)[0];
    const totalRoll = COST_LIST.reduce((s, c) => s + adj[c].adjusted, 0);
    $('#oddsResult').innerHTML =
      '<div>当前 <b>' + tabState.oddsLevel + ' 级</b> 单格出现概率合计 <b>' + totalRoll.toFixed(1) + '%</b>（牌池消耗已修正）</div>' +
      '<div>刷新收益最高：<b>' + best + ' 费</b>（' + adj[best].adjusted.toFixed(1) + '%），建议主搜该费用核心</div>' +
      '<div class="dim">提示：公式 = 基础概率 × (费用剩余张数 ÷ 费用总张数)，对手拿走越多，实际概率越低。</div>';
  }

  /* ==================== 羁绊探索器 Tab ==================== */
  function fillTraitSelects() {
    const names = D.traits().map(t => t.name).sort((a, b) => a.localeCompare(b, 'zh'));
    $('#teTargetTrait').innerHTML = '<option value="">选择目标羁绊</option>' + names.map(n => '<option value="' + U.esc(n) + '">' + U.esc(n) + '</option>').join('');
    $('#teMustChamps').innerHTML = '<option value="">必须包含棋子</option>' + D.champions().slice().sort((a, b) => a.cost - b.cost).map(c => '<option value="' + U.esc(c.id) + '">' + c.cost + '费 ' + U.esc(c.name) + '</option>').join('');
    $('#teEmblem').innerHTML = '<option value="">转职装备（额外 +1 羁绊）</option>' + names.map(n => '<option value="' + U.esc(n) + '">' + U.esc(n) + ' 转职 +1</option>').join('');
    $('#teTargetTrait').value = tabState.te.trait || '';
    $('#teMustChamps').value = tabState.te.must || '';
    $('#teEmblem').value = tabState.te.emblem || '';
  }

  function combos(arr, k, cap) {
    const out = [], cur = [];
    (function rec(start) {
      if (out.length >= cap) return;
      if (cur.length === k) { out.push(cur.slice()); return; }
      for (let i = start; i < arr.length; i++) {
        cur.push(arr[i]); rec(i + 1); cur.pop();
        if (out.length >= cap) return;
      }
    })(0);
    return out;
  }

  function evalComp(champs, emblemTrait, emblemCount) {
    const units = champs.map(c => S.mkUnit(c.id, 2));
    let traits = U.calcTraits(units, []);
    if (emblemTrait && emblemCount) {
      let t = traits.find(x => x.name === emblemTrait);
      if (!t) { const def = D.trait(emblemTrait); t = { name: emblemTrait, count: 0, emblems: 0, def: def || null, level: null, active: false, nextMin: null, needMore: 0 }; traits.push(t); }
      t.count += emblemCount; t.emblems += emblemCount;
      const def = t.def || D.trait(emblemTrait);
      t.level = null;
      ((def && def.levels) || []).forEach(lv => { if (t.count >= lv.min) t.level = lv; });
      t.active = !!t.level;
    }
    const active = traits.filter(x => x.active && x.count > 0);
    const cost = champs.reduce((s, c) => s + (c.cost || 1), 0);
    return { traits: traits, active: active, cost: cost };
  }

  function runTraitExplorer() {
    const tname = $('#teTargetTrait').value;
    if (!tname) { TFT.UI.toast('请先选择目标羁绊', 'warn'); return; }
    tabState.te.trait = tname; tabState.te.must = $('#teMustChamps').value; tabState.te.emblem = $('#teEmblem').value;
    const def = D.trait(tname);
    const levelMin = def && def.levels && def.levels.length ? def.levels[def.levels.length - 1].min : 3;
    const emblemCount = tabState.te.emblem === tname ? 1 : 0;
    let need = Math.max(1, levelMin - emblemCount);

    let cands = D.champions().filter(c => (c.traits || []).indexOf(tname) >= 0).sort((a, b) => a.cost - b.cost);
    if (tabState.te.must) {
      const mu = D.champ(tabState.te.must);
      if (mu && cands.indexOf(mu) < 0) cands.push(mu);
    }
    if (!cands.length) {
      $('#teResults').innerHTML = '<div class="dim" style="padding:12px">S 赛季没有该羁绊的棋子数据</div>';
      return;
    }
    if (need > cands.length) need = cands.length;

    const raw = combos(cands, need, 20000);
    const mustChamp = tabState.te.must ? D.champ(tabState.te.must) : null;
    const scored = raw.map(function (set) {
      if (mustChamp && set.indexOf(mustChamp) < 0) return null;
      const ev = evalComp(set, tabState.te.emblem || null, emblemCount);
      const target = ev.active.find(a => a.name === tname);
      return { set: set, ev: ev, targetLevel: target ? (target.level ? target.level.min : 0) : 0, score: ev.active.length * 100 - ev.cost };
    }).filter(Boolean).filter(r => r.targetLevel >= levelMin)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    tabState.te.results = scored;
    renderTeResults('#teResults', scored, tname, levelMin);
  }

  function renderTeResults(sel, scored, tname, levelMin) {
    const box = $(sel); if (!box) return;
    if (!scored.length) {
      box.innerHTML = '<div class="dim" style="padding:12px">未找到能激活 ' + U.esc(tname) + '（' + levelMin + ' 档）的可行组合，尝试加转职或降低档位要求</div>';
      return;
    }
    const maxScore = Math.max.apply(null, scored.map(r => r.score)) || 1;
    box.innerHTML = scored.map(function (r, i) {
      const units = r.set.map(function (c) {
        const key = (c.traits || []).indexOf(tname) >= 0;
        return '<span class="u cc' + c.cost + (key ? ' c' : '') + '" title="' + U.esc(c.name + ' · ' + c.cost + ' 费') + '">' +
          (c.icon ? '<img src="' + U.esc(c.icon) + '" alt="">' : '') +
          '<span>' + U.esc(c.name) + '</span>' +
          '<span class="u-cost">' + c.cost + '</span></span>';
      }).join('');
      const others = r.ev.active.filter(a => a.name !== tname);
      const traits = others.map(a => U.esc(a.name) + ' <b>' + a.count + '</b>').join(' · ') || '无附加羁绊';
      const pct = Math.round((r.score / maxScore) * 100);
      return '<div class="te-card" data-idx="' + i + '">' +
        '<div class="te-head"><span class="te-rank-badge">' + (i + 1) + '</span>' +
        '<span class="te-score">综合评分 <b>' + r.score + '</b>' + '<span class="te-bar"><i style="width:' + pct + '%"></i></span>' + '</span></div>' +
        '<div class="te-units">' + units + '</div>' +
        '<div class="te-meta"><span>人口 <b>' + r.set.length + '</b></span><span>总费用 <b>' + r.ev.cost + '</b></span>' +
        '<span>目标 ' + U.esc(tname) + ' <b>' + r.targetLevel + ' 档</b></span><span>附加羁绊 <b>' + others.length + '</b></span></div>' +
        '<div class="te-traits">其它激活：' + traits + '</div>' +
        '<div class="m-row" style="margin-top:6px"><button class="btn btn-xs btn-primary" data-load="' + i + '">一键上阵</button>' +
        '<button class="btn btn-xs" data-ask="' + i + '">让 AI 评估</button></div></div>';
    }).join('');
    $$(sel + ' [data-load]').forEach(b => b.onclick = function () { Main.loadCompUnits(tabState.te.results[+b.dataset.load].set); });
    $$(sel + ' [data-ask]').forEach(b => b.onclick = function () {
      const r = tabState.te.results[+b.dataset.ask];
      Main.closeAndAsk('请评估这套以「' + tname + '」为核心的候选阵容（' + r.set.map(c => c.name).join('、') + '），分析强度、站位与装备分配、以及是否值得追三星。');
    });
  }

  Main.loadCompUnits = function (champList) {
    if (!champList || !champList.length) return;
    S.clearBoard();
    const tanks = champList.filter(c => /Tank|坦克/.test(c.role || '')), others = champList.filter(c => !/Tank|坦克/.test(c.role || ''));
    const cells = playerCells();
    const order = tanks.concat(others);
    order.forEach(function (c, i) {
      if (i >= cells.length) return;
      const p = cells[i];
      S.putAt(p.r, p.c, S.mkUnit(c.id, 1));
    });
    // 上阵人口超过当前等级时自动补足等级，避免误报「人口超限」
    if (order.length > S.level) S.level = Math.min(order.length, 9);
    TFT.UI.closeModal();
    B.commit('load-comp');
    TFT.UI.toast('已上阵 ' + order.length + ' 名棋子（' + champList.length + ' 人口）', 'ok');
  };

  /* ==================== Tab 切换与刷新 ==================== */
  Main.setTab = function (name) {
    tabState.active = name;
    $$('#tabBar .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $$('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + name));
    Main.refreshTab();
  };
  Main.refreshTab = function () {
    const a = tabState.active;
    if (a === 'champions') renderChampions();
    else if (a === 'augments') renderAugments();
    else if (a === 'items') renderItems();
    else if (a === 'forge') renderForge();
    else if (a === 'odds') renderOdds();
    else if (a === 'traits') { fillTraitSelects(); if (tabState.te.results.length) renderTeResults('#teResults', tabState.te.results, tabState.te.trait, 0); }
  };

  /* ==================== 棋子详情浮层 ==================== */
  Main.openChampDetail = function (champId) {
    const c = D.champ(champId); if (!c) return;
    const remain = pool()[c.id];
    const body =
      '<div class="m-grid c2">' +
      '<div class="card"><h4>' + U.esc(c.name) + ' <span class="dim">' + c.cost + ' 费 · ' + U.esc(roleLabel(c.role)) + '</span></h4>' +
      '<div class="m-row" style="margin-bottom:6px">' + (c.icon ? '<img src="' + c.icon + '" style="width:56px;border-radius:8px">' : '') +
      '<div class="tag-row">' + (c.traits || []).map(t => '<span class="mini-tag">' + U.esc(t) + '</span>').join('') + '</div></div>' +
      [['生命值', U.num(c.hp)], ['攻击力', U.num(c.ad)], ['护甲 / 魔抗', U.num(c.armor) + ' / ' + U.num(c.mr)],
      ['攻击距离', (c.range || 1) + ' 格'], ['攻速', (c.as || 0.6)], ['法力值', (c.initialMana || 0) + '/' + (c.mana || 0)],
      ['牌池剩余', (remain == null ? '-' : remain) + ' / ' + U.POOL_PER_CHAMP[c.cost]]].map(r =>
        '<div class="kv"><span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span></div>').join('') +
      '</div>' +
      '<div class="card"><h4>技能 · ' + U.esc(c.ability ? c.ability.name : '') + '</h4>' +
      '<div style="color:#a5b8da;font-size:11px;line-height:1.7">' + U.esc((c.ability ? c.ability.desc : '') || '—') + '</div>' +
      '<div class="m-row" style="margin-top:10px">' +
      '<button class="btn btn-primary btn-xs" id="cdAddBoard">上阵到棋盘</button>' +
      '<button class="btn btn-xs" id="cdAddBench">放入备战区</button>' +
      '<button class="btn btn-xs" id="cdAsk">让 AI 给装备建议</button>' +
      '</div>' +
      '<div class="dim" style="margin-top:6px">左键拖拽棋子库卡片到棋盘 = 上阵；拖到相同棋子 = 三合一升星。</div></div>' +
      '</div>';
    TFT.UI.modal({ title: '棋子详情 · ' + c.name, size: 'wide', body: body });
    $('#cdAddBoard').onclick = function () {
      const cell = firstEmptyPlayerCell();
      if (!cell) { TFT.UI.toast('棋盘已满，请先下阵棋子', 'warn'); return; }
      S.putAt(cell.r, cell.c, S.mkUnit(c.id, 1));
      B.autoMergeScan(); TFT.UI.closeModal(); B.commit('add-board');
    };
    $('#cdAddBench').onclick = function () {
      const i = firstEmptyBench();
      if (i < 0) { TFT.UI.toast('备战区已满', 'warn'); return; }
      S.bench[i] = S.mkUnit(c.id, 1);
      B.autoMergeScan(); TFT.UI.closeModal(); B.commit('add-bench');
    };
    $('#cdAsk').onclick = function () { Main.closeAndAsk(c.name + ' 推荐什么装备？请给出三件套与合成顺序，并结合当前阵容说明。'); };
  };

  Main.closeAndAsk = function (text) {
    TFT.UI.closeModal();
    TFT.AI.send(text);
    const log = $('#chatLog'); if (log) log.scrollTop = log.scrollHeight;
  };

  /* ==================== 阵容搜索（含一键加载 / 反向搜索） ==================== */
  function buildSearchIndex() {
    const idx = [];
    (D.meta.tiers && Object.keys(D.meta.tiers) || []).forEach(function (tier) {
      (D.meta.tiers[tier] || []).forEach(function (cp) {
        idx.push({ type: 'comp', key: cp.name, sub: cp.mainC || '', data: cp, tier: tier });
      });
    });
    D.champions().forEach(c => idx.push({ type: 'champ', key: c.name, sub: c.cost + '费 · ' + roleLabel(c.role), data: c }));
    D.traits().forEach(t => idx.push({ type: 'trait', key: t.name, sub: '羁绊', data: t }));
    const seenItem = {};
    D.allItems().forEach(function (i) {
      seenItem[i.name] = true;
      idx.push({ type: 'item', key: i.name, sub: (i.recipe ? '成品装备' : '装备'), data: i });
    });
    /* 官方全量装备补充（纹章 / 神器 / 辅助装等，按名称去重） */
    D.officialItems().forEach(function (i) {
      if (seenItem[i.name]) return;
      seenItem[i.name] = true;
      const cat = i.category === 'emblem' ? '转职纹章' : i.category === 'artifact' ? '神器装备'
        : i.category === 'support' ? '辅助装备' : i.category === 'component' ? '基础小件' : '装备';
      const sub = (i.recipeNames && i.recipeNames.length) ? '合成：' + i.recipeNames.join(' + ') : cat;
      idx.push({ type: 'item', key: i.name, sub: sub, data: i });
    });
    D.augmentList().forEach(a => idx.push({ type: 'augment', key: a.name, sub: a.rarity + '海克斯', data: a }));
    return idx;
  }

  function traitNamesOf(d) {
    if (!d || !Array.isArray(d.traits)) return [];
    return d.traits.map(x => (typeof x === 'string' ? x : (x && x.name) || '')).filter(Boolean);
  }
  /* 组合检索文本：名称 + 副标题 + 主C + 职业 + 羁绊 + 上阵单位 + 合成件 + 英文名 */
  function hayOf(r) {
    const d = r.data || {};
    const bits = [r.key || '', r.sub || ''];
    if (d.mainC) bits.push(d.mainC);
    if (d.role) bits.push(d.role);
    traitNamesOf(d).forEach(n => bits.push(n));
    (d.units || []).forEach(u => { if (u && u.name) bits.push(u.name); });
    (d.recipeNames || []).forEach(n => { if (n) bits.push(n); });
    if (d.en) bits.push(d.en);
    return bits.join(' ').toLowerCase();
  }

  function searchAll(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) return [];
    /* 支持空格分隔的多关键词组合检索（如「暗星 卡尔玛」），需全部命中 */
    const tokens = q.split(/\s+/).filter(Boolean);
    const idx = buildSearchIndex();
    return idx.map(function (r) {
      const k = r.key.toLowerCase();
      const hay = hayOf(r);
      for (let i = 0; i < tokens.length; i++) { if (hay.indexOf(tokens[i]) < 0) return null; }
      let s;
      if (k === q) s = 0; else if (k.indexOf(q) === 0) s = 1; else if (k.indexOf(q) >= 0) s = 2;
      else if ((r.sub || '').toLowerCase().indexOf(q) >= 0) s = 3; else s = 4;
      return Object.assign({ score: s }, r);
    }).filter(Boolean).sort((a, b) => a.score - b.score).slice(0, 40);
  }

  const TYPE_LABEL = { comp: '阵容', champ: '棋子', trait: '羁绊', item: '装备', augment: '海克斯' };
  const TIER_ORDER = { S: 0, A: 1, B: 2, C: 3 };

  /* ---------- 全局阵容排名 / 强度可视化（基于 MetaTFT 真实对线强度，越低越强） ---------- */
  let _ranked = null;
  function rankedComps() {
    if (_ranked) return _ranked;
    const list = [];
    const tiers = D.meta.tiers || {};
    Object.keys(tiers).forEach(t => (tiers[t] || []).forEach(cp => list.push({ cp: cp, tier: t })));
    list.sort((a, b) => (a.cp.strength == null ? 9 : a.cp.strength) - (b.cp.strength == null ? 9 : b.cp.strength));
    list.forEach((x, i) => { x.rank = i + 1; });
    _ranked = list;
    return list;
  }
  function compRankInfo(cp) {
    const list = rankedComps();
    const r = list.find(x => x.cp.id === cp.id);
    return { rank: r ? r.rank : '-', total: list.length };
  }
  function strengthBar(s) {
    const list = rankedComps(); if (!list.length || s == null) return '';
    const mn = list[0].cp.strength, mx = list[list.length - 1].cp.strength, span = (mx - mn) || 1;
    const pct = U.clamp(Math.round(((mx - s) / span) * 100), 4, 100);
    return '<span class="str-bar"><i style="width:' + pct + '%"></i></span>';
  }
  function activeTraitsOf(cp) { return (cp.traits || []).filter(t => t.active >= (t.need || 1)); }

  /* 展示用名称：去掉尾部集群编号后缀（如「重装战士·乐芙兰·409040」→「重装战士·乐芙兰」） */
  function displayName(cp) { return String((cp && cp.name) || '').replace(/·\d{4,}$/, ''); }

  /* 富阵容卡片（搜索结果 / 梯度榜 / 反查共用） */
  function compCardHTML(cp, tier, nameHTML) {
    tier = tier || cp.tier || '';
    const rk = compRankInfo(cp);
    return '<div class="comp-card" data-comp="' + U.esc(cp.id) + '">' +
      '<div class="cc-head"><span class="tier-dot td-' + U.esc(tier) + '">' + U.esc(tier) + '</span>' +
      '<span class="cc-name">' + (nameHTML || U.esc(displayName(cp))) + '</span><span class="cc-rank">#' + rk.rank + '/' + rk.total + '</span></div>' +
      '<div class="cc-line">主C <b>' + U.esc(cp.mainC || '-') + '</b> · ' + ((cp.units || []).length) + ' 人口 · ' + U.esc(cp.source || '') + '</div>' +
      '<div class="cc-tags">' + (cp.traits || []).slice(0, 4).map(t => '<span class="mini-tag">' + U.esc(t.name) + ' ' + t.active + '</span>').join('') + '</div>' +
      '<div class="cc-str"><span class="dim">强度</span>' + strengthBar(cp.strength) + '<span class="dim">' + strengthLabel(cp.strength) + '</span></div>' +
      '</div>';
  }

  function showSuggest(q) {
    const box = $('#searchSuggest');
    const res = searchAll(q).slice(0, 8);
    if (!res.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    box.innerHTML = res.map((r, i) => '<div class="suggest-item' + (i === 0 ? ' on' : '') + '" data-i="' + i + '">' +
      '<span>' + U.mark(r.key, q) + (r.sub ? ' <span class="dim">' + U.esc(r.sub) + '</span>' : '') + '</span>' +
      '<span class="tag">' + TYPE_LABEL[r.type] + '</span></div>').join('');
    $$('#searchSuggest .suggest-item').forEach(function (it) {
      it.addEventListener('click', function () { $('#searchInput').value = it.querySelector('span').textContent.trim(); box.classList.add('hidden'); doSearch(); });
    });
  }

  function doSearch() {
    const q = $('#searchInput').value.trim();
    $('#searchSuggest').classList.add('hidden');
    if (!q) { TFT.UI.toast('请输入搜索关键词', 'warn'); return; }
    const res = searchAll(q);
    if (!res.length) { TFT.UI.toast('没有找到与「' + q + '」相关的内容', 'warn'); return; }

    const comps = res.filter(r => r.type === 'comp');
    const champs = res.filter(r => r.type === 'champ');
    const rest = res.filter(r => r.type !== 'comp' && r.type !== 'champ');
    /* 阵容结果按档位 + 强度排序（越低越强） */
    comps.sort((a, b) => ((TIER_ORDER[a.tier] == null ? 9 : TIER_ORDER[a.tier]) - (TIER_ORDER[b.tier] == null ? 9 : TIER_ORDER[b.tier])) ||
      ((a.data.strength == null ? 9 : a.data.strength) - (b.data.strength == null ? 9 : b.data.strength)));

    let html = '<div class="search-sum">' +
      '<span class="ss-total">「' + U.esc(q) + '」共匹配 ' + res.length + ' 条</span>' +
      (comps.length ? '<span class="ss-chip on">阵容 ' + comps.length + '</span>' : '') +
      (champs.length ? '<span class="ss-chip on">棋子 ' + champs.length + '</span>' : '') +
      (rest.length ? '<span class="ss-chip on">羁绊/装备/海克斯 ' + rest.length + '</span>' : '') +
      '</div>';

    if (comps.length) {
      html += '<div class="panel-title">阵容（' + comps.length + '）<span class="dim">点击卡片查看详情 · 一键加载到棋盘</span></div>' +
        '<div class="comp-grid">' + comps.map(r => compCardHTML(r.data, r.tier, U.mark(displayName(r.data), q))).join('') + '</div>';
    }
    if (champs.length) {
      html += '<div class="panel-title">棋子（' + champs.length + '）<span class="dim">点击查看详情 · 反查所属阵容</span></div>' +
        '<div class="card-grid" style="max-height:220px;margin-bottom:10px">' +
        champs.map(r => '<div class="grid-card" data-champ-r="' + U.esc(r.data.id) + '">' + libChampCard(r.data) + '</div>').join('') + '</div>';
    }
    if (rest.length) {
      html += '<div class="panel-title">羁绊 / 装备 / 海克斯（' + rest.length + '）<span class="dim">点击查看详情</span></div>' +
        '<div class="log-list">' + rest.slice(0, 24).map(r => '<div class="log-item clickable" data-rest="' + U.esc(r.type) + '|' + U.esc(r.data.id || r.data.name) + '">' +
          '<span class="dim">' + TYPE_LABEL[r.type] + '</span><span>' + U.mark(r.key, q) + '</span><span class="dim">' + U.esc(r.sub || '') + '</span></div>').join('') + '</div>';
    }

    TFT.UI.modal({ title: '搜索结果 · ' + U.esc(q), size: 'wide', body: html });
    $$('#modalBody [data-comp]').forEach(c => c.onclick = function () { Main.openCompDetail(c.dataset.comp); });
    $$('#modalBody [data-champ-r]').forEach(c => c.onclick = function () { Main.openChampDetail(c.dataset.champR); });
    $$('#modalBody [data-rest]').forEach(function (c) {
      c.onclick = function () {
        const p = c.dataset.rest.split('|');
        if (p[0] === 'trait') { tabState.te.trait = p[1]; Main.openTraitExplorerModal(); }
        else if (p[0] === 'item') {
          const it = D.item(p[1]) || D.officialItems().find(x => x.id === p[1]);
          if (it) TFT.UI.toast(it.name + '：' + (it.stat || it.desc || ''), 'ok', 3600);
        }
        else if (p[0] === 'augment') {
          const a = D.augment(p[1]);
          if (a) TFT.UI.toast(a.name + '：' + (a.desc || ''), 'ok', 4200);
        }
      };
    });
  }

  /* 反向搜索：某棋子出现在哪些阵容 */
  Main.reverseSearch = function (champName) {
    const comps = [];
    (D.meta.tiers && Object.keys(D.meta.tiers) || []).forEach(function (tier) {
      (D.meta.tiers[tier] || []).forEach(function (cp) {
        if (cp.mainC === champName || (cp.units || []).some(u => u.name === champName)) comps.push({ cp: cp, tier: tier });
      });
    });
    return comps;
  };

  /* ==================== Meta 梯度榜 ==================== */
  Main.openMeta = function () {
    const M = D.meta;
    const tiers = ['S', 'A', 'B', 'C'];
    let html = '<div class="m-grid c2" style="align-items:start">' +
      '<div>' + tiers.map(function (t) {
        const list = (M.tiers && M.tiers[t]) || [];
        if (!list.length) return '';
        return '<div class="tier-row"><div class="tier-label tier-' + t + '">' + t + '</div><div class="tier-items">' +
          list.map(cp => compCardHTML(cp, t)).join('') +
          '</div></div>';
      }).join('') + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px">' +
      '<div class="card"><h4>羁绊热度排行</h4><div class="chart-wrap" style="height:220px"><canvas id="metaTraitChart"></canvas></div></div>' +
      '<div class="card"><h4>各费用主C阵容数</h4><div class="chart-wrap" style="height:200px"><canvas id="metaHeatChart"></canvas></div></div>' +
      '<div class="card"><h4>克制关系图</h4><div id="metaCounter" class="log-list" style="max-height:160px"></div></div>' +
      '</div></div>';
    TFT.UI.modal({ title: 'Meta 梯度榜 · ' + (M.set || '') + '（补丁 ' + (M.updatedAt || '') + '）', size: 'wide', body: html });
    $$('#modalBody [data-comp]').forEach(c => c.onclick = function () { Main.openCompDetail(c.dataset.comp); });

    /* 图表 */
    if (window.Chart) {
      const tr = M.traitRanking || [];
      TFT.UI.chart($('#metaTraitChart'), {
        type: 'bar',
        data: {
          labels: tr.map(x => x.name),
          datasets: [{ label: '出现阵容数', data: tr.map(x => x.count), backgroundColor: 'rgba(34,211,238,.6)', borderRadius: 4 }]
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#93a4c4', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.06)' } },
            y: { ticks: { color: '#cfe3ff', font: { size: 9 } }, grid: { display: false } }
          }
        }
      });
      const hc = M.heatCurve || { labels: [], series: [] };
      const colors = ['#22d3ee', '#f5c542', '#f43f5e', '#8b5cf6', '#34d399', '#fb923c', '#3b82f6'];
      TFT.UI.chart($('#metaHeatChart'), {
        type: 'line',
        data: {
          labels: hc.labels,
          datasets: (hc.series || []).map((s, i) => ({ label: s.name, data: s.data, borderColor: colors[i % colors.length], backgroundColor: 'transparent', tension: 0.3, borderWidth: 2, pointRadius: 2 }))
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#93a4c4', font: { size: 9 }, boxWidth: 10 } } },
          scales: {
            x: { ticks: { color: '#93a4c4', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.06)' } },
            y: { ticks: { color: '#93a4c4', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.06)' } }
          }
        }
      });
    }
    const cg = M.counterGraph || { edges: [] };
    $('#metaCounter').innerHTML = (cg.edges || []).map(e => '<div class="log-item">' +
      '<span style="color:#86efac">' + U.esc(e.source) + '</span>' +
      '<span class="dim">克制</span><span style="color:#fda4af">' + U.esc(e.target) + '</span></div>').join('') || '<div class="dim">暂无数据</div>';
  };

  Main.findComp = function (id) {
    for (const t in (D.meta.tiers || {})) {
      const f = D.meta.tiers[t].find(c => c.id === id);
      if (f) return { cp: f, tier: t };
    }
    return null;
  };

  /* 站位网格 HTML（mr：3 前排 / 2 中排 / 1、0 后排；列取实际使用范围）— 阵容详情与一图流共用 */
  function posGridHTML(cp) {
    const units = cp.units || [];
    const cells = (cp.positionMap || []).map(p => ({ mr: p[0], c: p[1], name: p[2] }));
    const costOf = name => { const u = units.find(x => x.name === name); return u ? (u.cost || 0) : 0; };
    const colAll = cells.map(x => x.c);
    const colMin = colAll.length ? Math.min.apply(null, colAll) : 1;
    const colMax = colAll.length ? Math.max.apply(null, colAll) : 5;
    const nCols = colMax - colMin + 1;
    const mrUsed = Array.from(new Set(cells.map(x => x.mr))).sort((a, b) => b - a);
    const roleOf = { 3: '前排', 2: '中排', 1: '后排', 0: '后排' };
    const rowStyle = 'grid-template-columns:34px repeat(' + nCols + ',minmax(0,1fr))';
    let html = '<div class="pos-grid">' +
      '<div class="pos-grid-row pos-head" style="' + rowStyle + '"><span class="pos-row-label">列</span>' +
      Array.from({ length: nCols }, (_, i) => '<span class="pos-col-num">' + (colMin + i) + '</span>').join('') + '</div>';
    mrUsed.forEach(function (mr) {
      html += '<div class="pos-grid-row" style="' + rowStyle + '"><span class="pos-row-label">' + (roleOf[mr] || '') + '</span>';
      for (let c = colMin; c <= colMax; c++) {
        const f = cells.find(x => x.mr === mr && x.c === c);
        const ch = f ? D.champByName(f.name) : null;
        const ico = ch ? U.champIcon(ch) : null;
        const inner = !f ? '' : (ico ? '<img src="' + ico + '" alt="' + U.esc(f.name) + '">' : U.esc(f.name));
        html += '<div class="pos-cell' + (f ? ' filled c' + costOf(f.name) : '') + '"' + (f ? ' title="' + U.esc(f.name) + '"' : '') + '>' + inner + '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    return {
      html: html,
      frontN: cells.filter(x => x.mr >= 3).length,
      midN: cells.filter(x => x.mr === 2).length,
      backN: cells.filter(x => x.mr <= 1).length
    };
  }

  /* 阵容详情当前上下文（供行内出装选择器使用） */
  let detailCtx = null;

  Main.openCompDetail = function (id) {
    const found = Main.findComp(id); if (!found) return;
    const cp = found.cp, tier = found.tier;
    const units = cp.units || [];
    const rk = compRankInfo(cp);
    const totalCost = units.reduce((a, u) => a + (u.cost || 0), 0);
    const avgCost = units.length ? (totalCost / units.length).toFixed(1) : '0';
    const starCount = units.filter(u => (u.star || 1) >= 2).length;
    const costDist = [1, 2, 3, 4, 5].map(c => units.filter(u => u.cost === c).length);

    /* —— 出装方案：本地规则引擎推荐 + 手动覆盖（非官方数据） —— */
    const plan = TFT.Recommend.plan(cp);
    const planMap = {};
    plan.units.forEach(function (p) { planMap[p.name] = p; });
    detailCtx = { cp: cp, plan: plan };

    /* —— 站位图（由 posGridHTML 统一生成，与一图流共用） —— */
    const posInfo = posGridHTML(cp);
    const posHTML = posInfo.html;
    const frontN = posInfo.frontN, midN = posInfo.midN, backN = posInfo.backN;

    /* —— 上阵单位表（含出装推荐 / 手动覆盖） —— */
    const TAG_BADGE = { main: '主C', tank: '主坦', sub: '副C' };
    const itemChips = function (p) {
      if (!p.items.length) return '<span class="ur-items dim">未分配</span>';
      return '<span class="ur-items">' + p.items.map(function (it) {
        const url = U.itemIcon({ icon: it.icon });
        return '<span class="ur-it' + (p.manual ? ' manual' : '') + '" title="' + U.esc(it.name + (it.stat ? ' · ' + it.stat : '')) + '">' +
          '<b class="ur-it-fb">' + U.esc(String(it.name || '装').slice(0, 1)) + '</b>' +
          (url ? '<img src="' + url + '" alt="" onerror="this.remove()">' : '') + '</span>';
      }).join('') + '</span>';
    };
    const unitRows = units.slice().sort((a, b) => (b.cost - a.cost) || ((b.star || 1) - (a.star || 1))).map(function (u) {
      const ch = D.champByName(u.name); const icon = ch ? U.champIcon(ch) : null;
      const p = planMap[u.name] || { items: [], tag: 'other', reason: '', manual: false };
      return '<div class="unit-line" data-uname="' + U.esc(u.name) + '">' +
        '<div class="unit-row">' +
          '<span class="ur-cost c' + u.cost + '">' + u.cost + '</span>' +
          (icon ? '<img class="ur-icon" src="' + icon + '" alt="">' : '<span class="ur-icon ur-fb">' + U.esc((u.name || '?').slice(0, 1)) + '</span>') +
          '<span class="ur-name">' + U.esc(u.name) + (TAG_BADGE[p.tag] ? '<em class="ur-badge ur-' + p.tag + '">' + TAG_BADGE[p.tag] + '</em>' : '') + '</span>' +
          '<span class="ur-star">' + '★'.repeat(U.clamp(u.star || 1, 1, 3)) + '</span>' +
          itemChips(p) +
          '<button class="btn btn-xs ur-edit" data-edit-unit="' + U.esc(u.name) + '">改</button>' +
        '</div>' +
        (p.reason ? '<div class="ur-why">' + U.esc(p.reason) + (p.manual ? '' : ' · 引擎推荐') + '</div>' : '') +
        '</div>';
    }).join('');

    /* —— 羁绊达成 —— */
    const actives = activeTraitsOf(cp);
    const traitRows = (cp.traits || []).map(function (t) {
      const on = t.active >= (t.need || 1); const diff = Math.max(0, (t.need || 1) - t.active);
      return '<div class="trait-line' + (on ? ' on' : '') + '"><span class="tl-name">' + U.esc(t.name) +
        (on ? '' : '<em class="tl-need">差 ' + diff + '</em>') + '</span>' +
        '<span class="tl-count">' + t.active + ' / ' + t.need + '</span></div>';
    }).join('');

    /* —— 克制 / 被克制（可跳转对应阵容） —— */
    const nameToId = {}; rankedComps().forEach(x => { nameToId[x.cp.name] = x.cp.id; });
    const chipList = (arr, cls, self) => (arr || []).map(function (n) {
      const cid = nameToId[n];
      return cid && cid !== self
        ? '<span class="mini-tag ' + cls + ' clickable" data-comp="' + U.esc(cid) + '">' + U.esc(n) + '</span>'
        : '<span class="mini-tag ' + cls + '">' + U.esc(n) + '</span>';
    }).join('') || '<span class="dim">暂无</span>';

    /* —— 同主C 变阵 —— */
    const related = Main.reverseSearch(cp.mainC).filter(r => r.cp.id !== cp.id).slice(0, 12);
    const varHTML = related.length
      ? '<div class="comp-grid compact">' + related.map(r => compCardHTML(r.cp, r.tier)).join('') + '</div>'
      : '<div class="dim">暂未找到同主C的其他阵容</div>';

    const body =
      '<div class="m-grid c2" style="align-items:start">' +
      /* 左列 */
      '<div style="display:flex;flex-direction:column;gap:8px">' +
        '<div class="card">' +
          '<div class="cd-head"><span class="tier-dot td-' + U.esc(tier) + '">' + U.esc(tier) + '</span>' +
          '<span class="cd-title">' + U.esc(displayName(cp)) + '</span>' +
          '<span class="cd-rank">全服 #' + rk.rank + ' / ' + rk.total + '</span></div>' +
          '<div class="cd-str"><span class="dim">综合强度</span>' + strengthBar(cp.strength) + '<b>' + strengthLabel(cp.strength) + '</b></div>' +
          '<div class="kv"><span class="k">数据来源</span><span class="v">' + U.esc(cp.source || 'MetaTFT') + (cp.cluster ? ' · 集群 #' + cp.cluster : '') + '</span></div>' +
          '<div class="kv"><span class="k">主C</span><span class="v">' + U.esc(cp.mainC || '-') + '</span></div>' +
          '<div class="kv"><span class="k">上阵人口 / 总费用</span><span class="v">' + units.length + ' 人 / ' + totalCost + ' 金</span></div>' +
          '<div class="kv"><span class="k">平均费用</span><span class="v">' + avgCost + ' · 2★ 及以上 ' + starCount + ' 个</span></div>' +
          '<div class="cd-dist">' + [1, 2, 3, 4, 5].map((c, i) => '<span class="dd c' + c + '">' + costDist[i] + '×' + c + '费</span>').join('') + '</div>' +
          '<div class="m-row" style="margin-top:8px"><button class="btn btn-xs btn-primary" id="cpLoad">一键加载到棋盘</button>' +
          '<button class="btn btn-xs" id="cpAsk">让 AI 讲运营</button>' +
          '<button class="btn btn-xs" id="cpPoster">阵容一图流</button></div>' +
        '</div>' +
        '<div class="card"><h4>羁绊达成（' + actives.length + ' 激活 / ' + (cp.traits || []).length + '）</h4><div class="trait-list">' + traitRows + '</div></div>' +
        '<div class="card"><h4>推荐站位 <span class="dim">前排 ' + frontN + ' · 中排 ' + midN + ' · 后排 ' + backN + '</span></h4>' + posHTML +
          '<div class="dim" style="font-size:10px;margin-top:8px">' + U.esc(String(cp.positioning || '').replace(/（[^）]*\d[^）]*）/g, '').trim()) + ' 上阵 ' + units.length + ' 人 · 前排 ' + frontN + ' · 中排 ' + midN + ' · 后排 ' + backN + '</div>' +
          '<div class="pos-legend">' + [1, 2, 3, 4, 5].map(c => '<span class="lg c' + c + '">' + c + '费</span>').join('') + '</div>' +
        '</div>' +
      '</div>' +
      /* 右列 */
      '<div style="display:flex;flex-direction:column;gap:8px">' +
        '<div class="card"><h4>上阵单位（' + units.length + '）<span class="dim">按费用排序 · 出装为引擎推荐</span></h4>' +
          '<div class="unit-table">' + unitRows + '</div>' +
          '<div class="eng-note">装备由本地规则引擎按 <b>职业 / 射程 / 法力 / 费用</b> 推算（主C 3 件 → 主坦 2 件 → 副C 2 件，合计 ' +
          plan.summary.itemCount + ' 件）。此为<b>引擎推荐</b>，非官方方案；点击「改」可手动覆盖，覆盖结果仅保存在本机。' +
          (plan.summary.manual ? ' 当前有 ' + plan.summary.manual + ' 个棋子使用手动方案。' : '') + '</div>' +
        '</div>' +
        '<div class="card"><h4>克制关系 <span class="dim">点击可跳转该阵容</span></h4>' +
          '<div class="panel-title" style="font-size:10px;color:#86efac">本阵容克制</div><div class="tag-row">' + chipList((cp.counters || {})['克制'], 'crt', cp.id) + '</div>' +
          '<div class="panel-title mt8" style="font-size:10px;color:#fda4af">被这些克制</div><div class="tag-row">' + chipList((cp.counters || {})['被克制'], 'bad', cp.id) + '</div>' +
        '</div>' +
        '<div class="card"><h4>同主C变阵（' + related.length + '）</h4>' + varHTML + '</div>' +
      '</div>' +
      '</div>';

    TFT.UI.modal({ title: '阵容攻略 · ' + displayName(cp), size: 'wide', body: body });
    $('#cpLoad').onclick = function () { Main.loadComp(cp); };
    $('#cpPoster').onclick = function () { Main.exportPoster(cp); };
    $('#cpAsk').onclick = function () {
      Main.closeAndAsk('请讲解「' + displayName(cp) + '」（主C ' + (cp.mainC || '') + '、' + units.length + ' 人口；羁绊：' +
        actives.map(t => t.name + ' ' + t.active).join('、') + '）的运营思路、D牌节奏与站位细节，并判断当前我的对局是否适合玩这套。');
    };
    $$('#modalBody [data-comp]').forEach(c => c.onclick = function () { Main.openCompDetail(c.dataset.comp); });
    $$('#modalBody [data-edit-unit]').forEach(b => b.onclick = function () { openItemPicker(b.dataset.editUnit); });
  };

  /* ==================== 行内出装选择器 ==================== */
  function unitLineByName(name) {
    return U.$$('#modalBody .unit-line').filter(l => l.dataset.uname === name)[0] || null;
  }

  function closePicker() {
    const el = U.$('#modalBody .ipick');
    if (el) el.remove();
    U.$$('#modalBody .unit-line.editing').forEach(l => l.classList.remove('editing'));
  }

  function rerenderCompDetail(compId) {
    const body = U.$('#modalBody');
    const top = body ? body.scrollTop : 0;
    Main.openCompDetail(compId);
    const nb = U.$('#modalBody');
    if (nb) nb.scrollTop = top;
  }

  function openItemPicker(name) {
    if (!detailCtx) return;
    const line = unitLineByName(name);
    if (!line) return;
    const existing = U.$('.ipick', line);
    if (existing) { closePicker(); return; }   /* 再次点击同一行 = 收起 */
    closePicker();

    const p = detailCtx.plan.units.filter(u => u.name === name)[0];
    if (!p) return;
    const sel = p.items.map(it => it.id).slice(0, 3);

    const grid = TFT.Recommend.candidateItems().map(function (it) {
      const url = U.itemIcon({ icon: it.icon });
      const on = sel.indexOf(it.id) >= 0;
      return '<button type="button" class="ipick-item' + (on ? ' on' : '') + '" data-pick-id="' + U.esc(it.id) + '"' +
        ' title="' + U.esc(it.name + (it.stat ? ' · ' + it.stat : '')) + '">' +
        '<span class="ur-it"><b class="ur-it-fb">' + U.esc(String(it.name || '装').slice(0, 1)) + '</b>' +
        (url ? '<img src="' + url + '" alt="" onerror="this.remove()">' : '') + '</span>' +
        '<i>' + U.esc(it.name) + '</i></button>';
    }).join('');

    const box = U.el('div', 'ipick');
    box.innerHTML =
      '<div class="ipick-head"><b>「' + U.esc(name) + '」出装</b>' +
        '<span class="dim">最多 3 件 · ' + U.esc(p.roleLabel || '通用') + (p.manual ? ' · 当前为手动方案' : ' · 当前为引擎推荐') + '</span>' +
        '<button class="btn btn-xs ipick-close">收起</button></div>' +
      '<div class="ipick-grid">' + grid + '</div>' +
      '<div class="ipick-foot"><span class="ipick-count">已选 ' + sel.length + ' / 3</span>' +
        '<span class="ipick-tip">仅保存在本机浏览器，不影响数据源</span>' +
        '<button class="btn btn-xs" data-pick-reset>恢复引擎推荐</button>' +
        '<button class="btn btn-xs btn-primary" data-pick-save>保存</button></div>';

    line.classList.add('editing');
    line.appendChild(box);

    const countEl = U.$('.ipick-count', box);
    const sync = function () {
      U.$$('.ipick-item', box).forEach(function (b) {
        b.classList.toggle('on', sel.indexOf(b.dataset.pickId) >= 0);
      });
      if (countEl) countEl.textContent = '已选 ' + sel.length + ' / 3';
    };
    U.$$('.ipick-item', box).forEach(function (b) {
      b.onclick = function () {
        const id = b.dataset.pickId;
        const i = sel.indexOf(id);
        if (i >= 0) sel.splice(i, 1);
        else if (sel.length >= 3) { TFT.UI.toast('最多选择 3 件装备', 'warn'); return; }
        else sel.push(id);
        sync();
      };
    });
    U.$('.ipick-close', box).onclick = closePicker;
    U.$('[data-pick-reset]', box).onclick = function () {
      const compId = detailCtx.cp.id;
      TFT.Store.setItemPlan(compId, name, null);
      TFT.UI.toast('已恢复「' + name + '」的引擎推荐', 'ok');
      rerenderCompDetail(compId);
    };
    U.$('[data-pick-save]', box).onclick = function () {
      const compId = detailCtx.cp.id;
      TFT.Store.setItemPlan(compId, name, sel);
      TFT.UI.toast(sel.length ? '已保存「' + name + '」手动出装' : '已清除「' + name + '」手动出装', 'ok');
      rerenderCompDetail(compId);
    };
  }

  Main.loadComp = function (cp) {
    /* 出装沿用详情页方案（引擎推荐 + 手动覆盖） */
    const plan = TFT.Recommend.plan(cp);
    const itemByName = {};
    plan.units.forEach(function (p) { itemByName[p.name] = p.items.map(it => it.id); });
    const snap = {
      season: S.season, patch: S.patch,
      player: { level: 8, gold: 50, hp: 100, stage: S.stage, streak: S.streak },
      board: (cp.positionMap || []).map(function (p) {
        const u = (cp.units || []).find(x => x.name === p[2]);
        const ids = (u && (u.items || []).length) ? u.items : (itemByName[p[2]] || []);
        return { row: 7 - p[0], col: p[1], name: p[2], star: (u ? u.star : 1), items: ids.map(id => ({ id: id })) };
      }),
      bench: [], augments: [], opponents: []
    };
    S.loadFrom(snap);
    syncTopbar();
    TFT.UI.closeModal();
    B.commit('load-meta-comp');
    Main.go('app');
    TFT.UI.toast('已加载阵容：' + displayName(cp) + '（' + snap.board.length + ' 人口）', 'ok');
  };

  /* ==================== 对手多棋盘 ==================== */
  let oppState = { active: null, selChamp: null, star: 1 };

  function ensureOpponents() {
    if (!S.opponents.length) {
      for (let i = 1; i <= 7; i++) S.opponents.push({ id: U.uid('op'), name: '对手 ' + i, hp: 100, level: 8, board: {} });
    }
  }

  Main.openOpponents = function () {
    ensureOpponents();
    if (!oppState.active || !S.opponents.some(o => o.id === oppState.active)) oppState.active = S.opponents[0].id;
    TFT.UI.modal({ title: '对手多棋盘（8 家对局）', size: 'wide', body: '<div id="oppWrap"></div>' });
    renderOpponents();
  };

  function renderOpponents() {
    const wrap = $('#oppWrap'); if (!wrap) return;
    const tabs = S.opponents.map(o => '<button class="opp-tab' + (o.id === oppState.active ? ' on' : '') + '" data-opp="' + o.id + '">' +
      U.esc(o.name) + '<span class="hp">' + o.hp + 'HP</span></button>').join('');
    const op = S.opponents.find(o => o.id === oppState.active) || S.opponents[0];

    /* 迷你棋盘（row 0..3 = 对手后排..前排） */
    let boardHTML = '<div class="mini-board">';
    for (let r = 0; r < 4; r++) {
      boardHTML += '<div class="hex-row' + (r % 2 ? ' odd' : '') + '">';
      for (let c = 0; c < 7; c++) {
        const u = op.board[r + '-' + c];
        boardHTML += '<div class="hex" data-opp-cell="' + r + '-' + c + '"><div class="cell-wrap">' +
          (u ? U.champCardHTML({ uid: u.uid, champId: u.champId, star: u.star, items: u.items }, { compact: true }) : '') + '</div></div>';
      }
      boardHTML += '</div>';
    }
    boardHTML += '</div>';

    const champs = D.champions().slice().sort((a, b) => a.cost - b.cost);
    const palette = champs.map(c => '<span class="u cc' + c.cost + (oppState.selChamp === c.id ? ' c' : '') + '" data-pick="' + U.esc(c.id) + '" style="cursor:pointer" title="' + U.esc(c.name + ' · ' + c.cost + ' 费') + '">' +
      (c.icon ? '<img src="' + U.esc(c.icon) + '" alt="">' : '') + '<span>' + U.esc(c.name) + '</span>' + '<span class="u-cost">' + c.cost + '</span></span>').join('');

    wrap.innerHTML =
      '<div class="opp-tabs">' + tabs + '<button class="opp-tab" id="oppAdd">+ 添加对手</button>' +
      (S.opponents.length > 1 ? '<button class="opp-tab" id="oppDel" style="border-color:#be123c;color:#fda4af">删除当前</button>' : '') + '</div>' +
      '<div class="m-row" style="margin-bottom:6px">' +
      '<label class="lbl">名称</label><input class="txt sm" id="oppName" value="' + U.esc(op.name) + '">' +
      '<label class="lbl">血量</label><input class="txt sm" id="oppHp" type="number" value="' + op.hp + '" style="width:70px">' +
      '<label class="lbl">等级</label><input class="txt sm" id="oppLevel" type="number" value="' + op.level + '" style="width:60px">' +
      '<label class="lbl">放置星级</label><select class="sel sel-sm" id="oppStar"><option value="1">1★</option><option value="2">2★</option><option value="3">3★</option></select>' +
      '<span class="dim">点击下方棋子选中 → 点击棋盘格子放置；点击已有棋子删除</span></div>' +
      '<div class="battle-grid" style="align-items:start">' +
      '<div class="card"><h4>' + U.esc(op.name) + ' 棋盘 <span class="dim">' + Object.keys(op.board).length + ' 人口</span></h4>' + boardHTML + '</div>' +
      '<div class="card"><h4>棋子选择器</h4><div class="tag-row">' + palette + '</div></div>' +
      '</div>';

    $('#oppStar').value = String(oppState.star);

    $$('#oppWrap .opp-tab[data-opp]').forEach(b => b.onclick = function () { oppState.active = b.dataset.opp; renderOpponents(); });
    $('#oppAdd').onclick = function () {
      if (S.opponents.length >= 7) { TFT.UI.toast('最多 7 个对手（含自己共 8 家）', 'warn'); return; }
      const o = { id: U.uid('op'), name: '对手 ' + (S.opponents.length + 1), hp: 100, level: 8, board: {} };
      S.opponents.push(o); oppState.active = o.id; B.commit('opp-add'); renderOpponents();
    };
    if ($('#oppDel')) $('#oppDel').onclick = function () {
      S.opponents = S.opponents.filter(o => o.id !== oppState.active);
      ensureOpponents(); oppState.active = S.opponents[0].id; B.commit('opp-del'); renderOpponents();
    };
    $('#oppName').onchange = function () { op.name = $('#oppName').value.trim() || op.name; B.commit('opp-rename'); renderOpponents(); };
    $('#oppHp').onchange = function () { op.hp = U.clamp(Number($('#oppHp').value) || 0, 0, 100); B.commit('opp-hp'); renderOpponents(); };
    $('#oppLevel').onchange = function () { op.level = U.clamp(Number($('#oppLevel').value) || 8, 1, 11); B.commit('opp-level'); };
    $('#oppStar').onchange = function () { oppState.star = +$('#oppStar').value; };

    $$('#oppWrap [data-pick]').forEach(p => p.onclick = function () {
      oppState.selChamp = oppState.selChamp === p.dataset.pick ? null : p.dataset.pick;
      $$('#oppWrap [data-pick]').forEach(x => x.classList.remove('c'));
      if (oppState.selChamp) p.classList.add('c');
    });
    $$('#oppWrap [data-opp-cell]').forEach(function (cell) {
      cell.onclick = function () {
        const key = cell.dataset.oppCell;
        if (oppState.selChamp) {
          op.board[key] = { uid: U.uid('uo'), champId: oppState.selChamp, star: oppState.star, items: [] };
          B.commit('opp-place'); renderOpponents();
        } else if (op.board[key]) {
          delete op.board[key]; B.commit('opp-remove'); renderOpponents();
        }
      };
    });
  }

  /* ==================== 阵容存档 ==================== */
  Main.openSaves = function () {
    const list = TFT.Store.saves();
    const body =
      '<div class="m-row" style="margin-bottom:8px"><button class="btn btn-xs btn-primary" id="svNow">保存当前阵容</button>' +
      '<button class="btn btn-xs" id="svExpAll">导出全部存档</button>' +
      '<span class="dim">存档保存在浏览器 localStorage，最多 100 条</span></div>' +
      '<div class="log-list" id="svList" style="max-height:60vh"></div>';
    TFT.UI.modal({ title: '阵容存档', size: 'wide', body: body });
    function render() {
      const l = TFT.Store.saves();
      $('#svList').innerHTML = l.length ? l.map(s => '<div class="save-row"><div class="save-thumb">' + (s.snap.board || []).length + '</div>' +
        '<div style="flex:1"><div><b>' + U.esc(s.name) + '</b> <span class="dim">' + U.esc(s.time) + '</span></div>' +
        '<div class="dim" style="font-size:10px">' + (s.snap.board || []).length + ' 人口 · ' + (s.snap.activeTraits || []).length + ' 羁绊 · ' + (s.snap.season || '').toUpperCase() + '</div></div>' +
        '<button class="btn btn-xs btn-primary" data-load="' + s.id + '">加载</button>' +
        '<button class="btn btn-xs" data-exp="' + s.id + '">导出</button>' +
        '<button class="btn btn-xs btn-danger" data-del="' + s.id + '">删除</button></div>').join('') : '<div class="dim">暂无存档</div>';
      $$('#svList [data-load]').forEach(b => b.onclick = function () {
        const s = TFT.Store.saves().find(x => x.id === b.dataset.load);
        if (!s) return; S.loadFrom(s.snap); syncTopbar(); TFT.UI.closeModal(); B.commit('load-save'); TFT.UI.toast('已加载存档：' + s.name, 'ok');
      });
      $$('#svList [data-exp]').forEach(b => b.onclick = function () {
        const s = TFT.Store.saves().find(x => x.id === b.dataset.exp);
        if (s) TFT.Store.download('tft-' + s.name + '.json', JSON.stringify(s.snap, null, 2));
      });
      $$('#svList [data-del]').forEach(b => b.onclick = function () { TFT.Store.deleteSave(b.dataset.del); render(); render(); });
    }
    render();
    $('#svNow').onclick = function () {
      TFT.UI.prompt('保存当前阵容', [{ label: '阵容名称', value: '', ph: '如：神谕卡尔玛' }], function (vals) {
        const name = vals[0] || '未命名阵容';
        TFT.Store.addSave({ id: U.uid('s'), name: name, time: new Date().toLocaleString('zh-CN'), snap: S.serialize(name, 'save') });
        TFT.UI.toast('已保存：' + name, 'ok'); Main.openSaves();
      });
    };
    $('#svExpAll').onclick = function () {
      TFT.Store.download('tft-saves-all.json', JSON.stringify(TFT.Store.saves(), null, 2));
    };
  };

  /* ==================== 社区分享 ==================== */
  Main.openCommunity = function () {
    const snap = S.serialize('社区分享', 'share');
    let code = '';
    try { code = btoa(unescape(encodeURIComponent(JSON.stringify(snap)))); } catch (e) { code = ''; }
    const shareText = '【金铲铲阵容分享】' + (snap.board || []).map(b => b.name + '★'.repeat(b.star)).join(' ') +
      ' | 羁绊：' + (snap.activeTraits || []).map(t => t.name + t.count).join('、') +
      ' | 等级' + snap.player.level + ' 金币' + snap.player.gold;
    const body =
      '<div class="m-grid c2" style="align-items:start">' +
      '<div class="card"><h4>生成分享码</h4>' +
      '<textarea id="shCode" rows="5" style="width:100%;background:var(--surface-3);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px;font-size:10px">' + U.esc(code) + '</textarea>' +
      '<div class="m-row" style="margin-top:6px"><button class="btn btn-xs btn-primary" id="shCopy">复制分享码</button>' +
      '<button class="btn btn-xs" id="shCopyText">复制阵容文本</button></div>' +
      '<div class="dim" style="margin-top:6px">分享码包含完整对局 JSON，可发给好友在右侧导入。</div></div>' +
      '<div class="card"><h4>导入分享码</h4>' +
      '<textarea id="shIn" rows="4" placeholder="粘贴好友分享的分享码" style="width:100%;background:var(--surface-3);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px;font-size:10px"></textarea>' +
      '<div class="m-row" style="margin-top:6px"><button class="btn btn-xs btn-primary" id="shLoad">解析并加载</button></div>' +
      '<div class="panel-title mt8">阵容文本预览</div>' +
      '<div id="shText" style="font-size:11px;color:#cfe3ff;line-height:1.6">' + U.esc(shareText) + '</div></div>' +
      '</div>';
    TFT.UI.modal({ title: '社区分享 / 分享码导入', size: 'wide', body: body });
    $('#shCopy').onclick = function () { copy(code); };
    $('#shCopyText').onclick = function () { copy(shareText); };
    $('#shLoad').onclick = function () {
      try {
        const txt = $('#shIn').value.trim();
        if (!txt) { TFT.UI.toast('请粘贴分享码', 'warn'); return; }
        const obj = JSON.parse(decodeURIComponent(escape(atob(txt))));
        const v = TFT.Store.validateImport(obj);
        if (!v.ok) { TFT.UI.toast('分享码无效：' + v.errors.join('；'), 'err'); return; }
        S.loadFrom(v.state); syncTopbar(); TFT.UI.closeModal(); B.commit('import-share'); TFT.UI.toast('分享阵容已加载', 'ok');
      } catch (e) { TFT.UI.toast('分享码解析失败：' + e.message, 'err'); }
    };
    function copy(t) {
      if (!t) { TFT.UI.toast('内容为空', 'warn'); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(() => TFT.UI.toast('已复制到剪贴板', 'ok'), () => fallback(t));
      } else fallback(t);
    }
    function fallback(t) {
      const ta = U.el('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); TFT.UI.toast('已复制到剪贴板', 'ok'); } catch (e) { TFT.UI.toast('复制失败，请手动选择文本', 'warn'); }
      ta.remove();
    }
  };

  /* ==================== 羁绊探索器浮层 ==================== */
  Main.openTraitExplorerModal = function () {
    TFT.UI.modal({
      title: '羁绊探索器（AI 穷举可行阵容）', size: 'wide',
      body: '<div class="filter-row wrap" style="margin-bottom:8px">' +
        '<select class="sel sel-sm" id="te2Target"><option value="">选择目标羁绊</option></select>' +
        '<select class="sel sel-sm" id="te2Must"><option value="">必须包含棋子</option></select>' +
        '<select class="sel sel-sm" id="te2Emblem"><option value="">转职装备（+1）</option></select>' +
        '<button class="btn btn-xs btn-primary" id="te2Run">穷举可行阵容</button></div>' +
        '<div id="te2Results" class="te-results" style="max-height:62vh"><div class="dim">选择羁绊后点击穷举</div></div>'
    });
    const names = D.traits().map(t => t.name).sort((a, b) => a.localeCompare(b, 'zh'));
    $('#te2Target').innerHTML = '<option value="">选择目标羁绊</option>' + names.map(n => '<option value="' + U.esc(n) + '">' + U.esc(n) + '</option>').join('');
    $('#te2Must').innerHTML = $('#teMustChamps').innerHTML;
    $('#te2Emblem').innerHTML = $('#teEmblem').innerHTML;
    $('#te2Target').value = tabState.te.trait || '';
    $('#te2Run').onclick = function () {
      const tn = $('#te2Target').value; if (!tn) { TFT.UI.toast('请选择目标羁绊', 'warn'); return; }
      $('#teTargetTrait').value = tn; $('#teMustChamps').value = $('#te2Must').value; $('#teEmblem').value = $('#te2Emblem').value;
      runTraitExplorer();
      const def = D.trait(tn);
      const levelMin = def && def.levels && def.levels.length ? def.levels[def.levels.length - 1].min : 3;
      renderTeResults('#te2Results', tabState.te.results, tn, levelMin);
    };
    if (tabState.te.results.length) {
      const def = D.trait(tabState.te.trait);
      renderTeResults('#te2Results', tabState.te.results, tabState.te.trait, def && def.levels && def.levels.length ? def.levels[def.levels.length - 1].min : 3);
    }
  };

  /* ==================== 顶栏同步 ==================== */
  function syncTopbar() {
    const ss = $('#seasonSelect'); if (ss) ss.value = S.season;
    const ps = $('#patchSelect'); if (ps) ps.value = S.patch;
    const am = $('#autoMergeToggle'); if (am) am.checked = !!S.autoMerge;
    const rg = $('#rangeToggle'); if (rg) rg.checked = !!S.rangeOn;
  }

  function fillSeasonPatch() {
    const ss = $('#seasonSelect');
    ss.innerHTML = D.seasons().map(s => '<option value="' + s.slug + '">' + U.esc(s.name) + '</option>').join('');
    ss.value = S.season;
    const ps = $('#patchSelect');
    ps.innerHTML = D.PATCHES.map(p => '<option value="' + p + '">补丁 ' + p + '</option>').join('');
    ps.value = S.patch;
  }

  function applySeason(slug) {
    const hasContent = S.boardList().length || S.benchList().length;
    const doIt = function () {
      S.season = slug; D.setSeason(slug);
      S.clearBoard(); S.bench = [null, null, null, null, null]; S.augments = [];
      tabState.champTrait = ''; tabState.champRole = ''; tabState.te = { trait: '', must: '', emblem: '', results: [] };
      tabState.forgeSlots = [null, null];
      renderChampFilters(); fillTraitSelects();
      Main.refreshTab();
      B.commit('switch-season');
      TFT.UI.toast('已切换到 ' + slug.toUpperCase() + '，棋盘已清空', 'ok');
    };
    if (hasContent) TFT.UI.confirm('切换赛季', '切换赛季会清空当前棋盘与备战区（海克斯同步清空），是否继续？', doIt, '切换并清空', true);
    else doIt();
  }

  /* ==================== 事件绑定 ==================== */
  function bind() {
    /* 标签页 */
    $$('#tabBar .tab').forEach(t => t.addEventListener('click', function () { Main.setTab(t.dataset.tab); }));

    /* 棋子库筛选 */
    $('#champCostFilters').addEventListener('click', function (e) {
      const b = e.target.closest('.fbtn'); if (!b) return;
      tabState.champCost = +b.dataset.cost; renderChampions();
    });
    $('#champTraitFilter').addEventListener('change', function () { tabState.champTrait = this.value; renderChampions(); });
    $('#champRoleFilter').addEventListener('change', function () { tabState.champRole = this.value; renderChampions(); });
    $('#champSearch').addEventListener('input', U.debounce(function () { tabState.champQ = $('#champSearch').value; renderChampions(); }, 200));

    /* 海克斯筛选 */
    $('#augmentTierFilter').addEventListener('click', function (e) {
      const b = e.target.closest('.fbtn'); if (!b) return;
      tabState.augTier = b.dataset.rarity; renderAugments();
    });
    $('#augmentSearch').addEventListener('input', U.debounce(function () { tabState.augQ = $('#augmentSearch').value; renderAugments(); }, 200));

    /* 装备类别 */
    $('#itemCatTabs').addEventListener('click', function (e) {
      const b = e.target.closest('.fbtn'); if (!b) return;
      tabState.itemCat = b.dataset.cat; renderItems();
    });

    /* D牌 */
    $('#oddsLevel').addEventListener('change', function () { tabState.oddsLevel = +this.value; renderOdds(); });
    $('#btnOddsAsk').addEventListener('click', function () {
      Main.closeAndAsk('当前 ' + tabState.oddsLevel + ' 级，按已消耗牌池计算，帮我判断应该在这个等级 D 牌还是拉人口，以及追哪个费用的核心最有性价比。');
    });

    /* 羁绊探索器 */
    $('#teRun').addEventListener('click', runTraitExplorer);
    $('#teOpenModal').addEventListener('click', Main.openTraitExplorerModal);

    /* 状态步进 */
    $('#levelMinus').onclick = () => B.step('level', -1);
    $('#levelPlus').onclick = () => B.step('level', 1);
    $('#goldMinus').onclick = () => B.step('gold', -1);
    $('#goldPlus').onclick = () => B.step('gold', 1);
    $('#hpMinus').onclick = () => B.step('hp', -5);
    $('#hpPlus').onclick = () => B.step('hp', 5);
    $('#streakMinus').onclick = () => B.step('streak', -1);
    $('#streakPlus').onclick = () => B.step('streak', 1);

    /* 回合选择 */
    const st = $('#stageSelect');
    st.innerHTML = TFT.STAGES.map(s => '<option value="' + U.esc(s) + '">' + U.esc(s) + '</option>').join('');
    st.value = S.stage;
    st.addEventListener('change', function () { S.stage = this.value; B.commit('stage'); });

    /* 开关 */
    $('#rangeToggle').addEventListener('change', function () {
      S.rangeOn = this.checked; TFT.Store.setPrefs({ rangeToggle: this.checked }); B.renderBoard();
    });
    $('#autoMergeToggle').addEventListener('change', function () {
      S.autoMerge = this.checked; TFT.Store.setPrefs({ autoMerge: this.checked });
      if (this.checked) { B.autoMergeScan(); B.commit('autoMerge'); }
      TFT.UI.toast('自动升星已' + (this.checked ? '开启' : '关闭'), 'ok');
    });

    /* 赛季 / 补丁 */
    $('#seasonSelect').addEventListener('change', function () {
      const v = this.value; if (v === S.season) return; applySeason(v);
    });
    $('#patchSelect').addEventListener('change', function () { S.patch = this.value; B.commit('patch'); TFT.UI.toast('已切换补丁 ' + this.value, 'ok'); });

    /* 顶栏动作 */
    $('#btnSave').onclick = Main.openSaves;
    $('#btnLoad').onclick = Main.openSaves;
    $('#btnExportImg').onclick = function () { TFT.Store.exportImage(); };
    $('#btnExportJson').onclick = function () {
      TFT.UI.prompt('导出 JSON', [{ label: '阵容名称', value: '未命名阵容' }], function (v) { TFT.Store.exportJSON(v[0]); });
    };
    $('#btnImportJson').onclick = function () { $('#fileImport').click(); };
    $('#fileImport').addEventListener('change', function () {
      const f = this.files && this.files[0]; if (!f) return;
      TFT.Store.readFile(f, function (err, data) {
        $('#fileImport').value = '';
        if (err) { TFT.UI.toast(err.message, 'err'); return; }
        const v = TFT.Store.validateImport(data);
        if (!v.ok) { TFT.UI.toast('导入失败：' + v.errors.join('；'), 'err'); return; }
        const go = function () {
          S.loadFrom(v.state); syncTopbar(); B.commit('import'); TFT.UI.toast('导入成功，已恢复阵容', 'ok');
        };
        if (v.warn.length) TFT.UI.confirm('导入提示', v.warn.join('<br>') + '<br><br>是否继续导入？', go, '继续导入');
        else go();
      });
    });
    $('#btnMeta').onclick = Main.openMeta;
    $('#btnTraitExplorer').onclick = Main.openTraitExplorerModal;
    $('#btnBattle').onclick = function () { TFT.Battle.openSim(); };
    $('#btnPower').onclick = function () { TFT.Power.openCalc(); };
    $('#btnOpponents').onclick = Main.openOpponents;
    $('#btnReview').onclick = function () { TFT.Review.open(); };
    $('#btnCommunity').onclick = Main.openCommunity;
    $('#btnShareLink').onclick = Main.copyShareLink;
    $('#btnCharts').onclick = Main.openCharts;
    $('#btnRollSim').onclick = Main.openRollSim;
    $('#btnCardQuiz').onclick = Main.openCardQuiz;
    $('#btnOptimizer').onclick = Main.openOptimizer;
    $('#btnPoster').onclick = function () { Main.exportPoster(); };
    $('#btnLLM').onclick = function () { TFT.AI.openSettings(); };
    $('#btnLLMSettings').onclick = function () { TFT.AI.openSettings(); };

    /* 视图切换：顶部导航 + 首页宫格/按钮 + 浏览器前进后退 */
    const navTabs = $('#navTabs');
    if (navTabs) navTabs.addEventListener('click', function (e) {
      const b = e.target.closest('.nav-tab'); if (!b) return;
      Main.go(b.dataset.view);
    });
    const viewHome = $('#viewHome');
    if (viewHome) viewHome.addEventListener('click', function (e) {
      const b = e.target.closest('[data-home-act]'); if (!b) return;
      Main.homeAction(b.dataset.homeAct);
    });
    window.addEventListener('hashchange', function () { Main.go(location.hash.slice(1)); });

    /* 顶栏「更多」下拉菜单 */
    const moreMenu = $('#moreMenu'), moreWrap = $('#moreWrap'), btnMore = $('#btnMore');
    const closeMore = function () {
      if (moreMenu.classList.contains('hidden')) return;
      moreMenu.classList.add('hidden'); btnMore.classList.remove('open'); btnMore.setAttribute('aria-expanded', 'false');
    };
    const openMore = function () {
      moreMenu.classList.remove('hidden'); btnMore.classList.add('open'); btnMore.setAttribute('aria-expanded', 'true');
    };
    btnMore.onclick = function (e) {
      e.stopPropagation();
      if (moreMenu.classList.contains('hidden')) openMore(); else closeMore();
    };
    moreMenu.onclick = function () { closeMore(); };
    /* 键盘：Esc 关闭，上下键在菜单项间移动焦点 */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeMore(); return; }
      if (moreMenu.classList.contains('hidden')) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = $$('.mm-item', moreMenu); if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      const n = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
      items[n].focus();
    });
    document.addEventListener('click', function (e) { if (!moreWrap.contains(e.target)) closeMore(); });
    $('#btnReset').onclick = function () {
      TFT.UI.confirm('重置全部', '将清空棋盘、备战区、海克斯、对手棋盘与复盘记录，是否继续？', function () {
        S.resetAll(); TFT.Store.saveCurrent(S.serialize('已重置', 'reset')); B.renderAll(); TFT.UI.toast('已重置全部数据', 'ok');
      }, '重置全部', true);
    };
    $('#logo').onclick = function () { if ($('#searchSuggest')) $('#searchSuggest').classList.add('hidden'); Main.go('home'); };

    /* 搜索 */
    $('#searchInput').addEventListener('input', U.debounce(function () { showSuggest($('#searchInput').value); }, 160));
    $('#searchInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
      else if (e.key === 'Escape') $('#searchSuggest').classList.add('hidden');
    });
    $('#btnSearch').onclick = doSearch;
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#searchWrap')) $('#searchSuggest').classList.add('hidden');
    });

    /* AI 对话 */
    $('#btnSend').onclick = function () { TFT.AI.send($('#chatInput').value); };
    $('#chatInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); TFT.AI.send(this.value); this.value = ''; this.style.height = 'auto'; }
    });
    $('#chatInput').addEventListener('input', function () {
      this.style.height = 'auto'; this.style.height = Math.min(88, this.scrollHeight) + 'px';
    });
    $('#quickAsks').addEventListener('click', function (e) {
      const c = e.target.closest('.chip'); if (!c) return;
      TFT.AI.send(c.dataset.q);
    });
    $('#btnClearChat').onclick = function () { TFT.AI.clear(); TFT.UI.toast('对话已清空', 'ok'); };

    /* 键盘快捷键 */
    document.addEventListener('keydown', function (e) {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target.tagName || '')) || e.target.isContentEditable;
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        TFT.Store.addSave({ id: U.uid('s'), name: '快捷保存 ' + new Date().toLocaleTimeString('zh-CN'), time: new Date().toLocaleString('zh-CN'), snap: S.serialize('快捷保存', 'save') });
        TFT.UI.toast('已快捷保存当前阵容（Ctrl+S）', 'ok');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (S.selected) { const uid = S.selected; S.sell(uid); B.commit('delete-key'); S.selected = null; }
      }
    });
  }

  /* ==================== 视图切换：数据站首页 / 阵容工作台 ==================== */
  Main.go = function (view) {
    const v = (view === 'app') ? 'app' : 'home';
    TFT.UI.closeModal();
    TFT.UI.destroyCharts();
    const app = $('#app'), home = $('#viewHome');
    if (app) app.classList.toggle('hidden', v !== 'app');
    if (home) home.classList.toggle('hidden', v !== 'home');
    $$('#navTabs .nav-tab').forEach(function (b) { b.classList.toggle('on', b.dataset.view === v); });
    TFT.Store.setPrefs({ lastView: v });
    if (location.hash.slice(1) !== v) { try { history.replaceState(null, '', '#' + v); } catch (e) { } }
    if (v === 'home') Main.renderHome();
    else if (B && B.renderAll) B.renderAll();
  };

  /* ==================== 首页门户渲染（全部数据来自站内真实字段） ==================== */
  Main.renderHome = function () {
    const hero = $('#homeHero');
    if (!hero) return;
    const An = TFT.Analytics, ov = An.overview(), M = D.meta || {};
    const list = rankedComps();
    TFT.UI.destroyCharts();

    /* —— Hero —— */
    hero.innerHTML =
      '<div class="hero-glow"></div>' +
      '<div class="hero-badge">' + U.esc(String(D.currentSlug || '').toUpperCase()) + ' · 补丁 ' + U.esc(M.updatedAt || '—') + ' · 数据可溯源</div>' +
      '<h1 class="hero-title">金铲铲 <b>AI 多智能体</b> 阵容数据站</h1>' +
      '<p class="hero-sub">真实棋库 · 真实概率 · 真实强度分层。既保留本地规则推理的独特机制，也可一键接入大模型多智能体协作。</p>' +
      '<div class="hero-cta">' +
      '<button class="btn btn-primary" data-home-act="app">进入阵容工作台</button>' +
      '<button class="btn" data-home-act="meta">Meta 梯度榜</button>' +
      '<button class="btn" data-home-act="roll">抽卡模拟器</button>' +
      '<button class="btn" data-home-act="quiz">认卡竞速</button>' +
      '</div>';

    /* —— KPI —— */
    const kpi = $('#homeKpiRow');
    const kpis = [
      { k: '棋子', v: ov.champions, s: '当前赛季真实棋库' },
      { k: '羁绊', v: ov.traits, s: '含激活阈值' },
      { k: '海克斯', v: ov.augments, s: '全量官方强化' },
      { k: '装备', v: ov.items, s: '小件 / 成装 / 神器' },
      { k: '评级阵容', v: list.length, s: 'S/A/B/C 四档' },
      { k: '赛季', v: ov.seasons, s: '可切换历史赛季' }
    ];
    if (kpi) kpi.innerHTML = kpis.map(function (x) {
      return '<div class="kpi"><div class="kpi-v">' + U.esc(String(x.v == null ? '—' : x.v)) + '</div>' +
        '<div class="kpi-k">' + U.esc(x.k) + '</div><div class="kpi-s dim">' + U.esc(x.s) + '</div></div>';
    }).join('');

    /* —— 热门阵容评级（S / A 前 6 各档） —— */
    const grid = $('#homeTierGrid');
    if (grid) {
      let cards = '';
      ['S', 'A'].forEach(function (t) {
        ((M.tiers && M.tiers[t]) || []).slice(0, 6).forEach(function (cp) { cards += compCardHTML(cp, t); });
      });
      grid.innerHTML = cards ? '<div class="comp-grid">' + cards + '</div>' : '<div class="dim">当前数据源暂无评级阵容</div>';
      $$('#homeTierGrid [data-comp]').forEach(c => c.onclick = function () { Main.openCompDetail(c.dataset.comp); });
    }

    /* —— 图表：费用分布 + 强度曲线 —— */
    const note = $('#homeChartNote');
    if (note) note.textContent = '1~5 费棋子数 · 各费用主C阵容数（真实统计）';
    const heat = (M.heatCurve || { labels: [], series: [] });
    if (window.Chart) {
      const ax = { ticks: { color: '#93a4c4', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.06)' } };
      const noGrid = { ticks: { color: '#93a4c4', font: { size: 9 } }, grid: { display: false } };
      const cd = An.championCostDist();
      const cCost = $('#homeCostChart');
      if (cCost) TFT.UI.chart(cCost, {
        type: 'bar',
        data: {
          labels: COST_LIST.map(c => c + ' 费'),
          datasets: [{ label: '棋子数', data: COST_LIST.map(c => cd.byCost[c] || 0), backgroundColor: COST_LIST.map(c => U.COST_COLOR[c]), borderRadius: 5 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: noGrid, y: ax } }
      });
      const colors = ['#22d3ee', '#f5c542', '#f43f5e', '#8b5cf6', '#34d399', '#fb923c', '#3b82f6'];
      const cHeat = $('#homeHeatChart');
      if (cHeat) TFT.UI.chart(cHeat, {
        type: 'line',
        data: {
          labels: heat.labels,
          datasets: (heat.series || []).map((s, i) => ({ label: s.name, data: s.data, borderColor: colors[i % colors.length], backgroundColor: 'transparent', tension: 0.3, borderWidth: 2, pointRadius: 2 }))
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#93a4c4', font: { size: 9 }, boxWidth: 10 } } },
          scales: { x: ax, y: ax }
        }
      });
    }

    /* —— 羁绊热度天梯 —— */
    const ladder = $('#homeTraitLadder');
    const tr = (M.traitRanking || []).slice(0, 12);
    const maxN = tr.length ? tr[0].count : 1;
    if (ladder) ladder.innerHTML = tr.length ? tr.map(function (x, i) {
      const w = U.clamp(Math.round((x.count / maxN) * 100), 6, 100);
      return '<div class="stat-row"><span class="sr-rank">' + (i + 1) + '</span>' +
        '<span class="sr-name">' + U.esc(x.name) + '</span>' +
        '<span class="sr-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="sr-val">' + x.count + '</span></div>';
    }).join('') : '<div class="dim">暂无数据</div>';
    const tn = $('#homeTraitNote');
    if (tn) tn.textContent = (M.traitRanking || []).length + ' 个羁绊 · 出现阵容数';

    /* —— 克制关系 —— */
    const counter = $('#homeCounter');
    if (counter) {
      const edges = (M.counterGraph && M.counterGraph.edges) || [];
      counter.innerHTML = edges.length ? edges.map(e => '<div class="log-item">' +
        '<span style="color:#86efac">' + U.esc(e.source) + '</span>' +
        '<span class="dim">克制</span><span style="color:#fda4af">' + U.esc(e.target) + '</span></div>').join('')
        : '<div class="dim">暂无数据</div>';
    }

    /* —— 奥恩神器 —— */
    const arts = $('#homeArtifacts');
    if (arts) {
      const list2 = (D.items.artifacts || []).slice(0, 21);
      arts.innerHTML = list2.length ? list2.map(itemCard).join('') : '<div class="dim">暂无神器数据</div>';
      $$('#homeArtifacts .item-card').forEach(bindItemTip);
    }

    /* —— 全部工具宫格 —— */
    const gn = $('#homeGridNav');
    if (gn) {
      const tools = [
        { act: 'app', t: '阵容工作台', d: '棋盘 / 羁绊 / 概率 / AI 多智能体' },
        { act: 'meta', t: 'Meta 梯度榜', d: 'S/A/B/C 评级与羁绊热度' },
        { act: 'charts', t: '数据图表', d: '费用 / 类别 / 层级分布' },
        { act: 'roll', t: '抽卡模拟器', d: '真实概率 + 牌池搜卡' },
        { act: 'quiz', t: '认卡竞速', d: '20 题认卡挑战 · 本地最佳' },
        { act: 'poster', t: '阵容一图流', d: '按当前棋盘导出长图' },
        { act: 'trait', t: '羁绊探索器', d: '按目标羁绊反查阵容' },
        { act: 'battle', t: '战斗模拟器', d: '红蓝对抗胜负博弈' },
        { act: 'power', t: '战力计算器', d: '单卡 DPS / 坦度测算' },
        { act: 'opponents', t: '对手棋盘', d: '记录 8 家对局' },
        { act: 'review', t: '对局复盘', d: '关键决策 + AI 点评' },
        { act: 'llm', t: '大模型设置', d: 'DeepSeek / OpenAI 兼容' }
      ];
      gn.innerHTML = tools.map(function (x) {
        return '<button class="grid-nav-item" data-home-act="' + U.esc(x.act) + '"><b>' + U.esc(x.t) + '</b><i>' + U.esc(x.d) + '</i></button>';
      }).join('');
    }

    /* —— 数据来源与口径 —— */
    const src = D.sourceInfo() || {};
    const srcUrls = (src.sourceUrls || []).map(function (u) {
      return '<a href="' + U.esc(u) + '" target="_blank" rel="noopener">' + U.esc(String(u).replace(/^https?:\/\//, '').slice(0, 46)) + '</a>';
    }).join(' · ');
    const hs = $('#homeSource');
    if (hs) hs.innerHTML =
      '<div class="kv"><span class="k">数据来源</span><span class="v">' + U.esc(src.source || 'Riot CommunityDragon') + '</span></div>' +
      '<div class="kv"><span class="k">抓取时间</span><span class="v">' + U.esc(src.fetchedAt || ov.fetchedAt || '—') + '</span></div>' +
      '<div class="kv"><span class="k">条目统计</span><span class="v">海克斯 ' + U.esc(String(ov.augments)) + ' · 装备 ' + U.esc(String(ov.items)) + ' · 赛季 ' + U.esc(String(ov.seasons)) + '</span></div>' +
      (srcUrls ? '<div class="kv"><span class="k">原始链接</span><span class="v">' + srcUrls + '</span></div>' : '') +
      '<p class="home-source-note">说明：' + U.esc((D.meta && D.meta.note) || '本站仅统计与展示数据源中真实存在的字段。') +
      ' 所有「强度」为基于真实对线数据推导的相对分层，非官方胜率；概率由本地规则引擎按公开概率表计算，未使用任何真实对局遥测。</p>';
  };

  /* 首页按钮统一分发 */
  Main.homeAction = function (act) {
    switch (act) {
      case 'app': Main.go('app'); break;
      case 'meta': Main.openMeta(); break;
      case 'charts': Main.openCharts(); break;
      case 'roll': Main.openRollSim(); break;
      case 'quiz': Main.openCardQuiz(); break;
      case 'poster': Main.exportPoster(); break;
      case 'llm': TFT.AI.openSettings(); break;
      case 'trait': Main.go('app'); Main.openTraitExplorerModal(); break;
      case 'battle': Main.go('app'); TFT.Battle.openSim(); break;
      case 'power': Main.go('app'); TFT.Power.openCalc(); break;
      case 'opponents': Main.go('app'); Main.openOpponents(); break;
      case 'review': Main.go('app'); TFT.Review.open(); break;
    }
  };

  /* ==================== 阵容一图流（PNG 长图导出） ==================== */
  /* 传入 cp 时导出该 Meta 阵容；不传时导出当前棋盘实时阵容 */
  Main.exportPoster = function (cp) {
    if (!window.html2canvas) { TFT.UI.toast('html2canvas 未加载，无法生成一图流', 'err'); return; }
    const fromComp = !!cp;
    let units, traits, posInfo, title, tier = '', mainC = '', strength = null, rank = null, total = null, source = '';
    if (fromComp) {
      const plan = TFT.Recommend.plan(cp);
      const itemByName = {};
      plan.units.forEach(function (p) { itemByName[p.name] = p.items.map(it => it.name); });
      units = (cp.units || []).map(function (u) {
        return {
          name: u.name, cost: u.cost, star: u.star || 1,
          items: (u.items || []).length ? u.items : (itemByName[u.name] || [])
        };
      });
      traits = cp.traits || [];
      posInfo = posGridHTML(cp);
      title = displayName(cp);
      const f = Main.findComp(cp.id);
      tier = f ? f.tier : (cp.tier || '');
      mainC = cp.mainC || '';
      strength = cp.strength;
      const rk = compRankInfo(cp); rank = rk.rank; total = rk.total;
      source = cp.source || 'MetaTFT';
    } else {
      const board = S.boardList();
      if (!board.length) { TFT.UI.toast('棋盘为空，先加载或拖拽棋子再生成一图流', 'warn', 3200); return; }
      units = board.map(function (u) {
        const c = D.champ(u.champId);
        return {
          name: c ? c.name : u.champId, cost: c ? c.cost : 0, star: u.star || 1,
          items: (u.items || []).map(id => (D.item(id) || {}).name).filter(Boolean)
        };
      });
      traits = U.calcTraits(board, S.bench || []).filter(t => t.active)
        .map(t => ({ name: t.name, active: t.count, need: (t.level && t.level.min) || t.nextMin || t.count }));
      let best = null;
      board.forEach(function (u) { const c = D.champ(u.champId); if (c && (!best || c.cost > best.cost)) best = c; });
      mainC = best ? best.name : '';
      title = '我的实时阵容';
      posInfo = null;
    }

    const season = D.currentSlug ? D.currentSlug.toUpperCase() : '';
    const wrap = U.el('div', 'poster-wrap');
    wrap.style.cssText = 'position:fixed;left:-99999px;top:0;width:860px;padding:24px;background:linear-gradient(180deg,#0b1220,#070c16);color:#e8f0ff;font-family:inherit;z-index:-1';
    let html = '<div class="ps-head">' +
      '<div class="ps-title">金铲铲 AI 多智能体 · ' + U.esc(season) + '</div>' +
      '<div class="ps-time">' + U.esc(new Date().toLocaleString('zh-CN')) + '</div></div>' +
      '<div class="ps-name-row">' +
      (tier ? '<span class="ps-tier td-' + U.esc(tier) + '">' + U.esc(tier) + '</span>' : '') +
      '<span class="ps-name">' + U.esc(title) + '</span>' +
      (rank ? '<span class="ps-rank">全服 #' + rank + ' / ' + total + '</span>' : '') +
      '</div>' +
      '<div class="ps-meta">主C ' + U.esc(mainC || '-') + ' · ' + units.length + ' 人口' +
      (strength != null ? ' · 相对强度 ' + strengthLabel(strength) : '') +
      (source ? ' · 数据 ' + U.esc(source) : '') + '</div>';

    if (traits.length) html += '<div class="ps-traits">' + traits.map(function (t) {
      return '<span class="ps-tag">' + U.esc(t.name) + ' ' + (t.active || 0) + '</span>';
    }).join('') + '</div>';

    if (posInfo && posInfo.html) html += '<div class="ps-block"><div class="ps-h">推荐站位（前排 ' +
      posInfo.frontN + ' · 中排 ' + posInfo.midN + ' · 后排 ' + posInfo.backN + '）</div>' + posInfo.html + '</div>';

    const rows = units.slice().sort((a, b) => (b.cost - a.cost) || ((b.star || 1) - (a.star || 1))).map(function (u) {
      const ch = D.champByName(u.name); const ico = ch ? U.champIcon(ch) : null;
      return '<div class="unit-row">' +
        '<span class="ur-cost c' + u.cost + '">' + u.cost + '</span>' +
        (ico ? '<img class="ur-icon" src="' + ico + '" alt="">' : '<span class="ur-icon ur-fb">' + U.esc((u.name || '?').slice(0, 1)) + '</span>') +
        '<span class="ur-name">' + U.esc(u.name) + '</span>' +
        '<span class="ur-star">' + '★'.repeat(U.clamp(u.star || 1, 1, 3)) + '</span>' +
        '<span class="ur-items dim">' + U.esc((u.items || []).join('、') || '—') + '</span>' +
        '</div>';
    }).join('');
    html += '<div class="ps-block"><div class="ps-h">上阵单位（' + units.length + '）</div><div class="unit-table">' + rows + '</div></div>' +
      '<div class="ps-foot">由「金铲铲 AI 多智能体阵容模拟器」生成 · 强度为真实对线数据推导的相对分层，非官方胜率；出装为本地规则引擎推荐，非官方方案。如需分享请保留本站标识</div>';
    wrap.innerHTML = html;
    document.body.appendChild(wrap);

    setTimeout(function () {
      window.html2canvas(wrap, { backgroundColor: '#070c16', scale: 2, useCORS: true, logging: false })
        .then(function (canvas) {
          canvas.toBlob(function (blob) {
            const url = URL.createObjectURL(blob);
            const a = U.el('a'); a.href = url; a.download = 'tft-poster-' + Date.now() + '.png';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1500);
            TFT.UI.toast('已生成阵容一图流 PNG', 'ok');
          });
        })
        .catch(function (err) { TFT.UI.toast('生成失败：' + err.message, 'err'); })
        .finally(function () { wrap.remove(); });
    }, 320);
  };

  /* ==================== 数据图表页 ==================== */
  Main.openCharts = function () {
    const An = TFT.Analytics, M = D.meta || {};
    const TIER_CN = { silver: '银', gold: '金', prismatic: '棱彩', unknown: '特殊' };
    const CAT_CN = { component: '基础小件', completed: '成装', artifact: '奥恩神器', ornn: '奥恩神器' };

    const body =
      '<div class="chart-note">以下图表均由站内数据源的真实字段统计生成，不含任何对局遥测或伪造口径。</div>' +
      '<div class="chart-sec"><h4>棋子费用分布</h4><div class="chart-wrap tall"><canvas id="chCost"></canvas></div></div>' +
      '<div class="chart-sec"><h4>装备类别分布</h4><div class="chart-wrap tall"><canvas id="chItem"></canvas></div></div>' +
      '<div class="chart-sec"><h4>海克斯层级分布</h4><div class="chart-wrap tall"><canvas id="chAug"></canvas></div></div>' +
      '<div class="chart-sec"><h4>各赛季条目数</h4><div class="chart-wrap tall"><canvas id="chSet"></canvas></div></div>' +
      '<div class="chart-sec"><h4>阵容相对强度曲线</h4><div class="chart-wrap tall"><canvas id="chHeat"></canvas></div></div>' +
      '<div class="chart-sec"><h4>羁绊热度排行</h4><div class="chart-wrap tall"><canvas id="chTrait"></canvas></div></div>';

    TFT.UI.modal({ title: '数据图表 · ' + (M.set || D.currentSlug || ''), size: 'wide', body: body });
    if (!window.Chart) { TFT.UI.toast('图表库未加载，无法渲染图表', 'err'); return; }

    const ax = { ticks: { color: '#93a4c4', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.06)' } };
    const noGrid = { ticks: { color: '#93a4c4', font: { size: 9 } }, grid: { display: false } };
    const legend = { labels: { color: '#93a4c4', font: { size: 9 }, boxWidth: 10 } };

    /* 1. 费用分布 */
    const cd = An.championCostDist();
    TFT.UI.chart($('#chCost'), {
      type: 'bar',
      data: {
        labels: COST_LIST.map(c => c + ' 费'),
        datasets: [{ label: '棋子数', data: COST_LIST.map(c => cd.byCost[c] || 0), backgroundColor: COST_LIST.map(c => U.COST_COLOR[c]), borderRadius: 5 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: noGrid, y: ax } }
    });

    /* 2. 装备类别 */
    const ic = An.itemCategoryDist();
    const catKeys = Object.keys(ic);
    TFT.UI.chart($('#chItem'), {
      type: 'doughnut',
      data: {
        labels: catKeys.map(k => CAT_CN[k] || k),
        datasets: [{ data: catKeys.map(k => ic[k]), backgroundColor: ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#f43f5e', '#22d3ee', '#94a3b8'], borderColor: '#0b1220', borderWidth: 2 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#cfe3ff', font: { size: 10 }, boxWidth: 10 } } } }
    });

    /* 3. 海克斯层级 */
    const ad = An.augmentTierDist();
    const augKeys = ['silver', 'gold', 'prismatic', 'unknown'].filter(k => ad[k]);
    TFT.UI.chart($('#chAug'), {
      type: 'bar',
      data: {
        labels: augKeys.map(k => TIER_CN[k] || k),
        datasets: [{ label: '强化数', data: augKeys.map(k => ad[k]), backgroundColor: ['#94a3b8', '#f5c542', '#22d3ee', '#8b5cf6'], borderRadius: 5 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: noGrid, y: ax } }
    });

    /* 4. 各赛季条目数 */
    const per = An.perSetCounts();
    TFT.UI.chart($('#chSet'), {
      type: 'bar',
      data: {
        labels: per.map(x => String(x.slug).toUpperCase()),
        datasets: [
          { label: '海克斯', data: per.map(x => x.augments || 0), backgroundColor: 'rgba(34,211,238,.65)', borderRadius: 4 },
          { label: '装备', data: per.map(x => x.items || 0), backgroundColor: 'rgba(245,197,66,.65)', borderRadius: 4 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: legend }, scales: { x: noGrid, y: ax } }
    });

    /* 5. 强度曲线 */
    const hc = M.heatCurve || { labels: [], series: [] };
    const colors = ['#22d3ee', '#f5c542', '#f43f5e', '#8b5cf6', '#34d399', '#fb923c', '#3b82f6'];
    TFT.UI.chart($('#chHeat'), {
      type: 'line',
      data: {
        labels: hc.labels,
        datasets: (hc.series || []).map((s, i) => ({ label: s.name, data: s.data, borderColor: colors[i % colors.length], backgroundColor: 'transparent', tension: 0.3, borderWidth: 2, pointRadius: 2 }))
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: legend }, scales: { x: ax, y: ax } }
    });

    /* 6. 羁绊热度 */
    const tr = M.traitRanking || [];
    TFT.UI.chart($('#chTrait'), {
      type: 'bar',
      data: {
        labels: tr.map(x => x.name),
        datasets: [{ label: '出现阵容数', data: tr.map(x => x.count), backgroundColor: 'rgba(34,211,238,.6)', borderRadius: 4 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#93a4c4', font: { size: 8 } }, grid: { display: false } }, y: ax } }
    });
  };

  /* ==================== 抽卡模拟器（真实概率 + 牌池） ==================== */
  let rollSim = null;

  function renderRollSim() {
    const w = $('#rollSimWrap');
    if (!w || !rollSim) return;
    const rs = rollSim;
    const adj = TFT.Odds.adjusted(rs.level, {});
    const lvOpts = Array.from({ length: 11 }, (_, i) => i + 1).map(i =>
      '<option value="' + i + '"' + (i === rs.level ? ' selected' : '') + '>' + i + ' 级</option>').join('');
    const champOpts = '<option value="">（任意）</option>' + D.champions().slice()
      .sort((a, b) => (a.cost - b.cost) || String(a.name).localeCompare(String(b.name), 'zh'))
      .map(c => '<option value="' + U.esc(c.id) + '"' + (rs.target === c.id ? ' selected' : '') + '>' + c.cost + ' 费 ' + U.esc(c.name) + '</option>').join('');

    const shop = (rs.shop && rs.shop.length) ? rs.shop.map(function (id) {
      const c = id ? D.champ(id) : null;
      if (!c) return '<div class="rs-slot empty"><span class="rs-name dim">空位</span></div>';
      const hit = rs.target && c.id === rs.target;
      return '<div class="rs-slot c' + c.cost + (hit ? ' hit' : '') + '" title="' + U.esc(c.name) + '">' +
        (c.icon ? '<img src="' + U.champIcon(c) + '" alt="">' : '') +
        '<span class="rs-name">' + U.esc(c.name) + '</span><span class="rs-cost">' + c.cost + '</span></div>';
    }).join('') : '<div class="dim" style="grid-column:1/-1;text-align:center;padding:14px 0">点击「刷新一次」开始模拟搜卡</div>';

    const avg = rs.hits ? (rs.rolls / rs.hits).toFixed(1) : '—';
    w.innerHTML =
      '<div class="card">' +
        '<div class="rs-ctrl">' +
          '<label>等级 <select id="rsLevel" class="sel sel-sm">' + lvOpts + '</select></label>' +
          '<label>金币 <input id="rsGold" type="number" min="0" step="2" value="' + rs.gold + '"></label>' +
          '<label>目标棋子 <select id="rsTarget" class="sel sel-sm">' + champOpts + '</select></label>' +
        '</div>' +
        '<div class="m-row" style="margin-top:8px">' +
          '<button class="btn btn-xs btn-primary" id="rsRoll">刷新一次（2 金）</button>' +
          '<button class="btn btn-xs" id="rsRoll10">连刷 10 次（20 金）</button>' +
          '<button class="btn btn-xs" id="rsReset">重置</button>' +
        '</div>' +
        '<div class="rs-shop">' + shop + '</div>' +
        '<div class="kv"><span class="k">刷新次数</span><span class="v">' + rs.rolls + ' 次（' + (rs.rolls * 2) + ' 金）</span></div>' +
        '<div class="kv"><span class="k">剩余金币</span><span class="v">' + rs.gold + '</span></div>' +
        '<div class="kv"><span class="k">目标命中</span><span class="v">' + (rs.target ? (rs.hits + ' 张 · 平均 ' + avg + ' 刷/张') : '未选择目标') + '</span></div>' +
      '</div>' +
      '<div class="card" style="margin-top:8px"><h4>当前等级理论概率 <span class="dim">真实概率表 + 牌池占用修正</span></h4>' +
        '<div class="odds-table">' + oddsTableHTML(adj) + '</div>' +
        '<div class="dim" style="font-size:10px;margin-top:6px">概率来自公开商店概率表，并按当前棋盘/备战区占用实时修正牌池。模拟仅用于演示，不代表真实对局结果。</div>' +
      '</div>';

    $('#rsLevel').onchange = function () { rs.level = Number(this.value); renderRollSim(); };
    $('#rsGold').onchange = function () { rs.gold = Math.max(0, Number(this.value) || 0); renderRollSim(); };
    $('#rsTarget').onchange = function () { rs.target = this.value; rs.hits = 0; rs.rolls = 0; rs.shop = []; renderRollSim(); };
    $('#rsRoll').onclick = function () { rollSimRoll(1); };
    $('#rsRoll10').onclick = function () { rollSimRoll(10); };
    $('#rsReset').onclick = function () {
      rollSim = { level: rs.level, gold: 50, hits: 0, rolls: 0, shop: [], target: rs.target };
      renderRollSim();
    };
  }

  function rollSimRoll(n) {
    const rs = rollSim; if (!rs) return;
    const st = U.poolStatus();
    const byCost = {};
    D.champions().forEach(function (c) {
      if ((st[c.id] == null ? 0 : st[c.id]) > 0) (byCost[c.cost] = byCost[c.cost] || []).push(c.id);
    });
    for (let r = 0; r < n; r++) {
      if (rs.gold < 2) { TFT.UI.toast('金币不足，无法继续刷新', 'warn'); break; }
      rs.gold -= 2; rs.rolls++;
      const adj = TFT.Odds.adjusted(rs.level, {});
      let total = 0;
      COST_LIST.forEach(c => { total += Math.max(0, adj[c].adjusted); });
      const shop = [];
      for (let s = 0; s < 5; s++) {
        let x = Math.random() * total, pickCost = COST_LIST[0];
        for (let i = 0; i < COST_LIST.length; i++) {
          x -= Math.max(0, adj[COST_LIST[i]].adjusted);
          if (x <= 0) { pickCost = COST_LIST[i]; break; }
        }
        const pool = byCost[pickCost] || [];
        const id = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
        if (id && rs.target && id === rs.target) rs.hits++;
        shop.push(id);
      }
      rs.shop = shop;
    }
    renderRollSim();
  }

  Main.openRollSim = function () {
    rollSim = { level: S.level || 8, gold: S.gold == null ? 50 : S.gold, hits: 0, rolls: 0, shop: [], target: '' };
    TFT.UI.modal({ title: '抽卡模拟器 · 真实概率与牌池', size: 'wide', body: '<div id="rollSimWrap"></div>' });
    renderRollSim();
  };

  /* ==================== 阵容优化器 ==================== */
  let optimizer = null;

  function traitStyleBadge(t) {
    const colors = { 4: '#a78bfa', 3: '#fbbf24', 2: '#94a3b8', 1: '#64748b' };
    const label = t.prismatic ? '棱镜' : (t.style === 3 ? '金' : (t.style === 2 ? '银' : '铜'));
    return '<span class="traits-badge" style="background:rgba(' + (t.prismatic ? '139,92,246' : t.style === 3 ? '251,191,36' : '100,116,139') + ',0.18);color:' + (colors[t.style] || '#aaa') + ';border-color:' + (colors[t.style] || '#aaa') + '">' +
      U.esc(t.name) + ' ' + t.count + '/' + t.min + '</span>';
  }

  Main.openOptimizer = function () {
    const cur = TFT.Optimize.currentUnits();
    const levelNow = TFT.state.level || 8;
    const goldNow = TFT.state.gold || 50;
    const transitions = TFT.Optimize.transitions(cur);

    optimizer = {
      level: levelNow, gold: goldNow,
      currentUnits: cur,
      transitions: transitions,
      selectedIdx: transitions.length ? 0 : -1
    };

    let _firstRender = true;

    function render() {
      if (!optimizer) return;
      const curCount = optimizer.currentUnits.length;
      const ownedNames = optimizer.currentUnits.map(function (u) { return u.name; }).filter(Boolean);

      // 当前拥有摘要
      const curSummary = curCount ?
        '<div class="op-owned"><b>已拥有 ' + curCount + ' 张</b>：' + ownedNames.slice(0, 12).join('、') + (ownedNames.length > 12 ? '…' : '') + '</div>' :
        '<div class="dim">当前棋盘 / 备战区为空，优化器将推荐 Top 通用阵容作为起点</div>';

      // 候选卡片
      const cards = optimizer.transitions.map(function (t, i) {
        const tierColor = { S: '#f43f5e', A: '#f59e0b', B: '#22d3ee', C: '#a78bfa', D: '#64748b' }[t.tier] || '#94a3b8';
        const traitHTML = t.traits.slice(0, 4).map(traitStyleBadge).join(' ');
        const sel = optimizer.selectedIdx === i ? ' on' : '';
        return '<div class="op-card' + sel + '" data-op-idx="' + i + '">' +
          '<div class="op-card-head">' +
            '<span class="op-card-tier" style="background:' + tierColor + '22;color:' + tierColor + ';border-color:' + tierColor + '">' + t.tier + ' 档</span>' +
            '<span class="op-card-match">匹配度 ' + t.matchRatio + '%</span>' +
          '</div>' +
          '<div class="op-card-name">' + U.esc(t.name) + '</div>' +
          '<div class="op-card-sub">主C：' + U.esc(t.mainC || '—') + ' · 终局评分 ' + t.finalScore + '</div>' +
          '<div class="op-card-traits">' + (traitHTML || '<span class="dim">未激活羁绊</span>') + '</div>' +
        '</div>';
      }).join('');

      if (!cards) {
        TFT.UI.modal({ title: '阵容优化器', size: 'wide', body: '<div class="dim">当前数据中无可用阵容，请确认赛季已选</div>' });
        return;
      }

      // 选中目标的过渡步骤
      let detailHTML = '';
      if (optimizer.selectedIdx >= 0 && optimizer.transitions[optimizer.selectedIdx]) {
        const target = optimizer.transitions[optimizer.selectedIdx];
        const step = TFT.Optimize.nextSteps(optimizer.currentUnits, target, { level: optimizer.level, gold: optimizer.gold });

        const toGetHTML = step.toGet.length ?
          step.toGet.map(function (g) {
            const ch = D.champ(g.champId);
            const costCls = 'c' + (ch ? ch.cost : 1);
            return '<div class="op-step-item"><span class="op-tag ' + costCls + '">' + (ch ? ch.cost : 1) + '费</span>' +
              '<b>' + U.esc(g.name) + '</b>' + (g.star > 1 ? ' ★'.repeat(g.star) : '') +
              '<span class="dim"> — ' + U.esc(g.reason) + '</span></div>';
          }).join('') :
          '<div class="dim">已齐</div>';

        const toSellHTML = step.toSell.length ?
          step.toSell.map(function (s) {
            const ch = D.champByName(s.name);
            const costCls = 'c' + (ch ? ch.cost : 1);
            return '<div class="op-step-item"><span class="op-tag ' + costCls + '">' + (ch ? ch.cost : 1) + '费</span>' +
              '<b>' + U.esc(s.name) + '</b>' + ' ★'.repeat(s.star || 1) +
              (s.dup > 1 ? ' ×' + s.dup : '') +
              '<span class="dim"> — ' + U.esc(s.reason) + '</span></div>';
          }).join('') :
          '<div class="dim">无</div>';

        detailHTML =
          '<div class="op-detail">' +
            '<div class="op-target">' +
              '<b>' + U.esc(step.target) + '</b>' +
              '<span class="tier-badge" style="background:rgba(244,63,94,.18);color:#f43f5e;border-color:#f43f5e">' + step.tier + ' 档</span>' +
              '<span class="dim"> 保留 ' + step.keepCount + '/' + step.targetSize + ' 棋子 · 匹配度 ' + step.matchRatio + '%</span>' +
            '</div>' +
            '<div class="op-plan">' +
              '<div class="op-plan-row"><span class="dim">金币需求</span><b>' + step.goldNeeded + ' 金' +
                (step.sellRefund ? '（卖可回补 ' + step.sellRefund + ' 金）' : '') + '</b></div>' +
              '<div class="op-plan-row"><span class="dim">人口 / 经验</span><b>' + step.levelNow + ' → ' + step.levelTarget + '（需 ' + step.expNeeded + ' 经验 / ≈ ' + step.goldForLevel + ' 金）</b></div>' +
              '<div class="op-plan-row"><span class="dim">建议</span><b class="op-strategy">' + U.esc(step.strategy) + '</b></div>' +
            '</div>' +
            '<div class="op-split">' +
              '<div class="op-split-col"><h4>🔨 要拿的棋子（' + step.toGet.length + '）</h4>' + toGetHTML + '</div>' +
              '<div class="op-split-col"><h4>🗑 可以卖的（' + step.toSell.length + '）</h4>' + toSellHTML + '</div>' +
            '</div>' +
            '<div class="op-actions">' +
              '<button class="btn" id="opLoad">📋 加载目标阵容到棋盘</button>' +
              '<button class="btn" id="opRefresh">🔄 重新计算</button>' +
              '<button class="btn btn-primary" id="opAI">🤖 AI 教练点评</button>' +
            '</div>' +
            '<div id="opAIBox" class="op-ai-box hidden"></div>' +
          '</div>';
      }

      const body =
        '<div id="optWrap">' +
          '<div class="op-state">' +
            '<div class="op-state-row">' +
              '<span class="dim">当前等级</span>' +
              '<select class="sel sel-sm" id="optLevel">' +
                (function () { let h = ''; for (let i = 4; i <= 11; i++) h += '<option value="' + i + '"' + (i === optimizer.level ? ' selected' : '') + '>' + i + ' 级</option>'; return h; })() +
              '</select>' +
            '</div>' +
            '<div class="op-state-row">' +
              '<span class="dim">现有金币</span>' +
              '<input class="txt sm" id="optGold" type="number" min="0" max="500" value="' + optimizer.gold + '">' +
            '</div>' +
          '</div>' +
          curSummary +
          '<div class="op-candidates">' + cards + '</div>' +
          detailHTML +
        '</div>';

      if (_firstRender) {
        _firstRender = false;
        TFT.UI.modal({
          title: '阵容优化器 · 规则引擎推算',
          size: 'wide',
          body: body,
          onClose: function () { optimizer = null; _firstRender = true; }
        });
      } else {
        const mb = $('#modalBody'); if (mb) mb.innerHTML = body;
      }

      // 候选点击
      $$('#optWrap .op-card').forEach(function (el) {
        el.onclick = function () {
          optimizer.selectedIdx = parseInt(el.dataset.opIdx, 10);
          render();
        };
      });

      // state 控件
      const lvSel = $('#optLevel'); if (lvSel) lvSel.onchange = function () { optimizer.level = parseInt(lvSel.value, 10); };
      const gdIn = $('#optGold'); if (gdIn) gdIn.onchange = function () { optimizer.gold = parseInt(gdIn.value, 10) || 0; };

      // 加载按钮
      const btnLoad = $('#opLoad'); if (btnLoad) btnLoad.onclick = function () {
        if (optimizer.selectedIdx < 0) return;
        const target = optimizer.transitions[optimizer.selectedIdx];
        const tiersMap = (D.meta && D.meta.tiers) ? D.meta.tiers : {};
        let metaComp = null;
        Object.keys(tiersMap).forEach(function (t) {
          (tiersMap[t] || []).forEach(function (cp) {
            if (cp.id === target.id) metaComp = cp;
          });
        });
        if (!metaComp) return;
        TFT.state.level = optimizer.level;
        Main.loadComp(metaComp);
        TFT.UI.closeModal();
        TFT.UI.toast('已加载「' + target.name + '」到棋盘', 'ok');
      };
      const btnRefresh = $('#opRefresh'); if (btnRefresh) btnRefresh.onclick = function () {
        // 重新从 state 读当前棋盘
        optimizer.currentUnits = TFT.Optimize.currentUnits();
        optimizer.transitions = TFT.Optimize.transitions(optimizer.currentUnits);
        optimizer.selectedIdx = optimizer.transitions.length ? 0 : -1;
        render();
      };

      const btnAI = $('#opAI');
      if (btnAI) btnAI.onclick = function () {
        if (!optimizer || optimizer.selectedIdx < 0) return;
        const target = optimizer.transitions[optimizer.selectedIdx];
        const step = TFT.Optimize.nextSteps(optimizer.currentUnits, target, { level: optimizer.level, gold: optimizer.gold });
        const box = $('#opAIBox');
        if (!box) return;
        box.classList.remove('hidden');
        box.innerHTML = '<div class="op-ai-loading">🤖 教练团正在分析…</div>';
        btnAI.disabled = true; btnAI.textContent = '⏳ 分析中…';

        const prefs = TFT.Store.prefs();
        if (!prefs.llmBaseUrl || !prefs.llmKey) {
          box.innerHTML = '<div class="dim">⚠ 尚未配置大模型 API Key。请点顶栏「大模型」按钮填好后再来。</div>';
          btnAI.disabled = false; btnAI.textContent = '🤖 AI 教练点评';
          return;
        }

        const prompt =
          '当前对局快照：\n' +
          '- 等级 ' + step.levelNow + ' · 金币 ' + optimizer.gold + '\n' +
          '- 已拥有棋子：' + optimizer.currentUnits.map(function (u) { return u.name + (u.star > 1 ? '★'.repeat(u.star) : ''); }).join('、') + '\n\n' +
          '目标阵容：' + step.target + '（' + step.tier + ' 档 · 终局评分 ' + step.finalScore + '）\n' +
          '激活羁绊：' + step.traits.map(function (t) { return t.name + ' ' + t.count + '/' + t.min; }).join('、') + '\n\n' +
          '过渡方案（规则引擎推算）：\n' +
          '🔨 要拿的棋子：' + (step.toGet.length ? step.toGet.map(function (g) { return g.name + '（' + g.cost + '费' + (g.star > 1 ? ',' + g.star + '★' : '') + '）'; }).join('、') : '无') + '\n' +
          '🗑 可以卖的：' + (step.toSell.length ? step.toSell.map(function (g) { return g.name + '（' + g.cost + '费）'; }).join('、') : '无') + '\n' +
          '💰 金币需求：' + step.goldNeeded + ' 金（卖可回补 ' + step.sellRefund + '）\n' +
          '🎯 下一步建议：' + step.strategy + '\n\n' +
          '请以「经济分析师 / 装备顾问 / 站位教练 / 阵容变速师 / 卡池精算师」五位教练的身份，各用 1-2 句话点评这个过渡方案的利弊。总字数控制在 250 字以内，中文输出。';

        const onChunk = function (text, done) {
          box.innerHTML = U.md('<div class="op-ai-chat">' + text + '</div>');
          if (done) { btnAI.disabled = false; btnAI.textContent = '🤖 AI 教练点评'; }
        };
        const err = function (msg) {
          box.innerHTML = '<div class="dim">❌ ' + U.esc(msg) + '</div>';
          btnAI.disabled = false; btnAI.textContent = '🤖 AI 教练点评';
        };

        if (TFT.AI && TFT.AI.streamLocal) {
          // 有本地 LLM 直连能力
          TFT.AI.streamLocal(prompt, onChunk, err);
        } else if (TFT.AI && TFT.AI.send) {
          // 走多智能体聊天
          S.chat = S.chat || [];
          S.chat.push({ role: 'user', content: prompt, ts: Date.now() });
          box.innerHTML = '<div class="op-ai-loading">多智能体教练已接力…</div>';
          TFT.AI.send(prompt, { noPush: true }, function (text, ok) {
            box.innerHTML = U.md('<div class="op-ai-chat">' + text + '</div>');
            btnAI.disabled = false; btnAI.textContent = '🤖 AI 教练点评';
            if (!ok && text.indexOf('Error') >= 0) err(text);
          });
        } else {
          box.innerHTML = '<div class="dim">⚠ AI 模块未就绪</div>';
          btnAI.disabled = false; btnAI.textContent = '🤖 AI 教练点评';
        }
      };
    }

    render();
  };

  /* ==================== 认卡竞速（20 题） ==================== */
  let quiz = null;

  function finishQuiz() {
    const w = $('#quizWrap'); const qz = quiz; if (!w || !qz) return;
    const sec = Math.max(1, Math.round((Date.now() - qz.start) / 1000));
    const acc = Math.round((qz.correct / qz.total) * 100);
    const best = TFT.Store.prefs().quizBest;
    const isBest = !best || qz.correct > best.correct || (qz.correct === best.correct && sec < best.sec);
    if (isBest) TFT.Store.setPrefs({ quizBest: { correct: qz.correct, total: qz.total, sec: sec, time: new Date().toLocaleString('zh-CN') } });
    const bestNow = TFT.Store.prefs().quizBest;
    w.innerHTML =
      '<div class="qz-result">' +
        '<div class="qz-score">' + qz.correct + ' <span class="dim">/ ' + qz.total + '</span></div>' +
        '<div class="qz-meta">正确率 ' + acc + '% · 用时 ' + sec + ' 秒' + (isBest ? ' · <b style="color:var(--gold)">新纪录！</b>' : '') + '</div>' +
        (bestNow ? '<div class="dim" style="font-size:11px;margin-top:8px">历史最佳：' + bestNow.correct + '/' + bestNow.total + ' · ' + U.esc(bestNow.time || '') + '</div>' : '') +
        '<div class="m-row" style="justify-content:center;margin-top:14px"><button class="btn btn-primary" id="qzAgain">再来一局</button></div>' +
      '</div>';
    $('#qzAgain').onclick = function () {
      quiz = { pool: qz.pool, total: 20, idx: 0, correct: 0, wrong: 0, q: null, answered: false, start: Date.now() };
      nextQuiz();
    };
  }

  function nextQuiz() {
    const w = $('#quizWrap'); const qz = quiz;
    if (!w || !qz) return;
    if (qz.idx >= qz.total) { finishQuiz(); return; }
    const ans = qz.pool[Math.floor(Math.random() * qz.pool.length)];
    let cands = qz.pool.filter(c => c.id !== ans.id && c.cost === ans.cost);
    if (cands.length < 3) cands = qz.pool.filter(c => c.id !== ans.id);
    cands = cands.slice().sort(() => Math.random() - 0.5).slice(0, 3);
    const opts = cands.concat([ans]).sort(() => Math.random() - 0.5);
    qz.q = { ans: ans, opts: opts };
    qz.answered = false;

    w.innerHTML =
      '<div class="qz-head"><span>第 <b>' + (qz.idx + 1) + '</b> / ' + qz.total + ' 题</span>' +
      '<span>答对 <b style="color:#34d399">' + qz.correct + '</b> · 答错 <b style="color:#fda4af">' + qz.wrong + '</b></span></div>' +
      '<div class="qz-stage">' +
        '<div class="qz-card c' + ans.cost + '">' +
          '<span class="qz-mark">?</span>' +
          (ans.icon ? '<img src="' + U.esc(ans.icon) + '" alt="?" onerror="this.style.display=\'none\'">' : '') +
        '</div>' +
        '<div class="qz-cost">' + ans.cost + ' 费</div>' +
      '</div>' +
      '<div class="qz-opts">' + opts.map(c => '<button class="qz-opt" data-cid="' + U.esc(c.id) + '">' + U.esc(c.name) + '</button>').join('') + '</div>';
    $$('#quizWrap .qz-opt').forEach(function (b) { b.onclick = function () { answerQuiz(b.dataset.cid); }; });
  }

  function answerQuiz(cid) {
    const qz = quiz; if (!qz || qz.answered || !qz.q) return;
    qz.answered = true;
    const right = cid === qz.q.ans.id;
    $$('#quizWrap .qz-opt').forEach(function (b) {
      b.disabled = true;
      if (b.dataset.cid === qz.q.ans.id) b.classList.add('right');
      else if (b.dataset.cid === cid) b.classList.add('wrong');
    });
    if (right) { qz.correct++; TFT.UI.toast('✓ 正确：' + qz.q.ans.name, 'ok', 900); }
    else { qz.wrong++; TFT.UI.toast('✗ 正确答案：' + qz.q.ans.name, 'err', 1500); }
    qz.idx++;
    setTimeout(nextQuiz, right ? 420 : 880);
  }

  Main.openCardQuiz = function () {
    const pool = D.champions().filter(c => c.icon);
    if (pool.length < 8) {
      TFT.UI.toast('当前赛季带图标的棋子不足 8 个，无法开始认卡竞速（可切换赛季后重试）', 'warn', 3600);
      return;
    }
    quiz = { pool: pool, total: 20, idx: 0, correct: 0, wrong: 0, q: null, answered: false, start: Date.now() };
    TFT.UI.modal({ title: '认卡竞速 · 20 题', body: '<div id="quizWrap"></div>' });
    nextQuiz();
  };

  /* ==================== URL 分享链接 ==================== */
  Main.copyShareLink = function () {
    const snap = S.serialize('shared', 'share');
    const json = JSON.stringify(snap);
    let b64;
    try { b64 = btoa(unescape(encodeURIComponent(json))); }
    catch (e) { TFT.UI.toast('棋盘太大，无法生成链接（>64KB）', 'err'); return; }
    const safe = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const base = location.origin + location.pathname;
    const url = base + '#app&s=' + safe;

    const fallback = function () {
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.cssText = 'position:fixed;left:-9999px;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); TFT.UI.toast('链接已复制（回退模式）', 'ok'); }
      catch (e) { TFT.UI.prompt('复制以下链接', [{ label: 'URL', value: url }]); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { TFT.UI.toast('链接已复制 · ' + url.length + ' 字符', 'ok'); },
        fallback
      );
    } else fallback();
  };

  /* ==================== 初始化 ==================== */
  function init() {
    const prefs = TFT.Store.prefs();
    S.autoMerge = prefs.autoMerge !== false;
    S.rangeOn = !!prefs.rangeToggle;

    D.setSeason(S.season);
    TFT.BoardInit();
    fillSeasonPatch();

    /* 恢复上次棋局 */
    const cur = TFT.Store.loadCurrent();
    if (cur) {
      try {
        S.loadFrom(cur.state || cur);
      } catch (e) { }
    }
    if (cur && cur.state && cur.state.season) S.season = cur.state.season;
    D.setSeason(S.season);

    fillTraitSelects();
    renderChampFilters();
    syncTopbar();
    bind();
    TFT.Drag.init();
    Main.setTab('champions');
    B.renderAll();
    TFT.AI.initChat();

    /* 检测分享链接：#app&s=BASE64，有则优先加载 */
    let overrideView = null;
    try {
      const hashRaw = location.hash.slice(1);
      const shareMatch = hashRaw.match(/(?:^|&)s=([A-Za-z0-9_-]+)/);
      if (shareMatch) {
        const b64 = shareMatch[1].replace(/-/g, '+').replace(/_/g, '/');
        const json = decodeURIComponent(escape(atob(b64)));
        const snap = JSON.parse(json);
        S.loadFrom(snap.state || snap);
        overrideView = 'app';
        TFT.UI.toast('已加载分享阵容「' + (snap.name || '未命名') + '」', 'ok', 2500);
      }
    } catch (e) { console.warn('share link decode failed:', e); }

    Main.go(overrideView || (location.hash.slice(1).split('&')[0]) || prefs.lastView || 'home');
    TFT.UI.toast('模拟器已就绪 · 赛季 ' + S.season.toUpperCase(), 'ok', 2000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(window.TFT);
