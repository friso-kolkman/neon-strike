// NEON STRIKE — main engine. Vanilla JS + Three.js, no assets, tuned for integrated GPUs.
import * as THREE from 'three';
import { AudioEngine } from './audio.js';
import { LEVELS } from './levels.js';

// ============================================================ helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;
const UP = new THREE.Vector3(0, 1, 0);
// scratch vectors: _v1.._v3 are only safe within a single function body that
// does not call into other game code while still needing them. Re-entrant
// paths (damage/die/explosions) allocate locals instead.
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _proj = new THREE.Vector3(); // reserved for showDamage projection
const _dummy = new THREE.Object3D();

const safeGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), crosshair: $('crosshair'), hitmarker: $('hitmarker'), vignette: $('vignette'),
  lowhp: $('lowhp'), odtint: $('odtint'), odlabel: $('odlabel'),
  hpbar: $('hpbar'), hpnum: $('hpnum'), ammoName: $('ammoName'), ammoNum: $('ammoNum'),
  slots: $('slots'), score: $('score'), scoremult: $('scoremult'), wave: $('wave'),
  bosswrap: $('bosswrap'), bossbar: $('bossbar'), bossname: $('bossname'),
  streak: $('streak'), banner: $('banner'), bannerTitle: $('bannerTitle'), bannerSub: $('bannerSub'),
  popups: $('popups'), hint: $('hint'), fpsEl: $('fpsEl'),
  menu: $('menu'), menuHi: $('menuHi'), btnStart: $('btnStart'), btnSound: $('btnSound'),
  sens: $('sens'), sensVal: $('sensVal'),
  pause: $('pause'), btnResume: $('btnResume'), btnRestart: $('btnRestart'), btnQuit: $('btnQuit'),
  death: $('death'), deathStats: $('deathStats'), btnRetry: $('btnRetry'), btnAbandon: $('btnAbandon'),
  win: $('win'), winStats: $('winStats'), btnAgain: $('btnAgain'),
  touch: $('touch'), stickZone: $('stickZone'), stickNub: $('stickNub'),
  btnFire: $('btnFire'), btnJump: $('btnJump'), btnDashT: $('btnDashT'), btnPause: $('btnPause'),
};

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const TOUCH = params.has('touch') || window.matchMedia('(pointer: coarse)').matches;
const SHOW_FPS = TEST || params.has('fps');
if (SHOW_FPS) ui.fpsEl.classList.remove('hidden');
if (TOUCH) document.body.classList.add('touchmode');

// ============================================================ renderer / scene
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, TOUCH ? 1.3 : 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 320);
camera.rotation.order = 'YXZ';
scene.add(camera);

const hemiLight = new THREE.HemisphereLight(0x445566, 0x0a0c12, 1.1);
scene.add(hemiLight);
const dirLight = new THREE.DirectionalLight(0xbfd4ff, 1.0);
dirLight.position.set(18, 40, 12);
scene.add(dirLight);
const muzzleLight = new THREE.PointLight(0x00ffee, 0, 14);
scene.add(muzzleLight);
const boomLight = new THREE.PointLight(0xff8844, 0, 22);
scene.add(boomLight);

window.addEventListener('resize', () => {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, TOUCH ? 1.3 : 1.6));
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// starfield (recolored per level)
const starMat = new THREE.PointsMaterial({ color: 0xaaccff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false });
{
  const pos = new Float32Array(500 * 3);
  for (let i = 0; i < 500; i++) {
    const a = rand(0, Math.PI * 2), r = rand(120, 240), y = rand(15, 180);
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = y; pos[i * 3 + 2] = Math.sin(a) * r;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, starMat));
}

// ============================================================ audio
const audio = new AudioEngine();
audio.setMuted(safeGet('ns_mute') === '1');

// ============================================================ config
const WEAPONS = [
  { id: 'blaster', name: 'BLASTER', dmg: 14, rate: 0.19, spread: 0.010, pellets: 1, shake: 0.06, fovP: 0.6, color: 0x00ffee, max: Infinity, start: Infinity },
  { id: 'scatter', name: 'SCATTERGUN', dmg: 11, rate: 0.80, spread: 0.065, pellets: 8, shake: 0.35, fovP: 2.5, color: 0xffaa22, max: 40, start: 24, pickupAmmo: 8, dropAmmo: 4 },
  { id: 'smg', name: 'PULSE SMG', dmg: 9, rate: 0.07, spread: 0.035, pellets: 1, shake: 0.05, fovP: 0.4, color: 0xff44ff, max: 240, start: 120, pickupAmmo: 45, dropAmmo: 20 },
  { id: 'rocket', name: 'RL-7 ROCKETS', dmg: 80, rate: 0.85, spread: 0.005, pellets: 1, shake: 0.5, fovP: 3, color: 0xff5522, max: 12, start: 6, pickupAmmo: 3, dropAmmo: 1, projectile: true, speed: 26, splash: 70, splashR: 4.5 },
];
const WIDX = { blaster: 0, scatter: 1, smg: 2, rocket: 3 };

const ENEMY_TYPES = {
  grunt:    { hp: 30, speed: 6.3, radius: 0.55, height: 1.65, color: 0xff3355, score: 100, behavior: 'chase', melee: { range: 2.1, dmg: 12, cd: 1.1, windup: 0.28 } },
  spitter:  { hp: 42, speed: 3.8, radius: 0.55, height: 1.75, color: 0x33ff77, score: 150, behavior: 'ranged', keep: [9, 15], shot: { cd: 1.7, dmg: 9, speed: 17, r: 0.18, color: 0x66ffaa, lead: 0.35 } },
  flyer:    { hp: 24, speed: 6.5, radius: 0.5, height: 0.9, fly: 3, color: 0x33aaff, score: 150, behavior: 'flyer', orbit: 9, shot: { cd: 1.4, dmg: 7, speed: 21, r: 0.15, color: 0x66ccff, lead: 0.5 } },
  tank:     { hp: 170, speed: 2.3, radius: 0.95, height: 2.5, color: 0xffcc33, score: 400, behavior: 'ranged', keep: [7, 20], shot: { cd: 2.4, dmg: 24, speed: 13, r: 0.4, color: 0xffdd66, splash: 2.6, lead: 0.2 } },
  splitter: { hp: 60, speed: 4.4, radius: 0.7, height: 1.5, color: 0xff66ee, score: 200, behavior: 'chase', melee: { range: 2.0, dmg: 10, cd: 1.2, windup: 0.3 }, split: true },
  mini:     { hp: 8, speed: 8.5, radius: 0.35, height: 0.8, color: 0xff99ff, score: 50, behavior: 'chase', melee: { range: 1.4, dmg: 6, cd: 0.9, windup: 0.18 } },
  mite:     { hp: 10, speed: 10, radius: 0.35, height: 0.7, color: 0xffee33, score: 80, behavior: 'kamikaze', boom: { dmg: 45, r: 3.2 } },
  boss:     { hp: 1500, speed: 2.6, radius: 1.7, height: 3.8, color: 0xff2299, score: 5000, behavior: 'boss', shot: { cd: 0, dmg: 12, speed: 11, r: 0.3, color: 0xff66cc } },
};

// ============================================================ state
const game = {
  state: 'menu', // menu | playing | paused | dead | win
  levelIdx: 0, score: 0, kills: 0, shots: 0, hits: 0,
  time: 0, streak: 0, streakTimer: 0, recentKills: [],
  timeScale: 1, slowTimer: 0, overdrive: 0,
  levelStartScore: 0, levelStartKills: 0, levelStartShots: 0, levelStartHits: 0,
  hi: parseInt(safeGet('ns_hi') || '0', 10) || 0,
  fps: 60,
};

const player = {
  pos: new THREE.Vector3(0, 0, 24), vel: new THREE.Vector3(),
  yaw: 0, pitch: 0, hp: 100, maxHp: 100, radius: 0.45,
  onGround: true, jumps: 2, invuln: 0,
  owned: [true, false, false, false], ammo: [Infinity, 0, 0, 0], cur: 0,
  cooldown: 0, dashT: 0, dashCd: 0, dashDir: new THREE.Vector3(),
  bobT: 0, landV: 0,
};

let sens = parseInt(safeGet('ns_sens') || '45', 10);
ui.sens.value = sens;
ui.sensVal.textContent = sens;

// per-level mutable state
let LEVEL = LEVELS[0];
let ARENA = { hx: 30, hz: 30 };
let walls = [];           // {minX,maxX,minZ,maxZ,h}
let levelGroup = null;    // all per-level scenery
let staticGroup = null;   // raycastable blockers (perimeter + obstacles)
let enemiesGroup = null;
let barrelsGroup = null;
let enemies = [];
let barrels = [];
let pickups = [];
let eProjs = [];
let rockets = [];
let portal = null;
let spawnQueue = [];
let waveIdx = 0;
let waveActive = false;
let levelDone = false;
let boss = null;
let delayed = [];         // {t, fn} scheduler driven by scaled game time

function after(t, fn) { delayed.push({ t, fn }); }
function clearDelayed() { delayed.length = 0; }

// camera / combat feel
let shake = 0, fovPunch = 0, recoilPitch = 0, recoilHeat = 0, rollTilt = 0;
let lastDashTime = -10;
let perfectCd = 0;
let lastGraze = -10;
function addShake(s) { shake = Math.min(0.6, shake + s); }

// ============================================================ shared geometry / materials
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 12, 10),
  particle: new THREE.BoxGeometry(0.16, 0.16, 0.16),
  tracer: new THREE.CylinderGeometry(0.025, 0.025, 1, 5, 1, true),
  blob: new THREE.CircleGeometry(1, 18),
  octa: new THREE.OctahedronGeometry(1, 0),
  ico: new THREE.IcosahedronGeometry(1, 0),
  torus: new THREE.TorusGeometry(1, 0.07, 8, 32),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
};
const SHARED_GEOS = new Set(Object.values(GEO));
const noRaycast = () => {};
const projMats = new Map();
function projMat(color) {
  if (!projMats.has(color)) projMats.set(color, new THREE.MeshBasicMaterial({ color }));
  return projMats.get(color);
}

// ============================================================ particles (one InstancedMesh)
const P_MAX = 420;
const particles = [];
const pMesh = new THREE.InstancedMesh(GEO.particle, new THREE.MeshBasicMaterial({ color: 0xffffff }), P_MAX);
pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
pMesh.frustumCulled = false;
pMesh.raycast = noRaycast;
for (let i = 0; i < P_MAX; i++) {
  particles.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, maxLife: 1, size: 1 });
  _dummy.position.set(0, -100, 0); _dummy.scale.setScalar(0.0001); _dummy.updateMatrix();
  pMesh.setMatrixAt(i, _dummy.matrix);
  pMesh.setColorAt(i, new THREE.Color(1, 1, 1));
}
scene.add(pMesh);
let pCursor = 0;

function spawnBurst(pos, colorHex, count, speed, life = 0.7, size = 1, upBias = 2.5) {
  const c = new THREE.Color(colorHex);
  for (let n = 0; n < count; n++) {
    const i = pCursor;
    const p = particles[i];
    pCursor = (pCursor + 1) % P_MAX;
    p.alive = true;
    p.pos.copy(pos);
    p.vel.set(rand(-1, 1), rand(-0.2, 1) * upBias * 0.5 + rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.35, 1));
    p.life = p.maxLife = life * rand(0.6, 1.2);
    p.size = size * rand(0.7, 1.5);
    pMesh.setColorAt(i, c);
  }
  if (pMesh.instanceColor) pMesh.instanceColor.needsUpdate = true;
}

function updateParticles(dt) {
  for (let i = 0; i < P_MAX; i++) {
    const p = particles[i];
    if (!p.alive) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.alive = false;
      _dummy.position.set(0, -100, 0); _dummy.scale.setScalar(0.0001);
    } else {
      p.vel.y -= 14 * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.06) { p.pos.y = 0.06; p.vel.y *= -0.4; p.vel.x *= 0.8; p.vel.z *= 0.8; }
      _dummy.position.copy(p.pos);
      _dummy.scale.setScalar(Math.max(0.0001, p.size * (p.life / p.maxLife)));
    }
    _dummy.updateMatrix();
    pMesh.setMatrixAt(i, _dummy.matrix);
  }
  pMesh.instanceMatrix.needsUpdate = true;
}

