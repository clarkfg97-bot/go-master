// 本地服务：静态文件 + GNU Go(GTP) 引擎桥接。运行：node server.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 5174;
// 云端（Render 会设置 PORT）监听所有网卡；本地只监听 127.0.0.1
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const TIMEOUT_MS = +process.env.GO_TIMEOUT || 25000;

// 引擎查找顺序：环境变量 → 随项目附带的 macOS 版 → 系统安装（Linux 容器里 apt 装在 /usr/games）
function findBin() {
  const cands = [process.env.GNUGO_BIN, path.join(ROOT, 'engine', 'gnugo-macos'), '/usr/games/gnugo', '/opt/homebrew/bin/gnugo', '/usr/local/bin/gnugo', 'gnugo'];
  for (const c of cands) {
    if (!c) continue;
    if (c.includes('/') && !fs.existsSync(c)) continue;
    if (spawnSync(c, ['--version'], { timeout: 3000 }).status === 0) return c;
  }
  return null;
}
const BIN = findBin();
if (!BIN) console.error('[警告] 没有找到 GNU Go 引擎：电脑无法落子。请安装 gnugo 或设置 GNUGO_BIN');

// 难度 → GNU Go level（0–10）
const LEVELS = {
  1: { name: '入门', level: 0 },
  2: { name: '初级', level: 2 },
  3: { name: '中级', level: 5 },
  4: { name: '高级', level: 8 },
  5: { name: '大师', level: 10 },
};

const COLS = 'ABCDEFGHJKLMNOPQRST';
const VERTEX = /^([A-HJ-T])(\d{1,2})$/;

// 每次请求起一个 gnugo 进程，重放整盘棋再回答——无状态、不怕悔棋和并发
let chain = Promise.resolve();
function runGtp(level, cmds) {
  const job = chain.then(() => _run(level, cmds));
  chain = job.catch(() => {});
  return job;
}
function _run(level, cmds) {
  return new Promise((resolve, reject) => {
    if (!BIN) return reject(new Error('服务器未安装 GNU Go 引擎'));
    const p = spawn(BIN, ['--mode', 'gtp', '--level', String(level), '--chinese-rules', '--positional-superko', '--forbid-suicide', '--cache-size', '16'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('引擎思考超时')); }, TIMEOUT_MS);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err = (err + d).slice(-500)));
    p.stdin.on('error', () => {});
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', () => {
      clearTimeout(timer);
      const blocks = out.split('\n\n').map((s) => s.trim()).filter(Boolean);
      if (blocks.length < cmds.length) return reject(new Error('引擎异常退出: ' + err.trim().split('\n').slice(-2).join(' ')));
      resolve(blocks.slice(0, cmds.length).map((b) => ({ ok: b[0] === '=', text: b.slice(1).trim() })));
    });
    p.stdin.end(cmds.join('\n') + '\nquit\n');
  });
}

const COLOR = { B: 'black', W: 'white' };

function parseReq(b) {
  const size = +b.size;
  if (![9, 13, 19].includes(size)) throw new Error('bad size');
  const komi = Number.isFinite(+b.komi) ? +b.komi : 7.5;
  const handicap = Math.max(0, Math.min(9, b.handicap | 0));
  const moves = Array.isArray(b.moves) ? b.moves : [];
  if (moves.length > 1200) throw new Error('too many moves');
  const setup = [`boardsize ${size}`, 'clear_board', `komi ${komi}`];
  if (handicap >= 2) setup.push(`fixed_handicap ${handicap}`);
  for (const m of moves) {
    const [c, v] = String(m).split(' ');
    const ok = (c === 'B' || c === 'W') && (v === 'pass' || (VERTEX.test(v) && COLS.indexOf(v[0]) < size && +v.slice(1) <= size));
    if (!ok) throw new Error('bad move ' + m);
    setup.push(`play ${COLOR[c]} ${v}`);
  }
  const color = b.color === 'W' ? 'white' : 'black';
  const level = (LEVELS[b.level] || LEVELS[3]).level;
  return { setup, color, level };
}

async function api(body) {
  const { setup, color, level } = parseReq(body);
  const run = async (extra, lv = level) => {
    const r = await runGtp(lv, [...setup, ...extra]);
    const bad = r.slice(0, setup.length).findIndex((x) => !x.ok);
    if (bad >= 0) throw new Error('引擎拒绝了第 ' + bad + ' 条指令: ' + r[bad].text);
    return r.slice(setup.length);
  };
  switch (body.op) {
    case 'genmove': {
      const [g] = await run([`genmove ${color}`]);
      if (!g.ok) throw new Error(g.text);
      return { move: g.text.toLowerCase() === 'pass' ? 'pass' : g.text.toLowerCase() === 'resign' ? 'resign' : g.text.toUpperCase() };
    }
    case 'hint': {  // 提示一律用最强档位；附带候选点
      const [g, t] = await run([`reg_genmove ${color}`, 'top_moves'], 10);
      const best = g.text.toLowerCase() === 'pass' ? 'pass' : g.text.toUpperCase();
      const cands = [];
      const parts = (t.ok ? t.text : '').split(/\s+/).filter(Boolean);
      for (let i = 0; i + 1 < parts.length && cands.length < 4; i += 2) if (VERTEX.test(parts[i]) && !isNaN(+parts[i + 1])) cands.push({ move: parts[i], value: +parts[i + 1] });
      return { best, candidates: cands };
    }
    case 'estimate': {
      const [s, inf] = await run(['estimate_score', 'initial_influence black influence_regions'], 10);
      const m = /([BW])\+([\d.]+)/.exec(s.text);
      const regions = (inf.ok ? inf.text : '').split('\n').map((l) => l.trim().split(/\s+/).map(Number));
      return { text: s.text, winner: m ? m[1] : null, margin: m ? +m[2] : 0, regions };
    }
    case 'final': {  // 终局死活判定
      const [d] = await run(['final_status_list dead'], 10);
      const stones = (d.ok ? d.text : '').split(/\s+/).filter((v) => VERTEX.test(v));
      return { dead: stones };
    }
    default: throw new Error('bad op');
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

let lastHit = Date.now();
const IDLE_MIN = +process.env.GO_IDLE_EXIT || 0;   // 本地 App 启动时设置：空闲这么多分钟后自动退出
if (IDLE_MIN) setInterval(() => { if (Date.now() - lastHit > IDLE_MIN * 60000) process.exit(0); }, 30000).unref();

http.createServer(async (req, res) => {
  lastHit = Date.now();
  try {
    if (req.method === 'POST' && req.url === '/api/go') {
      let body = '';
      for await (const c of req) { body += c; if (body.length > 200000) throw new Error('body too large'); }
      const r = await api(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(r));
    }
    if (req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
    if (req.url === '/api/levels') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ engine: !!BIN, levels: Object.entries(LEVELS).map(([k, v]) => ({ level: +k, name: v.name })) }));
    }
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = path.join(ROOT, 'public', p);
    if (!file.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403); return res.end(); }
    const data = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    console.error('[request error]', e.message);
    res.writeHead(e.code === 'ENOENT' ? 404 : 500);
    res.end(String(e.message));
  }
}).listen(PORT, HOST, () => console.log(`围棋大师已启动: http://localhost:${PORT}  引擎: ${BIN || '未找到'}`));

process.on('uncaughtException', (e) => console.error('[uncaught]', e));
process.on('SIGINT', () => process.exit());
