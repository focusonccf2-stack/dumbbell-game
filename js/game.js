// 啞鈴大力士 vs 紫雲魔王 — game logic
// 圖片放在 assets/images/，下面的 META 是各圖層的尺寸與位置（原圖像素）
const ASSETS = {
  body: 'assets/images/hero-body.png',
  arm: 'assets/images/hero-arm.png',
  dumbbell: 'assets/images/dumbbell.png',
  boss: 'assets/images/boss.png',
  heroFull: 'assets/images/hero.png',
};
const META = {"heroW": 1011, "heroH": 1517, "arm": [125, 297, 285, 420], "pivot": [367, 589], "db": [0, 205, 455, 352], "boss": [330, 428]};

(() => {
const W = 540, H = 900;
const WIN_HITS = 20, MAX_LIFE = 5;
const CHARGE_MAX = 1.1;          // seconds to full charge
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
let scale = 1, dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  scale = Math.min(innerWidth / W, innerHeight / H) * 0.98;
  cv.style.width = W * scale + 'px';
  cv.style.height = H * scale + 'px';
  cv.width = Math.round(W * scale * dpr);
  cv.height = Math.round(H * scale * dpr);
}
addEventListener('resize', resize); resize();

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - (1 - t) * (1 - t);

// ---------- geometry of the hero (original-pixel units → game units) ----------
const HERO_H = 180, K = HERO_H / META.heroH, HERO_W = META.heroW * K;
const toLocal = (ox, oy) => ({ x: -HERO_W / 2 + ox * K, y: -HERO_H + oy * K });
const PIV = toLocal(META.pivot[0], META.pivot[1]);
const ARM = { ...toLocal(META.arm[0], META.arm[1]), w: META.arm[2] * K, h: META.arm[3] * K };
const DBL = { ...toLocal(META.db[0], META.db[1]), w: META.db[2] * K, h: META.db[3] * K };
const DBC = { x: DBL.x + DBL.w / 2, y: DBL.y + DBL.h / 2 };
const DB_RATIO = META.db[3] / META.db[2];
const BOSS_W = 190, BOSS_H = BOSS_W * META.boss[1] / META.boss[0];
const BOSS_TOP = 96;
const SHOT_W = 62;

// ---------- assets ----------
function loadImg(src) { return new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; }); }
let IM = {};
function tint(im, color) {
  const c = document.createElement('canvas');
  c.width = im.naturalWidth; c.height = im.naturalHeight;
  const x = c.getContext('2d');
  x.drawImage(im, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  return c;
}
function makeFlame(inner, mid) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner); g.addColorStop(0.35, mid); g.addColorStop(1, 'rgba(255,40,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return c;
}
const FLAME = makeFlame('rgba(255,215,90,1)', 'rgba(255,110,15,0.8)');
const FLAME_HOT = makeFlame('rgba(255,245,170,1)', 'rgba(240,50,10,0.85)');

// ---------- audio ----------
let AC = null, master, musicGain, sfxGain, noiseBuf;
let musicOn = true;
function ensureAC() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return AC; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.9; master.connect(AC.destination);
    musicGain = AC.createGain(); musicGain.gain.value = 0.22; musicGain.connect(master);
    sfxGain = AC.createGain(); sfxGain.gain.value = 1; sfxGain.connect(master);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { AC = null; }
  return AC;
}
function tone(f0, f1, dur, type, vol, delay = 0, dest) {
  if (!ensureAC()) return;
  const n = AC.currentTime + delay;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.connect(g); g.connect(dest || sfxGain);
  o.frequency.setValueAtTime(f0, n);
  o.frequency.exponentialRampToValueAtTime(f1, n + dur);
  g.gain.setValueAtTime(vol, n);
  g.gain.exponentialRampToValueAtTime(0.001, n + dur);
  o.start(n); o.stop(n + dur + 0.03);
}
function noise(t, dur, type, freq, q, vol, dest, freqEnd) {
  const s = AC.createBufferSource(); s.buffer = noiseBuf;
  const f = AC.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(dest || sfxGain);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}
function distCurve(k) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
  return c;
}

// Deep male shout ("Ha!" / "喝啊！"), synthesized with formant filters. p = charge 0..1
function shout(p) {
  if (!ensureAC()) return;
  const n = AC.currentTime, dur = 0.24 + p * 0.42;
  const f0 = 112 - p * 22;
  const src = AC.createGain();
  const o1 = AC.createOscillator(); o1.type = 'sawtooth';
  o1.frequency.setValueAtTime(f0 * 1.3, n);
  o1.frequency.linearRampToValueAtTime(f0 * 1.08, n + 0.07);
  o1.frequency.linearRampToValueAtTime(f0 * 0.8, n + dur);
  const lfo = AC.createOscillator(), lg = AC.createGain();
  lfo.frequency.value = 6.5; lg.gain.value = 2 + p * 5; lfo.connect(lg); lg.connect(o1.frequency);
  o1.connect(src);
  const o2 = AC.createOscillator(); o2.type = 'sawtooth';        // sub growl
  o2.frequency.setValueAtTime(f0 * 0.5 * 1.3, n);
  o2.frequency.linearRampToValueAtTime(f0 * 0.5 * 0.8, n + dur);
  const g2 = AC.createGain(); g2.gain.value = 0.15 + 0.35 * p; o2.connect(g2); g2.connect(src);
  const sh = AC.createWaveShaper(); sh.curve = distCurve(4 + 26 * p); src.connect(sh);
  const out = AC.createGain();
  out.gain.setValueAtTime(0.0001, n);
  out.gain.exponentialRampToValueAtTime(0.9, n + 0.03);
  out.gain.setValueAtTime(0.9, n + dur * 0.55);
  out.gain.exponentialRampToValueAtTime(0.001, n + dur);
  // "ah" formants for an adult male, with an h→a glide on F1
  const F = [[650, 7, 1], [1080, 9, 0.55], [2450, 11, 0.2], [3300, 12, 0.08]];
  F.forEach(([fq, q, gv], i) => {
    const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
    if (i === 0) { bp.frequency.setValueAtTime(420, n); bp.frequency.linearRampToValueAtTime(fq, n + 0.06); }
    else bp.frequency.value = fq;
    const g = AC.createGain(); g.gain.value = gv * 3;
    sh.connect(bp); bp.connect(g); g.connect(out);
  });
  const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800;
  out.connect(lp); lp.connect(sfxGain);
  noise(n, 0.09, 'bandpass', 1300, 0.8, 0.35 + 0.2 * p);           // breathy "H"
  noise(n + 0.03, dur * 0.8, 'bandpass', 900, 1.2, 0.05 + 0.06 * p); // breath under the voice
  [o1, o2, lfo].forEach(o => { o.start(n); o.stop(n + dur + 0.05); });
}

