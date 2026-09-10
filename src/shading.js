/**
 * Shading and insolation.
 *
 * The expensive part of a sun study is asking, for every patch of ground and
 * every minute of the year, whether anything is in the way. Doing that
 * directly is millions of ray tests. Instead we compute each ground cell's
 * horizon profile once: for each compass bearing, the elevation the sun has
 * to clear before that patch is lit. After that, any instant is a lookup -
 * find the bearing, compare elevations - so a full year at ten-minute
 * resolution costs about as much as a single day used to.
 *
 * The profile is also what gives us a sky view factor, which the diffuse
 * component and the melt model both need.
 */

import { sunPosition } from './solar.js';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export const AZIMUTH_BINS = 120; // 3 degrees
const MARCH_STEP = 0.25; // metres
const MARCH_LIMIT = 45; // metres - beyond the lot, nothing we model can shade

/**
 * Horizon profile for one cell: elevation angle, degrees, of the highest
 * obstruction in each azimuth bin. Bin i spans bearings centred on
 * i * 360 / AZIMUTH_BINS in lot-frame degrees measured from +y.
 */
export function horizonProfile(model, cell) {
  const profile = new Float32Array(AZIMUTH_BINS);

  for (let i = 0; i < AZIMUTH_BINS; i++) {
    const theta = (i * 360) / AZIMUTH_BINS;
    const dx = Math.sin(theta * RAD);
    const dy = Math.cos(theta * RAD);
    let worst = 0;

    for (let t = MARCH_STEP; t < MARCH_LIMIT; t += MARCH_STEP) {
      const x = cell.x + dx * t;
      const y = cell.y + dy * t;
      if (x < -2 || x > model.lotWidth + 2 || y < -2 || y > model.lotDepth + 2) break;
      const top = model.obstructionHeight(x, y);
      if (top === null) continue;
      const angle = Math.atan2(top - cell.z, t) * DEG;
      if (angle > worst) worst = angle;
    }
    profile[i] = worst;
  }
  return profile;
}

/** Convert a compass azimuth to the lot-frame bearing the profile is indexed by. */
export function lotBearing(model, azimuthDeg) {
  return ((azimuthDeg - model.axisAzimuthY) % 360 + 360) % 360;
}

/** Is the cell in direct sun, given a profile and a sun position? */
export function isLit(model, profile, azimuthDeg, elevationDeg) {
  if (elevationDeg <= 0) return false;
  const bearing = lotBearing(model, azimuthDeg);
  const f = (bearing / 360) * AZIMUTH_BINS;
  const i0 = Math.floor(f) % AZIMUTH_BINS;
  const i1 = (i0 + 1) % AZIMUTH_BINS;
  const w = f - Math.floor(f);
  const horizon = profile[i0] * (1 - w) + profile[i1] * w;
  return elevationDeg > horizon;
}

/**
 * Sky view factor: the fraction of the hemisphere the cell can see.
 * Uniform-sky weighting, integrated over the azimuth bins.
 */
export function skyViewFactor(profile) {
  let sum = 0;
  for (let i = 0; i < profile.length; i++) {
    const h = Math.max(0, profile[i]) * RAD;
    sum += Math.cos(h) ** 2; // fraction of a vertical slice above the horizon
  }
  return sum / profile.length;
}

// ---------------------------------------------------------------------------
// Clear-sky irradiance
// ---------------------------------------------------------------------------

const SOLAR_CONSTANT = 1367; // W/m^2

/** Earth-sun distance correction for the day of year. */
function eccentricityCorrection(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const doy = (date.getTime() - start) / 86400000 + 1;
  return 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365.25);
}

/**
 * Clear-sky direct normal irradiance, W/m^2.
 *
 * Kasten-Young air mass with a pressure correction for site elevation, and
 * the Meinel broadband transmittance. This is a simple model by design: the
 * absolute level is rescaled later against measured sunshine and radiation,
 * so what matters here is that the shape against solar elevation is right.
 */
export function clearSkyDNI(date, elevationDeg, siteElevationM = 700) {
  if (elevationDeg <= 0) return 0;
  const airMass =
    1 / (Math.sin(elevationDeg * RAD) + 0.50572 * (elevationDeg + 6.07995) ** -1.6364);
  const pressureRatio = Math.exp(-siteElevationM / 8434);
  const m = airMass * pressureRatio;
  return SOLAR_CONSTANT * eccentricityCorrection(date) * 0.7 ** m ** 0.678;
}

/** Clear-sky diffuse on a horizontal surface, W/m^2. Liu-Jordan style estimate. */
export function clearSkyDiffuse(date, elevationDeg, siteElevationM = 700) {
  if (elevationDeg <= 0) return 0;
  const dni = clearSkyDNI(date, elevationDeg, siteElevationM);
  return 0.1 * dni * Math.sin(elevationDeg * RAD);
}

// ---------------------------------------------------------------------------
// Accumulation
// ---------------------------------------------------------------------------

/**
 * Walk a day at a fixed cadence and accumulate, for every cell, the hours of
 * direct sun and the clear-sky direct energy landing on the horizontal.
 *
 * @returns {{sunHours:Float32Array, directWhPerM2:Float32Array, steps:number}}
 */
export function accumulateDay(model, cells, profiles, date, lat, lon, stepMinutes = 10) {
  const n = cells.length;
  const sunHours = new Float32Array(n);
  const directWh = new Float32Array(n);
  const hoursPerStep = stepMinutes / 60;
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

  let steps = 0;
  for (let m = 0; m < 1440; m += stepMinutes) {
    const at = new Date(midnight + m * 60000);
    const p = sunPosition(at, lat, lon);
    if (p.apparentElevation <= 0) continue;
    steps++;

    const dni = clearSkyDNI(at, p.apparentElevation);
    const horizontal = dni * Math.sin(p.apparentElevation * RAD);

    for (let c = 0; c < n; c++) {
      if (isLit(model, profiles[c], p.azimuth, p.apparentElevation)) {
        sunHours[c] += hoursPerStep;
        directWh[c] += horizontal * hoursPerStep;
      }
    }
  }
  return { sunHours, directWhPerM2: directWh, steps };
}

/** Mean of an array over the cell indices belonging to a zone. */
export function zoneMean(values, indices) {
  if (!indices.length) return 0;
  let s = 0;
  for (const i of indices) s += values[i];
  return s / indices.length;
}

/** Indices of cells falling inside a rectangle [x0, y0, x1, y1]. */
export function cellsInRect(cells, rect) {
  const [x0, y0, x1, y1] = rect;
  const out = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1) out.push(i);
  }
  return out;
}
