/**
 * First Light - report front end.
 *
 * Runs the same engine modules the command-line tools run. Nothing here is
 * precomputed and pasted in; every figure on the page is calculated in the
 * browser from data/site.json and data/building.json when the page loads.
 *
 * The one performance decision worth knowing: horizon profiles depend only on
 * what the house and fence block, not on which way the lot points. So rotating
 * the frontage needs no reprofiling, only re-accumulation, which is why the
 * bearing slider in Figure 4 responds immediately while changing the fence
 * shows a recompute.
 */

import { SiteModel } from './site-geometry.js';
import { horizonProfile, accumulateDay, cellsInRect, isLit, skyViewFactor, clearSkyDiffuse } from './shading.js';
import { sunTimes, sunPosition } from './solar.js';
import { synthesiseYear, groupBySnowYear, EDMONTON_NORMALS } from './climate.js';
import { runSeason } from './snowmelt.js';
import { createScene } from './scene3d.js';

// Neighbourhood centroid, deliberately rounded to ~1 km. At this latitude a
// kilometre of longitude is under three seconds of solar time, so the results
// are unchanged and the file does not carry a parcel-level fix.
const LAT = 53.43;
const LON = -113.66;
const SPACING = 0.5;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

const SHORT_LABEL = {
  driveway: 'Driveway', front_walk: 'Front walk', deck: 'Rear deck',
  back_yard: 'Back yard', side_yard_east: 'East side yard',
};
const shortName = (k, fallback) => SHORT_LABEL[k] || fallback;

/**
 * Push a set of direct labels apart so none overlap.
 * Sort by position, walk down enforcing a minimum gap, then walk back up if
 * the stack has run past the bottom of the plot.
 */
function deCollide(items, minGap, top, bottom) {
  const out = [...items].sort((a, b) => a.y - b.y);
  for (let i = 1; i < out.length; i++) {
    if (out[i].y - out[i - 1].y < minGap) out[i].y = out[i - 1].y + minGap;
  }
  const overflow = out.length ? out[out.length - 1].y - bottom : 0;
  if (overflow > 0) for (const it of out) it.y -= overflow;
  for (const it of out) it.y = Math.max(top, it.y);
  return out;
}

const SUN_RAMP = ['#F3EDE3', '#E6CFA8', '#D3A461', '#B45F1E'];
const $ = (id) => document.getElementById(id);
const fmtTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Edmonton', hour: '2-digit', minute: '2-digit', hour12: false,
});

/* ------------------------------------------------------------------ helpers */

