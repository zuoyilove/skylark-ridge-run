// Drawing only: a hand-rolled software 3D view in plain Canvas 2D — sky, dawn sun,
// far ridges, a projected terrain mesh, the strip, the rings, the plane in chase
// view, and a lit instrument panel with a HUD. The world state comes in, pixels
// go out; nothing here owns the rules.
import { FONT, PALETTE, RING_RADIUS, RINGS, RUNWAY, WORLD } from './config.js';
import { roadOffsetAt } from './terrain.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_LANDED = 'landed';

const W = 1280;
const H = 720;
const PANEL_H = 148;
const DEG = Math.PI / 180;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createRenderer(canvas, terrain) {
  const ctx = canvas.getContext('2d');
  const focal = (H / 2) / Math.tan((68 * DEG) / 2);
  let shake = 0;
  let time = 0;

  // Fixed cloud puffs, high above the valley, placed once per seed.
  const clouds = [];
  {
    let s = 1234567;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 26; i += 1) {
      clouds.push({ x: (rnd() * 2 - 1) * 2000, y: 380 + rnd() * 160, z: (rnd() * 2 - 1) * 2000, r: 90 + rnd() * 130 });
    }
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
  }
  resize();
  window.addEventListener('resize', resize);

  // --- camera ---------------------------------------------------------------
  // Chase camera: behind and above the plane, looking ahead of it. Returns the
  // basis (right, up, forward) and origin for projection, with roll folded in.
  function cameraBasis(plane, mode) {
    const h = plane.heading;
    const p = plane.pitch * (mode === 'cockpit' ? 1 : 0.45);
    const fwd = { x: Math.sin(h) * Math.cos(p), y: Math.sin(p), z: -Math.cos(h) * Math.cos(p) };
    let right = { x: Math.cos(h), y: 0, z: Math.sin(h) };
    const rl = Math.hypot(right.x, right.z) || 1;
    right = { x: right.x / rl, y: 0, z: right.z / rl };
    // up = right x forward, so the basis stays right-handed at any pitch.
    const up = {
      x: right.y * fwd.z - right.z * fwd.y,
      y: right.z * fwd.x - right.x * fwd.z,
      z: right.x * fwd.y - right.y * fwd.x,
    };
    const roll = mode === 'cockpit' ? plane.roll * 0.55 : plane.roll * 0.3;
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const rightR = { x: right.x * cr + up.x * sr, y: right.y * cr + up.y * sr, z: right.z * cr + up.z * sr };
    const upR = { x: up.x * cr - right.x * sr, y: up.y * cr - right.y * sr, z: up.z * cr - right.z * sr };
    let origin;
    if (mode === 'cockpit') {
      origin = { x: plane.x + fwd.x * 2.2, y: plane.y + 0.9, z: plane.z + fwd.z * 2.2 };
    } else {
      origin = {
        x: plane.x - fwd.x * 26 + 0 * 1 + 0,
        y: plane.y - fwd.y * 26 + 7.5,
        z: plane.z - fwd.z * 26,
      };
    }
    return { right: rightR, up: upR, fwd, origin };
  }

  function makeProjector(cam) {
    return function project(x, y, z) {
      const dx = x - cam.origin.x;
      const dy = y - cam.origin.y;
      const dz = z - cam.origin.z;
      const cx = dx * cam.right.x + dy * cam.right.y + dz * cam.right.z;
      const cy = dx * cam.up.x + dy * cam.up.y + dz * cam.up.z;
      const cz = dx * cam.fwd.x + dy * cam.fwd.y + dz * cam.fwd.z;
      if (cz < 1.5) return null;
      const s = focal / cz;
      return { x: W / 2 + cx * s, y: H / 2 - cy * s, d: cz, s };
    };
  }

  // --- sky ------------------------------------------------------------------
  function drawSky(plane, dt) {
    time += dt;
    const g = ctx.createLinearGradient(0, 0, 0, H - PANEL_H);
    g.addColorStop(0, PALETTE.skyTop);
    g.addColorStop(0.55, PALETTE.skyMid);
    g.addColorStop(1, PALETTE.skyHorizon);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H - PANEL_H);
    // Dawn sun, fixed in the east so it sits over the valley at takeoff, high
    // enough to stay clear of the title text.
    const sunDir = { x: 0.82, y: 0.45, z: -0.48 };
    const h = plane.heading;
    const fwd = { x: Math.sin(h), y: 0, z: -Math.cos(h) };
    const right = { x: Math.cos(h), y: 0, z: Math.sin(h) };
    const sx = sunDir.x * right.x + sunDir.z * right.z;
    const sy = sunDir.y - plane.pitch * 0.4;
    const sz = sunDir.x * fwd.x + sunDir.z * fwd.z;
    if (sz > -0.2) {
      const px = W / 2 + (sx / Math.max(0.35, sz + 0.9)) * 620;
      const py = H * 0.42 - sy * 520;
      const glow = ctx.createRadialGradient(px, py, 4, px, py, 110);
      glow.addColorStop(0, PALETTE.sunGlow);
      glow.addColorStop(1, 'rgba(255,191,105,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(px - 110, py - 110, 220, 220);
      ctx.fillStyle = PALETTE.sun;
      ctx.beginPath();
      ctx.arc(px, py, 22, 0, Math.PI * 2);
      ctx.fill();
    }
    // Far ridge silhouettes, sliding with heading so the horizon never sits still.
    const headingDeg = ((plane.heading * 180) / Math.PI % 360) + 360;
    drawRidge(headingDeg, 0.24, H * 0.52, 46, PALETTE.ridgeFar);
    drawRidge(headingDeg, 0.5, H * 0.58, 30, PALETTE.ridgeNear);
  }

  function drawRidge(headingDeg, parallax, baseY, amp, colour) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(0, H - PANEL_H);
    const off = -headingDeg * parallax * 4;
    for (let x = -40; x <= W + 40; x += 40) {
      const t = (x + off) * 0.011;
      const y = baseY + Math.sin(t * 1.7 + 2.1) * amp + Math.sin(t * 4.3) * amp * 0.4;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W + 40, H - PANEL_H);
    ctx.closePath();
    ctx.fill();
  }

  // --- terrain --------------------------------------------------------------
  // A quad is clipped against the camera's near plane in camera space before
  // it is projected: without the clip, a quad straddling the plane loses two
  // corners, is dropped whole, and leaves a hole in the ground near the camera
  // that the ridge behind it shows through.
  function cameraSpace(cam, x, y, z) {
    const dx = x - cam.origin.x;
    const dy = y - cam.origin.y;
    const dz = z - cam.origin.z;
    return {
      x: dx * cam.right.x + dy * cam.right.y + dz * cam.right.z,
      y: dx * cam.up.x + dy * cam.up.y + dz * cam.up.z,
      z: dx * cam.fwd.x + dy * cam.fwd.y + dz * cam.fwd.z,
    };
  }

  function projectCam(p) {
    if (p.z < 1.5) return null;
    const s = focal / p.z;
    return { x: W / 2 + p.x * s, y: H / 2 - p.y * s, d: p.z, s };
  }

  function clipNear(points) {
    const out = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const aIn = a.z >= 1.5;
      const bIn = b.z >= 1.5;
      if (aIn) out.push(a);
      if (aIn !== bIn) {
        const t = (1.5 - a.z) / (b.z - a.z);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: 1.5 });
      }
    }
    return out;
  }

  function drawTerrain(cam, project, plane) {
    const quads = [];
    const camX = cam.origin.x;
    const camZ = cam.origin.z;
    const half = (WORLD.grid * WORLD.cell) / 2;
    const stepNear = WORLD.cell;
    const stepFar = WORLD.cell * 2;
    const maxD = WORLD.viewDistance;
    const minIx = Math.max(0, Math.floor((camX - maxD + half) / WORLD.cell));
    const maxIx = Math.min(WORLD.grid - 1, Math.ceil((camX + maxD + half) / WORLD.cell));
    const minIz = Math.max(0, Math.floor((camZ - maxD + half) / WORLD.cell));
    const maxIz = Math.min(WORLD.grid - 1, Math.ceil((camZ + maxD + half) / WORLD.cell));
    for (let iz = minIz; iz < maxIz; iz += 1) {
      for (let ix = minIx; ix < maxIx; ix += 1) {
        const cx = ix * WORLD.cell - half + WORLD.cell / 2;
        const cz = iz * WORLD.cell - half + WORLD.cell / 2;
        const dx = cx - camX;
        const dz = cz - camZ;
        const dist = Math.hypot(dx, dz);
        if (dist > maxD) continue;
        // Keep the mesh behind the camera out of the list entirely.
        const fwd = cam.fwd;
        if (dx * fwd.x + dz * fwd.z < -90) continue;
        const step = dist > 620 ? stepFar : stepNear;
        if (step === stepFar && (ix % 2 !== 0 || iz % 2 !== 0)) continue;
        const x0 = ix * WORLD.cell - half;
        const z0 = iz * WORLD.cell - half;
        const x1 = x0 + step;
        const z1 = z0 + step;
        const h00 = terrain.heightAt(x0, z0);
        const h10 = terrain.heightAt(x1, z0);
        const h01 = terrain.heightAt(x0, z1);
        const h11 = terrain.heightAt(x1, z1);
        const corners = clipNear([
          cameraSpace(cam, x0, h00, z0),
          cameraSpace(cam, x1, h10, z0),
          cameraSpace(cam, x1, h11, z1),
          cameraSpace(cam, x0, h01, z1),
        ]);
        if (corners.length < 3) continue;
        const pts = corners.map(projectCam).filter(Boolean);
        if (pts.length < 3) continue;
        const depth = corners.reduce((sum, p) => sum + p.z, 0) / corners.length;
        const slope = Math.max(Math.abs(h10 - h00), Math.abs(h01 - h00), Math.abs(h11 - h00)) / step;
        const colour = terrain.colourFor(cx, cz, (h00 + h10 + h01 + h11) / 4, slope);
        quads.push({ pts, depth, colour });
      }
    }
    quads.sort((a, b) => b.depth - a.depth);
    for (const q of quads) {
      ctx.fillStyle = q.colour;
      ctx.beginPath();
      const pts = q.pts;
      if (pts.length < 3) continue;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fill();
    }
    drawRoadAndStrip(project, cam);
    drawTreesAndHouses(project, cam);
  }

  function drawRoadAndStrip(project, cam) {
    // The valley road, drawn as short ribbons following its curve.
    ctx.fillStyle = PALETTE.road;
    for (let z = -1600; z < 1600; z += 90) {
      const x = roadOffsetAt(z);
      const y = terrain.heightAt(x, z) + 0.4;
      const a = project(x - 6, y, z);
      const b = project(x + 6, y, z + 90);
      const c = project(x - 6, y, z + 90);
      const d = project(x + 6, y, z);
      if (!a || !b || !c || !d) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(d.x, d.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.fill();
    }
    // Runway markings: centreline dashes, threshold bars and edge lights.
    const halfLen = RUNWAY.length / 2;
    ctx.fillStyle = PALETTE.runwayMark;
    for (let x = -halfLen + 30; x < halfLen - 20; x += 42) {
      const y = RUNWAY.elevation + 0.3;
      const a = project(x, y, -2.2);
      const b = project(x + 20, y, -2.2);
      const c = project(x + 20, y, 2.2);
      const d = project(x, y, 2.2);
      if (!a || !b || !c || !d) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fill();
    }
    for (const sx of [-1, 1]) {
      for (let x = -halfLen + 8; x <= halfLen - 8; x += 40) {
        const p = project(x, RUNWAY.elevation + 0.6, sx * (RUNWAY.width / 2 + 2));
        if (!p || p.d > 900) continue;
        const r = clamp(420 / p.d, 1, 5);
        ctx.fillStyle = sx < 0 ? '#ffd27a' : '#7ad7ff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Windsock beside the strip, leaning with the wind.
    const sock = project(-halfLen + 60, RUNWAY.elevation, RUNWAY.width / 2 + 26);
    if (sock && sock.d < 900) {
      const top = project(-halfLen + 60, RUNWAY.elevation + 11, RUNWAY.width / 2 + 26);
      if (top) {
        ctx.strokeStyle = '#d8d8d8';
        ctx.lineWidth = Math.max(1, 300 / sock.d);
        ctx.beginPath();
        ctx.moveTo(sock.x, sock.y);
        ctx.lineTo(top.x, top.y);
        ctx.stroke();
        ctx.fillStyle = '#ff7a3c';
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(top.x + 14 * (300 / sock.d), top.y + 3);
        ctx.lineTo(top.x, top.y + 6);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function drawTreesAndHouses(project, cam) {
    for (const t of terrain.trees) {
      const dx = t.x - cam.origin.x;
      const dz = t.z - cam.origin.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 850 || dist < 8) continue;
      if (dx * cam.fwd.x + dz * cam.fwd.z < 0) continue;
      const p = project(t.x, t.h, t.z);
      if (!p) continue;
      const hPx = (t.s * p.s) / 1.6;
      if (hPx < 2) continue;
      ctx.fillStyle = '#2f6b2e';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - hPx);
      ctx.lineTo(p.x - hPx * 0.42, p.y);
      ctx.lineTo(p.x + hPx * 0.42, p.y);
      ctx.closePath();
      ctx.fill();
    }
    for (const hs of terrain.houses) {
      const base = project(hs.x, terrain.heightAt(hs.x, hs.z), hs.z);
      if (!base || base.d > 900) continue;
      const wPx = (hs.w * base.s) / 1.4;
      const hPx = (hs.h * base.s) / 1.4;
      if (wPx < 3) continue;
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(base.x - wPx / 2, base.y - hPx, wPx, hPx);
      ctx.fillStyle = '#a34a2e';
      ctx.beginPath();
      ctx.moveTo(base.x - wPx / 2 - 2, base.y - hPx);
      ctx.lineTo(base.x, base.y - hPx - hPx * 0.55);
      ctx.lineTo(base.x + wPx / 2 + 2, base.y - hPx);
      ctx.closePath();
      ctx.fill();
    }
  }

  // --- rings ----------------------------------------------------------------
  function drawRings(project, flight, plane) {
    for (let i = 0; i < RINGS.length; i += 1) {
      const ring = RINGS[i];
      if (i < flight.state.nextRing) continue; // passed rings are done
      const isNext = i === flight.state.nextRing;
      const dx = ring.x - plane.x;
      const dy = ring.y - plane.y;
      const dz = ring.z - plane.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 1700) continue;
      // The ring faces the course: its plane is perpendicular to the direction
      // the pilot flies to reach it from the previous waypoint.
      const prev = i === 0 ? { x: -RUNWAY.length / 2, y: 40, z: 0 } : RINGS[i - 1];
      let nx = ring.x - prev.x;
      let ny = ring.y - prev.y;
      let nz = ring.z - prev.z;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      // Two in-plane axes, upright first.
      let ax = -nz;
      let az = nx;
      const al = Math.hypot(ax, az) || 1;
      ax /= al;
      az /= al;
      const bx = ny * az - nz * 0;
      const by = nz * ax - nx * az;
      const bz = nx * 0 - ny * ax;
      const pulse = isNext ? 1 + 0.12 * Math.sin(time * 5) : 1;
      const radius = RING_RADIUS * pulse;
      ctx.lineWidth = clamp(900 / dist, 2.5, 9);
      ctx.strokeStyle = isNext ? PALETTE.ringNext : PALETTE.ringLater;
      ctx.globalAlpha = isNext ? 0.95 : 0.55;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = isNext ? 18 : 8;
      ctx.beginPath();
      let started = false;
      for (let k = 0; k <= 28; k += 1) {
        const a = (k / 28) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const px = ring.x + (ax * ca + bx * sa) * radius;
        const py = ring.y + (0 * ca + by * sa) * radius;
        const pz = ring.z + (az * ca + bz * sa) * radius;
        const p = project(px, py, pz);
        if (!p) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      // Distance tag above the next ring, with a dark outline so it reads
      // against the sky and never hides behind the flight-path marker.
      if (isNext) {
        const top = project(ring.x, ring.y + RING_RADIUS + 26, ring.z);
        if (top && top.d < 1200) {
          ctx.font = `600 ${Math.max(13, Math.min(22, 2600 / top.d))}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(10,14,20,0.8)';
          const label = `${Math.round(dist)} m — RING ${i + 1}/${RINGS.length}`;
          ctx.strokeText(label, top.x, top.y);
          ctx.fillStyle = PALETTE.ringNext;
          ctx.fillText(label, top.x, top.y);
        }
      }
    }
  }

  // --- the plane, chase view --------------------------------------------------
  function drawPlane(flight, mode) {
    if (mode === 'cockpit') return;
    const plane = flight.state;
    const cx = W / 2 + Math.sin(-plane.roll) * 26 - plane.pitch * 60;
    const cy = H * 0.64 - plane.pitch * 260;
    const bank = plane.roll;
    const speedKnots = flight.hud().knots;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(bank * 0.9);
    const S = 0.82; // plane scale: small enough that the ring ahead stays visible
    // Speed streaks at high speed.
    if (speedKnots > 130) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i += 1) {
        const yy = -120 + i * 52 + Math.sin(time * 9 + i) * 8;
        ctx.beginPath();
        ctx.moveTo(-190 - i * 12, yy);
        ctx.lineTo(-260 - i * 12, yy + 6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(190 + i * 12, yy);
        ctx.lineTo(260 + i * 12, yy + 6);
        ctx.stroke();
      }
    }
    // Main wings, seen from behind and slightly above.
    ctx.fillStyle = PALETTE.planeWing;
    ctx.beginPath();
    ctx.moveTo(-150 * S, 6);
    ctx.lineTo(-26 * S, -8);
    ctx.lineTo(-22 * S, 10);
    ctx.lineTo(-120 * S, 22);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(150 * S, 6);
    ctx.lineTo(26 * S, -8);
    ctx.lineTo(22 * S, 10);
    ctx.lineTo(120 * S, 22);
    ctx.closePath();
    ctx.fill();
    // Tailplane and fin.
    ctx.fillStyle = PALETTE.planeTrim;
    ctx.beginPath();
    ctx.moveTo(-58 * S, -26);
    ctx.lineTo(-14 * S, -34);
    ctx.lineTo(-12 * S, -24);
    ctx.lineTo(-44 * S, -18);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(58 * S, -26);
    ctx.lineTo(14 * S, -34);
    ctx.lineTo(12 * S, -24);
    ctx.lineTo(44 * S, -18);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -30);
    ctx.lineTo(10 * S, -66);
    ctx.lineTo(2 * S, -62);
    ctx.lineTo(-4 * S, -28);
    ctx.closePath();
    ctx.fill();
    // Fuselage, tapering away from the camera.
    ctx.fillStyle = PALETTE.planeBody;
    ctx.beginPath();
    ctx.moveTo(-16 * S, 26);
    ctx.lineTo(-13 * S, -34);
    ctx.lineTo(0, -44);
    ctx.lineTo(13 * S, -34);
    ctx.lineTo(16 * S, 26);
    ctx.closePath();
    ctx.fill();
    // Canopy glint and spine stripe.
    ctx.fillStyle = '#bfe8ff';
    ctx.beginPath();
    ctx.ellipse(0, -18, 7 * S, 12 * S, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(-2 * S, -40, 4 * S, 60);
    // Navigation lights: red port, green starboard, white tail strobe.
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath();
    ctx.arc(-148 * S, 8, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#35e065';
    ctx.beginPath();
    ctx.arc(148 * S, 8, 4, 0, Math.PI * 2);
    ctx.fill();
    if (Math.floor(time * 1.4) % 2 === 0) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, -44, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // --- instruments ------------------------------------------------------------
  function drawGauge(cx, cy, r, label, valueText, needleAngle, accent) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = PALETTE.gaugeFace;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PALETTE.panelEdge;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r - 5, -Math.PI * 0.75, -Math.PI * 0.75 + Math.PI * 1.5);
    ctx.stroke();
    // Ticks.
    ctx.strokeStyle = 'rgba(234,246,255,0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i += 1) {
      const a = -Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r - 10), Math.sin(a) * (r - 10));
      ctx.lineTo(Math.cos(a) * (r - 5), Math.sin(a) * (r - 5));
      ctx.stroke();
    }
    // Lit needle.
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(needleAngle) * (r - 12), Math.sin(needleAngle) * (r - 12));
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETTE.hudText;
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.muted;
    ctx.fillText(label, 0, r * 0.52);
    ctx.font = `700 15px ${FONT}`;
    ctx.fillStyle = PALETTE.hudText;
    ctx.fillText(valueText, 0, r * 0.78);
    ctx.restore();
  }

  function drawArtificialHorizon(cx, cy, r, plane) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.rotate(-plane.roll);
    const pitchPx = clamp(plane.pitch / (24 * DEG), -1, 1) * r * 0.9;
    ctx.fillStyle = '#5fa8dd';
    ctx.fillRect(-r, -r + pitchPx, r * 2, r - pitchPx);
    ctx.fillStyle = '#8a6a45';
    ctx.fillRect(-r, pitchPx, r * 2, r - pitchPx + r);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    for (const off of [-0.5, 0, 0.5]) {
      const y = pitchPx + off * r * 0.55;
      ctx.beginPath();
      ctx.moveTo(-r * 0.45, y);
      ctx.lineTo(r * 0.45, y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = PALETTE.panelEdge;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    // Fixed aircraft symbol.
    ctx.strokeStyle = PALETTE.hudAmber;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy);
    ctx.lineTo(cx - 4, cy);
    ctx.moveTo(cx + 4, cy);
    ctx.lineTo(cx + 16, cy);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy + 5);
    ctx.stroke();
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.muted;
    ctx.fillText('ATTITUDE', cx, cy + r + 16);
  }

  function drawPanel(flight, message) {
    const plane = flight.state;
    const hud = flight.hud();
    const y0 = H - PANEL_H;
    const g = ctx.createLinearGradient(0, y0, 0, H);
    g.addColorStop(0, '#1c232e');
    g.addColorStop(1, PALETTE.panel);
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, W, PANEL_H);
    ctx.fillStyle = PALETTE.panelEdge;
    ctx.fillRect(0, y0, W, 2);
    // Rivets along the top edge.
    ctx.fillStyle = '#3a4556';
    for (let x = 20; x < W; x += 60) {
      ctx.beginPath();
      ctx.arc(x, y0 + 10, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    drawArtificialHorizon(92, y0 + 66, 46, plane);
    const speedAngle = -Math.PI * 0.75 + clamp(hud.knots / 200, 0, 1) * Math.PI * 1.5;
    drawGauge(230, y0 + 66, 46, 'AIRSPEED', `${hud.knots} KT`, speedAngle, PALETTE.gaugeLit);
    const altAngle = -Math.PI * 0.75 + clamp((hud.feet % 1000) / 1000, 0, 1) * Math.PI * 1.5;
    drawGauge(352, y0 + 66, 46, 'ALTITUDE', `${hud.feet} FT`, altAngle, PALETTE.gaugeCyan);
    // Compass strip across the middle.
    const cx = 640;
    ctx.save();
    ctx.beginPath();
    ctx.rect(430, y0 + 18, 420, 44);
    ctx.clip();
    ctx.fillStyle = PALETTE.gaugeFace;
    ctx.fillRect(430, y0 + 18, 420, 44);
    const headingDeg = hud.headingDeg;
    for (let d = -60; d <= 60; d += 5) {
      const deg = (headingDeg + d + 360) % 360;
      const x = cx + d * 3.2;
      const major = deg % 30 === 0;
      ctx.strokeStyle = major ? PALETTE.hudText : 'rgba(234,246,255,0.4)';
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y0 + 46);
      ctx.lineTo(x, y0 + (major ? 32 : 40));
      ctx.stroke();
      if (major) {
        const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
        ctx.font = `700 ${deg % 90 === 0 ? 15 : 11}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = deg % 90 === 0 ? PALETTE.hudAmber : PALETTE.hudText;
        ctx.fillText(names[deg] || String(deg).padStart(3, '0'), x, y0 + 30);
      }
    }
    ctx.restore();
    ctx.strokeStyle = PALETTE.hudAmber;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, y0 + 16);
    ctx.lineTo(cx, y0 + 26);
    ctx.stroke();
    ctx.font = `700 15px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.hudText;
    ctx.fillText(`HDG ${String(headingDeg).padStart(3, '0')}°`, cx, y0 + 82);
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = PALETTE.muted;
    ctx.fillText(`VS ${hud.verticalSpeedFpm >= 0 ? '+' : ''}${hud.verticalSpeedFpm} FPM`, cx, y0 + 100);
    // Throttle lever.
    const tx = 920;
    ctx.fillStyle = PALETTE.gaugeFace;
    ctx.fillRect(tx - 14, y0 + 22, 28, 96);
    ctx.strokeStyle = PALETTE.panelEdge;
    ctx.strokeRect(tx - 14, y0 + 22, 28, 96);
    const leverY = y0 + 22 + 96 - plane.throttle * 96;
    ctx.fillStyle = PALETTE.gaugeLit;
    ctx.fillRect(tx - 20, leverY - 4, 40, 8);
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.muted;
    ctx.fillText('THR', tx, y0 + 134);
    ctx.fillStyle = PALETTE.hudText;
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText(`${Math.round(plane.throttle * 100)}%`, tx, y0 + 40);
    // Fuel gauge.
    const fx = 1000;
    const fuelLow = plane.fuel < 20;
    ctx.fillStyle = PALETTE.gaugeFace;
    ctx.fillRect(fx - 12, y0 + 22, 24, 96);
    const fuelH = 96 * clamp(plane.fuel / 100, 0, 1);
    ctx.fillStyle = fuelLow && Math.floor(time * 3) % 2 === 0 ? '#ff5a4a' : PALETTE.gaugeLit;
    ctx.fillRect(fx - 12, y0 + 22 + 96 - fuelH, 24, fuelH);
    ctx.strokeStyle = PALETTE.panelEdge;
    ctx.strokeRect(fx - 12, y0 + 22, 24, 96);
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.muted;
    ctx.fillText('FUEL', fx, y0 + 134);
    ctx.fillStyle = PALETTE.hudText;
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText(`${Math.round(plane.fuel)}`, fx, y0 + 40);
    // Mission block on the right.
    ctx.textAlign = 'left';
    ctx.font = `700 16px ${FONT}`;
    ctx.fillStyle = PALETTE.hudText;
    ctx.fillText(`RINGS ${plane.ringsHit}/${RINGS.length}`, 1080, y0 + 40);
    ctx.font = `600 13px ${FONT}`;
    ctx.fillStyle = PALETTE.muted;
    const mins = Math.floor(plane.elapsed / 60);
    const secs = Math.floor(plane.elapsed % 60);
    ctx.fillText(`TIME ${mins}:${String(secs).padStart(2, '0')}`, 1080, y0 + 62);
    ctx.font = `700 20px ${FONT}`;
    ctx.fillStyle = PALETTE.hudAmber;
    ctx.fillText(`SCORE ${plane.score}`, 1080, y0 + 92);
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = PALETTE.muted;
    ctx.fillText(plane.nextRing < RINGS.length ? 'NEXT: FLY THE GOLD RING' : 'FINAL: LAND ON RUNWAY 27', 1080, y0 + 114);
    if (message) {
      ctx.font = `700 20px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = message.colour || PALETTE.hudAmber;
      ctx.fillText(message.text, W / 2, y0 - 16);
    }
  }

  function drawHudTop(flight) {
    const hud = flight.hud();
    ctx.textAlign = 'left';
    ctx.font = `700 26px ${FONT}`;
    ctx.fillStyle = PALETTE.hudText;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 4;
    ctx.fillText(`SPD ${hud.knots} KT`, 18, 36);
    ctx.textAlign = 'right';
    ctx.fillText(`ALT ${hud.feet.toLocaleString('en-US')} FT`, W - 18, 36);
    ctx.textAlign = 'center';
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText(`HDG ${String(hud.headingDeg).padStart(3, '0')}°`, W / 2, 34);
    ctx.shadowBlur = 0;
    // Centre flight-path marker.
    const plane = flight.state;
    ctx.strokeStyle = 'rgba(234,246,255,0.85)';
    ctx.lineWidth = 2;
    const mx = W / 2 - plane.roll * 40;
    const my = H * 0.44 - plane.pitch * 300;
    ctx.beginPath();
    ctx.arc(mx, my, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mx - 18, my);
    ctx.lineTo(mx - 11, my);
    ctx.moveTo(mx + 11, my);
    ctx.lineTo(mx + 18, my);
    ctx.moveTo(mx, my - 18);
    ctx.lineTo(mx, my - 11);
    ctx.stroke();
  }

  // --- screens ----------------------------------------------------------------
  function drawTitlePanel(best) {
    ctx.fillStyle = 'rgba(10,14,20,0.45)';
    ctx.fillRect(0, 0, W, H - PANEL_H);
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.hudText;
    ctx.font = `800 64px ${FONT}`;
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 10;
    ctx.fillText('SKYLARK RIDGE RUN', W / 2, 150);
    ctx.shadowBlur = 0;
    ctx.font = `600 22px ${FONT}`;
    ctx.fillStyle = PALETTE.hudAmber;
    ctx.fillText('Thread six rings over the valley — then bring her home to runway 27', W / 2, 190);
    ctx.font = `400 17px ${FONT}`;
    ctx.fillStyle = PALETTE.hudText;
    const lines = [
      '← → or A D — bank and turn      ↑ ↓ or W S — pitch      SHIFT / CTRL — throttle',
      'Mouse — steer gently      C — cockpit / chase camera      P — pause',
      'Mind the fuel gauge. Below 90 knots she stalls. A gentle touchdown on the strip scores.',
    ];
    lines.forEach((line, i) => ctx.fillText(line, W / 2, 232 + i * 28));
    if (best > 0) {
      ctx.font = `700 18px ${FONT}`;
      ctx.fillStyle = PALETTE.hudAmber;
      ctx.fillText(`BEST SCORE ${best}`, W / 2, 330);
    }
    ctx.font = `700 24px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    if (Math.floor(time * 1.6) % 2 === 0) ctx.fillText('PRESS SPACE OR CLICK TO FLY', W / 2, 386);
  }

  function drawEndPanel(title, lines, prompt, best) {
    ctx.fillStyle = 'rgba(10,14,20,0.55)';
    ctx.fillRect(0, 0, W, H - PANEL_H);
    const panelW = 640;
    const panelH = 150 + lines.length * 34;
    const x = (W - panelW) / 2;
    const y = (H - PANEL_H - panelH) / 2;
    ctx.fillStyle = 'rgba(20,24,31,0.92)';
    ctx.fillRect(x, y, panelW, panelH);
    ctx.strokeStyle = PALETTE.panelEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, panelW, panelH);
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.hudText;
    ctx.font = `800 40px ${FONT}`;
    ctx.fillText(title, W / 2, y + 62);
    ctx.font = `400 19px ${FONT}`;
    ctx.fillStyle = PALETTE.muted;
    lines.forEach((line, i) => ctx.fillText(line, W / 2, y + 104 + i * 34));
    ctx.font = `700 20px ${FONT}`;
    ctx.fillStyle = PALETTE.hudAmber;
    ctx.fillText(`BEST ${best}`, W / 2, y + panelH - 52);
    if (Math.floor(time * 1.6) % 2 === 0) {
      ctx.font = `700 20px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(prompt, W / 2, y + panelH - 20);
    }
  }

  // --- main draw --------------------------------------------------------------
  function draw(flight, screen, best, mode, message, dt) {
    const plane = flight.state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const ratio = window.devicePixelRatio || 1;
    const scale = Math.min(canvas.width / W, canvas.height / H);
    ctx.setTransform(scale, 0, 0, scale, (canvas.width - W * scale) / 2, (canvas.height - H * scale) / 2);
    if (shake > 0) {
      const s = shake;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
      shake = Math.max(0, shake - dt * 30);
    }
    drawSky(plane, dt);
    const cam = cameraBasis(plane, mode);
    const project = makeProjector(cam);
    // Clouds drift with the heading, drawn in the sky before the terrain.
    for (const c of clouds) {
      const p = project(c.x, c.y, c.z);
      if (!p || p.d > 2400) continue;
      const r = c.r * p.s * 0.9;
      if (r < 4) continue;
      ctx.fillStyle = PALETTE.cloud;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r, r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    drawTerrain(cam, project, plane);
    drawRings(project, flight, plane);
    drawPlane(flight, mode);
    if (mode === 'cockpit') {
      // Canopy frame: dark struts at the screen edges, so the view reads as a cockpit.
      ctx.fillStyle = 'rgba(12,16,22,0.95)';
      ctx.fillRect(0, 0, W, 26);
      ctx.fillRect(0, H - PANEL_H - 26, W, 26);
      ctx.beginPath();
      ctx.moveTo(W * 0.42, 0);
      ctx.lineTo(W * 0.46, H - PANEL_H);
      ctx.lineTo(W * 0.44, H - PANEL_H);
      ctx.lineTo(W * 0.40, 0);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(W * 0.58, 0);
      ctx.lineTo(W * 0.54, H - PANEL_H);
      ctx.lineTo(W * 0.56, H - PANEL_H);
      ctx.lineTo(W * 0.60, 0);
      ctx.closePath();
      ctx.fill();
    }
    drawHudTop(flight);
    drawPanel(flight, message);
    if (screen === SCREEN_TITLE) drawTitlePanel(best);
    else if (screen === SCREEN_PAUSED) {
      drawEndPanel('PAUSED', ['The valley will wait for you.'], 'PRESS P TO RESUME', best);
    } else if (screen === SCREEN_OVER) {
      drawEndPanel(
        'CRASHED',
        [`Rings flown ${plane.ringsHit}/${RINGS.length}`, `Score ${plane.score}`, plane.fuel <= 0 ? 'Out of fuel — she glided as far as she could.' : 'The ridge wins this round.'],
        'PRESS SPACE TO FLY AGAIN',
        best,
      );
    } else if (screen === SCREEN_LANDED) {
      drawEndPanel(
        'LANDED — RIDGE RUN COMPLETE',
        [
          `Rings flown ${plane.ringsHit}/${RINGS.length}`,
          `Landing bonus and time bonus included`,
          `Score ${plane.score}`,
        ],
        'PRESS SPACE TO FLY AGAIN',
        best,
      );
    }
  }

  return {
    draw,
    addShake(amount) {
      shake = Math.max(shake, amount);
    },
  };
}
