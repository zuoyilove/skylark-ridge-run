// The flight model: an arcade plane with a stall, a bank-to-turn rule, throttle
// lag, fuel burn and a ground the pilot can hit. No drawing and no browser in
// here — step() takes the pilot's inputs and returns what happened as flags.
import { PLANE, RING_RADIUS, RINGS, RUNWAY, SCORE, STEP } from './config.js';

export const EVENT_RING = 1;
export const EVENT_CRASH = 2;
export const EVENT_LANDED = 4;
export const EVENT_FUEL_EMPTY = 8;
export const EVENT_STALL = 16;

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

export function createFlight(terrain) {
  const state = {
    x: -RUNWAY.length / 2 + 40, // parked on the strip, nose east
    y: RUNWAY.elevation + 1.2,
    z: 0,
    heading: 90 * DEG, // 0 = north (-z), 90 = east (+x)
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    fuel: PLANE.fuel,
    damage: 0,
    score: 0,
    ringsHit: 0,
    nextRing: 0,
    elapsed: 0,
    flying: false,
    landed: false,
    crashed: false,
    stalled: false,
    goAround: false, // autopilot latch: re-approaching after an overshoot
    verticalSpeed: 0,
    distanceFlown: 0,
    lastRingCentre: 1, // 0 = dead centre, 1 = edge
  };

  function reset() {
    state.x = -RUNWAY.length / 2 + 40;
    state.y = RUNWAY.elevation + 1.2;
    state.z = 0;
    state.heading = 90 * DEG;
    state.pitch = 0;
    state.roll = 0;
    state.speed = 0;
    state.throttle = 0;
    state.fuel = PLANE.fuel;
    state.damage = 0;
    state.score = 0;
    state.ringsHit = 0;
    state.nextRing = 0;
    state.elapsed = 0;
    state.flying = false;
    state.landed = false;
    state.crashed = false;
    state.stalled = false;
    state.goAround = false;
    state.verticalSpeed = 0;
    state.distanceFlown = 0;
    state.lastRingCentre = 1;
  }

  // Where the plane is going, as a unit vector, from heading and pitch.
  function forwardVector() {
    const cp = Math.cos(state.pitch);
    return {
      x: Math.sin(state.heading) * cp,
      y: Math.sin(state.pitch),
      z: -Math.cos(state.heading) * cp,
    };
  }

  /**
   * One fixed step. `ctl` is { bank: -1..1, pitch: -1..1, throttle: -1..1 }:
   * bank steers the roll, pitch pulls the nose, throttle moves the lever.
   * Returns event flags.
   */
  function step(ctl) {
    if (state.crashed || state.landed) return 0;
    let events = 0;
    state.elapsed += STEP;

    // Throttle lever moves at a fixed rate; the engine answers with a lag.
    state.throttle = clamp(state.throttle + ctl.throttle * STEP * 0.8, 0, 1);
    const targetSpeed = state.throttle * PLANE.maxSpeed;
    const accel = state.fuel > 0 ? PLANE.accel : 0;
    state.speed += clamp(targetSpeed - state.speed, -accel * STEP * 1.6, accel * STEP);
    if (state.speed < 0) state.speed = 0;

    // Fuel: full throttle burns the tank in about five minutes of flying.
    if (state.fuel > 0 && state.speed > 1) {
      state.fuel = Math.max(0, state.fuel - PLANE.fuelBurn * state.throttle * STEP);
      if (state.fuel === 0) events |= EVENT_FUEL_EMPTY;
    }

    // Roll toward the commanded bank, then turn at a rate the bank earns.
    const wantBank = ctl.bank * PLANE.maxBankDeg * DEG;
    const bankRate = PLANE.bankRate * DEG * STEP;
    state.roll += clamp(wantBank - state.roll, -bankRate, bankRate);
    const turnRate = (PLANE.turnG * Math.tan(state.roll)) / Math.max(state.speed, 12);
    state.heading += turnRate * STEP * (state.speed > 5 ? 1 : 0);

    // Pitch answers the stick, but a slow wing stalls: the nose drops instead.
    const stalled = state.speed < PLANE.stallSpeed && state.y > terrain.groundHeight(state.x, state.z) + 6;
    state.stalled = stalled;
    if (stalled) events |= EVENT_STALL;
    const pitchTarget = stalled ? -14 * DEG : ctl.pitch * 24 * DEG;
    const pitchRate = PLANE.pitchRate * DEG * STEP;
    state.pitch += clamp(pitchTarget - state.pitch, -pitchRate, pitchRate);

    // Climb from pitch and speed; a stalled wing sinks fast.
    const fwd = forwardVector();
    let vy = fwd.y * state.speed * PLANE.climbFactor;
    if (stalled) vy -= 9;
    if (state.speed < 8 && !state.flying) vy = 0; // still on the ground
    const prevY = state.y;
    state.x += fwd.x * state.speed * STEP;
    state.z += fwd.z * state.speed * STEP;
    state.y += vy * STEP;
    state.verticalSpeed = (state.y - prevY) / STEP;
    state.distanceFlown += state.speed * STEP;
    if (state.y > terrain.groundHeight(state.x, state.z) + 4 && state.speed > PLANE.stallSpeed) state.flying = true;

    // Rings: crossing the ring's plane within its radius scores, centred best.
    if (state.nextRing < RINGS.length) {
      const ring = RINGS[state.nextRing];
      const dx = state.x - ring.x;
      const dy = state.y - ring.y;
      const dz = state.z - ring.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < RING_RADIUS) {
        const centre = clamp(dist / RING_RADIUS, 0, 1);
        state.lastRingCentre = centre;
        state.score += SCORE.ring + Math.round(SCORE.ringCentreBonus * (1 - centre));
        state.ringsHit += 1;
        state.nextRing += 1;
        events |= EVENT_RING;
      }
    }

    // Ground contact: on the strip and gentle it is a landing; anywhere else, or
    // hard, it is a crash. Water counts as ground, and it is never gentle.
    const ground = terrain.groundHeight(state.x, state.z);
    if (state.y <= ground + 1.2) {
      state.y = ground + 1.2;
      const onStrip = terrain.onRunway(state.x, state.z);
      const gentle = state.verticalSpeed > -6 && Math.abs(state.roll) < 20 * DEG && Math.abs(state.pitch) < 12 * DEG;
      const slowEnough = state.speed < 46;
      if (state.flying && onStrip && gentle && slowEnough) {
        state.landed = true;
        const centreline = 1 - clamp(Math.abs(state.z) / (RUNWAY.width / 2), 0, 1);
        state.score += SCORE.landing + Math.round(SCORE.smoothLandingBonus * centreline);
        const spare = Math.max(0, SCORE.parSeconds - state.elapsed);
        state.score += Math.round(spare * SCORE.timeBonusPerSecond);
        events |= EVENT_LANDED;
      } else if (state.flying) {
        // Touching down anywhere but a gentle strip landing, while airborne, is a crash.
        state.crashed = true;
        state.damage = 100;
        events |= EVENT_CRASH;
      } else {
        // Still rolling on the ground: only bleed speed when the throttle is closed.
        if (state.throttle < 0.15) state.speed = Math.max(0, state.speed - 22 * STEP);
        state.pitch = 0;
        state.roll *= 0.9;
      }
    }
    // Off the map's edge, turn the pilot back with a gentle wall, not a crash.
    if (Math.abs(state.x) > 2050 || Math.abs(state.z) > 2050) {
      state.heading += Math.PI * STEP * 0.5;
    }
    return events;
  }

  function nextRingTarget() {
    if (state.nextRing < RINGS.length) return RINGS[state.nextRing];
    // After the last ring: the runway threshold, approached from the east.
    return { x: RUNWAY.length / 2 + 500, y: 55, z: 0, final: true };
  }

  function hud() {
    const knots = Math.round(state.speed * 1.94384);
    const feet = Math.round((state.y - RUNWAY.elevation) * 3.28084);
    const headingDeg = Math.round(((state.heading * 180) / Math.PI % 360) + 360) % 360;
    return { knots, feet, headingDeg, verticalSpeedFpm: Math.round(state.verticalSpeed * 196.85) };
  }

  reset();
  return { state, reset, step, forwardVector, nextRingTarget, hud, angleDiff };
}
