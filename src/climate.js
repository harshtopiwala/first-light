/**
 * Daily weather for the site.
 *
 * Primary source is the Open-Meteo historical archive, which serves ERA5
 * reanalysis back to 1940, needs no API key, and sends CORS headers, so the
 * browser can call it directly. Nothing is bundled and nothing goes stale.
 *
 * The melt model needs only three things per day: mean temperature, the
 * daily range, and precipitation. Everything else it derives from the
 * shading model.
 */

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';

/**
 * Fetch a daily series.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {string} startDate  ISO date, e.g. '2015-01-01'
 * @param {string} endDate
 * @returns {Promise<{source:string, days:Array<{date:string, tMean:number,
 *          tMax:number, tMin:number, precipMm:number}>}>}
 */
export async function fetchDaily(latitude, longitude, startDate, endDate) {
  const url =
    `${ARCHIVE}?latitude=${latitude}&longitude=${longitude}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum,shortwave_radiation_sum` +
    `&timezone=America%2FEdmonton`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
  const json = await res.json();
  const d = json.daily;
  if (!d || !d.time) throw new Error('Open-Meteo response had no daily block');

  return {
    source: 'Open-Meteo historical archive (ERA5 reanalysis)',
    days: d.time.map((date, i) => ({
      date,
      tMean: d.temperature_2m_mean[i],
      tMax: d.temperature_2m_max[i],
      tMin: d.temperature_2m_min[i],
      precipMm: d.precipitation_sum[i] ?? 0,
      // MJ/m^2/day of measured global horizontal radiation, converted to a
      // daily mean in W/m^2 so it can be compared with the clear-sky model.
      ghiWm2: ((d.shortwave_radiation_sum?.[i] ?? 0) * 1e6) / 86400,
    })),
  };
}

/**
 * Average a multi-year daily series into one representative year, keyed by
 * month and day. Leap days are dropped. Averaging the temperature is what we
 * want for a typical-year answer; averaging away the day-to-day variance is
 * NOT, because melt only responds to days above freezing, so the model is run
 * per year and the results averaged instead. See computeMeltAcrossYears().
 */
export function groupBySnowYear(days) {
  const years = new Map();
  for (const d of days) {
    const y = Number(d.date.slice(0, 4));
    const m = Number(d.date.slice(5, 7));
    // A snow year runs August to July, so accumulation is not cut in half by
    // the calendar. Label it by the winter it contains: 2023-24.
    const start = m >= 8 ? y : y - 1;
    const key = `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
    if (!years.has(key)) years.set(key, []);
    years.get(key).push(d);
  }
  return years;
}

// ---------------------------------------------------------------------------
// Offline fallback
// ---------------------------------------------------------------------------

/**
 * Edmonton monthly climate normals, used only when the archive is
 * unreachable. Mean daily temperature in degrees C and monthly precipitation
 * in mm, approximating the 1991-2020 normals for the Edmonton area.
 *
 * These are a fallback, not a result. Anything computed from them is marked
 * provisional, because a degree-day melt model responds to the number of days
 * above freezing, which monthly means cannot tell you.
 */
export const EDMONTON_NORMALS = {
  tMean: [-11.7, -9.3, -3.3, 5.1, 11.3, 15.1, 17.1, 16.2, 10.9, 4.2, -5.8, -10.9],
  precipMm: [22, 15, 18, 27, 50, 88, 92, 62, 44, 22, 19, 21],
  // Day-to-day standard deviation of mean temperature, by month. Prairie
  // winters swing hard; summers do not.
  tSigma: [8.5, 8.0, 6.5, 5.0, 4.0, 3.5, 3.0, 3.2, 4.2, 5.5, 7.0, 8.0],
  diurnalRange: [9.5, 10.5, 11.0, 12.0, 12.5, 12.0, 12.5, 12.5, 12.0, 11.0, 9.5, 9.0],
  // Clearness index: measured global horizontal over clear-sky. Edmonton is a
  // sunny place by Canadian standards, but low winter sun and ice fog pull the
  // cold months down.
  clearness: [0.45, 0.52, 0.55, 0.55, 0.54, 0.53, 0.57, 0.56, 0.52, 0.48, 0.42, 0.41],
};

/** Deterministic PRNG so fallback runs are reproducible. */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthesise a plausible daily year from the normals.
 *
 * Temperature is a first-order autoregressive process around a smooth
 * seasonal mean, which is the standard shape of a simple weather generator:
 * it reproduces both the monthly mean and the persistence of prairie cold
 * snaps and thaws, so the count of above-freezing days is realistic even
 * though the individual days are invented.
 */
export function synthesiseYear(year, seed = 20260908) {
  const rand = mulberry32(seed);
  const gauss = () => {
    const u = Math.max(1e-9, rand()), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const days = [];
  const phi = 0.72; // day-to-day persistence
  let anomaly = 0;

  for (let m = 0; m < 12; m++) {
    const inMonth = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
    const sigma = EDMONTON_NORMALS.tSigma[m];
    const prevM = (m + 11) % 12, nextM = (m + 1) % 12;

    for (let d = 1; d <= inMonth; d++) {
      // Smooth the seasonal mean across month boundaries.
      const f = (d - 0.5) / inMonth - 0.5;
      const base = EDMONTON_NORMALS.tMean[m];
      const neighbour = f < 0 ? EDMONTON_NORMALS.tMean[prevM] : EDMONTON_NORMALS.tMean[nextM];
      const tSeasonal = base + (neighbour - base) * Math.abs(f);

      anomaly = phi * anomaly + Math.sqrt(1 - phi * phi) * sigma * gauss();
      const tMean = tSeasonal + anomaly;
      const range = EDMONTON_NORMALS.diurnalRange[m];

      // Wet days: roughly a third of days carry the month's precipitation.
      const wet = rand() < 0.33;
      const precipMm = wet ? (EDMONTON_NORMALS.precipMm[m] / (inMonth * 0.33)) * (0.4 + 1.6 * rand()) : 0;

      days.push({
        date: `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        tMean: +tMean.toFixed(1),
        tMax: +(tMean + range / 2).toFixed(1),
        tMin: +(tMean - range / 2).toFixed(1),
        precipMm: +precipMm.toFixed(1),
        clearness: EDMONTON_NORMALS.clearness[m],
      });
    }
  }
  return { source: 'SYNTHETIC fallback from Edmonton monthly normals - provisional', days };
}
