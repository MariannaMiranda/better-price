class Player {
  constructor(x, y) {
    this.x = x; // center x
    this.y = y; // feet y (bottom)
    this.vx = 0;
    this.vy = 0;

    // Hitbox half-width and full height
    this.hw = 13;
    this.hh = 88;

    // Physics tuning
    this.WALK    = 215;
    this.JUMP    = -565;
    this.GRAV    = 1400;
    this.CUTGRAV = 3400; // gravity when jump released early
    this.MAXFALL = 710;
    this.DASH    = 520;
    this.DASHLEN = 0.12;
    this.DASHCD  = 0.42;
    this.ATTACKDUR = 0.28;

    // State
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

    // Animation clock
    this.t = 0;

    // Blink
    this.blinking  = false;
    this.blinkT    = 0;
    this.nextBlink = 2 + Math.random() * 3;

    // Dash afterimages
    this.ghosts = [];

    // Stats
    this.health    = 5;
    this.maxHealth = 5;
  }

  get left()   { return this.x - this.hw; }
  get right()  { return this.x + this.hw; }
  get top()    { return this.y - this.hh; }
  get bottom() { return this.y; }

  // ─── UPDATE ──────────────────────────────

  update(dt, platforms) {
    this.t      += dt;
    this.stateT += dt;

    // Blink timer
    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && !this.blinking) {
      this.blinking  = true;
      this.blinkT    = 0.1;
      this.nextBlink = 2.5 + Math.random() * 3;
    }
    if (this.blinking) {
      this.blinkT -= dt;
      if (this.blinkT <= 0) this.blinking = false;
    }

    this.dashCoolT = Math.max(0, this.dashCoolT - dt);

    // Afterimage trail
    if (this.dashing) {
      this.ghosts.push({ x: this.x, y: this.y, facing: this.facingRight, alpha: 0.4 });
    }
    this.ghosts = this.ghosts
      .map(g => ({ ...g, alpha: g.alpha - dt * 3.2 }))
      .filter(g => g.alpha > 0.02);

    // Dash movement (no input override)
    if (this.dashing) {
      this.dashT -= dt;
      if (this.dashT <= 0) { this.dashing = false; this.vx *= 0.3; }
    } else {
      this._handleInput(dt);
    }

    // Gravity
    if (!this.dashing) {
      let grav = this.GRAV;
      if (!Input.isDown('Space', 'ArrowUp', 'KeyW') && this.vy < 0 && !this.jumpCut) {
        grav = this.CUTGRAV;
        this.jumpCut = true;
      }
      if (Input.isDown('ArrowDown', 'KeyS') && !this.onGround && this.vy > 0) grav *= 1.75;
      this.vy = Math.min(this.vy + grav * dt, this.MAXFALL);
    }

    // Integrate Y, resolve
    this.y += this.vy * dt;
    this.onGround = false;
    for (const p of platforms) this._resolveY(p);

    // Integrate X, resolve
    this.x += this.vx * dt;
    for (const p of platforms) this._resolveX(p);

    // Coyote time
    if (this.onGround) { this.coyoteT = 0.1; this.jumpCut = false; }
    else               { this.coyoteT = Math.max(0, this.coyoteT - dt); }

    // Buffered jump
    this.jumpBufT = Math.max(0, this.jumpBufT - dt);
    if (this.jumpBufT > 0 && this.coyoteT > 0) {
      this.vy       = this.JUMP;
      this.jumpBufT = 0;
      this.coyoteT  = 0;
      this.jumpCut  = false;
    }

    // Attack
    if (this.attacking) { this.attackT -= dt; if (this.attackT <= 0) this.attacking = false; }

    // State machine
    const prev = this.state;
    const s = this.dashing               ? 'dash'   :
              this.attacking             ? 'attack'  :
              !this.onGround && this.vy < -80 ? 'jump'   :
              !this.onGround             ? 'fall'    :
              Math.abs(this.vx) > 18    ? 'run'    : 'idle';
    if (s !== prev) { this.state = s; this.stateT = 0; }
  }

  _handleInput(dt) {
    const L = Input.isDown('ArrowLeft',  'KeyA');
    const R = Input.isDown('ArrowRight', 'KeyD');
    const acc = this.onGround ? 1950 : 1300;
    const dec = this.onGround ? 2700 : 820;

    if (R && !L) { this.vx = Math.min(this.vx + acc * dt, this.WALK); this.facingRight = true; }
    else if (L && !R) { this.vx = Math.max(this.vx - acc * dt, -this.WALK); this.facingRight = false; }
    else {
      const s = Math.sign(this.vx);
      this.vx = s * Math.max(0, Math.abs(this.vx) - dec * dt);
    }

    if (Input.pressed('Space', 'ArrowUp', 'KeyW')) this.jumpBufT = 0.12;

    if (Input.pressed('ShiftLeft', 'ShiftRight') && this.dashCoolT <= 0) {
      this.dashing   = true;
      this.dashT     = this.DASHLEN;
      this.dashCoolT = this.DASHCD;
      this.dashDir   = this.facingRight ? 1 : -1;
      this.vx        = this.dashDir * this.DASH;
      this.vy        = 0;
    }

    if (Input.pressed('KeyZ', 'KeyJ', 'KeyX') && !this.attacking) {
      this.attacking = true;
      this.attackT   = this.ATTACKDUR;
    }
  }

  _resolveY(p) {
    if (this.right <= p.x || this.left >= p.x + p.w) return;
    if (this.bottom <= p.y || this.top >= p.y + p.h) return;
    if (this.vy >= 0) {
      this.y = p.y; this.vy = 0; this.onGround = true;
    } else {
      this.y = p.y + p.h + this.hh; this.vy = 0;
    }
  }

  _resolveX(p) {
    // Skip if player is standing on top of this platform (within 1px)
    if (this.bottom <= p.y + 1) return;
    if (this.top >= p.y + p.h)  return;
    if (this.right <= p.x || this.left >= p.x + p.w) return;
    if (this.vx > 0 && this.left < p.x) {
      this.x = p.x - this.hw; this.vx = 0;
    } else if (this.vx < 0 && this.right > p.x + p.w) {
      this.x = p.x + p.w + this.hw; this.vx = 0;
    }
  }

  // ─── DRAWING ─────────────────────────────

  draw(ctx, camX, camY) {
    const sx = Math.round(this.x - camX);
    const sy = Math.round(this.y - camY);

    // Afterimage ghosts
    for (const g of this.ghosts) {
      ctx.save();
      ctx.globalAlpha = g.alpha;
      ctx.filter = 'blur(2px)';
      this._drawChar(ctx, Math.round(g.x - camX), Math.round(g.y - camY), g.facing, 'dash', 0);
      ctx.filter = 'none';
      ctx.restore();
    }

    this._drawChar(ctx, sx, sy, this.facingRight, this.state, this.stateT);
    if (this.attacking) this._drawSlash(ctx, sx, sy);
  }

  _drawChar(ctx, x, y, right, state, st) {
    ctx.save();
    ctx.translate(x, y);
    if (!right) ctx.scale(-1, 1); // flip for left-facing

    // Idle bob
    const bob = (state === 'idle') ? Math.sin(this.t * 1.55) * 2.5 : 0;
    // Run bob (moves whole character up/down with steps)
    const runBob = (state === 'run') ? Math.abs(Math.sin(this.t * 8.5)) * 3.5 : 0;
    ctx.translate(0, bob + runBob);

    // Squish/stretch
    let sx = 1, sy = 1;
    if      (state === 'jump') { sx = 0.84; sy = 1.16; }
    else if (state === 'fall') { sx = 1.1;  sy = 0.88; }
    else if (state === 'dash') { sx = 1.55; sy = 0.62; }

    // Draw order: flows → legs → neck → head (head always on top)
    ctx.save();
    ctx.scale(sx, sy);
    this._drawFlows(ctx, state);
    ctx.restore();

    if (state !== 'idle') {
      ctx.save();
      ctx.scale(sx, sy);
      this._drawLegs(ctx, state);
      ctx.restore();
    }

    this._drawNeck(ctx);

    ctx.save();
    ctx.translate(0, -68);
    // Head gets less horizontal squish
    ctx.scale(Math.min(sx, 1.06), 1);
    this._drawHead(ctx, state, bob + runBob);
    ctx.restore();

    ctx.restore();
  }

  // ── Flowing body ribbons ──────────────────
  _drawFlows(ctx, state) {
    // Three dark flowing ribbons hanging from hip area.
    // Idle: hang straight down.  Run/dash: trail behind (lean backward).
    let lean = 0;
    if      (state === 'run')    lean = 0.52 + Math.sin(this.t * 8.5) * 0.05;
    else if (state === 'dash')   lean = 0.9;
    else if (state === 'jump')   lean = -0.14;
    else if (state === 'fall')   lean = 0.22;
    else if (state === 'idle')   lean = Math.sin(this.t * 1.5) * 0.035;
    else if (state === 'attack') lean = 0.15;

    ctx.save();
    ctx.translate(0, -52); // hip / flow attachment point

    // Three ribbon flows fanning outward
    const flows = [
      { baseAngle: -0.22, width: 15, len: 66, color: '#0d0d16' },
      { baseAngle:  0,    width: 12, len: 72, color: '#111118' },
      { baseAngle:  0.22, width: 11, len: 60, color: '#0b0b14' },
    ];

    for (const f of flows) {
      const angle = Math.PI / 2 + f.baseAngle + lean; // PI/2 = straight down
      const dx  = Math.cos(angle);
      const dy  = Math.sin(angle);
      const px  = -Math.sin(angle); // perpendicular
      const py  =  Math.cos(angle);
      const hw  = f.width / 2;
      const len = f.len;

      ctx.beginPath();
      // Left edge of ribbon (wide at attachment, taper to point)
      ctx.moveTo(-px * hw * 0.35,  -py * hw * 0.35);
      ctx.bezierCurveTo(
        dx * len * 0.38 - px * hw * 1.05, dy * len * 0.38 - py * hw * 1.05,
        dx * len * 0.75 - px * hw * 0.45, dy * len * 0.75 - py * hw * 0.45,
        dx * len, dy * len
      );
      // Right edge (symmetric)
      ctx.bezierCurveTo(
        dx * len * 0.75 + px * hw * 0.45, dy * len * 0.75 + py * hw * 0.45,
        dx * len * 0.38 + px * hw * 1.05, dy * len * 0.38 + py * hw * 1.05,
        px * hw * 0.35, py * hw * 0.35
      );
      ctx.closePath();
      ctx.fillStyle = f.color;
      ctx.fill();

      // Subtle inner edge highlight for depth
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(
        dx * len * 0.4 + px * hw * 0.3, dy * len * 0.4 + py * hw * 0.3,
        dx * len * 0.7 + px * hw * 0.2, dy * len * 0.7 + py * hw * 0.2,
        dx * len, dy * len
      );
      ctx.strokeStyle = 'rgba(55,55,80,0.22)';
      ctx.lineWidth   = 1;
      ctx.stroke();
    }

    ctx.restore();
  }

  // ── Thin geometric legs ───────────────────
  _drawLegs(ctx, state) {
    const swing = (state === 'run') ? Math.sin(this.t * 8.5) : 0;

    // Front leg
    ctx.save();
    ctx.translate(3, -50);
    ctx.rotate(0.3 + swing * 0.5);
    this._legSegment(ctx);
    ctx.restore();

    // Back leg
    ctx.save();
    ctx.translate(-3, -50);
    ctx.rotate(-0.38 - swing * 0.5);
    this._legSegment(ctx);
    ctx.restore();
  }

  _legSegment(ctx) {
    // Angular two-segment leg: thigh → knee bend → foot
    ctx.beginPath();
    ctx.moveTo(0, 0);       // hip
    ctx.lineTo(4, 25);      // knee
    ctx.lineTo(7, 46);      // foot
    ctx.strokeStyle = '#111118';
    ctx.lineWidth   = 2.8;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();
    // Tiny foot dot
    ctx.beginPath();
    ctx.arc(7.5, 47, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#0e0e16';
    ctx.fill();
  }

  // ── Neck / collar ─────────────────────────
  _drawNeck(ctx) {
    // Small oval collar between head and flows
    ctx.beginPath();
    ctx.ellipse(0, -56, 4.5, 3.5, 0, 0, Math.PI * 2);
    ctx.fillStyle   = '#d8d4c8';
    ctx.fill();
    ctx.strokeStyle = '#262320';
    ctx.lineWidth   = 0.8;
    ctx.stroke();
  }

  // ── Head ─────────────────────────────────
  _drawHead(ctx, state, totalBob) {
    // Drawn in head-local coords; (0,0) = where we translated to (neck level).
    // Head circle center is at (0, -16).

    // Soft outer aura
    const aura = ctx.createRadialGradient(0, -16, 3, 0, -16, 32);
    aura.addColorStop(0, 'rgba(195,190,175,0.05)');
    aura.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(0, -16, 32, 0, Math.PI * 2);
    ctx.fillStyle = aura;
    ctx.fill();

    // Head — large cream circle
    const hg = ctx.createRadialGradient(-5, -23, 2, 0, -16, 21);
    hg.addColorStop(0,   '#eae6da');
    hg.addColorStop(0.6, '#dedad0');
    hg.addColorStop(1,   '#c8c4b8');
    ctx.beginPath();
    ctx.arc(0, -16, 21, 0, Math.PI * 2);
    ctx.fillStyle   = hg;
    ctx.fill();
    ctx.strokeStyle = '#232020';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // ── DAISY — bobs with each step ──
    // Attached to upper-right side of head
    const daisyBob = (state === 'run') ? Math.sin(this.t * 8.5) * 5 : 0;
    ctx.save();
    ctx.translate(16, -30 + daisyBob);
    this._drawDaisy(ctx, 7.5);
    ctx.restore();

    // ── EYES — dark filled, as drawn ──
    const blinkSY = this.blinking ? 0.06 : 1;

    ctx.save();
    ctx.translate(-7.5, -18);
    ctx.scale(1, blinkSY);
    this._drawEye(ctx);
    ctx.restore();

    ctx.save();
    ctx.translate(7.5, -18);
    ctx.scale(1, blinkSY);
    this._drawEye(ctx);
    ctx.restore();

    // Small oval mouth / nose
    if (!this.blinking) {
      ctx.beginPath();
      ctx.ellipse(0, -4, 3, 2.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#2e2c2a';
      ctx.fill();
    }
  }

  _drawEye(ctx) {
    // Outer eye shape (sclera — barely visible, blends with face)
    ctx.beginPath();
    ctx.ellipse(0, 0, 7.5, 9, 0, 0, Math.PI * 2);
    ctx.fillStyle   = '#e0ddd4'; // same tone as face
    ctx.fill();
    ctx.strokeStyle = '#1e1c1a';
    ctx.lineWidth   = 0.9;
    ctx.stroke();

    // Dark iris fills most of eye ("colored in" as described)
    ctx.beginPath();
    ctx.ellipse(0.3, 0.5, 6.5, 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#111118';
    ctx.fill();

    // Primary highlight (top-left gleam)
    ctx.beginPath();
    ctx.ellipse(-2, -2.5, 2.2, 2.8, -0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fill();

    // Secondary small highlight
    ctx.beginPath();
    ctx.arc(2.5, 2, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fill();
  }

  _drawDaisy(ctx, r) {
    // Petals rotate very slowly; the positional bob is handled by the caller
    const baseRot = this.t * 0.12;
    ctx.save();
    ctx.rotate(baseRot);
    const petals = 6;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * r, Math.sin(a) * r, 4, 2.5, a, 0, Math.PI * 2);
      ctx.fillStyle   = '#f0eee8';
      ctx.fill();
      ctx.strokeStyle = '#c0bdb2';
      ctx.lineWidth   = 0.6;
      ctx.stroke();
    }
    ctx.restore();
    // Yellow center
    const cg = ctx.createRadialGradient(-1, -1, 0, 0, 0, r * 0.44);
    cg.addColorStop(0, '#eec030');
    cg.addColorStop(1, '#a87c10');
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.44, 0, Math.PI * 2);
    ctx.fillStyle   = cg;
    ctx.fill();
    ctx.strokeStyle = '#8a6008';
    ctx.lineWidth   = 0.5;
    ctx.stroke();
  }

  // ── Attack slash arc ──────────────────────
  _drawSlash(ctx, x, y) {
    const prog   = 1 - this.attackT / this.ATTACKDUR;
    const startA = -Math.PI * 0.75;
    const endA   = startA + prog * 1.9;
    const alpha  = (1 - prog) * 0.78;
    const r      = 38;

    ctx.save();
    ctx.translate(x, y - 60);
    if (!this.facingRight) ctx.scale(-1, 1);

    ctx.beginPath();
    ctx.arc(0, 0, r, startA, endA);
    ctx.strokeStyle = `rgba(210, 228, 255, ${alpha})`;
    ctx.lineWidth   = 3.5;
    ctx.lineCap     = 'round';
    ctx.stroke();

    // Tip sparkle
    const tx = Math.cos(endA) * r;
    const ty = Math.sin(endA) * r;
    const sg = ctx.createRadialGradient(tx, ty, 0, tx, ty, 18);
    sg.addColorStop(0, `rgba(200, 220, 255, ${alpha * 0.88})`);
    sg.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(tx, ty, 18, 0, Math.PI * 2);
    ctx.fillStyle = sg;
    ctx.fill();

    ctx.restore();
  }
}