// Charging hum (rises with charge)
let chargeSnd = null;
function chargeStart() {
  if (!ensureAC() || chargeSnd) return;
  const o = AC.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 70;
  const o2 = AC.createOscillator(); o2.type = 'square'; o2.frequency.value = 140;
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400; f.Q.value = 6;
  const g = AC.createGain(); g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.06, AC.currentTime + 0.1);
  const g2 = AC.createGain(); g2.gain.value = 0.3;
  o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(sfxGain);
  o.start(); o2.start();
  chargeSnd = { o, o2, f, g, maxed: false };
}
function chargeUpdate(c) {
  if (!chargeSnd) return;
  const t = AC.currentTime;
  chargeSnd.o.frequency.setTargetAtTime(70 + c * 120, t, 0.03);
  chargeSnd.o2.frequency.setTargetAtTime(140 + c * 260, t, 0.03);
  chargeSnd.f.frequency.setTargetAtTime(400 + c * 2200, t, 0.03);
  if (Math.random() < c * 0.5) noise(t, 0.03, 'highpass', 3000, 1, 0.04 * c);   // fire crackle
  if (c >= 1 && !chargeSnd.maxed) { chargeSnd.maxed = true; tone(880, 1760, 0.15, 'triangle', 0.1); }
}
function chargeStop() {
  if (!chargeSnd) return;
  const t = AC.currentTime, s = chargeSnd; chargeSnd = null;
  s.g.gain.cancelScheduledValues(t); s.g.gain.setValueAtTime(s.g.gain.value, t);
  s.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  s.o.stop(t + 0.08); s.o2.stop(t + 0.08);
}

const sfx = {
  throw: p => { if (!ensureAC()) return; noise(AC.currentTime, 0.18 + p * 0.25, 'bandpass', 400, 1.5, 0.15 + 0.25 * p, null, 2400); },
  grab: () => tone(500, 900, 0.07, 'sine', 0.06),
  hit: p => { tone(220, 60, 0.22, 'square', 0.12 + 0.06 * p); tone(660, 300, 0.12, 'triangle', 0.08); if (AC) noise(AC.currentTime, 0.25, 'lowpass', 1200, 1, 0.2 * p); },
  pop: () => tone(650, 1300, 0.11, 'sine', 0.12),
  cloud: () => tone(200, 280, 0.14, 'sine', 0.05),
  hurt: () => tone(320, 80, 0.4, 'sawtooth', 0.1),
  win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f * 1.01, 0.26, 'triangle', 0.13, i * 0.13)),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, f * 0.98, 0.3, 'triangle', 0.12, i * 0.18)),
};

// ---------- boss battle music (A minor: Am – F – G – E) ----------
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const ROOTS = [45, 41, 43, 40];
const BASS = [0, null, 0, 12, 0, null, 0, 12, 0, null, 0, 12, 0, 12, 7, 12];
const LEAD = [
  69, null, 72, 76, null, 74, 72, null, 71, null, 72, null, 69, null, null, null,
  65, null, 69, 72, null, 74, 72, null, 69, null, 67, null, 65, null, null, null,
  67, null, 71, 74, null, 76, 74, null, 71, null, 74, null, 79, null, 77, null,
  76, null, 74, null, 72, null, 71, null, 68, null, 71, null, 76, null, null, null,
];
const Music = { active: false, next: 0, step: 0, timer: null };
function musicStart() {
  if (!ensureAC()) return;
  Music.active = true; Music.step = 0; Music.next = AC.currentTime + 0.08;
  if (!Music.timer) Music.timer = setInterval(musicTick, 25);
}
function musicStop() { Music.active = false; }
function musicTick() {
  if (!AC) return;
  if (!Music.active || !musicOn || paused) { Music.next = AC.currentTime + 0.05; return; }
  const bpm = [138, 148, 160][phase] || 138, sd = 60 / bpm / 4;
  while (Music.next < AC.currentTime + 0.12) {
    playStep(Music.step, Music.next, sd);
    Music.next += sd; Music.step = (Music.step + 1) % 64;
  }
}
function synth(t, freq, dur, type, vol, cutoff) {
  const o = AC.createOscillator(); o.type = type; o.frequency.value = freq;
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
  const g = AC.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f); f.connect(g); g.connect(musicGain);
  o.start(t); o.stop(t + dur + 0.02);
}
function playStep(step, t, sd) {
  const bar = (step / 16) | 0, s = step % 16;
  const b = BASS[s];
  if (b !== null) synth(t, mtof(ROOTS[bar] + b), sd * 0.95, 'sawtooth', 0.5, 700);
  const m = LEAD[step];
  if (m !== null) { synth(t, mtof(m), sd * 1.8, 'square', 0.22, 2600); synth(t, mtof(m - 12), sd * 1.8, 'triangle', 0.15, 2000); }
  // drums
  if (s === 0 || s === 8 || s === 10 || (phase === 2 && s === 14)) {
    const o = AC.createOscillator(), g = AC.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g); g.connect(musicGain); o.start(t); o.stop(t + 0.16);
  }
  if (s === 4 || s === 12) { noise(t, 0.13, 'bandpass', 1800, 0.7, 0.7, musicGain); }
  if (s % 2 === 0 || phase >= 1) noise(t, 0.03, 'highpass', 7000, 1, s % 2 ? 0.12 : 0.22, musicGain);
}

// ---------- state ----------
let state = 'loading', stateT = 0, paused = false;
let hero, boss, shots, clouds, parts, flames, texts, score, hits, life, playT, shake, phase = 0;
let best = 0;
try { best = +localStorage.getItem('dumbbell_best') || 0; } catch (e) {}
const mouse = { x: W / 2, y: H / 2, down: false, seen: false };
const keys = {};
let isTouch = false;
const touches = new Map();
const aimPt = { x: W / 2, y: 300 };
const BTN_L = { x: 64, y: H - 70, r: 46 }, BTN_R = { x: W - 64, y: H - 70, r: 46 };
const BTN_MUSIC = { x: 284, y: 33, r: 15 };

