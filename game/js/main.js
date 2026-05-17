const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

Input.init();

// ─── WORLD ────────────────────────────────────────────────────────────────────

const GY = 500; // ground surface y in world-space

const platforms = [
  { x: -400, y: GY,       w: 5000, h: 200 }, // ground
  { x:  100, y: GY - 130, w: 185,  h: 18  },
  { x:   40, y: GY - 270, w: 140,  h: 18  },
  { x:  370, y: GY - 175, w: 205,  h: 18  },
  { x:  610, y: GY - 130, w: 225,  h: 18  },
  { x:  740, y: GY - 280, w: 175,  h: 18  },
  { x:  970, y: GY - 175, w: 160,  h: 18  },
  { x: 1110, y: GY - 325, w: 205,  h: 18  },
  { x: 1360, y: GY - 155, w: 195,  h: 18  },
  { x: 1520, y: GY - 300, w: 165,  h: 18  },
  { x: 1750, y: GY - 200, w: 185,  h: 18  },
];

const player = new Player(200, GY);
const cam    = { x: 0, y: 0 };

// ─── CAMERA ───────────────────────────────────────────────────────────────────

function updateCamera() {
  const tx = player.x - W * 0.36;
  const ty = player.y - H * 0.68; // keep player ~68% down the screen
  cam.x += (tx - cam.x) * 0.1;
  cam.y += (ty - cam.y) * 0.1;
  cam.x = Math.max(0, cam.x);
  cam.y = Math.max(0, cam.y); // clamp: never scroll above world top
}

// ─── BACKGROUND ───────────────────────────────────────────────────────────────
// Simple dark underground cave — keeping it clean so character reads clearly

// Pre-generate background rock silhouettes
const bgRocks = Array.from({ length: 14 }, (_, i) => ({
  x: i * 290 + Math.random() * 60,
  w: 40 + Math.random() * 80,
  h: 30 + Math.random() * 70,
}));
const stalactites = Array.from({ length: 28 }, () => ({
  x:   Math.random() * 4500,
  h:   20 + Math.random() * 80,
  w:   8  + Math.random() * 18,
  par: 0.2 + Math.random() * 0.35, // parallax factor
}));

function drawBg() {
  // Deep cave fill
  ctx.fillStyle = '#04060e';
  ctx.fillRect(0, 0, W, H);

  // Subtle distant glow — faint blue-purple atmospheric light
  const glow = ctx.createRadialGradient(W * 0.55, H * 0.38, 0, W * 0.55, H * 0.38, 280);
  glow.addColorStop(0, 'rgba(30,20,70,0.12)');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Background rock silhouettes (parallax)
  for (const r of bgRocks) {
    const rx = (r.x - cam.x * 0.18) % (W + 200);
    ctx.fillStyle = 'rgba(6,9,18,0.8)';
    ctx.beginPath();
    ctx.moveTo(rx, H * 0.55);
    ctx.lineTo(rx - r.w * 0.4, H * 0.55 - r.h);
    ctx.lineTo(rx + r.w * 0.6, H * 0.55 - r.h * 0.7);
    ctx.lineTo(rx + r.w, H * 0.55);
    ctx.fill();
  }

  // Stalactites hanging from ceiling
  for (const s of stalactites) {
    const sx = s.x - cam.x * s.par;
    if (sx < -40 || sx > W + 40) continue;
    ctx.beginPath();
    ctx.moveTo(sx - s.w / 2, 0);
    ctx.lineTo(sx + s.w / 2, 0);
    ctx.lineTo(sx, s.h);
    ctx.fillStyle = `rgba(4,6,14,${0.7 + s.par * 0.4})`;
    ctx.fill();
  }
}

// ─── PLATFORMS ────────────────────────────────────────────────────────────────

