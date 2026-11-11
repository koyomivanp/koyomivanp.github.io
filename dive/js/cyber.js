// 電脳空間：白い空間に、太い線と色面の同心円リングが奥へ連なる。
import * as THREE from "three";
import { toonMaterial, outlineMaterial, rng } from "dive/kit";
import { buildIsland } from "dive/islands";

export const WORLD = 0xf8f7f1;
const INK = 0x15130f;

export const ZONES = {
  game: { main: 0xff7a18, sub: 0xffc933 },
  tools: { main: 0x1b8fe0, sub: 0x18c2a3 },
  art: { main: 0xe6317c, sub: 0x7a4be0 },
  contact: { main: 0xff7a18, sub: 0x15130f },
};

const _c = new THREE.Color();

// 平面の扇形（内半径 r0、外半径 r1、a0〜a1）を配列へ足す
function arc(buf, r0, r1, a0, a1, color, z = 0) {
  const steps = Math.max(2, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 72));
  _c.set(color);
  const { r, g, b } = _c;
  for (let i = 0; i < steps; i++) {
    const t0 = a0 + ((a1 - a0) * i) / steps;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / steps;
    const p = [Math.cos(t0), Math.sin(t0), Math.cos(t1), Math.sin(t1)];
    buf.push(
      p[0] * r0, p[1] * r0, z, p[2] * r0, p[3] * r0, z, p[2] * r1, p[3] * r1, z,
      p[0] * r0, p[1] * r0, z, p[2] * r1, p[3] * r1, z, p[0] * r1, p[1] * r1, z
    );
    for (let v = 0; v < 6; v++) buf.color.push(r, g, b);
  }
}

function ringStation(radius, zone, seed, thickness = 1) {
  const r = rng(seed);
  const buf = [];
  buf.color = [];
  const w = radius * 0.022 * thickness + 0.02;
  // 太い墨の輪
  arc(buf, radius, radius + w * 1.5, 0, Math.PI * 2, INK);
  // 色の帯（切れ目を入れる）
  const segs = 3 + Math.floor(r() * 3);
  const start = r() * 6.28;
  const r0 = radius + w * 2.2, r1 = radius + w * 4.8;
  for (let i = 0; i < segs; i++) {
    const span = (Math.PI * 2) / segs;
    const a0 = start + i * span + 0.05;
    const a1 = a0 + span * (0.5 + r() * 0.4);
    arc(buf, r0, r1, a0, a1, i % 3 === 2 ? zone.sub : zone.main);
  }
  // 外側の細い線と目盛り
  arc(buf, radius + w * 5.6, radius + w * 6.15, 0, Math.PI * 2, INK);
  const ticks = 12 + Math.floor(r() * 3) * 6;
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2;
    arc(buf, radius + w * 6.9, radius + w * 8.2, a, a + 0.018 + 0.1 / (radius + 1), INK);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(buf), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(buf.color), 3));
  return g;
}

// 最深部の的（塗りつぶしの同心円）
function bullseye() {
  const buf = [];
  buf.color = [];
  const bands = [
    [0, 6, WORLD], [6, 7.2, INK], [7.2, 12, 0xff7a18], [12, 13.2, INK], [13.2, 20, 0xffc933],
    [20, 21.5, INK], [21.5, 32, 0xffffff], [32, 33.5, INK], [33.5, 52, 0xff7a18], [52, 54, INK], [54, 90, 0xffc933],
  ];
  for (const [a, b, c] of bands) arc(buf, a, b, 0, Math.PI * 2, c);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(buf), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(buf.color), 3));
  return g;
}

