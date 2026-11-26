// Keyboard and mouse. Held keys steer; one-shot presses (start, restart, pause,
// camera) queue as flags taken once by the loop. The mouse steers too: hold the
// left button and drag, or just move it — the pointer's offset from centre is a
// gentle stick. A key released while the tab is hidden never sends keyup, so blur
// lets go of everything.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_CAMERA = 4;

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const THROTTLE_UP = new Set(['ShiftLeft', 'ShiftRight', 'KeyE']);
const THROTTLE_DOWN = new Set(['ControlLeft', 'ControlRight', 'KeyQ']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const CAMERA = new Set(['KeyC', 'KeyV']);

export function createInput(canvas) {
  let left = false;
  let right = false;
  let up = false;
  let down = false;
  let throttleUp = false;
  let throttleDown = false;
  let actions = 0;
  // Mouse stick: -1..1 in each axis from the pointer's offset from screen centre.
  let mouseBank = 0;
  let mousePitch = 0;
  let mouseActive = false;

  window.addEventListener('keydown', (event) => {
    if (LEFT.has(event.code)) left = true;
    else if (RIGHT.has(event.code)) right = true;
    else if (UP.has(event.code)) up = true;
    else if (DOWN.has(event.code)) down = true;
    else if (THROTTLE_UP.has(event.code)) throttleUp = true;
    else if (THROTTLE_DOWN.has(event.code)) throttleDown = true;
    else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (CAMERA.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CAMERA;
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (LEFT.has(event.code)) left = false;
    else if (RIGHT.has(event.code)) right = false;
    else if (UP.has(event.code)) up = false;
    else if (DOWN.has(event.code)) down = false;
    else if (THROTTLE_UP.has(event.code)) throttleUp = false;
    else if (THROTTLE_DOWN.has(event.code)) throttleDown = false;
  });
  window.addEventListener('blur', () => {
    left = right = up = down = throttleUp = throttleDown = false;
    mouseActive = false;
    mouseBank = 0;
    mousePitch = 0;
  });
  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    mouseBank = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mousePitch = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    mouseActive = true;
  });
  canvas.addEventListener('pointerdown', (event) => {
    actions |= ACTION_CONFIRM;
    const rect = canvas.getBoundingClientRect();
    mouseBank = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mousePitch = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    mouseActive = true;
  });
  canvas.addEventListener('pointerleave', () => {
    mouseActive = false;
    mouseBank = 0;
    mousePitch = 0;
  });

  return {
    // Steering for this frame: keys win over the mouse, which is a gentle stick.
    control() {
      let bank = (right ? 1 : 0) - (left ? 1 : 0);
      let pitch = (up ? 1 : 0) - (down ? 1 : 0);
      let throttle = (throttleUp ? 1 : 0) - (throttleDown ? 1 : 0);
      if (bank === 0 && mouseActive) bank = Math.max(-1, Math.min(1, mouseBank * 0.9));
      if (pitch === 0 && mouseActive) pitch = Math.max(-1, Math.min(1, -mousePitch * 0.7));
      // No throttle keys held: the lever stays where it is.
      return { bank, pitch, throttle };
    },
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
