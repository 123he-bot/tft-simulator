/* ============ battle_sim.js —— 战斗沙盒模拟引擎 / 战力计算器 / 对局复盘笔记 ============ */
window.TFT = window.TFT || {};
(function (TFT) {
  'use strict';
  const U = TFT.U, S = TFT.state, D = TFT.D;
  const STAR_MULT = { 1: 1, 2: 1.8, 3: 3.24 };

  /* ==================== 单位战力建模（供战斗/战力计算共用） ==================== */
  const Battle = TFT.Battle = {};

  function itemWeight(items) {
    let dps = 0, hp = 0, def = 0;
    (items || []).forEach(function (id) {
      const it = D.item(id); if (!it) return;
      if (it.recipe) { dps += 10; hp += 250; def += 10; }              // 成品
      else if ((D.items.artifacts || []).some(a => a.id === id)) { dps += 22; hp += 200; def += 20; } // 神器
      else { dps += 6; hp += 100; def += 5; }                          // 小件
    });
    return { dpsPct: dps, hp: hp, def: def };
  }

  /* 单英雄战力模型 */
  Battle.unitStats = function (unit, opts) {
    opts = opts || {};
    const c = D.champ(unit.champId);
    if (!c) return null;
    const star = unit.star || 1, m = STAR_MULT[star] || 1;
    const mods = TFT.Board.mods();
    const iw = itemWeight(unit.items);
    const hp = (c.hp || 600) * m * (1 + (mods.hpBonus || 0) / 100) + iw.hp;
    const ad = (c.ad || 50) * m * (1 + (mods.adBonus || 0) / 100);
    const ap = 100 * m * (1 + (mods.apBonus || 0) / 100);
    const as = (c.as || 0.6) * (1 + (mods.asBonus || 0) / 100);
    const armor = (c.armor || 30) + iw.def, mr = (c.mr || 30) + iw.def;
    const dpsFactor = 1 + iw.dpsPct / 100;
    const physical = ad * as * 1.25 * dpsFactor;
    const magic = ap * 0.30 * as * dpsFactor;
    const dps = physical + magic + (c.ability ? ap * 0.12 : 0);
    const ehp = hp * (1 + armor / 200 + mr / 200);
    return {
      uid: unit.uid, name: c.name, cost: c.cost, star: star, role: c.role || '', traits: c.traits || [],
      hp: Math.round(hp), ad: Math.round(ad), ap: Math.round(ap), as: +as.toFixed(2),
      armor: armor, mr: mr, range: c.range || 1, dps: Math.round(dps), ehp: Math.round(ehp),
      items: (unit.items || []).map(i => (D.item(i) || {}).name || i),
      pos: unit._pos || null, x: 0
    };
  };

  Battle.teamStats = function (list) {
    const units = list.map(u => Battle.unitStats(u)).filter(Boolean);
    const totalDps = units.reduce((s, u) => s + u.dps, 0);
    const totalEhp = units.reduce((s, u) => s + u.ehp, 0);
    const traits = U.calcTraits(list, []);
    return { units: units, dps: Math.round(totalDps), ehp: Math.round(totalEhp), traits: traits.filter(t => t.active) };
  };

  /* 距离（对手坐标镜像到 4~7 行） */
  function dist(a, b, mirrorB) {
    const pa = a.pos ? a.pos.split('-').map(Number) : [5, 3];
    const pb = b.pos ? b.pos.split('-').map(Number) : [2, 3];
    const br = mirrorB ? (7 - pb[0]) : pb[0];
    return Math.abs(pa[0] - br) + Math.abs(pa[1] - pb[1]);
  }

  /* ==================== 简易战斗模拟引擎 ==================== */
  Battle.simulate = function (listA, listB) {
    const A = Battle.teamStats(listA), Bt = Battle.teamStats(listB);
    const a = A.units.map(u => Object.assign({}, u, { hpNow: u.ehp, side: 'A' }));
    const b = Bt.units.map(u => Object.assign({}, u, { hpNow: u.ehp, side: 'B' }));
    const timeline = [], kills = [];
    let dmgA = 0, dmgB = 0, tick = 0;
    const MAX = 45;

    function alive(arr) { return arr.filter(u => u.hpNow > 0); }
    function focus(arr, self, mirror) {
      const list = alive(arr);
      if (!list.length) return null;
      return list.slice().sort(function (x, y) {
        if (x.role !== y.role) { const sx = /Tank|重装|堡壘|堡垒/i.test(x.role) ? 1 : 0, sy = /Tank|重装|堡垒/i.test(y.role) ? 1 : 0; if (sx !== sy) return sy - sx; }
        return dist(self, x, mirror) - dist(self, y, mirror);
      })[0];
    }

    while (tick < MAX && alive(a).length && alive(b).length) {
      tick++;
      const attackers = alive(a).concat(alive(b)).sort((x, y) => y.as - x.as);
      attackers.forEach(function (atk) {
        if (atk.hpNow <= 0) return;
        const foes = atk.side === 'A' ? b : a;
        if (!alive(foes).length) return;
        const tgt = focus(foes, atk, atk.side === 'A');
        if (!tgt) return;
        const dmg = Math.round(atk.dps * (1 / Math.max(0.35, atk.as)) * 0.5);
        tgt.hpNow -= dmg;
        if (atk.side === 'A') dmgA += dmg; else dmgB += dmg;
        timeline.push({ t: tick, actor: atk.uid, actorName: atk.name, target: tgt.uid, targetName: tgt.name, dmg: dmg, side: atk.side });
        if (tgt.hpNow <= 0) { tgt.hpNow = 0; kills.push({ tick: tick, killer: atk.name, target: tgt.name, side: atk.side }); }
      });
    }

    const survA = alive(a), survB = alive(b);
    const winner = survA.length && !survB.length ? 'A' : survB.length && !survA.length ? 'B' : survA.length > survB.length ? 'A' : survB.length > survA.length ? 'B' : 'draw';
    return {
      winner: winner, ticks: tick,
      A: { units: a, survivors: survA.length, dps: A.dps, ehp: A.ehp, dmg: dmgA, traits: A.traits },
      B: { units: b, survivors: survB.length, dps: Bt.dps, ehp: Bt.ehp, dmg: dmgB, traits: Bt.traits },
      kills: kills, timeline: timeline
    };
  };

  /* ==================== 战斗沙盒弹窗 ==================== */
  function miniBoard(list, mirror, idPrefix) {
    const grid = {};
    list.forEach(function (u) {
      let r, c;
      if (u.pos) { const p = u.pos.split('-').map(Number); r = p[0]; c = p[1]; } else { r = 5; c = 3; }
      const rr = mirror ? r : r - TFT.LIMITS.PLAYER_ROW_START;
      grid[rr + '-' + c] = u;
    });
    let html = '<div class="hex-board mini-board" id="' + idPrefix + '">';
    for (let r = 0; r < 4; r++) {
      html += '<div class="hex-row' + (r % 2 ? ' odd' : '') + '">';
      for (let c = 0; c < TFT.LIMITS.COLS; c++) {
        const u = grid[r + '-' + c];
        html += '<div class="hex" data-uid="' + (u ? u.uid : '') + '"><div class="cell-wrap">' +
          (u ? U.champCardHTML({ uid: u.uid, champId: u.champId, star: u.star, items: u.items }, { compact: true }) : '') +
          '</div></div>';
      }
      html += '</div>';
    }
    return html + '</div>';
  }

  Battle.openSim = function () {
    const mine = S.boardList();
    if (!mine.length) { TFT.UI.toast('请先在棋盘上摆放棋子', 'warn'); return; }
    const opps = S.opponents;
    const target = opps.find(o => o.id === S.focusOpponent) || opps[0] || null;
    const opts = opps.map(o => '<option value="' + o.id + '"' + (target && o.id === target.id ? ' selected' : '') + '>' + U.esc(o.name) + '（' + S.opponentBoardList(o.id).length + ' 人口 / ' + o.hp + ' HP）</option>').join('');
    const body =
      '<div class="m-row" style="margin-bottom:8px"><label class="lbl">对手棋盘</label>' +
      '<select class="sel sel-sm" id="simOpp">' + (opts || '<option value="">（暂无对手棋盘，请先在【对手棋盘】中添加）</option>') + '</select>' +
      '<button class="btn btn-xs btn-primary" id="simRun">开始模拟战斗</button>' +
      '<button class="btn btn-xs" id="simPlay">▶ 战斗回放</button>' +
      '<button class="btn btn-xs" id="simAskAI">让 AI 分析短板</button></div>' +
      '<div id="simResult"><div class="dim">选择对手后点击「开始模拟战斗」。简易战斗引擎按攻击速度逐帧结算、优先集火前排与最近目标。</div></div>';
    TFT.UI.modal({ title: '战斗沙盒 / 对战模拟器', size: 'wide', body: body });
    const runBtn = U.$('#simRun');
    let lastResult = null;
    runBtn.onclick = function () {
      const oid = U.$('#simOpp').value;
      const opp = S.opponents.find(o => o.id === oid);
      if (!opp) { TFT.UI.toast('无可用的对手棋盘', 'warn'); return; }
      lastResult = Battle.simulate(S.boardList(), S.opponentBoardList(opp.id));
      renderSim(lastResult, opp);
    };
    U.$('#simPlay').onclick = function () { if (lastResult) playReplay(lastResult); else TFT.UI.toast('请先运行模拟战斗', 'warn'); };
    U.$('#simAskAI').onclick = function () {
      if (!lastResult) { TFT.UI.toast('请先运行模拟战斗', 'warn'); return; }
      TFT.UI.closeModal();
      const w = lastResult.winner === 'A' ? '我方胜' : lastResult.winner === 'B' ? '我方负' : '平局';
      TFT.AI.send('战斗模拟结果：' + w + '（我方剩余 ' + lastResult.A.survivors + ' 人，对手剩余 ' + lastResult.B.survivors +
        ' 人，我方总输出 ' + lastResult.A.dmg + '，对手总输出 ' + lastResult.B.dmg + '）。请分析我的阵容短板，并给出换装备 / 调整站位 / 更换棋子的具体建议。');
    };
  };

  function renderSim(res, opp) {
    const tag = (u) => '<div class="battle-unit"><div class="avatar-fb" style="width:24px;height:24px">' + U.esc(u.name.slice(0, 1)) + '</div>' +
      '<span style="flex:1">' + U.esc(u.name) + ' <b style="color:var(--gold)">' + '★'.repeat(u.star) + '</b></span>' +
      '<span class="dim">' + (u.hpNow > 0 ? '存活' : '阵亡') + '</span>' +
      '<span style="color:#fda4af">' + Math.round(u.dps) + ' dps</span></div>';
    const w = res.winner === 'A' ? '<span style="color:var(--green)">我方胜利</span>' : res.winner === 'B' ? '<span style="color:var(--magenta)">我方失败</span>' : '<span class="dim">平局</span>';
    const html =
      '<div class="m-grid c3" style="margin-bottom:8px">' +
      '<div class="card"><h4>战斗结果</h4><div style="font-size:18px;font-weight:800">' + w + '</div>' +
      '<div class="kv"><span class="k">耗时</span><span class="v">' + res.ticks + ' 秒</span></div>' +
      '<div class="kv"><span class="k">我方存活</span><span class="v">' + res.A.survivors + ' 人</span></div>' +
      '<div class="kv"><span class="k">对手存活</span><span class="v">' + res.B.survivors + ' 人</span></div></div>' +
      '<div class="card"><h4>我方输出 / 承伤</h4>' +
      '<div class="kv"><span class="k">总输出</span><span class="v">' + U.num(res.A.dmg) + '</span></div>' +
      '<div class="kv"><span class="k">对手总输出</span><span class="v">' + U.num(res.B.dmg) + '</span></div>' +
      '<div class="bar dmg" style="margin-top:6px"><span style="width:' + Math.min(100, res.A.dmg / Math.max(1, res.A.dmg + res.B.dmg) * 100) + '%"></span></div>' +
      '<div class="dim" style="font-size:10px;margin-top:3px">我方输出占比 ' + Math.round(res.A.dmg / Math.max(1, res.A.dmg + res.B.dmg) * 100) + '%</div></div>' +
      '<div class="card"><h4>击杀统计</h4><div class="log-list" style="max-height:100px">' +
      (res.kills.length ? res.kills.map(k => '<div class="battle-unit"><span style="color:var(--cyan)">' + U.esc(k.killer) + '</span><span class="dim">击杀</span><span style="color:#fda4af">' + U.esc(k.target) + '</span><span class="dim">t' + k.tick + '</span></div>').join('') : '<div class="dim">无击杀</div>') +
      '</div></div></div>' +
      '<div class="battle-grid">' +
      '<div class="card"><h4>我方棋盘（总战力值 ' + res.A.ehp + ' 血当量 / ' + res.A.dps + ' dps）</h4>' + miniBoard(S.boardList(), false, 'simMine') + '</div>' +
      '<div class="card"><h4>对手 ' + U.esc(opp.name) + '（' + res.B.ehp + ' 血当量 / ' + res.B.dps + ' dps）</h4>' + miniBoard(S.opponentBoardList(opp.id), true, 'simOpp') + '</div>' +
      '</div>' +
      '<div class="card" style="margin-top:8px"><h4>战斗时间轴 <span class="dim" style="font-size:10px">共 ' + res.timeline.length + ' 条事件</span></h4>' +
      '<div class="log-list">' + res.timeline.slice(0, 60).map(e =>
        '<div class="log-item"><span class="dim">t' + e.t + '</span><span><b style="color:' + (e.side === 'A' ? 'var(--cyan)' : '#fda4af') + '">' + U.esc(e.actorName) + '</b> 攻击 ' + U.esc(e.targetName) + '</span><span style="color:var(--orange)">-' + U.num(e.dmg) + '</span></div>'
      ).join('') + '</div></div>';
    TFT.UI.setModalBody(html);
  }

  function playReplay(res) {
    U.$$('#simMine .hex, #simOpp .hex').forEach(h => h.classList.remove('range-hl'));
    let i = 0;
    const timer = setInterval(function () {
      if (i >= res.timeline.length) { clearInterval(timer); TFT.UI.toast('战斗回放结束', 'ok'); return; }
      const e = res.timeline[i++];
      ['#simMine', '#simOpp'].forEach(sel => U.$$(sel + ' .hex').forEach(h => h.classList.remove('range-hl')));
      [e.actor, e.target].forEach(function (uid) {
        const h = U.$('[data-uid="' + uid + '"]');
        if (h) { const hex = h.closest('.hex') || h; hex.classList.add('range-hl'); }
      });
    }, 140);
  }

  /* ==================== 战力计算器 ==================== */
  const Power = TFT.Power = {};
  Power.openCalc = function () {
    const champs = D.champions().map(c => '<option value="' + c.id + '">' + c.cost + '费 ' + U.esc(c.name) + '</option>').join('');
    const items = D.allItems().map(i => '<option value="' + i.id + '">' + U.esc(i.name) + '</option>').join('');
    const body =
      '<div class="m-grid c2">' +
      '<div class="card"><h4>单英雄 DPS / 坦度计算器</h4>' +
      '<div class="m-row" style="margin-bottom:6px"><select class="sel sel-sm" id="pcChamp">' + champs + '</select>' +
      '<select class="sel sel-sm" id="pcStar"><option value="1">1★</option><option value="2" selected>2★</option><option value="3">3★</option></select></div>' +
      '<div class="m-row" style="margin-bottom:6px"><select class="sel sel-sm" id="pcI0">' + '<option value="">装备1</option>' + items + '</select>' +
      '<select class="sel sel-sm" id="pcI1">' + '<option value="">装备2</option>' + items + '</select>' +
      '<select class="sel sel-sm" id="pcI2">' + '<option value="">装备3</option>' + items + '</select></div>' +
      '<button class="btn btn-xs btn-primary" id="pcRun">计算</button>' +
      '<div id="pcOut" class="odds-result" style="margin-top:6px">选择英雄与装备后点击计算</div></div>' +
      '<div class="card"><h4>当前阵容总战力评估</h4><div id="pcTeam"></div></div>' +
      '</div>';
    TFT.UI.modal({ title: '战力计算器', size: 'wide', body: body });
    U.$('#pcRun').onclick = function () {
      const uid = 'tmp', cid = U.$('#pcChamp').value, star = +U.$('#pcStar').value;
      const its = ['#pcI0', '#pcI1', '#pcI2'].map(s => U.$(s).value).filter(Boolean);
      const st = Battle.unitStats({ uid: uid, champId: cid, star: star, items: its });
      if (!st) return;
      const rows = [
        ['生命值（含装备/羁绊）', U.num(st.hp)], ['攻击力', U.num(st.ad)], ['法术强度', U.num(st.ap)],
        ['攻击速度', st.as], ['护甲 / 魔抗', st.armor + ' / ' + st.mr], ['攻击距离', st.range + ' 格'],
        ['预估 DPS', '<b>' + U.num(st.dps) + '</b>'], ['有效生命（坦度）', '<b>' + U.num(st.ehp) + '</b>']
      ].map(r => '<div class="kv"><span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span></div>').join('');
      U.$('#pcOut').innerHTML = rows;
    };
    const team = Battle.teamStats(S.boardList());
    const traits = team.traits;
    const tankScore = Math.min(100, Math.round(team.ehp / 120));
    const dpsScore = Math.min(100, Math.round(team.dps / 25));
    const ctrlScore = Math.min(100, Math.round(traits.length * 12 + (traits.filter(t => /神谕|魔术师|法官|灵能|海魔人/.test(t.name)).length * 10)));
    const total = Math.round(tankScore * 0.34 + dpsScore * 0.44 + ctrlScore * 0.22);
    U.$('#pcTeam').innerHTML =
      '<div class="kv"><span class="k">上阵人口</span><span class="v">' + S.boardList().length + ' / ' + S.level + '</span></div>' +
      '<div class="kv"><span class="k">激活羁绊</span><span class="v">' + traits.length + ' 个</span></div>' +
      '<div class="kv"><span class="k">总有效生命</span><span class="v">' + U.num(team.ehp) + '</span></div>' +
      '<div class="kv"><span class="k">总 DPS</span><span class="v">' + U.num(team.dps) + '</span></div>' +
      ['坦度', '输出', '控制'].map((n, i) => {
        const v = [tankScore, dpsScore, ctrlScore][i];
        return '<div class="kv"><span class="k">' + n + '评分</span><span class="v">' + v + ' / 100</span></div>' +
          '<div class="bar tank" style="margin-bottom:4px"><span style="width:' + v + '%"></span></div>';
      }).join('') +
      '<div style="text-align:center;margin-top:8px"><span style="font-size:22px;font-weight:900;background:linear-gradient(90deg,#22d3ee,#f5c542);-webkit-background-clip:text;background-clip:text;color:transparent">' + total + '</span><span class="dim"> 综合战力分</span></div>';
  };

  /* ==================== 对局复盘笔记 ==================== */
  const Review = TFT.Review = {};
  Review.open = function () {
    const notes = TFT.Store.notes();
    const stages = TFT.STAGES;
    const body =
      '<div class="m-grid c2">' +
      '<div class="card"><h4>记录本次对局关键决策</h4>' +
      '<div class="m-row" style="margin-bottom:6px"><select class="sel sel-sm" id="rvStage">' + stages.map(s => '<option value="' + s + '">' + s + '</option>').join('') + '</select>' +
      '<select class="sel sel-sm" id="rvType"><option>D牌</option><option>拉人口</option><option>选秀装备</option><option>海克斯选择</option><option>站位调整</option><option>变阵</option></select></div>' +
      '<textarea id="rvText" rows="3" placeholder="例如：4-1 升 8 人口，D 30 金币找卡莎二星，血量 62，经济保留 20"' +
      ' style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px 8px;font-size:12px;font-family:inherit"></textarea>' +
      '<div class="m-row" style="margin-top:6px"><button class="btn btn-xs btn-primary" id="rvAdd">记录</button>' +
      '<button class="btn btn-xs" id="rvAskAI">AI 全局复盘点评</button>' +
      '<button class="btn btn-xs" id="rvExport">导出复盘文本</button></div></div>' +
      '<div class="card"><h4>本局记录 <span class="dim" id="rvCount"></span></h4><div class="log-list" id="rvList"></div></div></div>';
    TFT.UI.modal({ title: '对局复盘笔记面板', size: 'wide', body: body });
    function render() {
      const list = TFT.Store.notes();
      U.$('#rvCount').textContent = '共 ' + list.length + ' 条';
      U.$('#rvList').innerHTML = list.length ? list.map(n =>
        '<div class="log-item"><span style="color:var(--gold)">' + U.esc(n.stage) + ' · ' + U.esc(n.type) + '</span>' +
        '<span>' + U.esc(n.text) + '</span><span class="dim">' + U.esc(n.time) + ' <span style="cursor:pointer;color:var(--magenta)" data-del="' + n.id + '">删除</span></span></div>'
      ).join('') : '<div class="dim">暂无记录，先从 1-1 开始记录你的关键决策吧</div>';
      U.$$('#rvList [data-del]').forEach(b => b.onclick = function () { TFT.Store.deleteNote(b.dataset.del); render(); });
    }
    render();
    U.$('#rvAdd').onclick = function () {
      const text = U.$('#rvText').value.trim();
      if (!text) { TFT.UI.toast('请输入记录内容', 'warn'); return; }
      TFT.Store.addNote({ id: U.uid('n'), stage: U.$('#rvStage').value, type: U.$('#rvType').value, text: text, time: new Date().toLocaleTimeString('zh-CN') });
      U.$('#rvText').value = ''; render(); TFT.UI.toast('已记录', 'ok');
    };
    U.$('#rvAskAI').onclick = function () {
      const list = TFT.Store.notes();
      TFT.UI.closeModal();
      TFT.AI.send('请做整局对局复盘：以下是本局我记录的关键决策与当前对局状态，请指出操作失误与优化方向。\n\n【复盘笔记】\n' +
        (list.length ? list.map(n => '- ' + n.stage + ' [' + n.type + '] ' + n.text).join('\n') : '（暂无记录）'));
    };
    U.$('#rvExport').onclick = function () {
      const list = TFT.Store.notes();
      const st = S.serialize('复盘', 'review');
      const txt = '# 金铲铲 AI 阵容模拟器 · 对局复盘\n\n生成时间：' + new Date().toLocaleString('zh-CN') +
        '\n赛季：' + st.season + '  补丁：' + st.patch +
        '\n等级 ' + st.player.level + ' / 金币 ' + st.player.gold + ' / 血量 ' + st.player.hp + ' / 回合 ' + st.player.stage +
        '\n\n## 关键决策记录\n' + (list.length ? list.map(n => '- [' + n.stage + '][' + n.type + '] ' + n.text + '  （' + n.time + '）').join('\n') : '（无）') +
        '\n\n## 当前棋盘\n' + st.board.map(b => '- ' + b.name + ' ' + '★'.repeat(b.star) + ' @ ' + b.row + ',' + b.col + ' | ' + b.items.map(i => i.name).join('、')).join('\n') +
        '\n\n## 激活羁绊\n' + st.activeTraits.map(t => '- ' + t.name + '（' + t.count + '）').join('\n');
      TFT.Store.download('tft-review-' + Date.now() + '.txt', txt, 'text/plain;charset=utf-8');
      TFT.UI.toast('复盘文本已导出', 'ok');
    };
  };

})(window.TFT);