// ============================================================ tracers
const tracers = [];
for (let i = 0; i < 28; i++) {
  const m = new THREE.Mesh(GEO.tracer, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.visible = false;
  m.raycast = noRaycast;
  scene.add(m);
  tracers.push({ mesh: m, life: 0 });
}
let tCursor = 0;

function spawnTracer(a, b, colorHex) {
  const t = tracers[tCursor];
  tCursor = (tCursor + 1) % tracers.length;
  const d = new THREE.Vector3().copy(b).sub(a);
  const len = d.length();
  if (len < 0.1) return;
  t.mesh.visible = true;
  t.mesh.scale.set(1, len, 1);
  t.mesh.position.copy(a).addScaledVector(d, 0.5);
  t.mesh.quaternion.setFromUnitVectors(UP, d.normalize());
  t.mesh.material.color.setHex(colorHex);
  t.mesh.material.opacity = 0.85;
  t.life = 0.07;
}

function updateTracers(dt) {
  for (const t of tracers) {
    if (!t.mesh.visible) continue;
    t.life -= dt;
    t.mesh.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
    if (t.life <= 0) t.mesh.visible = false;
  }
}

// ============================================================ HTML fx
function showDamage(worldPos, amount, crit) {
  _proj.copy(worldPos).project(camera);
  if (_proj.z > 1) return;
  const div = document.createElement('div');
  div.className = 'dmg' + (crit ? ' crit' : '');
  div.textContent = Math.round(amount);
  div.style.left = ((_proj.x * 0.5 + 0.5) * window.innerWidth + rand(-14, 14)) + 'px';
  div.style.top = ((-_proj.y * 0.5 + 0.5) * window.innerHeight + rand(-10, 4)) + 'px';
  ui.popups.appendChild(div);
  requestAnimationFrame(() => div.classList.add('fly'));
  setTimeout(() => div.remove(), 700);
  while (ui.popups.children.length > 46) ui.popups.firstChild.remove();
}

function hitmarkerFlash(crit) {
  ui.hitmarker.classList.toggle('crit', !!crit);
  ui.hitmarker.classList.remove('on');
  void ui.hitmarker.offsetWidth; // restart animation
  ui.hitmarker.classList.add('on');
}

function streakPopup(text) {
  ui.streak.textContent = text;
  ui.streak.classList.remove('pop');
  void ui.streak.offsetWidth;
  ui.streak.classList.add('pop');
}

function tagPopup(text, cssColor, row) {
  const div = document.createElement('div');
  div.className = 'tag';
  div.textContent = text;
  div.style.color = cssColor;
  div.style.top = `calc(64% + ${row * 30}px)`;
  ui.popups.appendChild(div);
  setTimeout(() => div.remove(), 950);
}

let bannerTimer = 0;
function banner(title, sub = '', dur = 2.2) {
  ui.bannerTitle.textContent = title;
  ui.bannerSub.textContent = sub;
  ui.banner.classList.add('show');
  bannerTimer = dur;
}

// ============================================================ level construction
function makeFloorTexture(level) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = level.floorBase;
  g.fillRect(0, 0, 256, 256);
  const acc = '#' + level.accent.toString(16).padStart(6, '0');
  g.strokeStyle = acc;
  g.globalAlpha = 0.22;
  g.lineWidth = 1;
  for (let i = 0; i <= 256; i += 32) {
    g.beginPath(); g.moveTo(i + 0.5, 0); g.lineTo(i + 0.5, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i + 0.5); g.lineTo(256, i + 0.5); g.stroke();
  }
  g.globalAlpha = 0.5;
  g.lineWidth = 2;
  g.strokeRect(1, 1, 254, 254);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function addWallBox(x, z, w, d, h, mat, edgeMat, group) {
  const m = new THREE.Mesh(GEO.box, mat);
  m.scale.set(w, h, d);
  m.position.set(x, h / 2, z);
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(GEO.box), edgeMat);
  e.raycast = noRaycast;
  m.add(e);
  group.add(m);
  walls.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
  return m;
}

function buildLevel(idx) {
  // teardown
  if (levelGroup) {
    scene.remove(levelGroup);
    levelGroup.traverse((o) => { if (o.geometry && !SHARED_GEOS.has(o.geometry)) o.geometry.dispose(); });
  }
  for (const p of eProjs) scene.remove(p.mesh);
  for (const r of rockets) scene.remove(r.mesh);
  walls = []; enemies = []; barrels = []; pickups = []; eProjs = []; rockets = [];
  spawnQueue = []; portal = null; boss = null;
  waveIdx = 0; waveActive = false; levelDone = false;
  clearDelayed();
  for (let i = 0; i < P_MAX; i++) {
    particles[i].alive = false;
    _dummy.position.set(0, -100, 0); _dummy.scale.setScalar(0.0001); _dummy.updateMatrix();
    pMesh.setMatrixAt(i, _dummy.matrix);
  }
  pMesh.instanceMatrix.needsUpdate = true;
  for (const t of tracers) t.mesh.visible = false;
  ui.bosswrap.classList.add('hidden');

  LEVEL = LEVELS[idx];
  ARENA = { hx: LEVEL.w / 2 - 1, hz: LEVEL.d / 2 - 1 };
  document.documentElement.style.setProperty('--accent', LEVEL.accentCss);

  scene.background = new THREE.Color(LEVEL.sky);
  scene.fog = new THREE.FogExp2(LEVEL.sky, LEVEL.fog);
  hemiLight.color.setHex(LEVEL.accent).lerp(new THREE.Color(0xffffff), 0.55).multiplyScalar(0.5);
  starMat.color.setHex(LEVEL.accent).lerp(new THREE.Color(0xffffff), 0.6);

  levelGroup = new THREE.Group();
  staticGroup = new THREE.Group();
  enemiesGroup = new THREE.Group();
  barrelsGroup = new THREE.Group();
  levelGroup.add(staticGroup, enemiesGroup, barrelsGroup);
  scene.add(levelGroup);

  // floor
  const ftex = makeFloorTexture(LEVEL);
  ftex.repeat.set(LEVEL.w / 8, LEVEL.d / 8);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(LEVEL.w, LEVEL.d), new THREE.MeshBasicMaterial({ map: ftex }));
  floor.rotation.x = -Math.PI / 2;
  floor.raycast = noRaycast;
  levelGroup.add(floor);

  // perimeter + obstacles
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x0c1320, roughness: 0.7, metalness: 0.2, emissive: LEVEL.accent, emissiveIntensity: 0.04 });
  const edgeMat = new THREE.LineBasicMaterial({ color: LEVEL.accent, transparent: true, opacity: 0.7 });
  const hw = LEVEL.w / 2, hd = LEVEL.d / 2;
  addWallBox(0, -hd - 0.5, LEVEL.w + 2, 1, 6, wallMat, edgeMat, staticGroup);
  addWallBox(0, hd + 0.5, LEVEL.w + 2, 1, 6, wallMat, edgeMat, staticGroup);
  addWallBox(-hw - 0.5, 0, 1, LEVEL.d + 2, 6, wallMat, edgeMat, staticGroup);
  addWallBox(hw + 0.5, 0, 1, LEVEL.d + 2, 6, wallMat, edgeMat, staticGroup);
  for (const o of LEVEL.obstacles) addWallBox(o.x, o.z, o.w, o.d, o.h, wallMat, edgeMat, staticGroup);

  // barrels
  for (const b of LEVEL.barrels || []) spawnBarrel(b.x, b.z);

  // pickups
  for (const p of LEVEL.pickups || []) spawnPickup(p.type, p.x, p.z, p.id, true);

  // player placement
  player.pos.set(LEVEL.playerSpawn.x, 0, LEVEL.playerSpawn.z);
  player.vel.set(0, 0, 0);
  player.yaw = Math.atan2(player.pos.x, player.pos.z); // face arena center
  player.pitch = 0;

  audio.intensity = 0;
  audio.startMusic(LEVEL.musicRoot, LEVEL.musicTempo);
}

// ============================================================ barrels
function spawnBarrel(x, z) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xbb2222, roughness: 0.5, metalness: 0.3, emissive: 0xff3300, emissiveIntensity: 0.35 });
  const m = new THREE.Mesh(GEO.cyl, mat);
  m.scale.set(0.55, 1.0, 0.55);
  m.position.set(x, 0.5, z);
  const stripe = new THREE.Mesh(GEO.cyl, new THREE.MeshBasicMaterial({ color: 0xffdd33 }));
  stripe.scale.set(1.02, 0.12, 1.02);
  stripe.raycast = noRaycast;
  m.add(stripe);
  const b = { mesh: m, x, z, dead: false };
  m.userData.barrel = b;
  barrelsGroup.add(m);
  barrels.push(b);
}

function explodeBarrel(b) {
  if (b.dead) return;
  b.dead = true;
  barrelsGroup.remove(b.mesh);
  explosionAt(new THREE.Vector3(b.x, 0.8, b.z), 65, 4.2, 0xff7733, false);
}

function explosionAt(pos, dmg, radius, colorHex, fromRocket, exclude) {
  audio.explosion(radius > 4);
  spawnBurst(pos, colorHex, 36, 11, 0.8, 1.6);
  spawnBurst(pos, 0xffffff, 10, 7, 0.35, 1);
  addShake(0.35);
  boomLight.color.setHex(colorHex);
  boomLight.position.copy(pos);
  boomLight.intensity = 60;
  // enemies (snapshot: kills may spawn minis mid-loop, which must not inherit this blast)
  for (const e of enemies.slice()) {
    if (e.dead || e === exclude) continue;
    const d = e.group.position.distanceTo(pos);
    if (d < radius + e.cfg.radius) e.damage(dmg * (1 - 0.55 * (d / radius)), false, e.group.position, null);
  }
  // barrels chain
  for (const o of barrels) {
    if (o.dead) continue;
    if (Math.hypot(o.x - pos.x, o.z - pos.z) < radius) after(0.08, () => explodeBarrel(o));
  }
  // player: damage + rocket-jump impulse
  const px = player.pos.x, py = player.pos.y + 0.9, pz = player.pos.z;
  const pd = Math.hypot(px - pos.x, py - pos.y, pz - pos.z);
  if (pd < radius * 0.85) {
    const power = 1 - pd / (radius * 0.85);
    hurtPlayer(Math.min(fromRocket ? 26 : 30, dmg * 0.35 * power), pos, true);
    let nx = px - pos.x, ny = py - pos.y, nz = pz - pos.z;
    let nl = Math.hypot(nx, ny, nz);
    if (nl < 0.1) { nx = 0; ny = 1; nz = 0; nl = 1; }
    player.vel.x += (nx / nl) * 11 * power;
    player.vel.z += (nz / nl) * 11 * power;
    player.vel.y += 7 * power;
  }
}

// ============================================================ pickups
const PICKUP_CFG = {
  health: { color: 0x33ff66 },
  ammo: { color: 0xffcc33 },
  weapon: { color: 0xffffff },
  overdrive: { color: 0xff33dd },
};

