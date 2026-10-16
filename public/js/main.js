import { BLACK, WHITE, opp, colorName, toGtp, fromGtp, tryPlay, boardKey, groupAt, analyzeMove, areaScore, handicapPoints, toSgf, REASON } from './rules.js';
import { Scene3D } from './scene3d.js';
import * as sound from './sound.js';

const MAX_UNDO = 5;
const $ = (id) => document.getElementById(id);
const view = new Scene3D($('stage'));

// ---------- 对局状态 ----------
let n = 9, b, turn = BLACK, player = BLACK, level = 3, komi = 7.5, handicap = 0, hStones = [];
let history = [];            // {color, i(-1=停手), captured[], board, caps:{1,2}, note}
let seen = new Set();        // 出现过的全盘局面（同形禁手）
let caps = { 1: 0, 2: 0 };
let undosLeft = MAX_UNDO;
let busy = false, over = false, scoring = false, dead = new Set();
let libsOn = true, pending = -1, gameId = 0, hover = -1;
let engineOk = true;

const label = (i) => (i < 0 ? '停手' : toGtp(n, i));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const meName = () => colorName(player);

function setStatus(text, think = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('think', think);
}

function banner(text, cls, ms = 0) {
  const el = $('banner');
  el.className = ''; void el.offsetWidth;
  el.textContent = text; el.className = cls;
  if (ms) setTimeout(() => { if (el.textContent === text) el.className = ''; }, ms);
}
const hideBanner = () => { $('banner').className = ''; };
$('banner').addEventListener('click', hideBanner);

function updateUI() {
  $('undoLeft').textContent = undosLeft;
  const mine = history.some((h) => h.color === player);
  $('btnUndo').disabled = undosLeft <= 0 || !mine || (busy && !over && !scoring);
  const myTurn = !busy && !over && !scoring && turn === player;
  $('btnHint').disabled = !myTurn;
  $('btnPass').disabled = !myTurn;
  $('btnEst').disabled = !myTurn;
  $('btnResign').disabled = over;
  $('capB').textContent = caps[BLACK]; $('capW').textContent = caps[WHITE];
  $('komiTxt').textContent = `贴目 ${komi}`;
  $('scoring').classList.toggle('show', scoring && !over);
  // 棋谱：每行 黑 / 白
  const box = $('moves');
  box.innerHTML = '';
  const rows = [];
  history.forEach((h, k) => {
    const cell = `<span class="${k === history.length - 1 ? 'cur' : ''}">${h.note}</span>`;
    const r = rows.at(-1);
    if (h.color === BLACK) rows.push({ b: cell, w: '' });
    else if (r && r.b && !r.w) r.w = cell;
    else rows.push({ b: '', w: cell });
  });
  rows.forEach((r, k) => {
    const d = document.createElement('div');
    d.innerHTML = `<span class="n">${k + 1}.</span><span>${r.b}</span><span>${r.w}</span>`;
    box.appendChild(d);
  });
  box.scrollTop = box.scrollHeight;
}

// 全盘“气数”标注
function refreshLibs() {
  view.clearMarks('libs');
  if (!libsOn || scoring || over) return;
  const done = new Set(), groups = [];
  for (let i = 0; i < n * n; i++) {
    if (b[i] && !done.has(i)) {
      const g = groupAt(b, n, i);
      g.stones.forEach((s) => done.add(s));
      groups.push(g);
    }
  }
  view.showLiberties(groups);
}

function clearOverlays() {
  view.clearMarks('hint'); view.clearMarks('infl');
  pending = -1; view.showGhost(-1);
}

// ---------- 新局 ----------
function fillHandicap() {
  const sel = $('handi'), keep = +sel.value || 0, max = +$('size').value === 9 ? 5 : 9;
  sel.innerHTML = '<option value="0">不让子</option>';
  for (let h = 2; h <= max; h++) sel.insertAdjacentHTML('beforeend', `<option value="${h}">让 ${h} 子</option>`);
  sel.value = keep <= max ? keep : 0;
}

