/**
 * Join the shading model to the weather record and report, per zone, when the
 * snow goes.
 *
 * With network access this pulls the Open-Meteo archive and runs each winter
 * separately, then reports the spread across years. Offline it falls back to a
 * synthetic year built from Edmonton's normals and marks every number
 * provisional.
 *
 * Run: node tools/compute-melt.mjs [--years N] [--offline] [--no-fence]
 */

import { readFileSync } from 'node:fs';
import { SiteModel } from '../src/site-geometry.js';
import { horizonProfile, accumulateDay, cellsInRect, skyViewFactor, clearSkyDiffuse } from '../src/shading.js';
import { sunTimes, sunPosition } from '../src/solar.js';
import { fetchDaily, groupBySnowYear, synthesiseYear } from '../src/climate.js';
import { runSeason, zoneMeltOut, freezeThawDays } from '../src/snowmelt.js';

const LAT = 53.43;
const LON = -113.66;
const RADIATION_SAMPLE_DAYS = 5; // compute insolation every N days, interpolate between

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const site = JSON.parse(readFileSync(new URL('../data/site.json', import.meta.url)));
const building = JSON.parse(readFileSync(new URL('../data/building.json', import.meta.url)));
const model = new SiteModel(site, building, { fence: !process.argv.includes('--no-fence') });

const cells = model.cells(0.5);
const profiles = cells.map((c) => horizonProfile(model, c));
const zones = model.zones();
const zoneIdx = Object.fromEntries(
  Object.entries(zones).map(([k, z]) => [k, cellsInRect(cells, z.rect)])
);

console.log('\nFirst Light - snow melt model');
console.log(`${cells.length} cells, fence ${model.opts.fence ? model.opts.fenceHeight + ' m' : 'none'}`);

// ---- per-cell potential radiation, sampled through the year ---------------
const skyView = Float32Array.from(profiles, skyViewFactor);

console.time('potential radiation');
const sampleDays = [];
const sampleRad = [];
const sampleDiffuse = [];
const sampleClearGHI = [];
for (let doy = 0; doy < 366; doy += RADIATION_SAMPLE_DAYS) {
  const date = new Date(Date.UTC(2026, 0, 1 + doy));
  const { directWhPerM2 } = accumulateDay(model, cells, profiles, date, LAT, LON, 15);
  sampleDays.push(doy);
  sampleRad.push(Float32Array.from(directWhPerM2, (wh) => wh / 24));

  // Clear-sky diffuse and total on an unobstructed horizontal surface, so the
  // measured radiation can be turned into a cloud factor.
  let dif = 0, tot = 0;
  const midnight = Date.UTC(2026, 0, 1 + doy);
  for (let m = 0; m < 1440; m += 15) {
    const at = new Date(midnight + m * 60000);
    const p = sunPosition(at, LAT, LON);
    if (p.apparentElevation <= 0) continue;
    const df = clearSkyDiffuse(at, p.apparentElevation);
    dif += df * 0.25;
    tot += df * 0.25;
  }
  sampleDiffuse.push(dif / 24);
  sampleClearGHI.push(tot / 24);
}
console.timeEnd('potential radiation');

const lerpIndex = (doy) => {
  const i = Math.min(sampleDays.length - 2, Math.floor(doy / RADIATION_SAMPLE_DAYS));
  return [i, (doy - sampleDays[i]) / RADIATION_SAMPLE_DAYS];
};

/** Per-cell potential direct beam, interpolated to any day of year. */
function directFor(doy) {
  const [i, w] = lerpIndex(doy);
  const a = sampleRad[i], b = sampleRad[i + 1];
  const out = new Float32Array(a.length);
  for (let c = 0; c < a.length; c++) out[c] = a[c] * (1 - w) + b[c] * w;
  return out;
}
function diffuseFor(doy) {
  const [i, w] = lerpIndex(doy);
  return sampleDiffuse[i] * (1 - w) + sampleDiffuse[i + 1] * w;
}
function clearGHIFor(doy, cellDirectMean) {
  const [i, w] = lerpIndex(doy);
  return sampleClearGHI[i] * (1 - w) + sampleClearGHI[i + 1] * w + cellDirectMean;
}
const doyOf = (iso) => {
  const t = Date.parse(iso + 'T00:00:00Z');
  return Math.floor((t - Date.UTC(new Date(t).getUTCFullYear(), 0, 1)) / 86400000);
};
// Unobstructed direct beam, for the cloud-factor denominator.
const openCellIdx = cells.reduce((best, c, i) =>
  (c.y > model.lotDepth - 1.5 ? i : best), 0);

// ---- weather ---------------------------------------------------------------
const nYears = Number(arg('--years', 10));
let years, sourceLabel, provisional = false;

if (process.argv.includes('--offline')) {
  const a = synthesiseYear(2025, 11), b = synthesiseYear(2026, 22);
  years = groupBySnowYear([...a.days, ...b.days]);
  sourceLabel = a.source;
  provisional = true;
} else {
  const end = new Date();
  const endDate = `${end.getUTCFullYear() - 1}-12-31`;
  const startDate = `${end.getUTCFullYear() - nYears}-01-01`;
  try {
    const record = await fetchDaily(LAT, LON, startDate, endDate);
    years = groupBySnowYear(record.days);
    sourceLabel = `${record.source}, ${startDate} to ${endDate}`;
  } catch (err) {
    console.log(`\n  Open-Meteo unavailable (${err.message}); using the offline fallback.`);
    const a = synthesiseYear(2025, 11), b = synthesiseYear(2026, 22);
    years = groupBySnowYear([...a.days, ...b.days]);
    sourceLabel = a.source;
    provisional = true;
  }
}
console.log(`Weather: ${sourceLabel}\n`);