function spawnPickup(type, x, z, weaponId, permanent = false, despawn = 0) {
  const cfg = PICKUP_CFG[type];
  const g = new THREE.Group();
  let color = cfg.color;
  if (type === 'health') {
    const m = new THREE.MeshBasicMaterial({ color });
    const a = new THREE.Mesh(GEO.box, m); a.scale.set(0.5, 0.16, 0.16);
    const b = new THREE.Mesh(GEO.box, m); b.scale.set(0.16, 0.5, 0.16);
    g.add(a, b);
  } else if (type === 'ammo') {
    const m = new THREE.Mesh(GEO.box, new THREE.MeshStandardMaterial({ color: 0x222a16, emissive: color, emissiveIntensity: 0.5 }));
    m.scale.set(0.45, 0.3, 0.45);
    g.add(m);
  } else if (type === 'weapon') {
    color = WEAPONS[WIDX[weaponId]].color;
    const m = new THREE.Mesh(GEO.box, new THREE.MeshStandardMaterial({ color: 0x131a24, emissive: color, emissiveIntensity: 0.8 }));
    m.scale.set(0.7, 0.22, 0.22);
    g.add(m);
    const ped = new THREE.Mesh(GEO.cyl, new THREE.MeshStandardMaterial({ color: 0x0c1320, emissive: color, emissiveIntensity: 0.25 }));
    ped.scale.set(0.6, 0.5, 0.6);
    ped.position.y = -0.85;
    g.add(ped);
  } else if (type === 'overdrive') {
    const m = new THREE.Mesh(GEO.octa, new THREE.MeshBasicMaterial({ color }));
    m.scale.setScalar(0.34);
    g.add(m);
  }
  const halo = new THREE.Mesh(GEO.blob, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.rotation.x = -Math.PI / 2;
  halo.scale.setScalar(0.8);
  halo.position.y = -1.06;
  g.add(halo);
  g.traverse((o) => { o.raycast = noRaycast; });
  g.position.set(x, 1.1, z);
  levelGroup.add(g);
  const pk = { type, weaponId, mesh: g, x, z, t: rand(0, 6), dead: false, despawn: despawn || 0, permanent, small: false };
  pickups.push(pk);
  return pk;
}

function applyPickup(p) {
  if (p.type === 'health') {
    if (player.hp >= player.maxHp) return false;
    player.hp = Math.min(player.maxHp, player.hp + 35);
    audio.pickup();
  } else if (p.type === 'ammo') {
    let gained = false;
    for (let i = 1; i < WEAPONS.length; i++) {
      if (player.owned[i]) {
        const before = player.ammo[i];
        player.ammo[i] = Math.min(WEAPONS[i].max, player.ammo[i] + (p.small ? WEAPONS[i].dropAmmo : WEAPONS[i].pickupAmmo));
        if (player.ammo[i] > before) gained = true;
      }
    }
    if (!gained) return false; // leave the box on the floor
    audio.pickup();
  } else if (p.type === 'weapon') {
    const i = WIDX[p.weaponId];
    if (!player.owned[i]) {
      player.owned[i] = true;
      player.ammo[i] = WEAPONS[i].start;
      switchWeapon(i, true);
      banner(WEAPONS[i].name + ' ACQUIRED', 'PRESS ' + (i + 1) + ' TO SELECT', 1.8);
      audio.pickup('weapon');
    } else {
      player.ammo[i] = Math.min(WEAPONS[i].max, player.ammo[i] + WEAPONS[i].pickupAmmo * 2);
      audio.pickup();
    }
  } else if (p.type === 'overdrive') {
    game.overdrive = 10;
    audio.pickup('overdrive');
    banner('OVERDRIVE', 'DOUBLE DAMAGE // 10s', 1.6);
  }
  return true;
}

function updatePickups(dt) {
  for (const p of pickups) {
    if (p.dead) continue;
    p.t += dt;
    p.mesh.position.y = 1.1 + Math.sin(p.t * 2.4) * 0.16;
    p.mesh.rotation.y += dt * 1.8;
    if (p.despawn > 0) {
      p.despawn -= dt;
      p.mesh.visible = p.despawn > 3 ? true : (Math.sin(p.t * 18) > -0.4);
      if (p.despawn <= 0) { p.dead = true; levelGroup.remove(p.mesh); continue; }
    }
    const d = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
    if (d < 1.7 && player.pos.y < 2.2) {
      if (applyPickup(p)) { p.dead = true; levelGroup.remove(p.mesh); }
    }
  }
}

// ============================================================ portal
function spawnPortal() {
  portal = new THREE.Group();
  const ring = new THREE.Mesh(GEO.torus, new THREE.MeshBasicMaterial({ color: LEVEL.accent }));
  ring.scale.setScalar(1.6);
  const disc = new THREE.Mesh(GEO.blob, new THREE.MeshBasicMaterial({ color: LEVEL.accent, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  disc.scale.setScalar(1.35);
  portal.add(ring, disc);
  portal.traverse((o) => { o.raycast = noRaycast; });
  const light = new THREE.PointLight(LEVEL.accent, 30, 16);
  portal.add(light);
  const pp = LEVEL.portal || { x: 0, z: 0 };
  portal.position.set(pp.x, 2, pp.z);
  levelGroup.add(portal);
  audio.portal();
  banner('SECTOR CLEAR', 'ENTER THE PORTAL', 2.6);
}

function updatePortal(dt) {
  if (!portal) return;
  portal.rotation.y += dt * 1.2;
  portal.children[0].rotation.z += dt * 2;
  if (Math.random() < 0.12) spawnBurst(portal.position, LEVEL.accent, 2, 3, 0.6, 0.8);
  if (Math.hypot(player.pos.x - portal.position.x, player.pos.z - portal.position.z) < 1.9) {
    nextLevel();
  }
}

// ============================================================ enemies
class Enemy {
  constructor(type, x, z) {
    this.type = type;
    this.cfg = ENEMY_TYPES[type];
    this.hp = this.cfg.hp;
    this.maxHp = this.cfg.hp;
    this.dead = false;
    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);
    this.vel = new THREE.Vector3();
    this.attackCd = rand(0.6, 1.4);
    this.windup = -1;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = rand(1.5, 3.5);
    this.losT = rand(0, 0.25);
    this.canSee = true;
    this.flashT = 0;
    this.spawnT = 0.45;
    this.bobP = rand(0, 6);
    this.rageT = 0;
    this.rageTarget = null;
    this.frenzied = false;
    this.scoreMult = 1;
    this.beepT = 0;
    this.parts = [];
    this.buildMesh();
    enemiesGroup.add(this.group);
    spawnBurst(new THREE.Vector3(x, 1, z), this.cfg.color, 14, 6, 0.5, 1);
    audio.spawn();
    if (type === 'boss') {
      this.phase = 0;
      this.ringT = 2.5;
      this.burstT = 3;
      this.summonT = 6;
      this.stompT = 0;
      ui.bosswrap.classList.remove('hidden');
    }
  }

  _mat(color, emissiveScale = 0.35) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15, emissive: color, emissiveIntensity: emissiveScale });
  }

  _tag(mesh, part) {
    mesh.userData.enemyRef = this;
    mesh.userData.part = part;
    this.parts.push(mesh);
  }

  buildMesh() {
    const c = this.cfg;
    if (this.type === 'flyer') {
      const body = new THREE.Mesh(GEO.octa, this._mat(c.color, 0.5));
      body.scale.setScalar(0.55);
      this._tag(body, 'body');
      this.body = body;
      const eye = new THREE.Mesh(GEO.sphere, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      eye.scale.setScalar(0.14);
      eye.position.set(0, 0, 0.42);
      eye.raycast = noRaycast;
      body.add(eye);
      this.group.add(body);
    } else if (this.type === 'boss') {
      const core = new THREE.Mesh(GEO.ico, this._mat(c.color, 0.55));
      core.scale.setScalar(1.7);
      core.position.y = 2.1;
      this._tag(core, 'body');
      this.body = core;
      const crown = new THREE.Mesh(GEO.sphere, this._mat(0xffffff, 0.9));
      crown.scale.setScalar(0.5);
      crown.position.y = 3.9;
      this._tag(crown, 'head');
      this.head = crown;
      this.ring1 = new THREE.Mesh(GEO.torus, new THREE.MeshBasicMaterial({ color: c.color }));
      this.ring1.scale.setScalar(2.5);
      this.ring1.position.y = 2.1;
      this.ring1.raycast = noRaycast;
      this.ring2 = this.ring1.clone();
      this.ring2.scale.setScalar(2.9);
      this.ring2.rotation.x = Math.PI / 2;
      this.ring2.raycast = noRaycast;
      this.group.add(core, crown, this.ring1, this.ring2);
    } else if (this.type === 'grunt' || this.type === 'splitter' || this.type === 'mini') {
      this.buildGorilla();
    } else if (this.type === 'mite') {
      const body = new THREE.Mesh(GEO.box, this._mat(c.color, 0.6));
      body.scale.setScalar(0.42);
      body.position.y = c.height * 0.55;
      this._tag(body, 'body');
      this.body = body;
      const eye = new THREE.Mesh(GEO.sphere, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      eye.scale.setScalar(0.1);
      eye.position.set(0, c.height * 0.55, 0.32);
      eye.raycast = noRaycast;
      this.group.add(body, eye);
    } else {
      const w = this.type === 'tank' ? 1.5 : 0.7;
      const bh = c.height * 0.62;
      const body = new THREE.Mesh(GEO.box, this._mat(c.color));
      body.scale.set(w, bh, w * 0.7);
      body.position.y = bh / 2 + 0.1;
      this._tag(body, 'body');
      this.body = body;
      const head = new THREE.Mesh(GEO.sphere, this._mat(c.color, 0.55));
      head.scale.setScalar(this.type === 'tank' ? 0.42 : 0.3);
      head.position.y = bh + 0.32;
      this._tag(head, 'head');
      this.head = head;
      const eye = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      eye.scale.set(0.3, 0.06, 0.05);
      eye.position.set(0, bh + 0.34, this.type === 'tank' ? 0.4 : 0.28);
      eye.raycast = noRaycast;
      this.group.add(body, head, eye);
    }
    // blob shadow
    const blob = new THREE.Mesh(GEO.blob, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.scale.setScalar(this.cfg.radius * 1.3);
    blob.position.y = 0.02;
    blob.raycast = noRaycast;
    this.group.add(blob);
    this.blob = blob;
    if (this.spawnT > 0) this.group.scale.setScalar(0.01);
  }

  buildGorilla() {
    const c = this.cfg;
    const s = c.height / 1.65;
    this.gScale = s;
    const bulk = this.type === 'splitter' ? 1.25 : 1;
    const fur = this._mat(c.color);
    const skin = this._mat(new THREE.Color(c.color).lerp(new THREE.Color(0x8a8a99), 0.55).getHex(), 0.15);
    const mk = (geo, mat, sx, sy, sz, px, py, pz, part) => {
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(sx * s, sy * s, sz * s);
      m.position.set(px * s, py * s, pz * s);
      if (part) this._tag(m, part); else m.raycast = noRaycast;
      this.group.add(m);
      return m;
    };
    // barrel torso leaning forward: knuckle-walker silhouette
    this.body = mk(GEO.box, fur, 0.85 * bulk, 0.8, 0.55 * bulk, 0, 0.85, 0, 'body');
    this.body.rotation.x = 0.18;
    mk(GEO.box, skin, 0.6 * bulk, 0.45, 0.5 * bulk, 0, 0.42, -0.05, 'body'); // hips
    this.head = mk(GEO.sphere, fur, 0.27, 0.27, 0.27, 0, 1.34, 0.16, 'head');
    mk(GEO.box, fur, 0.42, 0.1, 0.14, 0, 1.42, 0.28, 'head'); // brow ridge
    mk(GEO.box, skin, 0.26, 0.17, 0.14, 0, 1.27, 0.34, null); // muzzle
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const ex of [-0.09, 0.09]) {
      const eye = new THREE.Mesh(GEO.sphere, eyeMat);
      eye.scale.setScalar(0.045 * s);
      eye.position.set(ex * s, 1.37 * s, 0.39 * s);
      eye.raycast = noRaycast;
      this.group.add(eye);
    }
    // long arms on shoulder pivots so they can swing and chest-beat
    this.armL = new THREE.Object3D();
    this.armR = new THREE.Object3D();
    for (const [pivot, side] of [[this.armL, -1], [this.armR, 1]]) {
      pivot.position.set(side * 0.52 * bulk * s, 1.12 * s, 0.05 * s);
      const arm = new THREE.Mesh(GEO.box, fur);
      arm.scale.set(0.24 * s, 1.0 * s, 0.24 * s);
      arm.position.set(0, -0.48 * s, 0);
      this._tag(arm, 'body');
      pivot.add(arm);
      const fist = new THREE.Mesh(GEO.sphere, skin);
      fist.scale.setScalar(0.16 * s);
      fist.position.set(0, -0.98 * s, 0);
      fist.raycast = noRaycast;
      pivot.add(fist);
      pivot.rotation.x = 0.45;
      this.group.add(pivot);
    }
    // stubby legs
    mk(GEO.box, fur, 0.24, 0.45, 0.28, -0.22 * bulk, 0.22, -0.05, 'body');
    mk(GEO.box, fur, 0.24, 0.45, 0.28, 0.22 * bulk, 0.22, -0.05, 'body');
  }

  eyePos(out) {
    out.copy(this.group.position);
    out.y += this.cfg.height * 0.85 + (this.type === 'flyer' ? this.cfg.fly : 0);
    return out;
  }

  damage(amount, isHead, hitPoint, dir, attacker) {
    if (this.dead) return;
    if (attacker && attacker !== this && !attacker.dead) {
      this.rageT = 5;
      this.rageTarget = attacker;
    }
    const amt = amount * (game.overdrive > 0 ? 2 : 1) * (isHead ? 2 : 1);
    this.hp -= amt;
    this.flashT = 0.07;
    for (const m of this.parts) m.material.emissiveIntensity = 2.2;
    showDamage(hitPoint, amt, isHead);
    if (isHead) audio.headshot(); else audio.hit();
    if (dir && this.type !== 'boss' && this.type !== 'tank') {
      const l = Math.hypot(dir.x, dir.z) || 1;
      this.vel.x += (dir.x / l) * 1.6;
      this.vel.z += (dir.z / l) * 1.6;
    }
    if (this.hp <= 0) this.die();
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    const gx = this.group.position.x, gz = this.group.position.z;
    const pos = this.group.position.clone();
    pos.y += this.cfg.height * 0.5 + (this.type === 'flyer' ? this.cfg.fly : 0);
    spawnBurst(pos, this.cfg.color, this.type === 'boss' ? 60 : 24, this.type === 'boss' ? 14 : 8, 0.9, 1.5);
    spawnBurst(pos, 0xffffff, 8, 5, 0.4, 0.9);
    audio.explosion(this.type === 'boss' || this.type === 'tank');
    if (this.armL) audio.apeRoar(this.type === 'splitter');
    enemiesGroup.remove(this.group);

    // scoring + streak
    game.kills++;
    game.streak++;
    game.streakTimer = 3;
    audio.killChime(Math.min(game.streak - 1, 7));
    const mult = 1 + Math.min(game.streak - 1, 8) * 0.25;
    game.score += Math.round(this.cfg.score * mult * this.scoreMult);
    const now = game.time;
    game.recentKills.push(now);
    game.recentKills = game.recentKills.filter((t) => now - t < 0.45);
    if (game.recentKills.length >= 2) {
      game.timeScale = 0.35;
      game.slowTimer = 0.4;
    }
    const names = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'OVERKILL', 5: 'RAMPAGE', 6: 'GODLIKE' };
    if (game.streak >= 2) {
      streakPopup(names[Math.min(game.streak, 6)] + '  +' + Math.round(this.cfg.score * mult));
      audio.streak(game.streak);
    }

    // style kill tags
    if (this.type !== 'boss') {
      let row = 0;
      const tag = (t, c, b) => { game.score += b; tagPopup(t + ' +' + b, c, row++); };
      const distP = Math.hypot(player.pos.x - gx, player.pos.z - gz);
      if (!player.onGround) tag('AERIAL', '#00ffee', 100);
      if (distP < 4) tag('POINT BLANK', '#ff44ff', 100);
      if (distP > 30) tag('LONGSHOT', '#ffd34d', 150);
      if (game.time - lastDashTime < 0.45) tag('DASH KILL', '#66ff66', 150);
      if (this.spawnT > 0) { tag('DENIED', '#66ffcc', Math.round(this.cfg.score * 0.5)); audio.denied(); }
      if (this.frenzied) tag('LAST STAND', '#ff5555', this.cfg.score);
    }

    // splitter: bursts into two fast minis
    if (this.cfg.split) {
      for (let i = 0; i < 2; i++) {
        const m = spawnEnemyAt('mini', gx + rand(-0.8, 0.8), gz + rand(-0.8, 0.8));
        m.spawnT = 0.15;
        m.vel.set(rand(-3, 3), 0, rand(-3, 3));
      }
    }
    // volt-mite: dies loudly, hurting everything nearby
    if (this.type === 'mite') {
      explosionAt(new THREE.Vector3(gx, 0.6, gz), this.cfg.boom.dmg * 0.85, this.cfg.boom.r, 0xffee33, false);
    }

    // drops
    if (this.type !== 'boss') {
      const r = Math.random();
      if (r < 0.2) spawnPickup('ammo', gx, gz, null, false, 11).small = true;
      else if (r < 0.3) spawnPickup('health', gx, gz, null, false, 11);
      if (this.frenzied) {
        spawnPickup('ammo', gx + 1, gz, null, false, 12).small = true;
        spawnPickup('health', gx - 1, gz, null, false, 12);
      }
    } else {
      bossDeath();
    }
  }

  fireAt(spec, leadFactor = 0) {
    const origin = this.eyePos(new THREE.Vector3());
    const target = new THREE.Vector3();
    const rt = this.rageT > 0 && this.rageTarget && !this.rageTarget.dead ? this.rageTarget : null;
    if (rt) {
      target.copy(rt.group.position);
      target.y += rt.cfg.height * 0.6 + (rt.type === 'flyer' ? rt.cfg.fly : 0);
      if (leadFactor > 0) target.addScaledVector(rt.vel, leadFactor);
    } else {
      target.set(player.pos.x, player.pos.y + 1.3, player.pos.z);
      if (leadFactor > 0) target.addScaledVector(player.vel, leadFactor);
    }
    const dir = target.sub(origin).normalize();
    fireEnemyProj(origin, dir, spec, this);
    audio.enemyShoot();
  }

  update(dt) {
    if (this.dead) return;
    const g = this.group;
    if (this.spawnT > 0) {
      this.spawnT -= dt;
      const s = clamp(1 - this.spawnT / 0.45, 0.01, 1);
      g.scale.setScalar(s);
      return;
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        for (const m of this.parts) m.material.emissiveIntensity = (this.head && m === this.head) ? 0.55 : 0.35;
      }
    }
    this.attackCd -= dt;

    // infighting: rage at whoever shot us (boss stays locked on the player)
    let rageTgt = null;
    if (this.rageT > 0 && this.type !== 'boss') {
      this.rageT -= dt;
      if (this.rageTarget && !this.rageTarget.dead && this.rageT > 0) rageTgt = this.rageTarget;
      else { this.rageT = 0; this.rageTarget = null; }
    }
    const tp = rageTgt ? rageTgt.group.position : player.pos;
    const toP = _v1.set(tp.x - g.position.x, 0, tp.z - g.position.z);
    const dist = toP.length();
    if (dist > 0.01) toP.divideScalar(dist);
    const fx = toP.x, fz = toP.z; // facing snapshot (toP may be clobbered by attack calls)

    // line of sight, staggered
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.22 + rand(0, 0.08);
      if (rageTgt) {
        this.canSee = true;
      } else {
        this.eyePos(_v2);
        _v3.set(player.pos.x, player.pos.y + 1.4, player.pos.z).sub(_v2);
        const pd = _v3.length();
        raycaster.set(_v2, _v3.divideScalar(pd));
        raycaster.far = Math.max(0.1, pd - 0.3);
        this.canSee = raycaster.intersectObjects(staticGroup.children, false).length === 0;
      }
    }

    // steering
    const move = _v2.set(0, 0, 0);
    const b = this.cfg.behavior;
    if (b === 'chase') {
      move.copy(toP);
      if (!this.canSee) move.add(_v3.set(toP.z, 0, -toP.x).multiplyScalar(this.strafeDir * 0.6));
      if (this.windup >= 0) {
        this.windup -= dt;
        if (this.windup <= 0) {
          this.windup = -1;
          if (dist < this.cfg.melee.range + 0.5) {
            if (rageTgt) rageTgt.damage(this.cfg.melee.dmg, false, rageTgt.group.position, null, this);
            else hurtPlayer(this.cfg.melee.dmg, g.position, false);
          }
        }
      } else if (dist < this.cfg.melee.range && this.attackCd <= 0) {
        this.attackCd = this.cfg.melee.cd;
        this.windup = this.cfg.melee.windup;
        if (this.armL) audio.hoot();
        for (const m of this.parts) m.material.emissiveIntensity = 1.6;
      }
    } else if (b === 'ranged') {
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = rand(1.5, 3.5); this.strafeDir *= -1; }
      const [near, far] = this.cfg.keep;
      if (dist > far || (!this.canSee && !rageTgt)) move.copy(toP);
      else if (dist < near) move.copy(toP).negate();
      move.add(_v3.set(toP.z, 0, -toP.x).multiplyScalar(this.strafeDir * 0.8));
      if ((this.canSee || rageTgt) && this.attackCd <= 0 && dist < far + 6) {
        this.attackCd = this.cfg.shot.cd * rand(0.85, 1.15);
        this.fireAt(this.cfg.shot, this.cfg.shot.lead || 0);
      }
    } else if (b === 'flyer') {
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = rand(2, 4); this.strafeDir *= -1; }
      const orbitErr = dist - this.cfg.orbit;
      move.copy(toP).multiplyScalar(clamp(orbitErr * 0.4, -1, 1));
      move.add(_v3.set(toP.z, 0, -toP.x).multiplyScalar(this.strafeDir));
      if ((this.canSee || rageTgt) && this.attackCd <= 0) {
        this.attackCd = this.cfg.shot.cd * rand(0.85, 1.2);
        this.fireAt(this.cfg.shot, this.cfg.shot.lead);
      }
    } else if (b === 'kamikaze') {
      move.copy(toP);
      this.beepT -= dt;
      if (this.beepT <= 0) {
        this.beepT = clamp(dist * 0.05, 0.07, 0.5);
        audio.miteBeep(400 + (1 - clamp(dist / 12, 0, 1)) * 800);
      }
      const pulse = 1 + Math.sin(game.time * (4 + Math.max(0, 12 - dist))) * 0.18;
      this.body.scale.setScalar(0.42 * pulse);
      this.parts[0].material.emissiveIntensity = 0.4 + pulse;
      if (dist < 2) {
        this.dead = true;
        enemiesGroup.remove(this.group);
        // flat hit if the player is in the blast: the telegraph must be honest
        const pd = Math.hypot(player.pos.x - g.position.x, player.pos.z - g.position.z);
        if (pd < 2.6) hurtPlayer(16, new THREE.Vector3(g.position.x, 0.9, g.position.z), true);
        explosionAt(new THREE.Vector3(g.position.x, 0.6, g.position.z), this.cfg.boom.dmg, this.cfg.boom.r, 0xffee33, false);
        return;
      }
    } else if (b === 'boss') {
      this.bossUpdate(dt, dist, toP, move);
    }

    // separation
    for (const o of enemies) {
      if (o === this || o.dead) continue;
      const dx = g.position.x - o.group.position.x;
      const dz = g.position.z - o.group.position.z;
      const d = Math.hypot(dx, dz);
      const min = this.cfg.radius + o.cfg.radius + 0.35;
      if (d < min && d > 0.01) move.add(_v3.set(dx / d, 0, dz / d).multiplyScalar((min - d) * 1.4));
    }

    if (move.lengthSq() > 1) move.normalize();
    this.vel.x = lerp(this.vel.x, move.x * this.cfg.speed, 1 - Math.exp(-6 * dt));
    this.vel.z = lerp(this.vel.z, move.z * this.cfg.speed, 1 - Math.exp(-6 * dt));
    g.position.x += this.vel.x * dt;
    g.position.z += this.vel.z * dt;

    if (b !== 'flyer') {
      resolveCircle(g.position, this.cfg.radius);
    }
    g.position.x = clamp(g.position.x, -ARENA.hx + 1, ARENA.hx - 1);
    g.position.z = clamp(g.position.z, -ARENA.hz + 1, ARENA.hz - 1);

    // facing + anim
    if (dist > 0.5) g.rotation.y = Math.atan2(fx, fz);
    this.bobP += dt * 5;
    if (this.frenzied) {
      g.scale.setScalar(1 + Math.sin(game.time * 12) * 0.08);
      this.parts[0].material.emissiveIntensity = 1 + Math.sin(game.time * 25) * 0.8;
    }
    if (b === 'flyer') {
      this.body.position.y = this.cfg.fly + Math.sin(this.bobP) * 0.35;
      this.body.rotation.y += dt * 3;
      this.blob.material.opacity = 0.22;
    } else if (b === 'boss') {
      this.ring1.rotation.x += dt * 0.9;
      this.ring1.rotation.y += dt * 0.5;
      this.ring2.rotation.z += dt * 1.2;
      this.body.rotation.y += dt * (0.6 + this.phase * 0.5);
      this.body.position.y = 2.1 + Math.sin(this.bobP * 0.5) * 0.15;
    } else if (this.armL) {
      // gorilla: knuckle-walk arm swing, chest-beat during melee windup
      const sG = this.gScale;
      const moveAmt = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / this.cfg.speed);
      if (this.windup >= 0) {
        const beat = Math.sin(game.time * 28);
        this.armL.rotation.x = -1.9 + beat * 0.5;
        this.armR.rotation.x = -1.9 - beat * 0.5;
      } else {
        const sw = Math.sin(this.bobP * 1.7) * 0.55 * moveAmt;
        this.armL.rotation.x = 0.45 + sw;
        this.armR.rotation.x = 0.45 - sw;
      }
      this.body.position.y = (0.85 + Math.abs(Math.sin(this.bobP * 1.7)) * 0.05 * moveAmt) * sG;
    } else if (this.head) {
      this.body.scale.y = this.cfg.height * 0.62 * (1 + Math.sin(this.bobP) * 0.03);
    }
  }

  bossUpdate(dt, dist, toP, move) {
    const hpr = this.hp / this.maxHp;
    const phase = hpr > 0.66 ? 0 : hpr > 0.33 ? 1 : 2;
    if (phase !== this.phase) {
      this.phase = phase;
      audio.bossRoar();
      addShake(0.5);
      banner(phase === 1 ? 'THE CORE DESTABILIZES' : 'THE CORE IS DESPERATE', '', 1.6);
      audio.intensity = 3;
      this.cfg = { ...this.cfg, speed: this.cfg.speed + 0.9 };
    }
    // drift toward mid-range
    if (dist > 13) move.copy(toP);
    else if (dist < 6) move.copy(toP).negate();
    move.add(_v3.set(toP.z, 0, -toP.x).multiplyScalar(this.strafeDir * 0.5));
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeT = rand(2.5, 4.5); this.strafeDir *= -1; }

    // bullet ring
    this.ringT -= dt;
    if (this.ringT <= 0) {
      this.ringT = [3.2, 2.4, 1.7][phase];
      const n = 14 + phase * 4;
      const eye = this.eyePos(new THREE.Vector3());
      eye.y = 1.4;
      const d = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand(0, 0.3);
        fireEnemyProj(eye, d.set(Math.cos(a), 0, Math.sin(a)), { dmg: 11, speed: 9 + phase * 2, r: 0.28, color: 0xff66cc }, this);
      }
      audio.enemyShoot();
      addShake(0.15);
    }
    // aimed bursts
    if (phase >= 1) {
      this.burstT -= dt;
      if (this.burstT <= 0) {
        this.burstT = 2.3;
        for (let i = 0; i < 3; i++) after(i * 0.13, () => { if (!this.dead) this.fireAt({ dmg: 13, speed: 17, r: 0.25, color: 0xff44bb }, 0.4); });
      }
    }
    // summons
    if (phase === 2) {
      this.summonT -= dt;
      if (this.summonT <= 0 && enemies.filter((e) => !e.dead).length < 8) {
        this.summonT = 11;
        banner('REINFORCEMENTS', '', 1);
        for (let i = 0; i < 4; i++) {
          const a = rand(0, Math.PI * 2);
          spawnEnemyAt(i < 2 ? 'grunt' : 'mite', this.group.position.x + Math.cos(a) * 5, this.group.position.z + Math.sin(a) * 5);
        }
      }
    }
    // stomp if player hugs the boss
    this.stompT -= dt;
    if (dist < 4.5 && this.stompT <= 0) {
      this.stompT = 2.6;
      for (const m of this.parts) m.material.emissiveIntensity = 2.5;
      after(0.45, () => {
        if (this.dead) return;
        const bx = this.group.position.x, bz = this.group.position.z;
        const d2 = Math.hypot(player.pos.x - bx, player.pos.z - bz);
        spawnBurst(new THREE.Vector3(bx, 0.4, bz), 0xff2299, 30, 10, 0.6, 1.4);
        addShake(0.45);
        audio.explosion(true);
        if (d2 < 6 && player.pos.y < 1.2) {
          hurtPlayer(26, this.group.position, false);
          const l = Math.max(0.1, d2);
          player.vel.x += ((player.pos.x - bx) / l) * 14;
          player.vel.z += ((player.pos.z - bz) / l) * 14;
          player.vel.y += 6;
        }
      });
    }
    ui.bossbar.style.width = clamp(hpr * 100, 0, 100) + '%';
  }
}

