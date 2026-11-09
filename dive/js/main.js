// スクロール位置 → 旅の進行 u（0〜1）→ カメラとパネル。すべて u の関数なので、戻れば戻る。
import * as THREE from "three";
import { outlineUniforms, chickGeometry, toonMaterial, outlineMaterial, solid, ease } from "dive/kit";
import { buildEngawa } from "dive/engawa";
import { buildCyber, WORLD } from "dive/cyber";

const root = document.documentElement;
const capable = root.getAttribute("data-capable") === "1";

const canvas = document.getElementById("stage");
const veil = document.getElementById("veil");
const progressBar = document.querySelector("#progress span");
const spacer = document.getElementById("spacer");

let renderer = null;
let booted = false;
let running = false;

/* ---------- 単調な 3 次補間（行き過ぎない） ---------- */
function monotoneSlopes(xs, ys) {
  const n = xs.length;
  const d = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * (xs[i + 1] - xs[i]) + (xs[i] - xs[i - 1]);
      const w2 = (xs[i + 1] - xs[i]) + 2 * (xs[i] - xs[i - 1]);
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return m;
}

class Track {
  constructor(keys, fields) {
    this.keys = keys;
    this.fields = fields;
    this.xs = keys.map((k) => k.u);
    this.ys = fields.map((f) => keys.map((k) => k[f]));
    this.ms = this.ys.map((y) => monotoneSlopes(this.xs, y));
  }
  sample(u, out) {
    const xs = this.xs;
    let i = 0;
    if (u <= xs[0]) i = 0;
    else if (u >= xs[xs.length - 1]) i = xs.length - 2;
    else {
      let lo = 0, hi = xs.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] <= u) lo = mid;
        else hi = mid;
      }
      i = lo;
    }
    const h = xs[i + 1] - xs[i];
    const t = Math.min(1, Math.max(0, (u - xs[i]) / h));
    const t2 = t * t, t3 = t2 * t;
    const a = 2 * t3 - 3 * t2 + 1, b = t3 - 2 * t2 + t, c = -2 * t3 + 3 * t2, d = t3 - t2;
    this.fields.forEach((f, j) => {
      out[f] = a * this.ys[j][i] + b * h * this.ms[j][i] + c * this.ys[j][i + 1] + d * h * this.ms[j][i + 1];
    });
    return out;
  }
}

/* ---------- 拍（ビート）の割り付け ---------- */
function collectBeats() {
  const els = [...document.querySelectorAll("[data-beat]")];
  let total = 0;
  const beats = els.map((el) => {
    const len = parseFloat(el.dataset.len);
    const b = { el, type: el.dataset.beat, len, v0: total, v1: total + len, island: el.dataset.island };
    if (b.type === "zone") b.zone = el.closest("[data-zone]").dataset.zone;
    total += len;
    return b;
  });
  for (const b of beats) {
    b.u0 = b.v0 / total;
    b.u1 = b.v1 / total;
  }
  return { beats, total };
}