// ---- run each winter -------------------------------------------------------
const results = {};
const snowCover = {};
const marchSwe = {};
for (const k of Object.keys(zones)) { results[k] = []; snowCover[k] = []; marchSwe[k] = []; }
const freezeThaw = { driveway: [], front_walk: [] };
const clearAdvantage = [];

for (const [label, days] of years) {
  if (days.length < 300) continue;
  const direct = [], diffuse = new Float32Array(days.length), cloud = new Float32Array(days.length);
  for (let i = 0; i < days.length; i++) {
    const doy = doyOf(days[i].date);
    const dir = directFor(doy);
    direct.push(dir);
    diffuse[i] = diffuseFor(doy);
    const clear = clearGHIFor(doy, dir[openCellIdx]);
    cloud[i] = days[i].ghiWm2 !== undefined && clear > 5
      ? Math.min(1.2, Math.max(0.1, days[i].ghiWm2 / clear))
      : (days[i].clearness ?? 0.5) / 0.72; // fallback: clearness relative to clear-sky
  }
  const season = runSeason(days, { direct, diffuse, skyView, cloudFactor: cloud }, cells.length);

  for (const [k, idx] of Object.entries(zoneIdx)) {
    const m = zoneMeltOut(season.meltOutDayIndex, idx);
    if (m) results[k].push({ year: label, ...m, doy: doyOf(days[m.median].date) });
  }
  const zoneMean = (arr, idx) => idx.reduce((a, c) => a + arr[c], 0) / idx.length;
  for (const [k, idx] of Object.entries(zoneIdx)) {
    snowCover[k].push(zoneMean(season.snowDays, idx));
    const march = days
      .map((d, i) => (d.date.slice(5, 7) === '03' ? zoneMean(season.sweByDay[i], idx) : null))
      .filter((v) => v !== null);
    marchSwe[k].push(march.reduce((a, b) => a + b, 0) / march.length);
  }
  // Days on which the driveway is bare while the back yard still holds snow.
  let adv = 0;
  for (let i = 0; i < days.length; i++) {
    const drv = zoneMean(season.sweByDay[i], zoneIdx.driveway);
    const back = zoneMean(season.sweByDay[i], zoneIdx.back_yard);
    if (drv < 1 && back >= 1) adv++;
  }
  clearAdvantage.push(adv);
  for (const k of Object.keys(freezeThaw)) {
    freezeThaw[k].push(freezeThawDays(days, season.sweByDay, zoneIdx[k]));
  }
}

// ---- report ----------------------------------------------------------------
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const asDate = (doy) => new Date(Date.UTC(2026, 0, 1 + doy)).toISOString().slice(5, 10)
  .replace('-', ' ').replace(/^0?(\d+) (\d+)/, (_, m, d) =>
    ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1] + ' ' + +d);

console.log('Days with snow on the ground, median across the record');
for (const [k, z] of Object.entries(zones)) {
  if (snowCover[k].length) {
    console.log(`  ${z.label.padEnd(26)} ${Math.round(median(snowCover[k]))} days`);
  }
}

console.log('\nMean snow water equivalent through March, mm');
for (const [k, z] of Object.entries(zones)) {
  if (marchSwe[k].length) {
    console.log(`  ${z.label.padEnd(26)} ${median(marchSwe[k]).toFixed(1)} mm`);
  }
}

if (clearAdvantage.length) {
  console.log(`\n  The driveway is bare while the back yard still holds snow on`);
  console.log(`  ${Math.round(median(clearAdvantage))} days of a typical winter.`);
}

console.log('\nSpring melt-out, median across the record');
console.log('  (fragile where the pack is thin: one late snowfall that melts in a');
console.log('   day clears every zone at once, so read the figures above first)');
console.log('  zone                        median      range across years');
for (const [k, z] of Object.entries(zones)) {
  const r = results[k];
  if (!r.length) { console.log(`  ${z.label.padEnd(26)} never fully clears in the model`); continue; }
  const meds = r.map((x) => x.doy);
  console.log(
    `  ${z.label.padEnd(26)} ${asDate(median(meds)).padEnd(11)} ` +
    `${asDate(Math.min(...meds))} to ${asDate(Math.max(...meds))}`
  );
}

const dm = results.driveway.length ? median(results.driveway.map((x) => x.median)) : null;
const bm = results.back_yard.length ? median(results.back_yard.map((x) => x.median)) : null;
if (dm !== null && bm !== null) {
  console.log(`\n  The driveway clears ${bm - dm} days before the back yard.`);
}

console.log('\nFreeze-thaw days with snow on the ground (meltwater refreeze risk)');
for (const [k, v] of Object.entries(freezeThaw)) {
  if (v.length) console.log(`  ${zones[k].label.padEnd(26)} ${median(v)} days per winter`);
}

if (provisional) {
  console.log(`
  PROVISIONAL. These dates come from a synthetic year generated from monthly
  normals, not from observations. The geometry is real; the weather is not.
  Re-run with network access to replace it with the Open-Meteo record.`);
}
console.log('');