function bossDeath() {
  ui.bosswrap.classList.add('hidden');
  levelDone = true;
  game.timeScale = 0.25;
  game.slowTimer = 1.2;
  banner('CORE TERMINATED', '', 3);
  const at = boss ? boss.group.position.clone() : new THREE.Vector3();
  for (let i = 0; i < 7; i++) {
    after(0.18 * i, () => {
      const p = new THREE.Vector3(at.x + rand(-3, 3), rand(0.5, 4), at.z + rand(-3, 3));
      spawnBurst(p, 0xff2299, 26, 12, 0.9, 1.8);
      spawnBurst(p, 0xffffff, 8, 8, 0.4, 1);
      audio.explosion(true);
      addShake(0.3);
    });
  }
  // remaining minions go down with the core
  for (const e of enemies) {
    if (!e.dead && e.type !== 'boss') after(0.4, () => e.damage(99999, false, e.group.position.clone(), null));
  }
  boss = null;
  after(2.4, winGame);
}

// ============================================================ enemy projectiles
function fireEnemyProj(origin, dir, spec, shooter) {
  const m = new THREE.Mesh(GEO.sphere, projMat(spec.color));
  m.scale.setScalar(spec.r);
  m.position.copy(origin);
  m.raycast = noRaycast;
  scene.add(m);
  eProjs.push({
    mesh: m, pos: origin.clone(), vel: dir.clone().multiplyScalar(spec.speed),
    dmg: spec.dmg, r: spec.r, splash: spec.splash || 0, life: 6,
    shooter: shooter || null, dodged: false, grazed: false, dead: false,
  });
}

