// Boot and the one loop: input is read every frame, the flight advances in fixed
// 1/60 s steps (several in a slow frame, none in a fast one), and the renderer
// paints what is there. The game moves between five screens: title, play,
// paused, crashed and landed.
//
// ?seed=N fixes the valley. ?shot=start|play|approach|end (with &seed=N) stages
// that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { BEST_KEY, STEP, WORLD } from './config.js';
import { createRandom } from './random.js';
import { createTerrain } from './terrain.js';
import { createFlight, EVENT_CRASH, EVENT_FUEL_EMPTY, EVENT_LANDED, EVENT_RING } from './flight.js';
import { ACTION_CAMERA, ACTION_CONFIRM, ACTION_PAUSE, createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_LANDED, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : WORLD.seed;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const terrain = createTerrain(seed);
const flight = createFlight(terrain);
const renderer = createRenderer(canvas, terrain);
const audio = createAudio();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, flight);
  let painted = 0;
  function paint() {
    renderer.draw(flight, scene.screen, scene.best, 'chase', null, 1 / 60);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let mode = 'chase';
  let accumulator = 0;
  let last = performance.now();
  let message = null;
  let messageUntil = 0;
  let fuelWarned = false;

  function announce(text) {
    status.textContent = text;
  }

  function showMessage(text, colour, seconds) {
    message = { text, colour };
    messageUntil = performance.now() + seconds * 1000;
  }

  function startGame() {
    flight.reset();
    fuelWarned = false;
    screen = SCREEN_PLAY;
    announce('Playing. Six rings, then land on runway 27.');
    showMessage('TAKE OFF — FULL THROTTLE, THEN PULL UP GENTLY', '#ffc233', 4);
  }

  function endGame(crashed) {
    screen = crashed ? SCREEN_OVER : SCREEN_LANDED;
    if (flight.state.score > best) {
      best = flight.state.score;
      saveBest(best);
    }
    announce(crashed ? `Crashed. Score ${flight.state.score}. Best ${best}.` : `Landed. Score ${flight.state.score}. Best ${best}.`);
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_CAMERA) {
      mode = mode === 'chase' ? 'cockpit' : 'chase';
      showMessage(mode === 'cockpit' ? 'COCKPIT VIEW' : 'CHASE VIEW', '#eaf6ff', 1.5);
    }
    if (actions & ACTION_CONFIRM && (screen === SCREEN_TITLE || screen === SCREEN_OVER || screen === SCREEN_LANDED)) {
      audio.unlock();
      startGame();
    } else if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY;
      announce('Playing.');
    }
  }

  function step() {
    if (screen !== SCREEN_PLAY) return;
    const events = flight.step(input.control());
    const s = flight.state;
    if (events & EVENT_RING) {
      audio.ring();
      showMessage(`RING ${s.ringsHit}/6 — +${250 + Math.round(150 * (1 - s.lastRingCentre))}`, '#ffc233', 2);
      announce(`Ring ${s.ringsHit} of 6. Score ${s.score}.`);
      if (s.nextRing === 6) showMessage('ALL RINGS — FINAL: LAND ON RUNWAY 27', '#7ee081', 4);
    }
    if (events & EVENT_FUEL_EMPTY) {
      showMessage('OUT OF FUEL — GLIDE TO THE STRIP', '#ff5a4a', 4);
      announce('Out of fuel.');
    }
    if (s.fuel < 20 && s.fuel > 0 && !fuelWarned) {
      fuelWarned = true;
      audio.fuelWarning();
      showMessage('LOW FUEL', '#ff5a4a', 3);
    }
    if (events & EVENT_LANDED) {
      audio.touchdown();
      endGame(false);
    } else if (events & EVENT_CRASH) {
      audio.crash();
      renderer.addShake(14);
      endGame(true);
    }
    audio.update(s.speed, s.throttle, s.flying);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_PLAY) {
      accumulator += dt;
      while (accumulator >= STEP && screen === SCREEN_PLAY) {
        step();
        accumulator -= STEP;
      }
      if (screen !== SCREEN_PLAY) accumulator = 0;
    } else {
      accumulator = 0;
    }
    if (message && now > messageUntil) message = null;
    renderer.draw(flight, screen, best, mode, message, dt);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Skylark Ridge Run. Press Space or click to fly.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