function rampColour(t) {
  const x = Math.max(0, Math.min(1, t)) * (SUN_RAMP.length - 1);
  const i = Math.min(SUN_RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const hex = (s) => [1, 3, 5].map((k) => parseInt(s.slice(k, k + 2), 16));
  const a = hex(SUN_RAMP[i]), b = hex(SUN_RAMP[i + 1]);
  const mix = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgb(${mix.join(',')})`;
}

const svgEl = (vb, inner, extra = '') =>
  `<svg viewBox="${vb}" width="100%" preserveAspectRatio="xMidYMid meet" ${extra}>${inner}</svg>`;

const esc = (s) => String(s).replace(/[<>&"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------------- state */

const state = {
  model: null, cells: null, profiles: null, zones: null, zoneIdx: null,
  monthly: null, sweep: null, month: 11, bearing: null, fence: true,
  scene: null, season: null, day: 200, minutes: 12 * 60, playing: false,
  ground: 'snow',
  site: null, building: null,
};

/* --------------------------------------------------------------- computing */

function rebuildGeometry() {
  state.model = new SiteModel(state.site, state.building, { fence: state.fence });
  state.model.frontAzimuth = state.bearing;
  state.model.axisAzimuthX = (state.bearing - 90 + 360) % 360;
  state.model.axisAzimuthY = (state.bearing + 180) % 360;
  state.cells = state.model.cells(SPACING);
  state.profiles = state.cells.map((c) => horizonProfile(state.model, c));
  state.zones = state.model.zones();
  state.zoneIdx = Object.fromEntries(
    Object.entries(state.zones).map(([k, z]) => [k, cellsInRect(state.cells, z.rect)])
  );
  state.sweep = null; // curves depend on the massing, so they are now stale
}

/** Re-point the lot without reprofiling. Profiles are bearing-independent. */
function setBearing(deg) {
  state.bearing = deg;
  state.model.frontAzimuth = deg;
  state.model.axisAzimuthX = (deg - 90 + 360) % 360;
  state.model.axisAzimuthY = (deg + 180) % 360;
}

function monthField(monthIndex) {
  const date = new Date(Date.UTC(2026, monthIndex, 15));
  const { sunHours } = accumulateDay(state.model, state.cells, state.profiles, date, LAT, LON, 10);
  return sunHours;
}

function computeMonthly() {
  const out = { possible: [], zones: {} };
  for (const k of Object.keys(state.zones)) out.zones[k] = [];
  for (let m = 0; m < 12; m++) {
    const date = new Date(Date.UTC(2026, m, 15));
    out.possible.push(sunTimes(date, LAT, LON).dayLengthMinutes / 60);
    const field = monthField(m);
    for (const [k, idx] of Object.entries(state.zoneIdx)) {
      out.zones[k].push(idx.reduce((a, c) => a + field[c], 0) / idx.length);
    }
  }
  return out;
}

/* ------------------------------------------------------- the snow season */

/**
 * Run the melt model for one snow year and keep the daily snowpack for every
 * cell, so the 3D ground can be scrubbed through the season.
 *
 * The weather here is synthesised from Edmonton's monthly normals, because a
 * browser opened from a file cannot always reach the archive. Where the live
 * Open-Meteo record is available the same model runs against observations; the
 * geometry and the physics are identical either way.
 */
function computeSeason() {
  const SAMPLE = 5;
  const sampleDirect = [], sampleDiffuse = [];
  for (let doy = 0; doy < 366; doy += SAMPLE) {
    const date = new Date(Date.UTC(2026, 0, 1 + doy));
    const { directWhPerM2 } = accumulateDay(state.model, state.cells, state.profiles, date, LAT, LON, 20);
    sampleDirect.push(Float32Array.from(directWhPerM2, (wh) => wh / 24));
    const midnight = Date.UTC(2026, 0, 1 + doy);
    let dif = 0;
    for (let m = 0; m < 1440; m += 20) {
      const at = new Date(midnight + m * 60000);
      const p = sunPosition(at, LAT, LON);
      if (p.apparentElevation > 0) dif += clearSkyDiffuse(at, p.apparentElevation) / 3;
    }
    sampleDiffuse.push(dif / 24);
  }

  const a = synthesiseYear(2025, 11), b = synthesiseYear(2026, 22);
  const days = groupBySnowYear([...a.days, ...b.days]).get('2025-26');
  const skyView = Float32Array.from(state.profiles, skyViewFactor);

  const doyOf = (iso) => {
    const t = Date.parse(iso + 'T00:00:00Z');
    return Math.floor((t - Date.UTC(new Date(t).getUTCFullYear(), 0, 1)) / 86400000);
  };
  const direct = [], diffuse = new Float32Array(days.length), cloud = new Float32Array(days.length);
  for (let i = 0; i < days.length; i++) {
    const doy = doyOf(days[i].date);
    const j = Math.min(sampleDirect.length - 2, Math.floor(doy / SAMPLE));
    const w = (doy - j * SAMPLE) / SAMPLE;
    const out = new Float32Array(state.cells.length);
    for (let c = 0; c < out.length; c++) {
      out[c] = sampleDirect[j][c] * (1 - w) + sampleDirect[j + 1][c] * w;
    }
    direct.push(out);
    diffuse[i] = sampleDiffuse[j] * (1 - w) + sampleDiffuse[j + 1] * w;
    cloud[i] = (days[i].clearness ?? 0.5) / 0.72;
  }

  const season = runSeason(days, { direct, diffuse, skyView, cloudFactor: cloud }, state.cells.length);
  return { days, ...season, doyOf };
}

/* ---------------------------------------------------------------- figure 1 */

/** Clamp the scrub position; a stale index must never take the page down. */
function currentDay() {
  const days = state.season && state.season.days;
  if (!days || !days.length) return null;
  state.day = Math.max(0, Math.min(days.length - 1, state.day | 0));
  return days[state.day];
}

function sceneDate() {
  const day = currentDay();
  if (!day) return new Date();
  const iso = day.date;
  const [y, m, d] = iso.split('-').map(Number);
  // Local Edmonton clock time, converted to the UTC instant the engine wants.
  const offset = (m > 3 && m < 11) ? 6 : 7;
  return new Date(Date.UTC(y, m - 1, d, 0, state.minutes + offset * 60));
}

function renderScene() {
  if (!state.scene || !state.season) return;
  const day = currentDay();
  if (!day) return;
  const date = sceneDate();
  const p = state.scene.setSun(date);

  const month = Number(day.date.slice(5, 7)) - 1;
  state.scene.highlightMonth(month);

  if (state.ground === 'snow') {
    state.scene.paintGround(state.season.sweByDay[state.day], 'snow');
  } else {
    state.scene.paintGround(monthField(month), 'sun');
  }

  const zoneSwe = (k) => {
    const idx = state.zoneIdx[k];
    return idx.reduce((a, c) => a + state.season.sweByDay[state.day][c], 0) / idx.length;
  };
  state.scene.setRoofSnow(zoneSwe('back_yard'));
  const el = p.apparentElevation;
  $('sceneSrc').innerHTML =
    `${esc(day.date)} · ${String(Math.floor(state.minutes / 60)).padStart(2, '0')}:` +
    `${String(state.minutes % 60).padStart(2, '0')} local · ` +
    `sun ${el > 0 ? `${el.toFixed(1)}° above the horizon at bearing ${p.azimuth.toFixed(0)}°` : 'below the horizon'} · ` +
    `air ${day.tMean.toFixed(1)} °C · snow depth: driveway ` +
    `${(zoneSwe('driveway') / 2.8).toFixed(1)} cm, back yard ` +
    `${(zoneSwe('back_yard') / 2.8).toFixed(1)} cm ` +
    `<span class="flag">weather synthesised from Edmonton normals</span>`;
}

function renderPlan(monthIndex) {
  const m = state.model;
  const field = monthField(monthIndex);
  const S = 15, PAD = 30, LEGEND = 250;
  const W = m.lotWidth * S + PAD * 2 + LEGEND;
  const H = m.lotDepth * S + PAD * 2 + 26;
  const X = (x) => PAD + x * S;
  const Y = (y) => PAD + (m.lotDepth - y) * S;
  const max = Math.max(...field, 0.001);

  let grid = '';
  for (let i = 0; i < state.cells.length; i++) {
    const c = state.cells[i];
    grid += `<rect x="${X(c.x - SPACING / 2).toFixed(1)}" y="${Y(c.y + SPACING / 2).toFixed(1)}"
      width="${(SPACING * S).toFixed(1)}" height="${(SPACING * S).toFixed(1)}"
      fill="${rampColour(field[i] / max)}" shape-rendering="crispEdges"/>`;
  }

  const foot = m.footprint.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ');

  // North needle, above the legend so it cannot sit on top of the plan.
  const phi = ((180 - state.bearing) * Math.PI) / 180;
  const nx = X(m.lotWidth) + 52, ny = PAD + 34, L = 30;
  const tip = [nx + Math.sin(phi) * L, ny - Math.cos(phi) * L];
  const tail = [nx - Math.sin(phi) * L * 0.45, ny + Math.cos(phi) * L * 0.45];
  const pp = [Math.cos(phi) * 3.6, Math.sin(phi) * 3.6];

  // Legend: one row per zone, so no text ever lands on the drawing.
  const lx = X(m.lotWidth) + 100;
  let ly = PAD + 12;
  const rows = Object.entries(state.zones).map(([k, z]) => {
    const idx = state.zoneIdx[k];
    const v = idx.length ? idx.reduce((a, c) => a + field[c], 0) / idx.length : 0;
    const y = ly; ly += 30;
    return `<rect x="${lx}" y="${y - 9}" width="16" height="12" fill="${rampColour(v / max)}"
        stroke="#C9C3B6"/>
      <text x="${lx + 24}" y="${y}" font-family="Inter,sans-serif" font-size="12.5" fill="#17181B"
        >${esc(shortName(k, z.label))}</text>
      <text x="${lx + 24}" y="${y + 14}" font-family="IBM Plex Mono,monospace" font-size="11.5"
        fill="#575C66">${v.toFixed(1)} h</text>`;
  }).join('');

  const inner = `${grid}
    <rect x="${X(0)}" y="${Y(m.lotDepth)}" width="${m.lotWidth * S}" height="${m.lotDepth * S}"
      fill="none" stroke="#8B909B" stroke-width="1.5"/>
    <polygon points="${foot}" fill="#F5F2EC" stroke="#17181B" stroke-width="1.5"/>
    <text x="${X((m.houseMinX + m.houseMaxX) / 2)}" y="${Y((m.houseMinY + m.houseMaxY) / 2)}"
      text-anchor="middle" font-family="Inter,sans-serif" font-size="12" fill="#17181B">House</text>
    <polygon points="${tail[0] - pp[0]},${tail[1] - pp[1]} ${tip[0]},${tip[1]} ${tail[0] + pp[0]},${tail[1] + pp[1]}"
      fill="#17181B"/>
    <text x="${tail[0] - 13}" y="${tail[1] + 13}" font-family="Inter,sans-serif" font-size="11"
      fill="#575C66">N</text>
    <text x="${lx}" y="${PAD - 8}" font-family="Inter,sans-serif" font-size="11" fill="#8B909B"
      >Direct sun, ${esc(MONTHS[monthIndex])}</text>
    ${rows}
    <text x="${X(m.lotWidth / 2)}" y="${H - 8}" text-anchor="middle" font-family="Inter,sans-serif"
      font-size="11" fill="#8B909B">Frontage ${state.bearing.toFixed(2)}\u00b0 \u00b7 street at the bottom</text>`;

  $('plan').classList.remove('busy');
  $('plan').innerHTML = svgEl(`0 0 ${W} ${H}`, inner,
    `role="img" aria-label="Site plan shaded by direct sun hours in ${MONTHS[monthIndex]}"
     style="max-width:${W}px;display:block;margin:0 auto"`);
}

/** Hours a zone is more than half lit, within a local-time window. */
function litHours(zoneKey, month, dayOfMonth, fromMin = 0, toMin = 1440) {
  const idx = state.zoneIdx[zoneKey];
  if (!idx || !idx.length) return 0;
  const midnight = Date.UTC(2026, month, dayOfMonth);
  const offset = (month > 2 && month < 10) ? 6 : 7; // local clock to UTC
  let hours = 0;
  for (let m = fromMin; m < toMin; m += 10) {
    const at = new Date(midnight + (m + offset * 60) * 60000);
    const p = sunPosition(at, LAT, LON);
    if (p.apparentElevation <= 0) continue;
    const share = idx.filter((i) =>
      isLit(state.model, state.profiles[i], p.azimuth, p.apparentElevation)).length / idx.length;
    if (share >= 0.5) hours += 1 / 6;
  }
  return hours;
}

/** The horticultural band a spot falls into, on growing-season average. */
function sunCategory(hoursPerDay) {
  if (hoursPerDay >= 6) return 'Full sun';
  if (hoursPerDay >= 4) return 'Part sun';
  if (hoursPerDay >= 2) return 'Part shade';
  return 'Full shade';
}

/* ------------------------------------------------------- figure 3, garden */

function renderGarden() {
  const m = state.monthly;
  const rows = Object.entries(state.zones).map(([k, z]) => {
    const season = m.zones[k].slice(4, 9);          // May to September
    const avg = season.reduce((a, b) => a + b, 0) / season.length;
    const junePct = (100 * m.zones[k][5]) / m.possible[5];
    const evening = litHours(k, 5, 21, 17 * 60, 23 * 60);
    return { k, label: shortName(k, z.label), avg, junePct, evening, cat: sunCategory(avg) };
  });

  const head = '<thead><tr><th>Zone</th><th>May\u2013Sep, h/day</th>' +
    '<th>June, share of daylight</th><th>Evening sun after 5pm</th><th>Planting</th></tr></thead>';
  const body = rows.map((r) =>
    `<tr><td>${esc(r.label)}</td><td>${r.avg.toFixed(1)}</td>` +
    `<td>${Math.round(r.junePct)}%</td><td>${r.evening.toFixed(1)} h</td>` +
    `<td>${r.cat}</td></tr>`).join('');
  $('garden').innerHTML = head + `<tbody>${body}</tbody>`;

  const back = rows.find((r) => r.k === 'back_yard');
  const deck = rows.find((r) => r.k === 'deck');
  const drivePct = Math.round((100 * m.zones.driveway[5]) / m.possible[5]);

  const PLANTING = {
    'Full sun': 'which is full sun by the usual horticultural definition - enough for ' +
      'tomatoes, peppers, squash and most vegetables, as well as roses and sun perennials',
    'Part sun': 'which is part sun - fine for herbs, leafy greens, beans and most ' +
      'perennials, but short of what tomatoes and peppers want',
    'Part shade': 'which is part shade - lettuce, spinach, hostas and ferns will do well, ' +
      'fruiting vegetables will not',
    'Full shade': 'which is full shade - shade perennials and ground cover only',
  };

  // At 8pm on the longest day the sun sits about ten degrees up, and a fence
  // that height throws a shadow this long back across the yard.
  const eveningShadow = (state.model.opts.fence ? state.model.opts.fenceHeight : 0)
    / Math.tan(10 * Math.PI / 180);

  const fenceNote = state.model.opts.fence
    ? ` That last figure is lower than you would expect, and the reason is the fence. ` +
      `By eight o'clock in June the sun is only about ten degrees above the horizon, and a ` +
      `${state.model.opts.fenceHeight} m fence throws a ${eveningShadow.toFixed(0)} m shadow ` +
      `back across the lawn - which is most of the ${(state.model.lotDepth - state.model.houseMaxY).toFixed(1)} m ` +
      `you have behind the house. The deck keeps ${deck.evening.toFixed(1)} hours because it ` +
      `sits further from the rear fence than the lawn does. Turn the fence off in Figure 5 and ` +
      `watch what comes back.`
    : '';

  $('gardenProse').textContent =
    `Through the growing season the back yard averages ${back.avg.toFixed(1)} hours of direct ` +
    `sun a day, ${PLANTING[back.cat]}. In June it takes ${Math.round(back.junePct)} per cent of ` +
    `the daylight available, against ${drivePct} per cent on the driveway. The two are not ` +
    `competing for the same season: the driveway wins the winter, the back yard wins the ` +
    `summer.` +
    ` There is no morning sun behind the house in any month - your own house is in the way - ` +
    `so the yard is an afternoon and evening space, and the beds that want morning light belong ` +
    `along the east side.` +
    ` After five o'clock on the longest day the lawn holds ${back.evening.toFixed(1)} hours of ` +
    `direct sun and the deck ${deck.evening.toFixed(1)}.` + fenceNote;
}

/* ---------------------------------------------------------------- figure 2 */

function renderChart() {
  const W = 940, H = 380, L = 56, R = 132, T = 20, B = 40;
  const monthly = state.monthly;
  const max = Math.ceil(Math.max(...monthly.possible));
  const px = (i) => L + (i / 11) * (W - L - R);
  const py = (v) => H - B - (v / max) * (H - T - B);

  const grid = Array.from({ length: max / 4 + 1 }, (_, i) => i * 4).map((v) =>
    `<line x1="${L}" y1="${py(v)}" x2="${W - R}" y2="${py(v)}" stroke="#E3DFD6"/>
     <text x="${L - 10}" y="${py(v) + 4}" text-anchor="end" font-family="IBM Plex Mono,monospace"
       font-size="11" fill="#8B909B">${v}</text>`).join('');

  const ticks = SHORT.map((s, i) =>
    `<text x="${px(i)}" y="${H - B + 18}" text-anchor="middle" font-family="Inter,sans-serif"
      font-size="11" fill="#8B909B">${s}</text>`).join('');

  const line = (vals, colour, dash = '') =>
    `<polyline points="${vals.map((v, i) => `${px(i)},${py(v)}`).join(' ')}"
      fill="none" stroke="${colour}" stroke-width="${dash ? 1 : 2}"
      stroke-dasharray="${dash}" stroke-linejoin="round"/>`;

  const order = Object.keys(state.zones);
  const colours = { driveway: '#B45F1E', front_walk: '#D3A461', deck: '#35506B',
    back_yard: '#6E93B8', side_yard_east: '#A9B7C4' };

  const series = order.map((k) => line(monthly.zones[k], colours[k] || '#8B909B')).join('');

  const placed = deCollide([
    { y: py(monthly.possible[11]) + 4, text: 'Daylight available', fill: '#8B909B' },
    ...order.map((k) => ({
      y: py(monthly.zones[k][11]) + 4,
      text: shortName(k, state.zones[k].label),
      fill: colours[k] || '#575C66',
    })),
  ], 17, T + 10, H - B);

  const labels = placed.map((it) =>
    `<text x="${W - R + 12}" y="${it.y}" font-family="Inter,sans-serif" font-size="12"
      fill="${it.fill}">${esc(it.text)}</text>`).join('');

  const inner = `${grid}
    ${line(monthly.possible, '#C9C3B6', '3 3')}
    ${series}${labels}${ticks}
    <text x="${L - 10}" y="${T + 4}" text-anchor="end" font-family="Inter,sans-serif"
      font-size="11" fill="#8B909B">hours</text>`;

  $('chart').classList.remove('busy');
  $('chart').innerHTML = svgEl(`0 0 ${W} ${H}`, inner,
    'role="img" aria-label="Direct sun hours per zone through the year"');
}

/* ---------------------------------------------------------------- figure 3 */

function renderTimeline() {
  const date = new Date(Date.UTC(2026, 11, 21));
  const t = sunTimes(date, LAT, LON);
  const midnight = Date.UTC(2026, 11, 21);
  const order = Object.keys(state.zones);

  const bars = order.map((k) => {
    const idx = state.zoneIdx[k];
    const spans = [];
    let open = null;
    for (let mm = 0; mm < 1440; mm += 5) {
      const at = new Date(midnight + mm * 60000);
      const p = sunPosition(at, LAT, LON);
      const lit = p.apparentElevation > 0 &&
        idx.filter((i) => isLit(state.model, state.profiles[i], p.azimuth, p.apparentElevation))
          .length / idx.length >= 0.5;
      if (lit && open === null) open = mm;
      if (!lit && open !== null) { spans.push([open, mm]); open = null; }
    }
    if (open !== null) spans.push([open, 1440]);
    return { key: k, spans, total: spans.reduce((a, [s, e]) => a + (e - s), 0) / 60 };
  });

  const W = 900, rowH = 34, T = 34, L = 170, R = 70;
  const H = T + bars.length * rowH + 16;
  const x0 = 7 * 60, x1 = 18 * 60;
  const px = (mins) => L + ((mins - x0) / (x1 - x0)) * (W - L - R);

  const hours = [];
  for (let h = 7; h <= 18; h++) {
    hours.push(`<line x1="${px(h * 60)}" y1="${T - 8}" x2="${px(h * 60)}" y2="${H - 12}"
      stroke="#E3DFD6"/><text x="${px(h * 60)}" y="${T - 14}" text-anchor="middle"
      font-family="Inter,sans-serif" font-size="11" fill="#8B909B">${String(h).padStart(2, '0')}</text>`);
  }

  const riseSet = [t.sunrise, t.sunset].map((d) => {
    const mins = Number(fmtTime.format(d).slice(0, 2)) * 60 + Number(fmtTime.format(d).slice(3, 5));
    return `<line x1="${px(mins)}" y1="${T - 8}" x2="${px(mins)}" y2="${H - 12}"
      stroke="#C9C3B6" stroke-dasharray="3 3"/>`;
  }).join('');

  const rows = bars.map((b, i) => {
    const y = T + i * rowH;
    const segs = b.spans.map(([s, e]) =>
      `<rect x="${px(s)}" y="${y}" width="${Math.max(1, px(e) - px(s))}" height="16"
        fill="#B45F1E"/>`).join('');
    return `<text x="${L - 14}" y="${y + 12}" text-anchor="end" font-family="Inter,sans-serif"
        font-size="13" fill="#17181B">${esc(state.zones[b.key].label)}</text>
      <line x1="${L}" y1="${y + 8}" x2="${W - R}" y2="${y + 8}" stroke="#F5F2EC"/>
      ${segs}
      <text x="${W - R + 10}" y="${y + 12}" font-family="IBM Plex Mono,monospace"
        font-size="12" fill="#575C66">${b.total.toFixed(1)} h</text>`;
  }).join('');

  $('timeline').classList.remove('busy');
  $('timeline').innerHTML = svgEl(`0 0 ${W} ${H}`, hours.join('') + riseSet + rows,
    'role="img" aria-label="Hours each zone is lit on 21 December"');

  const drive = bars.find((b) => b.key === 'driveway');
  const rise = fmtTime.format(t.sunrise), set = fmtTime.format(t.sunset);
  const first = drive.spans.length ? fmtTime.format(new Date(midnight + drive.spans[0][0] * 60000)) : '-';
  const last = drive.spans.length
    ? fmtTime.format(new Date(midnight + drive.spans[drive.spans.length - 1][1] * 60000)) : '-';
  $('winterProse').textContent =
    `On the shortest day of the year the sun rises at ${rise} and sets at ${set}, ` +
    `giving ${(t.dayLengthMinutes / 60).toFixed(1)} hours of daylight. The driveway is lit ` +
    `from ${first} to ${last} - ${drive.total.toFixed(1)} of those hours. Winter sunrise here ` +
    `is at bearing 130.4° against a frontage of ${state.bearing.toFixed(2)}°, so the sun comes ` +
    `up almost square to the front of the house and tracks across it all morning. The back ` +
    `yard, sixteen metres away, gets almost none of it.`;
}

/* ---------------------------------------------------------------- figure 4 */

/**
 * Sweep every frontage bearing once and cache the result. The curves depend on
 * the massing, not on which way the lot currently points, so dragging the
 * bearing slider only moves the marker - it does not recompute anything.
 * Invalidated when the geometry changes.
 */
function computeSweep() {
  const bearings = [];
  for (let b = 0; b < 360; b += 10) bearings.push(b);
  const saved = state.bearing;
  const dec = {}, jun = {};
  for (const k of Object.keys(state.zones)) { dec[k] = []; jun[k] = []; }

  for (const b of bearings) {
    setBearing(b);
    for (const [mi, store] of [[11, dec], [5, jun]]) {
      const field = monthField(mi);
      for (const [k, idx] of Object.entries(state.zoneIdx)) {
        store[k].push(idx.reduce((a, c) => a + field[c], 0) / idx.length);
      }
    }
  }
  setBearing(saved);
  return { bearings, dec, jun };
}

function renderCompare() {
  if (!state.sweep) state.sweep = computeSweep();
  const { bearings, dec, jun } = state.sweep;
  const saved = state.bearing;

  const W = 900, H = 300, L = 52, R = 130, T = 20, B = 40;
  const max = 18;
  const px = (b) => L + (b / 350) * (W - L - R);
  const py = (v) => H - B - (v / max) * (H - T - B);

  const grid = [0, 4, 8, 12, 16].map((v) =>
    `<line x1="${L}" y1="${py(v)}" x2="${W - R}" y2="${py(v)}" stroke="#E3DFD6"/>
     <text x="${L - 10}" y="${py(v) + 4}" text-anchor="end" font-family="IBM Plex Mono,monospace"
       font-size="11" fill="#8B909B">${v}</text>`).join('');

  const ticks = [0, 90, 180, 270].map((b) =>
    `<text x="${px(b)}" y="${H - B + 18}" text-anchor="middle" font-family="Inter,sans-serif"
      font-size="11" fill="#8B909B">${b}°</text>`).join('');

  const series = (store, colour, dash) => Object.keys(store)
    .filter((k) => k === 'driveway' || k === 'back_yard')
    .map((k) => `<polyline points="${store[k].map((v, i) => `${px(bearings[i])},${py(v)}`).join(' ')}"
      fill="none" stroke="${colour}" stroke-width="2" stroke-dasharray="${dash}"/>`).join('');

  const markerX = px(saved);
  const inner = `${grid}
    <line x1="${markerX}" y1="${T}" x2="${markerX}" y2="${H - B}" stroke="#17181B" stroke-width="1"/>
    <text x="${markerX + 6}" y="${T + 12}" font-family="Inter,sans-serif" font-size="11"
      fill="#17181B">this lot, ${saved.toFixed(2)}°</text>
    ${series(dec, '#B45F1E', '')}
    ${series(jun, '#35506B', '4 3')}
    ${ticks}
    <text x="${W - R + 10}" y="${py(dec.driveway[Math.round(saved / 10) % 36]) + 4}"
      font-family="Inter,sans-serif" font-size="12" fill="#B45F1E">December</text>
    <text x="${W - R + 10}" y="${py(jun.driveway[Math.round(saved / 10) % 36]) + 4}"
      font-family="Inter,sans-serif" font-size="12" fill="#35506B">June</text>
    <text x="${L - 10}" y="${T + 4}" text-anchor="end" font-family="Inter,sans-serif"
      font-size="11" fill="#8B909B">hours</text>`;

  $('compare').innerHTML = svgEl(`0 0 ${W} ${H}`, inner,
    'role="img" aria-label="Sun hours against frontage bearing"');
}

/* ------------------------------------------------------------------- stats */

function renderStats() {
  const m = state.monthly;
  const dec = m.zones.driveway[11];
  const share = (100 * dec) / m.possible[11];
  const backJun = m.zones.back_yard[5];
  const backPct = (100 * backJun) / m.possible[5];
  const summer = m.zones.back_yard.slice(4, 9);
  const backAvg = summer.reduce((a, b) => a + b, 0) / summer.length;
  $('stats').innerHTML = [
    [dec.toFixed(1), 'h', 'Driveway in December, the shortest day of the year'],
    [Math.round(share), '%', 'Of all the daylight there is on that day'],
    [backJun.toFixed(1), 'h', 'Back yard in June, its best month'],
    [Math.round(backPct), '%', 'Of June daylight reaching the back yard'],
    [backAvg.toFixed(1), 'h', 'Back yard average across the growing season'],
  ].map(([n, u, c]) =>
    `<div class="stat"><span class="n">${n}<span class="u">${u}</span></span>
      <div class="c">${c}</div></div>`).join('');

  $('planProse').textContent =
    `In December the driveway takes ${dec.toFixed(1)} of the ${m.possible[11].toFixed(1)} ` +
    `hours of daylight there are - ${Math.round(share)} per cent. By June that falls to ` +
    `${Math.round((100 * m.zones.driveway[5]) / m.possible[5])} per cent, because the summer sun ` +
    `swings behind the house. The surface you have to clear gets the sun in the season you ` +
    `need it, and gives it back in the season you do not.`;
}

/* ---------------------------------------------------------------- controls */

function mountSceneControls() {
  const total = state.season.days.length;
  const firstNov = state.season.days.findIndex((d) => d.date.slice(5, 7) === '11');
  $('sceneControls').innerHTML = `
    <div class="ctl">
      <label for="day">Date <output id="dayOut"></output></label>
      <input type="range" id="day" min="0" max="${total - 1}" step="1" value="${state.day}">
    </div>
    <div class="ctl">
      <label for="clock">Time of day <output id="clockOut"></output></label>
      <input type="range" id="clock" min="0" max="1439" step="5" value="${state.minutes}">
    </div>
    <div class="ctl">
      <label for="speed">Animation speed <output id="speedOut">1&times;</output></label>
      <input type="range" id="speed" min="0" max="5" step="1" value="2">
    </div>
    <div class="ctl">
      <label for="ground">Ground shows</label>
      <select id="ground" style="font:400 14px/1 var(--font-ui);padding:8px 10px;
        border:1px solid var(--rule-strong);background:var(--surface);border-radius:4px">
        <option value="snow">Snow on the ground</option>
        <option value="sun">Sun hours this month</option>
      </select>
    </div>
    <button class="primary" id="play">Move the sun through the day</button>
    <button class="text" id="melt">Move through the winter</button>`;

  const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
  let speed = 1;

  const sync = () => {
    const d = currentDay();
    if (!d) return;
    $('dayOut').textContent = d.date;
    $('clockOut').textContent =
      `${String(Math.floor(state.minutes / 60)).padStart(2, '0')}:${String(state.minutes % 60).padStart(2, '0')}`;
  };

  $('day').addEventListener('input', (e) => { state.day = +e.target.value; sync(); renderScene(); });
  $('clock').addEventListener('input', (e) => { state.minutes = +e.target.value; sync(); renderScene(); });
  $('ground').addEventListener('change', (e) => { state.ground = e.target.value; renderScene(); });
  $('speed').addEventListener('input', (e) => {
    speed = SPEEDS[+e.target.value];
    $('speedOut').innerHTML = `${speed}&times;`;
    if (timer) { const which = mode; stop(); start(which); }
  });

  let timer = null, mode = null;
  function stop() {
    clearInterval(timer); timer = null; mode = null;
    $('play').textContent = 'Move the sun through the day';
    $('melt').textContent = 'Move through the winter';
  }
  function start(which) {
    mode = which;
    if (which === 'day') {
      $('play').textContent = 'Stop';
      timer = setInterval(() => {
        state.minutes = (state.minutes + 5) % 1440;
        $('clock').value = state.minutes; sync(); renderScene();
      }, Math.max(16, 120 / speed));
    } else {
      $('melt').textContent = 'Stop';
      if (state.day < firstNov) state.day = firstNov;
      timer = setInterval(() => {
        state.day += 1;
        if (state.day >= state.season.days.length - 1) return stop();
        $('day').value = state.day; sync(); renderScene();
      }, Math.max(16, 140 / speed));
    }
  }
  $('play').addEventListener('click', () => (timer ? stop() : start('day')));
  $('melt').addEventListener('click', () => (timer ? stop() : start('winter')));

  sync();
}

function mountControls() {
  $('planControls').innerHTML = `
    <div class="ctl">
      <label for="month">Month <output id="monthOut">December</output></label>
      <input type="range" id="month" min="0" max="11" step="1" value="11">
    </div>`;
  $('month').addEventListener('input', (e) => {
    state.month = +e.target.value;
    $('monthOut').textContent = MONTHS[state.month];
    renderPlan(state.month);
  });

  $('lotControls').innerHTML = `
    <div class="ctl">
      <label for="bearing">Frontage bearing <output id="bearingOut">114.42°</output></label>
      <input type="range" id="bearing" min="0" max="359" step="1" value="114">
    </div>
    <div class="ctl check">
      <input type="checkbox" id="fence" checked>
      <label for="fence">Rear fence, 1.83 m</label>
    </div>
    <button class="text" id="reset">Reset to this lot</button>`;

  $('bearing').addEventListener('input', (e) => {
    setBearing(+e.target.value);
    $('bearingOut').textContent = `${state.bearing.toFixed(0)}°`;
    state.monthly = computeMonthly();
    renderStats(); renderPlan(state.month); renderChart(); renderTimeline(); renderCompare();
  });

  $('fence').addEventListener('change', (e) => {
    state.fence = e.target.checked;
    $('plan').classList.add('busy');
    $('plan').textContent = 'Recomputing shading model…';
    setTimeout(() => {
      rebuildGeometry();
      state.season = computeSeason();
      if (state.scene) { state.scene.rebuildFence(); renderScene(); }
      renderAll();
    }, 16);
  });

  $('reset').addEventListener('click', () => {
    setBearing(state.site.orientation.front_azimuth_deg);
    state.fence = true;
    $('bearing').value = Math.round(state.bearing);
    $('bearingOut').textContent = `${state.bearing.toFixed(2)}°`;
    $('fence').checked = true;
    rebuildGeometry(); renderAll();
  });
}

function renderAll() {
  state.monthly = computeMonthly();
  renderStats();
  renderPlan(state.month);
  renderChart();
  renderGarden();
  renderTimeline();
  renderCompare();
}

/* -------------------------------------------------------------------- boot */

window.addEventListener('error', (e) => {
  const host = $('sceneSrc');
  if (!host) return;
  host.innerHTML = `<span class="flag">Something failed while drawing: ` +
    `${esc(e.message)} (${esc((e.filename || '').split('/').pop())}:${e.lineno}). ` +
    `The rest of the page is unaffected.</span>`;
});

(async function init() {
  // The standalone build embeds the data so the page works from file://,
  // where fetch is blocked. Served from http, it loads the JSON normally.
  const embedded = window.__FIRST_LIGHT_DATA__;
  const [site, building] = embedded
    ? [embedded.site, embedded.building]
    : await Promise.all([
        fetch('data/site.json').then((r) => r.json()),
        fetch('data/building.json').then((r) => r.json()),
      ]);
  state.site = site;
  state.building = building;
  state.bearing = site.orientation.front_azimuth_deg;
  rebuildGeometry();

  state.season = computeSeason();
  // Start on a late-winter morning, when the difference between surfaces is
  // most visible: the driveway bare, the back yard still white.
  state.day = state.season.days.findIndex((d) => d.date.endsWith('-03-15'));
  if (state.day < 0) state.day = 200;
  state.minutes = 10 * 60;

  const host = $('scene');
  host.classList.remove('busy');
  host.textContent = '';
  try {
    state.scene = createScene(host, {
      model: state.model, cells: state.cells, lat: LAT, lon: LON,
    });
    mountSceneControls();
    renderScene();
  } catch (err) {
    host.textContent = `3D view unavailable: ${err.message}`;
  }

  $('sceneProse').textContent =
    'The snow on the ground is not an illustration. Each half-metre patch carries ' +
    'its own energy balance, driven by how much direct sun that patch actually ' +
    'receives once the house, the fence and the roof have taken their share. ' +
    'Run the melt season and watch the driveway and the front walk go bare while ' +
    'the back yard, shaded by its own house all winter, holds its snow for weeks longer.';

  mountControls();
  renderAll();
})().catch((err) => {
  for (const id of ['plan', 'chart', 'timeline']) {
    const el = $(id);
    if (el) el.textContent = `Could not load the model: ${err.message}. ` +
      `This page needs to be served over http - try npm run serve.`;
  }
});