function newGame() {
  gameId++;
  sound.unlock();
  n = +$('size').value; player = +$('side').value; level = +$('level').value;
  handicap = +$('handi').value;
  komi = handicap ? 0.5 : 7.5;
  b = new Uint8Array(n * n);
  hStones = handicapPoints(n, handicap);
  hStones.forEach((i) => (b[i] = BLACK));
  turn = hStones.length ? WHITE : BLACK;
  history = []; caps = { 1: 0, 2: 0 }; undosLeft = MAX_UNDO;
  seen = new Set([boardKey(b)]);
  busy = false; over = false; scoring = false; dead = new Set(); pending = -1;
  hideBanner();
  view.setBoard(n);
  hStones.forEach((i) => view.makeStone(i, BLACK));
  sound.play('new');
  refreshLibs(); updateUI();
  const first = hStones.length ? `黑棋已摆好 ${hStones.length} 个让子，白棋先走。` : '黑棋先走。';
  if (turn !== player) { setStatus(`新局开始，你执${meName()}。${first}`); aiTurn(); }
  else setStatus(`新局开始，你执${meName()}。${first}请落子。`);
}

// ---------- 走子 ----------
function movesForServer() {
  return history.map((h) => `${h.color === BLACK ? 'B' : 'W'} ${h.i < 0 ? 'pass' : toGtp(n, h.i)}`);
}

function describe(color, a) {
  const p = [];
  if (a.captured) p.push(`提掉对方 ${a.captured} 子`);
  if (a.ko) p.push('形成「劫」，对方不能立即提回');
  if (a.atari.length) p.push(`打吃对方 ${sum(a.atari)} 子（只剩一口气）`);
  if (a.saved.length) p.push(`救出了被打吃的 ${sum(a.saved)} 子`);
  if (a.selfAtari && !a.captured) p.push(color === player ? `⚠ 这块棋（${a.selfAtari} 子）只剩一口气，会被对方提掉` : `这块棋只剩一口气`);
  return p;
}

async function place(i, color) {
  busy = true;
  const gid = gameId;
  clearOverlays();
  let a = null, r = null;
  const before = b;
  if (i >= 0) {
    r = tryPlay(b, n, i, color, seen);
    if (!r.ok) { busy = false; return; }
    b = r.board; seen.add(boardKey(b));
    caps[color] += r.captured.length;
    a = analyzeMove(before, n, i, color, b, r.captured);
  }
  const lastPass = history.at(-1)?.i === -1;
  history.push({ color, i, captured: r?.captured ?? [], board: b, caps: { ...caps }, note: `${i < 0 ? '停手' : toGtp(n, i)}${r?.captured.length ? ' ×' + r.captured.length : ''}` });
  turn = opp(color);
  view.showLast(i, color);
  updateUI();

  if (i < 0) {
    sound.play('pass');
    if (lastPass) { setStatus('双方连续停手，对局结束，进入数子…', true); await startScoring(); return; }
    busy = false;
    setStatus(color === player ? '你停了一手。' : '电脑停了一手。若你也无棋可走，可点“停一手”结束对局。');
    if (turn !== player) aiTurn(); else updateUI();
    return;
  }

  const dropping = view.dropStone(i, color);
  await dropping;
  if (gid !== gameId) return;
  sound.play('stone');
  if (r.captured.length) {
    sound.play('capture'); view.kick(0.1);
    await Promise.all(r.captured.map((s) => view.removeStone(s)));
    if (gid !== gameId) return;
  }
  refreshLibs();
  if (a.atari.length) {
    sound.play('atari');
    banner(color === player ? '打吃!' : '被打吃!', 'atari', 1100);
  }
  const who = color === player ? '你' : '电脑';
  const parts = describe(color, a);
  const msg = `${who}下 ${label(i)}${parts.length ? '：' + parts.join('；') : ''}。`;
  busy = false;
  updateUI();
  if (turn !== player) { setStatus(msg, false); aiTurn(); }
  else setStatus(`${msg}轮到你（${meName()}）。`);
}

