/* ============ drag.js —— 统一拖拽引擎（棋子 / 装备 / 小件），吸附对齐 + 视觉反馈 ============ */
window.TFT = window.TFT || {};
(function (TFT) {
  'use strict';
  const U = TFT.U, S = TFT.state, B = TFT.Board, D = TFT.D;
  const Drag = TFT.Drag = {};
  const MAX_ITEMS = TFT.LIMITS.MAX_ITEMS;

  let payload = null, ghost = null, startX = 0, startY = 0, moved = false, activeTarget = null;

  function ghostHTML(p) {
    if (p.type === 'champ') {
      const champ = D.champ(p.champId);
      if (!champ) return '';
      const star = p.uid ? ((S.allUnits().find(u => u.uid === p.uid) || {}).star || 1) : 1;
      return '<div class="champ-card" data-cost="' + champ.cost + '" data-star="' + star + '">' +
        '<div class="avatar-fb">' + U.esc(champ.name.slice(0, 1)) + '</div>' +
        (champ.icon ? '<img class="avatar" src="' + champ.icon + '">' : '') +
        '<div class="cost">' + champ.cost + '</div>' +
        '<div class="name">' + U.esc(champ.name) + '</div></div>';
    }
    const item = D.item(p.itemId);
    if (!item) return '';
    const url = U.iconUrl ? U.iconUrl(item) : U.itemIcon(item);
    return '<div class="item-card">' + (url ? '<img src="' + url + '">' : '<div class="it-fb">装</div>') + '</div>';
  }

  function makeGhost(p) {
    ghost = U.$('#dragGhost');
    ghost.className = 'drag-ghost ' + (p.type === 'champ' ? 'ghost-card' : 'ghost-item');
    ghost.innerHTML = ghostHTML(p);
    ghost.classList.remove('hidden');
  }
  function moveGhost(x, y) { if (ghost) { ghost.style.left = x + 'px'; ghost.style.top = y + 'px'; } }
  function killGhost() { if (ghost) { ghost.classList.add('hidden'); ghost.innerHTML = ''; } }

  function clearHighlights() {
    U.$$('.drop-ok,.drop-bad').forEach(e => e.classList.remove('drop-ok', 'drop-bad'));
    activeTarget = null;
  }

  function hitTest(x, y) {
    const t = document.elementFromPoint(x, y);
    if (!t) return {};
    return {
      node: t,
      hex: t.closest('.hex[data-zone="player"]'),
      bench: t.closest('.bench-slot'),
      sell: t.closest('#sellZone'),
      itemSlot: t.closest('.item-slot'),
      card: t.closest('.champ-card[data-uid]'),
      forgeSlot: t.closest('.forge-slot[data-slot],.forge-result'),
      libGrid: t.closest('#champList,#itemList,#forgeComponents,#ornnList'),
      board: t.closest('#board'),
      enemyHex: t.closest('.hex[data-zone="enemy"]')
    };
  }

  /* 判定 payload 对该目标的合法性，并返回高亮节点 */
  function evaluate(p, hit) {
    if (p.type === 'champ') {
      if (hit.hex) return { node: hit.hex, ok: true };
      if (hit.bench) return { node: hit.bench, ok: true };
      if (hit.sell) return { node: hit.sell, ok: true };
      if (hit.enemyHex) return { node: hit.enemyHex, ok: false, reason: '敌方半场不可放置' };
      if (hit.card) return { node: hit.card, ok: false, reason: '无效目标' };
      return { node: null, ok: false, reason: p.from === 'lib' ? '拖到棋盘或备战区' : '松开将删除该棋子' };
    }
    /* item */
    if (hit.card) {
      const items = (itemsOf(hit.card.dataset.uid) || []);
      if (p.from === 'unit' && p.uid === hit.card.dataset.uid) return { node: hit.card, ok: false, reason: '同一棋子' };
      if (items.indexOf(p.itemId) >= 0) return { node: hit.card, ok: false, reason: '该棋子已装备此装备' };
      if (items.length >= MAX_ITEMS) return { node: hit.card, ok: false, reason: '装备槽最多 3 件装备' };
      return { node: hit.card, ok: true };
    }
    if (hit.forgeSlot) return { node: hit.forgeSlot, ok: true };
    if (hit.libGrid && p.from === 'unit') return { node: hit.libGrid, ok: true };
    return { node: null, ok: p.from === 'unit' };
  }

  function itemsOf(uid) {
    const list = S.allUnits().concat(S.opponents ? [] : []);
    const u = list.find(x => x.uid === uid);
    if (u) return u.items || [];
    for (const o of S.opponents) { const ob = S.opponentBoardList(o.id).find(x => x.uid === uid); if (ob) return ob.items || []; }
    return null;
  }

  function realUnit(uid) {
    return B.allReal().find(u => u.uid === uid) || null;
  }

  /* ==================== 放置动作 ==================== */
  function placeChampFromLib(p, hit) {
    const champ = D.champ(p.champId); if (!champ) return;
    const unit = S.mkUnit(p.champId, 1);
    if (hit.hex) {
      const r = +hit.hex.dataset.r, c = +hit.hex.dataset.c;
      const exist = S.unitAt(r, c);
      if (exist) {
        const bi = S.bench.findIndex(b => !b);
        if (bi < 0) { TFT.UI.toast('该格已有棋子，且备战区已满', 'warn'); return; }
        S.bench[bi] = exist;
      }
      S.putAt(r, c, unit);
      afterPlace(unit);
      return;
    }
    if (hit.bench) {
      const i = +hit.bench.dataset.bench;
      if (S.bench[i]) { TFT.UI.toast('备战席已满，该位置已有棋子', 'warn'); return; }
      S.bench[i] = unit;
      afterPlace(unit);
      return;
    }
  }

  function afterPlace(unit) {
    B.autoMergeScan();
    const pop = S.boardList().length;
    if (pop > S.level) TFT.UI.toast('红色警告：上阵人口 ' + pop + ' 超过当前等级 ' + S.level, 'err', 3400);
    B.commit('place');
  }

  function moveChamp(p, hit) {
    const srcPos = S.findCellOf(p.uid);
    const srcBench = S.findBenchIdx(p.uid);
    const unit = srcPos ? S.unitAt(srcPos.r, srcPos.c) : (srcBench >= 0 ? S.bench[srcBench] : null);
    if (!unit) return;

    if (hit.hex) {
      const r = +hit.hex.dataset.r, c = +hit.hex.dataset.c;
      const tgt = S.unitAt(r, c);
      if (tgt && tgt.uid === unit.uid) return;
      if (srcPos) S.takeAt(srcPos.r, srcPos.c); else if (srcBench >= 0) S.bench[srcBench] = null;
      if (tgt) {
        if (srcPos) S.putAt(srcPos.r, srcPos.c, tgt);              // 棋盘内两子换位
        else { const nb = S.bench.findIndex(x => !x); if (nb >= 0) S.bench[nb] = tgt; }
      }
      S.putAt(r, c, unit);
      reconcile(unit.uid);
      return;
    }
    if (hit.bench) {
      const i = +hit.bench.dataset.bench;
      const tgt = S.bench[i];
      if (tgt && tgt.uid === unit.uid) return;
      if (srcPos) S.takeAt(srcPos.r, srcPos.c); else if (srcBench >= 0) S.bench[srcBench] = null;
      if (tgt) {
        if (srcPos) S.putAt(srcPos.r, srcPos.c, tgt);
        else { const nb = S.bench.findIndex(x => !x); if (nb >= 0) S.bench[nb] = tgt; }
      }
      S.bench[i] = unit;
      reconcile(unit.uid);
      return;
    }
    if (hit.sell) { B.sell(unit.uid); B.commit('sell'); return; }
    /* 拖出棋盘区域 → 直接删除 */
    const champ = D.champ(unit.champId);
    S.detach(unit.uid);
    TFT.UI.toast('已将该棋子拖出棋盘删除：' + (champ ? champ.name : ''), 'warn');
    B.commit('delete');
  }

  /* 放置后：手动升星（拖到同名同星棋子上触发三合一）+ 自动升星扫描 */
  function reconcile(uid) {
    let merged = false;
    const target = B.allReal().find(u => u.uid === uid);
    if (target) {
      const others = B.allReal().filter(u => u.uid !== uid && u.champId === target.champId && (u.star || 1) === (target.star || 1));
      if (others.length >= 2) { B.tryMerge(uid); merged = true; }
    }
    if (B.autoMergeScan()) merged = true;
    if (merged) TFT.UI.toast('升星合并完成', 'ok', 1600);
    B.commit('move');
  }

  function attachItem(p, hit) {
    const uid = hit.card.dataset.uid;
    const unit = realUnit(uid);
    if (!unit) return;
    if (!unit.items) unit.items = [];
    if (unit.items.indexOf(p.itemId) >= 0) { TFT.UI.toast('该棋子已装备此装备，禁止重复挂载', 'warn'); return; }
    if (unit.items.length >= MAX_ITEMS) { TFT.UI.toast('装备槽最多 3 件装备', 'warn'); return; }
    if (p.from === 'unit') { // 从其它棋子转移
      const src = realUnit(p.uid);
      if (src) { const idx = (src.items || []).indexOf(p.itemId); if (idx >= 0) src.items.splice(idx, 1); }
    }
    unit.items.push(p.itemId);
    const item = D.item(p.itemId);
    TFT.UI.toast('已为 ' + D.champ(unit.champId).name + ' 装备 ' + (item ? item.name : p.itemId), 'ok');
    B.commit('attach-item');
  }

  function detachItem(p, hit) {
    const src = realUnit(p.uid);
    if (!src) return;
    const idx = (src.items || []).indexOf(p.itemId);
    if (idx >= 0) src.items.splice(idx, 1);
    if (hit && hit.card) {
      const unit = realUnit(hit.card.dataset.uid);
      if (unit && (unit.items || []).length < MAX_ITEMS && (unit.items || []).indexOf(p.itemId) < 0) unit.items.push(p.itemId);
      else if (unit) { TFT.UI.toast('目标装备槽已满，装备已回库', 'warn'); }
    } else {
      TFT.UI.toast('装备已从棋子取下，放回素材库', 'ok');
    }
    if (TFT.Forge && TFT.Forge.refreshHistory) TFT.Forge.refreshHistory();
    B.commit('detach-item');
  }

  function dropItemToForge(p, hit) {
    if (TFT.Forge && TFT.Forge.setSlot) TFT.Forge.setSlot(+hit.forgeSlot.dataset.slot, p.itemId);
  }

  /* ==================== 事件绑定 ==================== */
  function onDown(e) {
    if (e.button !== 0) return;
    const slotEl = e.target.closest('.item-slot.filled');
    const cardEl = e.target.closest('.champ-card[data-uid]');
    const dragEl = e.target.closest('[data-drag]');
    let p = null;
    if (slotEl && cardEl) {
      p = { type: 'item', itemId: slotEl.dataset.item, from: 'unit', uid: cardEl.dataset.uid };
    } else if (dragEl && dragEl.dataset.drag === 'champ') {
      p = { type: 'champ', champId: dragEl.dataset.champ, from: dragEl.dataset.uid ? (dragEl.closest('#bench') ? 'bench' : 'board') : 'lib', uid: dragEl.dataset.uid || null };
    } else if (dragEl && dragEl.dataset.drag === 'item') {
      p = { type: 'item', itemId: dragEl.dataset.item, from: 'lib' };
    } else if (cardEl) {
      p = { type: 'champ', champId: cardEl.dataset.champ, from: cardEl.closest('#bench') ? 'bench' : 'board', uid: cardEl.dataset.uid };
    }
    if (!p) return;
    /* 仅从素材库拖出的棋子需要重置 from */
    if (p.type === 'champ' && !p.uid) p.from = 'lib';
    payload = p; moved = false; startX = e.clientX; startY = e.clientY;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  function onMove(e) {
    if (!payload) return;
    if (!moved) {
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < 5) return;
      moved = true;
      makeGhost(payload);
      if (payload.type === 'champ') {
        const src = payload.uid ? U.$('.champ-card[data-uid="' + payload.uid + '"]') : null;
        if (src) src.classList.add('dragging');
      }
      document.body.style.cursor = 'grabbing';
    }
    moveGhost(e.clientX, e.clientY);
    clearHighlights();
    const hit = hitTest(e.clientX, e.clientY);
    const res = evaluate(payload, hit);
    if (res.node) { res.node.classList.add(res.ok ? 'drop-ok' : 'drop-bad'); activeTarget = res.node; }
  }

  function onUp(e) {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    document.body.style.cursor = '';
    if (!moved || !payload) { payload = null; return; }
    const p = payload; payload = null;
    killGhost(); clearHighlights();
    U.$$('.champ-card.dragging').forEach(c => c.classList.remove('dragging'));
    const hit = hitTest(e.clientX, e.clientY);
    const res = evaluate(p, hit);

    if (p.type === 'champ') {
      if (p.from === 'lib') {
        if (!res.ok || (!hit.hex && !hit.bench)) { TFT.UI.toast(res.reason || '请拖拽到棋盘或备战区', 'warn'); return; }
        placeChampFromLib(p, hit);
      } else {
        moveChamp(p, hit);
      }
      return;
    }
    /* item */
    if (hit.card) { attachItem(p, hit); return; }
    if (hit.forgeSlot) { dropItemToForge(p, hit); return; }
    if (p.from === 'unit') { detachItem(p, hit); return; }
    if (p.from === 'lib' && !res.ok) TFT.UI.toast(res.reason || '请拖到棋子的装备槽上', 'warn');
  }

  Drag.init = function () {
    document.addEventListener('pointerdown', onDown);
    /* 阻止拖拽时选中文本 */
    document.addEventListener('dragstart', function (e) {
      if (e.target.closest('[data-drag],.champ-card,.item-card')) e.preventDefault();
    });
  };
  Drag.hitTest = hitTest;

})(window.TFT);
