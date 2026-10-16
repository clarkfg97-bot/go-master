// 全部音效用 WebAudio 合成，无需外部音频文件
let ac, master, noise;
let enabled = true;

function init() {
  if (ac) return;
  ac = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ac.createDynamicsCompressor();
  master = ac.createGain();
  master.gain.value = 0.9;
  master.connect(comp).connect(ac.destination);
  noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function unlock() { init(); if (ac.state === 'suspended') ac.resume(); }
export function setEnabled(v) { enabled = v; }
export const isEnabled = () => enabled;

function env(g, t, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

// 木质敲击：带通噪声 + 低频“咚”
function clack(t, { gain = 0.7, freq = 1800, thump = 170, len = 0.07 } = {}) {
  const src = ac.createBufferSource();
  src.buffer = noise;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.3;
  const g = ac.createGain();
  env(g, t, gain, 0.001, len);
  src.connect(bp).connect(g).connect(master);
  src.start(t, Math.random() * 0.5, len + 0.05);

  const o = ac.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(thump, t);
  o.frequency.exponentialRampToValueAtTime(thump * 0.55, t + 0.1);
  const og = ac.createGain();
  env(og, t, gain * 0.9, 0.002, 0.11);
  o.connect(og).connect(master);
  o.start(t); o.stop(t + 0.2);
}

function tone(t, freq, { type = 'sine', gain = 0.3, attack = 0.005, decay = 0.6, lp } = {}) {
  const o = ac.createOscillator();
  o.type = type; o.frequency.value = freq;
  const g = ac.createGain();
  env(g, t, gain, attack, decay);
  let node = o;
  if (lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
  node.connect(g).connect(master);
  o.start(t); o.stop(t + attack + decay + 0.05);
}

export function play(name) {
  if (!enabled) return;
  init();
  if (ac.state === 'suspended') ac.resume();
  const t = ac.currentTime + 0.005;
  switch (name) {
    case 'select': clack(t, { gain: 0.25, freq: 3200, thump: 260, len: 0.03 }); break;
    case 'move': clack(t); break;
    case 'stone': clack(t, { gain: 0.55, freq: 2600, thump: 230, len: 0.045 }); break;   // 棋子落在榧木盘上的清脆“啪”
    case 'atari': [880, 1175].forEach((f, i) => tone(t + i * 0.09, f, { type: 'triangle', gain: 0.22, decay: 0.35 })); break;
    case 'pass': tone(t, 330, { type: 'sine', gain: 0.2, decay: 0.35 }); break;
    case 'capture':
      clack(t, { gain: 1, freq: 1400, thump: 130, len: 0.1 });
      clack(t + 0.07, { gain: 0.6, freq: 2200, thump: 200, len: 0.06 });
      break;
    case 'check': // 铜锣 + 警报双音
      [220, 331, 442, 667, 891].forEach((f, i) => tone(t, f, { gain: 0.22 / (1 + i * 0.5), decay: 1.6 - i * 0.18 }));
      tone(t + 0.02, 110, { gain: 0.35, decay: 1.4 });
      [0, 0.17, 0.4, 0.57].forEach((dt, i) => tone(t + 0.1 + dt, i % 2 ? 660 : 880, { type: 'square', gain: 0.1, decay: 0.12, lp: 1800 }));
      break;
    case 'win':
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(t + i * 0.13, f, { type: 'triangle', gain: 0.3, decay: 0.9 }));
      break;
    case 'lose':
      [392, 349.2, 311.1, 261.6].forEach((f, i) => tone(t + i * 0.28, f, { type: 'sawtooth', gain: 0.16, decay: 0.8, lp: 900 }));
      break;
    case 'undo': {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(700, t);
      o.frequency.exponentialRampToValueAtTime(180, t + 0.28);
      const g = ac.createGain();
      env(g, t, 0.18, 0.01, 0.3);
      o.connect(g).connect(master);
      o.start(t); o.stop(t + 0.4);
      break;
    }
    case 'new': [392, 523.25, 659.25].forEach((f, i) => tone(t + i * 0.09, f, { type: 'triangle', gain: 0.2, decay: 0.5 })); break;
    case 'error': tone(t, 140, { type: 'square', gain: 0.08, decay: 0.15, lp: 500 }); break;
  }
}
