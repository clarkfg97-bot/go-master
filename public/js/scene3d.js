// 3D 场景：榧木棋盘、云子（黑玻璃/白蛤）、灯光与相机。棋盘固定俯视，黑棋在下方
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { starPoints } from './rules.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const COLS = 'ABCDEFGHJKLMNOPQRST';

// ---------- 程序化木纹 ----------
function woodCanvas(w, h, { base, dark, light, bands = 5, fibers = 900 }) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < bands * 6; i++) {
    const y0 = rnd(-20, h + 20), th = rnd(h * 0.01, h * 0.06), a = rnd(0.04, 0.12);
    const ph = rnd(0, 6.28), fr = rnd(0.002, 0.007), amp = rnd(4, 26);
    g.strokeStyle = Math.random() < 0.65 ? dark : light;
    g.globalAlpha = a; g.lineWidth = th; g.beginPath();
    for (let x = 0; x <= w; x += 16) { const y = y0 + Math.sin(x * fr + ph) * amp + Math.sin(x * fr * 3.7 + ph) * amp * 0.25; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  for (let i = 0; i < fibers; i++) {
    const y0 = rnd(0, h), a = rnd(0.03, 0.16), ph = rnd(0, 6.28), fr = rnd(0.003, 0.012), amp = rnd(2, 14);
    g.strokeStyle = Math.random() < 0.6 ? dark : light;
    g.globalAlpha = a; g.lineWidth = rnd(0.4, 1.8); g.beginPath();
    for (let x = 0; x <= w; x += 20) { const y = y0 + Math.sin(x * fr + ph) * amp; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  g.globalAlpha = 1;
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 12; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  return c;
}

function tex(canvas, repeat) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

const MARGIN = 1.0;   // 棋盘边缘到边线的距离（格）

function boardTexture(n) {
  const U = n === 19 ? 70 : n === 13 ? 96 : 130;
  const S = (n - 1) + 2 * MARGIN;
  const W = Math.round(S * U);
  const c = woodCanvas(W, W, { base: '#c78f3c', dark: '#7e4a1a', light: '#e6b867', bands: 5, fibers: 1100 });
  const g = c.getContext('2d');
  const p = (k) => (MARGIN + k) * U;
  const ink = '#2b1a0b';
  g.strokeStyle = ink; g.fillStyle = ink; g.lineCap = 'square';
  const lw = Math.max(1.6, U * 0.032);
  for (let k = 0; k < n; k++) {
    g.lineWidth = k === 0 || k === n - 1 ? lw * 1.9 : lw;
    g.beginPath(); g.moveTo(p(0), p(k)); g.lineTo(p(n - 1), p(k)); g.stroke();
    g.beginPath(); g.moveTo(p(k), p(0)); g.lineTo(p(k), p(n - 1)); g.stroke();
  }
  for (const [x, y] of starPoints(n)) { g.beginPath(); g.arc(p(x), p(y), U * 0.085, 0, 6.2832); g.fill(); }
  g.fillStyle = 'rgba(60,35,12,.7)'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `${U * 0.34}px "PingFang SC",sans-serif`;
  for (let k = 0; k < n; k++) {
    const l = COLS[k], nn = String(n - k);
    g.fillText(l, p(k), p(0) - U * 0.62); g.fillText(l, p(k), p(n - 1) + U * 0.62);
    g.fillText(nn, p(0) - U * 0.66, p(k)); g.fillText(nn, p(n - 1) + U * 0.66, p(k));
  }
  return tex(c);
}

// ---------- 文字精灵（气数 / 提示序号）----------
const spriteCache = {};
function labelTexture(text, kind) {
  const key = kind + text;
  if (spriteCache[key]) return spriteCache[key];
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const fills = { onBlack: ['rgba(0,0,0,0)', '#fff'], onWhite: ['rgba(0,0,0,0)', '#161210'], atari: ['#e0331f', '#fff'], warn: ['#e8902a', '#fff'], hint: ['#2e8fe0', '#fff'], hintBest: ['#1fa862', '#fff'] };
  const [bg, fg] = fills[kind];
  if (bg !== 'rgba(0,0,0,0)') {
    g.fillStyle = bg; g.beginPath(); g.arc(S / 2, S / 2, S * 0.4, 0, 6.2832); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 6; g.stroke();
  }
  g.font = `900 ${S * 0.58}px "PingFang SC",Arial,sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (bg === 'rgba(0,0,0,0)') { g.strokeStyle = fg === '#fff' ? '#000' : '#fff'; g.lineWidth = 8; g.strokeText(text, S / 2, S / 2 + 4); }
  g.fillStyle = fg; g.fillText(text, S / 2, S / 2 + 4);
  return (spriteCache[key] = tex(c));
}

export class Scene3D {
  constructor(container) {
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.82;
    container.appendChild(renderer.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color('#0d0805');
    scene.fog = new THREE.Fog('#0d0805', 32, 70);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
    const controls = this.controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.enablePan = false;
    controls.enableRotate = false; controls.zoomSpeed = 0.6;

    scene.add(new THREE.HemisphereLight('#ffe6c4', '#2a160a', 0.4));
    const key = this.key = new THREE.DirectionalLight('#ffe2bc', 2.1);
    key.position.set(-6, 16, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 3;
    scene.add(key);
    const lamp = new THREE.PointLight('#ffb15a', 70, 40, 1.6);
    lamp.position.set(3, 9, -3); scene.add(lamp);
    const rim = new THREE.DirectionalLight('#7f9bff', 0.3); rim.position.set(8, 6, -10); scene.add(rim);

    this.table = new THREE.Mesh(new THREE.PlaneGeometry(120, 120),
      new THREE.MeshStandardMaterial({ map: tex(woodCanvas(1024, 1024, { base: '#2b180c', dark: '#100803', light: '#5a351b', bands: 7, fibers: 1200 }), [6, 6]), roughness: 0.75, envMapIntensity: 0.3 }));
    this.table.rotation.x = -Math.PI / 2; this.table.receiveShadow = true;
    scene.add(this.table);

    this.frameTex = tex(woodCanvas(1024, 1024, { base: '#b98238', dark: '#6d4416', light: '#e3b46a', bands: 6, fibers: 900 }), [0.12, 0.12]);

    // 棋子共用资源
    const geo = new THREE.SphereGeometry(1, 48, 28);
    geo.scale(0.468, 0.205, 0.468);
    geo.translate(0, 0.205, 0);
    this.stoneGeo = geo;
    this.mats = {
      1: new THREE.MeshPhysicalMaterial({ color: '#0c0c0f', roughness: 0.4, metalness: 0.0, clearcoat: 0.2, clearcoatRoughness: 0.35, envMapIntensity: 0.3 }),
      2: new THREE.MeshPhysicalMaterial({ color: '#e6e1d3', roughness: 0.5, clearcoat: 0.15, clearcoatRoughness: 0.4, envMapIntensity: 0.55 }),
    };
    this.deadMats = {
      1: new THREE.MeshPhysicalMaterial({ color: '#0c0c0f', roughness: 0.3, transparent: true, opacity: 0.38, depthWrite: false }),
      2: new THREE.MeshPhysicalMaterial({ color: '#f1ede1', roughness: 0.5, transparent: true, opacity: 0.45, depthWrite: false }),
    };
    this.ghostMats = {
      1: new THREE.MeshStandardMaterial({ color: '#111', transparent: true, opacity: 0.5, depthWrite: false }),
      2: new THREE.MeshStandardMaterial({ color: '#fff', transparent: true, opacity: 0.55, depthWrite: false }),
    };
    this.stones = new THREE.Group(); scene.add(this.stones);
    this.marks = new THREE.Group(); scene.add(this.marks);
    this.ghost = new THREE.Mesh(geo, this.ghostMats[1]); this.ghost.visible = false; scene.add(this.ghost);
    this.badGhost = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.34, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ff3b2a', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    this.badGhost.visible = false; scene.add(this.badGhost);
    this.map = new Map();    // index -> mesh
    this.pulse = []; this.tweens = []; this.shake = 0;

    this.n = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- 棋盘 ----------
  setBoard(n) {
    if (this.boardGroup) { this.scene.remove(this.boardGroup); this.boardGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material?.map && o.material.map !== this.frameTex) o.material.map.dispose(); }); }
    this.n = n;
    const S = (n - 1) + 2 * MARGIN;
    const grp = this.boardGroup = new THREE.Group();
    const sw = S + 1.3, rr = 0.35, D = 0.8;
    const shape = new THREE.Shape();
    shape.moveTo(-sw / 2 + rr, -sw / 2);
    shape.lineTo(sw / 2 - rr, -sw / 2); shape.quadraticCurveTo(sw / 2, -sw / 2, sw / 2, -sw / 2 + rr);
    shape.lineTo(sw / 2, sw / 2 - rr); shape.quadraticCurveTo(sw / 2, sw / 2, sw / 2 - rr, sw / 2);
    shape.lineTo(-sw / 2 + rr, sw / 2); shape.quadraticCurveTo(-sw / 2, sw / 2, -sw / 2, sw / 2 - rr);
    shape.lineTo(-sw / 2, -sw / 2 + rr); shape.quadraticCurveTo(-sw / 2, -sw / 2, -sw / 2 + rr, -sw / 2);
    const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: true, bevelSize: 0.14, bevelThickness: 0.14, bevelSegments: 5, curveSegments: 10 }),
      new THREE.MeshStandardMaterial({ map: this.frameTex, roughness: 0.45, envMapIntensity: 0.7 }));
    slab.rotation.x = -Math.PI / 2; slab.position.y = -(D + 0.14);
    slab.castShadow = true; slab.receiveShadow = true;
    grp.add(slab);
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshStandardMaterial({ map: boardTexture(n), roughness: 0.4, envMapIntensity: 0.7 }));
    surf.rotation.x = -Math.PI / 2; surf.position.y = 0.002; surf.receiveShadow = true;
    grp.add(surf);
    this.scene.add(grp);
    this.table.position.y = -(D + 0.14) - 0.12;
    const h = S / 2 + 1.5, sc = this.key.shadow.camera;
    Object.assign(sc, { left: -h, right: h, top: h, bottom: -h, near: 1, far: 50 });
    sc.updateProjectionMatrix();
    this.clearStones(); this.clearMarks();
    this.refit();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1 ? 55 : 38;
    this.camera.updateProjectionMatrix();
    this.refit();
  }

  refit() {
    if (!this.n) return;
    const lp = document.getElementById('left').getBoundingClientRect();
    const rp = document.getElementById('right');
    const mobile = lp.width > innerWidth * 0.8;
    let x0 = 0, x1 = innerWidth, y0 = 0, y1 = innerHeight;
    if (mobile) y1 = lp.top;
    else { x0 = lp.right; if (rp && getComputedStyle(rp).display !== 'none') x1 = rp.getBoundingClientRect().left; }
    const freeW = Math.max(200, x1 - x0 - 16), freeH = Math.max(200, y1 - y0 - 16);
    this.camera.setViewOffset(innerWidth, innerHeight, innerWidth / 2 - (x0 + x1) / 2, innerHeight / 2 - (y0 + y1) / 2, innerWidth, innerHeight);
    const tn = Math.tan((this.camera.fov * Math.PI) / 360);
    const half = (this.n - 1) / 2 + MARGIN + 0.75;
    const d = Math.max((half * innerHeight) / (tn * freeH), (half * innerHeight) / (tn * freeW));
    this.camera.position.set(0, d, 0.01);
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = d * 0.45; this.controls.maxDistance = d * 1.7;
    this.controls.update();
  }

  pos(i) { const n = this.n, o = (n - 1) / 2; return new THREE.Vector3((i % n) - o, 0, Math.floor(i / n) - o); }

  pick(clientX, clientY) {
    const v = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(v, this.camera);
    const pt = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.15), pt)) return -1;
    const n = this.n, o = (n - 1) / 2;
    const x = Math.round(pt.x + o), y = Math.round(pt.z + o);
    if (x < 0 || x >= n || y < 0 || y >= n) return -1;
    return y * n + x;
  }

  // ---------- 棋子 ----------
  clearStones() { this.stones.clear(); this.map.clear(); this.ghost.visible = false; }

  makeStone(i, color) {
    const m = new THREE.Mesh(this.stoneGeo, this.mats[color]);
    m.castShadow = true; m.receiveShadow = true;
    m.position.copy(this.pos(i));
    m.rotation.y = Math.random() * 6.28;
    m.userData = { i, color };
    this.stones.add(m); this.map.set(i, m);
    return m;
  }

  async dropStone(i, color) {
    const m = this.makeStone(i, color);
    const y0 = 1.1;
    m.position.y = y0;
    await this.tween(0.22, (t) => { m.position.y = y0 * (1 - t * t); });
    m.position.y = 0;
    await this.tween(0.12, (t) => { const s = 1 + Math.sin(t * Math.PI) * 0.06; m.scale.set(s, 1 - (s - 1) * 1.5, s); });
    m.scale.set(1, 1, 1);
  }

  async removeStone(i) {
    const m = this.map.get(i);
    if (!m) return;
    this.map.delete(i);
    const y0 = m.position.y;
    await this.tween(0.4, (t) => { m.position.y = y0 + Math.sin(t * Math.PI) * 0.7; m.scale.setScalar(1 - t * t); });
    this.stones.remove(m);
  }

  removeStoneNow(i) { const m = this.map.get(i); if (m) { this.stones.remove(m); this.map.delete(i); } }

  setDead(set) {
    for (const [i, m] of this.map) m.material = set.has(i) ? this.deadMats[m.userData.color] : this.mats[m.userData.color];
  }

  // ---------- 悬停预览 ----------
  showGhost(i, color, legal) {
    if (i < 0) { this.ghost.visible = false; this.badGhost.visible = false; return; }
    const p = this.pos(i);
    if (legal) {
      this.ghost.material = this.ghostMats[color];
      this.ghost.position.copy(p); this.ghost.visible = true; this.badGhost.visible = false;
    } else {
      this.ghost.visible = false;
      this.badGhost.position.copy(p); this.badGhost.position.y = 0.03; this.badGhost.visible = true;
    }
  }

  // ---------- 动画 ----------
  tween(dur, fn) { return new Promise((res) => this.tweens.push({ t: 0, dur, fn, res })); }

  // ---------- 标记 ----------
  clearMarks(kind) {
    for (const m of [...this.marks.children]) if (!kind || m.userData.kind === kind) this.marks.remove(m);
    this.pulse = this.pulse.filter((p) => p.obj.parent);
  }

  ring(i, { color, kind, inner = 0.4, outer = 0.5, pulse = false, y = 0.03, opacity = 0.95 }) {
    const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    m.position.copy(this.pos(i)); m.position.y = y; m.userData.kind = kind;
    this.marks.add(m);
    if (pulse) this.pulse.push({ obj: m, base: opacity });
    return m;
  }

  label(i, text, kind, { scale = 0.52, y = 0.5, tag = kind } = {}) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(text, kind), depthTest: false, transparent: true }));
    s.scale.setScalar(scale); s.position.copy(this.pos(i)); s.position.y = y; s.renderOrder = 10;
    s.userData.kind = tag;
    this.marks.add(s);
    return s;
  }

  showLast(i, color) {
    this.clearMarks('last');
    if (i == null || i < 0) return;
    this.ring(i, { color: color === 1 ? '#ff6a4d' : '#d8321f', kind: 'last', inner: 0.3, outer: 0.38, y: 0.39, opacity: 1 });
  }

  // groups: [{stones, libs}, color]；显示每块棋的气数
  showLiberties(groups) {
    this.clearMarks('libs');
    for (const g of groups) {
      const n = g.libs.length;
      const best = g.stones[0];
      const text = n > 9 ? '9+' : String(n);
      const kind = n === 1 ? 'atari' : n === 2 ? 'warn' : g.color === 1 ? 'onBlack' : 'onWhite';
      this.label(best, text, kind, { scale: n <= 2 ? 0.56 : 0.5, y: 0.5, tag: 'libs' });
      if (n === 1) for (const s of g.stones) this.ring(s, { color: '#ff3b24', kind: 'libs', inner: 0.43, outer: 0.5, pulse: true, y: 0.05 });
    }
  }

  showHints(list) {   // [{i, rank}]
    this.clearMarks('hint');
    list.forEach(({ i, rank }) => {
      this.ring(i, { color: rank === 1 ? '#27c27a' : '#3da0f0', kind: 'hint', inner: 0.4, outer: 0.5, pulse: true });
      this.label(i, String(rank), rank === 1 ? 'hintBest' : 'hint', { scale: rank === 1 ? 0.6 : 0.5, y: 0.1, tag: 'hint' });
    });
  }

  // 数子/形势：owner(0/1/2) 的空点画小方块；influence 用半透明色块
  showTerritory(b, owner, n) {
    this.clearMarks('terr');
    const geo = new THREE.BoxGeometry(0.34, 0.06, 0.34);
    for (let i = 0; i < n * n; i++) {
      if (b[i] || !owner[i]) continue;
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: owner[i] === 1 ? '#101012' : '#f6f2e6', roughness: 0.4 }));
      m.position.copy(this.pos(i)); m.position.y = 0.03; m.userData.kind = 'terr'; m.castShadow = true;
      this.marks.add(m);
    }
  }

  showInfluence(b, regions, n) {
    this.clearMarks('infl');
    const geo = new THREE.PlaneGeometry(0.98, 0.98).rotateX(-Math.PI / 2);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = regions[y]?.[x] ?? 0, i = y * n + x;
      if (!v || Math.abs(v) >= 4 || b[i]) continue;   // 4 = 棋子本身
      const mine = v < 0;   // GNU Go：负为黑方势力，正为白方
      const a = [0, 0.07, 0.13, 0.2][Math.abs(v)] ?? 0.2;
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: mine ? '#000' : '#fff', transparent: true, opacity: a, depthWrite: false }));
      m.position.copy(this.pos(i)); m.position.y = 0.012; m.userData.kind = 'infl';
      this.marks.add(m);
    }
  }

  kick(amount = 0.12) { this.shake = amount; }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime;
    for (const tw of [...this.tweens]) {
      tw.t += dt;
      const k = Math.min(tw.t / tw.dur, 1);
      tw.fn(k);
      if (k >= 1) { this.tweens.splice(this.tweens.indexOf(tw), 1); tw.res(); }
    }
    for (const p of this.pulse) {
      const s = 0.65 + 0.35 * Math.sin(t * 6);
      p.obj.material.opacity = p.base * (0.5 + 0.5 * s);
    }
    if (this.shake > 0.002) {
      this.scene.position.set((Math.random() - 0.5) * this.shake, 0, (Math.random() - 0.5) * this.shake);
      this.shake *= 0.9;
    } else this.scene.position.set(0, 0, 0);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