function boot() {
  if (booted) return;
  booted = true;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.autoClear = false;
  renderer.setClearColor(WORLD, 1);
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    fallback();
  });

  const { beats, total } = collectBeats();
  root.style.setProperty("--total", String(total));
  const by = (t) => beats.find((b) => b.type === t);

  const engawa = buildEngawa({ lowPoly: innerWidth < 820 });
  const cyber = buildCyber(beats);
  cyber.root.position.copy(engawa.portal.position);
  cyber.root.quaternion.copy(engawa.portal.quaternion);
  cyber.root.updateMatrixWorld(true);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.04, 3000);

  /* ----- チビたち ----- */
  const chickScene = new THREE.Scene();
  const chickSun = new THREE.DirectionalLight(0xffffff, 1.6);
  chickSun.position.set(-3, 6, 8);
  chickScene.add(new THREE.AmbientLight(0xffffff, 1.9), chickSun);
  const chickCam = new THREE.OrthographicCamera(0, 1, 1, 0, -50, 50);
  const chickGeo = chickGeometry();
  const chickMat = toonMaterial();
  const chickInk = outlineMaterial({ width: 1.7 });
  const chicks = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    g.add(solid(chickGeo, chickMat, chickInk));
    chickScene.add(g);
    chicks.push({ g, x: 0, y: 0, face: 1, phase: i * 1.1, vel: 0 });
  }
  const hasHover = matchMedia("(hover:hover) and (pointer:fine)").matches;
  const pointer = { x: 0, y: 0, active: false };
  addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
    }
  }, { passive: true });

  /* ----- 画面サイズ ----- */
  let W = 0, H = 0, dprCap = 1.75, dpr = 1, portrait = false;
  let track = null;

  function applySize(force) {
    const w = innerWidth;
    const h = canvas.clientHeight || innerHeight;
    // スマホのアドレスバーの出入り（高さだけの小さな変化）では作り直さない
    if (!force && w === W && Math.abs(h - H) < 120) return;
    W = w;
    H = h;
    portrait = W / H <= 1;
    dprCap = Math.min(dprCap, W < 820 ? 1.5 : 1.75);
    dpr = Math.min(devicePixelRatio || 1, dprCap);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    outlineUniforms.uRes.value.set(W * dpr, H * dpr);
    outlineUniforms.uDpr.value = dpr;
    chickCam.left = 0;
    chickCam.right = W;
    chickCam.top = 0;
    chickCam.bottom = -H;
    chickCam.updateProjectionMatrix();
    engawa.sun.position.x = portrait ? -170 : 370;
    track = buildTrack();
  }

  /* ----- カメラの通り道 ----- */
  const FIELDS = ["px", "py", "pz", "lx", "ly", "lz", "fov", "sx", "sy", "roll"];
  const local = new THREE.Vector3();
  const L = (x, y, z) => cyber.root.localToWorld(local.set(x, y, z)).clone();

  function buildTrack() {
    const keys = [];
    const U = (v) => v / total;
    const add = (v, p, l, fov, sx = 0, sy = 0, roll = 0) => {
      keys.push({ u: U(v), px: p.x, py: p.y, pz: p.z, lx: l.x, ly: l.y, lz: l.z, fov, sx, sy, roll });
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const hero = by("hero");
    const dive = by("dive");
    const contact = by("contact");
    const end = by("end");
    const screen = engawa.portal.position;
    const S = screen.clone();
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(engawa.portal.quaternion);
    const along = (d) => S.clone().addScaledVector(n, d);
    const heroSX = portrait ? 0 : -0.14;
    const heroSY = portrait ? -0.07 : -0.02;
    const heroD = portrait ? 5.5 : 4.3;
    const heroFov = portrait ? 46 : 42;

    add(hero.v0, V(0.25, 1.15, heroD + 0.1), V(0, 1.05, -1.5), heroFov, heroSX, heroSY);
    add(hero.v1, V(0.2, 1.12, heroD - 0.1), V(0, 1.02, -1.5), heroFov, heroSX * 0.9, heroSY * 0.9);

    const D = dive.v0, dl = dive.len;
    add(D + dl * 0.26, along(2.6), S, heroFov - 2, 0, 0);
    add(D + dl * 0.46, along(1.1), S, heroFov + 2, 0, 0, 0.02);
    add(D + dl * 0.56, along(0.34), S, heroFov + 16, 0, 0, 0.1);
    add(D + dl * 0.66, L(0, 0, -1.8), L(0, 0, -30), 72, 0, 0, 0.26);
    add(D + dl * 0.82, L(0, 0, -20), L(0, 0, -60), 66, 0, 0, 0.3);
    add(D + dl, L(0, 0, -52), L(0, 0, -100), 50, 0, 0, 0);

    const aspect = camera.aspect;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(40 / 2));
    const island = 7.4;
    const dist = portrait
      ? Math.max(island / (0.82 * 2 * tanHalf * aspect), island / (0.42 * 2 * tanHalf))
      : Math.max(island / (0.42 * 2 * tanHalf * aspect), island / (0.62 * 2 * tanHalf));

    for (const b of beats) {
      if (b.type === "zone") {
        add(b.v0 + 0.05, L(0, 0, b.z0 + 8), L(0, 0, b.z0 - 40), 50);
        add(b.v1 - 0.05, L(0, 0, b.z1 + 2), L(0, 0, b.z1 - 40), 50);
      } else if (b.type === "work") {
        const P = b.pos;
        const midIn = b.v0 + b.len * 0.02;
        const dwellIn = b.v0 + b.len * 0.28;
        const dwellOut = b.v0 + b.len * 0.72;
        const midOut = b.v1 - b.len * 0.02;
        const sx = portrait ? 0 : -b.side * 0.2;
        const sy = portrait ? 0.2 : 0;
        const orbit = (a, d) => {
          const c = Math.cos(a), s = Math.sin(a);
          return L(P.x + s * d, P.y + 1.8 + d * 0.11, P.z + c * d);
        };
        add(midIn, L(0, 0, b.zStart + 2), L(b.side * 1.2, 0, b.zStart - 40), 48);
        add(dwellIn, orbit(-0.2 * b.side, dist * 1.14), L(P.x, P.y + 0.35, P.z), 40, sx, sy);
        add(dwellOut, orbit(0.18 * b.side, dist * 0.94), L(P.x, P.y + 0.35, P.z), 40, sx, sy);
        add(midOut, L(0, 0, b.zEnd - 2), L(-b.side * 1.2, 0, b.zEnd - 40), 48);
      } else if (b.type === "contact") {
        add(b.v0 + 0.04, L(0, 0, b.zStart + 2), L(0, 0, b.zStart - 40), 50);
        add(b.v0 + b.len * 0.4, L(0, 0, b.z + 16), L(0, 0, b.z - 40), 46);
        add(b.v1 - 0.02, L(0, 0, b.z), L(0, 0, b.z - 40), 46);
      }
    }

    // 帰還：夕方は最初より引いて、斜めから
    const eg0 = portrait ? V(1.8, 2.0, 8.2) : V(-1.5, 1.35, 6.4);
    const eg1 = portrait ? V(1.6, 1.9, 7.6) : V(-1.2, 1.25, 5.8);
    const gaze = portrait ? V(-1.6, 2.2, -6) : V(0.4, 1.3, -6);
    const seam = end.v0 + end.len * 0.36;
    add(seam - 0.02, L(0, 0, contact.z + 2), L(0, 0, contact.z - 40), 46);
    add(seam + 0.02, eg0, gaze, 44);
    add(end.v1 - end.len * 0.1, eg1, gaze, 44);
    add(end.v1, eg1, gaze, 44);

    keys.sort((a, b) => a.u - b.u);
    for (let i = 1; i < keys.length; i++) {
      if (keys[i].u <= keys[i - 1].u) keys[i].u = keys[i - 1].u + 1e-5;
    }
    return new Track(keys, FIELDS);
  }

  /* ----- パネルの出し入れ ----- */
  for (const b of beats) {
    if (b.type === "work") {
      b.el.dataset.side = b.side > 0 ? "l" : "r";
    }
  }

  function beatAlpha(b, p) {
    if (b.type === "hero") return 1 - ease.smooth(0.3, 1.05, p);
    if (b.type === "end") return ease.smooth(0.62, 0.8, p);
    const fade = b.type === "zone" ? 0.28 : b.type === "contact" ? 0.14 : 0.15;
    return ease.smooth(0.02, fade, p) * (1 - ease.smooth(1 - fade, 0.98, p));
  }

  const liveState = new Map();
  function updateBeats(u) {
    const v = u * total;
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      if (b.type === "dive") continue;
      const p = (v - b.v0) / b.len;
      const inRange = p > -0.1 && p < 1.1;
      const prev = liveState.get(b);
      if (!inRange && !prev) continue;
      const el = b.el;
      if (b.type === "work") {
        el.classList.toggle("near", p > -1.6 && p < 2.2);
      }
      if (!inRange) {
        el.style.setProperty("--o", "0");
        el.classList.remove("live");
        liveState.set(b, false);
        continue;
      }
      liveState.set(b, true);
      const o = beatAlpha(b, ease.clamp01(p));
      el.style.setProperty("--o", o.toFixed(3));
      el.classList.toggle("live", o > 0.6);
      const c = ease.clamp01(p);
      if (b.type === "work") {
        const inn = 1 - ease.smooth(0, 0.28, c);
        const out = ease.smooth(0.72, 1, c);
        const s = 1 - inn * 0.14 + out * 0.2;
        el.style.setProperty("--s", s.toFixed(4));
        el.style.setProperty("--y", ((inn * 26 - out * 26)).toFixed(1) + "px");
        const drift = (c - 0.5) * (b.side > 0 ? 22 : -22);
        el.style.setProperty("--mx", drift.toFixed(1) + "px");
      } else if (b.type === "zone") {
        el.style.setProperty("--s", (0.7 + c * 0.7).toFixed(3));
      } else if (b.type === "contact") {
        const inn = 1 - ease.smooth(0, 0.3, c);
        el.style.setProperty("--s", (1 - inn * 0.14).toFixed(4));
      } else if (b.type === "hero") {
        el.style.setProperty("--hy", (-c * 26).toFixed(1) + "px");
      } else if (b.type === "end") {
        el.style.setProperty("--y", ((1 - ease.smooth(0.62, 0.86, c)) * 22).toFixed(1) + "px");
      }
    }
  }

  // キーボードで隠れたパネルのリンクに来たら、その作品まで連れて行く
  document.addEventListener("focusin", (e) => {
    if (!root.classList.contains("dive")) return;
    const el = e.target.closest?.("[data-beat]");
    if (!el) return;
    const b = beats.find((x) => x.el === el);
    if (!b || b.type === "hero") return;
    const v = b.type === "end" ? total : b.v0 + b.len * 0.5;
    const y = (v / total) * maxScroll();
    if (Math.abs(scrollY - y) > innerHeight * 0.2) scrollTo({ top: y, behavior: "instant" });
  });

  /* ----- 進行 ----- */
  function maxScroll() {
    return Math.max(1, document.documentElement.scrollHeight - innerHeight);
  }
  let u = 0;
  let mood = "summer";
  const state = {};
  const corners = engawa.corners.map((c) => c.clone());
  const ndc = new THREE.Vector3();
  const portalLocal = new THREE.Vector3();

  function screenFillsView() {
    camera.updateMatrixWorld(true);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of corners) {
      ndc.copy(c).project(camera);
      minX = Math.min(minX, ndc.x);
      maxX = Math.max(maxX, ndc.x);
      minY = Math.min(minY, ndc.y);
      maxY = Math.max(maxY, ndc.y);
    }
    return minX < -1.02 && maxX > 1.02 && minY < -1.02 && maxY > 1.02;
  }

  let lastT = performance.now();
  let slowFrames = 0, frameCount = 0;

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dtMs = now - lastT;
    lastT = now;
    const dt = Math.min(dtMs / 1000, 0.25);
    const time = now / 1000;

    const target = ease.clamp01(scrollY / maxScroll());
    u += (target - u) * (1 - Math.exp(-dtMs / 90));
    if (Math.abs(target - u) < 1e-5) u = target;

    applySize(false);

    track.sample(u, state);
    camera.position.set(state.px, state.py, state.pz);
    camera.up.set(0, 1, 0);
    camera.lookAt(state.lx, state.ly, state.lz);
    if (Math.abs(state.roll) > 1e-3) camera.rotateZ(state.roll);
    camera.fov = state.fov;
    camera.setViewOffset(W, H, state.sx * W, state.sy * H, W, H);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const v = u * total;
    const end = by("end");
    const seamV = end.v0 + end.len * 0.36;
    const wantMood = v > seamV ? "sunset" : "summer";
    if (wantMood !== mood) {
      mood = wantMood;
      engawa.setMood(mood);
    }

    // 画面の裏に抜けたか、画面が視野を埋めたら縁側は描かない
    portalLocal.copy(camera.position);
    cyber.root.worldToLocal(portalLocal);
    const beyond = portalLocal.z < 0.03;
    const dive = by("dive");
    const diveDone = v > dive.v1;
    const inSunset = mood === "sunset";

    const showEngawa = inSunset || (!diveDone && !beyond && !screenFillsView());
    const showCyber = !inSunset;

    renderer.clear();
    if (showCyber) {
      cyber.tick(time, camera, u);
      renderer.render(cyber.scene, camera);
    }
    if (showEngawa) {
      engawa.tick(time);
      renderer.clearDepth();
      renderer.render(engawa.scene, camera);
    }

    // 白へ溶けて、夕方へ
    const pe = (v - end.v0) / end.len;
    let veilO = 0;
    if (pe > -0.1 && pe <= 1) {
      veilO = pe < 0.36 ? ease.smooth(0.02, 0.34, pe) : 1 - ease.smooth(0.38, 0.72, pe);
    }
    veil.style.opacity = veilO.toFixed(3);
    progressBar.style.transform = `scaleX(${u.toFixed(4)})`;

    updateBeats(u);
    updateChicks(dt, time, v);

    renderer.clearDepth();
    renderer.render(chickScene, chickCam);

    // 重い端末では解像度を下げる
    if (++frameCount > 30) {
      if (dtMs > 34) slowFrames++;
      else slowFrames = Math.max(0, slowFrames - 0.25);
      if (slowFrames > 40 && dprCap > 1) {
        dprCap = Math.max(1, dprCap - 0.25);
        slowFrames = 0;
        applySize(true);
      }
    }
  }

  function updateChicks(dt, time, v) {
    let tx, ty;
    const scale = Math.max(24, Math.min(40, W * 0.038));
    if (hasHover && pointer.active) {
      tx = pointer.x;
      ty = pointer.y - scale * 0.55;
    } else if (hasHover) {
      tx = W * 0.14;
      ty = H * 0.84;
    } else {
      // スマホ：進み具合で画面上側を行ったり来たり（パネルにかぶらない高さ）
      const w = v * 0.55;
      const tri = Math.abs(((w % 2) + 2) % 2 - 1);
      const margin = W * 0.12;
      tx = margin + tri * (W - margin * 2);
      ty = v < 0.7 ? 165 : H * 0.075 + 22;
    }
    const k = 1 - Math.exp(-dt * 7);
    const lead = chicks[0];
    lead.x += (tx - lead.x) * k;
    lead.y += (ty - lead.y) * k;
    const gap = scale * 1.15;
    for (let i = 1; i < chicks.length; i++) {
      const a = chicks[i - 1], c = chicks[i];
      const dx = a.x - c.x, dy = a.y - c.y;
      const dist = Math.hypot(dx, dy);
      if (dist > gap) {
        const m = (dist - gap) / dist;
        c.x += dx * m * Math.min(1, dt * 14);
        c.y += dy * m * Math.min(1, dt * 14);
      }
    }
    for (let i = 0; i < chicks.length; i++) {
      const c = chicks[i];
      const prevX = c.prevX ?? c.x;
      const prevY = c.prevY ?? c.y;
      const mv = (c.x - prevX) / Math.max(dt, 0.001);
      const sp = Math.hypot(c.x - prevX, c.y - prevY) / Math.max(dt, 0.001);
      c.prevX = c.x;
      c.prevY = c.y;
      if (mv > 8) c.face = 1;
      else if (mv < -8) c.face = -1;
      c.vel += (Math.min(1, sp / 120) - c.vel) * Math.min(1, dt * 8);
      const hop = Math.abs(Math.sin(time * 11 + c.phase)) * scale * 0.34 * c.vel;
      const bob = Math.sin(time * 2.2 + c.phase) * scale * 0.03;
      c.g.position.set(c.x, -c.y + hop + bob, 0);
      const s = i === 0 ? scale : scale * (0.92 - i * 0.05);
      c.g.scale.setScalar(s);
      const targetRy = c.face > 0 ? -0.5 : Math.PI + 0.5;
      c.ry = c.ry == null ? targetRy : c.ry + (targetRy - c.ry) * Math.min(1, dt * 12);
      c.g.rotation.set(0.28, c.ry, Math.sin(time * 11 + c.phase) * 0.12 * c.vel);
    }
  }

  function start() {
    if (running) return;
    running = true;
    lastT = performance.now();
    u = ease.clamp01(scrollY / maxScroll());
    applySize(true);
    for (let i = 0; i < chicks.length; i++) {
      const c = chicks[i];
      c.x = hasHover ? W * 0.14 - i * 40 : W * 0.12;
      c.y = hasHover ? H * 0.84 : 165;
    }
    requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
  }

  addEventListener("resize", () => {
    if (running) applySize(false);
  });

  document.getElementById("to-top").addEventListener("click", (e) => {
    e.preventDefault();
    scrollTo({ top: 0, behavior: "instant" });
  });

  window.__dive = { start, stop, get u() { return u; }, info: { beats, total } };
  return { start, stop };
}

let api = null;

function fallback() {
  if (api) api.stop();
  if (window.__diveFail) window.__diveFail();
  if (location.hash === "#list") return;
  scrollTo(0, 0);
}

function applyHash() {
  const wantList = location.hash === "#list";
  if (wantList || !capable) {
    root.classList.remove("dive");
    if (api) api.stop();
    if (wantList) scrollTo(0, 0);
    return;
  }
  root.classList.add("dive");
  try {
    if (!api) api = boot();
    api.start();
  } catch (err) {
    console.error(err);
    fallback();
  }
}

addEventListener("hashchange", applyHash);
applyHash();
