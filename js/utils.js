/* ============ utils.js —— 通用工具、设计约定常量、UI 基础设施（Toast/Tooltip/Modal） ============ */
window.TFT = window.TFT || {};
(function (TFT) {
  'use strict';

  /* ---------- 通用帮助函数 ---------- */
  const U = TFT.U = {};

  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  U.el = function (tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  let _seq = 0;
  U.uid = function (p) { return (p || 'u') + '_' + Date.now().toString(36) + '_' + (++_seq).toString(36); };
  U.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  U.clone = (o) => JSON.parse(JSON.stringify(o));
  U.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };
  U.pct = (v, d) => (Number(v) || 0).toFixed(d == null ? 1 : d) + '%';
  U.num = (v) => (Number(v) || 0).toLocaleString('zh-CN');
  U.debounce = function (fn, ms) {
    let t; return function () { const a = arguments, s = this; clearTimeout(t); t = setTimeout(() => fn.apply(s, a), ms || 200); };
  };

  /* ---------- 设计约定：颜色/尺寸 ---------- */
  U.COST_COLOR = { 1: '#94a3b8', 2: '#22c55e', 3: '#3b82f6', 4: '#a855f7', 5: '#f59e0b' };
  U.POOL_PER_CHAMP = { 1: 30, 2: 25, 3: 18, 4: 10, 5: 9 }; // 每名英雄的牌池总张数（需求规范）
  U.EXP_TO_NEXT = { 1: 2, 2: 2, 3: 6, 4: 10, 5: 20, 6: 36, 7: 56, 8: 80, 9: 0 };
  U.LEVEL_MAX_DEFAULT = 9;
  U.ODDS = {
    1: [100, 0, 0, 0, 0], 2: [100, 0, 0, 0, 0], 3: [75, 25, 0, 0, 0],
    4: [55, 30, 15, 0, 0], 5: [45, 33, 20, 2, 0], 6: [30, 40, 25, 5, 0],
    7: [19, 35, 35, 10, 1], 8: [18, 25, 32, 22, 3], 9: [10, 20, 25, 35, 10],
    10: [5, 10, 20, 40, 25], 11: [1, 2, 12, 50, 35]
  };
  /* 商店 5 格 × 各费用基础概率 */
  U.rollOdds = function (level) { return (U.ODDS[level] || U.ODDS[9]).slice(); };

  /* 升级所需经验（从当前等级升到下一级） */
  U.expToNext = function (level, extraMax) {
    const lv = U.clamp(level, 1, (extraMax || 9));
    return U.EXP_TO_NEXT[lv] || 0;
  };

  /* ---------- 图片地址 ---------- */
  U.iconBase = 'https://raw.communitydragon.org/latest/game/';
  U.itemIcon = function (item) {
    if (!item || !item.icon) return null;
    const ic = item.icon;
    if (/^(https?:)?\/\//.test(ic) || ic.indexOf('assets/') === 0) return ic; // 已是完整 URL 或本地相对路径
    return (TFT.D && TFT.D.items && TFT.D.items.iconBase ? TFT.D.items.iconBase : U.iconBase) + ic;
  };
  U.traitIcon = (t) => (t && t.icon) || null;
  U.champIcon = (c) => (c && c.icon) || null;
  U.champSplash = (c) => (c && (c.splash || c.icon)) || null;

  /* ---------- Markdown 渲染（marked + DOMPurify） ---------- */
  U.md = function (text) {
    if (!text) return '';
    try {
      const raw = (window.marked && window.marked.parse) ? window.marked.parse(text, { breaks: true, gfm: true }) : U.esc(text).replace(/\n/g, '<br>');
      return window.DOMPurify ? window.DOMPurify.sanitize(raw, { ADD_TAGS: ['table', 'thead', 'tbody', 'tr', 'th', 'td'] }) : raw;
    } catch (e) { return U.esc(text); }
  };

  /* ---------- 棋子卡片 HTML（棋盘/备战区/棋子库共用） ---------- */
  /**
   * unit: { uid, champId, star, items:[itemId|null x<=3] }
   * opts: { compact, pool, showPool, extraCls, cardClass }
   */
  U.champCardHTML = function (unit, opts) {
    opts = opts || {};
    const champ = TFT.D.champ(unit.champId);
    if (!champ) return '<div class="champ-card"><div class="avatar-fb">?</div></div>';
    const star = U.clamp(unit.star || 1, 1, 3);
    const starTxt = ['', '★', '★★', '★★★'][star];
    const items = (unit.items || []).slice(0, 3);
    while (items.length < 3) items.push(null);
    const slots = items.map(it => {
      if (!it) return '<div class="item-slot"></div>';
      const item = TFT.D.item(it);
      const url = U.itemIcon(item);
      return '<div class="item-slot filled" data-item="' + U.esc(it) + '">' +
        (url ? '<img src="' + url + '" alt="' + U.esc(item ? item.name : it) + '">' : '<span class="it-fb">装</span>') + '</div>';
    }).join('');
    const poolBadge = opts.showPool ? '<div class="pool-badge">' + (opts.pool == null ? '' : opts.pool) + '</div>' : '';
    const cls = 'champ-card' + (opts.compact ? ' compact' : '') + (opts.cardClass ? ' ' + opts.cardClass : '');
    return '<div class="' + cls + '" data-uid="' + U.esc(unit.uid) + '" data-champ="' + U.esc(unit.champId) + '" data-cost="' + champ.cost + '" data-star="' + star + '" draggable="false">' +
      '<div class="avatar-fb">' + U.esc(champ.name.slice(0, 1)) + '</div>' +
      (champ.icon ? '<img class="avatar" src="' + U.champIcon(champ) + '" alt="' + U.esc(champ.name) + '">' : '') +
      '<div class="cost">' + champ.cost + '</div>' +
      '<div class="items">' + slots + '</div>' +
      '<div class="stars">' + starTxt + '</div>' +
      '<div class="name">' + U.esc(champ.name) + '</div>' + poolBadge +
      '</div>';
  };

  /* ---------- 羁绊计算（棋盘 + 备战区 + 转职装备） ---------- */
  U.calcTraits = function (board, bench) {
    const counts = {};   // traitName -> { count, units:[] }
    const bump = function (name, src, emblem) {
      if (!name) return;
      if (!counts[name]) counts[name] = { name: name, count: 0, units: [], emblems: 0 };
      counts[name].count += 1;
      if (emblem) counts[name].emblems += 1;
      else counts[name].units.push(src);
    };
    const scan = function (list) {
      list.forEach(function (u, i) {
        const c = TFT.D.champ(u.champId);
        if (!c) return;
        (c.traits || []).forEach(function (t) { bump(t, c.name, false); });
        (u.items || []).forEach(function (it) {
          const item = TFT.D.item(it);
          if (item && item.emblemTrait) bump(item.emblemTrait, c.name, true);
        });
      });
    };
    scan(board);
    scan(bench);

    const traits = TFT.D.traits();
    const out = [];
    Object.keys(counts).forEach(function (name) {
      const info = counts[name];
      const def = traits.find(t => t.name === name);
      let level = null, nextMin = null, nextActive = null;
      if (def && def.levels && def.levels.length) {
        def.levels.forEach(function (lv) { if (info.count >= lv.min) level = lv; });
        const up = def.levels.filter(lv => lv.min > info.count).sort((a, b) => a.min - b.min)[0];
        if (up) nextMin = up.min;
      }
      out.push({
        name: name, count: info.count, emblems: info.emblems, def: def || null,
        level: level, active: !!level,
        nextMin: nextMin, needMore: nextMin != null ? nextMin - info.count : 0
      });
    });
    out.sort(function (a, b) {
      if (a.active !== b.active) return a.active ? -1 : 1;
      const sa = a.level ? (a.level.style || 3) : 0, sb = b.level ? (b.level.style || 3) : 0;
      if (sb !== sa) return sb - sa;
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, 'zh');
    });
    return out;
  };

  /* 风格 -> 档位颜色 key */
  U.styleKey = function (level, def) {
    if (!level) return 'off';
    const s = level.style;
    if (s >= 4) return 'prismatic';
    if (s === 3) return 'gold';
    if (s === 2) return 'silver';
    return 'bronze';
  };

  /* ---------- 牌池剩余统计 ---------- */
  U.poolStatus = function () {
    const res = {};
    TFT.D.champions().forEach(function (c) { res[c.id] = U.POOL_PER_CHAMP[c.cost] || 0; });
    const consume = function (list) {
      list.forEach(function (u) {
        if (!u || !u.champId) return;
        const c = TFT.D.champ(u.champId); if (!c) return;
        if (res[c.id] != null) res[c.id] -= (u.star || 1);
      });
    };
    consume(TFT.state.boardList());
    consume(TFT.state.bench || []);
    (TFT.state.opponents || []).forEach(function (o) {
      consume(TFT.state.opponentBoardList(o.id));
    });
    Object.keys(res).forEach(function (k) { res[k] = Math.max(0, res[k]); });
    return res;
  };

  /* ---------- 搜索高亮 ---------- */
  U.mark = function (text, q) {
    const t = String(text == null ? '' : text);
    if (!q) return U.esc(t);
    const i = t.toLowerCase().indexOf(String(q).toLowerCase());
    if (i < 0) return U.esc(t);
    return U.esc(t.slice(0, i)) + '<b>' + U.esc(t.slice(i, i + q.length)) + '</b>' + U.esc(t.slice(i + q.length));
  };

  /* ==================== UI 基础设施 ==================== */
  const UI = TFT.UI = {};

  /* Toast */
  UI.toast = function (msg, kind, ms) {
    const root = U.$('#toastRoot'); if (!root) return;
    const t = U.el('div', 'toast ' + (kind || ''), msg);
    root.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .25s, transform .25s';
      t.style.opacity = '0'; t.style.transform = 'translateX(20px)';
      setTimeout(() => t.remove(), 260);
    }, ms || 2600);
  };

  /* Tooltip（延迟 300ms 弹出，移出立刻关闭） */
  let tipTimer = null;
  UI.showTip = function (html, x, y) {
    const tip = U.$('#tooltip'); if (!tip) return;
    tip.innerHTML = html; tip.classList.remove('hidden');
    const r = tip.getBoundingClientRect();
    let px = x + 14, py = y + 8;
    if (px + r.width > window.innerWidth - 8) px = x - r.width - 12;
    if (py + r.height > window.innerHeight - 8) py = Math.max(8, y - r.height - 10);
    tip.style.left = px + 'px'; tip.style.top = py + 'px';
  };
  UI.hideTip = function () {
    const tip = U.$('#tooltip'); if (tip) tip.classList.add('hidden');
    if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
  };
  UI.bindTip = function (el, htmlFn) {
    el.addEventListener('mouseenter', function (e) {
      const x = e.clientX, y = e.clientY;
      if (tipTimer) clearTimeout(tipTimer);
      tipTimer = setTimeout(function () {
        try { const h = typeof htmlFn === 'function' ? htmlFn() : htmlFn; if (h) UI.showTip(h, x, y); } catch (err) { }
      }, 300);
    });
    el.addEventListener('mousemove', function (e) {
      const tip = U.$('#tooltip');
      if (tip && !tip.classList.contains('hidden')) UI.showTip(tip.innerHTML, e.clientX, e.clientY);
    });
    el.addEventListener('mouseleave', UI.hideTip);
    el.addEventListener('click', UI.hideTip);
  };

  /* 弹窗：一次只能打开一个主弹窗；遮罩点击关闭；ESC 关闭 */
  let modalCloseCb = null;
  UI.modal = function (opts) {
    const root = U.$('#modalRoot');
    const box = U.$('#modalBox');
    U.$('#modalTitle').innerHTML = opts.title || '';
    U.$('#modalBody').innerHTML = opts.body || '';
    box.className = 'modal-box' + (opts.size === 'wide' ? ' wide' : opts.size === 'narrow' ? ' narrow' : '');
    root.classList.remove('hidden');
    modalCloseCb = opts.onClose || null;
    const body = U.$('#modalBody');
    if (typeof opts.after === 'function') opts.after(body);
    return body;
  };
  /* 图表统一管理：避免重复打开弹窗时 Canvas is already in use / 实例泄漏 */
  UI.charts = [];
  UI.chart = function (canvas, cfg) {
    if (!canvas || !window.Chart) return null;
    const c = new window.Chart(canvas, cfg);
    UI.charts.push(c);
    return c;
  };
  UI.destroyCharts = function () {
    UI.charts.splice(0).forEach(function (c) { try { c.destroy(); } catch (e) { } });
  };
  UI.closeModal = function () {
    const root = U.$('#modalRoot'); if (!root || root.classList.contains('hidden')) return;
    UI.destroyCharts();
    root.classList.add('hidden');
    U.$('#modalBody').innerHTML = '';
    if (modalCloseCb) { const cb = modalCloseCb; modalCloseCb = null; cb(); }
  };
  UI.modalOpen = () => !U.$('#modalRoot').classList.contains('hidden');
  UI.setModalBody = function (html) { U.$('#modalBody').innerHTML = html; };

  /* 二次确认 */
  UI.confirm = function (title, text, onYes, yesLabel, danger) {
    UI.modal({
      title: title, size: 'narrow',
      body: '<div style="font-size:12px;line-height:1.7;color:var(--dim)">' + text + '</div>' +
        '<div class="m-row" style="justify-content:flex-end;margin-top:14px">' +
        '<button class="btn" data-close="1">取消</button>' +
        '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" id="confirmYes">' + (yesLabel || '确认') + '</button></div>',
      after: function (body) {
        body.querySelector('#confirmYes').onclick = function () { UI.closeModal(); onYes && onYes(); };
      }
    });
  };

  /* 简易输入弹窗 */
  UI.prompt = function (title, fields, onOk) {
    const inputs = fields.map(function (f, i) {
      return '<label style="display:block;margin-bottom:8px"><span style="font-size:11px;color:var(--mute)">' + U.esc(f.label) + '</span>' +
        (f.type === 'textarea'
          ? '<textarea data-i="' + i + '" rows="3" style="width:100%">' + U.esc(f.value || '') + '</textarea>'
          : '<input data-i="' + i + '" type="text" value="' + U.esc(f.value || '') + '" placeholder="' + U.esc(f.ph || '') + '" style="width:100%">') +
        '</label>';
    }).join('');
    UI.modal({
      title: title, size: 'narrow',
      body: '<div class="prompt-fields">' + inputs + '</div>' +
        '<div class="m-row" style="justify-content:flex-end;margin-top:12px">' +
        '<button class="btn" data-close="1">取消</button>' +
        '<button class="btn btn-primary" id="promptOk">确定</button></div>',
      after: function (body) {
        const elems = U.$$('[data-i]', body);
        elems.forEach(function (e) {
          e.style.cssText += 'background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px 8px;font-size:12px;font-family:inherit;outline:none';
        });
        body.querySelector('#promptOk').onclick = function () {
          const vals = elems.map(e => e.value.trim());
          UI.closeModal();
          onOk && onOk(vals);
        };
        if (elems[0]) elems[0].focus();
      }
    });
  };

  /* 关闭按钮/遮罩 统一委托 */
  document.addEventListener('click', function (e) {
    const t = e.target.closest('[data-close]');
    if (t && U.$('#modalRoot') && !U.$('#modalRoot').classList.contains('hidden')) UI.closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && UI.modalOpen()) { UI.closeModal(); e.stopPropagation(); }
  }, true);

  /* 图片加载失败 => 显示背后的兜底块 */
  document.addEventListener('error', function (e) {
    const t = e.target;
    if (t && t.tagName === 'IMG') { t.style.visibility = 'hidden'; }
  }, true);

})(window.TFT);
