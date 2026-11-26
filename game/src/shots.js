// The screenshot scenes behind ?shot=start|play|approach|end. Each one plays the
// real rules forward from a fresh flight for a fixed time, steered by a simple
// autopilot (head for the next waypoint, hold a target height, keep the throttle
// open), so the frame is what a real sortie looks like and the same seed always
// gives the same frame.
import { RINGS, STEP } from './config.js';
import { EVENT_CRASH, EVENT_LANDED } from './flight.js';
import { SCREEN_LANDED, SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const DEG = Math.PI / 180;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Steer toward `target` at `alt` metres, following the approach line into it:
// the pilot chases a carrot on the line from `prev` to the target, 400 m ahead
// of the plane's own projection on that line, so the plane settles onto the
// approach and flies straight through instead of circling the target. If the
// plane overshoots the target without reaching it, the carrot drops back to
// 400 m before the target and the plane flies a go-around. Returns the control
// for one fixed step.
function autopilot(flight, target, alt, prev, lead) {
  const s = flight.state;
  const px = prev ? prev.x : -310;
  const py = prev ? prev.y : 40;
  const pz = prev ? prev.z : 0;
  let ax = target.x - px;
  let ay = target.y - py;
  let az = target.z - pz;
  const ringDist = Math.hypot(ax, ay, az) || 1;
  ax /= ringDist;
  ay /= ringDist;
  az /= ringDist;
  // Along-track distance of the plane from `prev`, measured on the approach line.
  const along = (s.x - px) * ax + (s.y - py) * ay + (s.z - pz) * az;
  // Latched go-around: once the plane overshoots the target, stay on the
  // re-approach until it is back 350 m before the target; without the latch the
  // carrot flips back and forth and the plane orbits instead of re-entering.
  if (!s.goAround && along > ringDist + 120) s.goAround = true;
  if (s.goAround && along < ringDist - 350) s.goAround = false;
  let carrot = s.goAround ? Math.max(0, ringDist - 400) : along + 400;
  carrot = clamp(carrot, 0, ringDist + (lead ?? 350));
  let aimX = px + ax * carrot;
  let aimZ = pz + az * carrot;
  const dist = Math.hypot(target.x - s.x, target.y - s.y, target.z - s.z);
  // Close in, aim straight at the target: a carrot past it would cut the
  // corner and carry the plane wide of the ring by the last hundred metres.
  if (dist < 450 && !s.goAround) {
    aimX = target.x;
    aimZ = target.z;
  }
  const wantHeading = Math.atan2(aimX - s.x, -(aimZ - s.z));
  const headingErr = angleDiff(wantHeading, s.heading);
  const bank = clamp(headingErr * 1.6, -1, 1);
  const heightErr = alt - s.y;
  const pitch = clamp(heightErr * 0.02, -0.7, 0.7);
  // Ease off near the target so the turn stays tight enough to thread it.
  const wantSpeed = dist < 500 ? 48 : 66;
  const throttle = s.speed < wantSpeed - 3 ? 1 : s.speed > wantSpeed + 3 ? -1 : 0.2;
  return { bank, pitch, throttle };
}

function flyFor(flight, seconds, steer) {
  const steps = Math.round(seconds / STEP);
  let events = 0;
  for (let i = 0; i < steps; i += 1) {
    events |= flight.step(steer(flight));
    if (events & (EVENT_CRASH | EVENT_LANDED)) break;
  }
  return events;
}

/**
 * Set `flight` to the named scene and return the screen to draw over it and the
 * best score to show. Unknown names stage the title scene.
 */
export function stageShot(name, flight) {
  flight.reset();
  const s = flight.state;
  if (name === 'start') {
    // Parked on the strip at dawn, engine idling, title over the scene.
    s.throttle = 0.25;
    s.speed = 0;
    return { screen: SCREEN_TITLE, best: 0 };
  }
  if (name === 'play') {
    // Take off, climb out and thread the first rings, as a pilot would.
    flyFor(flight, 14, (f) => autopilot(f, { x: 400, y: 90, z: -400 }, 95, { x: -310, y: 40, z: 0 }, 350));
    flyFor(flight, 26, (f) => {
      const target = f.nextRingTarget();
      const i = f.state.nextRing;
      const prev = i === 0 ? { x: -310, y: 40, z: 0 } : RINGS[i - 1];
      return autopilot(f, target, target.y + 6, prev, 350);
    });
    return { screen: SCREEN_PLAY, best: flight.state.score };
  }
  if (name === 'approach') {
    // Skip the rings: place the plane on a long final for runway 27, low over
    // the fields, the strip ahead and the panel lit. The autopilot holds a
    // gentle glideslope (about 2 degrees) so the frame stays in the air.
    s.x = 1150;
    s.y = 62;
    s.z = 4;
    s.heading = 270 * DEG;
    s.pitch = -4 * DEG;
    s.roll = 0;
    s.speed = 52;
    s.throttle = 0.42;
    s.fuel = 61;
    s.flying = true;
    s.ringsHit = 6;
    s.nextRing = 6;
    s.score = 1875;
    flyFor(flight, 9, (f) => {
      const dist = Math.hypot(f.state.x, f.state.z);
      const alt = 12 + dist * 0.035;
      return autopilot(f, { x: 0, y: 12, z: 0 }, alt, { x: 1150, y: 62, z: 4 }, 400);
    });
    return { screen: SCREEN_PLAY, best: 1875 };
  }
  if (name === 'end') {
    // A finished run: landed on the strip, score tallied, panel up.
    s.x = 60;
    s.y = 1.2;
    s.z = -2;
    s.heading = 270 * DEG;
    s.speed = 0;
    s.throttle = 0;
    s.fuel = 34;
    s.flying = true;
    s.landed = true;
    s.ringsHit = 6;
    s.nextRing = 6;
    s.elapsed = 214;
    s.score = 3250;
    return { screen: SCREEN_LANDED, best: 3250 };
  }
  return { screen: SCREEN_TITLE, best: 0 };
}
