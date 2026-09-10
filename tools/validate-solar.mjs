/**
 * Validation harness for src/solar.js.
 *
 * This imports the same module the browser runs. There is no second
 * implementation to drift away from the first.
 *
 * Reference data, in descending order of authority:
 *
 *  A. Edmonton solstice day lengths as published by CTV Edmonton
 *     (7h 27m 42s on the December solstice, 17h 02m 42s on the June
 *     solstice). Day length is a duration, so it is immune to time-zone and
 *     daylight-saving handling - the cleanest possible check.
 *
 *  B. sunrise-sunset.org's September 2026 daily table for Edmonton
 *     (53.544388 N, -113.490929 W): solar noon and maximum sun altitude.
 *
 *  C. Invariants that follow from the geometry and need no source at all.
 *
 * A known divergence is measured rather than tuned away: sunrise-sunset.org's
 * sunrise and sunset instants sit about 2 minutes outside ours because they
 * solve for apparent elevation -0.833 deg, whereas the USNO/NOAA convention
 * that we follow solves for geometric elevation -0.833 deg, the 0.567 deg
 * refraction allowance already being baked into that constant. The harness
 * reports the size of that gap and asserts it stays in the expected band.
 *
 * Run: node tools/validate-solar.mjs
 */

import { sunPosition, sunTimes, equationOfTime, julianCentury, julianDay } from '../src/solar.js';

const SITE = { lat: 53.544388, lon: -113.490929, tz: 'America/Edmonton' };