// ---------- 电脑 ----------
async function api(op, extra = {}) {
  const res = await fetch('/api/go', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, size: n, komi, handicap, moves: movesForServer(), color: turn === BLACK ? 'B' : 'W', level, ...extra }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function aiTurn(attempt = 1) {
  const gid = gameId;
  busy = true; updateUI();
  setStatus(attempt > 1 ? `电脑思考中（第 ${attempt} 次尝试）` : '电脑思考中', true);
  try {
    const t0 = performance.now();
    const r = await api('genmove');
    await new Promise((ok) => setTimeout(ok, Math.max(0, 500 - (performance.now() - t0))));
    if (gid !== gameId || over || scoring) return;
    if (r.move === 'resign') { endGame(player, '电脑认输'); return; }
    let i = r.move === 'pass' ? -1 : fromGtp(n, r.move);
    if (i >= 0 && !tryPlay(b, n, i, turn, seen).ok) { console.warn('电脑给出了非法着法', r.move); i = -1; }
    await place(i, turn);
  } catch (e) {
    if (gid !== gameId) return;
    if (attempt < 3) { setTimeout(() => { if (gid === gameId) aiTurn(attempt + 1); }, 2500); return; }
    busy = false; updateUI();
    setStatus('引擎连接失败：' + e.message + '。可点“停一手”或重新开局。');
  }
}

// ---------- 终局数子 ----------
function scoreNow() {
  const s = areaScore(b, n, dead);
  const diff = s.black - s.white - komi;
  return { ...s, diff };
}

function showScore() {
  view.setDead(dead);
  const s = scoreNow();
  view.showTerritory(b, s.owner, n);
  $('scoreNums').textContent = `黑 ${s.black} 子 · 白 ${s.white} 子 · 贴目 ${komi} → ${s.diff > 0 ? '黑胜' : '白胜'} ${Math.abs(s.diff)} 子`;
  return s;
}

async function startScoring() {
  const gid = gameId;
  scoring = true; busy = false; dead = new Set();
  view.clearMarks('libs'); view.clearMarks('last');
  updateUI();
  try {
    const r = await api('final');
    if (gid !== gameId) return;
    for (const v of r.dead) { const i = fromGtp(n, v); if (i >= 0 && b[i]) dead.add(i); }
    setStatus(dead.size ? `电脑判定有 ${dead.size} 个死子（半透明）。不同意可点击整块棋切换死活，确认后数子。` : '电脑判定盘上没有死子。点击棋子可切换死活，确认后数子。');
  } catch (e) {
    if (gid !== gameId) return;
    setStatus('电脑判定死活失败，请点击棋子手动标记死子，再确认数子。');
  }
  showScore();
}

function toggleDead(i) {
  if (!b[i]) return;
  const g = groupAt(b, n, i);
  const isDead = dead.has(i);
  g.stones.forEach((s) => (isDead ? dead.delete(s) : dead.add(s)));
  sound.play('select');
  showScore();
}

$('btnConfirm').onclick = () => {
  if (!scoring || over) return;
  const s = scoreNow();
  const winner = s.diff > 0 ? BLACK : WHITE;
  endGame(winner, `${colorName(winner)}胜 ${Math.abs(s.diff)} 子`, `${s.black} : ${s.white}（贴目 ${komi}）`, `${winner === BLACK ? 'B' : 'W'}+${Math.abs(s.diff)}`);
};

$('btnResume').onclick = () => {
  if (!scoring || over) return;
  scoring = false; dead = new Set();
  view.setDead(dead); view.clearMarks('terr');
  turn = opp(history.at(-1).color);
  refreshLibs(); updateUI();
  setStatus('继续下棋。');
  if (turn !== player) aiTurn();
};

let result = '';
function endGame(winner, how, detail = '', re = '') {
  over = true; busy = false; scoring = false;
  result = re || `${winner === BLACK ? 'B' : 'W'}+R`;
  const won = winner === player;
  sound.play(won ? 'win' : 'lose');
  banner(won ? `你赢了` : `你输了`, won ? 'win' : 'lose');
  setStatus(`${how}${detail ? '，' + detail : ''}。${won ? '恭喜！' : '可以悔棋继续，或复盘后再来一局。'}`);
  refreshLibs(); updateUI();
}

// ---------- 玩家输入 ----------
const pointers = new Set();
let down = null;
const canvas = view.renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  pointers.add(e.pointerId);
  down = pointers.size > 1 ? null : { x: e.clientX, y: e.clientY };
  sound.unlock();
});
canvas.addEventListener('pointercancel', (e) => pointers.delete(e.pointerId));
canvas.addEventListener('pointerup', (e) => {
  pointers.delete(e.pointerId);
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
  down = null;
  onPoint(view.pick(e.clientX, e.clientY), e.pointerType !== 'mouse');
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  if (busy || over || scoring || turn !== player) { view.showGhost(-1); return; }
  const i = view.pick(e.clientX, e.clientY);
  hover = i;
  if (i < 0 || b[i]) { view.showGhost(-1); return; }
  view.showGhost(i, player, tryPlay(b, n, i, player, seen).ok);
});
canvas.addEventListener('pointerleave', () => view.showGhost(-1));

