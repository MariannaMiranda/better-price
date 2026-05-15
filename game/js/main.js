const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

Input.init();

// ─── WORLD ────────────────────────────────────────────────────────────────────

const GY = 760; // ground surface y (world coords)

// Platforms: { x, y, w, h }
const platforms = [
  { x: -300, y: GY,       w: 4600, h: 200 }, // ground
  { x:  120, y: GY - 145, w: 190,  h: 18  },
  { x:   55, y: GY - 290, w: 140,  h: 18  },
  { x:  360, y: GY - 185, w: 215,  h: 18  },
  { x:  605, y: GY - 145, w: 235,  h: 18  },
  { x:  730, y: GY - 295, w: 185,  h: 18  },
  { x:  980, y: GY - 185, w: 165,  h: 18  },
  { x: 1130, y: GY - 345, w: 215,  h: 18  },
  { x: 1390, y: GY - 160, w: 200,  h: 18  },
  { x: 1555, y: GY - 310, w: 170,  h: 18  },
  { x: 1780, y: GY - 200, w: 185,  h: 18  },
  { x: 1900, y: GY - 360, w: 155,  h: 18  },
];

const player = new Player(220, GY);

const cam = { x: 0, y: 0 };

// ─── ATMOSPHERIC PARTICLES ─────────────────────────────────────────────────────

const spores = Array.from({ length: 110 }, () => ({
  x:      Math.random() * 4000,
  y:      GY - Math.random() * 720,
  vy:    -(0.14 + Math.random() * 0.28),
  r:      0.5 + Math.random() * 1.8,
  bright: 0.1 + Math.random() * 0.28,
  hue:    175 + Math.random() * 65,
  phase:  Math.random() * Math.PI * 2,
  speed:  0.5 + Math.random() * 0.8,
}));

// ─── BACKGROUND GEOMETRY (pre-generated) ──────────────────────────────────────

const stalactitesFar = Array.from({ length: 38 }, () => ({
  x: Math.random() * 4200,
  h: 25 + Math.random() * 80,
  w: 8  + Math.random() * 22,
}));
const stalactitesNear = Array.from({ length: 22 }, () => ({
  x: Math.random() * 4200,
  h: 35 + Math.random() * 100,
  w: 12 + Math.random() * 28,
}));
const bgColumns = Array.from({ length: 18 }, () => ({
  x: Math.random() * 4200,
  h: 60 + Math.random() * 140,
  w: 16 + Math.random() * 24,
}));
const bgGlows = Array.from({ length: 9 }, () => ({
  x:     Math.random() * 4200,
  y:     GY - 80 - Math.random() * 320,
  r:     45  + Math.random() * 90,
  hue:   185 + Math.random() * 55,
  alpha: 0.04 + Math.random() * 0.05,
}));

// Ground cracks (decorative lines on floor surface)
const cracks = Array.from({ length: 30 }, () => ({
  x: Math.random() * 4000,
  len: 18 + Math.random() * 45,
  angle: (Math.random() - 0.5) * 0.6,
}));

// ─── UPDATE HELPERS ────────────────────────────────────────────────────────────

function updateCamera() {
  const tx = player.x - W * 0.36;
  const ty = player.y - H * 0.64;
  cam.x += (tx - cam.x) * 0.1;
  cam.y += (ty - cam.y) * 0.1;
  cam.x = Math.max(0, Math.min(cam.x, 3100));
  cam.y = Math.min(0, cam.y);
}

function updateSpores(dt) {
  const now = performance.now() * 0.0007;
  for (const s of spores) {
    s.y += s.vy;
    s.x += Math.sin(s.phase + now * s.speed) * 0.28;
    s.phase += dt * 0.7;
    if (s.y < -40) { s.y = GY + 20; s.x = Math.random() * 4000; }
  }
}

// ─── DRAW BACKGROUND ───────────────────────────────────────────────────────────