function pointInWall(x, y, z) {
  for (const w of walls) {
    if (x > w.minX && x < w.maxX && z > w.minZ && z < w.maxZ && y < w.h) return true;
  }
  return false;
}

function updateEnemyProjs(dt) {
  perfectCd -= dt;
  for (const p of eProjs) {
    if (p.dead) continue;
    p.life -= dt;
    p.pos.addScaledVector(p.vel, dt);
    p.mesh.position.copy(p.pos);
    let impact = false;
    if (p.life <= 0 || p.pos.y < 0.05 || pointInWall(p.pos.x, p.pos.y, p.pos.z) ||
        Math.abs(p.pos.x) > ARENA.hx + 2 || Math.abs(p.pos.z) > ARENA.hz + 2) impact = true;

    const dy = p.pos.y - (player.pos.y + 0.9);
    const dxz = Math.hypot(p.pos.x - player.pos.x, p.pos.z - player.pos.z);
    const near = Math.hypot(dy, dxz);
    const dashWindow = player.invuln > 0 && game.time - lastDashTime < 0.32;

    if (!impact && Math.abs(dy) < 1.1 && dxz < p.r + player.radius + 0.1) {
      if (player.invuln <= 0 && !levelDone) {
        hurtPlayer(p.dmg, p.pos, false);
        impact = true;
      }
    }
    // perfect dodge: a bullet phases through you mid-dash
    if (!impact && !p.dodged && dashWindow && near < 1.5) {
      p.dodged = true;
      if (perfectCd <= 0) {
        perfectCd = 0.5;
        game.timeScale = 0.3;
        game.slowTimer = 0.35;
        player.dashCd = 0; // refund: chains
        tagPopup('PERFECT DODGE', '#ffffff', 0);
        audio.perfect();
        spawnBurst(p.pos, 0xffffff, 8, 5, 0.4, 0.8);
      }
    }
    // graze: close call pays out
    if (!impact && !p.grazed && !dashWindow && near < 1.25 && near > p.r + player.radius + 0.15) {
      p.grazed = true;
      if (game.time - lastGraze > 0.2) {
        lastGraze = game.time;
        game.score += 25;
        tagPopup('GRAZE +25', '#88ddff', 1);
        if (game.streakTimer > 0) game.streakTimer = Math.min(3, game.streakTimer + 0.4);
        spawnBurst(p.pos, 0x88ddff, 3, 3, 0.25, 0.5);
        audio.graze();
      }
    }
    // infighting: stray enemy fire hits other enemies
    if (!impact) {
      for (const e of enemies) {
        if (e.dead || e === p.shooter || e.spawnT > 0) continue;
        const ey = e.group.position.y + e.cfg.height * 0.5 + (e.type === 'flyer' ? e.cfg.fly : 0);
        if (Math.abs(p.pos.y - ey) < e.cfg.height * 0.7 + 0.2 &&
            Math.hypot(p.pos.x - e.group.position.x, p.pos.z - e.group.position.z) < p.r + e.cfg.radius) {
          e.damage(p.dmg, false, p.pos.clone(), p.vel, p.shooter);
          impact = true;
          break;
        }
      }
    }

    if (impact) {
      if (p.splash > 0) {
        spawnBurst(p.pos, 0xffdd66, 14, 7, 0.5, 1.2);
        audio.explosion(false);
        const d3 = Math.hypot(player.pos.x - p.pos.x, player.pos.y + 0.9 - p.pos.y, player.pos.z - p.pos.z);
        if (d3 < p.splash + 0.8) hurtPlayer(p.dmg * 0.6, p.pos, true);
      } else {
        spawnBurst(p.pos, 0xffffff, 3, 3, 0.25, 0.6);
      }
      p.dead = true;
      scene.remove(p.mesh);
    }
  }
  eProjs = eProjs.filter((p) => !p.dead);
}

// ============================================================ rockets (player)
function spawnRocket(origin, dir) {
  const w = WEAPONS[WIDX.rocket];
  const m = new THREE.Mesh(GEO.sphere, projMat(0xffaa66));
  m.scale.set(0.16, 0.16, 0.4);
  m.position.copy(origin);
  m.raycast = noRaycast;
  scene.add(m);
  rockets.push({ mesh: m, pos: origin.clone(), vel: dir.clone().multiplyScalar(w.speed), life: 5, dead: false });
}

function updateRockets(dt) {
  const w = WEAPONS[WIDX.rocket];
  for (const r of rockets) {
    if (r.dead) continue;
    r.life -= dt;
    r.pos.addScaledVector(r.vel, dt);
    r.mesh.position.copy(r.pos);
    r.mesh.quaternion.setFromUnitVectors(UP, _v1.copy(r.vel).normalize());
    if (Math.random() < 0.6) spawnBurst(r.pos, 0xff8844, 1, 1.2, 0.3, 0.6);
    let boom = r.life <= 0 || r.pos.y < 0.05 || pointInWall(r.pos.x, r.pos.y, r.pos.z);
    let directHit = null;
    if (!boom) {
      for (const e of enemies) {
        if (e.dead || e.spawnT > 0) continue;
        const ey = e.group.position.y + e.cfg.height * 0.5 + (e.type === 'flyer' ? e.cfg.fly : 0);
        if (Math.abs(r.pos.y - ey) < e.cfg.height * 0.7 + 0.3 &&
            Math.hypot(r.pos.x - e.group.position.x, r.pos.z - e.group.position.z) < e.cfg.radius + 0.45) {
          e.damage(w.dmg, false, r.pos.clone(), r.vel);
          directHit = e;
          boom = true;
          break;
        }
      }
    }
    if (!boom) {
      for (const b of barrels) {
        if (!b.dead && Math.hypot(r.pos.x - b.x, r.pos.z - b.z) < 1 && r.pos.y < 1.4) { boom = true; break; }
      }
    }
    if (boom) {
      r.dead = true;
      scene.remove(r.mesh);
      explosionAt(r.pos, w.splash, w.splashR, 0xff7733, true, directHit);
    }
  }
  rockets = rockets.filter((r) => !r.dead);
}