function onPoint(i, touch) {
  if (i < 0) return;
  if (scoring && !over) { toggleDead(i); return; }
  if (busy || over || turn !== player) return;
  const r = tryPlay(b, n, i, player, seen);
  if (!r.ok) {
    sound.play('error');
    setStatus(REASON[r.reason] ?? '这里不能落子。');
    pending = -1; view.showGhost(-1);
    return;
  }
  if (touch && pending !== i) {          // 手机：第一下预览，再点同一处确认
    pending = i; view.showGhost(i, player, true);
    sound.play('select');
    setStatus(`预览 ${label(i)}：再点一次确认落子，点别处可更换。`);
    return;
  }
  place(i, player);
}

// ---------- 悔棋 ----------
function rebuildFromHistory() {
  view.clearStones();
  const last = history.at(-1);
  b = last ? Uint8Array.from(last.board) : (() => { const x = new Uint8Array(n * n); hStones.forEach((i) => (x[i] = BLACK)); return x; })();
  caps = last ? { ...last.caps } : { 1: 0, 2: 0 };
  const start = new Uint8Array(n * n); hStones.forEach((i) => (start[i] = BLACK));
  seen = new Set([boardKey(start), ...history.map((h) => boardKey(h.board))]);
  for (let i = 0; i < n * n; i++) if (b[i]) view.makeStone(i, b[i]);
}

function undo() {
  if (undosLeft <= 0 || !history.some((h) => h.color === player)) return;
  if (busy && !over && !scoring) return;
  gameId++;
  busy = false; scoring = false; over = false; dead = new Set();
  while (history.length) { const h = history.pop(); if (h.color === player) break; }
  undosLeft--;
  turn = player;
  hideBanner(); clearOverlays();
  view.clearMarks('terr'); view.clearMarks('last');
  rebuildFromHistory();
  const lastH = history.at(-1);
  view.showLast(lastH ? lastH.i : -1, lastH?.color);
  refreshLibs();
  sound.play('undo');
  updateUI();
  setStatus(`已悔棋，剩余 ${undosLeft} 次。轮到你走。`);
}

// ---------- 提示 / 形势 / 停手 ----------
function whyText(i) {
  const r = tryPlay(b, n, i, player, seen);
  if (!r.ok) return '';
  const a = analyzeMove(b, n, i, player, r.board, r.captured);
  const why = [];
  if (a.captured) why.push(`能提掉对方 ${a.captured} 子`);
  if (a.atari.length) why.push(`打吃对方 ${sum(a.atari)} 子，逼对方应对`);
  if (a.saved.length) why.push(`救出被打吃的 ${sum(a.saved)} 子`);
  if (!why.length) {
    const stones = b.reduce((c, v) => c + (v ? 1 : 0), 0);
    const x = i % n, y = (i / n) | 0, cx = Math.min(x, n - 1 - x), cy = Math.min(y, n - 1 - y);
    if (stones < Math.max(6, n)) why.push(cx <= 3 && cy <= 3 ? '占角：开局先占角部要点（金角银边草肚皮）' : a.nearEdge <= 3 ? '占据边上要点，与已有棋子呼应' : '占据开局大场');
    else if (a.connected >= 2) why.push('连接己方棋子，补掉断点');
    else if (a.nearEdge >= 4) why.push('向中腹发展，扩大势力');
    else why.push('围住边角实地，同时保持棋形');
  }
  if (a.selfAtari && !a.captured) why.push('⚠ 注意：这样走后这块棋只剩一口气');
  return why.join('；');
}