function drawBg() {
  // Deep cave gradient
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0,   '#010207');
  sky.addColorStop(0.5, '#02040c');
  sky.addColorStop(1,   '#040810');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Distant soft glows (very slow parallax 0.04)
  for (const g of bgGlows) {
    const gx = ((g.x - cam.x * 0.04) % (W + 500) + W + 500) % (W + 500) - 50;
    const gy = g.y - cam.y * 0.04 + 100;
    if (gx < -g.r || gx > W + g.r) continue;
    const rg = ctx.createRadialGradient(gx, gy, 0, gx, gy, g.r);
    rg.addColorStop(0, `hsla(${g.hue},55%,55%,${g.alpha})`);
    rg.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(gx, gy, g.r, 0, Math.PI * 2);
    ctx.fillStyle = rg;
    ctx.fill();
  }

  // Spores (parallax 0.18)
  for (const s of spores) {
    const sx = s.x - cam.x * 0.18;
    const sy = s.y - cam.y * 0.18;
    if (sx < -8 || sx > W + 8 || sy < -8 || sy > H + 8) continue;
    ctx.beginPath();
    ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${s.hue},68%,72%,${s.bright})`;
    ctx.fill();
  }

  // Far stalactites (parallax 0.22)
  ctx.save();
  for (const s of stalactitesFar) {
    const sx = s.x - cam.x * 0.22;
    if (sx < -60 || sx > W + 60) continue;
    ctx.beginPath();
    ctx.moveTo(sx - s.w / 2, 0);
    ctx.lineTo(sx + s.w / 2, 0);
    ctx.lineTo(sx, s.h);
    ctx.fillStyle = 'rgba(2,4,10,0.72)';
    ctx.fill();
  }
  ctx.restore();

  // Mid columns (parallax 0.38)
  ctx.save();
  for (const c of bgColumns) {
    const cx = c.x - cam.x * 0.38;
    if (cx < -50 || cx > W + 50) continue;
    const cy = GY - cam.y * 0.38;
    ctx.fillStyle = 'rgba(3,6,14,0.68)';
    ctx.fillRect(cx - c.w / 2, cy - c.h, c.w, c.h);
  }
  ctx.restore();

  // Near stalactites (parallax 0.58)
  ctx.save();
  for (const s of stalactitesNear) {
    const sx = s.x - cam.x * 0.58;
    if (sx < -70 || sx > W + 70) continue;
    ctx.beginPath();
    ctx.moveTo(sx - s.w / 2, 0);
    ctx.lineTo(sx + s.w / 2, 0);
    ctx.lineTo(sx, s.h);
    ctx.fillStyle = 'rgba(1,3,8,0.88)';
    ctx.fill();
  }
  ctx.restore();
}

// ─── DRAW PLATFORMS ───────────────────────────────────────────────────────────

function drawPlatforms() {
  for (const p of platforms) {
    const px = p.x - cam.x;
    const py = p.y - cam.y;
    if (px + p.w < -30 || px > W + 30) continue;

    if (p.h > 50) {
      // Ground floor
      const gr = ctx.createLinearGradient(px, py, px, py + p.h);
      gr.addColorStop(0,    '#141828');
      gr.addColorStop(0.12, '#0e1320');
      gr.addColorStop(1,    '#060910');
      ctx.fillStyle = gr;
      ctx.fillRect(px, py, p.w, p.h);

      // Top surface glow line
      const eg = ctx.createLinearGradient(px, py, px + p.w, py);
      eg.addColorStop(0,   'rgba(38,68,155,0)');
      eg.addColorStop(0.3, 'rgba(38,68,155,0.38)');
      eg.addColorStop(0.7, 'rgba(38,68,155,0.38)');
      eg.addColorStop(1,   'rgba(38,68,155,0)');
      ctx.fillStyle = eg;
      ctx.fillRect(px, py, p.w, 2);

      // Crack decorations
      for (const c of cracks) {
        const cx = c.x - cam.x;
        if (cx < px || cx > px + p.w) continue;
        const cy = py + 4;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(c.angle);
        ctx.beginPath();
        ctx.moveTo(-c.len / 2, 0);
        ctx.lineTo(c.len / 2,  0);
        ctx.strokeStyle = 'rgba(0,0,0,0.32)';
        ctx.lineWidth   = 1;
        ctx.stroke();
        ctx.restore();
      }

      // Faint mist at surface
      const mist = ctx.createLinearGradient(px, py, px, py + 28);
      mist.addColorStop(0, 'rgba(28,55,140,0.07)');
      mist.addColorStop(1, 'transparent');
      ctx.fillStyle = mist;
      ctx.fillRect(px, py, p.w, 28);

    } else {
      // Floating platform
      const pr = ctx.createLinearGradient(px, py, px, py + p.h);
      pr.addColorStop(0, '#1a2240');
      pr.addColorStop(1, '#0d1224');
      ctx.fillStyle = pr;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(px, py, p.w, p.h, 4);
      } else {
        ctx.rect(px, py, p.w, p.h);
      }
      ctx.fill();

      // Top glow
      const tg = ctx.createLinearGradient(px, py, px + p.w, py);
      tg.addColorStop(0,   'rgba(48,88,210,0)');
      tg.addColorStop(0.5, 'rgba(48,88,210,0.32)');
      tg.addColorStop(1,   'rgba(48,88,210,0)');
      ctx.fillStyle = tg;
      ctx.fillRect(px, py, p.w, 2);

      // Soft underside shadow
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(px + 3, py + p.h, p.w - 6, 4);

      // Corner edge highlight
      ctx.strokeStyle = 'rgba(50,80,180,0.18)';
      ctx.lineWidth   = 1;
      ctx.strokeRect(px, py, p.w, p.h);
    }
  }
}

// ─── HUD: DAISY HEALTH ────────────────────────────────────────────────────────

function drawHUD() {
  // Daisy health — petals represent health points
  ctx.save();
  ctx.translate(30, 32);
  _drawHealthDaisy(ctx, player.health, player.maxHealth);
  ctx.restore();

  // Dash readiness ring (small, below health)
  ctx.save();
  ctx.translate(30, 62);
  if (player.dashCoolT > 0) {
    const ratio = player.dashCoolT / player.DASHCD;
    ctx.beginPath();
    ctx.arc(0, 0, 7, -Math.PI / 2, -Math.PI / 2 + (1 - ratio) * Math.PI * 2);
    ctx.strokeStyle = 'rgba(100,155,255,0.55)';
    ctx.lineWidth   = 2;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(80,130,220,0.3)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
  }
  ctx.restore();

  // Controls hint
  ctx.fillStyle  = 'rgba(40,58,100,0.55)';
  ctx.font       = '10px monospace';
  ctx.textAlign  = 'center';
  ctx.fillText('← → / A D  move  ·  Space jump  ·  Shift dash  ·  Z attack', W / 2, H - 10);
}

function _drawHealthDaisy(ctx, health, maxHealth) {
  // Draw a daisy whose petal count matches current health.
  // Empty petal slots appear as faint outlines.
  const r = 15;
  for (let i = 0; i < maxHealth; i++) {
    const a    = (i / maxHealth) * Math.PI * 2 - Math.PI / 2;
    const full = i < health;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * r, Math.sin(a) * r, 5.5, 3.5, a, 0, Math.PI * 2);
    if (full) {
      ctx.fillStyle   = '#eceae2';
      ctx.fill();
      ctx.strokeStyle = 'rgba(160,155,140,0.55)';
      ctx.lineWidth   = 0.7;
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(70,75,100,0.32)';
      ctx.lineWidth   = 0.8;
      ctx.stroke();
    }
  }
  // Center
  const cg = ctx.createRadialGradient(-1, -1, 0, 0, 0, 7);
  cg.addColorStop(0, '#e8b828');
  cg.addColorStop(1, '#9a7010');
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fillStyle = cg;
  ctx.fill();
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────

let lastT = 0;

function loop(ts) {
  const dt = Math.min((ts - lastT) / 1000, 0.05);
  lastT = ts;

  player.update(dt, platforms);
  updateCamera();
  updateSpores(dt);

  ctx.clearRect(0, 0, W, H);
  drawBg();
  drawPlatforms();
  player.draw(ctx, cam.x, cam.y);
  drawHUD();

  Input.flush();
  requestAnimationFrame(loop);
}

requestAnimationFrame(ts => { lastT = ts; requestAnimationFrame(loop); });
