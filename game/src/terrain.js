// The valley: a seeded heightfield with a flat grass strip, a lake bowl, a winding
// river, patchwork fields and scattered trees and houses. All terrain queries are
// pure functions of (x, z), so the flight model, the renderer and the screenshots
// always agree about the ground.
import { PALETTE, RUNWAY, WORLD } from './config.js';
import { createRandom, makeNoise } from './random.js';

const HALF = (WORLD.grid * WORLD.cell) / 2;

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function createTerrain(seed) {
  const noise = makeNoise(seed);
  const rand = createRandom(seed ^ 0x5f3a);
  const gridN = WORLD.grid + 1;
  const heights = new Float32Array(gridN * gridN);

  // Analytic height: rolling octaves, a mountain bowl toward the edges, a flat
  // valley floor along the strip, and a scooped lake bowl to the south-west.
  function rawHeight(x, z) {
    const r = Math.hypot(x, z) / HALF; // 0 at the strip, 1 at the map edge
    let h = 0;
    h += 26 * noise(x * 0.0016 + 7.3, z * 0.0016 - 2.1);
    h += 12 * noise(x * 0.004 + 1.7, z * 0.004 + 8.4);
    h += 5 * noise(x * 0.011 - 4.2, z * 0.011 + 3.9);
    h += 150 * Math.pow(Math.max(0, r - 0.45) / 0.55, 2.1); // rim mountains
    h += 60 * Math.pow(Math.max(0, r - 0.3) / 0.7, 2) * (0.5 + 0.5 * noise(x * 0.003 + 9, z * 0.003));
    // Valley floor: flatten near the runway and along the river line.
    const nearStrip = Math.exp(-((Math.abs(z) / 420) ** 2)) * Math.exp(-((Math.abs(x) / 1500) ** 2));
    h = h * (1 - 0.92 * nearStrip) + 2 * nearStrip;
    // Lake bowl south-west: a dip that fills with water.
    const dl = Math.hypot(x + 950, z - 780);
    const bowl = Math.exp(-((dl / 420) ** 2));
    h = h * (1 - bowl) + (WORLD.lakeLevel - 9) * bowl;
    // A river valley carving from the north hills down to the lake.
    const riverX = 420 * Math.sin(z * 0.0011) + 150 * Math.sin(z * 0.0031 + 2);
    const dr = Math.abs(x - riverX);
    const carve = Math.exp(-((dr / 130) ** 2)) * (z > -400 && z < 900 ? 1 : 0.4);
    h -= 7 * carve;
    return h;
  }

  for (let iz = 0; iz < gridN; iz += 1) {
    for (let ix = 0; ix < gridN; ix += 1) {
      const x = ix * WORLD.cell - HALF;
      const z = iz * WORLD.cell - HALF;
      heights[iz * gridN + ix] = rawHeight(x, z);
    }
  }

  function heightAt(x, z) {
    const gx = (x + HALF) / WORLD.cell;
    const gz = (z + HALF) / WORLD.cell;
    const ix = Math.max(0, Math.min(WORLD.grid - 1, Math.floor(gx)));
    const iz = Math.max(0, Math.min(WORLD.grid - 1, Math.floor(gz)));
    const fx = Math.max(0, Math.min(1, gx - ix));
    const fz = Math.max(0, Math.min(1, gz - iz));
    const a = heights[iz * gridN + ix];
    const b = heights[iz * gridN + ix + 1];
    const c = heights[(iz + 1) * gridN + ix];
    const d = heights[(iz + 1) * gridN + ix + 1];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }

  function onRunway(x, z) {
    return Math.abs(x - RUNWAY.x) < RUNWAY.length / 2 + 30 && Math.abs(z - RUNWAY.z) < RUNWAY.width / 2 + 30;
  }

  // Ground height the plane can hit: the strip itself is flat at its elevation.
  function groundHeight(x, z) {
    if (onRunway(x, z)) return RUNWAY.elevation;
    return heightAt(x, z);
  }

  // Patchwork fields: a stable hash per cell decides its crop colour.
  function fieldShade(ix, iz) {
    const h = Math.abs(Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453) % 1;
    if (h < 0.34) return PALETTE.fieldA;
    if (h < 0.62) return PALETTE.fieldB;
    return PALETTE.fieldC;
  }

  function colourFor(x, z, h, slope) {
    if (onRunway(x, z)) return PALETTE.runway;
    const dl = Math.hypot(x + 950, z - 780);
    if (dl < 380 && h <= WORLD.lakeLevel + 0.5) return h < WORLD.lakeLevel - 3 ? PALETTE.waterDeep : PALETTE.water;
    const riverX = 420 * Math.sin(z * 0.0011) + 150 * Math.sin(z * 0.0031 + 2);
    if (Math.abs(x - riverX) < 16 && z > -400 && z < 900 && h < 12) return PALETTE.water;
    if (h > 150) return PALETTE.snow;
    if (h > 95 || slope > 0.55) return PALETTE.rock;
    if (h < 26 && Math.abs(z) < 700) {
      const ix = Math.floor((x + HALF) / (WORLD.cell * 2));
      const iz = Math.floor((z + HALF) / (WORLD.cell * 2));
      return fieldShade(ix, iz);
    }
    return h > 55 ? PALETTE.grassDry : PALETTE.grass;
  }

  // Trees on low grass, houses near the strip's eastern end. Positions are fixed
  // per seed so every run and every screenshot shows the same valley.
  const trees = [];
  for (let i = 0; i < 900; i += 1) {
    const x = (rand() * 2 - 1) * (HALF - 150);
    const z = (rand() * 2 - 1) * (HALF - 150);
    const h = heightAt(x, z);
    if (h > 8 && h < 70 && !onRunway(x, z) && Math.hypot(x + 950, z - 780) > 420) {
      trees.push({ x, z, h, s: 7 + rand() * 9 });
    }
  }
  const houses = [
    { x: 380, z: 90, w: 26, d: 18, h: 9 },
    { x: 430, z: -70, w: 22, d: 16, h: 8 },
    { x: -420, z: 110, w: 24, d: 18, h: 9 },
    { x: -470, z: -90, w: 20, d: 15, h: 7 },
    { x: 120, z: 260, w: 24, d: 16, h: 8 },
  ];

  return { heights, gridN, heightAt, groundHeight, onRunway, colourFor, trees, houses };
}

// The road the valley follows: a dark ribbon the pilot can use as a visual
// reference, drawn by the renderer where it crosses a terrain quad.
export function roadOffsetAt(z) {
  return 420 * Math.sin(z * 0.0011) + 150 * Math.sin(z * 0.0031 + 2) + 260;
}
