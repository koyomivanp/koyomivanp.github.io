// 夏の縁側と、同じ場所の夕方。ノートPCの画面は「穴」で、その奥に電脳空間が見える。
import * as THREE from "three";
import { Kit, toonMaterial, outlineMaterial, solid, rng, chickGeometry, motherGeometry } from "dive/kit";

const MOODS = {
  summer: {
    top: 0x1f7fe0, mid: 0x62b7f2, low: 0xd8f2ff, sun: 0xffffff, sunVisible: 0,
    ambient: [0xffffff, 1.55], dir: [0xfff4dc, 1.75], dirPos: [-0.45, 0.8, 0.55],
    cloud: [0xffffff, 0xb8d6f4],
  },
  sunset: {
    top: 0x3b3a86, mid: 0xee6f6b, low: 0xffc56b, sun: 0xfff0b0, sunVisible: 1,
    ambient: [0xb9a4e8, 1.2], dir: [0xffb066, 2.3], dirPos: [0.25, 0.32, -0.75],
    cloud: [0xf5a68f, 0x8a68b6], cloudSun: [0.6, -0.1, 0.8],
  },
};

export const LAPTOP = { tilt: 0.17, screenW: 1.34, screenH: 1.0 };

export function buildEngawa({ lowPoly = false } = {}) {
  const scene = new THREE.Scene();
  const toon = toonMaterial();
  const ink = outlineMaterial({ width: 2.2 });
  const inkThin = outlineMaterial({ width: 1.2 });

  const ambient = new THREE.AmbientLight();
  const dir = new THREE.DirectionalLight();
  scene.add(ambient, dir, dir.target);

  // 空：上下のグラデーション
  const skyU = {
    uTop: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uLow: { value: new THREE.Color() },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1400, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: skyU,
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 uTop, uMid, uLow; varying vec3 vP;
        void main(){
          float h = clamp(vP.y * 3.2, 0.0, 1.0);
          vec3 c = mix(uLow, uMid, smoothstep(0.0, 0.3, h));
          c = mix(c, uTop, smoothstep(0.25, 1.0, h));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    })
  );
  sky.renderOrder = -10;
  scene.add(sky);

  // 夕日
  const sun = new THREE.Group();
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(62, 40), new THREE.MeshBasicMaterial({ color: 0xfff6cf }));
  const sunRing = new THREE.Mesh(new THREE.RingGeometry(74, 82, 48), new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.6 }));
  sun.add(sunDisc, sunRing);
  sun.position.set(240, 150, -820);
  scene.add(sun);

  // 入道雲：球の塊を 2 段塗りにする
  const cloudU = {
    uLit: { value: new THREE.Color() },
    uShade: { value: new THREE.Color() },
    uSun: { value: new THREE.Vector3() },
  };
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: cloudU,
    vertexShader: `varying vec3 vN; void main(){ vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uLit, uShade, uSun; varying vec3 vN;
      void main(){
        float d = dot(normalize(vN), uSun);
        vec3 c = mix(uShade, uLit, smoothstep(-0.02, 0.05, d));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const r = rng(7);
  const cloudKit = new Kit();
  const towers = [
    { x: -80, z: -880, w: 300, h: 520 },
    { x: 400, z: -960, w: 280, h: 420 },
    { x: -560, z: -1000, w: 300, h: 330 },
    { x: 760, z: -980, w: 240, h: 250 },
  ];
  for (const t of towers) {
    const n = Math.round(t.h / 14);
    for (let i = 0; i < n; i++) {
      const v = i / n;
      const spread = t.w * (1 - v * 0.62) * (v < 0.1 ? 1.25 : 1);
      const R = (58 - v * 30) * (0.7 + r() * 0.7) * (t.w / 280);
      cloudKit.ball(R, 0xffffff, {
        x: t.x + (r() - 0.5) * spread,
        y: 40 + v * t.h,
        z: t.z + (r() - 0.5) * 140,
        sy: 0.92,
      }, lowPoly ? 2 : 3);
    }
  }
  scene.add(new THREE.Mesh(cloudKit.geometry(), cloudMat));

  // 遠景
  const far = new Kit();
  const ground = -1.3;
  far.box(3400, 1, 3200, 0x79c85a, { y: ground - 3.5, z: -1500 });
  const R2 = rng(11);
  for (let i = 0; i < 16; i++) {
    const x = -1000 + i * 135 + R2() * 60;
    far.cone(180 + R2() * 110, 110 + R2() * 90, 5, i % 2 ? 0x4b9d7c : 0x5aae8c, { x, y: ground + 42, z: -760 - R2() * 60, ry: R2() * 3 });
  }
  for (let i = 0; i < 20; i++) {
    const x = -900 + i * 95 + R2() * 40;
    far.cone(95 + R2() * 70, 44 + R2() * 44, 5, i % 2 ? 0x2f8a55 : 0x3a9a5c, { x, y: ground + 10, z: -520 - R2() * 40, ry: R2() * 3 });
  }
  // 田んぼ
  for (let i = 0; i < 7; i++) {
    far.box(220, 0.5, 42, i % 2 ? 0x9bd95e : 0x8acc55, { x: -450 + i * 150, y: ground - 2.95, z: -80 });
    far.box(220, 0.5, 42, i % 2 ? 0x8acc55 : 0xa6e068, { x: -420 + i * 150, y: ground - 2.95, z: -130 });
    far.box(220, 0.5, 42, i % 2 ? 0x9bd95e : 0x8acc55, { x: -450 + i * 150, y: ground - 2.95, z: -180 });
  }
  scene.add(new THREE.Mesh(far.geometry(), toon));

  // 電柱と電線（遠くの線は輪郭なしのメッシュ）
  const poles = new Kit();
  const poleX = [-58, -18, 26, 70];
  for (const x of poleX) {
    poles.box(0.5, 20, 0.5, 0x4a4a4a, { x, y: 6, z: -60 });
    poles.box(5, 0.32, 0.32, 0x4a4a4a, { x, y: 15, z: -60 });
  }
  for (let i = 0; i < poleX.length - 1; i++) {
    const a = poleX[i], b = poleX[i + 1];
    const L = b - a;
    for (const dx of [-2, 2]) {
      poles.box(L, 0.07, 0.07, 0x3a3a3a, { x: (a + b) / 2 + dx, y: 15.2, z: -60 });
    }
  }
  scene.add(new THREE.Mesh(poles.geometry(), toon));

  // 庭と生垣
  const yard = new Kit();
  yard.box(42, 1, 18, 0x63bb4b, { y: ground - 0.5, z: -12 });
  yard.box(42, 0.04, 1.2, 0x74c95a, { y: ground + 0.02, z: -7 });
  yard.box(42, 0.04, 1.2, 0x74c95a, { y: ground + 0.02, z: -10.5 });
  yard.box(42, 1.5, 1.3, 0x2f8a4c, { y: ground + 0.75, z: -21 });
  const R3 = rng(5);
  for (let i = 0; i < 18; i++) {
    yard.ball(1 + R3() * 0.4, i % 2 ? 0x2f8a4c : 0x3a9a58, { x: -20 + i * 2.4, y: ground + 1.5, z: -21 }, 1);
  }
  // 沓脱石
  yard.box(1.5, 0.45, 0.9, 0xb9b4a6, { x: 0.4, y: ground + 0.2, z: -3.1 });
  // ひまわり
  const flowerAt = [[-6.5, -8], [-5.1, -9], [-7.9, -9.5], [5.6, -8.6], [7.1, -9.3]];
  for (const [x, z] of flowerAt) {
    yard.box(0.1, 2.3, 0.1, 0x2c7d3f, { x, y: ground + 1.15, z });
    yard.box(0.55, 0.05, 0.25, 0x3a9a58, { x: x + 0.28, y: ground + 1.2, z, rz: 0.3 });
    yard.cyl(0.42, 0.42, 0.08, 10, 0xffc42e, { x, y: ground + 2.4, z: z + 0.1, rx: 1.35 });
    yard.cyl(0.2, 0.2, 0.1, 8, 0x6b3a18, { x, y: ground + 2.44, z: z + 0.2, rx: 1.35 });
  }
  scene.add(solid(yard.geometry(), toon, inkThin));

  // 縁側：板張り、柱、軒
  const boards = new Kit();
  const house = new Kit();
  const boardN = 22;
  for (let i = 0; i < boardN; i++) {
    const c = i % 3 === 0 ? 0xb8834c : i % 3 === 1 ? 0xc69058 : 0xad7a44;
    boards.box(30, 0.14, 0.5, c, { y: -0.07, z: -2.4 + i * 0.52 });
  }
  house.box(30, 0.5, 0.2, 0x7a5430, { y: -0.34, z: -2.72 });
  // 束柱
  for (let x = -14; x <= 14; x += 4) house.box(0.26, 1.1, 0.26, 0x5e4126, { x, y: -0.75, z: -2.5 });
  // 柱
  for (const x of [-6.4, 6.4, -13, 13]) {
    house.box(0.34, 3.7, 0.34, 0x8d6236, { x, y: 1.75, z: -2.45 });
  }
  // 軒
  house.box(32, 0.26, 0.26, 0x7a5430, { y: 3.55, z: -2.45 });
  for (let x = -15; x <= 15; x += 1.5) house.box(0.14, 0.14, 7.4, 0x6e4a2a, { x, y: 3.75, z: 0.4 });
  house.box(32, 0.1, 8, 0xa57c4e, { y: 3.87, z: 0.4 });
  house.box(32, 0.12, 0.4, 0x45403a, { y: 3.91, z: -3.65 });
  // 背面の暗がり（部屋側は写らないはずだが、夕方の引きで見える）
  house.box(32, 6, 0.2, 0x4a3b2d, { y: 2, z: 10.2 });
  scene.add(new THREE.Mesh(boards.geometry(), toon));
  scene.add(solid(house.geometry(), toon, ink));

  // ちゃぶ台の上：スイカと麦茶
  const table = new Kit();
  table.cyl(1.55, 1.55, 0.12, 22, 0x8b5a2c, { y: -0.1 + 0.68, flat: false });
  table.box(0.16, 0.56, 0.16, 0x6e4522, { x: 0.8, y: 0.28, z: 0.5 });
  table.box(0.16, 0.56, 0.16, 0x6e4522, { x: -0.8, y: 0.28, z: 0.5 });
  table.box(0.16, 0.56, 0.16, 0x6e4522, { x: 0.8, y: 0.28, z: -0.5 });
  table.box(0.16, 0.56, 0.16, 0x6e4522, { x: -0.8, y: 0.28, z: -0.5 });
  // スイカ（断面が手前）
  table.cyl(0.26, 0.26, 0.06, 18, 0xffffff, { x: 1.05, y: 0.67, z: 0.55, flat: false });
  table.add(new THREE.CylinderGeometry(0.2, 0.2, 0.09, 12, 1, false, 0, Math.PI), 0x2c8f4a, { x: 1.05, y: 0.75, z: 0.55, rx: Math.PI / 2, ry: 0.1, flat: true });
  table.add(new THREE.CylinderGeometry(0.17, 0.17, 0.092, 12, 1, false, 0, Math.PI), 0xee3b3f, { x: 1.05, y: 0.75, z: 0.552, rx: Math.PI / 2, ry: 0.1, flat: true });
  // 麦茶
  table.cyl(0.1, 0.09, 0.28, 12, 0x9a5a22, { x: -1.0, y: 0.78, z: 0.55, flat: false });
  table.cyl(0.11, 0.1, 0.05, 12, 0xd8efff, { x: -1.0, y: 0.94, z: 0.55, flat: false });
  scene.add(solid(table.geometry(), toon, ink));

  // ノートPC：分厚くて少し黄ばんだ本体
  const tableTop = 0.64;
  const laptop = new THREE.Group();
  laptop.position.set(0, tableTop, 0);
  scene.add(laptop);

  const base = new Kit();
  const bodyC = 0xd9d2bc;
  base.box(1.62, 0.09, 1.2, bodyC, { y: 0.045 });
  base.box(1.42, 0.012, 0.6, 0x4d4a44, { y: 0.094, z: 0.08 });
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 12; col++) {
      base.box(0.09, 0.016, 0.1, 0xefeadb, { x: -0.6 + col * 0.11, y: 0.104, z: -0.13 + row * 0.13 });
    }
  }
  base.box(0.4, 0.012, 0.22, 0xc2baa3, { y: 0.094, z: 0.48 });
  laptop.add(solid(base.geometry(), toon, ink));

  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.09, -0.56);
  laptop.add(lidPivot);
  const lid = new Kit();
  lid.box(1.62, 1.22, 0.07, bodyC, { y: 0.61, z: -0.035 });
  lid.box(1.46, 1.08, 0.012, 0x24221e, { y: 0.61, z: 0.003 });
  // 背面のロゴ位置に古いシール
  lid.box(0.3, 0.3, 0.01, 0xff7a18, { x: 0.3, y: 0.7, z: -0.074, rz: 0.15 });
  lid.box(0.14, 0.22, 0.01, 0x1b8fe0, { x: -0.3, y: 0.42, z: -0.074, rz: -0.2 });
  lidPivot.add(solid(lid.geometry(), toon, ink));

  // 画面＝奥の世界が見える穴。色は塗らず深度だけ書く。
  const screenGeo = new THREE.PlaneGeometry(LAPTOP.screenW, LAPTOP.screenH);
  const hole = new THREE.Mesh(screenGeo, new THREE.MeshBasicMaterial({ colorWrite: false }));
  hole.position.set(0, 0.61, 0.012);
  hole.renderOrder = -100;
  lidPivot.add(hole);

  lidPivot.rotation.x = -LAPTOP.tilt;

  // 風鈴
  const furin = new THREE.Group();
  furin.position.set(1.9, 3.72, -2.0);
  const fk = new Kit();
  fk.box(0.012, 0.42, 0.012, 0x444444, { y: -0.2 });
  fk.ball(0.17, 0xe7f6ff, { y: -0.52, sy: 0.82 }, 2);
  fk.box(0.012, 0.42, 0.012, 0x444444, { y: -0.8 });
  fk.box(0.16, 0.34, 0.012, 0xe23a55, { y: -1.14 });
  furin.add(solid(fk.geometry(), toon, inkThin));
  scene.add(furin);

  // 夕方：庭を歩いて帰るアヒルの親子
  const family = new THREE.Group();
  const cg = chickGeometry();
  const mg = motherGeometry();
  const mom = solid(mg, toon, inkThin);
  mom.scale.setScalar(0.95);
  mom.position.set(-3.0, ground + 0.6, -13);
  mom.rotation.y = 0.08;
  family.add(mom);
  for (let i = 0; i < 4; i++) {
    const c = solid(cg, toon, inkThin);
    c.scale.setScalar(0.56);
    c.position.set(-4.2 - i * 0.9, ground + 0.32, -13 + i * 0.05);
    c.rotation.y = 0.08;
    family.add(c);
  }
  family.visible = false;
  scene.add(family);

  function setMood(name) {
    const m = MOODS[name];
    skyU.uTop.value.set(m.top);
    skyU.uMid.value.set(m.mid);
    skyU.uLow.value.set(m.low);
    ambient.color.set(m.ambient[0]);
    ambient.intensity = m.ambient[1];
    dir.color.set(m.dir[0]);
    dir.intensity = m.dir[1];
    dir.position.set(...m.dirPos).multiplyScalar(100);
    sun.visible = !!m.sunVisible;
    cloudU.uLit.value.set(m.cloud[0]);
    cloudU.uShade.value.set(m.cloud[1]);
    cloudU.uSun.value.set(...(m.cloudSun || m.dirPos)).normalize();
    const closed = name === "sunset";
    family.visible = closed;
    hole.visible = !closed;
    lidPivot.rotation.x = closed ? Math.PI / 2 - 0.05 : -LAPTOP.tilt;
    lidPivot.updateMatrixWorld(true);
  }
  setMood("summer");

  // 画面の中心と姿勢（電脳空間の原点になる）
  lidPivot.rotation.x = -LAPTOP.tilt;
  scene.updateMatrixWorld(true);
  const portal = new THREE.Object3D();
  hole.matrixWorld.decompose(portal.position, portal.quaternion, new THREE.Vector3());
  const corners = [
    new THREE.Vector3(-LAPTOP.screenW / 2, LAPTOP.screenH / 2, 0),
    new THREE.Vector3(LAPTOP.screenW / 2, LAPTOP.screenH / 2, 0),
    new THREE.Vector3(LAPTOP.screenW / 2, -LAPTOP.screenH / 2, 0),
    new THREE.Vector3(-LAPTOP.screenW / 2, -LAPTOP.screenH / 2, 0),
  ].map((v) => v.applyMatrix4(hole.matrixWorld));

  return {
    scene,
    sun,
    setMood,
    portal,
    corners,
    tick(time) {
      furin.rotation.z = Math.sin(time * 1.5) * 0.09;
      furin.rotation.x = Math.sin(time * 1.1 + 1) * 0.05;
    },
  };
}
