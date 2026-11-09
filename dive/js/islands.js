// 作品ごとの浮島。プリミティブの組み合わせで、作品の特徴だけを立体にする。
import * as THREE from "three";
import { Kit, solid, chickGeometry, motherGeometry, rng } from "dive/kit";

const INK = 0x15130f;

// 島の土台（上面の色と、下にすぼまる岩）
function base(k, top, side, rock, R = 3.3) {
  k.cyl(R, R * 0.96, 0.32, 12, top, { y: -0.16 });
  k.cyl(R * 0.96, R * 0.72, 0.8, 10, side, { y: -0.72, ry: 0.2 });
  k.cyl(R * 0.72, R * 0.36, 1.1, 8, rock, { y: -1.67, ry: 0.5 });
  k.cone(R * 0.36, 1.1, 6, rock, { y: -2.77, rx: Math.PI, ry: 0.9 });
}

const shared = {};
function chickGeo() { return (shared.c ??= chickGeometry()); }
function lateChickGeo() { return (shared.lc ??= chickGeometry({ tuft: true })); }
function motherGeo() { return (shared.m ??= motherGeometry()); }

const builders = {
  // 草地を歩くアヒルの親子（遅れた 1 羽つき）
  kisou(ctx) {
    const k = new Kit();
    base(k, 0x82d04f, 0x69b83e, 0x8a6a42);
    k.cyl(0.95, 0.95, 0.04, 16, 0x56b4e8, { x: 1.5, y: 0.02, z: -1.2, flat: false });
    const r = rng(3);
    for (let i = 0; i < 30; i++) {
      const a = r() * 6.28, d = 1 + r() * 2;
      k.box(0.06, 0.2, 0.06, 0x4f9c35, { x: Math.cos(a) * d, y: 0.1, z: Math.sin(a) * d });
    }
    k.cyl(0.55, 0.42, 0.26, 10, 0xb88a50, { x: -2.1, y: 0.13, z: -1.4 });
    k.cyl(0.36, 0.36, 0.1, 10, 0x6e4a2a, { x: -2.1, y: 0.27, z: -1.4 });
    const g = new THREE.Group();
    g.add(solid(k.geometry(), ctx.toon, ctx.ink));
    const walkers = [];
    const mk = (geo, scale) => {
      const w = solid(geo, ctx.toon, ctx.inkThin);
      w.scale.setScalar(scale);
      g.add(w);
      return w;
    };
    const R = 2.2;
    const list = [{ m: mk(motherGeo(), 0.62), off: 0, s: 0.62 }];
    for (let i = 0; i < 5; i++) list.push({ m: mk(chickGeo(), 0.36), off: 0.42 + i * 0.36, s: 0.36 });
    list.push({ m: mk(lateChickGeo(), 0.36), off: 3.1, s: 0.36 });
    walkers.push(...list);
    return {
      group: g,
      tick(t) {
        for (const w of walkers) {
          const a = t * 0.34 - w.off;
          w.m.position.set(Math.cos(a) * R, 0.36 * (w.s / 0.36) + Math.abs(Math.sin(t * 6 + w.off * 7)) * 0.07, Math.sin(a) * R);
          w.m.rotation.y = -a - Math.PI / 2 + Math.PI;
          w.m.rotation.z = Math.sin(t * 6 + w.off * 7) * 0.08;
        }
      },
    };
  },

  // 江戸の門と、向かい合う侍の影、合図の「！」
  iai(ctx) {
    const k = new Kit();
    base(k, 0xd9c8a2, 0xbca980, 0x6d6152);
    // 門
    const C = 0x3a2a1e;
    k.box(0.32, 2.4, 0.32, C, { x: -1.2, y: 1.2, z: -1.4 });
    k.box(0.32, 2.4, 0.32, C, { x: 1.2, y: 1.2, z: -1.4 });
    k.box(0.24, 1.6, 0.24, C, { x: -2.1, y: 0.8, z: -1.4 });
    k.box(0.24, 1.6, 0.24, C, { x: 2.1, y: 0.8, z: -1.4 });
    k.box(3.1, 0.24, 0.36, C, { y: 2.2, z: -1.4 });
    k.box(1.1, 2.0, 0.1, 0x5a3f28, { x: -0.62, y: 1.0, z: -1.4 });
    k.box(1.1, 2.0, 0.1, 0x5a3f28, { x: 0.62, y: 1.0, z: -1.4 });
    k.box(1.0, 1.0, 0.1, 0xefe6cf, { x: -1.65, y: 1.1, z: -1.4 });
    k.box(1.0, 1.0, 0.1, 0xefe6cf, { x: 1.65, y: 1.1, z: -1.4 });
    // 瓦屋根
    k.add(new THREE.ConeGeometry(2.8, 0.85, 4), 0x2b2f38, { y: 2.74, z: -1.4, ry: Math.PI / 4, sz: 0.42, flat: true });
    k.box(3.9, 0.12, 1.5, 0x20242c, { y: 2.33, z: -1.4 });
    const samurai = (x, face) => {
      k.cone(0.46, 1.2, 8, INK, { x, y: 0.6, z: 0.9 });
      k.box(0.86, 0.3, 0.34, INK, { x, y: 1.12, z: 0.9 });
      k.ball(0.22, INK, { x, y: 1.46, z: 0.9 }, 1);
      k.ball(0.11, INK, { x: x - face * 0.08, y: 1.72, z: 0.9 }, 0);
      k.box(1.2, 0.06, 0.05, INK, { x: x + face * 0.75, y: 0.86, z: 1.05, rz: face * 0.32 });
    };
    samurai(-1.9, 1);
    samurai(1.9, -1);
    const g = new THREE.Group();
    g.add(solid(k.geometry(), ctx.toon, ctx.ink));
    const ex = new Kit();
    ex.box(0.42, 1.2, 0.3, 0xe0242c, { y: 0.9 });
    ex.box(0.42, 0.42, 0.3, 0xe0242c, { y: -0.1 });
    const mark = solid(ex.geometry(), ctx.toon, ctx.ink);
    mark.position.set(0, 3.6, 0.6);
    g.add(mark);
    return { group: g, tick(t) { const s = 0.9 + Math.max(0, Math.sin(t * 2.2)) ** 8 * 0.5; mark.scale.setScalar(s); } };
  },

  // リンクと、這った跡が体になる芋虫（緑とピンク）、葉っぱのパック
  imomushi(ctx) {
    const k = new Kit();
    base(k, 0x2d4a2a, 0x223a21, 0x4a3a28, 3.5);
    k.box(5.2, 0.05, 3.5, 0x1a3120, { y: 0.03 });
    const W = 0xd7c29a;
    k.box(5.5, 0.34, 0.14, W, { y: 0.17, z: -1.82 });
    k.box(5.5, 0.34, 0.14, W, { y: 0.17, z: 1.82 });
    k.box(0.14, 0.34, 1.0, W, { x: -2.68, y: 0.17, z: -1.3 });
    k.box(0.14, 0.34, 1.0, W, { x: -2.68, y: 0.17, z: 1.3 });
    k.box(0.14, 0.34, 1.0, W, { x: 2.68, y: 0.17, z: -1.3 });
    k.box(0.14, 0.34, 1.0, W, { x: 2.68, y: 0.17, z: 1.3 });
    k.box(0.05, 0.02, 3.5, 0x6fae62, { y: 0.07 });
    k.cyl(0.65, 0.65, 0.02, 18, 0x6fae62, { y: 0.07, flat: false });
    k.cyl(0.58, 0.58, 0.03, 18, 0x1a3120, { y: 0.075, flat: false });
    const g = new THREE.Group();
    g.add(solid(k.geometry(), ctx.toon, ctx.ink));
    const worm = (color, x0, z0, dirx, dirz) => {
      const w = new Kit();
      for (let i = 0; i < 7; i++) {
        w.ball(0.2, color, { x: -dirx * i * 0.3, y: 0.2, z: -dirz * i * 0.3 }, 1);
      }
      w.ball(0.26, color, { y: 0.26 }, 1);
      for (const s of [-1, 1]) {
        w.ball(0.09, 0xffffff, { x: dirz * s * 0.14 + dirx * 0.2, y: 0.42, z: -dirx * s * 0.14 + dirz * 0.2 }, 1);
        w.ball(0.05, INK, { x: dirz * s * 0.14 + dirx * 0.27, y: 0.44, z: -dirx * s * 0.14 + dirz * 0.27 }, 0);
      }
      const m = solid(w.geometry(), ctx.toon, ctx.inkThin);
      m.position.set(x0, 0.06, z0);
      g.add(m);
      return m;
    };
    const green = worm(0x35c26b, -0.6, 0.55, 1, -0.25);
    const pink = worm(0xd94aab, 1.0, -0.65, -1, 0.3);
    const pk = new Kit();
    pk.cyl(0.26, 0.26, 0.12, 10, 0x8fdc4e, { y: 0.14, flat: false });
    pk.box(0.42, 0.02, 0.03, 0x4f9c35, { y: 0.21 });
    const puck = solid(pk.geometry(), ctx.toon, ctx.inkThin);
    g.add(puck);
    return {
      group: g,
      tick(t) {
        green.position.x = -0.6 + Math.sin(t * 0.9) * 0.28;
        pink.position.x = 1.0 + Math.sin(t * 0.9 + 2) * 0.28;
        puck.position.set(Math.sin(t * 0.7) * 1.7, 0, Math.sin(t * 1.3) * 1.05);
      },
    };
  },

  // 敵に囲まれて自動射撃
  survival(ctx) {
    const k = new Kit();
    base(k, 0x6a6a72, 0x505058, 0x3a3a42);
    k.box(0.55, 0.8, 0.45, 0x2a8fd8, { y: 0.4 });
    k.ball(0.28, 0xf2d3a8, { y: 1.02 }, 1);
    const r = rng(9);
    const enemy = new Kit();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 6.283 + r() * 0.2, d = 2.0 + r() * 0.8;
      enemy.box(0.38, 0.5, 0.38, i % 3 ? 0xd8413d : 0x8e4ad0, { x: Math.cos(a) * d, y: 0.25, z: Math.sin(a) * d, ry: r() * 3 });
    }
    const g = new THREE.Group();
    g.add(solid(k.geometry(), ctx.toon, ctx.ink));
    g.add(solid(enemy.geometry(), ctx.toon, ctx.inkThin));
    const bullets = [];
    for (let i = 0; i < 8; i++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), new THREE.MeshBasicMaterial({ color: 0xffb400 }));
      g.add(b);
      bullets.push(b);
    }
    return {
      group: g,
      tick(t) {
        bullets.forEach((b, i) => {
          const a = (i / 8) * 6.283 + t * 0.3;
          const d = 0.4 + (((t * 1.4 + i * 0.37) % 1) * 2.0);
          b.position.set(Math.cos(a) * d, 0.62, Math.sin(a) * d);
        });
      },
    };
  },

  // 6×6 の盤
  othello(ctx) {
    const k = new Kit();
    base(k, 0xc8a26a, 0xad8a55, 0x7a6143);
    k.box(4.3, 0.18, 4.3, 0x2f8a56, { y: 0.09 });
    const s = 0.66;
    const r = rng(14);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      const x = (i - 2.5) * s, z = (j - 2.5) * s;
      k.box(s - 0.05, 0.02, s - 0.05, (i + j) % 2 ? 0x37a064 : 0x2f9159, { x, y: 0.19, z });
      if (r() < 0.55) k.cyl(0.26, 0.26, 0.08, 14, r() < 0.5 ? 0xfaf7ee : 0x1d1b18, { x, y: 0.24, z, flat: false });
    }
    return { group: solid(k.geometry(), ctx.toon, ctx.ink), tick() {} };
  },

  // 寿命つきのマス（3×3 の木の盤、薄れていく駒）
  kiewado(ctx) {
    const k = new Kit();
    base(k, 0xe8e2d0, 0xcfc8b4, 0x8c8474);
    k.box(3.9, 0.3, 3.9, 0xa8723e, { y: 0.15 });
    const s = 1.2;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      k.box(s - 0.08, 0.04, s - 0.08, 0xc08a50, { x: (i - 1) * s, y: 0.32, z: (j - 1) * s });
    }
    const g = new THREE.Group();
    g.add(solid(k.geometry(), ctx.toon, ctx.ink));
    const tiles = [];
    const pos = [[-1, -1, 0], [0, 0, 1], [1, 1, 2], [1, -1, 0.4], [-1, 1, 1.5]];
    const geo = new THREE.BoxGeometry(0.92, 0.2, 0.92);
    for (const [i, j, ph] of pos) {
      const mat = new THREE.MeshToonMaterial({ color: 0xfff2d8, gradientMap: ctx.toon.gradientMap, transparent: true });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(i * s, 0.45, j * s);
      g.add(m);
      tiles.push({ m, ph });
    }
    return {
      group: g,
      tick(t) {
        for (const { m, ph } of tiles) {
          const v = ((t * 0.3 + ph * 0.33) % 1);
          m.material.opacity = 1 - v * v * v;
          m.scale.y = 1 - v * 0.6;
        }
      },
    };
  },

  // 部活会計：コイン、領収書、車
  kaikei(ctx) {
    const k = new Kit();
    base(k, 0xdff1fa, 0xbfdced, 0x7c8fa0);
    [[-1.2, 0.6, 6], [-0.5, 1.2, 4], [-1.8, -0.3, 3]].forEach(([x, z, n]) => {
      for (let i = 0; i < n; i++) k.cyl(0.42, 0.42, 0.14, 14, i % 2 ? 0xffc933 : 0xf5b81f, { x, y: 0.07 + i * 0.15, z, flat: false });
    });
    // 領収書
    k.box(1.3, 0.04, 2.0, 0xffffff, { x: 1.35, y: 0.05, z: 0.5, ry: -0.25 });
    for (let i = 0; i < 6; i++) k.box(0.9, 0.02, 0.07, i % 2 ? 0x8ea2b5 : INK, { x: 1.35 + i * 0.05, y: 0.08, z: 0.05 + i * 0.22 - 0.15 * Math.sin(0.25), ry: -0.25 });
    // 車
    k.box(1.5, 0.42, 0.78, 0x1b8fe0, { x: -0.4, y: 0.42, z: -1.7 });
    k.box(0.85, 0.4, 0.68, 0xbfe7ff, { x: -0.5, y: 0.82, z: -1.7 });
    for (const [a, b] of [[-0.9, -2.1], [0.1, -2.1], [-0.9, -1.3], [0.1, -1.3]]) k.cyl(0.18, 0.18, 0.12, 12, INK, { x: a, y: 0.2, z: b, rx: Math.PI / 2, flat: false });
    return { group: solid(k.geometry(), ctx.toon, ctx.ink), tick() {} };
  },

  // 勝率の棒グラフと日次更新
  splatoon(ctx) {
    const k = new Kit();
    base(k, 0xeaf7ee, 0xc8e4d0, 0x7b9486);
    const bars = [[-2, 1.4, 0xff4f8b], [-1, 2.3, 0x7a4be0], [0, 3.1, 0x18c2a3], [1, 1.9, 0xffc933], [2, 1.2, 0x1b8fe0]];
    const r = rng(21);
    for (const [x, h, c] of bars) k.box(0.74, h, 0.74, c, { x, y: h / 2, z: -0.3 });
    for (let i = 0; i < 12; i++) {
      const a = r() * 6.28, d = 1 + r() * 2;
      k.cyl(0.14 + r() * 0.3, 0.14 + r() * 0.3, 0.03, 10, [0xff4f8b, 0x18c2a3, 0xffc933][i % 3], { x: Math.cos(a) * d, y: 0.03, z: Math.sin(a) * d + 0.6, flat: false });
    }
    return { group: solid(k.geometry(), ctx.toon, ctx.ink), tick() {} };
  },

  // 写真の束が A4 の PDF へ
  photopdf(ctx) {
    const k = new Kit();
    base(k, 0xf5efe2, 0xdcd4c2, 0x8f8673);
    const r = rng(33);
    const photoColors = [0x7cc4ef, 0xf28b6d, 0x82d04f, 0xf2c94c];
    for (let i = 0; i < 4; i++) {
      const x = -1.45, z = 0.45, ry = (r() - 0.5) * 0.7, y = 0.05 + i * 0.06;
      k.box(1.5, 0.04, 1.15, 0xffffff, { x, y, z, ry });
      k.box(1.3, 0.05, 0.95, photoColors[i], { x, y: y + 0.005, z, ry });
    }
    k.box(1.65, 0.1, 2.3, 0xffffff, { x: 1.2, y: 0.55, z: -0.3, rx: -0.5 });
    k.box(1.4, 0.11, 0.9, 0x7cc4ef, { x: 1.2, y: 0.74, z: -0.65, rx: -0.5 });
    for (let i = 0; i < 3; i++) k.box(1.3, 0.11, 0.08, INK, { x: 1.2, y: 0.47 - i * 0.15, z: 0.0 + i * 0.26, rx: -0.5 });
    k.box(1.4, 0.05, 0.1, 0xffffff, { x: 1.2, y: 0.05, z: 0.8 });
    return { group: solid(k.geometry(), ctx.toon, ctx.ink), tick() {} };
  },

  // Markdown の文書
  mdpdf(ctx) {
    const k = new Kit();
    base(k, 0xe9eef5, 0xc8d2e0, 0x7d8797);
    k.box(2.3, 3.1, 0.1, 0xffffff, { y: 1.75, rx: -0.14 });
    k.box(1.3, 0.2, 0.12, INK, { x: -0.25, y: 2.75, z: 0.13, rx: -0.14 });
    const w = [1.8, 1.5, 1.7, 1.1, 1.8, 1.3];
    w.forEach((v, i) => k.box(v, 0.09, 0.12, i % 3 === 2 ? 0x1b8fe0 : 0x7d8797, { x: -1 + v / 2 - 0.1 + 0.05, y: 2.36 - i * 0.3, z: 0.13 + i * 0.041, rx: -0.14 }));
    k.box(0.44, 0.04, 0.5, 0xd6dee9, { x: 1.0, y: 3.2, z: -0.15, rz: -0.8, ry: 0 });
    return { group: solid(k.geometry(), ctx.toon, ctx.ink), tick() {} };
  },

  // 傷の入った年輪と、発芽
  kinosei(ctx) {
    const k = new Kit();
    base(k, 0xdde2d2, 0xbfc7b0, 0x7f8a70);
    k.cyl(1.9, 2.2, 1.1, 14, 0x8a6236, { y: 0.55, flat: true });
    const rings = [1.85, 1.55, 1.2, 0.85, 0.5, 0.2];
    rings.forEach((R, i) => k.cyl(R, R, 0.02, 18, i % 2 ? 0xd8b67c : 0xe6c78e, { y: 1.11 + i * 0.003, flat: false }));
    // 傷
    for (const [x, z, ry, s] of [[0.55, -0.7, 0.4, 0.34], [-0.75, 0.35, 2.0, 0.26], [0.9, 0.6, 4.2, 0.3]]) {
      k.cone(s, 0.04, 3, 0x1b2a4a, { x, z, y: 1.14, ry });
    }
    // 芽
    k.box(0.07, 1.3, 0.07, 0x5c7a3a, { x: 0, y: 1.7, z: 0 });
    k.ball(0.32, 0x7cb34f, { x: 0.26, y: 2.34, z: 0, sy: 0.5, sx: 1.2 }, 1);
    k.ball(0.28, 0x8ec65c, { x: -0.25, y: 2.12, z: 0.05, sy: 0.5, sx: 1.2 }, 1);
    return { group: solid(k.geometry(), ctx.toon, ctx.ink), tick() {} };
  },

  // イラスト：イーゼルとキャンバス（作品の絵は右のパネルで見せる）
  art(ctx) {
    const k = new Kit();
    base(k, 0xffe4ef, 0xf3bdd3, 0x9a7183);
    const W = 0x9a6a3a;
    k.box(0.12, 3.4, 0.12, W, { x: -0.8, y: 1.7, z: -0.3, rz: -0.14, rx: 0.1 });
    k.box(0.12, 3.4, 0.12, W, { x: 0.8, y: 1.7, z: -0.3, rz: 0.14, rx: 0.1 });
    k.box(0.12, 3.2, 0.12, W, { y: 1.6, z: -1.0, rx: -0.28 });
    k.box(2.4, 0.14, 0.32, W, { y: 1.1, z: -0.16, rx: 0.1 });
    k.box(2.4, 1.8, 0.08, 0xffffff, { y: 2.08, z: -0.26, rx: 0.1 });
    // 色面だけのキャンバス
    k.box(2.2, 0.8, 0.09, 0x6b2fa8, { y: 2.44, z: -0.24, rx: 0.1 });
    k.ball(0.42, 0xe6317c, { x: 0.45, y: 2.0, z: -0.25, sz: 0.14 }, 1);
    k.box(1.0, 0.42, 0.09, 0xffc933, { x: -0.55, y: 1.68, z: -0.23, rx: 0.1 });
    // パレットと筆
    k.cyl(0.62, 0.62, 0.05, 14, 0xd6b083, { x: 1.7, y: 0.07, z: 1.1, flat: false });
    [[0x6b2fa8, 0], [0xe6317c, 1.3], [0xffc933, 2.6], [0x1b8fe0, 3.9]].forEach(([c, a]) =>
      k.cyl(0.11, 0.11, 0.04, 8, c, { x: 1.7 + Math.cos(a) * 0.38, y: 0.11, z: 1.1 + Math.sin(a) * 0.38, flat: false }));
    k.box(1.3, 0.05, 0.05, 0xc9402f, { x: 0.8, y: 0.05, z: 1.9, ry: 0.3 });
    return { group: solid(k.geometry(), ctx.toon, ctx.ink), tick() {} };
  },

  // ペンケース
  pencase(ctx) {
    const k = new Kit();
    base(k, 0xf0f0ee, 0xd5d5d0, 0x8e8e88);
    const C = 0xe6317c;
    k.box(3.3, 0.9, 1.25, C, { y: 0.55 });
    k.cyl(0.625, 0.625, 0.9, 12, C, { x: -1.65, y: 0.55, flat: false });
    k.cyl(0.625, 0.625, 0.9, 12, C, { x: 1.65, y: 0.55, flat: false });
    k.box(3.2, 0.03, 0.14, 0x2a2622, { y: 1.015, z: 0 });
    k.box(0.14, 0.16, 0.06, 0xdfd7c0, { x: 1.2, y: 1.05 });
    const pens = [[-0.8, 0x1b8fe0], [-0.3, 0xffc933], [0.3, 0x18c2a3]];
    for (const [x, c] of pens) {
      k.box(0.18, 1.5, 0.18, c, { x, y: 1.55, z: 0.15, rz: x * 0.22 });
      k.cone(0.12, 0.26, 6, 0xf0d5a8, { x: x - Math.sin(x * 0.22) * 0.88, y: 2.43, z: 0.15, rz: x * 0.22 });
    }
    return { group: solid(k.geometry(), ctx.toon, ctx.ink), tick() {} };
  },
};

export function buildIsland(id, ctx) {
  const make = builders[id];
  if (!make) throw new Error("no island: " + id);
  return make(ctx);
}