// ============================================================ collision
function resolveCircle(pos, r) {
  for (let pass = 0; pass < 2; pass++) {
    for (const w of walls) {
      const cx = clamp(pos.x, w.minX, w.maxX);
      const cz = clamp(pos.z, w.minZ, w.maxZ);
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x = cx + (dx / d) * r;
          pos.z = cz + (dz / d) * r;
        } else {
          const l = pos.x - w.minX + r, ri = w.maxX - pos.x + r, t = pos.z - w.minZ + r, bo = w.maxZ - pos.z + r;
          const m = Math.min(l, ri, t, bo);
          if (m === l) pos.x = w.minX - r;
          else if (m === ri) pos.x = w.maxX + r;
          else if (m === t) pos.z = w.minZ - r;
          else pos.z = w.maxZ + r;
        }
      }
    }
  }
}

// ============================================================ waves
function spawnEnemyAt(type, x, z) {
  const e = new Enemy(type, x, z);
  enemies.push(e);
  if (type === 'boss') boss = e;
  return e;
}

function findSpawnPos() {
  for (let i = 0; i < 24; i++) {
    const x = rand(-ARENA.hx + 3, ARENA.hx - 3);
    const z = rand(-ARENA.hz + 3, ARENA.hz - 3);
    if (Math.hypot(x - player.pos.x, z - player.pos.z) < 13) continue;
    let bad = false;
    for (const w of walls) {
      if (x > w.minX - 1 && x < w.maxX + 1 && z > w.minZ - 1 && z < w.maxZ + 1) { bad = true; break; }
    }
    if (!bad) return { x, z };
  }
  return { x: 0, z: 0 };
}

function startWave(i) {
  waveIdx = i;
  waveActive = true;
  const wave = LEVEL.waves[i];
  audio.intensity = LEVEL.boss ? 3 : Math.min(3, i + (game.levelIdx > 1 ? 1 : 0));
  let delay = 0;
  for (const spec of wave) {
    for (let n = 0; n < spec.n; n++) {
      spawnQueue.push({ t: delay, type: spec.t, telegraphed: false, done: false });
      delay += 0.18;
    }
  }
  if (!LEVEL.boss) banner('WAVE ' + (i + 1) + ' / ' + LEVEL.waves.length, '', 1.4);
  else banner('THE CORE AWAKENS', 'DESTROY IT', 2.2);
}