function drawPlatforms() {
  for (const p of platforms) {
    const px = p.x - cam.x;
    const py = p.y - cam.y;
    if (px + p.w < -20 || px > W + 20) continue;

    if (p.h > 50) {
      // Ground — dark stone
      const gr = ctx.createLinearGradient(px, py, px, py + 40);
      gr.addColorStop(0,   '#151c30');
      gr.addColorStop(0.15,'#0d1220');
      gr.addColorStop(1,   '#060810');
      ctx.fillStyle = gr;
      ctx.fillRect(px, py, p.w, p.h);

      // Glowing top edge
      const eg = ctx.createLinearGradient(px, py, px + p.w, py);
      eg.addColorStop(0,   'rgba(38,60,150,0)');
      eg.addColorStop(0.35,'rgba(38,60,150,0.38)');
      eg.addColorStop(0.65,'rgba(38,60,150,0.38)');
      eg.addColorStop(1,   'rgba(38,60,150,0)');
      ctx.fillStyle = eg;
      ctx.fillRect(px, py, p.w, 2);

    } else {
      // Floating platform
      ctx.fillStyle = '#18203c';
      if (ctx.roundRect) {
        ctx.beginPath(); ctx.roundRect(px, py, p.w, p.h, 3); ctx.fill();
      } else {
        ctx.fillRect(px, py, p.w, p.h);
      }
      // Top edge glow
      const tg = ctx.createLinearGradient(px, py, px + p.w, py);
      tg.addColorStop(0,   'rgba(45,80,200,0)');
      tg.addColorStop(0.5, 'rgba(45,80,200,0.32)');
      tg.addColorStop(1,   'rgba(45,80,200,0)');
      ctx.fillStyle = tg;
      ctx.fillRect(px, py, p.w, 2);
      // Drop shadow
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(px + 3, py + p.h, p.w - 6, 3);
    }
  }
}

// ─── HUD: DAISY HEALTH ────────────────────────────────────────────────────────

function drawHUD() {
  // Health daisy — grayish-white petals, brown center
  ctx.save();
  ctx.translate(28, 28);
  const r = 13;
  for (let i = 0; i < player.maxHealth; i++) {
    const a    = (i / player.maxHealth) * Math.PI * 2 - Math.PI / 2;
    const full = i < player.health;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * r, Math.sin(a) * r, 5, 3.2, a, 0, Math.PI * 2);
    ctx.fillStyle   = full ? '#cac8c0' : 'transparent';
    ctx.fill();
    ctx.strokeStyle = full ? '#a0a098' : 'rgba(60,65,88,0.32)';
    ctx.lineWidth   = 0.7;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
  ctx.fillStyle = '#7a5030';
  ctx.fill();
  ctx.restore();

  // Dash cooldown ring
  if (player.dashCoolT > 0) {
    const ratio = player.dashCoolT / player.DASHCD;
    ctx.save();
    ctx.translate(28, 58);
    ctx.beginPath();
    ctx.arc(0, 0, 7, -Math.PI / 2, -Math.PI / 2 + (1 - ratio) * Math.PI * 2);
    ctx.strokeStyle = 'rgba(90,140,240,0.55)';
    ctx.lineWidth   = 2;
    ctx.stroke();
    ctx.restore();
  }

  // Controls
  ctx.fillStyle = 'rgba(35,50,90,0.5)';
  ctx.font      = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('← → move  ·  Space jump  ·  Shift dash  ·  Z attack  ·  ↑↓ look', W / 2, H - 10);
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────

let lastT = 0;

function loop(ts) {
  const dt = Math.min((ts - lastT) / 1000, 0.05);
  lastT = ts;

  player.update(dt, platforms);
  updateCamera();

  ctx.clearRect(0, 0, W, H);
  drawBg();
  drawPlatforms();
  player.draw(ctx, cam.x, cam.y);
  drawHUD();

  Input.flush();
  requestAnimationFrame(loop);
}

requestAnimationFrame(ts => { lastT = ts; requestAnimationFrame(loop); });
