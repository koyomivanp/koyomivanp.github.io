(() => {
  "use strict";

  const W = 900;
  const H = 600;
  const PLAYER_R = 16;
  const ENEMY_R = 12;
  const BULLET_R = 6;
  const GEM_R = 6;
  const ENEMY_HP = 2;
  const SPEED = 260;
  const ENEMY_SPEED = 58;
  const BULLET_SPEED = 430;
  const FIRE_INTERVAL = 0.23;
  const SPIN_STEP = (20 * Math.PI) / 180;
  const GEM_RANGE = 120;
  const GEM_SPEED = 280;
  const HURT_CD = 0.3;
  const MAX_HP = 10;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayMsg = document.getElementById("overlay-msg");
  const startBtn = document.getElementById("start-btn");

  let phase = "title";
  let lastT = 0;
  let elapsed = 0;
  let fireCd = 0;
  let hurtCd = 0;
  let fireAngle = 0;
  let spawnCd = 0.8;
  let levelUpBanner = "";
  let levelUpTimer = 0;

  const keys = {};
  let player = { x: 0, y: 0, hp: MAX_HP, maxHp: MAX_HP };
  let attackPower = 1;
  let bulletsPerShot = 1;
  let moveMult = 1;
  let level = 1;
  let xp = 0;
  let xpNext = 10;
  let score = 0;
  let paused = false;

  const enemies = [];
  const bullets = [];
  const gems = [];

  const UPGRADES = [
    { id: "atk", label: "攻撃力 UP (+1)" },
    { id: "spd", label: "移動速度 UP" },
    { id: "multi", label: "弾数 UP (+1)" },
  ];

  function resetGame() {
    elapsed = 0;
    fireCd = 0;
    hurtCd = 0;
    fireAngle = 0;
    spawnCd = 0.5;
    levelUpBanner = "";
    levelUpTimer = 0;
    player = { x: 0, y: 0, hp: MAX_HP, maxHp: MAX_HP };
    attackPower = 1;
    bulletsPerShot = 1;
    moveMult = 1;
    level = 1;
    xp = 0;
    xpNext = 10;
    score = 0;
    paused = false;
    enemies.length = 0;
    bullets.length = 0;
    gems.length = 0;
  }

  function showOverlay(title, msg, showStart) {
    overlayTitle.textContent = title;
    overlayMsg.textContent = msg;
    startBtn.style.display = showStart ? "inline-block" : "none";
    overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  function spawnEnemy() {
    const margin = 40;
    const hw = W / 2 + margin;
    const hh = H / 2 + margin;
    const side = (Math.random() * 4) | 0;
    let x, y;
    switch (side) {
      case 0: x = player.x - hw - margin; y = player.y + (Math.random() * hh * 2 - hh); break;
      case 1: x = player.x + hw + margin; y = player.y + (Math.random() * hh * 2 - hh); break;
      case 2: x = player.x + (Math.random() * hw * 2 - hw); y = player.y - hh - margin; break;
      default: x = player.x + (Math.random() * hw * 2 - hw); y = player.y + hh + margin; break;
    }
    enemies.push({ x, y, hp: ENEMY_HP, maxHp: ENEMY_HP });
  }

  function shoot() {
    const n = bulletsPerShot;
    if (n <= 1) {
      bullets.push({
        x: player.x, y: player.y,
        vx: Math.cos(fireAngle) * BULLET_SPEED,
        vy: Math.sin(fireAngle) * BULLET_SPEED,
        life: 4,
      });
      fireAngle += SPIN_STEP;
      return;
    }
    const spread = (12 * Math.PI) / 180;
    const off = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      const a = fireAngle + (i - off) * spread;
      bullets.push({
        x: player.x, y: player.y,
        vx: Math.cos(a) * BULLET_SPEED,
        vy: Math.sin(a) * BULLET_SPEED,
        life: 4,
      });
    }
    fireAngle += SPIN_STEP;
  }

  function killEnemy(e, idx) {
    enemies.splice(idx, 1);
    gems.push({ x: e.x, y: e.y, r: GEM_R });
    score += 12;
  }

  function gainXp(n) {
    xp += n;
    score += n * 5;
    while (xp >= xpNext) {
      xp -= xpNext;
      level++;
      xpNext += 4;
      player.maxHp += 2;
      player.hp = Math.min(player.maxHp, player.hp + 2);
      score += 75 + level * 12;
      const pick = UPGRADES[(Math.random() * UPGRADES.length) | 0];
      if (pick.id === "atk") attackPower++;
      else if (pick.id === "spd") moveMult += 0.15;
      else bulletsPerShot++;
      levelUpBanner = "LEVEL UP!  " + pick.label;
      levelUpTimer = 2.5;
    }
  }

  function applyDamage() {
    if (hurtCd > 0) return;
    player.hp--;
    hurtCd = HURT_CD;
    if (player.hp <= 0) {
      phase = "gameover";
      const sec = elapsed | 0;
      const m = ((sec / 60) | 0).toString().padStart(2, "0");
      const s = (sec % 60).toString().padStart(2, "0");
      showOverlay(
        "GAME OVER",
        `スコア ${score.toLocaleString()}\n生存時間 ${m}:${s}  /  Lv.${level}`,
        true
      );
      startBtn.textContent = "もう一度";
    }
  }

  function update(dt) {
    if (phase !== "playing" || paused) return;
    dt = Math.min(dt, 0.05);
    elapsed += dt;
    fireCd -= dt;
    hurtCd -= dt;
    if (levelUpTimer > 0) levelUpTimer -= dt;

    const dx = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
    const dy = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);
    let len = Math.hypot(dx, dy);
    if (len > 0) {
      player.x += (dx / len) * SPEED * moveMult * dt;
      player.y += (dy / len) * SPEED * moveMult * dt;
    }

    const ramp = Math.min(1, elapsed / 60);
    spawnCd -= dt;
    if (spawnCd <= 0) {
      spawnEnemy();
      spawnCd = Math.max(0.05, 0.55 - ramp * 0.45);
    }

    if (fireCd <= 0) {
      shoot();
      fireCd = FIRE_INTERVAL;
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      const ex = player.x - e.x;
      const ey = player.y - e.y;
      const d = Math.hypot(ex, ey) || 1;
      e.x += (ex / d) * ENEMY_SPEED * (1 + ramp * 0.5) * dt;
      e.y += (ey / d) * ENEMY_SPEED * (1 + ramp * 0.5) * dt;
      if (d <= PLAYER_R + ENEMY_R) applyDamage();
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) { bullets.splice(i, 1); continue; }
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (Math.hypot(b.x - e.x, b.y - e.y) <= BULLET_R + ENEMY_R) {
          e.hp -= attackPower;
          bullets.splice(i, 1);
          if (e.hp <= 0) killEnemy(e, j);
          break;
        }
      }
    }

    for (let i = gems.length - 1; i >= 0; i--) {
      const g = gems[i];
      const gx = player.x - g.x;
      const gy = player.y - g.y;
      const gd = Math.hypot(gx, gy);
      if (gd <= GEM_RANGE && gd > 0.001) {
        g.x += (gx / gd) * GEM_SPEED * dt;
        g.y += (gy / gd) * GEM_SPEED * dt;
      }
      if (gd <= PLAYER_R + g.r + 2) {
        gems.splice(i, 1);
        gainXp(1);
      }
    }
  }

  function worldToScreen(wx, wy) {
    return [W / 2 + wx, H / 2 + wy];
  }

  function drawGrid(camX, camY) {
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    const grid = 48;
    const ox = (-camX % grid + grid) % grid;
    const oy = (-camY % grid + grid) % grid;
    for (let x = ox; x < W; x += grid) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = oy; y < H; y += grid) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }

  function draw() {
    ctx.fillStyle = "#232326";
    ctx.fillRect(0, 0, W, H);
    drawGrid(player.x, player.y);

    for (const g of gems) {
      const [sx, sy] = worldToScreen(g.x, g.y);
      ctx.fillStyle = "#4696ff";
      ctx.beginPath(); ctx.arc(sx, sy, g.r, 0, Math.PI * 2); ctx.fill();
    }

    for (const b of bullets) {
      const [sx, sy] = worldToScreen(b.x, b.y);
      ctx.fillStyle = "#f5f5f5";
      ctx.beginPath(); ctx.arc(sx, sy, BULLET_R, 0, Math.PI * 2); ctx.fill();
    }

    for (const e of enemies) {
      const [sx, sy] = worldToScreen(e.x, e.y);
      ctx.fillStyle = "#e63c46";
      ctx.beginPath(); ctx.arc(sx, sy, ENEMY_R, 0, Math.PI * 2); ctx.fill();
      const barW = 28;
      const rate = e.hp / e.maxHp;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(sx - barW / 2, sy - ENEMY_R - 10, barW, 4);
      ctx.fillStyle = "#ff7070";
      ctx.fillRect(sx - barW / 2, sy - ENEMY_R - 10, barW * rate, 4);
    }

    const px = W / 2;
    const py = H / 2;
    ctx.fillStyle = "#00dc50";
    ctx.beginPath(); ctx.arc(px, py, PLAYER_R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.stroke();

    const hpW = 42;
    const hpRate = player.hp / player.maxHp;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(px - hpW / 2, py - PLAYER_R - 14, hpW, 6);
    ctx.fillStyle = "#5feb6e";
    ctx.fillRect(px - hpW / 2, py - PLAYER_R - 14, hpW * hpRate, 6);

    drawHud();

    if (paused && phase === "playing") {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff5aa";
      ctx.font = "bold 42px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", W / 2, H / 2);
      ctx.font = "16px Segoe UI, sans-serif";
      ctx.fillStyle = "#e6e6eb";
      ctx.fillText("P または Esc で再開", W / 2, H / 2 + 28);
      ctx.textAlign = "left";
    }

    if (levelUpTimer > 0 && levelUpBanner) {
      const alpha = Math.min(1, levelUpTimer / 2.5);
      ctx.globalAlpha = alpha;
      ctx.font = "bold 32px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      const tw = ctx.measureText(levelUpBanner).width;
      ctx.fillRect(W / 2 - tw / 2 - 20, H * 0.58 - 28, tw + 40, 52);
      ctx.fillStyle = "#fff8a0";
      ctx.fillText(levelUpBanner, W / 2, H * 0.58);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    }
  }

  function drawHud() {
    const sec = elapsed | 0;
    const timeStr = `${((sec / 60) | 0).toString().padStart(2, "0")}:${(sec % 60).toString().padStart(2, "0")}`;
    ctx.font = "13px Segoe UI, sans-serif";
    ctx.fillStyle = "#e6e6eb";
    ctx.fillText(`Lv.${level}  XP ${xp}/${xpNext}  HP ${player.hp}/${player.maxHp}  ATK ${attackPower}  弾 ${bulletsPerShot}`, 16, 24);
    ctx.fillStyle = "#ffc896";
    ctx.fillText(`SCORE ${score.toLocaleString()}`, W - 16 - ctx.measureText(`SCORE ${score.toLocaleString()}`).width, 24);
    ctx.fillStyle = "#c8dcff";
    ctx.fillText(`時間 ${timeStr}`, 16, 44);

    const barX = 16, barY = 52, barW = W - 32, barH = 10;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = "#3caaff";
    ctx.fillRect(barX, barY, barW * Math.min(1, xp / xpNext), barH);
  }

  function loop(t) {
    const dt = lastT ? (t - lastT) / 1000 : 0;
    lastT = t;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  function startPlaying() {
    resetGame();
    phase = "playing";
    hideOverlay();
    canvas.focus();
  }

  startBtn.addEventListener("click", startPlaying);

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "p"].includes(k) || e.key === "Escape") e.preventDefault();
    if (k === "w") keys.w = true;
    if (k === "a") keys.a = true;
    if (k === "s") keys.s = true;
    if (k === "d") keys.d = true;
    if ((k === "p" || e.key === "Escape") && phase === "playing") paused = !paused;
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (k === "w") keys.w = false;
    if (k === "a") keys.a = false;
    if (k === "s") keys.s = false;
    if (k === "d") keys.d = false;
  });

  showOverlay(
    "ヴァンピサバイブ",
    "WASD で移動。弾は自動で回転射撃。\n敵を倒して宝石を集め、レベルアップしよう。",
    true
  );
  startBtn.textContent = "サバイブを始める";
  requestAnimationFrame(loop);
})();
