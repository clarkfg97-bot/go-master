// 围棋规则（中国规则）：数子法、禁止自杀、全局同形禁手（positional superko）
// 棋盘：Uint8Array(n*n)，下标 i = y*n + x，y=0 为最上一行；0 空 / 1 黑 / 2 白
export const EMPTY = 0, BLACK = 1, WHITE = 2;
export const opp = (c) => 3 - c;
export const colorName = (c) => (c === BLACK ? '黑' : '白');

const COLS = 'ABCDEFGHJKLMNOPQRST';   // GTP 坐标不含 I
export const toGtp = (n, i) => COLS[i % n] + (n - Math.floor(i / n));
export const fromGtp = (n, s) => {
  const m = /^([A-HJ-T])(\d{1,2})$/i.exec(s);
  if (!m) return -1;
  const x = COLS.indexOf(m[1].toUpperCase()), y = n - +m[2];
  return x < 0 || x >= n || y < 0 || y >= n ? -1 : y * n + x;
};
export const coordLabel = (n, i) => toGtp(n, i);

export function neighbors(n, i) {
  const x = i % n, y = (i / n) | 0, out = [];
  if (y > 0) out.push(i - n);
  if (x > 0) out.push(i - 1);
  if (x < n - 1) out.push(i + 1);
  if (y < n - 1) out.push(i + n);
  return out;
}

// 一块棋（连通同色子）及其“气”
export function groupAt(b, n, i) {
  const c = b[i], stones = [i], seen = new Set([i]), libs = new Set();
  for (let k = 0; k < stones.length; k++) {
    for (const j of neighbors(n, stones[k])) {
      if (b[j] === EMPTY) libs.add(j);
      else if (b[j] === c && !seen.has(j)) { seen.add(j); stones.push(j); }
    }
  }
  return { color: c, stones, libs: [...libs] };
}

export const boardKey = (b) => b.join('');

// 尝试落子。seen：历史上出现过的全盘局面集合（用于同形禁手）
export function tryPlay(b, n, i, color, seen) {
  if (i < 0 || i >= n * n) return { ok: false, reason: 'range' };
  if (b[i] !== EMPTY) return { ok: false, reason: 'occupied' };
  const nb = Uint8Array.from(b);
  nb[i] = color;
  const captured = [];
  for (const j of neighbors(n, i)) {
    if (nb[j] === opp(color)) {
      const g = groupAt(nb, n, j);
      if (g.libs.length === 0) for (const s of g.stones) if (nb[s]) { nb[s] = EMPTY; captured.push(s); }
    }
  }
  if (groupAt(nb, n, i).libs.length === 0) return { ok: false, reason: 'suicide' };
  if (seen && seen.has(boardKey(nb))) return { ok: false, reason: 'ko' };
  return { ok: true, board: nb, captured };
}

export const REASON = {
  occupied: '这里已经有棋子了。',
  suicide: '禁入点：落子后这块棋没有气（中国规则禁止自杀）。',
  ko: '打劫！这手会让全盘回到以前出现过的局面，规则禁止。请先在别处走一手（找劫材）。',
};

// ---------- 走子分析（用于教学提示）----------
export function analyzeMove(before, n, i, color, after, captured) {
  const o = opp(color);
  const res = { captured: captured.length, atari: [], saved: [], connected: 0, selfAtari: 0, ko: false, libs: 0, size: 1, nearEdge: 0 };
  // 对方被打吃（落子后只剩 1 气）的棋
  const seen = new Set();
  for (const j of neighbors(n, i)) {
    if (after[j] === o && !seen.has(j)) {
      const g = groupAt(after, n, j);
      g.stones.forEach((s) => seen.add(s));
      if (g.libs.length === 1) res.atari.push(g.stones.length);
    }
  }
  // 己方原本被打吃、现在逃出的棋
  const seen2 = new Set();
  for (const j of neighbors(n, i)) {
    if (before[j] === color && !seen2.has(j)) {
      const g = groupAt(before, n, j);
      g.stones.forEach((s) => seen2.add(s));
      res.connected++;
      if (g.libs.length === 1) {
        const g2 = groupAt(after, n, j);
        if (g2.libs.length > 1) res.saved.push(g.stones.length);
      }
    }
  }
  const me = groupAt(after, n, i);
  res.libs = me.libs.length; res.size = me.stones.length;
  if (me.libs.length === 1) res.selfAtari = me.stones.length;
  if (captured.length === 1 && me.stones.length === 1 && me.libs.length === 1) res.ko = true;
  const x = i % n, y = (i / n) | 0;
  res.nearEdge = Math.min(x, y, n - 1 - x, n - 1 - y);   // 0=一线
  return res;
}

