/* ============ ai_api.js —— AI 多智能体对话：真实数据上下文注入 + CrewAI 接口预留 + 本地多智能体推理 ============ */
window.TFT = window.TFT || {};
(function (TFT) {
  'use strict';
  const U = TFT.U, S = TFT.state, D = TFT.D, B = TFT.Board;

  const AI = TFT.AI = {};
  const AGENTS = ['经济分析师', '装备顾问', '站位教练', '阵容变速师', '卡池精算师'];

  /* ==================== 真实数据辅助（全部来自官方爬取数据） ==================== */
  function rankedComps() {
    const list = [];
    const tiers = (D.meta && D.meta.tiers) || {};
    Object.keys(tiers).forEach(t => (tiers[t] || []).forEach(cp => list.push({ cp: cp, tier: t })));
    list.sort((a, b) => (a.cp.strength == null ? 9 : a.cp.strength) - (b.cp.strength == null ? 9 : b.cp.strength));
    list.forEach((x, i) => { x.rank = i + 1; });
    return list;
  }
  function compName(cp) { return String((cp && cp.name) || '').replace(/·\d{4,}$/, ''); }
  function strengthTxt(s) {
    if (s == null) return '—';
    if (s <= 4) return s + '（T1 强势）';
    if (s <= 4.4) return s + '（T2 稳健）';
    return s + '（T3 需运营）';
  }
  function fmtStar(n) { return '★'.repeat(U.clamp(n || 1, 1, 3)); }
  /* 清理官方技能描述里残留的占位符（如「— ()」「50%%」），保证回答可读、正确 */
  function cleanAbility(s) {
    return String(s || '')
      .replace(/—\s*\([^)]*\)/g, '')
      .replace(/\(\s*\)/g, '')
      .replace(/—+/g, '')
      .replace(/%%/g, '%')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /* 当前赛季羁绊阈值（真实数据） */
  function traitDefs() { return D.traits() || []; }
  function traitMins(def) { return (def && def.levels ? def.levels.map(l => l.min).filter(m => m) : []).join(' / '); }
  function champsOfTrait(name) {
    return D.champions().filter(c => (c.traits || []).indexOf(name) >= 0).map(c => c.name + '（' + c.cost + '费）');
  }
  function findTrait(kw) { return traitDefs().find(t => t.name === kw || t.name.indexOf(kw) >= 0) || null; }
  function findChamp(kw) {
    if (!kw) return null;
    return D.champByName(kw) || D.champions().find(c => c.name.indexOf(kw) >= 0) || null;
  }
  function findItem(kw) {
    if (!kw) return null;
    const cur = D.allItems().find(i => i.name === kw || i.name.indexOf(kw) >= 0);
    if (cur) return cur;
    return (D.officialItems() || []).find(i => i.name === kw || i.name.indexOf(kw) >= 0) || null;
  }
  function augmentCatalog() { return D.augmentList() || []; }
  function src() { return D.sourceInfo() || {}; }

  /* ---- 实体识别：从玩家输入里直接抽取棋子 / 羁绊 / 装备 / 海克斯（长名优先） ---- */
  function scanBy(list, q) {
    let best = null;
    (list || []).forEach(function (x) {
      const n = x && x.name;
      if (n && n.length >= 2 && q.indexOf(n) >= 0 && (!best || n.length > best.name.length)) best = x;
    });
    return best;
  }
  function scanChamp(q) { return scanBy(D.champions(), q); }
  function scanTrait(q) { return scanBy(D.traits(), q); }
  function scanItem(q) { return scanBy((D.officialItems() || []).concat(D.allItems() || []), q); }
  function scanAugment(q) { return scanBy(augmentCatalog(), q); }
  function onlyEntity(qn, e) { return e && qn.length <= (e.name || '').length + 3; }

  /* ---- 跨赛季识别：聚合某对象存在于哪些赛季（同名聚合所有赛季） ---- */
  function scanAcross(listNames, q) {
    const map = {};
    (D.SEASON_ORDER || []).forEach(function (slug) {
      const d = D.raw[slug]; if (!d) return;
      listNames(d).forEach(function (name) {
        if (name && name.length >= 2 && q.indexOf(name) >= 0) (map[name] = map[name] || []).push(slug);
      });
    });
    const names = Object.keys(map).sort((a, b) => b.length - a.length);
    return names.length ? [{ name: names[0], slugs: map[names[0]] }] : [];
  }
  function scanChampAcross(q) { return scanAcross(d => (d.champions || []).map(c => c.name), q); }
  function scanTraitAcross(q) { return scanAcross(d => (d.traits || []).map(t => t.name), q); }
  function scanAugmentAcross(q) { return scanBy(D.augmentsFull || [], q); }
  function scanItemAcross(q) { return scanBy(D.itemsFull || [], q); }

  /* ==================== 上下文打包（每次提问自动携带完整对局 JSON + 真实元数据） ==================== */
  AI.buildContext = function () {
    const snap = S.serialize('AI 上下文', 'chat-context');
    const mods = B.mods();
    const pool = U.poolStatus();
    const mine = S.boardList();
    const onBoard = mine.map(function (u) {
      const c = D.champ(u.champId);
      return {
        name: c.name, cost: c.cost, star: u.star, pos: [ +u._pos.split('-')[0], +u._pos.split('-')[1] ],
        items: (u.items || []).map(i => (D.item(i) || {}).name || i),
        traits: c.traits, range: c.range, role: c.role, hp: c.hp, ad: c.ad,
        poolRemaining: pool[c.id]
      };
    });
    const focus = S.opponents.find(o => o.id === S.focusOpponent) || S.opponents[0] || null;
    return {
      schema: 'tft-copilot/context@1',
      season: S.season, patch: S.patch,
      player: snap.player,
      augments: snap.augments,
      augmentEffects: mods,
      activeTraits: snap.activeTraits,
      inactiveNearTraits: snap.inactiveTraits,
      board: onBoard,
      bench: snap.bench,
      poolRemaining: snap.poolRemaining,
      opponents: snap.opponents,
      craftLog: snap.craftLog,
      economy: {
        gold: S.gold, interest: B.interestOf(S.gold), interestCap: mods.interestCap,
        streak: S.streak, level: S.level, hp: S.hp, stage: S.stage,
        population: mine.length, maxPopulation: S.level
      },
      focusedOpponent: focus ? focus.name : null,
      /* ---- 真实元数据（来自官方爬取 / MetaTFT 真实对线强度） ---- */
      metaTop: rankedComps().slice(0, 15).map(function (x) {
        return {
          rank: x.rank, tier: x.tier, name: compName(x.cp), mainC: x.cp.mainC, strength: x.cp.strength,
          units: (x.cp.units || []).map(u => u.name), traits: (x.cp.traits || []).map(t => t.name + t.active)
        };
      }),
      metaCount: rankedComps().length,
      dataSource: {
        provider: src().source || 'Riot CommunityDragon（官方）', fetchedAt: src().fetchedAt || null,
        augments: AI.catalog().augments, items: AI.catalog().items,
        seasonChampions: D.champions().length, seasonTraits: D.traits().length
      },
      notes: TFT.Store.notes().slice(0, 20)
    };
  };

  AI.catalog = function () {
    const s = src();
    const slug = D.currentSlug;
    const per = (s.perSet && s.perSet[slug]) || {};
    return {
      augments: (s.counts && s.counts.augments) || augmentCatalog().length,
      items: (s.counts && s.counts.items) || (D.officialItems() || []).length,
      seasonAugments: augmentCatalog().length,
      seasonItems: (D.officialItems() || []).length,
      seasonChampions: D.champions().length,
      seasonTraits: D.traits().length,
      perSet: per
    };
  };

  /* ==================== 聊天记录渲染 ==================== */
  AI.push = function (role, content, meta) {
    S.chat.push(Object.assign({ role: role, content: content, time: new Date().toLocaleTimeString('zh-CN') }, meta || {}));
    if (S.chat.length > 120) S.chat = S.chat.slice(-120);
  };

  AI.render = function () {
    const log = U.$('#chatLog'); if (!log) return;
    log.innerHTML = S.chat.map(function (m) {
      const agents = m.agents ? '<div class="agents">' + m.agents.map(a => '<span class="agent-tag' + (a === m.active ? ' active' : '') + '">' + U.esc(a) + '</span>').join('') + '</div>' : '';
      const who = m.role === 'user' ? '你' : m.role === 'sys' ? '系统' : 'AI 多智能体';
      const body = m.role === 'ai' ? U.md(m.content) : U.esc(m.content).replace(/\n/g, '<br>');
      return '<div class="msg ' + m.role + '">' + agents + '<div class="who">' + who + ' · ' + U.esc(m.time) + '</div>' + body + '</div>';
    }).join('');
    log.scrollTop = log.scrollHeight;
  };

  AI.updateCtxBadge = function () {
    const el = U.$('#ctxBadge'); if (!el) return;
    el.style.cursor = 'pointer';
    el.onclick = AI.openSettings;
    const prefs = TFT.Store.prefs();
    if (!prefs.llmKey) {
      el.textContent = '未配置大模型 · 点击设置';
      el.className = 'badge badge-warn';
      el.title = '点击配置大模型（DeepSeek / OpenAI 兼容接口）；未配置时使用本地真实数据推理';
      return;
    }
    const ctx = AI.buildContext();
    const str = JSON.stringify(ctx);
    const host = String(prefs.llmBaseUrl || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    el.textContent = (host || '大模型') + ' · ' + (prefs.llmModel || '') + ' · 上下文 ' + (str.length / 1024).toFixed(1) + ' KB';
    el.className = 'badge badge-on';
    el.title = '已接入大模型：' + (prefs.llmBaseUrl || '') + '（' + (prefs.llmModel || '') + '）\n上下文：' + ctx.board.length +
      ' 棋子 / ' + ctx.activeTraits.length + ' 激活羁绊 / ' + ctx.metaCount + ' 套真实阵容';
  };

  AI.clear = function () {
    if (AI._abort) { try { AI._abort.abort(); } catch (e) { } }
    S.chat = [];
    AI.greeting();
    AI.render();
  };

  /* ==================== 大模型接入（OpenAI 兼容接口 · 纯前端直连） ==================== */
  AI._abort = null;

  /* 系统提示词：5 位专家人设 + 输出规则 + 真实对局数据 JSON */
  AI.systemPrompt = function (ctx, persona) {
    const c = AI.catalog();
    const crew = (persona === false)
      ? '你是一名「金铲铲之战 / TFT」阵容教练。'
      : '你是「金铲铲之战 / TFT」的 AI 教练团，由 5 名专家协作组成：' + AGENTS.join('、') +
        '。请以教练团口吻综合作答，必要时标注该结论由哪位专家给出。';
    return crew + '\n' +
      '回答要求：\n' +
      '1. 用简体中文、Markdown 分点或表格作答；先给结论，再给理由与可执行步骤，结构清晰、可直接照做。\n' +
      '2. 所有结论必须基于下方【真实对局数据 JSON】推导，禁止编造棋子、羁绊、装备、海克斯或数值。\n' +
      '3. 引用数值时只能使用数据中给出的真实数值；数据未覆盖时明确说明「数据中未提供」。\n' +
      '4. 篇幅控制在 400 字以内，避免空泛套话。\n\n' +
      '当前赛季 ' + String(ctx.season).toUpperCase() + ' / 回合 ' + ctx.economy.stage + ' / ' + ctx.economy.level +
      ' 级 / ' + ctx.economy.gold + ' 金币。真实数据规模：海克斯 ' + c.augments + ' 条、装备 ' + c.items +
      ' 条、阵容库 ' + ctx.metaCount + ' 套。\n\n【真实对局数据 JSON】\n' + JSON.stringify(ctx);
  };

  /* 组装 messages：system + 最近对话（不含本次提问）+ 本次提问 */
  AI.buildMessages = function (text, ctx, persona) {
    const msgs = [{ role: 'system', content: AI.systemPrompt(ctx, persona) }];
    (S.chat || []).filter(function (m) { return m.role === 'user' || m.role === 'ai'; }).slice(-10).forEach(function (m) {
      msgs.push({ role: m.role === 'ai' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) });
    });
    msgs.push({ role: 'user', content: text });
    return msgs;
  };

  /* 规范化接口地址：既支持 Base URL，也支持直接填完整端点 */
  function chatUrl(base) {
    const u = String(base || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    if (/\/chat\/completions$/.test(u)) return u;
    if (/\/v\d+$/.test(u)) return u + '/chat/completions';
    return u + '/v1/chat/completions';
  }

  /* 直连大模型：支持 SSE 流式与非流式 */
  AI.callLLM = function (prefs, messages, opts) {
    opts = opts || {};
    const url = chatUrl(prefs.llmBaseUrl);
    if (!url) { opts.onError && opts.onError(new Error('未配置 Base URL')); return; }
    if (!prefs.llmKey) { opts.onError && opts.onError(new Error('未配置 API Key')); return; }
    const stream = opts.stream !== false && prefs.llmStream !== false;
    const ctrl = opts.signal ? null : (AI._abort = new AbortController());
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + prefs.llmKey },
      body: JSON.stringify({
        model: prefs.llmModel || 'deepseek-chat',
        messages: messages,
        stream: stream,
        temperature: (typeof prefs.llmTemp === 'number' ? prefs.llmTemp : 0.7)
      }),
      signal: opts.signal || (ctrl && ctrl.signal)
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          let msg = 'HTTP ' + res.status;
          try { const j = JSON.parse(t); msg += '：' + ((j.error && (j.error.message || j.error.code)) || j.message || ''); }
          catch (e) { if (t) msg += '：' + String(t).slice(0, 160); }
          throw new Error(msg);
        });
      }
      const ctype = res.headers.get('content-type') || '';
      if (!stream || (ctype.indexOf('event-stream') < 0 && ctype.indexOf('stream') < 0) || !res.body || !res.body.getReader) {
        return res.json().then(function (j) {
          const d = (j.choices && j.choices[0]) || {};
          const content = (d.message && d.message.content) || (d.delta && d.delta.content) || '';
          if (content && opts.onDelta) opts.onDelta(content, content);
          opts.onDone && opts.onDone(content);
        });
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder('utf-8', { stream: true });
      let buf = '', acc = '', finished = false;
      const finish = function () { if (!finished) { finished = true; opts.onDone && opts.onDone(acc); } };
      const pump = function () {
        return reader.read().then(function (r) {
          if (r.done) { finish(); return; }
          buf += dec.decode(r.value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.indexOf('data:') !== 0) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') { finish(); return; }
            try {
              const j = JSON.parse(payload);
              const d = (j.choices && j.choices[0]) || {};
              const piece = (d.delta && (d.delta.content != null ? d.delta.content : d.delta.reasoning_content)) ||
                (d.message && d.message.content) || '';
              if (piece) { acc += piece; opts.onDelta && opts.onDelta(piece, acc); }
            } catch (e) { /* 半包或非 JSON 行，忽略 */ }
          }
          return pump();
        });
      };
      return pump();
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      opts.onError && opts.onError(err);
    });
  };

  /* ==================== 大模型设置弹窗 ==================== */
  AI.openSettings = function () {
    const p = TFT.Store.prefs();
    const row = function (label, id, val, type, ph) {
      return '<label class="set-row"><span class="set-lb">' + U.esc(label) + '</span>' +
        '<input id="' + id + '" class="txt" type="' + (type || 'text') + '" value="' + U.esc(val == null ? '' : val) +
        '" placeholder="' + U.esc(ph || '') + '"></label>';
    };
    const presets = [
      { k: 'zhipu46', name: '智谱 GLM-4.6', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.6' },
      { k: 'zhipuflash', name: '智谱 Flash（免费）', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
      { k: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com', model: 'deepseek-chat' },
      { k: 'ollama', name: '本地 Ollama', base: 'http://localhost:11434/v1', model: 'qwen2.5:7b' }
    ];
    const presetHtml = '<div class="set-presets">' +
      presets.map(function (x) {
        return '<button class="btn btn-xs set-preset" data-k="' + x.k + '" data-base="' + U.esc(x.base) +
          '" data-model="' + U.esc(x.model) + '">' + U.esc(x.name) + '</button>';
      }).join('') + '</div>';
    const body = '<div class="set-form">' +
      '<div class="set-lb" style="margin-bottom:6px">快速预设</div>' + presetHtml +
      row('Base URL（OpenAI 兼容）', 'setBaseUrl', p.llmBaseUrl, 'text', 'https://api.deepseek.com') +
      row('API Key', 'setKey', p.llmKey, 'password', 'sk-...') +
      row('模型名', 'setModel', p.llmModel, 'text', 'deepseek-chat / gpt-4o-mini') +
      row('温度 temperature', 'setTemp', p.llmTemp, 'number', '0.7') +
      '<label class="set-row check"><input type="checkbox" id="setPersona"' + (p.llmPersona !== false ? ' checked' : '') +
      '><span>保持「多智能体」人设（5 位专家协作口吻）</span></label>' +
      '<div class="dim" style="margin-top:8px">API Key 仅保存在本机浏览器 localStorage，不会上传到任何服务器。未配置 Key 时自动回退本地真实数据推理。</div>' +
      '<div class="set-state" id="setState" style="margin-top:6px;font-size:12px;opacity:.75">当前状态：' + (p.llmKey ? '已接入 ' + U.esc(p.llmModel || '大模型') : '未接入（本地真实数据推理）') + '</div>' +
      '</div>' +
      '<div class="m-row" style="justify-content:space-between;margin-top:12px;gap:8px">' +
      '<button class="btn btn-xs" id="setDisable">停用大模型</button>' +
      '<span style="display:flex;gap:8px">' +
      '<button class="btn btn-xs" id="setTest">测试连接</button>' +
      '<button class="btn" data-close="1">取消</button>' +
      '<button class="btn btn-primary" id="setSave">保存</button></span></div>';

    TFT.UI.modal({
      title: '大模型设置', size: 'narrow', body: body,
      after: function (b) {
        const val = function (id) { const e = U.$('#' + id, b); return e ? String(e.value).trim() : ''; };
        const collect = function () {
          return {
            llmBaseUrl: val('setBaseUrl') || 'https://api.deepseek.com',
            llmKey: val('setKey'),
            llmModel: val('setModel') || 'deepseek-chat',
            llmTemp: U.clamp(parseFloat(val('setTemp')) || 0.7, 0, 2),
            llmPersona: !!(U.$('#setPersona', b) && U.$('#setPersona', b).checked)
          };
        };
        U.$('#setSave', b).onclick = function () {
          const patch = collect();
          TFT.Store.setPrefs(patch);
          TFT.UI.closeModal();
          AI.updateCtxBadge();
          TFT.UI.toast(patch.llmKey ? '大模型配置已保存' : '未填写 API Key，将使用本地真实数据推理', patch.llmKey ? 'ok' : 'warn');
        };
        U.$('#setDisable', b).onclick = function () {
          const had = !!TFT.Store.prefs().llmKey || !!val('setKey');
          if (!had) { TFT.UI.toast('当前已是本地推理模式', 'warn'); return; }
          TFT.Store.setPrefs({ llmKey: '' });
          const k = U.$('#setKey', b); if (k) k.value = '';
          const st = U.$('#setState', b);
          if (st) st.textContent = '当前状态：未接入（本地真实数据推理）';
          AI.updateCtxBadge();
          TFT.UI.toast('已停用大模型，改回本地真实数据推理', 'ok');
        };
        U.$('#setTest', b).onclick = function () {
          const prefs = Object.assign({}, TFT.Store.prefs(), collect());
          if (!prefs.llmKey) { TFT.UI.toast('请先填写 API Key', 'warn'); return; }
          const btn = U.$('#setTest', b); btn.disabled = true; btn.textContent = '测试中…';
          AI.callLLM(prefs, [{ role: 'user', content: 'ping' }], {
            stream: false, signal: new AbortController().signal,
            onDone: function () { btn.disabled = false; btn.textContent = '测试连接'; TFT.UI.toast('连接成功，模型可用', 'ok'); },
            onError: function (err) { btn.disabled = false; btn.textContent = '测试连接'; TFT.UI.toast('连接失败：' + err.message, 'err', 4200); }
          });
        };
        const key = U.$('#setKey', b); if (key) key.focus();
        U.$$('.set-preset', b).forEach(function (btn) {
          btn.onclick = function () {
            const baseEl = U.$('#setBaseUrl', b), modelEl = U.$('#setModel', b);
            if (baseEl) baseEl.value = btn.getAttribute('data-base');
            if (modelEl) modelEl.value = btn.getAttribute('data-model');
            U.$$('.set-preset', b).forEach(function (x) { x.classList.toggle('on', x === btn); });
            if (key) key.focus();
            TFT.UI.toast('已填入 ' + btn.textContent + '，请补 API Key 后测试连接', 'ok', 2600);
          };
        });
      }
    });
  };

  /* ==================== 发送 ==================== */
  AI.send = function (text) {
    text = (text || '').trim();
    if (!text) return;
    const prefs = TFT.Store.prefs();
    const ctx = AI.buildContext();
    /* 在推入本次提问之前组装 messages，避免重复计入本轮 user 消息 */
    const messages = prefs.llmKey ? AI.buildMessages(text, ctx, prefs.llmPersona) : null;

    AI.push('user', text);
    AI.render();
    const inputEl = U.$('#chatInput'); if (inputEl) inputEl.value = '';

    const log = U.$('#chatLog');
    const done = function (reply, agents, active) {
      AI.push('ai', reply, { agents: agents, active: active });
      AI.render();
      AI.updateCtxBadge();
      B.commit('ai');
    };

    if (prefs.llmKey) {
      /* 打断上一轮流式输出，避免旧流覆盖新气泡 */
      if (AI._abort) { try { AI._abort.abort(); } catch (e) { } }
      const bubble = U.el('div', 'msg ai typing', '<div class="who">AI 多智能体 · ' +
        U.esc(prefs.llmModel || '大模型') + ' 正在生成</div><div class="stream-body"></div>');
      log.appendChild(bubble); log.scrollTop = log.scrollHeight;
      const bodyEl = U.$('.stream-body', bubble);
      let acc = '', timer = null;
      const flush = function () { if (bodyEl) bodyEl.innerHTML = U.md(acc); log.scrollTop = log.scrollHeight; };
      const schedule = function () { if (timer) return; timer = setTimeout(function () { timer = null; flush(); }, 70); };
      const stop = function () { if (timer) { clearTimeout(timer); timer = null; } };
      const fallback = function (err) {
        TFT.UI.toast('大模型接口调用失败，已回退本地多智能体推理：' + err.message, 'warn', 3600);
        const r = AI.reason(text, ctx);
        done(r.reply + '\n\n> 注：大模型接口 `' + U.esc(prefs.llmBaseUrl || '') + '` 调用失败（' + U.esc(err.message) + '），以上为本地兜底推理。', r.agents, r.active);
      };
      AI.callLLM(prefs, messages, {
        onDelta: function (piece) { acc += piece; schedule(); },
        onDone: function (full) {
          stop();
          const reply = full || acc;
          bubble.remove();
          if (!reply) {
            TFT.UI.toast('大模型未返回内容，已回退本地多智能体推理', 'warn', 3600);
            const r = AI.reason(text, ctx);
            done(r.reply, r.agents, r.active);
            return;
          }
          done(reply, AGENTS, AGENTS[0]);
        },
        onError: function (err) { stop(); bubble.remove(); fallback(err); }
      });
    } else {
      const ph = U.el('div', 'msg ai typing', '<div class="who">AI 多智能体正在读取真实数据并推理</div>');
      log.appendChild(ph); log.scrollTop = log.scrollHeight;
      setTimeout(function () {
        ph.remove();
        const r = AI.reason(text, ctx);
        done(r.reply, r.agents, r.active);
      }, 460);
    }
  };

  /* 预留：POST 完整 JSON 到 CrewAI 多智能体接口（保留，向后兼容） */
  AI.callBackend = function (prefs, message, context) {
    const headers = { 'Content-Type': 'application/json' };
    if (prefs.apiKey) headers['Authorization'] = 'Bearer ' + prefs.apiKey;
    return fetch(prefs.apiUrl, {
      method: 'POST', headers: headers,
      body: JSON.stringify({ message: message, context: context, model: prefs.apiModel || 'tft-crew', agents: AGENTS })
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      return data.reply || data.content || data.message || (data.output ? String(data.output) : '（后端未返回可渲染内容）');
    });
  };

  /* ==================== 本地多智能体推理（基于官方真实数据） ==================== */
  function nextLevelAdvice(level, gold) {
    const expNeed = U.expToNext(level, 9);
    if (level >= 9) return '已满级，专注提升棋子质量（追二星/三星）';
    if (gold >= 50) return '存到 50 金币后一次性拉 ' + (level + 1) + ' 级（还需 ' + expNeed + ' 经验）';
    if (gold >= 30) return '先把金币补到 50 再拉 ' + (level + 1) + ' 级（还需 ' + expNeed + ' 经验）';
    return '当前金币不足以拉人口，先吃利息补经济';
  }
  function recommendItems(role, traits) {
    const key = (role || '') + (traits || []).join('');
    if (/Tank|重装|堡垒|盾|守护/.test(key)) return ['狂徒铠甲', '石像鬼石板甲', '日炎斗篷'];
    if (/AP|法|魔术师|神谕|学者/.test(key)) return ['灭世者的死亡之帽', '大天使之杖', '珠光护手'];
    if (/Assassin|刺客|狂战|决斗/.test(key)) return ['无尽之刃', '正义之手', '饮血剑'];
    if (/Ranger|狙神|射手|枪手|神射手/.test(key)) return ['无尽之刃', '最后的轻语', '巨人杀手'];
    return ['无尽之刃', '最后的轻语', '巨人杀手'];
  }
  function itemLine(name) {
    const it = findItem(name);
    if (!it) return null;
    const recipe = (it.recipeNames && it.recipeNames.length) ? it.recipeNames.join(' + ') : (it.recipe || []).map(id => (D.item(id) || {}).name || id).join(' + ');
    return '- **' + it.name + '**：' + (it.desc || it.stat || '') + (recipe ? '（合成：' + recipe + '）' : '');
  }
  function risk(lines) { return '\n**⚠️【风险预警】**\n' + lines.map(l => '- ' + l).join('\n') + '\n'; }
  function wrap(active, md, agents) { return { reply: md, agents: agents || AGENTS, active: active }; }

  AI.reason = function (q, ctx) {
    const board = ctx.board, traits = ctx.activeTraits, bench = ctx.bench;
    const gold = ctx.economy.gold, level = ctx.economy.level, hp = ctx.economy.hp, stage = ctx.economy.stage;
    const interest = ctx.economy.interest, cap = ctx.economy.interestCap;
    const traitNames = traits.map(t => t.name + '(' + t.count + ')').join('、') || '暂无激活羁绊';
    const boardTxt = board.length ? board.map(b => b.name + fmtStar(b.star) + (b.items.length ? '[' + b.items.join('+') + ']' : '')).join('、') : '（棋盘为空）';
    const head = '**当前对局**：' + String(ctx.season).toUpperCase() + ' / 回合 ' + stage + ' / ' + level + ' 级 / ' + gold + ' 金币（利息+' + interest + '，上限 ' + cap + '）/ ' + hp + ' 血量 / ' + board.length + ' 人口\n' +
      '**上阵**：' + boardTxt + '\n**羁绊**：' + traitNames + '\n';

    /* 0. 数据来源与规模 */
    if (/数据来源|爬取|抓取|多少数据|数据量|数据规模|真实性|source/i.test(q)) {
      const s = src(), c = AI.catalog();
      let md = head + '\n### 数据来源与规模（真实抓取，非人工编造）\n' +
        '- **数据源**：' + (s.source || 'Riot CommunityDragon（官方）') + '\n' +
        '- **抓取时间**：' + (s.fetchedAt || '—') + '（官方 CDN `raw.communitydragon.org` 实时抓取）\n' +
        '- **海克斯强化**：全赛季共 **' + c.augments + '** 条，当前 ' + String(ctx.season).toUpperCase() + ' 可用 **' + c.seasonAugments + '** 条\n' +
        '- **装备**：全赛季共 **' + c.items + '** 条，当前赛季可用 **' + c.seasonItems + '** 条\n' +
        '- **当前赛季棋子 / 羁绊**：**' + c.seasonChampions + '** 名棋子 / **' + c.seasonTraits + '** 个羁绊\n' +
        '- **真实阵容库**：**' + ctx.metaCount + '** 套（含主 C、站位、羁绊、对线强度）\n\n' +
        '你的每一次提问都会携带以上真实数据的当前对局快照，所有结论均基于这些真实数据推导。\n';
      return wrap('卡池精算师', md, ['卡池精算师', '阵容变速师']);
    }

    /* ---- 实体优先路由：先识别玩家点名的棋子/装备/羁绊/海克斯，避免答非所问 ---- */
    const qn = q.replace(/[?？。，、!！\s]/g, '');
    const eChamp = scanChamp(q), eTrait = scanTrait(q), eItem = scanItem(q), eAug = scanAugment(q);
    const wantsItem = /装备|出装|装什么|带什么|带啥|怎么合|合成|配方|三件套|神装|配装|出什么装/.test(q);
    const wantsChampInfo = /技能|属性|介绍|怎么样|强不强|值不值得|评价|面板|反查|哪些阵容|什么用|星级|成长|阵容|体系|搭配|羁绊/.test(q);
    const wantsTraitInfo = /羁绊|纹章|激活|多少|阈值|效果|机制|叠加|怎么|作用/.test(q);

    /* A. 指定装备（如「无尽之刃怎么合」） */
    if (eItem && wantsItem && !eChamp) {
      const it = eItem;
      let md = head + '\n### 装备查询：' + it.name + '\n' +
        (itemLine(it.name) || ('- **' + it.name + '**：' + (it.desc || it.stat || ''))) + '\n';
      if (it.recipeNames && it.recipeNames.length) md += '\n**合成路径**：' + it.recipeNames.join(' + ') + '（两件基础小件合成）\n';
      md += '\n> 想查其它装备，直接输入装备名即可。';
      return wrap('装备顾问', md, ['装备顾问', '卡池精算师']);
    }

    /* B. 指定棋子出装（如「卡尔玛怎么出装」） */
    if (eChamp && wantsItem) {
      const c = eChamp;
      const rec = recommendItems(c.role, c.traits);
      let md = head + '\n### ' + c.name + ' 出装建议（' + c.cost + ' 费 · ' + (c.role || '') + '）\n' +
        '- **羁绊**：' + (c.traits || []).join('、') + '\n' +
        '- **推荐三件套**：' + rec.join(' → ') + '\n\n### 真实合成路径（官方装备目录）\n' +
        rec.map(itemLine).filter(Boolean).join('\n') + '\n';
      md += risk(['装备要集中在主 C 身上，不要平摊给无关棋子', '转职纹章会改变羁绊统计，注意体系是否被打乱']);
      return wrap('装备顾问', md, ['装备顾问', '经济分析师']);
    }

    /* C. 指定棋子详情（如「卡尔玛」「卡尔玛怎么样」「卡尔玛属于哪些阵容」） */
    if (eChamp && (wantsChampInfo || onlyEntity(qn, eChamp))) {
      const c = eChamp;
      const comps = rankedComps().filter(x => x.cp.mainC === c.name || (x.cp.units || []).some(u => u.name === c.name));
      let md = head + '\n### 棋子详情：' + c.name + '（' + c.cost + ' 费 · ' + (c.role || '') + '）\n' +
        '- **羁绊**：' + (c.traits || []).join('、') + '\n' +
        '- **面板属性**：生命 ' + c.hp + ' / 攻击力 ' + c.ad + ' / 攻速 ' + c.as + ' / 护甲 ' + c.armor + ' / 魔抗 ' + c.mr + ' / 射程 ' + c.range + ' / 法力 ' + c.mana + '\n' +
        '- **技能**：' + (c.ability ? c.ability.name : '') + '——' + cleanAbility(c.ability ? c.ability.desc : '') + '\n' +
        '- **推荐装备**：' + recommendItems(c.role, c.traits).join(' → ') + '\n\n' +
        '### 所属阵容（真实阵容库中 ' + comps.length + ' 套）\n' +
        (comps.length ? comps.slice(0, 6).map(x => '- #' + x.rank + ' ' + compName(x.cp) + '（' + x.tier + ' 档，主 C ' + (x.cp.mainC || '-') + '）').join('\n') : '- 暂无直接匹配阵容') + '\n' +
        '\n> 可在顶部搜索框输入「' + c.name + '」查看所属阵容，或在棋子面板查看完整技能。';
      return wrap('阵容变速师', md, ['阵容变速师', '装备顾问', '卡池精算师']);
    }

    /* D. 指定羁绊详情（如「神谕者羁绊」「暗星怎么激活」） */
    if (eTrait && !eChamp && (wantsTraitInfo || onlyEntity(qn, eTrait))) {
      const t = eTrait;
      const cur = traits.find(x => x.name === t.name) || (ctx.inactiveNearTraits || []).find(x => x.name === t.name);
      let md = head + '\n### 羁绊详情：' + t.name + '\n' +
        '> ' + (t.desc || '') + '\n\n' +
        '- **激活阈值**：' + (traitMins(t) || '—') + ' 人口\n' +
        '- **归属棋子（' + champsOfTrait(t.name).length + '）**：' + champsOfTrait(t.name).join('、') + '\n' +
        '- **你当前进度**：' + (cur ? ('已上阵 ' + cur.count + ' 人口' + (cur.nextMin ? '，再补 ' + (cur.nextMin - cur.count) + ' 人口可到下一档' : '，已激活当前最高档')) : '尚未上阵该体系棋子') + '\n';
      return wrap('阵容变速师', md, ['阵容变速师', '卡池精算师']);
    }

    /* E. 指定海克斯详情（如「珠光莲花」「这个海克斯怎么选」） */
    if (eAug && (onlyEntity(qn, eAug) || /海克斯|强化|符文/.test(q))) {
      const a = eAug;
      const effTxt = (a.effects || []).map(e => e.label).join('；') || '见描述';
      const fit = (a.traits || []).filter(x => traits.map(t => t.name).indexOf(x) >= 0);
      let md = head + '\n### 海克斯详情：' + a.name + '（' + a.tier + '）\n' +
        '> ' + (a.desc || '') + '\n\n' +
        '- **真实效果数值**：' + effTxt + '\n' +
        '- **所属羁绊**：' + ((a.traits && a.traits.length) ? a.traits.join('、') : '通用') + '\n' +
        '- **与你当前体系**：' + (fit.length ? '★ 契合（' + fit.join('、') + '）' : '与当前羁绊无直接关联，按战力取舍') + '\n';
      return wrap('卡池精算师', md, ['卡池精算师', '装备顾问']);
    }

    /* 1. 阵容推荐（结合真实 Meta 梯度与当前棋盘） */
    if (/推荐.*阵容|阵容推荐|玩什么|玩哪套|上分|梯度|强势阵容|meta|怎么搭配|搭配什么|选什么阵容|该玩什么|吃鸡/i.test(q)) {
      const mine = board.map(b => b.name);
      const myTraits = traits.map(t => t.name);
      const comps = rankedComps();
      const scored = comps.map(function (x) {
        const tn = (x.cp.traits || []).map(t => t.name);
        const overlap = tn.filter(t => myTraits.indexOf(t) >= 0).length;
        const unitHit = (x.cp.units || []).filter(u => mine.indexOf(u.name) >= 0).length;
        return { x: x, overlap: overlap, unitHit: unitHit, strength: x.cp.strength == null ? 9 : x.cp.strength };
      });
      /* 优先：与当前棋盘重合度高，其次强度高 */
      scored.sort((a, b) => (b.unitHit - a.unitHit) || (b.overlap - a.overlap) || (a.strength - b.strength));
      const best = scored.slice(0, 3);
      let md = head + '\n### 一、推荐阵容（基于真实 Meta ' + comps.length + ' 套阵容的梯度与对线强度）\n' +
        '**优先推荐**（与你当前棋子/羁绊重合度最高）：\n' +
        '| 推荐 | 阵容 | 档位 | 强度 | 主 C | 核心羁绊 | 与你重合 |\n|---|---|---|---|---|---|---|\n';
      best.forEach(function (s, i) {
        md += '| ' + (i === 0 ? '★1' : '★' + (i + 1)) + ' | ' + compName(s.x.cp) + ' | ' + s.x.tier + ' | ' + strengthTxt(s.x.cp.strength) +
          ' | ' + (s.x.cp.mainC || '-') + ' | ' + (s.x.cp.traits || []).slice(0, 3).map(t => t.name + t.active).join('、') +
          ' | ' + s.unitHit + ' 枚棋子 / ' + s.overlap + ' 羁绊 |\n';
      });
      md += '\n### 二、首选阵容成型配置：' + compName(best[0].x.cp) + '\n' +
        '- **主 C**：' + (best[0].x.cp.mainC || '-') + '（优先给三件套）\n' +
        '- **成型人口**：' + (best[0].x.cp.units || []).length + ' 人口\n' +
        '- **完整棋子**：' + (best[0].x.cp.units || []).map(u => u.name + (u.star ? fmtStar(u.star) : '')).join('、') + '\n' +
        '- **关键羁绊**：' + (best[0].x.cp.traits || []).map(t => t.name + ' ' + t.active + '/' + (t.need || t.active)).join('、') + '\n\n' +
        '### 三、转型/过渡建议\n';
      if (!mine.length) md += '- 棋盘为空：先按上面主 C 的体系，在 1~2 费过渡期中凑齐 2 个活跃羁绊，再逐步替换。\n';
      else md += '- 你当前已上阵：' + mine.join('、') + '；' + (best[0].unitHit ? '其中 ' + best[0].unitHit + ' 枚可直接保留，' : '暂无可直接保留，建议') + '围绕 ' + (best[0].x.cp.mainC || '主 C') + ' 补齐其余人口。\n';
      md += '- **找阵容入口**：在顶部搜索框输入「' + compName(best[0].x.cp) + '」可查看完整阵容详情并一键加载到棋盘。\n';
      md += risk(['不要同时追多套体系，锁定一套后再补装备与海克斯', '强度榜会随补丁变化，优先看对线强度而非单纯档位']);
      return wrap('阵容变速师', md, ['阵容变速师', '卡池精算师', '装备顾问']);
    }

    /* 2. 海克斯择优（真实海克斯数据 + 与当前羁绊匹配） */
    if (/海克斯|强化|符文|择优/.test(q)) {
      const augs = ctx.augments || [];
      const catalog = augmentCatalog();
      const myTraits = traits.map(t => t.name);
      const weight = { '棱彩': 3, '金': 2, '银': 1, '特殊': 2 };
      const score = a => (weight[a.tier] || 1) * 10 + ((a.effects || []).length) * 2 + ((a.traits || []).filter(t => myTraits.indexOf(t) >= 0).length) * 6;
      const chosen = augs.map(a => ({ a: a, s: score(a) })).sort((x, y) => y.s - x.s);
      let md = head;
      if (chosen.length) {
        md += '\n### 一、你已选海克斯强度对比\n| 排名 | 海克斯 | 稀有度 | 真实效果数值 | 与当前羁绊契合 |\n|---|---|---|---|---|\n';
        chosen.forEach(function (x, i) {
          const eff = (x.a.effects || []).map(e => e.label).join('；') || '见描述';
          const fit = (x.a.traits || []).filter(t => myTraits.indexOf(t) >= 0);
          md += '| T' + (i + 1) + ' | ' + x.a.name + ' | ' + x.a.tier + ' | ' + eff + ' | ' + (fit.length ? '★ ' + fit.join('、') : '直接战力') + ' |\n';
        });
        md += '\n### 二、结论\n**最优：' + chosen[0].a.name + '**\n> ' + (chosen[0].a.desc || '') + '\n\n';
        chosen.slice(1).forEach(function (x) {
          md += '**' + x.a.name + ' 的取舍**：' + (x.a.desc || '') + '——在你的 ' + traitNames + ' 体系中收益相对偏低，建议作为备选。\n';
        });
      } else {
        md += '\n你还没有勾选海克斯强化。请切到右侧【海克斯强化】标签，从真实官方目录中最多勾选 3 个，我会立刻给出强度对比与运营规划。\n';
        /* 无选择时，按当前羁绊直接推荐真实海克斯 */
        const top = catalog.map(a => ({ a: a, s: score(a) })).sort((x, y) => y.s - x.s).slice(0, 3);
        md += '\n### 基于当前羁绊的真实海克斯推荐\n' +
          top.map((x, i) => '- **' + (i + 1) + '. ' + x.a.name + '**（' + x.a.tier + '）：' + (x.a.desc || '')).join('\n') + '\n';
      }
      md += '\n### 三、后续运营规划\n- **拉人口节点**：当前 ' + level + ' 级，' + nextLevelAdvice(level, gold) + '\n' +
        '- **D 牌规划**：' + (level >= 8 ? '8 级搜 4 费主 C 二星，一次 D 20~30 金币' : level >= 7 ? '7 级可小 D 找 3 费核心' : '先补经济，6 级前不要 D 牌') + '\n' +
        '- **变阵路线**：若主 C 不来牌，优先切换到同为 ' + (traits[0] ? traits[0].name : '相邻') + ' 体系的副 C\n';
      md += risk(['海克斯选定后不可更改，3-2 前若未成型要果断转阵', '不要在经济类海克斯上叠加需要爆发的阵容']);
      return wrap('阵容变速师', md, AGENTS.slice(0, 2));
    }

    /* 3. 装备 / 合成（真实配方与说明） */
    if (/装备|合成|出装|蓝 ?buff|无尽|火炮|泰坦|怎么合|配方|三件套/.test(q)) {
      const qItem = findItem(q.replace(/[?？。，、\s]|推荐|装备|怎么合|合成|配方|出装/g, '').trim());
      const core = board.slice().sort((a, b) => b.cost - a.cost)[0];
      let md = head;
      if (qItem && !core) {
        md += '\n### 装备查询：' + qItem.name + '\n' + itemLine(qItem.name) + '\n' + (qItem.recipeNames && qItem.recipeNames.length ? '\n**合成路径**：' + qItem.recipeNames.join(' + ') + '（两件基础小件合成）\n' : '');
        return wrap('装备顾问', md, ['装备顾问']);
      }
      if (!core) return wrap('装备顾问', head + '\n### 出装规划\n棋盘上还没有棋子，先上阵一个核心输出，我再帮你规划出装顺序与合成路径。');
      const rec = recommendItems(core.role, core.traits);
      md += '\n### 主 C：' + core.name + '（' + core.cost + ' 费 ' + fmtStar(core.star) + '，' + (core.role || '') + '）\n' +
        '**推荐三件套**：' + rec.join(' → ') + '\n\n### 真实合成路径（来自官方装备目录）\n' +
        rec.map(n => itemLine(n)).filter(Boolean).join('\n') + '\n\n### 当前装备分配\n';
      board.forEach(function (b) {
        md += '- ' + b.name + fmtStar(b.star) + '：' + (b.items.length ? b.items.join('、') : '**空槽，建议优先补装**') + '\n';
      });
      md += '\n### 选秀风险预判\n- **优先抢小件**：暴风大剑 / 反曲弓 / 拳套（对应主 C 输出装），被抢则改抢锁子甲 / 负极斗篷做防装。\n' +
        '- **装备取舍**：宁可给主 C 凑齐三件套，也不要分散给无关棋子。\n';
      md += risk(['转职纹章会改变羁绊统计，注意别打乱体系', '同一格不能重复挂载同名装备']);
      return wrap('装备顾问', md, ['装备顾问', '经济分析师']);
    }

    /* 4. 站位分析 */
    if (/站位|位置|阵型|刺客|突破|放哪|摆在|前 ?排|后 ?排|中排|C ?位/.test(q)) {
      let md = head + '\n### 一、标准站位建议（按 4×7 棋盘行列）\n' +
        '- **主 C**：放最后排中间偏角（row0 的 col2/col4），最大化输出时间\n' +
        '- **主坦**：放最前排中央（row3 的 col3），承伤并保护后排\n' +
        '- **辅助/控制**：紧随主 C 一格，避免被同一次 AOE 一起清掉\n\n' +
        '### 二、防刺客与集火预判\n- 对手有刺客类英雄时，**不要**把主 C 放角落（row0 col0/col6），刺客优先跳最远目标；把主 C 收中间并留“诱饵”。\n' +
        '- 远程集火点：对手远程 C 位通常在 row1~row2 两侧，用坦克对位卡住其推进路线。\n\n' +
        '### 三、当前阵容薄弱位置\n';
      if (board.length) {
        md += board.slice(0, 5).map(b => '- ' + b.name + '（' + (b.pos ? b.pos.join('·') : '?') + '）' + (/Tank|重装|堡垒|守卫/.test(b.role || '') ? '：前排承压位，注意别被集火秒掉' : '：后排输出位，需坦克掩护') + '\n').join('');
      } else md += '- 棋盘为空，先上阵棋子\n';
      md += '\n> 小技巧：打开棋盘右上角【攻击范围】开关，点击棋子即可可视化射程与刺客突进范围。\n';
      md += risk(['不要把两个脆皮 C 放在相邻格，容易被同一波技能清场', '刺客切入通常发生在开局 1~2 秒，注意前排站位']);
      return wrap('站位教练', md, ['站位教练', '阵容变速师']);
    }

    /* 5. 经济决策 */
    if (/经济|D ?牌|拉人口|存钱|金币|等级|升级|利息/.test(q)) {
      const need = interest < cap ? (Math.floor(gold / 10) + 1) * 10 - gold : 0;
      let md = head + '\n### 一、当前经济判断\n' +
        '- 金币 **' + gold + '**，利息 **+' + interest + '**（上限 ' + cap + '）' + (need > 0 ? '，还差 **' + need + '** 金币吃满下一档利息' : '，已吃满利息') + '\n' +
        '- 连胜/连败：**' + (ctx.economy.streak >= 0 ? '连胜 ' + ctx.economy.streak : '连败 ' + Math.abs(ctx.economy.streak)) + '**\n\n' +
        '### 二、要不要 D 牌 / 拉人口\n';
      if (level >= 8 && gold >= 40) md += '- ✅ **可以开始 D 牌**：8 级搜 4/5 费主 C，一次 D 20~30 金币，看到目标核心停手。\n';
      else if (level <= 6) md += '- ⛔ **不要 D 牌**：当前 ' + level + ' 级搜不到高费核心，应优先' + (gold >= 50 ? '吃满 50 金币利息后拉人口' : '补经济') + '。\n';
      else md += '- ⚠️ **谨慎 D 牌**：' + level + ' 级可 D 少量（10~20 金币）找核心 3 费，但不要过 20。\n';
      md += '- **拉人口节点**：' + nextLevelAdvice(level, gold) + '\n' +
        '- **当前等级真实刷新概率**：' + U.rollOdds(level).map((o, i) => (i + 1) + '费' + o + '%').filter((s, i) => U.rollOdds(level)[i] > 0).join('、') + '\n' +
        '\n### 三、存钱阈值\n- 血量 > 60：存到 **50** 金币再花；血量 < 40：提前花 20~30 金币稳血。\n';
      md += risk([gold % 10 !== 0 ? 'D 到 ' + (Math.floor(gold / 10) * 10) + ' 金币会丢失 1 点利息' : '当前金币为整十，D 牌不会立刻掉利息', '血量低于 30 应优先保血而非贪利息']);
      return wrap('经济分析师', md, ['经济分析师', '卡池精算师']);
    }

    /* 6. 追三星 */
    if (/三星|追|可行性|需要多少/.test(q)) {
      const cands = board.concat(bench).slice().sort((a, b) => (b.poolRemaining == null ? 99 : b.poolRemaining) - (a.poolRemaining == null ? 99 : a.poolRemaining));
      let md = head + '\n### 追三星可行性评估\n';
      if (!cands.length) return wrap('卡池精算师', head + '\n### 追三星可行性评估\n棋盘与备战区没有棋子，先上阵棋子后再评估。');
      const t = cands[0];
      const need = (3 - (t.star || 1)) * 3;
      const avgCost = t.star >= 2 ? t.cost * 6 : t.cost * 3;
      md += '- **建议目标**：' + t.name + '（' + t.cost + ' 费，当前 ' + fmtStar(t.star) + '）\n' +
        '- **牌池剩余**：全局还剩 **' + (t.poolRemaining == null ? '-' : t.poolRemaining) + ' / ' + U.POOL_PER_CHAMP[t.cost] + '** 张\n' +
        '- **还需张数**：约 **' + Math.max(3, need) + '** 张（' + (t.star >= 2 ? '二星→三星需 9 张' : '一星→二星需 3 张') + '）\n' +
        '- **预估投入**：约 **' + Math.round(avgCost * 2.4) + '** 金币（含 D 牌损耗）\n' +
        '- **D 牌阶段**：' + (t.cost <= 2 ? '5~6 级（低费概率最高）' : t.cost === 3 ? '7~8 级（3 费概率峰值）' : '8~9 级（4/5 费概率峰值）') + '\n' +
        '- **当前等级该费概率**：' + (U.rollOdds(level)[t.cost - 1] || 0) + '%\n\n';
      md += '### 风险提示\n- 牌池剩余 < 6 张，**放弃追三星**，转做二星 + 换副 C。\n- 同行超过 2 家时三星概率大幅下降，建议止损。\n';
      md += risk(['追三星期间不要锁血贪三星，血量低于 30 必须先保血', '三星只对 1~3 费性价比高']);
      return wrap('卡池精算师', md, ['卡池精算师', '经济分析师']);
    }

    /* 7. 8 家对手分析 */
    if (/对手|对面|对家|敌方|敌人|别人|8 ?家|八家|威胁|规避|对位/.test(q)) {
      const opps = ctx.opponents || [];
      let md = head + '\n### 8 家对局威胁分析\n';
      if (!opps.length) return wrap('阵容变速师', head + '\n### 8 家对局威胁分析\n还没有添加对手棋盘。请在顶栏【对手棋盘】中最多添加 7 个对手并摆放棋子。');
      md += '| 对手 | 血量 | 人口 | 体系 | 威胁等级 |\n|---|---|---|---|---|\n';
      const threats = opps.map(function (o) {
        const cost = (o.board || []).reduce((s, u) => s + (u.cost || 1) * (u.star || 1), 0);
        return { o: o, power: cost };
      }).sort((a, b) => b.power - a.power);
      threats.forEach(function (t, i) {
        const sys = (t.o.board || []).slice(0, 3).map(u => u.name).join('、') || '未布局';
        md += '| ' + t.o.name + ' | ' + t.o.hp + ' | ' + (t.o.board || []).length + ' | ' + sys + ' | ' + (i === 0 ? '🔴 最大威胁' : i < 3 ? '🟠 中' : '🟢 低') + ' |\n';
      });
      const top = threats[0].o;
      md += '\n### 对位策略\n- **最大威胁**：' + top.name + '（' + (top.board || []).length + ' 人口，' + top.hp + ' 血）——优先抢其核心卡与装备。\n' +
        '- **我方站位**：主坦对位其主力输出所在列；主 C 放其刺客跳不到的中间格。\n' +
        '- **优先集火**：' + ((top.board || [])[1] ? top.board[1].name : '其最高费单位') + '，拆掉核心输出再清前排。\n';
      md += risk(['最大威胁血量低于 40 时会转激进 D 牌，注意卡池被抢', '同行越多越要提前转型']);
      return wrap('阵容变速师', md, ['阵容变速师', '站位教练']);
    }

    /* 10. 复盘 */
    if (/复盘|失误|优化方向|打得|打错|这把|点评|总结/.test(q)) {
      let md = head + '\n### 本局操作复盘\n**做得好的地方**\n- 当前 ' + traits.length + ' 个激活羁绊，阵容偏向 ' + (traits[0] ? traits[0].name : '未成型') + ' 体系。\n' +
        (ctx.augments.length ? '- 海克斯已选 ' + ctx.augments.map(a => a.name).join('、') + '。\n' : '- 尚未选择海克斯，建议尽快定型。\n') +
        '\n**可能的问题**\n';
      if (board.length > level) md += '- 🚨 **人口超编**：' + board.length + ' 人口 > ' + level + ' 级，请立刻下阵。\n';
      if (gold > 60 && hp < 50) md += '- ⚠️ 金币 ' + gold + ' 偏多但血量仅 ' + hp + '，属于贪经济掉血，应提前 20 金币稳血。\n';
      if (bench.length >= 4) md += '- 备战区接近满员，注意及时合并/出售。\n';
      md += '\n**优化方向**\n- 下一阶段优先：' + nextLevelAdvice(level, gold) + '\n- 站位：打开【攻击范围】开关检查刺客跳点，把主 C 收进中间。\n';
      md += risk(['区分“运气”和“决策失误”：被切后排多为站位问题，掉血过快多为经济分配问题']);
      return wrap('阵容变速师', md, AGENTS);
    }

    /* 11. 疑似在问某个具体对象但未识别到 → 明确告知，避免答非所问 */
    if (!eChamp && !eTrait && !eItem && !eAug && qn.length <= 10 &&
      !/阵容|搭配|上分|玩|怎么|如何|吗|？|\?|站位|位置|放|摆|前 ?排|后 ?排|中排|C ?位|对位|对面|对手|对家|敌方|威胁|经济|运营|利息|人口|升级|D ?牌|刷新|存钱|三星|追|海克斯|强化|符文|装备|出装|给|合|配方|复盘|失误|打|评价|羁绊|纹章|激活|数据|来源|爬|抓取/.test(q)) {
      const cX = scanChampAcross(q), tX = scanTraitAcross(q), aX = scanAugmentAcross(q), iX = scanItemAcross(q);
      const kind = cX.length ? '棋子' : tX.length ? '羁绊' : aX ? '海克斯' : iX ? '装备' : null;
      const nm = cX.length ? cX[0].name : tX.length ? tX[0].name : aX ? aX.name : iX ? iX.name : q;
      const seas = cX.length ? cX[0].slugs.map(s => s.toUpperCase())
        : tX.length ? tX[0].slugs.map(s => s.toUpperCase())
          : aX ? (aX.sets || []).map(s => s.toUpperCase())
            : iX ? (iX.sets || []).map(s => s.toUpperCase()) : [];
      let md = head + '\n### 未在当前赛季找到\n';
      if (kind) {
        md += '- 「' + nm + '」不在当前赛季 **' + String(ctx.season).toUpperCase() + '** 的官方数据中，它实际存在于：**' + (seas.join('、') || '其它赛季') + '**。\n' +
          '- 请把顶部赛季切换到上述之一后再问一次；或直接问我当前赛季的「推荐阵容 / 海克斯择优 / 装备搭配 / 站位优化」。\n';
      } else {
        md += '- 当前赛季 **' + String(ctx.season).toUpperCase() + '** 的官方数据里没有「' + q + '」这个' + (kind || '棋子 / 羁绊 / 装备 / 海克斯') + '。\n' +
          '- 建议：① 用顶栏搜索框按名称检索确认真实名称；② 换个近似官方名称再问；③ 直接问我「推荐阵容 / 海克斯择优 / 装备搭配 / 站位优化 / 经济决策 / 追三星 / 复盘」。\n';
      }
      return wrap('卡池精算师', md, ['卡池精算师', '阵容变速师']);
    }

    /* 12. 通用总览 */
    let md = head + '\n### 阵容总览与建议\n' +
      '- **体系**：以 ' + traitNames + ' 为核心，' + (traits.length >= 3 ? '羁绊成型度良好' : '羁绊较散，建议围绕 1~2 个主体系收敛') + '\n' +
      '- **经济**：' + gold + ' 金币 / 利息 +' + interest + '，' + nextLevelAdvice(level, gold) + '\n' +
      '- **血量**：' + hp + (hp < 40 ? '（偏低，优先保血）' : '（安全）') + '\n' +
      '- **下一步**：' + (board.length < level ? '先把人口补到 ' + level + '，再考虑 D 牌质量' : '人口已满，开始 D 牌提升质量') + '\n';
    if (ctx.inactiveNearTraits && ctx.inactiveNearTraits.length) {
      md += '\n### 羁绊断点（性价比最高的补强）\n' +
        ctx.inactiveNearTraits.filter(t => t.needMore <= 2).slice(0, 4).map(t => '- **' + t.name + '**：还差 ' + t.needMore + ' 枚棋子激活下一档（' + t.nextMin + '）').join('\n') + '\n';
    }
    md += '\n你可以直接点击下方快捷提问，我会基于真实数据针对「阵容推荐 / 海克斯择优 / 装备搭配 / 站位优化 / 经济决策 / 追三星 / 8 家对位 / 羁绊查询 / 棋子详情 / 复盘」给出专门分析。';
    return wrap('阵容变速师', md, AGENTS.slice(0, 3));
  };

  /* ==================== 初始化 ==================== */
  AI.greeting = function () {
    const c = AI.catalog();
    AI.push('sys', '欢迎使用「金铲铲 AI 多智能体阵容模拟器」。已接入 5 个智能体：' + AGENTS.join(' / ') + '。\n' +
      '所有数据均来自**官方真实爬取**：海克斯强化 **' + c.augments + '** 条、装备 **' + c.items + '** 条（全赛季），当前赛季阵容库 **' +
      (D.meta && D.meta.tiers ? Object.keys(D.meta.tiers).reduce((s, t) => s + (D.meta.tiers[t] || []).length, 0) : 0) + '** 套。\n' +
      '每次提问都会自动携带完整对局 JSON（棋盘/星级/装备、备战区、已选海克斯、等级金币血量回合、激活羁绊、剩余牌池、8 家对手），并基于真实数据给出结论。\n' +
      '在顶栏点击「大模型」可接入 DeepSeek / OpenAI 兼容接口（流式输出）；未配置 API Key 时使用本地真实数据推理。');
  };

  AI.initChat = function () {
    if (!S.chat.length) AI.greeting();
    AI.render();
    AI.updateCtxBadge();
  };

})(window.TFT);