function updateSpawns(dt) {
  for (const s of spawnQueue) {
    s.t -= dt;
    if (s.t > 0 || s.done) continue;
    if (!s.telegraphed) {
      // 1s warning beam at the spawn point: pre-aim for a DENIED bonus
      s.telegraphed = true;
      s.t = 1.0;
      const p = s.type === 'boss' ? { x: 0, z: 0 } : findSpawnPos();
      s.x = p.x; s.z = p.z;
      s.beam = new THREE.Mesh(GEO.cyl, new THREE.MeshBasicMaterial({ color: ENEMY_TYPES[s.type].color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.beam.scale.set(0.3, 24, 0.3);
      s.beam.position.set(s.x, 12, s.z);
      s.beam.raycast = noRaycast;
      levelGroup.add(s.beam);
      audio.riser();
    } else {
      s.done = true;
      levelGroup.remove(s.beam);
      spawnEnemyAt(s.type, s.x, s.z);
    }
  }
  spawnQueue = spawnQueue.filter((s) => !s.done);
}

function checkWave() {
  if (!waveActive || levelDone) return;
  if (spawnQueue.length === 0 && enemies.every((e) => e.dead)) {
    waveActive = false;
    if (waveIdx + 1 < LEVEL.waves.length) {
      after(1.6, () => startWave(waveIdx + 1));
    } else if (!LEVEL.boss) {
      levelDone = true;
      player.hp = Math.min(player.maxHp, player.hp + 25);
      after(0.7, spawnPortal);
    }
    // boss level end handled by bossDeath()
  }
}

function checkLastStand() {
  if (!waveActive || LEVEL.boss || spawnQueue.length > 0) return;
  const alive = enemies.filter((e) => !e.dead);
  if (alive.length === 1 && !alive[0].frenzied && alive[0].spawnT <= 0 && alive[0].type !== 'mite') frenzy(alive[0]);
}

function frenzy(e) {
  e.frenzied = true;
  e.scoreMult = 2;
  e.cfg = { ...e.cfg, speed: e.cfg.speed * 1.6 };
  const beam = new THREE.Mesh(GEO.cyl, new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.scale.set(0.13, 26, 0.13);
  beam.position.y = 13;
  beam.raycast = noRaycast;
  e.group.add(beam);
  audio.siren();
  tagPopup('LAST STAND — DOUBLE SCORE', '#ff5555', 2);
}

// ============================================================ shooting
const raycaster = new THREE.Raycaster();

function muzzleWorld(out) {
  const g = gunModels[player.cur];
  return g.userData.muzzle.getWorldPosition(out);
}

function tryFire() {
  if (game.state !== 'playing' || player.cooldown > 0) return;
  const w = WEAPONS[player.cur];
  if (player.ammo[player.cur] <= 0) {
    audio.noAmmo();
    player.cooldown = 0.25;
    if (player.cur !== 0) switchWeapon(0); // auto-fallback to blaster
    return;
  }
  // carry the cooldown remainder so fire rates do not quantize to frame boundaries
  player.cooldown = (player.cooldown > -0.05 ? player.cooldown : 0) + w.rate;
  if (player.ammo[player.cur] !== Infinity) player.ammo[player.cur]--;
  game.shots++;
  audio.shoot(w.id);

  // feel
  recoilHeat = Math.min(1, recoilHeat + (w.pellets > 1 ? 0.6 : 0.25));
  addShake(w.shake * 0.5);
  fovPunch += w.fovP * 0.4;
  if (w.id === 'blaster') vmImpulse(0.06, 0.05);
  else if (w.id === 'scatter') vmImpulse(0.18, 0.15);
  else if (w.id === 'smg') vmImpulse(0.04, 0.03, rand(-0.012, 0.012));
  else vmImpulse(0.22, 0.18);
  recoilPitch += w.pellets > 1 ? 0.03 : 0.01;

  const mw = muzzleWorld(new THREE.Vector3());
  muzzleLight.color.setHex(w.color);
  muzzleLight.intensity = 50;
  muzzleLight.position.copy(mw);

  const baseDir = camera.getWorldDirection(new THREE.Vector3());
  const camPos = camera.position;

  if (w.projectile) {
    spawnRocket(mw, baseDir);
    return;
  }

  const right = new THREE.Vector3().crossVectors(baseDir, UP).normalize();
  const upv = new THREE.Vector3().crossVectors(right, baseDir);
  let anyHit = false, anyCrit = false;
  for (let i = 0; i < w.pellets; i++) {
    const dir = baseDir.clone()
      .addScaledVector(right, rand(-w.spread, w.spread))
      .addScaledVector(upv, rand(-w.spread, w.spread))
      .normalize();
    raycaster.set(camPos, dir);
    raycaster.far = 120;
    const hits = raycaster.intersectObjects([staticGroup, enemiesGroup, barrelsGroup], true);
    const h = hits[0];
    const end = h ? h.point : dir.clone().multiplyScalar(90).add(camPos);
    spawnTracer(mw, end, w.color);
    if (h) {
      const ud = h.object.userData;
      if (ud.enemyRef && !ud.enemyRef.dead) {
        const crit = ud.part === 'head';
        ud.enemyRef.damage(w.dmg, crit, h.point, dir);
        anyHit = true;
        anyCrit = anyCrit || crit;
      } else if (ud.barrel) {
        explodeBarrel(ud.barrel);
        anyHit = true;
      } else {
        spawnBurst(h.point, LEVEL.accent, 4, 4, 0.3, 0.6);
      }
    }
  }
  if (anyHit) { game.hits++; hitmarkerFlash(anyCrit); }
}

function switchWeapon(i, silent = false) {
  if (!player.owned[i] || i === player.cur) return;
  player.cur = i;
  vmImpulse(0.1, 0.25);
  if (!silent) audio.ui();
  for (let n = 0; n < gunModels.length; n++) gunModels[n].visible = n === i;
  refreshSlots();
}

function cycleWeapon(dirSign) {
  for (let step = 1; step <= 4; step++) {
    const i = (((player.cur + dirSign * step) % 4) + 4) % 4;
    if (player.owned[i]) { switchWeapon(i); return; }
  }
}

// ============================================================ viewmodel (spring-damped)
const viewmodel = new THREE.Group();
viewmodel.position.set(0.3, -0.28, -0.5);
viewmodel.scale.setScalar(0.62);
camera.add(viewmodel);
const gunModels = [];
let vmZ = 0, vmZv = 0, vmRX = 0, vmRXv = 0, vmX = 0, vmXv = 0;
function vmImpulse(z, rot, lat = 0) { vmZ += z; vmRX += rot; vmX += lat; }

function buildGuns() {
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a3850, roughness: 0.4, metalness: 0.55, emissive: 0x121b2c, emissiveIntensity: 0.8 });
  WEAPONS.forEach((w, i) => {
    const g = new THREE.Group();
    const glow = new THREE.MeshBasicMaterial({ color: w.color });
    const add = (geo, mat, sx, sy, sz, px, py, pz) => {
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(px, py, pz);
      m.raycast = noRaycast;
      g.add(m);
      return m;
    };
    if (w.id === 'blaster') {
      add(GEO.box, bodyMat, 0.09, 0.15, 0.30, 0, 0, 0);
      add(GEO.box, bodyMat, 0.07, 0.09, 0.10, 0, -0.10, 0.08);
      add(GEO.box, glow, 0.03, 0.03, 0.32, 0, 0.045, -0.06);
    } else if (w.id === 'scatter') {
      add(GEO.box, bodyMat, 0.13, 0.13, 0.46, 0, 0, -0.04);
      add(GEO.cyl, bodyMat, 0.035, 0.4, 0.035, -0.03, 0.02, -0.18).rotation.x = Math.PI / 2;
      add(GEO.cyl, bodyMat, 0.035, 0.4, 0.035, 0.03, 0.02, -0.18).rotation.x = Math.PI / 2;
      add(GEO.box, glow, 0.15, 0.02, 0.06, 0, 0.075, 0.05);
    } else if (w.id === 'smg') {
      add(GEO.box, bodyMat, 0.08, 0.12, 0.5, 0, 0, -0.05);
      add(GEO.box, bodyMat, 0.06, 0.16, 0.07, 0, -0.13, 0.05);
      add(GEO.cyl, bodyMat, 0.025, 0.2, 0.025, 0, 0.01, -0.36).rotation.x = Math.PI / 2;
      add(GEO.box, glow, 0.09, 0.02, 0.4, 0, 0.07, -0.05);
    } else {
      add(GEO.cyl, bodyMat, 0.085, 0.62, 0.085, 0, 0, -0.05).rotation.x = Math.PI / 2;
      add(GEO.box, bodyMat, 0.1, 0.16, 0.16, 0, -0.08, 0.14);
      add(GEO.cyl, glow, 0.06, 0.04, 0.06, 0, 0, -0.37).rotation.x = Math.PI / 2;
    }
    const mz = new THREE.Object3D();
    mz.position.set(0, 0.02, -0.45);
    g.add(mz);
    g.userData.muzzle = mz;
    g.visible = i === 0;
    viewmodel.add(g);
    gunModels.push(g);
  });
}
buildGuns();

function updateViewmodel(dt) {
  const k = 120, c = 22;
  vmZv += (-k * vmZ - c * vmZv) * dt; vmZ += vmZv * dt;
  vmRXv += (-k * vmRX - c * vmRXv) * dt; vmRX += vmRXv * dt;
  vmXv += (-k * vmX - c * vmXv) * dt; vmX += vmXv * dt;
  const moving = (keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD) && player.onGround;
  const bob = moving ? Math.sin(player.bobT * 2) * 0.012 : 0;
  viewmodel.position.set(0.3 + vmX, -0.28 + bob - vmZ * 0.3, -0.5 + vmZ);
  viewmodel.rotation.x = vmRX;
}

// ============================================================ player damage / death
function hurtPlayer(dmg, fromPos, isSplash) {
  if (game.state !== 'playing' || player.invuln > 0 || levelDone) return;
  player.invuln = 0.18;
  player.hp -= dmg;
  audio.hurt();
  addShake(0.25);
  ui.vignette.style.opacity = 0.9;
  if (fromPos && !isSplash) {
    const kx = player.pos.x - fromPos.x, kz = player.pos.z - fromPos.z;
    const l = Math.hypot(kx, kz);
    if (l > 0.1) {
      player.vel.x += (kx / l) * 3.5;
      player.vel.z += (kz / l) * 3.5;
    }
  }
  if (player.hp <= 0) {
    player.hp = 0;
    killPlayer();
  }
}

function killPlayer() {
  game.state = 'dead';
  audio.playerDie();
  audio.stopMusic();
  if (document.exitPointerLock) document.exitPointerLock();
  ui.deathStats.innerHTML = statsHTML(false);
  ui.death.classList.remove('hidden');
  ui.hud.classList.add('hidden');
}

// ============================================================ game flow
function statsHTML(won) {
  const m = Math.floor(game.time / 60), s = Math.floor(game.time % 60);
  const acc = game.shots > 0 ? Math.round((game.hits / game.shots) * 100) : 0;
  const isRecord = game.score > game.hi;
  if (isRecord && won) { game.hi = game.score; safeSet('ns_hi', String(game.hi)); }
  return (
    `<div>SCORE <b>${game.score.toLocaleString()}</b></div>` +
    `<div>KILLS <b>${game.kills}</b></div>` +
    `<div>ACCURACY <b>${acc}%</b></div>` +
    `<div>TIME <b>${m}:${String(s).padStart(2, '0')}</b></div>` +
    `<div>BEST <b>${game.hi.toLocaleString()}</b></div>` +
    (isRecord && won ? `<div class="newrec">NEW RECORD</div>` : '')
  );
}

function hideOverlays() {
  for (const el of [ui.menu, ui.pause, ui.death, ui.win]) el.classList.add('hidden');
}

function startGame(levelIdx = 0, freshRun = true) {
  audio.init();
  audio.resume();
  audio.duckMusic(false);
  if (freshRun) {
    game.score = 0; game.kills = 0; game.shots = 0; game.hits = 0; game.time = 0;
    game.streak = 0; game.overdrive = 0;
    player.hp = player.maxHp;
    player.owned = [true, false, false, false];
    player.ammo = [Infinity, 0, 0, 0];
    player.cur = 0;
    for (let n = 0; n < gunModels.length; n++) gunModels[n].visible = n === 0;
  }
  game.levelIdx = levelIdx;
  game.timeScale = 1;
  game.slowTimer = 0;
  game.recentKills = [];
  lastDashTime = -10;
  lastGraze = -10;
  perfectCd = 0;
  // snapshot run stats at sector start so a retry cannot farm score
  game.levelStartScore = game.score;
  game.levelStartKills = game.kills;
  game.levelStartShots = game.shots;
  game.levelStartHits = game.hits;
  buildLevel(levelIdx);
  hideOverlays();
  ui.hud.classList.remove('hidden');
  refreshSlots();
  game.state = 'playing';
  requestLock();
  banner(LEVEL.name, LEVEL.sub, 2.4);
  after(1.6, () => startWave(0));
}

function retryLevel() {
  player.hp = player.maxHp;
  game.overdrive = 0;
  // roll run stats back to the sector start: deaths must not inflate score
  game.score = game.levelStartScore;
  game.kills = game.levelStartKills;
  game.shots = game.levelStartShots;
  game.hits = game.levelStartHits;
  for (let i = 1; i < WEAPONS.length; i++) {
    if (player.owned[i]) player.ammo[i] = Math.max(player.ammo[i], WEAPONS[i].start);
  }
  startGame(game.levelIdx, false);
}

function nextLevel() {
  if (levelDone === 'gone') return;
  levelDone = 'gone';
  const next = game.levelIdx + 1;
  if (next >= LEVELS.length) { winGame(); return; }
  game.score += 500; // sector bonus
  startGame(next, false);
}

function winGame() {
  if (game.state === 'win') return;
  game.state = 'win';
  audio.stopMusic();
  audio.fanfare();
  if (document.exitPointerLock) document.exitPointerLock();
  ui.winStats.innerHTML = statsHTML(true);
  ui.win.classList.remove('hidden');
  ui.hud.classList.add('hidden');
}

function pauseGame() {
  if (game.state !== 'playing') return;
  game.state = 'paused';
  audio.duckMusic(true);
  if (document.exitPointerLock) document.exitPointerLock();
  ui.pause.classList.remove('hidden');
}

function resumeGame() {
  if (game.state !== 'paused') return;
  hideOverlays();
  game.state = 'playing';
  audio.duckMusic(false);
  audio.resume();
  requestLock();
}

function quitToMenu() {
  game.state = 'menu';
  audio.stopMusic();
  if (document.exitPointerLock) document.exitPointerLock();
  hideOverlays();
  ui.hud.classList.add('hidden');
  ui.menu.classList.remove('hidden');
  ui.menuHi.textContent = game.hi > 0 ? 'HIGH SCORE  ' + game.hi.toLocaleString() : '';
}

// ============================================================ HUD
function refreshSlots() {
  const spans = ui.slots.children;
  for (let i = 0; i < 4; i++) {
    spans[i].classList.toggle('owned', player.owned[i]);
    spans[i].classList.toggle('active', i === player.cur);
  }
}

function updateHUD() {
  const hpr = clamp(player.hp / player.maxHp, 0, 1);
  ui.hpbar.style.width = (hpr * 100) + '%';
  ui.hpbar.style.background = hpr > 0.5 ? 'var(--accent)' : hpr > 0.25 ? '#ffaa22' : '#ff3344';
  ui.hpnum.textContent = Math.ceil(player.hp);
  ui.lowhp.classList.toggle('pulse', hpr < 0.3 && game.state === 'playing');
  const w = WEAPONS[player.cur];
  ui.ammoName.textContent = w.name;
  ui.ammoNum.textContent = player.ammo[player.cur] === Infinity ? '∞' : player.ammo[player.cur];
  ui.score.textContent = game.score.toLocaleString();
  ui.scoremult.textContent = game.streak >= 2 ? 'x' + (1 + Math.min(game.streak - 1, 8) * 0.25).toFixed(2) + ' STREAK ' + game.streak : '';
  if (LEVEL.boss) {
    ui.wave.textContent = '';
  } else {
    const left = enemies.filter((e) => !e.dead).length + spawnQueue.length;
    ui.wave.textContent = levelDone ? 'PORTAL OPEN' : (waveActive ? 'WAVE ' + (waveIdx + 1) + '/' + LEVEL.waves.length + ' — ' + left + ' HOSTILES' : '');
  }
  // crosshair spread
  const sp = 7 + recoilHeat * 26 + (player.onGround ? 0 : 6);
  ui.crosshair.style.setProperty('--sp', sp + 'px');
  // vignette decay
  const v = parseFloat(ui.vignette.style.opacity || 0);
  if (v > 0) ui.vignette.style.opacity = Math.max(0, v - 0.04);
  // overdrive
  ui.odtint.classList.toggle('on', game.overdrive > 0);
  ui.odlabel.classList.toggle('on', game.overdrive > 0);
  if (game.overdrive > 0) ui.odlabel.textContent = 'OVERDRIVE ' + game.overdrive.toFixed(1);
  // mouse-capture hint: never leave the player aiming a dead mouse without telling them
  const needLock = !TEST && !TOUCH && !pointerLocked && game.state === 'playing';
  ui.hint.style.opacity = needLock ? '1' : '.45';
  ui.hint.style.color = needLock ? '#ffd34d' : '';
  ui.hint.textContent = needLock ? 'CLICK TO CAPTURE MOUSE' : 'ESC TO PAUSE';
  if (TOUCH) ui.touch.classList.toggle('hidden', game.state !== 'playing');
}

// ============================================================ input
const keys = {};
let mouseDown = false;
let pointerLocked = false;

let lockRetryT = null;
function scheduleLockRetry() {
  // Chrome rejects re-lock for ~1.25s after an ESC exit; retry once it expires
  if (lockRetryT) return;
  lockRetryT = setTimeout(() => {
    lockRetryT = null;
    if (game.state === 'playing' && !pointerLocked && !TEST) requestLock();
  }, 1400);
}

function requestLock() {
  if (TEST || TOUCH) return;
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => scheduleLockRetry());
  } catch (e) { scheduleLockRetry(); }
}

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (!pointerLocked && game.state === 'playing' && !TEST) pauseGame();
});
document.addEventListener('pointerlockerror', () => scheduleLockRetry());

document.addEventListener('mousemove', (e) => {
  if (!pointerLocked || game.state !== 'playing') return;
  const s = sens * 0.00005;
  player.yaw -= e.movementX * s;
  player.pitch -= e.movementY * s;
  player.pitch = clamp(player.pitch, -1.52, 1.52);
});

document.addEventListener('mousedown', (e) => {
  if (game.state !== 'playing') return;
  if (!pointerLocked && !TEST) { requestLock(); return; }
  if (e.button === 0) mouseDown = true;
  if (e.button === 2) doDash();
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
document.addEventListener('contextmenu', (e) => e.preventDefault());

// accumulate wheel delta: macOS trackpads emit dozens of tiny inertial events per flick
let wheelAcc = 0, lastWheelT = 0;
window.addEventListener('wheel', (e) => {
  if (game.state !== 'playing' || e.ctrlKey || e.deltaY === 0) return;
  const now = performance.now();
  if (now - lastWheelT > 150) wheelAcc = 0;
  lastWheelT = now;
  wheelAcc += e.deltaY;
  if (Math.abs(wheelAcc) >= 60) {
    cycleWeapon(Math.sign(wheelAcc));
    wheelAcc = 0;
  }
}, { passive: true });

// dropped keyup events (Cmd-Tab mid-keypress) must not leave movement stuck
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  mouseDown = false;
});

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (game.state === 'playing') {
    if (e.code === 'Space' && !e.repeat) doJump();
    if (e.code === 'KeyQ' && !e.repeat) doDash();
    if (e.code >= 'Digit1' && e.code <= 'Digit4') switchWeapon(parseInt(e.code.slice(5), 10) - 1);
    if (e.code === 'KeyM' && !e.repeat) {
      audio.setMuted(!audio.muted);
      safeSet('ns_mute', audio.muted ? '1' : '0');
      ui.btnSound.textContent = 'SOUND: ' + (audio.muted ? 'OFF' : 'ON');
    }
    if (TEST && e.code === 'Escape' && !e.repeat) pauseGame();
  } else if (game.state === 'paused' && TEST && e.code === 'Escape' && !e.repeat) {
    resumeGame();
  }
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') pauseGame();
});

// ============================================================ touch controls
const touchState = { moveX: 0, moveZ: 0, sprint: false, fire: false, stickId: null, aimId: null, ox: 0, oy: 0, ax: 0, ay: 0 };

