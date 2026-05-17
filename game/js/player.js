class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.hw = 12;
    this.hh = 92;

    this.WALK    = 195;
    this.JUMP    = -545;
    this.GRAV    = 1380;
    this.CUTGRAV = 3100;
    this.MAXFALL = 680;
    this.DASH    = 500;
    this.DASHLEN = 0.12;
    this.DASHCD  = 0.42;
    this.ATKSEC  = 0.28;

    this.onGround    = false;
    this.facingRight = true;
    this.coyoteT     = 0;
    this.jumpBufT    = 0;
    this.jumpCut     = false;
    this.dashing     = false;
    this.dashT       = 0;
    this.dashCoolT   = 0;
    this.dashDir     = 1;
    this.attacking   = false;
    this.attackT     = 0;
    this.state       = 'idle';
    this.stateT      = 0;

    this.t         = 0;
    this.walkPhase = 0;
    this.prevWalk  = 0;

    // Daisy spring bob
    this.daisyBob    = 0;
    this.daisyBobVel = 0;

    // Smooth look direction (-1 down, 0 neutral, 1 up)
    this.lookSmooth = 0;

    // Blink
    this.blinking  = false;
    this.blinkT    = 0;
    this.nextBlink = 2.5 + Math.random() * 3;

    this.ghosts = [];
    this.health    = 5;
    this.maxHealth = 5;
  }

  get left()   { return this.x - this.hw; }
  get right()  { return this.x + this.hw; }
  get top()    { return this.y - this.hh; }
  get bottom() { return this.y; }

  update(dt, platforms) {
    this.t      += dt;
    this.stateT += dt;

    // Blink
    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && !this.blinking) {
      this.blinking = true; this.blinkT = 0.1;
      this.nextBlink = 2.5 + Math.random() * 3;
    }
    if (this.blinking) { this.blinkT -= dt; if (this.blinkT <= 0) this.blinking = false; }

    this.dashCoolT = Math.max(0, this.dashCoolT - dt);

    if (this.dashing) {
      this.ghosts.push({ x: this.x, y: this.y, facing: this.facingRight, alpha: 0.38 });
    }
    this.ghosts = this.ghosts.map(g => ({ ...g, alpha: g.alpha - dt * 3.5 })).filter(g => g.alpha > 0.02);

    if (this.dashing) {
      this.dashT -= dt;
      if (this.dashT <= 0) { this.dashing = false; this.vx *= 0.28; }
    } else {
      this._input(dt);
    }

    if (!this.dashing) {
      let grav = this.GRAV;
      if (!Input.isDown('Space','ArrowUp','KeyW') && this.vy < 0 && !this.jumpCut) {
        grav = this.CUTGRAV; this.jumpCut = true;
      }
      if (Input.isDown('ArrowDown','KeyS') && !this.onGround && this.vy > 0) grav *= 1.75;
      this.vy = Math.min(this.vy + grav * dt, this.MAXFALL);
    }

    this.y += this.vy * dt;
    this.onGround = false;
    for (const p of platforms) this._resolveY(p);

    this.x += this.vx * dt;
    for (const p of platforms) this._resolveX(p);

    if (this.onGround) { this.coyoteT = 0.1; this.jumpCut = false; }
    else               { this.coyoteT = Math.max(0, this.coyoteT - dt); }

    this.jumpBufT = Math.max(0, this.jumpBufT - dt);
    if (this.jumpBufT > 0 && this.coyoteT > 0) {
      this.vy = this.JUMP; this.jumpBufT = 0; this.coyoteT = 0; this.jumpCut = false;
    }

    if (this.attacking) { this.attackT -= dt; if (this.attackT <= 0) this.attacking = false; }

    // Walk phase advances with speed
    this.prevWalk = this.walkPhase;
    if (Math.abs(this.vx) > 10 && this.onGround) {
      this.walkPhase = (this.walkPhase + dt * 4.8 * Math.abs(this.vx) / this.WALK) % 1;
    }
    // Footstrike: when phase crosses 0.0 or 0.5
    const pp = this.prevWalk % 0.5, cp = this.walkPhase % 0.5;
    if (cp < pp && Math.abs(this.vx) > 25 && this.onGround) {
      this.daisyBobVel = -15;
    }

    // Daisy spring physics
    this.daisyBobVel += (0 - this.daisyBob) * 240 * dt;
    this.daisyBobVel *= Math.pow(0.04, dt);
    this.daisyBob = Math.max(-11, Math.min(4, this.daisyBob + this.daisyBobVel * dt));

    // Look direction
    const targetLook = Input.isDown('ArrowUp','KeyW') ? 1 : Input.isDown('ArrowDown','KeyS') ? -1 : 0;
    this.lookSmooth += (targetLook - this.lookSmooth) * dt * 9;

    const prev = this.state;
    const s = this.dashing               ? 'dash'   :
              this.attacking             ? 'attack'  :
              !this.onGround && this.vy < -60 ? 'jump' :
              !this.onGround             ? 'fall'    :
              Math.abs(this.vx) > 15    ? 'run'     : 'idle';
    if (s !== prev) { this.state = s; this.stateT = 0; }
  }

  _input(dt) {
    const L = Input.isDown('ArrowLeft','KeyA');
    const R = Input.isDown('ArrowRight','KeyD');
    const acc = this.onGround ? 1900 : 1300;
    const dec = this.onGround ? 2700 : 820;

    if (R && !L)      { this.vx = Math.min(this.vx + acc*dt, this.WALK); this.facingRight = true; }
    else if (L && !R) { this.vx = Math.max(this.vx - acc*dt, -this.WALK); this.facingRight = false; }
    else { const s = Math.sign(this.vx); this.vx = s * Math.max(0, Math.abs(this.vx) - dec*dt); }

    if (Input.pressed('Space','ArrowUp','KeyW')) this.jumpBufT = 0.12;

    if (Input.pressed('ShiftLeft','ShiftRight') && this.dashCoolT <= 0) {
      this.dashing = true; this.dashT = this.DASHLEN; this.dashCoolT = this.DASHCD;
      this.dashDir = this.facingRight ? 1 : -1;
      this.vx = this.dashDir * this.DASH; this.vy = 0;
    }

    if (Input.pressed('KeyZ','KeyJ','KeyX') && !this.attacking) {
      this.attacking = true; this.attackT = this.ATKSEC;
    }
  }

  _resolveY(p) {
    if (this.right <= p.x || this.left >= p.x + p.w) return;
    if (this.bottom <= p.y || this.top >= p.y + p.h) return;
    if (this.vy >= 0) { this.y = p.y; this.vy = 0; this.onGround = true; }
    else { this.y = p.y + p.h + this.hh; this.vy = 0; }
  }

  _resolveX(p) {
    if (this.bottom <= p.y + 1) return;
    if (this.top >= p.y + p.h) return;
    if (this.right <= p.x || this.left >= p.x + p.w) return;
    if (this.vx > 0 && this.left < p.x) { this.x = p.x - this.hw; this.vx = 0; }
    else if (this.vx < 0 && this.right > p.x + p.w) { this.x = p.x + p.w + this.hw; this.vx = 0; }
  }

  // ─── DRAWING ────────────────────────────────────────────────────────────────

  draw(ctx, camX, camY) {
    const sx = Math.round(this.x - camX);
    const sy = Math.round(this.y - camY);

    for (const g of this.ghosts) {
      ctx.save();
      ctx.globalAlpha = g.alpha;
      ctx.filter = 'blur(2px)';
      this._drawChar(ctx, Math.round(g.x - camX), Math.round(g.y - camY), g.facing, 'dash');
      ctx.filter = 'none';
      ctx.restore();
    }

    this._drawChar(ctx, sx, sy, this.facingRight, this.state);
    if (this.attacking) this._drawSlash(ctx, sx, sy);
  }

  _drawChar(ctx, x, y, right, state) {
    ctx.save();
    ctx.translate(x, y);
    if (!right) ctx.scale(-1, 1);
    // NOTE: NO squish/stretch — Hollow Knight style keeps proportions

    // Leg foot positions driven by walk cycle
    let frontFX = 0, backFX = 0;
    if (state === 'run') {
      const swing = Math.sin(this.walkPhase * Math.PI * 2);
      frontFX = swing * 13;
      backFX  = -swing * 10;
    } else if (state === 'jump') {
      frontFX = 9; backFX = -5;
    } else if (state === 'fall') {
      frontFX = 5; backFX = 3;
    } else if (state === 'dash') {
      frontFX = 14; backFX = -5;
    }

    // 1. Cloak (drawn first — behind legs)
    this._drawCloak(ctx, state);

    // 2. Back leg (slightly dimmer, drawn before front)
    this._drawLeg(ctx, -2, -48, backFX,  0, false);
    // 3. Front leg
    this._drawLeg(ctx,  2, -48, frontFX, 0, true);

    // 4. Yellow neck ring
    this._drawCollar(ctx);

    // 5. Head group at head center — translate once, draw head + eye + daisy
    // Head center is at y=-88 in character space; shift slightly with look
    ctx.save();
    ctx.translate(0, -88 - this.lookSmooth * 0.8);
    this._drawHeadCircle(ctx);
    this._drawEye(ctx, this.lookSmooth);
    this._drawDaisy(ctx, this.daisyBob);
    ctx.restore();

    ctx.restore();
  }

  // ── CLOAK: dark purple leaf shapes ──────────────────────────────────────────
  _drawCloak(ctx, state) {
    // Subtle sway only — no dramatic trailing
    const sway = (state === 'run') ? Math.sin(this.walkPhase * Math.PI * 2) * 2 : 0;

    // Left leaf (slightly behind)
    ctx.beginPath();
    ctx.moveTo(-5, -52);
    ctx.bezierCurveTo(-15 + sway * 0.3, -36, -18 + sway * 0.2, -10, -14, 10);
    ctx.bezierCurveTo(-12, 16, -8, 17, -5, 11);
    ctx.bezierCurveTo(-3,  4,  -5, -20, -5, -52);
    ctx.fillStyle   = '#231640';
    ctx.fill();
    ctx.strokeStyle = '#180e2e';
    ctx.lineWidth   = 0.8;
    ctx.stroke();

    // Right leaf (front)
    ctx.beginPath();
    ctx.moveTo(5, -52);
    ctx.bezierCurveTo(15 - sway * 0.3, -36, 18 - sway * 0.2, -10, 14, 10);
    ctx.bezierCurveTo(12, 16, 8, 17, 5, 11);
    ctx.bezierCurveTo(3,  4,  5, -20, 5, -52);
    ctx.fillStyle   = '#2d1f4a';
    ctx.fill();
    ctx.strokeStyle = '#180e2e';
    ctx.lineWidth   = 0.8;
    ctx.stroke();

    // Narrow center seam (leaf vein / depth layer)
    ctx.beginPath();
    ctx.moveTo(-2, -52);
    ctx.bezierCurveTo(-3, -30, -3, -8, -2, 10);
    ctx.bezierCurveTo(-1, 15, 1, 15, 2, 10);
    ctx.bezierCurveTo(3, -8, 3, -30, 2, -52);
    ctx.fillStyle = '#1d1038';
    ctx.fill();
  }

  // ── LEGS: black, angular two-segment ────────────────────────────────────────
  _drawLeg(ctx, hipX, hipY, footX, footY, isFront) {
    // Knee sits between hip and foot, offset forward for natural bend
    const midX = (hipX + footX) / 2;
    const midY = (hipY + footY) / 2;
    const bendDir = (footX >= 0) ? 1 : -1;
    const kneeX = midX + bendDir * 7;
    const kneeY = midY - 5;

    const col  = isFront ? '#0e0e14' : '#090910';
    const thk  = isFront ? 3.8 : 3.0;

    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    // Thigh
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(kneeX, kneeY);
    ctx.strokeStyle = col;
    ctx.lineWidth   = thk;
    ctx.stroke();

    // Shin
    ctx.beginPath();
    ctx.moveTo(kneeX, kneeY);
    ctx.lineTo(footX, footY);
    ctx.strokeStyle = col;
    ctx.lineWidth   = thk - 1;
    ctx.stroke();

    // Foot nub
    ctx.beginPath();
    ctx.arc(footX, footY, isFront ? 2.4 : 1.8, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  }

  // ── COLLAR: yellow ring ──────────────────────────────────────────────────────
  _drawCollar(ctx) {
    // Thin neck
    ctx.fillStyle = '#e8e5de';
    ctx.fillRect(-2.5, -68, 5, 6);

    // Yellow ring
    ctx.beginPath();
    ctx.ellipse(0, -64, 6.5, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle   = '#d4a820';
    ctx.fill();
    ctx.strokeStyle = '#8a6810';
    ctx.lineWidth   = 0.8;
    ctx.stroke();
  }

  // ── HEAD: white circle ───────────────────────────────────────────────────────
  // ctx is already translated to head center (0,0)
  _drawHeadCircle(ctx) {
    const hg = ctx.createRadialGradient(-5, -5, 1, 0, 0, 22);
    hg.addColorStop(0,   '#fafaf8');
    hg.addColorStop(0.65,'#f2efea');
    hg.addColorStop(1,   '#e2deda');

    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fillStyle   = hg;
    ctx.fill();
    ctx.strokeStyle = '#1c1a1a';
    ctx.lineWidth   = 1;
    ctx.stroke();
  }

  // ── EYE: milky-gray gradient, shifts with look direction ────────────────────
  // ctx is at head center (0,0); look: 1=up, -1=down
  _drawEye(ctx, look) {
    // Eye sits on the front-right quadrant of the head
    // look shifts it vertically: up=negative y in canvas
    const eyeX = 9;
    const eyeY = -look * 5; // look=1 → eye at y=-5 (upward)

    ctx.save();
    ctx.translate(eyeX, eyeY);
    ctx.scale(1, this.blinking ? 0.06 : 1);

    // Milky gray gradient — lighter center, darker rim
    const eg = ctx.createRadialGradient(-2, -3, 1, 0, 0, 13);
    eg.addColorStop(0,   '#cacacf');
    eg.addColorStop(0.45,'#9898a5');
    eg.addColorStop(1,   '#585865');

    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 16, 0, 0, Math.PI * 2);
    ctx.fillStyle   = eg;
    ctx.fill();
    ctx.strokeStyle = '#161618';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // White highlight gleam
    if (!this.blinking) {
      ctx.beginPath();
      ctx.ellipse(-3.5, -4.5, 3, 4, -0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(3.5, 3.5, 1.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fill();
    }

    ctx.restore();
  }

  // ── DAISY: brown center, grayish-white petals, bobs on footstrike ────────────
  // ctx is at head center (0,0); bobY is spring displacement (negative = up)
  _drawDaisy(ctx, bobY) {
    ctx.save();
    // Upper-right edge of head. bobY negative = moves upward (spring kick on step)
    ctx.translate(13, -19 + bobY);
    ctx.rotate(this.t * 0.09); // very slow spin

    const petals = 6, r = 7.5;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * r, Math.sin(a) * r, 4, 2.6, a, 0, Math.PI * 2);
      ctx.fillStyle   = '#ceccc4'; // grayish-white
      ctx.fill();
      ctx.strokeStyle = '#a8a5a0';
      ctx.lineWidth   = 0.5;
      ctx.stroke();
    }

    // Brown center
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.44, 0, Math.PI * 2);
    ctx.fillStyle   = '#7a5030';
    ctx.fill();
    ctx.strokeStyle = '#523218';
    ctx.lineWidth   = 0.5;
    ctx.stroke();

    ctx.restore();
  }

  // ── ATTACK SLASH ────────────────────────────────────────────────────────────
  _drawSlash(ctx, x, y) {
    const prog  = 1 - this.attackT / this.ATKSEC;
    const alpha = (1 - prog) * 0.75;
    const r     = 38;
    const sa    = -Math.PI * 0.75;
    const ea    = sa + prog * 1.9;

    ctx.save();
    ctx.translate(x, y - 65);
    if (!this.facingRight) ctx.scale(-1, 1);

    ctx.beginPath();
    ctx.arc(0, 0, r, sa, ea);
    ctx.strokeStyle = `rgba(210,228,255,${alpha})`;
    ctx.lineWidth   = 3.5;
    ctx.lineCap     = 'round';
    ctx.stroke();

    const tx = Math.cos(ea) * r, ty = Math.sin(ea) * r;
    const sg = ctx.createRadialGradient(tx, ty, 0, tx, ty, 18);
    sg.addColorStop(0, `rgba(200,220,255,${alpha * 0.9})`);
    sg.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(tx, ty, 18, 0, Math.PI * 2);
    ctx.fillStyle = sg;
    ctx.fill();

    ctx.restore();
  }
}
