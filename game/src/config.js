// Skylark Ridge Run — every tuning number and colour in one place.
// The world is metres; the sky is a dawn valley ringed by mountains, with one
// grass strip (runway 09/27) at its heart and six glowing rings to thread.
export const WORLD = {
  cell: 50, // terrain mesh cell, metres
  grid: 84, // cells across the square heightfield (4200 m a side)
  viewDistance: 1500, // metres of terrain drawn ahead of the camera
  lakeLevel: 6, // terrain at or below this in the lake bowl is water
  seed: 20261126,
};

export const RUNWAY = {
  // Centred on the origin, running east-west. Heading 090 on takeoff, 270 to land.
  x: 0,
  z: 0,
  length: 620,
  width: 34,
  headingDeg: 90,
  elevation: 0,
};

export const PLANE = {
  maxSpeed: 92, // m/s at full throttle, level flight
  cruiseSpeed: 58,
  stallSpeed: 27, // below this the nose drops and the wing stops answering
  accel: 14, // m/s^2 toward the throttle's target speed
  climbFactor: 0.9,
  maxBankDeg: 62,
  bankRate: 95, // deg/s of bank the pilot can command
  pitchRate: 42, // deg/s
  turnG: 9.81,
  fuel: 100, // units; full throttle burns about 0.35/s
  fuelBurn: 0.35,
  damageOnCrash: 100,
};

export const RINGS = [
  { x: 520, y: 118, z: -760 },
  { x: 1150, y: 175, z: -260 },
  { x: 880, y: 215, z: 620 },
  { x: -40, y: 165, z: 1180 },
  { x: -860, y: 205, z: 640 },
  { x: -560, y: 135, z: -430 },
];
export const RING_RADIUS = 26;

export const SCORE = {
  ring: 250,
  ringCentreBonus: 150, // scaled by how close to the middle the pass is
  landing: 1000,
  smoothLandingBonus: 400, // gentle touchdown on the centreline
  timeBonusPerSecond: 4, // leftover time under the 300 s par, at landing
  parSeconds: 300,
};

export const PALETTE = {
  skyTop: '#2e5d8f',
  skyMid: '#7fb2d9',
  skyHorizon: '#ffd9a0',
  sun: '#fff3c4',
  sunGlow: '#ffbf69',
  cloud: 'rgba(255,255,255,0.85)',
  ridgeFar: '#7d8fb0',
  ridgeNear: '#5d6f8e',
  grass: '#5f9e4d',
  grassDry: '#8aa653',
  fieldA: '#6fae54',
  fieldB: '#a8b45a',
  fieldC: '#7fae6a',
  rock: '#8a7a68',
  snow: '#eef3f6',
  water: '#3f7fb8',
  waterDeep: '#2c5f8f',
  road: '#4a4a52',
  runway: '#33343a',
  runwayMark: '#f2f2e8',
  ringNext: '#ffc233',
  ringLater: '#37c8e8',
  ringPassed: '#7ee081',
  panel: '#14181f',
  panelEdge: '#2b3442',
  gaugeFace: '#0d1420',
  gaugeLit: '#ffb347',
  gaugeCyan: '#57d6ff',
  hudText: '#eaf6ff',
  hudAmber: '#ffc233',
  planeBody: '#e8542f',
  planeWing: '#f2f2f2',
  planeTrim: '#1c4d7a',
  text: '#eef1f5',
  muted: '#9aa7b8',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const STEP = 1 / 60;
export const BEST_KEY = 'skylark-ridge-run.best';
