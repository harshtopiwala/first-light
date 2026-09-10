/**
 * Snowpack and melt, per patch of ground.
 *
 * A plain degree-day model melts every square metre of a property at the same
 * rate, which is the thing we are trying to disprove. This is a surface energy
 * balance instead, because it can be checked against physics rather than
 * against a tuned coefficient:
 *
 *   melt energy  Q = (1 - albedo) * (direct + diffuse * skyView)   shortwave
 *                  + c0 + c1 * T                                   the rest
 *   melt depth   M = max(0, Q) * 86400 / 334000                    mm w.e./day
 *
 * 334 kJ is what it takes to melt a kilogram of ice, and a kilogram of water
 * spread over a square metre is one millimetre. So the conversion is not a
 * fitted parameter, it is the latent heat of fusion.
 *
 * The shortwave term is where the geometry enters: the shading engine gives a
 * different direct-beam figure for every cell, so the driveway and the shaded
 * back yard receive genuinely different amounts of energy on the same day.
 *
 * The second term lumps together net longwave, sensible and latent heat, which
 * a full energy balance would need humidity, wind and cloud base to resolve.
 * Linearising them against air temperature is the standard simplification and
 * is where most of this model's uncertainty lives; c0 and c1 are stated here
 * rather than buried so they can be argued with.
 */

/** Latent heat of fusion, expressed as the energy needed per mm of melt. */
const ENERGY_PER_MM = 334000; // J per m^2 per mm water equivalent

/** Net longwave loss under an open winter sky, W/m^2. */
export const LONGWAVE_OFFSET = -20;

/** Combined turbulent and longwave sensitivity to air temperature, W/m^2/degC. */
export const TEMPERATURE_COEFF = 12;

/** Albedo of snow: fresh, fully aged, and the e-folding time in days. */
export const ALBEDO_FRESH = 0.85;
export const ALBEDO_AGED = 0.50;
export const ALBEDO_DECAY_DAYS = 8;

/** A snowfall of at least this much water equivalent resets the surface. */
const REFRESH_MM = 2.0;

/** Albedo of the ground under the snow: dark, whether paving or wet turf. */
export const ALBEDO_GROUND = 0.20;

/**
 * Water equivalent above which a patch is continuous white. Below it the pack
 * goes patchy and bare ground starts showing through.
 *
 * This threshold is what makes a sunny surface clear weeks before a shaded one
 * rather than a day before. Melt lowers the pack, the pack goes patchy, the
 * effective albedo collapses from about 0.7 toward 0.2, and the surface starts
 * absorbing three times the energy it did - so it runs away. The shaded yard
 * never reaches the threshold, stays uniformly white, and keeps reflecting.
 * Without this feedback every surface on the property melts together, which is
 * not what an Edmonton spring looks like.
 */
export const SNOW_FULL_COVER_MM = 15;

const RAIN_THRESHOLD = 2.0;
const SNOW_THRESHOLD = 0.0;

/** Fraction of a day's precipitation falling as snow. */
export function snowFraction(tMean) {
  if (tMean <= SNOW_THRESHOLD) return 1;
  if (tMean >= RAIN_THRESHOLD) return 0;
  return (RAIN_THRESHOLD - tMean) / (RAIN_THRESHOLD - SNOW_THRESHOLD);
}

export function albedoFor(ageDays) {
  return ALBEDO_AGED + (ALBEDO_FRESH - ALBEDO_AGED) * Math.exp(-ageDays / ALBEDO_DECAY_DAYS);
}

/**
 * Run one snow year, cell by cell.
 *
 * @param {Array} days   daily weather in order, ideally August to July so the
 *                       accumulation season is not split by the calendar
 * @param {object} rad
 * @param {Array<Float32Array>} rad.direct  [day][cell] potential direct beam on
 *                              the horizontal, daily mean W/m^2
 * @param {Float32Array} rad.diffuse        [day] clear-sky diffuse, W/m^2
 * @param {Float32Array} rad.skyView        [cell] sky view factor
 * @param {Float32Array} rad.cloudFactor    [day] measured over clear-sky radiation
 */
export function runSeason(days, rad, cellCount) {
  const swe = new Float32Array(cellCount);
  const peak = new Float32Array(cellCount);
  const snowDays = new Int16Array(cellCount);
  const meltOut = new Int16Array(cellCount).fill(-1);
  const hadPack = new Uint8Array(cellCount);
  const sweByDay = [];
  let age = 0;

  for (let d = 0; d < days.length; d++) {
    const { tMean, precipMm } = days[d];
    const accumulation = precipMm * snowFraction(tMean);
    age = accumulation >= REFRESH_MM ? 0 : age + 1;

    const snowAlbedo = albedoFor(age);
    const cloud = rad.cloudFactor[d];
    const direct = rad.direct[d];
    const diffuse = rad.diffuse[d];
    const thermal = LONGWAVE_OFFSET + TEMPERATURE_COEFF * tMean;

    for (let c = 0; c < cellCount; c++) {
      if (accumulation > 0) swe[c] += accumulation;

      if (swe[c] > 0) {
        // Fractional snow cover, and the albedo that follows from it.
        const cover = Math.min(1, swe[c] / SNOW_FULL_COVER_MM);
        const albedo = cover * snowAlbedo + (1 - cover) * ALBEDO_GROUND;
        const shortwave = (1 - albedo) * cloud * (direct[c] + diffuse * rad.skyView[c]);
        const q = shortwave + thermal;
        if (q > 0) swe[c] = Math.max(0, swe[c] - (q * 86400) / ENERGY_PER_MM);
      }

      if (swe[c] > peak[c]) peak[c] = swe[c];
      if (swe[c] > 0) {
        snowDays[c]++;
        if (swe[c] > 20) hadPack[c] = 1;
        meltOut[c] = -1; // must be the final clearing, not a midwinter thaw
      } else if (hadPack[c] && meltOut[c] === -1) {
        meltOut[c] = d;
      }
    }
    sweByDay.push(Float32Array.from(swe));
  }

  return { sweByDay, meltOutDayIndex: meltOut, snowDays, peakSweMm: peak };
}

/**
 * Days when meltwater is likely to refreeze overnight: snow on the ground, the
 * day above freezing, the night below it. This is what turns a sunny driveway
 * into an ice rink, so melting early is only an advantage if the surface also
 * drains.
 */
export function freezeThawDays(days, sweByDay, cellIndices) {
  let count = 0;
  for (let d = 0; d < days.length; d++) {
    if (!(days[d].tMax > 0 && days[d].tMin < 0)) continue;
    if (cellIndices.some((c) => sweByDay[d][c] > 0)) count++;
  }
  return count;
}

/** Melt-out statistics over a set of cells. */
export function zoneMeltOut(meltOutDayIndex, cellIndices) {
  const vals = cellIndices.map((c) => meltOutDayIndex[c]).filter((v) => v >= 0);
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  return {
    median: vals[Math.floor(vals.length / 2)],
    earliest: vals[0],
    latest: vals[vals.length - 1],
    clearedFraction: vals.length / cellIndices.length,
  };
}
