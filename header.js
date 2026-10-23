/* Shared decorative header: a slice of the game's Forest stage where five Borbs play tag through the trunk and rock
   gaps. Everything loads from header-art/ next to this script; nothing leaves the page's own site. Decorative only
   (aria-hidden), paused while the tab is hidden, and a still scene with prefers-reduced-motion. */
(() => {
  const base = new URL('header-art/', document.currentScript.src);
  const band = document.querySelector('.band');
  if (!band) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'forest';
  canvas.setAttribute('aria-hidden', 'true');
  band.prepend(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  const SKINS = ['default', 'pigeon', 'wizard', 'pompom', 'cyber']; // Kula stays a secret
  const OVERLAP = 48;          // the page's content panel covers the band's bottom this far
  const GROUND = 24;           // visible grass and dirt above that
  const SIGN_CLEARANCE = 112;  // the title sign sits above this line; Borbs fly below it
  const CHASE_SPEED = 64;      // px/s: "it" closing in on its target
  const FLEE_SPEED = 34;       // px/s: the target scooting away
  const HOME_SPEED = 18;       // px/s: everyone else drifting back to their spot
  const CATCH_DISTANCE = 22;
  const TAG_PAUSE = 1.4;       // seconds the new "it" waits before chasing (no tag-backs)
  // px/s of leftward screen speed that turns a Borb to face left: above the drift home, so only chasing and fleeing
  // turn it around (drifting left while the forest scrolls by still reads as flying right).
  const FACE_TURN = HOME_SPEED + 4;

  const images = {};
  const names = SKINS.flatMap(s => ['idle', 'flap', 'fall'].map(p => `borb_${s}_${p}`))
    .concat(['trunk_top', 'rock_bottom', 'sky', 'far', 'mid', 'ground', 'star']);

  let width = 0, height = 0, time = 0, last = 0, frame = 0;
  let it = 0, target = -1, pause = TAG_PAUSE, burst = null;
  // taggedAt: when each Borb was last caught (or started as "it"); the chase goes to whoever has waited longest.
  const birds = SKINS.map((skin, i) => ({ skin, x: 0, home: 0, y: 0, vy: 0, i, taggedAt: -i, left: false }));
  let taggedBy = -1; // the Borb that just tagged "it": no tag-backs

  // Layout for the current size: the pairs of obstacles (spacing, column width, gap), the flight band and Borb size.
  function layout() {
    const phone = width < 600;
    const groundY = height - OVERLAP - GROUND;
    const top = SIGN_CLEARANCE;
    const play = groundY - top;
    return {
      phone, groundY, top, play,
      spacing: phone ? Math.max(170, width / 2.1) : Math.min(300, Math.max(220, width / 5)),
      column: phone ? 40 : 52,
      gap: play * (phone ? 0.5 : 0.42),
      size: phone ? 36 : 44,
      scroll: (phone ? 24 : 36) * time,
    };
  }

  // Gap centre of pair n: steady pseudo-random heights within the flight band, like the game's spawner.
  function gapCentre(n, L) {
    const r = Math.sin(n * 12.9898 + 4.1) * 43758.5453;
    const t = r - Math.floor(r);
    const low = L.top + L.gap / 2, high = L.groundY - L.gap / 2;
    // Biased upward: the trunks already reach down from behind the title sign, so higher gaps keep the rocks tall.
    return low + (high - low) * (0.05 + 0.6 * t);
  }

  // The height a Borb flies at, world x: level through each gap (pair n stands at world x (n + 0.5) * spacing), easing
  // to the next gap in the open stretch between. The level part covers the column plus the Borb's width.
  function laneY(worldX, L) {
    const u = worldX / L.spacing - 0.5;
    const n = Math.floor(u), t = u - n;
    const level = Math.min(0.35, (L.column / 2 + L.size / 2 + 6) / L.spacing);
    const ease = t < level ? 0 : t > 1 - level ? 1 : (1 - Math.cos((t - level) / (1 - 2 * level) * Math.PI)) / 2;
    return gapCentre(n, L) + (gapCentre(n + 1, L) - gapCentre(n, L)) * ease;
  }

  function resize() {
    width = band.clientWidth; height = band.clientHeight;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const spread = Math.min(width * 0.7, 520), left = (width - spread) / 2;
    birds.forEach((b, i) => { b.home = left + spread * (i / (SKINS.length - 1)); if (!b.x) b.x = b.home; });
    draw();
  }

  function image(name) {
    const img = images[name];
    return img && img.complete && img.naturalWidth ? img : null;
  }

  function sprite(name, x, y, w, h, flip = false) {
    const img = image(name);
    if (!img) return;
    if (!flip) { ctx.drawImage(img, x - w / 2, y - h / 2, w, h); return; }
    ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore();
  }

  // A column sprite at its natural proportions, cropped to the height shown: trunks keep their bottom end (roots),
  // rocks their jagged top. If more height is needed than the sprite has, it stretches.
  function column(name, x, yTop, w, h, keepBottom) {
    const img = image(name);
    if (!img || h <= 0) return;
    const scale = w / img.naturalWidth;
    const srcH = Math.min(img.naturalHeight, h / scale);
    const srcY = keepBottom ? img.naturalHeight - srcH : 0;
    ctx.drawImage(img, 0, srcY, img.naturalWidth, srcH, x - w / 2, yTop, w, h);
  }

  // A horizontally tiling backdrop strip, its bottom at y, scrolled by offset.
  function strip(name, bottom, h, offset) {
    const img = image(name);
    if (!img) return;
    const w = img.naturalWidth * h / img.naturalHeight;
    for (let x = -((offset % w) + w) % w; x < width; x += w) ctx.drawImage(img, x, bottom - h, w + 1, h);
  }

  function draw() {
    const L = layout();
    ctx.clearRect(0, 0, width, height);
    strip('sky', L.groundY, L.groundY + 40, L.scroll * 0.05);
    strip('far', L.groundY - 10, Math.min(150, L.play * 0.75), L.scroll * 0.2);
    strip('mid', L.groundY + 6, Math.min(78, L.play * 0.4), L.scroll * 0.45);

    // Trunk and rock pairs with a gap between, scrolling with the ground.
    const first = Math.floor(L.scroll / L.spacing) - 1;
    for (let n = first; n * L.spacing - L.scroll < width + L.spacing; n++) {
      const x = (n + 0.5) * L.spacing - L.scroll;
      const centre = gapCentre(n, L);
      column('trunk_top', x, 0, L.column, centre - L.gap / 2, true);
      column('rock_bottom', x, centre + L.gap / 2, L.column, L.groundY + 4 - (centre + L.gap / 2), false);
    }
    strip('ground', height, height - L.groundY, L.scroll);

    birds.forEach(b => {
      const pose = reduced.matches ? 'idle' : b.vy < -25 ? 'flap' : b.vy > 25 ? 'fall' : 'idle';
      sprite(`borb_${b.skin}_${pose}`, b.x, b.y, L.size, L.size, b.left);
    });

    // The "IT!" bubble over whoever is it.
    const chaser = birds[it];
    const by = chaser.y - L.size * 0.85 + (reduced.matches ? 0 : Math.sin(time * 6) * 2);
    ctx.fillStyle = '#FFC93C'; ctx.strokeStyle = '#3B2A1A'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.roundRect(chaser.x - 17, by - 12, 34, 21, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3B2A1A'; ctx.font = '700 13px Fredoka, system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.textBaseline = 'middle'; ctx.fillText('IT!', chaser.x, by - 1);

    if (burst) {
      ctx.globalAlpha = Math.max(0, 1 - burst.age);
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3 + burst.age;
        const d = 10 + burst.age * 34;
        sprite('star', burst.x + Math.cos(a) * d, burst.y + Math.sin(a) * d, 14, 14);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Who "it" goes after: never the Borb that just tagged it, and otherwise whoever has gone longest without being
  // caught, so everyone takes a turn (picking the nearest made the two neighbours tag each other forever).
  // A coin flip between the two longest-waiting keeps the order from repeating.
  function nextTarget(from) {
    const waiting = birds.filter((b, i) => i !== from && i !== taggedBy).sort((a, b) => a.taggedAt - b.taggedAt);
    return waiting[Math.random() < 0.5 || waiting.length < 2 ? 0 : 1].i;
  }

  function update(dt) {
    time += dt;
    const L = layout();
    pause -= dt;
    if (pause <= 0 && target < 0) target = nextTarget(it);
    const chaser = birds[it], prey = target >= 0 ? birds[target] : null;
    const margin = L.size;
    birds.forEach((b, i) => {
      let v = (b.home - b.x) * 0.8;                       // drift home
      v = Math.max(-HOME_SPEED, Math.min(HOME_SPEED, v));
      if (i === it && prey) v = Math.sign(prey.x - b.x) * CHASE_SPEED;
      else if (i === target) {
        const away = Math.sign(b.x - chaser.x) || 1;
        if (Math.abs(b.x - chaser.x) < 140) v = away * FLEE_SPEED;
      }
      const before = b.x;
      b.x = Math.max(margin, Math.min(width - margin, b.x + v * dt));
      // Face left only while chasing or fleeing to the left; otherwise face right, the way the flock travels through
      // the scrolling forest. Chase and flee speeds sit well above FACE_TURN and the drift home below it: no flicker.
      if (dt) b.left = (b.x - before) / dt < -FACE_TURN;
      // Fly the lane through the gaps, with a little flap-and-fall bob of its own.
      const bob = Math.sin(time * 5.5 + i * 1.7);
      const y = laneY(b.x + L.scroll, L) + bob * 5;
      b.vy = dt ? (y - b.y) / dt : 0;
      b.y = y;
    });
    if (prey && Math.hypot(chaser.x - prey.x, chaser.y - prey.y) < CATCH_DISTANCE) {
      burst = { x: (chaser.x + prey.x) / 2, y: (chaser.y + prey.y) / 2, age: 0 };
      taggedBy = it; it = target; target = -1; pause = TAG_PAUSE;
      birds[it].taggedAt = time;
    }
    if (burst && (burst.age += dt) > 1) burst = null;
  }

  function tick(stamp) {
    if (document.hidden || reduced.matches) { last = 0; draw(); return; }
    const dt = last ? Math.min((stamp - last) / 1000, 0.05) : 0;
    last = stamp; update(dt); draw(); frame = requestAnimationFrame(tick);
  }

  function motion() {
    cancelAnimationFrame(frame); last = 0;
    if (!document.hidden && !reduced.matches) frame = requestAnimationFrame(tick);
    else { update(0); draw(); }
  }

  Promise.all(names.map(name => new Promise(resolve => {
    const img = new Image(); images[name] = img;
    img.onload = img.onerror = resolve; img.src = new URL(`${name}.png`, base).href;
  }))).then(() => { resize(); update(0); motion(); });
  new ResizeObserver(resize).observe(band);
  document.addEventListener('visibilitychange', motion);
  reduced.addEventListener('change', motion);
})();
