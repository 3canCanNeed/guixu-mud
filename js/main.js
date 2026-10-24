/* ═══════════════════════════════════════════════════════════
   归墟 · 界面层
   把引擎事件渲染成 CRT 终端上的字；把按键翻译成命令。
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const logEl    = $('#log');
  const cmdEl    = $('#cmd');
  const wrapEl   = $('#promptWrap');
  const exitsEl  = $('#exits-bar');

  const MAX_LINES = 900;
  let history = [];
  let hIdx = -1;
  let started = false;
  let soundOn = false;

  /* ══════════ 渲染 ══════════ */

  const CLS = {
    place: 'place', desc: 'desc', say: 'say', npc: 'npc',
    sys: 'sys', hint: 'hint', good: 'good', bad: 'bad', warn: 'warn',
    item: 'item', combat: 'combat', divider: 'divider', ascii: 'ascii', tag: 'tag',
  };

  function appendEvent(ev) {
    if (ev.t === 'kv') {
      const box = document.createElement('div');
      box.className = 'line kv';
      box.innerHTML = (ev.m || []).map((row) =>
        '<div class="kv-row"><span class="k">' + esc(row[0]) + '</span>' +
        '<span class="v">' + esc(row[1]) + '</span></div>').join('');
      logEl.appendChild(box);
      return;
    }

    if (ev.t === 'tag') {
      const last = logEl.lastElementChild;
      if (last && last.classList.contains('place')) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = ev.m;
        last.appendChild(tag);
        return;
      }
    }

    const div = document.createElement('div');
    div.className = 'line ' + (CLS[ev.t] || 'sys') + (ev.c ? ' ' + ev.c : '');

    if (ev.t === 'place') {
      const rn = document.createElement('span');
      rn.className = 'rn';
      rn.textContent = ev.m;
      div.appendChild(rn);
    } else {
      div.textContent = ev.m;
    }
    logEl.appendChild(div);
  }

  function appendEcho(text) {
    const div = document.createElement('div');
    div.className = 'line echo';
    div.textContent = text;
    logEl.appendChild(div);
  }

  function isNearBottom() {
    return logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 90;
  }

  function scrollDown(force) {
    if (force || isNearBottom()) {
      logEl.scrollTop = logEl.scrollHeight;
      // 字体/布局在下一帧可能长高，补一次，避免停在半途
      requestAnimationFrame(() => {
        if (force || isNearBottom()) logEl.scrollTop = logEl.scrollHeight;
      });
    }
  }

  function trimLog() {
    while (logEl.children.length > MAX_LINES) logEl.removeChild(logEl.firstElementChild);
  }

  function render(events, forceScroll) {
    const stick = isNearBottom();
    (events || []).forEach(appendEvent);
    trimLog();
    if (stick || forceScroll) scrollDown(true);
  }

  /* ══════════ 面板 ══════════ */

  function pct(a, b) { return b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0; }

  function renderPanel() {
    const S = Game.get();
    if (!S) return;

    $('#heroName').textContent = S.name;
    $('#heroTitle').textContent = (window.DATA.ranks[Math.min(S.lv - 1, window.DATA.ranks.length - 1)] || '凡人') + ' · ' + S.lv + ' 重';

    $('#hpFill').style.width = pct(S.hp, S.hpMax) + '%';
    $('#hpTxt').textContent = S.hp + '/' + S.hpMax;
    $('#mpFill').style.width = pct(S.mp, S.mpMax) + '%';
    $('#mpTxt').textContent = S.mp + '/' + S.mpMax;

    const need = 30 + (S.lv - 1) * 45;
    $('#expFill').style.width = pct(S.exp, need) + '%';
    $('#expTxt').textContent = S.exp + '/' + need;

    const hpMeter = $('.meter[data-k="hp"]');
    if (hpMeter) hpMeter.classList.toggle('low', S.hp / S.hpMax < 0.3);

    const wAtk = S.weapon ? (window.DATA.items[S.weapon].atk || 0) : 0;
    const aDef = S.armor ? (window.DATA.items[S.armor].def || 0) : 0;

    $('#statsRow').innerHTML =
      '<div><b>' + (S.atk + wAtk) + '</b><small>攻</small></div>' +
      '<div><b>' + (S.def + aDef) + '</b><small>防</small></div>' +
      '<div><b>' + S.kills + '</b><small>克</small></div>' +
      '<div><b>' + S.steps + '</b><small>步</small></div>';

    $('#coinTxt').textContent = S.money + ' 文';
    $('#gearWeapon').textContent = S.weapon ? window.DATA.items[S.weapon].name : '空手';
    $('#gearWeapon').className = S.weapon ? '' : 'empty';
    $('#gearArmor').textContent = S.armor ? window.DATA.items[S.armor].name : '无';
    $('#gearArmor').className = S.armor ? '' : 'empty';

    renderBag(S);
    renderQuest(S);
    renderMap(S);

    const r = window.DATA.rooms[S.room];
    $('#chipRoom').textContent = r ? r.name : '——';
    $('#chipChime').textContent = Game.CHIMES[S.chime];
  }

  function renderBag(S) {
    const list = $('#bagList');
    const ids = Object.keys(S.bag).filter((k) => S.bag[k] > 0);
    $('#bagCount').textContent = ids.length + ' 件';
    if (!ids.length) {
      list.innerHTML = '<li class="empty">空</li>';
      return;
    }
    const order = { weapon: 0, armor: 1, heal: 2, mana: 3, charm: 4, tool: 5, key: 6, quest: 7, money: 8 };
    ids.sort((a, b) => (order[window.DATA.items[a].kind] ?? 9) - (order[window.DATA.items[b].kind] ?? 9));
    list.innerHTML = ids.map((id) => {
      const it = window.DATA.items[id];
      const eq = (S.weapon === id || S.armor === id) ? ' equipped' : '';
      const q = it.kind === 'quest' ? ' quest' : '';
      const n = S.bag[id] > 1 ? '<span class="qty">×' + S.bag[id] + '</span>' : '';
      return '<li class="' + (eq + q).trim() + '"><span class="nm">' + esc(it.name) + '</span>' + n + '</li>';
    }).join('');
  }

  function renderQuest(S) {
    const q = [];
    if (!S.visited.gate) q.push(['active', '过江，去乌斯村']);
    else if (!S.flags.bossDead) q.push(['active', '查清那一夜的事']);
    if (S.flags.bossDead) q.push(['active', '血玉在你手上']);
    if (S.clues.stele)  q.push(['done', '石碑上凿掉的四个字']);
    if (S.clues.mural)  q.push(['done', '壁画上凿掉的那张脸']);
    if (S.clues.keeper) q.push(['done', '老庙祝守的东西']);
    if (S.clues.boatman) q.push(['done', '老艄公不肯渡的江']);
    if (!q.length) q.push(['', '暂时无事']);
    $('#questList').innerHTML = q.map(([c, t]) =>
      '<li class="' + c + '">' + esc(t) + '</li>').join('');
  }

  function renderMap(S) {
    const m = Game.mapModel();
    const cols = m.rows[0].length;
    const cells = [];
    m.rows.forEach((row) => {
      row.forEach((c) => {
        if (!c) { cells.push('<i class="mm-cell mm-void"></i>'); return; }
        const cls = 'mm-cell ' + (c.here ? 'here' : c.seen ? 'seen' : 'unseen');
        const label = c.seen ? String(c.name).slice(0, 2) : '';
        cells.push('<i class="' + cls + '" title="' + esc(c.name) + '">' + esc(label) + '</i>');
      });
    });
    $('#miniMap').innerHTML =
      '<div class="mm-grid" style="--mm-cols:' + cols + '">' + cells.join('') + '</div>';
    const seen = Object.keys(S.visited).filter((k) => !window.DATA.rooms[k].noMap).length;
    const total = Object.keys(window.DATA.rooms).filter((k) => !window.DATA.rooms[k].noMap).length;
    $('#mapHint').textContent = seen + '/' + total;
  }

  function renderExits(S) {
    const r = window.DATA.rooms[S.room];
    if (!r || S.combat || S.finale || S.ended) { exitsEl.innerHTML = ''; return; }
    const dirs = Object.keys(r.exits || {});
    if (!dirs.length) { exitsEl.innerHTML = ''; return; }
    const CN = { north: '北', south: '南', east: '东', west: '西', up: '上', down: '下' };
    const cur = window.DATA.rooms[S.room];
    const html = ['<span class="lbl">出路</span>'].concat(dirs.map((d) => {
      const locked = window.Game.isLocked(S.room, d);
      const tgt = window.DATA.rooms[cur.exits[d]];
      const nm = tgt ? tgt.name : d;
      return '<button class="exit-pill' + (locked ? ' hazard' : '') + '" data-dir="' + d + '">' +
             CN[d] + ' · ' + esc(nm) + (locked ? '（锁）' : '') + '</button>';
    })).join('');
    exitsEl.innerHTML = html;
  }

  /* ══════════ 主循环 ══════════ */

  function handleSubmit(text) {
    if (!started) return;
    const raw = String(text || '').trim();
    if (!raw) return;

    // 清屏交给界面
    if (raw === 'clear' || raw === '清屏') {
      logEl.innerHTML = '';
      cmdEl.value = '';
      return;
    }

    appendEcho(raw);
    history.push(raw);
    if (history.length > 120) history.shift();
    hIdx = history.length;

    const S = Game.get();

    // 战斗 / 结局 / 常规
    const events = Game.exec(raw);

    // 注意：不要因为「没有事件」就清空日志，那会让玩家误以为黑屏
    if (events.length > 0) render(events);

    renderPanel();
    renderExits(Game.get());
    cmdEl.value = '';
    scrollDown(true);

    // 结局仪式
    const S2 = Game.get();
    if (S2 && S2.ended) setTimeout(showVeil, 1600);
  }

  function showVeil() {
    if ($('#veil')) return;
    const S = Game.get();
    const e = window.DATA.endings[S.ended];
    if (!e) return;
    const v = document.createElement('div');
    v.id = 'veil';
    v.className = 'show';
    const body = (e.lines || []).map((l) => '<p>' + esc(l) + '</p>').join('');
    v.innerHTML =
      '<div class="veil-inner">' +
        '<h2>' + esc(e.title) + '</h2>' +
        '<p class="veil-sub">归墟 · 拾遗人纪事 · 卷一　终</p>' +
        '<div class="veil-body">' + body + '</div>' +
        '<p class="veil-quote">' + esc(e.epilogue) + '</p>' +
        '<p class="veil-stats">行者：' + esc(S.name) +
          '　境界：' + esc(window.DATA.ranks[Math.min(S.lv - 1, window.DATA.ranks.length - 1)]) +
          ' · ' + S.lv + ' 重　克敌：' + S.kills + '　行路：' + S.steps + ' 步</p>' +
        '<button class="big-btn" id="veilRestart">合 卷 重 来</button>' +
      '</div>';
    document.body.appendChild(v);
    $('#veilRestart').addEventListener('click', () => location.reload());
  }

  /* ══════════ 音（风） ══════════ */
  let audioCtx = null, windSrc = null, windGain = null;

  function initAudio() {
    if (audioCtx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    const dur = 4;
    const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    windSrc = audioCtx.createBufferSource();
    windSrc.buffer = buf;
    windSrc.loop = true;
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    windGain = audioCtx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(lp).connect(windGain).connect(audioCtx.destination);
    windSrc.start();

    // 缓慢起伏
    const lfo = audioCtx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
  }

  function toggleSound() {
    initAudio();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    soundOn = !soundOn;
    windGain.gain.linearRampToValueAtTime(soundOn ? 0.05 : 0.0001, audioCtx.currentTime + 1.2);
    const b = $('#btnSound');
    b.setAttribute('aria-pressed', String(soundOn));
    b.textContent = soundOn ? '风声' : '静音';
    savePrefs();
  }

  /* ══════════ 偏好 ══════════ */
  const THEMES = ['jade', 'amber', 'moon'];

  function savePrefs() {
    try {
      localStorage.setItem('guixu.prefs', JSON.stringify({
        theme: document.body.dataset.theme,
        sound: soundOn,
      }));
    } catch (e) {}
  }

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem('guixu.prefs') || '{}');
      if (p.theme && THEMES.indexOf(p.theme) >= 0) document.body.dataset.theme = p.theme;
      if (p.sound) { soundOn = false; setTimeout(toggleSound, 300); }
    } catch (e) {}
  }

  /* ══════════ 事件绑定 ══════════ */

  function bind() {
    wrapEl.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSubmit(cmdEl.value);
    });

    cmdEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!history.length) return;
        hIdx = Math.max(0, hIdx - 1);
        cmdEl.value = history[hIdx] || '';
        setTimeout(() => cmdEl.setSelectionRange(cmdEl.value.length, cmdEl.value.length), 0);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        hIdx = Math.min(history.length, hIdx + 1);
        cmdEl.value = history[hIdx] || '';
      } else if (e.key === 'Tab') {
        e.preventDefault();
        autocomplete();
      }
    });

    logEl.addEventListener('click', () => { if (started) cmdEl.focus(); });

    exitsEl.addEventListener('click', (e) => {
      const b = e.target.closest('.exit-pill');
      if (!b) return;
      handleSubmit(b.dataset.dir);
      cmdEl.focus();
    });

    $('#btnHelp').addEventListener('click', () => handleSubmit('help'));
    $('#btnMap').addEventListener('click', () => handleSubmit('map'));
    $('#btnTheme').addEventListener('click', () => {
      const cur = document.body.dataset.theme || 'jade';
      const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
      document.body.dataset.theme = next;
      savePrefs();
    });
    $('#btnSound').addEventListener('click', toggleSound);

    $('#btnSave').addEventListener('click', () => handleSubmit('save'));
    $('#btnLoad').addEventListener('click', () => handleSubmit('load'));
    $('#btnWipe').addEventListener('click', () => {
      if (!confirm('把所有旧稿烧掉？本机的存档会被清除。')) return;
      Game.wipe();
      const d = document.createElement('div');
      d.className = 'line sys';
      d.textContent = '—— 旧稿烧了。灰留在原地。';
      logEl.appendChild(d);
      scrollDown(true);
    });

    $('#btnStart').addEventListener('click', () => {
      startGame(false);
    });
    $('#btnResume').addEventListener('click', () => {
      startGame(true);
    });

    // 移动端侧栏
    const fab = document.createElement('button');
    fab.className = 'side-fab';
    fab.textContent = '册';
    fab.title = '人物册页';
    document.body.appendChild(fab);
    fab.addEventListener('click', () => document.body.classList.toggle('side-open'));
    logEl.addEventListener('click', () => document.body.classList.remove('side-open'));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') document.body.classList.remove('side-open');
    });

    window.addEventListener('resize', () => { if (started) scrollDown(true); });
  }

  const DIR_WORDS = ['n', 's', 'e', 'w', 'u', 'd', 'north', 'south', 'east', 'west'];

  function autocomplete() {
    const v = cmdEl.value.trim();
    if (!v) return;
    const words = ['看', '走', '拿', '用', '打', '说', '背包', '属性', '技能', '任务',
      '地图', '休息', '买', '卖', '存档', '读档', '帮助', '装备', '读'];
    const hit = words.filter((w) => w.indexOf(v) === 0);
    if (hit.length === 1) cmdEl.value = hit[0];
    else if (hit.length > 1) {
      appendEcho('（候选：' + hit.join('　') + '）');
      scrollDown(true);
    }
  }

  /* ══════════ 启动 ══════════ */

  function startGame(resume) {
    if (started) return;

    if (resume) {
      const saved = (function () {
        try { return localStorage.getItem('guixu.save.v1'); } catch (e) { return null; }
      })();
      const res = saved ? Game.resumeFrom(saved) : null;
      if (!res) {
        // 存档损坏或来自不兼容的旧版本：清掉，免得每次点「续前缘」都失败
        if (saved) {
          try { localStorage.removeItem('guixu.save.v1'); } catch (e) {}
          $('#btnResume').hidden = true;
        }
        startGame(false);
        return;
      }
      logEl.innerHTML = '';
      render(res.events, true);
    } else {
      const res = Game.start('谢九');
      logEl.innerHTML = '';
      render(res.events, true);
    }

    started = true;
    $('#curtain').classList.add('gone');
    renderPanel();
    renderExits(Game.get());
    setTimeout(() => cmdEl.focus(), 120);
  }

  function boot() {
    bind();
    loadPrefs();

    // 有旧档则显示「续前缘」
    if (Game.hasSave()) $('#btnResume').hidden = false;

    // 幕布上点任意处也能开始？不——保留仪式感，只按钮。
    cmdEl.disabled = false;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