// beats：作品の並びから、島と camera の通り道（z）を決める
export function buildCyber(beats) {
  const scene = new THREE.Scene();
  const fog = new THREE.Fog(WORLD, 60, 240);
  scene.fog = fog;

  const root = new THREE.Group();
  scene.add(root);

  const toon = toonMaterial();
  const ink = outlineMaterial({ width: 2.4, fog });
  const inkThin = outlineMaterial({ width: 1.5, fog });
  scene.add(new THREE.AmbientLight(0xffffff, 1.7));
  const d = new THREE.DirectionalLight(0xffffff, 1.8);
  d.position.set(-40, 80, 60);
  scene.add(d);

  const flat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true });

  // レイアウト：z を奥へ割り付ける
  let z = -58;
  const layout = { islands: [], zoneGates: [], contactZ: 0 };
  let zoneKey = "game";
  const rings = [];

  const addRing = (rad, key, atZ, seed, thick) => {
    const m = new THREE.Mesh(ringStation(rad, ZONES[key], seed, thick), flat);
    m.position.z = atZ;
    m.userData.spin = (seed % 2 ? 1 : -1) * (0.02 + (seed % 5) * 0.01);
    root.add(m);
    rings.push(m);
  };

  // 入口の漏斗：画面のすぐ奥から小さな輪が開いていく（窓越しに見える）
  const funnel = 15;
  for (let i = 0; i < funnel; i++) {
    const v = i / (funnel - 1);
    const zf = -1.5 - Math.pow(v, 1.5) * 57;
    const rad = 0.95 + Math.pow(v, 1.7) * 16;
    addRing(rad, "game", zf, 100 + i, 1.2 - v * 0.2);
  }

  const G = 58; // 島の間隔
  let seed = 1;
  for (const b of beats) {
    if (b.type === "zone") {
      zoneKey = b.zone;
      z -= 18;
      b.z0 = z + 14;
      layout.zoneGates.push({ z, zone: b.zone });
      addRing(14, zoneKey, z - 10, seed++, 3);
      addRing(22, zoneKey, z - 14, seed++, 2);
      b.z = z - 10;
      b.z1 = z - 26;
      z -= 28;
    } else if (b.type === "work") {
      z -= G / 2;
      b.zStart = z + G / 2;
      b.z = z;
      addRing(17, zoneKey, b.zStart - 1, seed++, 1);
      addRing(16, zoneKey, b.z + 12, seed++, 1);
      addRing(18, zoneKey, b.z - 14, seed++, 1);
      z -= G / 2;
      b.zEnd = z;
    } else if (b.type === "contact") {
      zoneKey = "contact";
      addRing(13, "contact", z - 12, seed++, 3);
      addRing(20, "contact", z - 22, seed++, 2);
      addRing(27, "contact", z - 32, seed++, 2);
      b.zStart = z;
      b.z = z - 62;
      z -= 64;
    }
  }
  layout.endZ = z;

  // 長い奥行きの線（疾走感）
  const r = rng(77);
  {
    const buf = [];
    buf.color = [];
    for (let i = 0; i < 150; i++) {
      const a = r() * 6.283;
      const R = 3.5 + Math.pow(r(), 0.5) * 16;
      const zz = -2 - r() * 150;
      const len = 3 + r() * 10;
      const hw = 0.02 + r() * 0.05;
      const cx = Math.cos(a) * R, cy = Math.sin(a) * R, nx = -Math.sin(a) * hw, ny = Math.cos(a) * hw;
      buf.push(cx - nx, cy - ny, zz, cx + nx, cy + ny, zz, cx + nx, cy + ny, zz - len, cx - nx, cy - ny, zz, cx + nx, cy + ny, zz - len, cx - nx, cy - ny, zz - len);
      _c.set(i % 4 === 0 ? 0xff7a18 : INK);
      for (let v = 0; v < 6; v++) buf.color.push(_c.r, _c.g, _c.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(buf), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(buf.color), 3));
    root.add(new THREE.Mesh(g, flat));
  }

  // 的
  const contactBeat = beats.find((b) => b.type === "contact");
  const target = new THREE.Mesh(bullseye(), flat);
  target.position.z = contactBeat.z - 32;
  root.add(target);

  // 島
  const ctx = { toon, ink, inkThin };
  const islands = [];
  let idx = 0;
  for (const b of beats) {
    if (b.type !== "work") continue;
    const inst = buildIsland(b.island, ctx);
    const pivot = new THREE.Group();
    b.side = idx % 2 === 0 ? 1 : -1;
    b.pos = new THREE.Vector3(b.side * 5.2, idx % 3 === 0 ? 1.0 : idx % 3 === 1 ? -0.6 : 0.3, b.z);
    pivot.position.copy(b.pos);
    pivot.add(inst.group);
    root.add(pivot);
    islands.push({ beat: b, pivot, inst, y0: b.pos.y, phase: idx * 1.7 });
    idx++;
  }

  const worldPos = new THREE.Vector3();
  return {
    scene,
    root,
    rings,
    target,
    layout,
    tick(time, camera, u) {
      camera.getWorldPosition(worldPos);
      root.worldToLocal(worldPos);
      const cz = worldPos.z;
      for (const m of rings) {
        const dz = cz - m.position.z;
        m.visible = dz > -6 && dz < 250;
        if (m.visible) m.rotation.z = m.userData.spin * time;
      }
      target.visible = cz - target.position.z < 300;
      for (const it of islands) {
        const dz = Math.abs(cz - it.beat.z);
        const vis = dz < 150;
        it.pivot.visible = vis;
        if (!vis) continue;
        const b = it.beat;
        const p = (u - b.u0) / (b.u1 - b.u0);
        it.pivot.rotation.y = b.side * 0.35 - (Math.max(0, Math.min(1, p)) - 0.5) * 1.2;
        it.pivot.position.y = it.y0 + Math.sin(time * 0.9 + it.phase) * 0.12;
        it.inst.tick(time);
      }
    },
  };
}