function reset() {
  hero = { x: W / 2, y: H - 26, vx: 0, tilt: 0, bob: 0, walk: 0, inv: 0, hurt: 0,
    armState: 'ready', armT: 0, arm: 0, armFrom: 0, holding: true, dbScale: 1, chargeT: 0, charge: 0, throwPower: 0 };
  boss = { x: W / 2, tx: W / 2, retarget: 1, flash: 0, cool: 1.8, bob: 0, die: 0, shakeX: 0 };
  shots = []; clouds = []; parts = []; flames = []; texts = [];
  score = 0; hits = 0; life = MAX_LIFE; playT = 0; shake = 0; phase = 0;
}
function setState(s) { state = s; stateT = 0; }
function startGame() { reset(); setState('play'); musicStart(); }

// hero-local → world, matching the drawing transform
function heroXform(lx, ly) {
  const c = Math.cos(hero.tilt), s = Math.sin(hero.tilt);
  ly -= hero.bob;
  return { x: hero.x + lx * c - ly * s, y: hero.y + lx * s + ly * c };
}
function handWorld() {
  const c = Math.cos(hero.arm), s = Math.sin(hero.arm);
  const vx = DBC.x - PIV.x, vy = DBC.y - PIV.y;
  return heroXform(PIV.x + vx * c - vy * s, PIV.y + vx * s + vy * c);
}
function aimHeld() {
  if (mouse.down || keys[' ']) return true;
  for (const t of touches.values()) if (t.role === 'aim') return true;
  return false;
}
function currentAim() {
  for (const t of touches.values()) if (t.role === 'aim') return { x: t.x, y: t.y };
  if (isTouch) return { x: aimPt.x, y: aimPt.y };
  if (mouse.seen) return { x: mouse.x, y: mouse.y };
  return { x: hero.x, y: 0 };
}

// ---------- effects ----------
function burst(x, y, n, colors, spd = 260, size = [3, 7]) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = rand(spd * 0.3, spd);
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 0.9),
      size: rand(size[0], size[1]), color: colors[(Math.random() * colors.length) | 0], star: Math.random() < 0.35 });
  }
}
function flame(x, y, size, vx = 0, vy = -60, hot = false) {
  flames.push({ x: x + rand(-6, 6), y: y + rand(-6, 6), vx: vx + rand(-30, 30), vy: vy + rand(-40, 10),
    size, life: rand(0.25, 0.5), max: 0.5, hot });
}
function popText(x, y, txt, color, size = 26) { texts.push({ x, y, txt, color, size, life: 1 }); }

// ---------- throwing ----------
function releaseThrow() {
  hero.throwPower = hero.charge;
  hero.armState = 'throw'; hero.armT = 0; hero.armFrom = hero.arm;
  chargeStop();
  shout(hero.throwPower);
}
function spawnShot() {
  const p = handWorld(), aim = currentAim(), pw = hero.throwPower;
  let dx = aim.x - p.x, dy = aim.y - p.y;
  if (dy > -30) dy = -30;
  const L = Math.hypot(dx, dy), sp = 560 + 900 * pw;
  shots.push({ x: p.x, y: p.y, vx: dx / L * sp, vy: dy / L * sp, a: 0, va: (dx >= 0 ? 1 : -1) * (9 + pw * 10),
    power: pw, size: SHOT_W * (1 + 0.35 * pw), pierce: pw >= 0.6, trail: [] });
  hero.holding = false;
  sfx.throw(pw);
  if (pw > 0.3) for (let i = 0; i < 6 * pw; i++) flame(p.x, p.y, 12 + 12 * pw, dx / L * 120, dy / L * 120, pw > 0.9);
}

function updateArm(dt) {
  const h = hero;
  switch (h.armState) {
    case 'ready': {
      const target = Math.sin(playT * 2.2) * 0.03;
      h.arm = lerp(h.arm, target, Math.min(1, dt * 12));
      if (aimHeld() && state === 'play') { h.armState = 'charge'; h.chargeT = 0; h.charge = 0; chargeStart(); }
      break;
    }
    case 'charge': {
      h.chargeT += dt;
      h.charge = Math.min(h.chargeT / CHARGE_MAX, 1);
      const target = -0.15 - 0.55 * easeOut(h.charge) + (h.charge > 0.5 ? rand(-1, 1) * 0.05 * h.charge : 0);
      h.arm = lerp(h.arm, target, Math.min(1, dt * 18));
      chargeUpdate(h.charge);
      const p = handWorld();
      if (Math.random() < 0.3 + h.charge) flame(p.x + rand(-16, 16), p.y + rand(-8, 8), 10 + 16 * h.charge, 0, -70 - 70 * h.charge, h.charge >= 1);
      if (h.charge > 0.6 && Math.random() < h.charge - 0.4) flame(p.x + rand(-18, 18), p.y + rand(-10, 10), 8 + 10 * h.charge, 0, -110, true);
      if (!aimHeld()) releaseThrow();
      break;
    }
    case 'throw': {            // fast swing forward
      h.armT += dt;
      const t = Math.min(h.armT / 0.07, 1);
      h.arm = lerp(h.armFrom, 0.65, easeOut(t));
      if (t >= 1) { spawnShot(); h.armState = 'follow'; h.armT = 0; }
      break;
    }
    case 'follow': {           // arm settles after release
      h.armT += dt;
      const t = Math.min(h.armT / 0.12, 1);
      h.arm = lerp(0.65, 0.1, t);
      if (t >= 1) { h.armState = 'grab'; h.armT = 0; }
      break;
    }
    case 'grab': {             // reach down, grab a new dumbbell, curl it back up
      h.armT += dt;
      const D = 0.26, t = Math.min(h.armT / D, 1);
      if (t < 0.5) { h.arm = lerp(0.1, -0.42, easeOut(t * 2)); }
      else {
        if (!h.holding) {
          h.holding = true; h.dbScale = 0; sfx.grab();
          const p = handWorld(); burst(p.x, p.y, 7, ['#fff6b0', '#ffd84a'], 100, [2, 4]);
        }
        h.arm = lerp(-0.42, 0, easeOut((t - 0.5) * 2));
      }
      if (h.holding) h.dbScale = Math.min(1, h.dbScale + dt / 0.07);
      if (t >= 1) { h.armState = 'ready'; h.dbScale = 1; }
      break;
    }
  }
}