async function hint() {
  if (busy || over || scoring || turn !== player) return;
  busy = true; updateUI(); clearOverlays();
  setStatus('引擎正在为你推演', true);
  const gid = gameId;
  try {
    const r = await api('hint');
    if (gid !== gameId) return;
    if (r.best === 'pass') { setStatus('提示：引擎认为已经没有值得下的大棋，可以停一手；若盘上还有死活未定的地方，也可继续补强。'); }
    else {
      const best = fromGtp(n, r.best);
      const list = [best, ...r.candidates.map((c) => fromGtp(n, c.move)).filter((v) => v >= 0 && v !== best && !b[v])].slice(0, 3);
      view.showHints(list.map((i, k) => ({ i, rank: k + 1 })));
      setStatus(`提示：推荐 ${r.best}（绿色 1）— ${whyText(best)}。${list.length > 1 ? '蓝色 2、3 是备选。' : ''}`);
    }
  } catch (e) { setStatus('提示失败：' + e.message); }
  busy = false; updateUI();
}

async function estimate() {
  if (busy || over || scoring || turn !== player) return;
  busy = true; updateUI(); clearOverlays();
  setStatus('引擎正在估算形势', true);
  const gid = gameId;
  try {
    const r = await api('estimate');
    if (gid !== gameId) return;
    view.showInfluence(b, r.regions, n);
    const who = r.winner === 'B' ? '黑' : r.winner === 'W' ? '白' : '';
    const lead = who ? `${who}棋领先约 ${r.margin} 子（已含贴目 ${komi}）` : '双方接近';
    setStatus(`形势：${lead}。深色=黑的势力范围，浅色=白的。中盘估算有误差，仅供参考。`);
  } catch (e) { setStatus('估算失败：' + e.message); }
  busy = false; updateUI();
}

function pass() {
  if (busy || over || scoring || turn !== player) return;
  place(-1, player);
}

// ---------- 控件 ----------
$('btnNew').onclick = newGame;
$('btnUndo').onclick = undo;
$('btnHint').onclick = hint;
$('btnEst').onclick = estimate;
$('btnPass').onclick = pass;
$('btnResign').onclick = () => { if (!over && confirm('确定认输吗？')) endGame(opp(player), `${meName()}认输，${colorName(opp(player))}胜`, '', `${player === BLACK ? 'W' : 'B'}+R`); };
$('btnMenu').onclick = () => $('settings').classList.toggle('open');
$('btnLibs').onclick = () => { libsOn = !libsOn; $('btnLibs').classList.toggle('on', libsOn); refreshLibs(); };
$('btnLearn').onclick = () => $('learn').classList.add('open');
$('learnClose').onclick = () => $('learn').classList.remove('open');
$('learn').addEventListener('click', (e) => { if (e.target === $('learn')) $('learn').classList.remove('open'); });
new ResizeObserver(() => view.refit()).observe($('left'));
$('btnView').onclick = () => view.refit();
$('btnSound').onclick = () => {
  sound.setEnabled(!sound.isEnabled());
  $('btnSound').textContent = '音效：' + (sound.isEnabled() ? '开' : '关');
};
$('level').onchange = () => { level = +$('level').value; };
$('size').onchange = fillHandicap;
$('btnSgf').onclick = () => {
  const sgf = toSgf({ n, komi, handicap, hStones, moves: history, result: over ? result : '' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([sgf], { type: 'application/x-go-sgf' }));
  a.download = `围棋大师-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.sgf`;
  a.click(); URL.revokeObjectURL(a.href);
};
addEventListener('keydown', (e) => {
  if (e.key === 'z' && (e.metaKey || e.ctrlKey)) undo();
  if (e.key === 'Escape') $('learn').classList.remove('open');
});

fillHandicap();
fetch('/api/levels').then((r) => r.json()).then((j) => { engineOk = j.engine; if (!engineOk) setStatus('服务器没有找到 GNU Go 引擎，电脑无法落子。'); }).catch(() => {});
newGame();
$('loading').style.opacity = 0;
setTimeout(() => $('loading').remove(), 700);
window.__go = { place, get board() { return b; }, get turn() { return turn; }, get history() { return history; }, get n() { return n; }, onPoint, undo, view, get dead() { return dead; } };
