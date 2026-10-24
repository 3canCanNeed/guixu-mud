/* ═══════════════════════════════════════════════════════════
   归墟 · 引擎
   命令解析 / 移动 / 战斗 / 背包 / 剧情 / 结局
   引擎不触碰 DOM：产出 {t, m} 事件序列，交给 UI 渲染。
   ═══════════════════════════════════════════════════════════ */
window.Game = (function () {
  'use strict';

  const D = window.DATA;

  /* ─────────────── 常量 ─────────────── */
  const CHIMES = ['子时', '丑时', '寅时', '卯时', '辰时', '巳时',
                  '午时', '未时', '申时', '酉时', '戌时', '亥时'];

  const DIR_ALIAS = {
    north: ['north', 'n', '北', '北边', '北面', '往北'],
    south: ['south', 's', '南', '南边', '南面', '往南'],
    east:  ['east', 'e', '东', '东边', '东面', '往东'],
    west:  ['west', 'w', '西', '西边', '西面', '往西'],
    up:    ['up', 'u', '上', '上面', '往上'],
    down:  ['down', 'd', '下', '下面', '往下'],
  };
  const DIR_CN = { north: '北', south: '南', east: '东', west: '西', up: '上', down: '下' };

  /* ─────────────── 状态 ─────────────── */
  let S = null;
  let out = [];

  function emit(t, m, cls) {
    if (m === undefined || m === null || m === '') return;
    out.push({ t: t, m: (typeof m === 'object' ? m : String(m)), c: cls || null });
  }

  /* 两列表格（帮助 / 交易），交给界面用网格排版，避免中文对不齐 */
  function emitKV(rows) {
    if (!rows || !rows.length) return;
    out.push({ t: 'kv', m: rows });
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  const chance = (p) => Math.random() < p;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const cap = (s) => (s && s.length ? s[0] : '');

  function newState(name) {
    return {
      name: name || '谢九',
      lv: 1,
      exp: 0,
      hp: 100, hpMax: 100,
      mp: 40,  mpMax: 40,
      atk: 8,  def: 2,
      money: 12,
      room: D.start,
      bag: { letter: 1, coin_half: 1, peach_sword: 1, cloth: 1 },
      weapon: 'peach_sword',
      armor: 'cloth',
      learned: ['rock', 'breath', 'step'],
      flags: {},
      clues: {},
      talkIdx: {},
      visited: {},
      taken: {},
      cleared: {},
      mobState: {},
      chime: 11,
      kills: 0,
      combat: null,
      buff: null,
      finale: false,
      ended: null,
      steps: 0,
    };
  }

  /* ─────────────── 派生属性 ─────────────── */
  const weaponAtk = () => (S.weapon && D.items[S.weapon] ? D.items[S.weapon].atk || 0 : 0);
  const armorDef  = () => (S.armor  && D.items[S.armor]  ? D.items[S.armor].def  || 0 : 0);
  const totalAtk  = () => S.atk + weaponAtk();
  const totalDef  = () => S.def + armorDef();
  const expNeed   = () => 30 + (S.lv - 1) * 45;
  const hasItem   = (id) => (S.bag[id] || 0) > 0;
  const hasLight  = () => (S.bag.torch || 0) > 0;
  const bagCount  = () => Object.keys(S.bag).reduce((n, k) => n + (S.bag[k] > 0 ? 1 : 0), 0);

  function isLocked(roomId, dir) {
    const r = D.rooms[roomId];
    if (!r || !r.locks || !r.locks[dir]) return false;
    return !(S.flags && S.flags['lock_' + roomId + '_' + dir]);
  }

  function addItem(id, n) {
    n = n || 1;
    S.bag[id] = (S.bag[id] || 0) + n;
    const it = D.items[id];
    if (it && it.kind !== 'money') emit('item', `获得 ${it.name}${n > 1 ? ' ×' + n : ''}。`);
  }
  function delItem(id, n) {
    n = n || 1;
    if (!S.bag[id]) return false;
    S.bag[id] -= n;
    if (S.bag[id] <= 0) delete S.bag[id];
    return true;
  }

  function tick(n) {
    S.chime = (S.chime + (n || 1)) % 12;
    S.steps += (n || 1);
  }

  /* ─────────────── 房间 ─────────────── */
  function room() { return D.rooms[S.room]; }

  function aliveMobs() {
    const r = room();
    if (!r.mobs) return [];
    return r.mobs.filter((id) => !(S.cleared[S.room] && S.cleared[S.room][id]));
  }

  function roomItems() {
    const r = room();
    if (!r.items) return [];
    return r.items.filter((id) => !(S.taken[S.room] && S.taken[S.room][id]));
  }

  function describeRoom(isEnter) {
    const r = room();
    emit('place', r.name);
    if (r.region) emit('tag', r.region);
    if (isEnter && r.first && !S.flags['first_' + S.room]) {
      S.flags['first_' + S.room] = true;
      r.first.forEach((l) => emit('desc', l));
    }
    r.desc.forEach((l) => emit('desc', l));

    const its = roomItems();
    if (its.length) {
      emit('item', '这里有：' + its.map((id) => D.items[id].name).join('、') + '。');
    }
    const npcs = r.npcs || [];
    npcs.forEach((id) => emit('npc', `${D.npcs[id].name}在${r.name}。`));
    const ms = aliveMobs();
    if (ms.length) {
      emit('bad', ms.map((id) => D.mobs[id].name).join('、') + ' 拦在前头。');
    }
    if (r.needsLight && !hasLight()) {
      emit('warn', '这里黑得看不见自己的手。你需要一点火。');
      return;
    }
    emitExits();
  }

  function emitExits() {
    const r = room();
    const dirs = Object.keys(r.exits || {});
    if (!dirs.length) return;
    const parts = dirs.map((d) => {
      const locked = isLocked(S.room, d);
      return `${DIR_CN[d] || d}${locked ? '（锁）' : ''}`;
    });
    emit('hint', '出路：' + parts.join('　'));
  }

  function enterRoom(id, silent) {
    S.room = id;
    S.visited[id] = true;
    if (!silent) tick(1);
    describeRoom(true);

    const r = D.rooms[id];
    if (r && r.mobs) {
      const alive = aliveMobs();
      alive.forEach((mid) => {
        const m = D.mobs[mid];
        if (m.aggro) {
          emit('bad', `—— ${m.name} 扑了上来！`);
          startCombat(mid);
        }
      });
    }
  }

  /* ─────────────── 战斗 ─────────────── */
  function mobHpKey() { return S.room + '|' + S.combat.mobId; }

  function startCombat(mobId) {
    const m = D.mobs[mobId];
    const key = S.room + '|' + mobId;
    const cur = S.mobState[key] != null ? S.mobState[key] : m.hp;
    S.combat = { mobId, hp: cur, hpMax: m.hp, turn: 1 };
    emit('desc', m.desc);
    emitCombatFrame();
  }

  function bar(cur, max, len) {
    len = len || 12;
    const n = clamp(Math.round((cur / max) * len), 0, len);
    return '█'.repeat(n) + '░'.repeat(len - n);
  }

  function emitCombatFrame() {
    const c = S.combat;
    if (!c) return;
    const m = D.mobs[c.mobId];
    emit('combat', `【${m.name}】 ${bar(c.hp, c.hpMax)} ${c.hp}/${c.hpMax}`, 'foe');
    emit('combat', `【${S.name}】 ${bar(S.hp, S.hpMax)} ${S.hp}/${S.hpMax}　真气 ${S.mp}/${S.mpMax}`, 'me');
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* 全角宽度感知的对齐：中文占 2 格，西文占 1 格 */
  function dispW(str) {
    let n = 0;
    for (const ch of String(str)) {
      const c = ch.codePointAt(0);
      const wide = (c >= 0x1100 && c <= 0x115f) ||
        c === 0x2329 || c === 0x232a ||
        (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) ||
        (c >= 0xac00 && c <= 0xd7a3) ||
        (c >= 0xf900 && c <= 0xfaff) ||
        (c >= 0xfe30 && c <= 0xfe6f) ||
        (c >= 0xff00 && c <= 0xff60) ||
        (c >= 0xffe0 && c <= 0xffe6) ||
        (c >= 0x20000 && c <= 0x3fffd);
      n += wide ? 2 : 1;
    }
    return n;
  }

  function padDisp(str, width) {
    let s = String(str);
    let w = dispW(s);
    while (w < width) { s += ' '; w++; }
    return s;
  }
  /* 地图格：内容固定 6 格宽，保证等宽字体下纵向对齐 */
  const CELL_W = 6;
  function mapCell(txt) {
    let s = '';
    let w = 0;
    for (const ch of String(txt)) {
      const cw = dispW(ch);
      if (w + cw > CELL_W) break;
      s += ch; w += cw;
    }
    while (w < CELL_W) { s += ' '; w++; }
    return '[' + s + ']';
  }

  function calcDmg(a, d, mult) {
    let v = a * (mult || 1) * rnd(0.88, 1.12) - d;
    v = Math.max(1, Math.round(v));
    const crit = chance(0.10);
    if (crit) v = Math.round(v * 1.65);
    return { v, crit };
  }

  function playerDies() {
    S.combat = null;
    S.hp = 0;
    tick(2);
    emit('divider', '· · · · · · · · · ·');
    emit('bad', '你眼前一黑，什么都不知道了。');
    emit('desc', '再睁眼时，你躺在长夜渡的木桩边上。天没有亮。');
    emit('desc', '伤口结了痂，怀里那封信还在。江对面，乌斯村仍旧一盏灯都没有。');
    const lost = Math.floor(S.exp * 0.25);
    if (lost > 0) { S.exp -= lost; emit('sys', `你丢了 ${lost} 点修为，散在江里，捞不回来。`); }
    const coinLost = Math.floor(S.money / 2);
    if (coinLost > 0) { S.money -= coinLost; emit('sys', `身上的铜钱少了 ${coinLost} 文。`); }
    S.hp = Math.max(1, Math.floor(S.hpMax * 0.5));
    S.mp = Math.floor(S.mpMax * 0.5);
    S.buff = null;
    enterRoom(D.start, true);
  }

  function winCombat() {
    const c = S.combat;
    const m = D.mobs[c.mobId];
    const roomId = S.room;
    S.cleared[roomId] = S.cleared[roomId] || {};
    S.cleared[roomId][c.mobId] = true;
    delete S.mobState[roomId + '|' + c.mobId];
    S.combat = null;
    S.buff = null;
    S.kills++;

    emit('good', '—— 你赢了。');
    m.lines.die.forEach((l) => emit('desc', l));

    const gained = Math.round(m.exp * rnd(0.9, 1.1));
    S.exp += gained;
    emit('sys', `修为 +${gained}`);
    if (m.money) { S.money += m.money; emit('sys', `铜钱 +${m.money}`); }

    (m.drops || []).forEach((d) => {
      if (chance(d.chance == null ? 1 : d.chance)) addItem(d.id, d.n || 1);
    });

    checkLevel();

    if (m.boss) bossFall();
  }

  function checkLevel() {
    while (S.exp >= expNeed() && S.lv < 9) {
      S.exp -= expNeed();
      S.lv++;
      S.hpMax += 18; S.mpMax += 8;
      S.atk += 2; S.def += 1;
      S.hp = S.hpMax; S.mp = S.mpMax;
      emit('good', `—— 你破境了：${D.ranks[Math.min(S.lv - 1, D.ranks.length - 1)]} · ${S.lv} 重`);
      emit('desc', '气血忽然涨了一截，耳边嗡嗡作响，随后是说不出的轻。');
      if (S.lv >= 2 && S.learned.indexOf('fire') < 0) {
        S.learned.push('fire');
        emit('good', '自悟一式：流火诀。');
      }
    }
  }

  function enemyTurn() {
    const c = S.combat;
    if (!c) return;
    const m = D.mobs[c.mobId];

    let dodgeChance = 0.05 + (S.buff ? S.buff.dodge : 0);
    if (chance(dodgeChance)) {
      emit('combat', `${m.name}扑过来，你侧身让开，衣角带着风。`);
    } else {
      const r = calcDmg(m.atk, totalDef(), 1);
      S.hp -= r.v;
      if (chance(0.35)) emit('desc', pick(m.lines.hurt));
      emit('combat', `${m.name} 击中你，气血 -${r.v}${r.crit ? '（重击）' : ''}。`);
      if (S.hp <= 0) return playerDies();
    }

    if (S.buff) {
      S.buff.turns--;
      if (S.buff.turns <= 0) {
        emit('sys', '踏雪无痕的余势散了，脚下重新有了分量。');
        S.buff = null;
      }
    }
  }

  function hitMob(mult, skill) {
    const c = S.combat;
    const m = D.mobs[c.mobId];
    const r = calcDmg(totalAtk(), m.def || 0, mult);

    c.hp -= r.v;
    if (skill) emit('combat', `${skill.verb}——`);
    if (chance(0.45)) emit('desc', pick(m.lines.hit));
    emit('combat', `你击中${m.name}，伤害 ${r.v}${r.crit ? '（要害）' : ''}。`);

    // BOSS 台词
    if (m.boss) bossBanter(c);

    if (c.hp <= 0) { c.hp = 0; return winCombat(); }

    S.mobState[S.room + '|' + c.mobId] = c.hp;
    S.combat.turn++;
    enemyTurn();
  }

  function bossBanter(c) {
    const ratio = c.hp / c.hpMax;
    if (ratio <= 0.5 && !S.flags.boss50) {
      S.flags.boss50 = true;
      emit('say', '她笑了一声，声音像从很深的地方冒上来：「你知道这池子里有多少人吗？」');
      emit('say', '「一百三十六个。他们跪着，等我把头梳完。」');
    }
    if (ratio <= 0.2 && !S.flags.boss20) {
      S.flags.boss20 = true;
      emit('say', '「你手上那把刀，」她忽然说，「是我剪头发用的。」');
    }
  }

  /* ─────────────── 结局 ─────────────── */
  function bossFall() {
    emit('divider', '· · · · · · · · · ·');
    emit('desc', '池水静下来。一点极小的红光从水底浮上来，浮到你的手边，不动了。');
    emit('desc', '是一块玉。巴掌大，里面封着一团缓慢流动的暗红。');
    addItem('blood_jade', 1);
    S.flags.bossDead = true;

    emit('divider', '——');
    emit('desc', '你站在池边等了很久。等到身上那点热气都散了，才想起来自己该做什么。');
    emit('desc', '然后你就什么都不记得了。');

    S.finale = true;
    S.room = 'void';
    S.visited.void = true;
    emit('place', '归墟');
    D.rooms.void.desc.forEach((l) => emit('desc', l));
    emit('hint', '你听见一个很轻的声音，像有人在水底问你：「你要把它怎么样？」');
    emit('hint', '——封（seal）　吞（swallow）　走（walk）');
    if (cluesAll()) {
      emit('warn', '你忽然想起，你还有一件别的事可以做：把东西还给她。（输入 还）');
    }
  }

  function cluesAll() {
    return !!(S.clues.boatman && S.clues.stele && S.clues.mural && S.clues.keeper);
  }

  function doEnding(key) {
    const e = D.endings[key];
    if (!e) { emit('bad', '你张了张嘴，什么也没说出来。'); return; }
    S.ended = key;
    emit('divider', '· · · · · · · · · ·');
    emit('place', e.title);
    e.lines.forEach((l) => emit('desc', l));
    emit('divider', '——');
    emit('say', e.epilogue);
  }

  /* ═══════════════ 命令解析 ═══════════════ */

  const ALIAS = {
    look:     ['look', 'l', '看', '看看', '观察', '打量', '瞧', '望'],
    go:       ['go', '走', '去', '往', '移动', '前往'],
    take:     ['take', 'get', '拿', '捡', '拾', '取'],
    drop:     ['drop', '丢', '放下', '扔掉'],
    inv:      ['inv', 'i', '背包', '行囊', '包'],
    status:   ['status', 'st', '属性', '状态', '面板'],
    attack:   ['attack', 'kill', '打', '攻击', '杀', '揍', '砍'],
    talk:     ['talk', '说话', '交谈', '对话', '问'],
    use:      ['use', '用', '吃', '喝', '服'],
    equip:    ['equip', 'wear', '装备', '穿', '持'],
    unequip:  ['unequip', '卸下', '脱'],
    skills:   ['skills', 'skill', '技能', '招式'],
    help:     ['help', 'h', '?', '帮助', '说明', '指令'],
    map:      ['map', '地图', '舆图'],
    quest:    ['quest', '任务', '心事'],
    rest:     ['rest', '休息', '打坐', '睡', '躺'],
    buy:      ['buy', '买'],
    sell:     ['sell', '卖'],
    read:     ['read', '读', '阅读', '展开'],
    save:     ['save', '存档', '存'],
    load:     ['load', '读档', '载入'],
    clear:    ['clear', '清屏'],
    wait:     ['wait', '等', '等待', '歇'],
    flee:     ['flee', 'f', '逃', '逃跑', '跑'],
    look_me:  ['me', '自己'],
  };

  function canon(word) {
    const w = word.toLowerCase();
    for (const k in ALIAS) if (ALIAS[k].indexOf(w) >= 0) return k;
    return null;
  }

  function normDir(w) {
    if (!w) return null;
    const s = w.toLowerCase();
    for (const d in DIR_ALIAS) if (DIR_ALIAS[d].indexOf(s) >= 0) return d;
    return null;
  }

  function findItemInRoom(arg) {
    const its = roomItems();
    for (let i = 0; i < its.length; i++) {
      if (D.items[its[i]].name.indexOf(arg) >= 0) return its[i];
    }
    for (let i = 0; i < its.length; i++) {
      if (its[i].indexOf(arg) >= 0) return its[i];
    }
    return null;
  }
  function findItemInBag(arg) {
    for (const id in S.bag) {
      if (S.bag[id] > 0 && D.items[id] && D.items[id].name.indexOf(arg) >= 0) return id;
    }
    return null;
  }
  function findMobInRoom(arg) {
    const ms = aliveMobs();
    for (let i = 0; i < ms.length; i++) {
      if (D.mobs[ms[i]].name.indexOf(arg) >= 0) return ms[i];
    }
    return ms[0] || null;
  }
  function findNpcInRoom(arg) {
    const ns = room().npcs || [];
    for (let i = 0; i < ns.length; i++) {
      if (D.npcs[ns[i]].name.indexOf(arg) >= 0) return ns[i];
    }
    return ns[0] || null;
  }

  /* ─────────────── 具体命令 ─────────────── */

  function cmdLook(arg) {
    const r = room();
    if (!arg) {
      if (r.needsLight && !hasLight()) {
        emit('warn', '这里太黑了。你伸出手，只摸到石头和自己的呼吸。');
        emit('hint', '（你需要火折子。）');
        return;
      }
      describeRoom(false);
      return;
    }
    // scenery
    if (r.scenery) {
      for (const k in r.scenery) {
        if (k.indexOf(arg) >= 0 || arg.indexOf(k) >= 0) {
          emit('desc', r.scenery[k]);
          if (k === '石碑' && S.room === 'gate') S.clues.stele = true;
          if (k === '壁画' && S.room === 'hall') S.clues.mural = true;
          return;
        }
      }
    }
    const mid = findMobInRoom(arg);
    if (mid && D.mobs[mid].name.indexOf(arg) >= 0) { emit('desc', D.mobs[mid].desc); return; }
    const nid = findNpcInRoom(arg);
    if (nid && D.npcs[nid].name.indexOf(arg) >= 0) { emit('npc', D.npcs[nid].desc); return; }
    const iid = findItemInRoom(arg) || findItemInBag(arg);
    if (iid) { emit('item', D.items[iid].name + '：' + D.items[iid].desc); return; }

    emit('sys', '这里没有「' + arg + '」。');
  }

  function cmdGo(arg) {
    if (!arg) { emit('sys', '你要往哪儿走？'); emitExits(); return; }
    const r = room();
    let dir = normDir(arg);

    if (!dir) {
      // 按房间名走
      for (const d in r.exits) {
        const t = D.rooms[r.exits[d]];
        if (t && (t.name.indexOf(arg) >= 0 || arg.indexOf(t.name) >= 0)) { dir = d; break; }
      }
    }
    if (!dir) {
      emit('sys', '「' + arg + '」这个方向去不了。');
      emitExits();
      return;
    }
    if (!r.exits[dir]) {
      emit('sys', `往${DIR_CN[dir]}没有路。`);
      return;
    }
    // 锁
    const lock = r.locks && r.locks[dir];
    const lockFlag = 'lock_' + S.room + '_' + dir;
    if (lock && !S.flags[lockFlag]) {
      if (hasItem(lock.key)) {
        emit('good', lock.ok);
        delItem(lock.key, 1);
        S.flags[lockFlag] = true;
        emit('sys', `${D.items[lock.key].name}用掉了一把。`);
      } else {
        emit('bad', lock.no);
        return;
      }
    }
    // 黑暗
    const target = D.rooms[r.exits[dir]];
    if (target && target.needsLight && !hasLight()) {
      emit('bad', '石阶往下，越走越黑。走到第三步，你已经看不见自己的手了。');
      emit('hint', '你退回来。没有火，下不去。');
      return;
    }
    enterRoom(r.exits[dir]);
  }

  function cmdTake(arg) {
    if (!arg) { emit('sys', '拿什么？'); return; }
    const id = findItemInRoom(arg);
    if (!id) { emit('sys', '这里没有「' + arg + '」可拿。'); return; }
    if (D.items[id].noDrop) { emit('sys', '这东西你拿不了。'); return; }
    S.taken[S.room] = S.taken[S.room] || {};
    S.taken[S.room][id] = true;
    addItem(id, 1);
    tick(1);
  }

  function cmdDrop(arg) {
    if (!arg) { emit('sys', '放下什么？'); return; }
    const id = findItemInBag(arg);
    if (!id) { emit('sys', '你身上没有「' + arg + '」。'); return; }
    const it = D.items[id];
    if (it.noDrop) { emit('sys', '这东西你丢不掉。'); return; }
    if (S.weapon === id) S.weapon = null;
    if (S.armor === id) S.armor = null;
    delItem(id, 1);
    emit('sys', `你放下了${it.name}。`);
    tick(1);
  }

  function cmdInv() {
    const ids = Object.keys(S.bag).filter((k) => S.bag[k] > 0);
    emit('divider', '行　囊');
    if (!ids.length) { emit('sys', '空空如也。'); }
    ids.forEach((id) => {
      const it = D.items[id];
      let note = '';
      if (S.weapon === id) note = '（兵刃 · 已装备）';
      else if (S.armor === id) note = '（护身 · 已装备）';
      else if (it.kind === 'weapon') note = `（兵刃 · 攻 +${it.atk}）`;
      else if (it.kind === 'armor') note = `（护身 · 防 +${it.def}）`;
      else if (it.kind === 'heal') note = `（回气血 ${it.hp}）`;
      else if (it.kind === 'mana') note = `（回真气 ${it.mp}）`;
      else if (it.kind === 'charm') note = '（镇煞）';
      emit('item', `${it.name}${S.bag[id] > 1 ? ' ×' + S.bag[id] : ''}${note}`);
    });
    emit('sys', `铜钱 ${S.money} 文。`);
  }

  function cmdEquip(arg) {
    if (!arg) { emit('sys', '装备什么？'); return; }
    const id = findItemInBag(arg);
    if (!id) { emit('sys', '你身上没有「' + arg + '」。'); return; }
    const it = D.items[id];
    if (it.kind === 'weapon') {
      S.weapon = id;
      emit('good', `你换上了${it.name}。攻 +${it.atk}。`);
    } else if (it.kind === 'armor') {
      S.armor = id;
      emit('good', `你穿上了${it.name}。防 +${it.def}。`);
    } else {
      emit('sys', '这东西不能装备。');
      return;
    }
    tick(1);
  }

  function cmdUnequip(arg) {
    if (arg && arg.indexOf('刀') < 0 && arg.indexOf('剑') < 0 && arg.indexOf('衣') < 0 && arg.indexOf('袍') < 0) {
      // 宽松处理
    }
    if (S.weapon) { emit('sys', `你收起了${D.items[S.weapon].name}。`); S.weapon = null; }
    if (S.armor)  { emit('sys', `你脱下了${D.items[S.armor].name}。`); S.armor = null; }
    tick(1);
  }

  function cmdUse(arg) {
    if (!arg) { emit('sys', '用什么？'); return; }
    const id = findItemInBag(arg);
    if (!id) { emit('sys', '你身上没有「' + arg + '」。'); return; }
    const it = D.items[id];
    if (it.kind === 'heal') {
      if (S.hp >= S.hpMax) { emit('sys', '你气血充盈，不必浪费药。'); return; }
      S.hp = Math.min(S.hpMax, S.hp + it.hp);
      delItem(id, 1);
      emit('good', it.use);
      emit('sys', `气血恢复到 ${S.hp}/${S.hpMax}。`);
    } else if (it.kind === 'mana') {
      if (S.mp >= S.mpMax) { emit('sys', '真气未竭，不必服丹。'); return; }
      S.mp = Math.min(S.mpMax, S.mp + it.mp);
      delItem(id, 1);
      emit('good', it.use);
      emit('sys', `真气恢复到 ${S.mp}/${S.mpMax}。`);
    } else if (it.kind === 'tool') {
      emit('sys', '火折子要在暗处才有用。');
      return;
    } else if (it.kind === 'charm') {
      emit('sys', '朱砂符贴在身上，你觉得屋子里凉了一点。');
      return;
    } else if (it.read) {
      it.read.forEach((l) => emit('desc', l));
    } else {
      emit('sys', '这东西用不上。');
      return;
    }
    tick(1);
    if (S.combat) { enemyTurn(); emitCombatFrame(); }
  }

  function cmdRead(arg) {
    const id = findItemInBag(arg || '信');
    if (!id) { emit('sys', '你身上没有可读的东西。'); return; }
    const it = D.items[id];
    if (it.read) it.read.forEach((l) => emit('desc', l));
    else emit('sys', `${it.name}上没什么可读的。`);
    tick(1);
  }

  function cmdTalk(arg) {
    if (S.combat) { emit('sys', '打架的时候没空说话。'); return; }
    const nid = findNpcInRoom(arg);
    if (!nid) { emit('sys', '这里没有人可以说话。'); return; }
    const npc = D.npcs[nid];
    emit('npc', npc.desc);

    const idx = S.talkIdx[nid] || 0;
    const lines = npc.lines();

    if (idx < lines.length) {
      emit('say', lines[idx]);
      S.talkIdx[nid] = idx + 1;
    } else {
      emit('say', '「……」' + npc.name + '不再说话了。');
    }
    tick(1);

    // 剧情钩子
    if (nid === 'boatman' && S.talkIdx.boatman >= 3) S.clues.boatman = true;

    if (nid === 'keeper' && S.talkIdx.keeper >= 3) {
      S.clues.keeper = true;
      if (S.learned.indexOf('lantern') < 0) {
        S.learned.push('lantern');
        emit('divider', '——');
        emit('say', '「你过来。」老庙祝招手，在你眉心点了三下。');
        emit('say', '「心里那点火，别让它灭了。灭了，就跟我一样，只剩一把米。」');
        emit('good', '习得：燃灯诀。');
      }
      if (!S.flags.restHint) {
        S.flags.restHint = true;
        emit('hint', '（在这庙里可以 rest 打坐，回满气血与真气。）');
      }
    }

    if (nid === 'peddler') {
      emit('hint', '（buy 物品 可买，sell 物品 可卖。用 list 看货。）');
      S.flags.shopOpen = true;
    }
  }

  function cmdShopList() {
    if (!S.flags.shopOpen) { emit('sys', '这里没有货担。'); return; }
    emit('divider', '货　担');
    D.npcs.peddler.shop.forEach((s) => {
      const it = D.items[s.id];
      emit('item', `${it.name}　${s.price} 文　—— ${it.desc}`);
    });
    emit('sys', `你身上有 ${S.money} 文。`);
  }

  function cmdBuy(arg) {
    if (!S.flags.shopOpen) { emit('sys', '这里没有货担。'); return; }
    if (!arg) { cmdShopList(); return; }
    const entry = D.npcs.peddler.shop.find((s) => D.items[s.id].name.indexOf(arg) >= 0 || s.id === arg);
    if (!entry) { emit('sys', '货担上没有「' + arg + '」。'); return; }
    if (S.money < entry.price) { emit('bad', '铜钱不够。'); return; }
    S.money -= entry.price;
    addItem(entry.id, 1);
    tick(1);
  }

  function cmdSell(arg) {
    if (!S.flags.shopOpen) { emit('sys', '这里没有货担。'); return; }
    const id = findItemInBag(arg);
    if (!id) { emit('sys', '你身上没有「' + arg + '」。'); return; }
    const it = D.items[id];
    if (it.noDrop) { emit('sys', '他不收这个。'); return; }
    const price = Math.max(1, Math.floor((it.value || 0) / 2));
    if (S.weapon === id) S.weapon = null;
    if (S.armor === id) S.armor = null;
    delItem(id, 1);
    S.money += price;
    emit('sys', `卖掉${it.name}，得 ${price} 文。`);
    tick(1);
  }

  function cmdRest() {
    if (S.combat) { emit('sys', '这时候打坐，跟找死没两样。'); return; }
    if (!room().rest) {
      emit('sys', '这地方不对劲，坐不下去。');
      return;
    }
    S.hp = S.hpMax;
    S.mp = S.mpMax;
    tick(4);
    emit('good', '你在土地公裂开的笑脸底下坐下，闭眼。');
    emit('desc', '米是温的。风从门口进来，在你后颈上停了一停，又走了。');
    emit('sys', `气血 ${S.hp}/${S.hpMax}　真气 ${S.mp}/${S.mpMax}　—— 已复满。`);
  }

  function cmdStatus() {
    emit('divider', `${S.name}　${D.ranks[Math.min(S.lv - 1, D.ranks.length - 1)]} · ${S.lv} 重`);
    emit('item', `气血  ${S.hp}/${S.hpMax}　　真气  ${S.mp}/${S.mpMax}`);
    emit('item', `修为  ${S.exp}/${expNeed()}　　铜钱  ${S.money} 文`);
    emit('item', `攻击  ${totalAtk()}（基 ${S.atk}${weaponAtk() ? ' + 兵刃 ' + weaponAtk() : ''}）`);
    emit('item', `防御  ${totalDef()}（基 ${S.def}${armorDef() ? ' + 护身 ' + armorDef() : ''}）`);
    emit('item', `兵刃  ${S.weapon ? D.items[S.weapon].name : '空手'}　　护身  ${S.armor ? D.items[S.armor].name : '无'}`);
    emit('item', `所在  ${room().name}　　已行 ${S.steps} 步`);
    emit('sys', `时辰  ${CHIMES[S.chime]}。`);
  }

  function cmdSkills() {
    emit('divider', '招　式');
    S.learned.forEach((k, i) => {
      const sk = D.skills[k];
      emit('item', `${i + 1}. ${sk.name}　耗气 ${sk.cost}　—— ${sk.desc}`);
    });
    emit('hint', '（战斗中直接输入序号即可出招。）');
  }

  function cmdQuest() {
    emit('divider', '心　事');
    const q = [];
    if (!S.visited.gate) q.push(['active', '过江，去乌斯村。']);
    if (S.visited.gate && !S.flags.bossDead) q.push(['active', '查清三十年前那一夜，村里发生了什么。']);
    if (!S.learned.includes('lantern')) q.push(['', '土地庙的老庙祝，似乎有话要说。']);
    if (!S.flags.bossDead && isLocked('bamboo', 'north')) q.push(['', '竹林里的方井锁着，钥匙不知在谁手上。']);
    if (S.clues.stele) q.push(['done', '石碑上被凿掉的四个字。']);
    if (S.clues.mural) q.push(['done', '壁画上被凿掉的那张脸。']);
    if (S.clues.keeper) q.push(['done', '老庙祝守了三十年的东西。']);
    if (S.clues.boatman) q.push(['done', '老艄公不肯渡的那一条江。']);
    if (S.flags.bossDead) q.push(['active', '血玉在你手上。你要把它怎么样？']);
    if (!q.length) q.push(['', '暂时没有要办的事。']);
    q.forEach(([cls, txt]) => emit('item', (cls === 'done' ? '✓ ' : cls === 'active' ? '▸ ' : '· ') + txt));
  }

  function cmdHelp() {
    emit('divider', '指　令');
    emitKV([
      ['看 / look', '看看四周；看 石碑 / 看 野狗 可细看某物'],
      ['走 北 / n', '朝某方向走。方向可用 n s e w u d 或 北南东西上下'],
      ['拿 刀 / take', '拾起地上的东西'],
      ['用 药 / use', '服下丹药；读 信 可展信'],
      ['装备 刀 / 穿 袍', '换兵刃与护身'],
      ['打 野狗 / attack', '动手。战起后：a 普攻、1-5 出招、f 逃'],
      ['说话 老人 / talk', '与人对谈。多谈几次，话会不一样'],
      ['买 / 卖 / list', '货郎处交易'],
      ['休息 / rest', '只在土地庙可行，回满气血真气'],
      ['背包 / 属性 / 技能 / 任务', '查看自身'],
      ['地图 / 存档 / 读档', '舆图与存读'],
    ]);
    emit('hint', '提示：方向键可翻查历史命令；「再」重复上一条。');
  }

  function cmdMap() {
    emit('divider', '舆　图');
    emit('ascii', mapText());
  }

  function cmdWait() {
    tick(1);
    emit('sys', '你站了一会儿。');
    if (room().mobs && aliveMobs().length) {
      const m = D.mobs[aliveMobs()[0]];
      emit('desc', m.lines.idle[0]);
    } else {
      const r = room();
      emit('desc', pick([
        '风从远处过来，带着一点江水的腥。',
        '你听见自己的呼吸，很轻。',
        '有什么东西在你身后很远的地方，动了一下，又停了。',
        '天色没有变化。这里的天好像不会亮。'
      ]));
    }
  }

  /* ─────────────── 地图 ─────────────── */
  function mapModel() {
    const xs = [], ys = [];
    for (const id in D.rooms) {
      const r = D.rooms[id];
      if (r.noMap) continue;
      xs.push(r.pos[0]); ys.push(r.pos[1]);
    }
    const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    const rows = [];
    for (let y = minY; y <= maxY; y++) {
      const row = [];
      for (let x = minX; x <= maxX; x++) {
        let cell = null;
        for (const id in D.rooms) {
          const r = D.rooms[id];
          if (r.noMap) continue;
          if (r.pos[0] === x && r.pos[1] === y) {
            cell = { id: id, ch: cap(r.name), seen: !!S.visited[id], here: S.room === id, name: r.name };
            break;
          }
        }
        row.push(cell);
      }
      rows.push(row);
    }
    return { rows: rows, minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  function mapText() {
    const m = mapModel();
    const lines = [];
    m.rows.forEach((row) => {
      const segs = row.map((c) => {
        if (!c) return mapCell('');
        if (c.here) return mapCell('◆' + c.name);
        if (c.seen) return mapCell(' ' + c.name + ' ');
        return mapCell('  ·   ');
      });
      lines.push(segs.join(''));
    });
    lines.push('');
    const here = D.rooms[S.room];
    if (here && !here.noMap) lines.push('  ◆ 此处：' + here.name);
    const seen = Object.keys(D.rooms).filter((id) => !D.rooms[id].noMap && S.visited[id]).length;
    const total = Object.keys(D.rooms).filter((id) => !D.rooms[id].noMap).length;
    lines.push('  ■ 已探 ' + seen + '/' + total + '　　上北下南');
    return lines.join('\n');
  }

  /* ─────────────── 主解析 ─────────────── */

  function splitCmd(line) {
    const m = line.match(/^([^\s]+)\s*([\s\S]*)$/);
    if (!m) return { w: '', rest: '' };
    return { w: m[1], rest: m[2].trim() };
  }

  function handleCombat(line) {
    const l = line.trim().toLowerCase();
    const c = S.combat;
    const m = D.mobs[c.mobId];

    // 出招序号
    if (/^[1-9]$/.test(l)) {
      const i = parseInt(l, 10) - 1;
      const key = S.learned[i];
      if (!key) { emit('sys', '你没有这一式。'); return; }
      return castSkill(key);
    }
    if (l === 'a' || l === 'attack' || l === '打' || l === '攻' || l === '攻击' || l === '砍') {
      return battleAttack();
    }
    if (l === 'f' || l === 'flee' || l === '逃' || l === '跑' || l === '逃跑') {
      return tryFlee();
    }
    if (l.startsWith('用') || l.startsWith('吃') || l.startsWith('use')) {
      const arg = line.replace(/^(用|吃|use)/i, '').trim();
      return cmdUse(arg);
    }

    const { w, rest } = splitCmd(line);
    const cw = canon(w);

    if (cw === 'look') return cmdLook(rest);
    if (cw === 'inv') return cmdInv();
    if (cw === 'status') return cmdStatus();
    if (cw === 'skills') return cmdSkills();
    if (cw === 'help') return cmdHelp();
    if (cw === 'map') return cmdMap();
    if (cw === 'quest') return cmdQuest();
    if (cw === 'save') return save();
    if (cw === 'load') return load();
    if (cw === 'clear') { out = []; return; }

    // 直接方向 / 招式名
    const dir = normDir(w);
    if (dir) { emit('sys', '战斗正紧，你退不得。'); return; }
    for (let i = 0; i < S.learned.length; i++) {
      if (D.skills[S.learned[i]].name.indexOf(rest || w) >= 0) return castSkill(S.learned[i]);
    }

    emit('sys', '你只来得及攥紧兵器。（a 普攻 / 1-5 出招 / 用 药 / f 逃）');
  }

  function battleAttack() {
    const c = S.combat;
    const m = D.mobs[c.mobId];
    if (!S.weapon) emit('combat', '你赤手空拳。');
    const r = calcDmg(totalAtk(), m.def || 0, 1.0);
    c.hp -= r.v;
    if (chance(0.4)) emit('desc', pick(m.lines.hit));
    emit('combat', `你出拳，命中${m.name}，伤害 ${r.v}${r.crit ? '（要害）' : ''}。`);
    if (m.boss) bossBanter(c);
    if (c.hp <= 0) { c.hp = 0; return winCombat(); }
    S.mobState[S.room + '|' + c.mobId] = c.hp;
    c.turn++;
    tick(1);
    enemyTurn();
    if (S.combat) emitCombatFrame();
  }

  function castSkill(key) {
    const sk = D.skills[key];
    if (sk.quest && S.learned.indexOf(key) < 0) { emit('sys', '你还没学会这一式。'); return; }
    if (S.mp < sk.cost) { emit('bad', `真气不足，${sk.name}使不出来。`); return; }
    S.mp -= sk.cost;

    if (sk.type === 'restore') {
      S.mp = Math.min(S.mpMax, S.mp + sk.healMp);
      emit('combat', sk.verb + '，真气回了一些。');
      emit('sys', `真气 ${S.mp}/${S.mpMax}。`);
      tick(1);
      enemyTurn();
      if (S.combat) emitCombatFrame();
      return;
    }
    if (sk.type === 'buff') {
      S.buff = { dodge: sk.buff.dodge, turns: sk.buff.turns + 1 };
      emit('combat', sk.verb + '。');
      tick(1);
      enemyTurn();
      if (S.combat) emitCombatFrame();
      return;
    }
    hitMob(sk.mult, sk);
    tick(1);
    if (!S.combat) return;
    emitCombatFrame();
  }

  function tryFlee() {
    const c = S.combat;
    const m = D.mobs[c.mobId];
    if (m.boss) { emit('bad', '她的头发缠住了你的脚踝。你走不了。'); return; }
    const p = 0.4 + S.def * 0.02;
    if (chance(p)) {
      S.combat = null;
      S.buff = null;
      emit('combat', `你拔腿就跑，${m.name}在身后追了几步，停了。`);
      // 退回当前房间的任一出口
      const r = room();
      const d = Object.keys(r.exits)[0];
      if (d && r.exits[d]) { enterRoom(r.exits[d]); }
      else { enterRoom(D.start); }
    } else {
      emit('bad', '你转身想跑，脚下一绊。');
      enemyTurn();
      if (S.combat) emitCombatFrame();
    }
  }

  /* ─────────────── 结局输入 ─────────────── */
  function handleFinale(line) {
    const l = line.trim().toLowerCase().replace(/\s+/g, ' ');
    const head = l.split(' ')[0];
    const is = function () {
      for (let i = 0; i < arguments.length; i++) {
        if (l === arguments[i] || head === arguments[i]) return true;
      }
      return false;
    };
    if (is('封', '封印', '封住', '封了', 'seal')) return doEnding('dawn');
    if (is('吞', '吞下', '吞了', 'swallow')) return doEnding('usurp');
    if (is('走', '离开', '走了', 'walk', 'leave')) return doEnding('leave');
    if (is('还', '还给她', '还回去', 'truth')) {
      if (cluesAll()) return doEnding('truth');
      emit('sys', '你想说点什么，却发现自己知道的太少。话卡在喉咙里。');
      return;
    }
    if (is('看', 'look')) {
      emit('desc', '什么都没有。只有那点光，和两颗心跳。');
      return;
    }
    emit('sys', '你张了张嘴。──封 / 吞 / 走' + (cluesAll() ? ' / 还' : ''));
  }

  /* ─────────────── 存档 ─────────────── */
  function snapshot() {
    return JSON.parse(JSON.stringify(S, (k, v) => (k === 'combat' ? null : v)));
  }
  function serialize() { return JSON.stringify(snapshot()); }
  function restore(json) {
    try {
      const s = typeof json === 'string' ? JSON.parse(json) : json;
      if (!s || !s.room) return false;
      S = s;
      S.combat = null;
      out = [];
      return true;
    } catch (e) { return false; }
  }
  function save() {
    try {
      if (typeof localStorage === 'undefined') { emit('bad', '此间无处落笔。'); return; }
      localStorage.setItem('guixu.save.v1', serialize());
      emit('good', '—— 你把这半日的经历记在纸上，收进怀里。');
      emit('sys', '（存档已写入此机。）');
    } catch (e) { emit('bad', '存不下。'); }
  }
  function load() {
    try {
      if (typeof localStorage === 'undefined') { emit('bad', '此间无旧稿可读。'); return; }
      const raw = localStorage.getItem('guixu.save.v1');
      if (!raw) { emit('sys', '没有旧稿。'); return; }
      if (restore(raw)) {
        emit('good', '—— 你重新展开了那张纸。');
        describeRoom(false);
      } else {
        emit('bad', '旧稿已经糊了。');
      }
    } catch (e) { emit('bad', '读不出来。'); }
  }

  /* ─────────────── 入口 ─────────────── */

  function exec(line) {
    out = [];
    if (!S) { emit('bad', '（还没开始。）'); return out; }
    const raw = String(line || '').trim();
    if (!raw) return out;

    if (S.ended) {
      emit('sys', '—— 故事已经讲完了。');
      return out;
    }
    if (S.combat) {
      handleCombat(raw);
      return out;
    }
    if (S.finale) {
      handleFinale(raw);
      return out;
    }

    // 重复上一条
    let cmd = raw;
    if (cmd === '再' || cmd === 'again' || cmd === 'g') {
      cmd = S.lastCmd || 'look';
    }
    S.lastCmd = cmd;

    const { w, rest } = splitCmd(cmd);
    const cw = canon(w);

    // 方向直输
    const dir = normDir(w);
    if (!cw && dir) { cmdGo(dir); return out; }

    switch (cw) {
      case 'look': cmdLook(rest); break;
      case 'go': cmdGo(rest); break;
      case 'take': cmdTake(rest); break;
      case 'drop': cmdDrop(rest); break;
      case 'inv': cmdInv(); break;
      case 'status': cmdStatus(); break;
      case 'equip': cmdEquip(rest); break;
      case 'unequip': cmdUnequip(rest); break;
      case 'use': cmdUse(rest); break;
      case 'read': cmdRead(rest); break;
      case 'talk': cmdTalk(rest); break;
      case 'attack': {
        const mid = findMobInRoom(rest);
        if (!mid) { emit('sys', '这里没有可打的东西。'); break; }
        if (D.mobs[mid].boss && !S.flags.bossBegun) {
          S.flags.bossBegun = true;
          emit('desc', '你握住刀柄。她停止梳头，慢慢地站了起来。');
          emit('say', '「三十年了。」她说，「你是第一个敢把手放在刀上的人。」');
          emit('say', '「那就看看，你比他们多能撑几下。」');
        }
        tick(1);
        startCombat(mid);
        break;
      }
      case 'skills': cmdSkills(); break;
      case 'help': cmdHelp(); break;
      case 'map': cmdMap(); break;
      case 'quest': cmdQuest(); break;
      case 'rest': cmdRest(); break;
      case 'buy': cmdBuy(rest); break;
      case 'sell': cmdSell(rest); break;
      case 'save': save(); break;
      case 'load': load(); break;
      case 'wait': cmdWait(); break;
      case 'flee': emit('sys', '你不在战斗里。'); break;
      case 'look_me': cmdStatus(); break;
      case 'clear': out = []; break;
      default: {
        if (w === 'list' || w === '货') { cmdShopList(); break; }
        if (w === '东' || w === '西') { cmdGo(w); break; }
        emit('sys', '「' + raw + '」——听不懂。输入 help 看看能做什么。');
      }
    }
    return out;
  }

  function start(name) {
    S = newState(name);
    out = [];
    D.intro.forEach((l) => emit('desc', l));
    emit('divider', '— 卷 一 · 长 夜 渡 —');
    enterRoom(D.start, true);
    emit('hint', '（输入 help 看指令；先「看」，再「说话 老艄公」。）');
    return { events: out, state: S };
  }

  function resumeFrom(json) {
    if (!restore(json)) return null;
    out = [];
    emit('good', '—— 旧稿重新展开。');
    describeRoom(false);
    return { events: out, state: S };
  }

  return {
    start: start,
    resumeFrom: resumeFrom,
    exec: exec,
    isLocked: isLocked,
    get: function () { return S; },
    serialize: serialize,
    mapModel: mapModel,
    mapText: mapText,
    hasSave: function () {
      try { return typeof localStorage !== 'undefined' && !!localStorage.getItem('guixu.save.v1'); }
      catch (e) { return false; }
    },
    wipe: function () {
      try { localStorage.removeItem('guixu.save.v1'); } catch (e) {}
    },
    CHIMES: CHIMES,
  };
})();