// ---------- boss ----------
function bossThrow() {
  const sx = boss.x + rand(-30, 30), sy = BOSS_TOP + BOSS_H * 0.72;
  const hx = hero.x + hero.vx * rand(0.1, 0.45), hy = hero.y - HERO_H * 0.5;
  const speeds = [175, 210, 245];
  const n = [1, 2, 3][phase] + (phase === 2 && Math.random() < 0.3 ? 2 : 0);
  const base = Math.atan2(hy - sy, hx - sx);
  const spread = n === 1 ? 0 : 0.22;
  for (let i = 0; i < n; i++) {
    const a = base + (i - (n - 1) / 2) * spread + rand(-0.04, 0.04);
    const sp = speeds[phase] * rand(0.9, 1.1);
    clouds.push({ x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rand(20, 25), ph: Math.random() * 6, born: 0 });
  }
  sfx.cloud();
}
function hitBoss(s) {
  hits++;
  const pts = 100 + Math.round(s.power * 100);
  score += pts;
  boss.flash = 0.16; shake = Math.max(shake, 7 + 8 * s.power);
  burst(s.x, s.y, 18 + 14 * s.power, ['#ffd84a', '#fff3a8', '#ffb347', '#ffffff'], 320 + 120 * s.power);
  for (let i = 0; i < 8 * s.power; i++) flame(s.x, s.y, 20, rand(-150, 150), rand(-150, 60), true);
  popText(s.x, s.y - 10, s.power >= 1 ? `MAX! +${pts}` : `+${pts}`, '#ffcf33', s.power >= 1 ? 34 : 30);
  sfx.hit(s.power);
  const newPhase = hits >= 14 ? 2 : hits >= 7 ? 1 : 0;
  if (newPhase !== phase) {
    phase = newPhase;
    popText(boss.x, BOSS_TOP + 20, phase === 1 ? '可惡！看招！' : '我要認真了！！', '#b04cff', 30);
  }
  if (hits >= WIN_HITS) {
    setState('bossdie');
    for (const c of clouds) { burst(c.x, c.y, 10, ['#c58cff', '#e6ccff', '#8f5be0'], 200); score += 10; }
    clouds = [];
    chargeStop(); musicStop(); sfx.win();
  }
}
function hitHero(c) {
  if (hero.inv > 0) return;
  life--; hero.inv = 1.4; hero.hurt = 0.7; shake = Math.max(shake, 12);
  burst(c.x, c.y, 26, ['#a35bff', '#d1a6ff', '#6b2fc2', '#f0e0ff'], 240, [4, 10]);
  popText(hero.x, hero.y - HERO_H - 10, '被紫雲污染！', '#9b3cff', 26);
  sfx.hurt();
  if (life <= 0) { setState('lose'); chargeStop(); musicStop(); sfx.lose(); saveBest(); }
}
function saveBest() {
  if (score > best) { best = score; try { localStorage.setItem('dumbbell_best', best); } catch (e) {} }
}

// ---------- update ----------
function update(dt) {
  if (state === 'loading') return;
  stateT += dt;
  for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 420 * dt; p.vx *= 0.985; p.life -= dt; }
  parts = parts.filter(p => p.life > 0);
  for (const f of flames) { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.94; f.vy -= 60 * dt; f.life -= dt; }
  flames = flames.filter(f => f.life > 0);
  for (const tx of texts) { tx.y -= 50 * dt; tx.life -= dt * 0.9; }
  texts = texts.filter(tx => tx.life > 0);
  shake = Math.max(0, shake - dt * 40);

  if (state !== 'play' && state !== 'bossdie') return;
  if (state === 'play') playT += dt;

  // movement
  let dir = 0;
  if (keys.ArrowLeft || keys.a || keys.A) dir -= 1;
  if (keys.ArrowRight || keys.d || keys.D) dir += 1;
  for (const t of touches.values()) { if (t.role === 'L') dir -= 1; if (t.role === 'R') dir += 1; }
  dir = clamp(dir, -1, 1);
  const maxSpd = hero.armState === 'charge' ? 330 : 400;
  hero.vx += (dir * maxSpd - hero.vx) * Math.min(1, dt * 14);
  hero.x = clamp(hero.x + hero.vx * dt, HERO_W / 2 - 10, W - HERO_W / 2 + 10);
  const moving = Math.abs(hero.vx) > 40;
  if (moving) hero.walk += dt * Math.abs(hero.vx) / 400 * 13;
  hero.bob = moving ? Math.abs(Math.sin(hero.walk)) * 5 : lerp(hero.bob, 0, Math.min(1, dt * 10));
  hero.tilt = clamp(hero.vx / 400, -1, 1) * 0.07 + (moving ? Math.sin(hero.walk) * 0.03 : 0);
  hero.inv = Math.max(0, hero.inv - dt);
  hero.hurt = Math.max(0, hero.hurt - dt);
  if (state === 'play') updateArm(dt);

  // boss
  boss.bob += dt;
  boss.flash = Math.max(0, boss.flash - dt);
  if (state === 'play') {
    boss.x += (boss.tx - boss.x) * Math.min(1, dt * [1.3, 1.8, 2.4][phase]);
    boss.retarget -= dt;
    if (boss.retarget <= 0 || Math.abs(boss.tx - boss.x) < 6) {
      boss.tx = rand(BOSS_W / 2 - 10, W - BOSS_W / 2 + 10);
      boss.retarget = rand(1.0, 2.4) / (1 + phase * 0.4);
    }
    boss.cool -= dt;
    if (boss.cool <= 0) { bossThrow(); boss.cool = [1.6, 1.25, 0.95][phase] + rand(-0.2, 0.35); }
  } else {
    boss.die += dt;
    boss.shakeX = Math.sin(boss.die * 60) * 6;
    if (Math.random() < 0.5) burst(boss.x + rand(-70, 70), BOSS_TOP + rand(20, BOSS_H - 20), 4, ['#ffd84a', '#c58cff', '#ffffff', '#ff8ad8'], 220);
    if (boss.die > 1.8) { setState('win'); score += life * 200 + Math.max(0, Math.round((90 - playT) * 10)); saveBest(); }
  }

  // shots
  for (const s of shots) {
    s.trail.push({ x: s.x, y: s.y, a: s.a }); if (s.trail.length > 4) s.trail.shift();
    s.x += s.vx * dt; s.y += s.vy * dt; s.a += s.va * dt;
    if (s.power > 0.12) {
      const n = 0.6 + s.power * 1.4;
      for (let i = 0; i < n; i++) if (Math.random() < n / Math.ceil(n)) flame(s.x + rand(-10, 10), s.y + rand(-10, 10), 11 + 18 * s.power, -s.vx * 0.12, -s.vy * 0.12, s.power >= 1);
    }
    if (s.x < -80 || s.x > W + 80 || s.y < -80 || s.y > H + 80) s.dead = true;
  }
  for (const c of clouds) {
    c.born += dt;
    c.x += c.vx * dt + Math.sin(c.born * 4 + c.ph) * 22 * dt;
    c.y += c.vy * dt;
    if (c.y > H + 50 || c.x < -60 || c.x > W + 60) c.dead = true;
  }
  if (state === 'play') {
    for (const s of shots) {
      if (s.dead) continue;
      for (const c of clouds) {
        if (c.dead) continue;
        if (Math.hypot(s.x - c.x, s.y - c.y) < c.r + s.size * 0.36) {
          c.dead = true; if (!s.pierce) s.dead = true;
          score += 10;
          burst(c.x, c.y, 14, ['#c58cff', '#e6ccff', '#8f5be0', '#ffffff'], 220);
          popText(c.x, c.y, '+10', '#a14cff', 22);
          sfx.pop();
          if (s.dead) break;
        }
      }
    }
    const bcx = boss.x, bcy = BOSS_TOP + Math.sin(boss.bob * 2) * 6 + BOSS_H * 0.5;
    for (const s of shots) {
      if (s.dead) continue;
      const nx = (s.x - bcx) / 66, ny = (s.y - bcy) / 104;
      if (nx * nx + ny * ny < 1) { s.dead = true; hitBoss(s); if (state !== 'play') break; }
    }
    if (state === 'play') {
      const hcx = hero.x, hcy = hero.y - HERO_H * 0.5;
      for (const c of clouds) {
        if (c.dead) continue;
        const nx = (c.x - hcx) / (40 + c.r * 0.7), ny = (c.y - hcy) / (82 + c.r * 0.7);
        if (nx * nx + ny * ny < 1) { c.dead = true; hitHero(c); if (state !== 'play') break; }
      }
    }
  }
  shots = shots.filter(s => !s.dead);
  clouds = clouds.filter(c => !c.dead);
}

