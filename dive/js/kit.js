// 形を足していって 1 枚のメッシュにまとめる道具と、共通の材質。
import * as THREE from "three";

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

// 色と形をためて build() で 1 ドローコールにする
export class Kit {
  constructor() {
    this.parts = [];
  }

  // o: { x,y,z, rx,ry,rz, sx,sy,sz, flat }
  add(geo, color, o = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (o.flat) g.computeVertexNormals();
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0);
    _q.setFromEuler(_e);
    _p.set(o.x || 0, o.y || 0, o.z || 0);
    _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    g.applyMatrix4(_m.compose(_p, _q, _s));
    _c.set(color);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      c[i * 3] = _c.r;
      c[i * 3 + 1] = _c.g;
      c[i * 3 + 2] = _c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    this.parts.push(g);
    return this;
  }

  box(w, h, d, color, o) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, o);
  }
  cyl(rt, rb, h, seg, color, o = {}) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, { flat: true, ...o });
  }
  ball(r, color, o = {}, detail = 2) {
    return this.add(new THREE.IcosahedronGeometry(r, detail), color, o);
  }
  cone(r, h, seg, color, o = {}) {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, { flat: true, ...o });
  }

  geometry() {
    let count = 0;
    for (const g of this.parts) count += g.attributes.position.count;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    let off = 0;
    for (const g of this.parts) {
      pos.set(g.attributes.position.array, off * 3);
      nor.set(g.attributes.normal.array, off * 3);
      col.set(g.attributes.color.array, off * 3);
      off += g.attributes.position.count;
      g.dispose();
    }
    this.parts = [];
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    addOutlineNormals(out);
    out.computeBoundingSphere();
    return out;
  }
}

// 同じ位置の頂点の法線を平均する。太線用の押し出し方向（角で線が割れないように）。
function addOutlineNormals(geo) {
  const p = geo.attributes.position.array;
  const n = geo.attributes.normal.array;
  const map = new Map();
  const count = p.length / 3;
  const keys = new Array(count);
  for (let i = 0; i < count; i++) {
    const k = Math.round(p[i * 3] * 500) + "," + Math.round(p[i * 3 + 1] * 500) + "," + Math.round(p[i * 3 + 2] * 500);
    keys[i] = k;
    let s = map.get(k);
    if (!s) map.set(k, (s = [0, 0, 0]));
    s[0] += n[i * 3];
    s[1] += n[i * 3 + 1];
    s[2] += n[i * 3 + 2];
  }
  const o = new Float32Array(p.length);
  for (let i = 0; i < count; i++) {
    const s = map.get(keys[i]);
    const l = Math.hypot(s[0], s[1], s[2]) || 1;
    o[i * 3] = s[0] / l;
    o[i * 3 + 1] = s[1] / l;
    o[i * 3 + 2] = s[2] / l;
  }
  geo.setAttribute("oNormal", new THREE.BufferAttribute(o, 3));
}

// セル塗り（2 段）
let gradient = null;
function toonGradient() {
  if (gradient) return gradient;
  const t = new THREE.DataTexture(new Uint8Array([120, 255]), 2, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  gradient = t;
  return t;
}

export function toonMaterial() {
  return new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
}

// 裏面を画面上で一定の太さに押し出して輪郭線にする
export const outlineUniforms = {
  uRes: { value: new THREE.Vector2(1, 1) },
  uDpr: { value: 1 },
};

export function outlineMaterial({ width = 2.4, color = 0x15130f, fog = null } = {}) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uRes: outlineUniforms.uRes,
      uDpr: outlineUniforms.uDpr,
      uWidth: { value: width },
      uColor: { value: new THREE.Color(color) },
      uFogColor: { value: new THREE.Color(fog ? fog.color : 0xffffff) },
      uFogNear: { value: fog ? fog.near : 1e6 },
      uFogFar: { value: fog ? fog.far : 2e6 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 oNormal;
      uniform vec2 uRes; uniform float uDpr; uniform float uWidth;
      varying float vDepth;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec4 clip = projectionMatrix * mv;
        vec3 n = normalMatrix * oNormal;
        vec2 dir = n.xy; float len = length(dir);
        if (len > 1e-4) dir /= len; else dir = vec2(0.0);
        clip.xy += dir * uWidth * uDpr * 2.0 / uRes * clip.w;
        vDepth = -mv.z;
        gl_Position = clip;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
      varying float vDepth;
      void main() {
        float f = smoothstep(uFogNear, uFogFar, vDepth);
        gl_FragColor = vec4(mix(uColor, uFogColor, f), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// geometry から本体と輪郭のペアを作る
export function solid(geo, mat, outline) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, mat);
  g.add(m);
  if (outline) g.add(new THREE.Mesh(geo, outline));
  return g;
}

export const ease = {
  clamp01: (x) => Math.min(1, Math.max(0, x)),
  smooth: (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  },
};

// 種つき乱数（毎回同じ見た目にする）
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// アヒルのひな（+X が前）
export function chickGeometry({ tuft = false } = {}) {
  const k = new Kit();
  k.ball(0.46, 0xffc933, { sx: 1.15, sy: 0.85, sz: 0.9 }, 2);
  k.ball(0.3, 0xffc933, { x: 0.4, y: 0.42 }, 2);
  k.cone(0.12, 0.3, 6, 0xf07a1a, { x: 0.8, y: 0.4, rz: -Math.PI / 2 });
  k.cone(0.14, 0.34, 5, 0xffb71e, { x: -0.6, y: 0.2, rz: 1.05 });
  k.box(0.14, 0.1, 0.22, 0xf07a1a, { x: 0.02, y: -0.46, z: 0.18 });
  k.box(0.14, 0.1, 0.22, 0xf07a1a, { x: 0.02, y: -0.46, z: -0.18 });
  k.ball(0.04, 0x15130f, { x: 0.58, y: 0.5, z: 0.21 }, 0);
  k.ball(0.04, 0x15130f, { x: 0.58, y: 0.5, z: -0.21 }, 0);
  if (tuft) k.ball(0.09, 0xe0352b, { x: 0.32, y: 0.76 }, 0);
  return k.geometry();
}

// お母さんアヒル
export function motherGeometry() {
  const k = new Kit();
  k.ball(0.62, 0xfffdf5, { sx: 1.25, sy: 0.82, sz: 0.92 }, 2);
  k.ball(0.28, 0xfffdf5, { x: 0.56, y: 0.74 }, 2);
  k.cyl(0.16, 0.22, 0.4, 8, 0xfffdf5, { x: 0.52, y: 0.42, rz: -0.35, flat: false });
  k.cone(0.13, 0.36, 6, 0xf07a1a, { x: 0.95, y: 0.74, rz: -Math.PI / 2 });
  k.cone(0.2, 0.42, 5, 0xfffdf5, { x: -0.86, y: 0.3, rz: 1.05 });
  k.box(0.18, 0.12, 0.3, 0xf07a1a, { y: -0.58, z: 0.22 });
  k.box(0.18, 0.12, 0.3, 0xf07a1a, { y: -0.58, z: -0.22 });
  k.ball(0.04, 0x15130f, { x: 0.76, y: 0.82, z: 0.2 }, 0);
  k.ball(0.04, 0x15130f, { x: 0.76, y: 0.82, z: -0.2 }, 0);
  return k.geometry();
}
