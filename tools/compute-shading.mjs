/**
 * Compute the shading model for the lot and report per-zone results.
 *
 * Run: node tools/compute-shading.mjs [--no-fence]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { SiteModel } from '../src/site-geometry.js';
import {
  horizonProfile, accumulateDay, cellsInRect, zoneMean, skyViewFactor, isLit,
} from '../src/shading.js';
import { sunTimes, sunPosition } from '../src/solar.js';

// Community centroid rounded to two decimals (about 1 km), not the parcel;
// at this scale a few hundred metres is worth well under a second of time.
const LAT = 53.43;
const LON = -113.66;

const site = JSON.parse(readFileSync(new URL('../data/site.json', import.meta.url)));
const building = JSON.parse(readFileSync(new URL('../data/building.json', import.meta.url)));

const withFence = !process.argv.includes('--no-fence');
const withNeighbours = process.argv.includes('--neighbours');
const model = new SiteModel(site, building, { fence: withFence, neighbours: withNeighbours });

const SPACING = 0.5;
const cells = model.cells(SPACING);

console.log(`\nFirst Light - shading model`);
console.log(`Lot ${model.lotWidth} x ${model.lotDepth} m, frontage ${model.frontAzimuth}deg`);
console.log(`Ridge ${model.ridge.toFixed(2)} m, eave ${model.eave.toFixed(2)} m above grade`);
console.log(`Fence: ${withFence ? model.opts.fenceHeight + ' m' : 'none'}   Neighbours: ${withNeighbours ? 'modelled' : 'omitted'}`);
console.log(`${cells.length} ground cells at ${SPACING} m spacing\n`);

console.time('horizon profiles');
const profiles = cells.map((c) => horizonProfile(model, c));
console.timeEnd('horizon profiles');

const zones = model.zones();
const zoneIdx = Object.fromEntries(
  Object.entries(zones).map(([k, z]) => [k, cellsInRect(cells, z.rect)])
);

// ---- monthly accumulation on the 15th of each month -----------------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthly = {};
for (const k of Object.keys(zones)) monthly[k] = { hours: [], kwh: [] };
const possible = [];

console.time('monthly accumulation');
for (let m = 0; m < 12; m++) {
  const date = new Date(Date.UTC(2026, m, 15));
  const t = sunTimes(date, LAT, LON);
  possible.push(t.dayLengthMinutes / 60);
  const { sunHours, directWhPerM2 } = accumulateDay(model, cells, profiles, date, LAT, LON, 10);
  for (const [k, idx] of Object.entries(zoneIdx)) {
    monthly[k].hours.push(zoneMean(sunHours, idx));
    monthly[k].kwh.push(zoneMean(directWhPerM2, idx) / 1000);
  }
}
console.timeEnd('monthly accumulation');

// ---- report ---------------------------------------------------------------
const pad = (s, n) => String(s).padStart(n);

console.log('\nDirect sun hours on a clear day, mid-month, by zone');
console.log('  ' + ''.padEnd(24) + MONTHS.map((m) => pad(m, 6)).join(''));
console.log('  possible'.padEnd(28) + possible.map((h) => pad(h.toFixed(1), 6)).join(''));
for (const [k, z] of Object.entries(zones)) {
  console.log('  ' + z.label.padEnd(26) + monthly[k].hours.map((h) => pad(h.toFixed(1), 6)).join(''));
}

console.log('\nAs a share of the daylight available that day');
for (const [k, z] of Object.entries(zones)) {
  const pct = monthly[k].hours.map((h, i) => (100 * h) / possible[i]);
  console.log('  ' + z.label.padEnd(26) + pct.map((p) => pad(Math.round(p) + '%', 6)).join(''));
}

console.log('\nClear-sky direct energy on the horizontal, kWh/m2/day');
for (const [k, z] of Object.entries(zones)) {
  console.log('  ' + z.label.padEnd(26) + monthly[k].kwh.map((v) => pad(v.toFixed(1), 6)).join(''));
}

console.log('\nSky view factor (1.0 = open sky)');
for (const [k, z] of Object.entries(zones)) {
  const svf = zoneIdx[k].map((i) => skyViewFactor(profiles[i]));
  console.log('  ' + z.label.padEnd(26) + pad((svf.reduce((a, b) => a + b, 0) / svf.length).toFixed(2), 6));
}

// ---- the specific claim: winter morning sun on the driveway ---------------
console.log('\nWinter morning, 21 December - when does each zone first catch the sun?');
const dec = new Date(Date.UTC(2026, 11, 21));
const decTimes = sunTimes(dec, LAT, LON);
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Edmonton', hour: '2-digit', minute: '2-digit', hour12: false,
});
const midnight = Date.UTC(2026, 11, 21);
for (const [k, z] of Object.entries(zones)) {
  let first = null, last = null, lit = 0;
  for (let m = 0; m < 1440; m += 5) {
    const at = new Date(midnight + m * 60000);
    const p = sunPosition(at, LAT, LON);
    if (p.apparentElevation <= 0) continue;
    const share = zoneIdx[k].filter((i) => isLit(model, profiles[i], p.azimuth, p.apparentElevation)).length / zoneIdx[k].length;
    if (share >= 0.5) {
      if (first === null) first = at;
      last = at;
      lit += 5 / 60;
    }
  }
  console.log(
    '  ' + z.label.padEnd(26) +
    (first ? `${fmt.format(first)} to ${fmt.format(last)}   ${lit.toFixed(1)} h` : 'never more than half lit')
  );
}
console.log(`  (sunrise ${fmt.format(decTimes.sunrise)}, sunset ${fmt.format(decTimes.sunset)}, ` +
  `noon altitude ${sunPosition(decTimes.solarNoon, LAT, LON).elevation.toFixed(1)}deg)`);

// ---- persist --------------------------------------------------------------
const out = {
  generated: new Date().toISOString(),
  site: site.id,
  latitude: LAT,
  longitude: LON,
  frontAzimuth: model.frontAzimuth,
  fence: withFence ? model.opts.fenceHeight : null,
  cellSpacing: SPACING,
  months: MONTHS,
  possibleDaylightHours: possible.map((h) => +h.toFixed(2)),
  zones: Object.fromEntries(
    Object.entries(zones).map(([k, z]) => [k, {
      label: z.label,
      note: z.note,
      rect: z.rect,
      cells: zoneIdx[k].length,
      sunHours: monthly[k].hours.map((v) => +v.toFixed(2)),
      clearSkyKwhPerM2: monthly[k].kwh.map((v) => +v.toFixed(2)),
      skyViewFactor: +(zoneIdx[k].map((i) => skyViewFactor(profiles[i]))
        .reduce((a, b) => a + b, 0) / zoneIdx[k].length).toFixed(3),
    }])
  ),
};
writeFileSync(new URL('../data/shading.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('\nwrote data/shading.json\n');