let failures = 0;
const fmtHMS = new Intl.DateTimeFormat('en-CA', {
  timeZone: SITE.tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const secsOf = (s) => { const [h, m, x] = s.split(':').map(Number); return h * 3600 + m * 60 + x; };
const localSecs = (d) => secsOf(fmtHMS.format(d));

function check(name, got, want, tol, unit) {
  const delta = Math.abs(got - want);
  const ok = delta <= tol;
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name.padEnd(32)} model ${String(got).padStart(9)}   ref ${String(want).padStart(9)}   D=${delta.toFixed(2)} ${unit}`);
}

const hms = (s) => `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;

// ---------------------------------------------------------------- A. day length
console.log(`\nFirst Light - solar engine validation`);
console.log(`Site: ${SITE.lat} N, ${SITE.lon} E\n`);
console.log('A. Solstice day length  (CTV Edmonton; duration, so DST-independent)');

const dayLenSec = (y, m, d) =>
  sunTimes(new Date(Date.UTC(y, m - 1, d, 12)), SITE.lat, SITE.lon).dayLengthMinutes * 60;

const dec = dayLenSec(2026, 12, 21);
const jun = dayLenSec(2026, 6, 20);
console.log(`       December solstice: ${hms(dec)}   reference 7h 27m 42s`);
console.log(`       June solstice:     ${hms(jun)}   reference 17h 02m 42s`);
// Day length at the solstice varies a few seconds between years; 60 s is tight.
check('Dec solstice day length', Math.round(dec), 7 * 3600 + 27 * 60 + 42, 60, 's');
check('Jun solstice day length', Math.round(jun), 17 * 3600 + 2 * 60 + 42, 60, 's');

// ------------------------------------------------- B. daily table, Sept 2026
console.log('\nB. Solar noon and noon altitude  (sunrise-sunset.org daily table, Sep 2026)');

const TABLE = [
  // day, sunrise, sunset, solar noon, max altitude
  [1, '06:42:05', '20:25:38', '13:33:52', 44.5], [2, '06:43:50', '20:23:15', '13:33:32', 44.1],
  [3, '06:45:35', '20:20:51', '13:33:13', 43.8], [4, '06:47:20', '20:18:26', '13:32:53', 43.4],
  [5, '06:49:04', '20:16:01', '13:32:33', 43.0], [8, '06:54:18', '20:08:44', '13:31:31', 41.9],
  [10, '06:57:47', '20:03:51', '13:30:49', 41.2], [15, '07:06:31', '19:51:35', '13:29:03', 39.2],
  [20, '07:15:15', '19:39:16', '13:27:16', 37.3], [22, '07:18:45', '19:34:21', '13:26:33', 36.5],
  [25, '07:24:02', '19:26:59', '13:25:31', 35.4], [30, '07:32:53', '19:14:46', '13:23:50', 33.4],
];

const noonErr = [], altErr = [], riseErr = [], setErr = [];
for (const [d, r, s, n, alt] of TABLE) {
  const t = sunTimes(new Date(Date.UTC(2026, 8, d, 12)), SITE.lat, SITE.lon);
  noonErr.push(localSecs(t.solarNoon) - secsOf(n));
  altErr.push(sunPosition(t.solarNoon, SITE.lat, SITE.lon).elevation - alt);
  riseErr.push(localSecs(t.sunrise) - secsOf(r));
  setErr.push(localSecs(t.sunset) - secsOf(s));
}
const maxAbs = (a) => Math.max(...a.map(Math.abs));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

check('solar noon, worst of 12 days', +maxAbs(noonErr).toFixed(1), 0, 15, 's');
check('noon altitude, worst of 12', +maxAbs(altErr).toFixed(3), 0, 0.05, 'deg');

// ------------------------------------------------------------- C. invariants
console.log('\nC. Geometric invariants  (no external source)');

const noonAlt = (iso) => {
  const t = sunTimes(new Date(iso), SITE.lat, SITE.lon);
  return sunPosition(t.solarNoon, SITE.lat, SITE.lon).elevation;
};
check('Jun solstice noon altitude', +noonAlt('2026-06-20T12:00:00Z').toFixed(2),
  +(90 - SITE.lat + 23.44).toFixed(2), 0.2, 'deg');
check('Dec solstice noon altitude', +noonAlt('2026-12-21T12:00:00Z').toFixed(2),
  +(90 - SITE.lat - 23.44).toFixed(2), 0.2, 'deg');

const dl = (m, d) => dayLenSec(2026, m, d) / 60;
check('equinox symmetry Mar/Sep', +Math.abs(dl(3, 20) - dl(9, 22)).toFixed(1), 0, 4, 'min');

let eMin = Infinity, eMax = -Infinity;
for (let i = 0; i < 365; i++) {
  const e = equationOfTime(julianCentury(julianDay(new Date(Date.UTC(2026, 0, 1 + i)))));
  eMin = Math.min(eMin, e); eMax = Math.max(eMax, e);
}
check('equation of time minimum', +eMin.toFixed(2), -14.2, 0.3, 'min');
check('equation of time maximum', +eMax.toFixed(2), 16.4, 0.3, 'min');

// ------------------------------------------------- known convention divergence
console.log('\nD. Known convention divergence  (measured, not tuned away)');
console.log(`       sunrise-sunset.org sunrise runs ${mean(riseErr).toFixed(0)} s earlier than ours`);
console.log(`       sunrise-sunset.org sunset  runs ${(mean(setErr) * -1).toFixed(0)} s later  than ours`);
console.log(`       net day length difference: ${((mean(setErr) - mean(riseErr)) * -1 / 60).toFixed(1)} min`);
console.log(`       Their solstice figures (7h 32m / 17h 07m) carry the same offset.`);
console.log(`       Ours match the CTV figures above to within seconds, so we keep the`);
console.log(`       USNO convention and document the difference.`);
check('divergence stays in band', +Math.abs((mean(setErr) - mean(riseErr)) / 60).toFixed(1), 3.8, 1.0, 'min');

// --------------------------------------------- what the naive model would cost
console.log('\nE. Cost of the approximation this replaces');
const RAD = Math.PI / 180;
let worstDecl = 0;
for (let i = 0; i < 365; i++) {
  const naive = -23.44 * Math.cos((360 / 365) * (i + 11) * RAD);
  const real = sunPosition(new Date(Date.UTC(2026, 0, 1 + i, 19)), SITE.lat, SITE.lon).declination;
  if (Math.abs(naive - real) > Math.abs(worstDecl)) worstDecl = naive - real;
}
const shadow = (h, el) => h / Math.tan(el * RAD);
console.log(`       day-of-year cosine declination, worst error: ${worstDecl.toFixed(2)} deg`);
console.log(`       equation of time, if omitted: up to ${eMax.toFixed(1)} min of clock error`);
console.log(`       at 13.0 deg midwinter altitude, an 8.45 m ridge throws ${shadow(8.45, 13.0).toFixed(1)} m of shadow;`);
console.log(`       a 1 deg altitude error moves that edge by ${(shadow(8.45, 13.0) - shadow(8.45, 14.0)).toFixed(1)} m.`);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