// ---------- drawing ----------
const bgStars = Array.from({ length: 28 }, () => ({ x: Math.random() * W, y: Math.random() * (H - 200), r: rand(1, 3), p: Math.random() * 6 }));
function drawBG(time) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#ffd6ea'); g.addColorStop(0.45, '#eadcff'); g.addColorStop(1, '#cfe8ff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const sg = ctx.createRadialGradient(W * 0.8, 160, 10, W * 0.8, 160, 260);
  sg.addColorStop(0, 'rgba(255,255,255,0.7)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
  for (const s of bgStars) {
    ctx.globalAlpha = 0.35 + 0.35 * Math.sin(time * 2 + s.p);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const fy = H - 46;
  const fg = ctx.createLinearGradient(0, fy, 0, H);
  fg.addColorStop(0, '#f2c78f'); fg.addColorStop(1, '#d99c5c');
  ctx.fillStyle = fg; ctx.fillRect(0, fy, W, H - fy);
  ctx.strokeStyle = 'rgba(150,90,40,0.25)'; ctx.lineWidth = 2;
  for (let x = -20; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x, fy); ctx.lineTo(x + 30, H); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(0, fy, W, 3);
}
function star(x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
}
function drawCloud(c) {
  ctx.save();
  ctx.translate(c.x, c.y);
  const sc = Math.min(1, c.born * 5);
  ctx.scale(sc, sc);
  ctx.rotate(Math.sin(c.born * 3 + c.ph) * 0.18);
  const r = c.r;
  const gl = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 1.9);
  gl.addColorStop(0, 'rgba(160,80,255,0.4)'); gl.addColorStop(1, 'rgba(160,80,255,0)');
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, r * 1.9, 0, 7); ctx.fill();
  const puffs = [[-0.62, 0.18, 0.52], [0.62, 0.18, 0.52], [-0.25, -0.28, 0.58], [0.3, -0.32, 0.5], [0, 0.22, 0.64]];
  ctx.fillStyle = '#3d1f6b';
  for (const p of puffs) { ctx.beginPath(); ctx.arc(p[0] * r, p[1] * r, p[2] * r + 2.5, 0, 7); ctx.fill(); }
  const g2 = ctx.createLinearGradient(0, -r, 0, r);
  g2.addColorStop(0, '#e3b8ff'); g2.addColorStop(1, '#8748d6');
  ctx.fillStyle = g2;
  for (const p of puffs) { ctx.beginPath(); ctx.arc(p[0] * r, p[1] * r, p[2] * r, 0, 7); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath(); ctx.arc(-0.35 * r, -0.42 * r, 0.16 * r, 0, 7); ctx.fill();
  ctx.strokeStyle = '#2a1050'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-0.42 * r, -0.08 * r); ctx.lineTo(-0.16 * r, 0.02 * r); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0.42 * r, -0.08 * r); ctx.lineTo(0.16 * r, 0.02 * r); ctx.stroke();
  ctx.fillStyle = '#2a1050';
  ctx.beginPath(); ctx.arc(-0.27 * r, 0.12 * r, 0.07 * r, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(0.27 * r, 0.12 * r, 0.07 * r, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-0.18 * r, 0.4 * r);
  ctx.quadraticCurveTo(-0.06 * r, 0.3 * r, 0, 0.4 * r); ctx.quadraticCurveTo(0.06 * r, 0.5 * r, 0.18 * r, 0.4 * r); ctx.stroke();
  ctx.restore();
}
function drawBoss() {
  if (state === 'win') return;
  const by = BOSS_TOP + Math.sin(boss.bob * 2) * 6;
  let alpha = 1, sc = 1;
  if (state === 'bossdie') { alpha = clamp(1 - boss.die / 1.8, 0, 1); sc = 1 + boss.die * 0.15; }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(boss.x + boss.shakeX, by + BOSS_H / 2);
  ctx.scale(sc, sc);
  const ag = ctx.createRadialGradient(0, 0, 20, 0, 0, BOSS_W * 0.75);
  ag.addColorStop(0, 'rgba(140,70,230,0.25)'); ag.addColorStop(1, 'rgba(140,70,230,0)');
  ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(0, 0, BOSS_W * 0.75, 0, 7); ctx.fill();
  ctx.drawImage(IM.boss, -BOSS_W / 2, -BOSS_H / 2, BOSS_W, BOSS_H);
  if (boss.flash > 0) { ctx.globalAlpha = alpha * (boss.flash / 0.16) * 0.85; ctx.drawImage(IM.bossWhite, -BOSS_W / 2, -BOSS_H / 2, BOSS_W, BOSS_H); }
  ctx.restore();
}
function drawHeroLayers(body, arm, db) {
  ctx.drawImage(body, -HERO_W / 2, -HERO_H, HERO_W, HERO_H);
  ctx.save();
  ctx.translate(PIV.x, PIV.y); ctx.rotate(hero.arm);
  if (hero.holding && hero.dbScale > 0) {
    const s = hero.dbScale;
    const cx = DBC.x - PIV.x, cy = DBC.y - PIV.y;
    ctx.drawImage(db, cx - DBL.w * s / 2, cy - DBL.h * s / 2, DBL.w * s, DBL.h * s);
  }
  ctx.drawImage(arm, ARM.x - PIV.x, ARM.y - PIV.y, ARM.w, ARM.h);
  ctx.restore();
}
function drawHero(time) {
  if (hero.inv > 0 && Math.floor(hero.inv * 14) % 2 === 0 && state === 'play') return;
  ctx.fillStyle = 'rgba(80,40,20,0.25)';
  ctx.beginPath(); ctx.ellipse(hero.x, hero.y + 2, HERO_W * 0.45, 9, 0, 0, 7); ctx.fill();
  // energy glow behind the dumbbell while charging
  if (hero.armState === 'charge' && hero.charge > 0.05) {
    const p = handWorld(), c = hero.charge, R = 30 + 50 * c + (c >= 1 ? Math.sin(time * 30) * 6 : 0);
    const g = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, R);
    g.addColorStop(0, `rgba(255,230,150,${0.35 + 0.3 * c})`); g.addColorStop(0.5, `rgba(255,120,30,${0.25 * c + 0.08})`); g.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 7); ctx.fill();
  }
  ctx.save();
  ctx.translate(hero.x, hero.y); ctx.rotate(hero.tilt); ctx.translate(0, -hero.bob);
  drawHeroLayers(IM.body, IM.arm, IM.db);
  if (hero.hurt > 0) { ctx.globalAlpha = hero.hurt / 0.7 * 0.65; drawHeroLayers(IM.bodyP, IM.armP, IM.dbP); ctx.globalAlpha = 1; }
  ctx.restore();
  // charge meter above head
  if (hero.armState === 'charge') {
    const c = hero.charge, bw = 84, bx = hero.x - bw / 2, by = hero.y - HERO_H - 30;
    ctx.fillStyle = 'rgba(43,23,71,0.75)'; roundRect(bx - 3, by - 3, bw + 6, 16, 8); ctx.fill();
    const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    g.addColorStop(0, '#ffe066'); g.addColorStop(0.6, '#ff9a1f'); g.addColorStop(1, '#ff3d1f');
    ctx.fillStyle = g; roundRect(bx, by, Math.max(10, bw * c), 10, 5); ctx.fill();
    if (c >= 1) outlinedText('MAX!', hero.x, by - 16, 18 + Math.sin(time * 20) * 2, '#ffec5c', '#c2260f', 5);
  }
}
function drawFlames() {
  ctx.save();
  for (const f of flames) {
    const t = f.life / f.max, s = f.size * (0.5 + t * 0.7);
    ctx.globalAlpha = clamp(t * 1.5, 0, 1) * 0.85;
    ctx.drawImage(f.hot ? FLAME_HOT : FLAME, f.x - s, f.y - s, s * 2, s * 2);
  }
  ctx.restore();
}
function drawShot(s) {
  const w = s.size, h = w * DB_RATIO;
  if (s.power > 0.12) {
    const R = w * (0.7 + 0.5 * s.power);
    const g = ctx.createRadialGradient(s.x, s.y, 2, s.x, s.y, R);
    g.addColorStop(0, `rgba(255,220,140,${0.3 + 0.3 * s.power})`); g.addColorStop(0.6, `rgba(255,100,20,${0.2 * s.power})`); g.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, R, 0, 7); ctx.fill();
  }
  s.trail.forEach((t, i) => {
    ctx.save(); ctx.globalAlpha = 0.12 * (i + 1); ctx.translate(t.x, t.y); ctx.rotate(t.a);
    ctx.drawImage(IM.db, -w / 2, -h / 2, w, h); ctx.restore();
  });
  ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a);
  ctx.drawImage(IM.db, -w / 2, -h / 2, w, h); ctx.restore();
}
function drawParts() {
  for (const p of parts) {
    ctx.globalAlpha = clamp(p.life / 0.5, 0, 1);
    ctx.fillStyle = p.color;
    if (p.star) star(p.x, p.y, p.size * 1.3);
    else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}
function outlinedText(txt, x, y, size, fill, stroke = '#2b1747', lw = 5, align = 'center') {
  ctx.font = `900 ${size}px "PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (lw > 0) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.strokeText(txt, x, y); }
  ctx.fillStyle = fill; ctx.fillText(txt, x, y);
}
function drawTexts() {
  for (const t of texts) {
    ctx.globalAlpha = clamp(t.life * 1.6, 0, 1);
    outlinedText(t.txt, t.x, t.y, t.size, t.color, '#fff', 5);
  }
  ctx.globalAlpha = 1;
}
function heart(x, y, s, full) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s / 20, s / 20);
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.bezierCurveTo(-12, -4, -8, -14, 0, -7);
  ctx.bezierCurveTo(8, -14, 12, -4, 0, 6);
  ctx.closePath();
  ctx.fillStyle = full ? '#ff4f7b' : 'rgba(120,80,160,0.35)';
  ctx.strokeStyle = '#2b1747'; ctx.lineWidth = 2;
  ctx.fill(); ctx.stroke();
  ctx.restore();
}
function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function drawMusicBtn() {
  const b = BTN_MUSIC;
  ctx.fillStyle = musicOn ? '#ffcf33' : 'rgba(120,90,160,0.35)';
  ctx.strokeStyle = '#2b1747'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); ctx.stroke();
  outlinedText('♪', b.x, b.y + 1, 18, '#2b1747', '#fff', 0);
  if (!musicOn) { ctx.strokeStyle = '#c2260f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(b.x - 10, b.y + 10); ctx.lineTo(b.x + 10, b.y - 10); ctx.stroke(); }
}
function drawHUD() {
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  roundRect(10, 10, W - 20, 74, 16); ctx.fill();
  outlinedText('生命', 26, 32, 16, '#fff', '#2b1747', 4, 'left');
  for (let i = 0; i < MAX_LIFE; i++) heart(82 + i * 26, 33, 24, i < life);
  drawMusicBtn();
  outlinedText(`分數 ${score}`, W - 24, 32, 20, '#ffd84a', '#2b1747', 5, 'right');
  outlinedText('紫雲魔王', 26, 62, 15, '#e9c8ff', '#2b1747', 4, 'left');
  const bx = 106, bw = W - bx - 92, segW = bw / WIN_HITS;
  for (let i = 0; i < WIN_HITS; i++) {
    const alive = i >= hits;
    ctx.fillStyle = alive ? (i < 7 ? '#7b3fe0' : i < 14 ? '#a35bff' : '#d29bff') : 'rgba(80,50,110,0.18)';
    roundRect(bx + i * segW + 1, 54, segW - 2, 16, 4); ctx.fill();
  }
  outlinedText(`${hits} / ${WIN_HITS}`, W - 24, 62, 16, '#fff', '#2b1747', 4, 'right');
}
function drawCrosshair() {
  if (isTouch || !mouse.seen) return;
  const { x, y } = mouse;
  const ready = hero && (hero.armState === 'ready' || hero.armState === 'charge');
  if (state === 'play' && ready) {
    const p = handWorld();
    ctx.save(); ctx.setLineDash([4, 8]);
    ctx.strokeStyle = hero.armState === 'charge' ? `rgba(255,${Math.round(190 - 120 * hero.charge)},40,0.65)` : 'rgba(255,190,40,0.45)';
    ctx.lineWidth = 2 + (hero.armState === 'charge' ? hero.charge * 2 : 0);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(x, Math.min(y, p.y - 30)); ctx.stroke(); ctx.restore();
  }
  ctx.strokeStyle = '#2b1747'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(x, y, 12, 0, 7); ctx.stroke();
  ctx.strokeStyle = ready ? '#ffcf33' : '#ffffff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, 12, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 18, y); ctx.lineTo(x - 6, y); ctx.moveTo(x + 6, y); ctx.lineTo(x + 18, y);
  ctx.moveTo(x, y - 18); ctx.lineTo(x, y - 6); ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 18); ctx.stroke();
}
function drawTouchButtons() {
  if (!isTouch || state !== 'play') return;
  for (const [b, d] of [[BTN_L, -1], [BTN_R, 1]]) {
    let active = false;
    for (const t of touches.values()) if (t.role === (d < 0 ? 'L' : 'R')) active = true;
    ctx.fillStyle = active ? 'rgba(255,216,74,0.75)' : 'rgba(255,255,255,0.5)';
    ctx.strokeStyle = '#2b1747'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2b1747';
    ctx.beginPath(); ctx.moveTo(b.x + d * 16, b.y); ctx.lineTo(b.x - d * 10, b.y - 16); ctx.lineTo(b.x - d * 10, b.y + 16); ctx.closePath(); ctx.fill();
  }
}
function drawPanel(title, titleColor, lines, btn) {
  ctx.fillStyle = 'rgba(30,15,55,0.55)'; ctx.fillRect(0, 0, W, H);
  const pw = 440, ph = 120 + lines.length * 40 + 90, px = (W - pw) / 2, py = (H - ph) / 2 + 30;
  ctx.fillStyle = 'rgba(255,255,255,0.94)'; roundRect(px, py, pw, ph, 24); ctx.fill();
  ctx.strokeStyle = '#2b1747'; ctx.lineWidth = 4; ctx.stroke();
  outlinedText(title, W / 2, py + 52, 42, titleColor, '#2b1747', 7);
  ctx.font = '700 20px "PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
  ctx.fillStyle = '#3a2560'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, py + 112 + i * 40));
  const by = py + ph - 62;
  const pulse = 1 + Math.sin(stateT * 5) * 0.03;
  ctx.save(); ctx.translate(W / 2, by); ctx.scale(pulse, pulse);
  ctx.fillStyle = '#ffcf33'; roundRect(-120, -26, 240, 52, 26); ctx.fill();
  ctx.strokeStyle = '#2b1747'; ctx.lineWidth = 4; ctx.stroke();
  outlinedText(btn, 0, 1, 24, '#2b1747', '#fff', 0);
  ctx.restore();
}
function drawTitle(time) {
  drawBG(time);
  ctx.drawImage(IM.boss, W / 2 - 95, 130 + Math.sin(time * 2) * 6, 190, 190 * BOSS_H / BOSS_W);
  ctx.drawImage(IM.heroFull, W / 2 - HERO_W / 2, H - 26 - HERO_H, HERO_W, HERO_H);
  outlinedText('啞鈴大力士', W / 2, 58, 46, '#ffd84a', '#2b1747', 8);
  outlinedText('大戰 紫雲魔王', W / 2, 104, 30, '#c98bff', '#2b1747', 6);
  const lines = isTouch
    ? ['下方 ◀ ▶ 按鈕：左右移動', '按住畫面蓄力，放開就丟出啞鈴', '按越久 → 越快、帶火焰、可穿透紫雲', `打中魔王 ${WIN_HITS} 次就破關！`, '打掉小紫雲 +10 分', `被紫雲打中 ${MAX_LIFE} 次就輸了`]
    : ['← → 方向鍵：左右移動', '按住滑鼠左鍵蓄力，放開就丟出啞鈴', '按越久 → 越快、帶火焰、可穿透紫雲', `打中魔王 ${WIN_HITS} 次就破關！`, '打掉小紫雲 +10 分', `被紫雲打中 ${MAX_LIFE} 次就輸了`];
  ctx.fillStyle = 'rgba(255,255,255,0.88)'; roundRect(36, 386, W - 72, 286, 20); ctx.fill();
  ctx.strokeStyle = '#2b1747'; ctx.lineWidth = 3; ctx.stroke();
  ctx.font = '700 19px "PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
  ctx.fillStyle = '#3a2560'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 418 + i * 42));
  const pulse = 1 + Math.sin(time * 5) * 0.04;
  ctx.save(); ctx.translate(W / 2, 704); ctx.scale(pulse, pulse);
  ctx.fillStyle = '#ffcf33'; roundRect(-110, -25, 220, 50, 25); ctx.fill();
  ctx.strokeStyle = '#2b1747'; ctx.lineWidth = 4; ctx.stroke();
  outlinedText('點一下開始', 0, 1, 24, '#2b1747', '#fff', 0);
  ctx.restore();
  if (best > 0) outlinedText(`最高分 ${best}`, W / 2, 360, 18, '#fff', '#2b1747', 4);
}
function render(time) {
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  if (state === 'loading') {
    ctx.fillStyle = '#eadcff'; ctx.fillRect(0, 0, W, H);
    outlinedText('載入中…', W / 2, H / 2, 28, '#fff');
    return;
  }
  if (state === 'title') { drawTitle(time); drawCrosshair(); return; }
  const sx = shake ? rand(-shake, shake) : 0, sy = shake ? rand(-shake, shake) : 0;
  ctx.save(); ctx.translate(sx, sy);
  drawBG(time);
  drawBoss();
  for (const c of clouds) drawCloud(c);
  drawFlames();
  drawHero(time);
  for (const s of shots) drawShot(s);
  drawParts();
  drawTexts();
  ctx.restore();
  if (hero.hurt > 0) {
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    vg.addColorStop(0, 'rgba(140,60,220,0)'); vg.addColorStop(1, `rgba(140,60,220,${hero.hurt / 0.7 * 0.55})`);
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }
  drawHUD();
  drawTouchButtons();
  if (state === 'win') {
    drawPanel('破關！', '#ffd84a', [`打中魔王 ${WIN_HITS} 次，紫雲魔王被打跑了！`, `最終分數：${score}`, `用時 ${playT.toFixed(1)} 秒　剩餘生命 ${life}`, `最高分：${best}`], '再玩一次');
  } else if (state === 'lose') {
    drawPanel('被紫雲淹沒了…', '#c98bff', [`打中魔王 ${hits} / ${WIN_HITS} 次`, `分數：${score}`, `最高分：${best}`], '再挑戰一次');
  } else if (paused) {
    drawPanel('暫停中', '#ffffff', ['休息一下，喝口水', '按 P 或點一下繼續'], '繼續');
  }
  drawCrosshair();
}

// ---------- input ----------
function toGame(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
}
function inCircle(p, b, pad = 14) { return Math.hypot(p.x - b.x, p.y - b.y) < b.r + pad; }
function clickUI(p) {
  ensureAC();
  if (state === 'title') { startGame(); return true; }
  if ((state === 'win' || state === 'lose') && stateT > 0.8) { startGame(); return true; }
  if (paused) { paused = false; return true; }
  if (state === 'play' && inCircle(p, BTN_MUSIC, 6)) { musicOn = !musicOn; return true; }
  return false;
}
cv.addEventListener('pointerdown', e => {
  e.preventDefault();
  const p = toGame(e);
  if (e.pointerType === 'touch' || e.pointerType === 'pen') {
    isTouch = true;
    if (clickUI(p)) return;
    if (state !== 'play') return;
    let role = 'aim';
    if (inCircle(p, BTN_L)) role = 'L'; else if (inCircle(p, BTN_R)) role = 'R';
    touches.set(e.pointerId, { x: p.x, y: p.y, role });
    if (role === 'aim') { aimPt.x = p.x; aimPt.y = p.y; }
  } else {
    mouse.x = p.x; mouse.y = p.y; mouse.seen = true;
    if (e.button !== 0) return;
    if (clickUI(p)) return;
    mouse.down = true;
  }
  try { cv.setPointerCapture(e.pointerId); } catch (_) {}
});
cv.addEventListener('pointermove', e => {
  const p = toGame(e);
  if (e.pointerType === 'mouse') { mouse.x = p.x; mouse.y = p.y; mouse.seen = true; }
  const t = touches.get(e.pointerId);
  if (t) { t.x = p.x; t.y = p.y; if (t.role === 'aim') { aimPt.x = p.x; aimPt.y = p.y; } }
});
function endPointer(e) {
  if (e.pointerType === 'mouse') mouse.down = false;
  const t = touches.get(e.pointerId);
  if (t && t.role === 'aim') { aimPt.x = t.x; aimPt.y = t.y; }
  touches.delete(e.pointerId);
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !mouse.down) mouse.seen = false; });
cv.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  if (e.repeat && e.key === ' ') return;
  keys[e.key] = true;
  if (e.key === 'Enter' || e.key === ' ') {
    if (state === 'title' || ((state === 'win' || state === 'lose') && stateT > 0.8)) { keys[' '] = false; ensureAC(); startGame(); }
  }
  if ((e.key === 'p' || e.key === 'P' || e.key === 'Escape') && state === 'play') { paused = !paused; if (paused) chargeStop(); }
  if (e.key === 'm' || e.key === 'M') musicOn = !musicOn;
});
addEventListener('keyup', e => { keys[e.key] = false; });
addEventListener('blur', () => {
  for (const k in keys) keys[k] = false; mouse.down = false; touches.clear();
  if (state === 'play') { paused = true; chargeStop(); }
});

// ---------- loop ----------
let last = 0, clock = 0;
function loop(ts) {
  const dt = Math.min(0.033, (ts - last) / 1000 || 0);
  last = ts; clock += dt;
  if (!paused) update(dt);
  render(clock);
  requestAnimationFrame(loop);
}
Promise.all([loadImg(ASSETS.body), loadImg(ASSETS.arm), loadImg(ASSETS.dumbbell), loadImg(ASSETS.boss), loadImg(ASSETS.heroFull)])
  .then(([body, arm, db, boss, heroFull]) => {
    IM = { body, arm, db, boss, heroFull };
    IM.bossWhite = tint(boss, '#ffffff');
    IM.bodyP = tint(body, '#9b4dff'); IM.armP = tint(arm, '#9b4dff'); IM.dbP = tint(db, '#9b4dff');
    reset();
    setState('title');
  });
requestAnimationFrame(loop);
})();