if (TOUCH) {
  const unlockAudio = () => { audio.init(); audio.resume(); };

  const updateStick = (t) => {
    const dx = clamp((t.clientX - touchState.ox) / 45, -1, 1);
    const dy = clamp((t.clientY - touchState.oy) / 45, -1, 1);
    touchState.moveX = dx;
    touchState.moveZ = -dy;
    touchState.sprint = Math.hypot(dx, dy) > 0.92;
    ui.stickNub.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
  };

  ui.stickZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    unlockAudio();
    const t = e.changedTouches[0];
    if (touchState.stickId !== null) return;
    touchState.stickId = t.identifier;
    const r = ui.stickZone.getBoundingClientRect();
    touchState.ox = r.left + r.width / 2;
    touchState.oy = r.top + r.height / 2;
    updateStick(t);
  }, { passive: false });

  // anywhere else on the canvas: drag to aim
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    unlockAudio();
    if (touchState.aimId !== null) return;
    const t = e.changedTouches[0];
    touchState.aimId = t.identifier;
    touchState.ax = t.clientX;
    touchState.ay = t.clientY;
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchState.stickId) {
        updateStick(t);
      } else if (t.identifier === touchState.aimId && game.state === 'playing') {
        const s = sens * 0.00014;
        player.yaw -= (t.clientX - touchState.ax) * s;
        player.pitch -= (t.clientY - touchState.ay) * s;
        player.pitch = clamp(player.pitch, -1.52, 1.52);
        touchState.ax = t.clientX;
        touchState.ay = t.clientY;
      }
    }
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchState.stickId) {
        touchState.stickId = null;
        touchState.moveX = 0; touchState.moveZ = 0; touchState.sprint = false;
        ui.stickNub.style.transform = 'translate(0px, 0px)';
      } else if (t.identifier === touchState.aimId) {
        touchState.aimId = null;
      }
    }
  };
  document.addEventListener('touchend', endTouch);
  document.addEventListener('touchcancel', endTouch);

  const btn = (el, down, up) => {
    el.addEventListener('touchstart', (e) => { e.preventDefault(); unlockAudio(); down(); }, { passive: false });
    if (up) el.addEventListener('touchend', (e) => { e.preventDefault(); up(); }, { passive: false });
  };
  btn(ui.btnFire, () => { touchState.fire = true; }, () => { touchState.fire = false; });
  btn(ui.btnJump, () => { if (game.state === 'playing') doJump(); });
  btn(ui.btnDashT, () => doDash());
  btn(ui.btnPause, () => pauseGame());

  // tap a weapon slot to switch
  Array.from(ui.slots.children).forEach((sp, i) => {
    sp.addEventListener('touchstart', (e) => { e.preventDefault(); if (game.state === 'playing') switchWeapon(i); }, { passive: false });
  });
}

function doJump() {
  if (player.onGround) {
    player.vel.y = 8.8;
    player.onGround = false;
    player.jumps = 1;
    audio.jump();
  } else if (player.jumps > 0) {
    player.jumps--;
    player.vel.y = 8.2;
    audio.jump();
    spawnBurst(new THREE.Vector3(player.pos.x, player.pos.y + 0.2, player.pos.z), LEVEL.accent, 8, 4, 0.4, 0.8);
  }
}

function doDash() {
  if (player.dashCd > 0 || game.state !== 'playing') return;
  player.dashCd = 1.5;
  player.dashT = 0.16;
  player.invuln = Math.max(player.invuln, 0.28);
  lastDashTime = game.time;
  const fX = -Math.sin(player.yaw), fZ = -Math.cos(player.yaw);
  const rX = Math.cos(player.yaw), rZ = -Math.sin(player.yaw);
  const ix = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touchState.moveX;
  const iz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + touchState.moveZ;
  player.dashDir.set(fX * iz + rX * ix, 0, fZ * iz + rZ * ix);
  if (player.dashDir.lengthSq() < 0.01) player.dashDir.set(fX, 0, fZ);
  player.dashDir.normalize();
  audio.dash();
  fovPunch += 5;
  vmImpulse(0.05, -0.04, 0.05);
}

// ============================================================ player update
function updatePlayer(dt) {
  player.cooldown -= dt;
  player.invuln -= dt;
  player.dashCd -= dt;

  const f = _v1.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const r = _v2.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const ix = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touchState.moveX;
  const iz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + touchState.moveZ;
  const sprinting = ((keys.ShiftLeft || keys.ShiftRight) || touchState.sprint) && iz > 0;
  const speed = sprinting ? 11 : 7.5;

  const wish = _v3.copy(f).multiplyScalar(iz).addScaledVector(r, ix);
  if (wish.lengthSq() > 1) wish.normalize();

  if (player.dashT > 0) {
    player.dashT -= dt;
    player.vel.x = player.dashDir.x * 26;
    player.vel.z = player.dashDir.z * 26;
    if (Math.random() < 0.8) spawnBurst(new THREE.Vector3(player.pos.x, player.pos.y + 0.8, player.pos.z), LEVEL.accent, 2, 2, 0.3, 0.7);
  } else {
    const k = 1 - Math.exp(-(player.onGround ? 11 : 3.5) * dt);
    player.vel.x = lerp(player.vel.x, wish.x * speed, k);
    player.vel.z = lerp(player.vel.z, wish.z * speed, k);
  }

  player.vel.y -= 24 * dt;
  player.landV = player.vel.y;
  player.pos.addScaledVector(player.vel, dt);

  if (player.pos.y <= 0) {
    player.pos.y = 0;
    if (!player.onGround && player.landV < -9) { audio.land(); vmImpulse(0.05, 0.06); }
    player.vel.y = 0;
    player.onGround = true;
    player.jumps = 2;
  } else {
    player.onGround = false;
  }

  resolveCircle(player.pos, player.radius);
  player.pos.x = clamp(player.pos.x, -ARENA.hx, ARENA.hx);
  player.pos.z = clamp(player.pos.z, -ARENA.hz, ARENA.hz);

  // head bob
  const moving = (ix !== 0 || iz !== 0) && player.onGround;
  if (moving) player.bobT += dt * (sprinting ? 11 : 8.5);
  const bobY = moving ? Math.sin(player.bobT * 2) * 0.045 : 0;

  // camera
  recoilPitch = Math.max(0, recoilPitch - dt * 0.6);
  recoilHeat = Math.max(0, recoilHeat - dt * 2.2);
  rollTilt = lerp(rollTilt, -ix * 0.014, 1 - Math.exp(-10 * dt));
  shake = Math.max(0, shake - dt * 2.2);
  const shx = (Math.random() - 0.5) * shake * 0.5;
  const shy = (Math.random() - 0.5) * shake * 0.5;
  camera.position.set(player.pos.x + shx * 0.3, player.pos.y + 1.62 + bobY + shy * 0.3, player.pos.z);
  camera.rotation.set(player.pitch + recoilPitch + shy * 0.08, player.yaw + shx * 0.08, rollTilt);

  // fov
  fovPunch = Math.max(0, fovPunch - dt * 18);
  const targetFov = 75 + (sprinting && moving ? 6 : 0) + fovPunch;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov = lerp(camera.fov, targetFov, 1 - Math.exp(-12 * dt));
    camera.updateProjectionMatrix();
  }

  // fire
  if (mouseDown || keys.KeyF || touchState.fire) tryFire();

  // light decay
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 600);
  boomLight.intensity = Math.max(0, boomLight.intensity - dt * 260);
}

// ============================================================ main loop
let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsT = 0;

function tick(now) {
  requestAnimationFrame(tick);
  const rawDt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (SHOW_FPS) {
    fpsAcc += rawDt; fpsN++; fpsT += rawDt;
    if (fpsT > 0.5) {
      game.fps = Math.round(fpsN / fpsAcc);
      ui.fpsEl.textContent = game.fps + ' FPS';
      fpsAcc = 0; fpsN = 0; fpsT = 0;
    }
  }

  if (game.state === 'playing') {
    // slow-mo recovery (real time)
    if (game.slowTimer > 0) {
      game.slowTimer -= rawDt;
    } else if (game.timeScale < 1) {
      game.timeScale = Math.min(1, game.timeScale + rawDt * 4);
    }
    const dt = rawDt * game.timeScale;
    game.time += dt;

    if (game.streakTimer > 0) {
      game.streakTimer -= dt;
      if (game.streakTimer <= 0) game.streak = 0;
    }
    if (game.overdrive > 0) game.overdrive = Math.max(0, game.overdrive - dt);
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) ui.banner.classList.remove('show');
    }

    // scheduler
    for (const d of delayed) d.t -= dt;
    const due = delayed.filter((d) => d.t <= 0);
    delayed = delayed.filter((d) => d.t > 0);
    for (const d of due) d.fn();

    updatePlayer(dt);
    updateViewmodel(dt);
    updateSpawns(dt);
    for (const e of enemies) e.update(dt);
    enemies = enemies.filter((e) => !e.dead);
    checkLastStand();
    checkWave();
    updateEnemyProjs(dt);
    updateRockets(dt);
    updateParticles(dt);
    updateTracers(dt);
    updatePickups(dt);
    updatePortal(dt);
    updateHUD();
  } else if (game.state === 'menu') {
    // idle camera drift behind the menu
    const t = now * 0.0001;
    camera.position.set(Math.sin(t) * 18, 9, Math.cos(t) * 18);
    camera.lookAt(0, 1, 0);
    updateParticles(rawDt);
  }

  renderer.render(scene, camera);
}

// ============================================================ menu wiring
ui.btnStart.addEventListener('click', () => { audio.init(); audio.resume(); audio.ui(); startGame(TEST ? parseInt(params.get('lvl') || '0', 10) : 0); });
ui.btnResume.addEventListener('click', () => { audio.ui(); resumeGame(); });
ui.btnRestart.addEventListener('click', () => { audio.ui(); retryLevel(); });
ui.btnQuit.addEventListener('click', () => { audio.ui(); quitToMenu(); });
ui.btnRetry.addEventListener('click', () => { audio.ui(); retryLevel(); });
ui.btnAbandon.addEventListener('click', () => { audio.ui(); quitToMenu(); });
ui.btnAgain.addEventListener('click', () => { audio.ui(); startGame(0); });
ui.btnSound.addEventListener('click', () => {
  audio.init();
  audio.setMuted(!audio.muted);
  safeSet('ns_mute', audio.muted ? '1' : '0');
  ui.btnSound.textContent = 'SOUND: ' + (audio.muted ? 'OFF' : 'ON');
});
ui.sens.addEventListener('input', () => {
  sens = parseInt(ui.sens.value, 10);
  ui.sensVal.textContent = sens;
  safeSet('ns_sens', String(sens));
});
ui.btnSound.textContent = 'SOUND: ' + (audio.muted ? 'OFF' : 'ON');
ui.menuHi.textContent = game.hi > 0 ? 'HIGH SCORE  ' + game.hi.toLocaleString() : '';

// menu backdrop: build level 1 so the drifting camera has scenery
buildLevel(0);
audio.stopMusic();
game.state = 'menu';

// ============================================================ test hooks
if (TEST) {
  window.__game = {
    game, player,
    enemies: () => enemies,
    walls: () => walls,
    pickups: () => pickups,
    eProjs: () => eProjs,
    startGame, startWave, tryFire, hurtPlayer, switchWeapon, spawnEnemyAt,
    errors: [],
    LEVEL: () => LEVEL,
    camera,
    debugShot: () => {
      const dir = camera.getWorldDirection(new THREE.Vector3());
      raycaster.set(camera.position, dir);
      raycaster.far = 120;
      const hits = raycaster.intersectObjects([staticGroup, enemiesGroup, barrelsGroup], true);
      return hits.slice(0, 4).map((h) => ({
        d: +h.distance.toFixed(2),
        type: h.object.type,
        part: h.object.userData.part || (h.object.userData.barrel ? 'barrel' : 'wall'),
        enemy: h.object.userData.enemyRef ? h.object.userData.enemyRef.type : null,
        point: { x: +h.point.x.toFixed(1), y: +h.point.y.toFixed(1), z: +h.point.z.toFixed(1) },
      }));
    },
  };
  window.addEventListener('error', (e) => window.__game.errors.push(String(e.message)));
  startGame(parseInt(params.get('lvl') || '0', 10));
}

requestAnimationFrame(tick);