// ---------- 数子（中国规则：棋子 + 围住的空点；死子先提走）----------
export function areaScore(b, n, deadStones) {
  const t = Uint8Array.from(b);
  for (const i of deadStones) t[i] = EMPTY;
  const owner = new Uint8Array(n * n);   // 0 无主 / 1 黑 / 2 白（含活子所占点）
  let black = 0, white = 0;
  const seen = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    if (t[i] === BLACK) { owner[i] = BLACK; black++; }
    else if (t[i] === WHITE) { owner[i] = WHITE; white++; }
    else if (!seen[i]) {
      const region = [i]; seen[i] = 1;
      let touchB = false, touchW = false;
      for (let k = 0; k < region.length; k++) {
        for (const j of neighbors(n, region[k])) {
          if (t[j] === BLACK) touchB = true;
          else if (t[j] === WHITE) touchW = true;
          else if (!seen[j]) { seen[j] = 1; region.push(j); }
        }
      }
      const who = touchB && !touchW ? BLACK : touchW && !touchB ? WHITE : 0;
      if (who) { for (const s of region) owner[s] = who; if (who === BLACK) black += region.length; else white += region.length; }
    }
  }
  return { black, white, owner };
}

// ---------- 让子（与 GTP fixed_handicap 位置一致）----------
export function handicapPoints(n, h) {
  if (h < 2) return [];
  const d = n >= 13 ? 4 : 3, lo = d, hi = n + 1 - d, mid = (n + 1) / 2;
  const P = (cx, cy) => (n - cy) * n + (cx - 1);   // cx 列(1起)、cy 自下往上行(1起)
  const BL = P(lo, lo), TR = P(hi, hi), TL = P(lo, hi), BR = P(hi, lo);
  const L = P(lo, mid), R = P(hi, mid), T = P(mid, hi), Bt = P(mid, lo), C = P(mid, mid);
  const seq = { 2: [BL, TR], 3: [BL, TR, TL], 4: [BL, TR, TL, BR], 5: [BL, TR, TL, BR, C], 6: [BL, TR, TL, BR, L, R], 7: [BL, TR, TL, BR, L, R, C], 8: [BL, TR, TL, BR, L, R, T, Bt], 9: [BL, TR, TL, BR, L, R, T, Bt, C] };
  return seq[Math.min(9, h)] || [];
}

// 星位（用于画棋盘）
export function starPoints(n) {
  if (n === 9) return [[2, 2], [6, 2], [4, 4], [2, 6], [6, 6]];
  const lo = n === 13 ? 3 : 3, hi = n - 1 - lo, mid = (n - 1) / 2;
  return [[lo, lo], [hi, lo], [lo, hi], [hi, hi], [lo, mid], [hi, mid], [mid, lo], [mid, hi], [mid, mid]];
}

// 棋谱 SGF
export function toSgf({ n, komi, handicap, hStones, moves, result }) {
  const c = (i) => String.fromCharCode(97 + (i % n)) + String.fromCharCode(97 + ((i / n) | 0));
  let s = `(;GM[1]FF[4]CA[UTF-8]AP[围棋大师]SZ[${n}]KM[${komi}]RU[Chinese]HA[${handicap}]`;
  if (hStones.length) s += 'AB' + hStones.map((i) => `[${c(i)}]`).join('');
  if (result) s += `RE[${result}]`;
  for (const m of moves) s += `;${m.color === BLACK ? 'B' : 'W'}[${m.i < 0 ? '' : c(m.i)}]`;
  return s + ')';
}
