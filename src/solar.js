/**
 * Solar position and event times.
 *
 * Implements the NOAA solar calculator (Meeus, "Astronomical Algorithms",
 * ch. 25 and 28) rather than the usual day-of-year cosine approximation.
 * The difference matters at this latitude: the cosine form errs by up to
 * half a degree in declination, and dropping the equation of time shifts
 * clock times by up to a quarter of an hour, which is enough to move a
 * shadow edge several metres across a 35 m lot.
 *
 * Angles are degrees. Azimuth is measured clockwise from true north.
 * Times are JavaScript Date objects in UTC; local presentation is the
 * caller's problem.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Apparent elevation of the solar centre at sunrise/sunset: half the solar
 *  disc (0.267°) plus mean atmospheric refraction at the horizon (0.567°). */
export const SUNRISE_ELEVATION = -0.833;

export function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

export function julianCentury(jd) {
  return (jd - 2451545) / 36525;
}

const geomMeanLongSun = (t) =>
  (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;

const geomMeanAnomSun = (t) => 357.52911 + t * (35999.05029 - 0.0001537 * t);

const eccentEarthOrbit = (t) => 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

function sunEqOfCentre(t) {
  const m = geomMeanAnomSun(t) * RAD;
  return (
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289
  );
}

const sunTrueLong = (t) => geomMeanLongSun(t) + sunEqOfCentre(t);

const sunAppLong = (t) =>
  sunTrueLong(t) - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * t) * RAD);

const meanObliqEcliptic = (t) =>
  23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;

const obliqCorr = (t) =>
  meanObliqEcliptic(t) + 0.00256 * Math.cos((125.04 - 1934.136 * t) * RAD);

/** Solar declination, degrees. */
export function declination(t) {
  return Math.asin(Math.sin(obliqCorr(t) * RAD) * Math.sin(sunAppLong(t) * RAD)) * DEG;
}

/** Equation of time, minutes (apparent solar time minus mean solar time). */
export function equationOfTime(t) {
  const eps = obliqCorr(t) * RAD;
  const l0 = geomMeanLongSun(t) * RAD;
  const e = eccentEarthOrbit(t);
  const m = geomMeanAnomSun(t) * RAD;
  const y = Math.tan(eps / 2) ** 2;

  const etime =
    y * Math.sin(2 * l0) -
    2 * e * Math.sin(m) +
    4 * e * y * Math.sin(m) * Math.cos(2 * l0) -
    0.5 * y * y * Math.sin(4 * l0) -
    1.25 * e * e * Math.sin(2 * m);

  return 4 * etime * DEG;
}

/** Atmospheric refraction correction, degrees, for a true elevation. */
export function refraction(elevation) {
  if (elevation > 85) return 0;
  const te = Math.tan(elevation * RAD);
  let r;
  if (elevation > 5) {
    r = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  } else if (elevation > -0.575) {
    r = 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
  } else {
    r = -20.772 / te;
  }
  return r / 3600;
}

/**
 * Horizon dip from observer elevation above sea level, degrees.
 * Adds a few minutes of daylight at Edmonton's ~700 m.
 */
export function horizonDip(elevationMetres = 0) {
  return elevationMetres > 0 ? 0.0347 * Math.sqrt(elevationMetres) : 0;
}

/**
 * Sun position for an instant.
 * @returns {{elevation:number, apparentElevation:number, azimuth:number,
 *            declination:number, equationOfTime:number, hourAngle:number}}
 */
export function sunPosition(date, latitude, longitude) {
  const t = julianCentury(julianDay(date));
  const decl = declination(t);
  const eqTime = equationOfTime(t);

  // Minutes past local midnight, UTC-based.
  const utcMinutes =
    date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;

  let trueSolarTime = (utcMinutes + eqTime + 4 * longitude) % 1440;
  if (trueSolarTime < 0) trueSolarTime += 1440;

  let hourAngle = trueSolarTime / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;

  const latR = latitude * RAD;
  const declR = decl * RAD;
  const haR = hourAngle * RAD;

  const cosZenith =
    Math.sin(latR) * Math.sin(declR) + Math.cos(latR) * Math.cos(declR) * Math.cos(haR);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith))) * DEG;
  const elevation = 90 - zenith;

  let azimuth;
  const denom = Math.cos(latR) * Math.sin(zenith * RAD);
  if (Math.abs(denom) > 1e-9) {
    let c = (Math.sin(latR) * Math.cos(zenith * RAD) - Math.sin(declR)) / denom;
    c = Math.min(1, Math.max(-1, c));
    azimuth = hourAngle > 0 ? (Math.acos(c) * DEG + 180) % 360 : (540 - Math.acos(c) * DEG) % 360;
  } else {
    azimuth = latitude > 0 ? 180 : 0;
  }

  return {
    elevation,
    apparentElevation: elevation + refraction(elevation),
    azimuth,
    declination: decl,
    equationOfTime: eqTime,
    hourAngle,
  };
}

/** Hour angle at which the sun reaches a given elevation, degrees, or null. */
function hourAngleAtElevation(latitude, decl, targetElevation) {
  const latR = latitude * RAD;
  const declR = decl * RAD;
  const cosH =
    (Math.cos((90 - targetElevation) * RAD) - Math.sin(latR) * Math.sin(declR)) /
    (Math.cos(latR) * Math.cos(declR));
  if (cosH > 1 || cosH < -1) return null; // sun stays below / above all day
  return Math.acos(cosH) * DEG;
}

function utcMidnight(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Sunrise, solar noon and sunset for a calendar day.
 *
 * The hour angle is solved at local solar noon and then refined once at the
 * event time, because declination moves measurably across a long summer day
 * at this latitude.
 *
 * @param {Date} date        any instant on the day of interest (UTC date part)
 * @param {number} latitude  degrees north
 * @param {number} longitude degrees east (negative for west)
 * @param {number} elevationMetres observer elevation above sea level
 * @returns {{sunrise:Date|null, solarNoon:Date, sunset:Date|null,
 *            dayLengthMinutes:number, polar:'day'|'night'|null}}
 */
export function sunTimes(date, latitude, longitude, elevationMetres = 0) {
  const midnight = utcMidnight(date);
  const target = SUNRISE_ELEVATION - horizonDip(elevationMetres);

  const noonGuess = julianCentury(julianDay(new Date(midnight + 12 * 3600000)));
  const solarNoonMinutes = 720 - 4 * longitude - equationOfTime(noonGuess);
  const solarNoon = new Date(midnight + solarNoonMinutes * 60000);

  const solveEvent = (sign) => {
    let minutes = solarNoonMinutes;
    for (let i = 0; i < 2; i++) {
      const t = julianCentury(julianDay(new Date(midnight + minutes * 60000)));
      const ha = hourAngleAtElevation(latitude, declination(t), target);
      if (ha === null) return null;
      minutes = 720 - 4 * (longitude + sign * ha) - equationOfTime(t);
    }
    return new Date(midnight + minutes * 60000);
  };

  const sunrise = solveEvent(1);
  const sunset = solveEvent(-1);

  let polar = null;
  if (sunrise === null) {
    const t = julianCentury(julianDay(solarNoon));
    polar = 90 - Math.abs(latitude - declination(t)) > target ? 'day' : 'night';
  }

  return {
    sunrise,
    solarNoon,
    sunset,
    dayLengthMinutes:
      sunrise && sunset ? (sunset - sunrise) / 60000 : polar === 'day' ? 1440 : 0,
    polar,
  };
}

/**
 * Sample the sun's track across a day at a fixed cadence.
 * Returns only steps where the sun is above the horizon.
 */
export function sunTrack(date, latitude, longitude, stepMinutes = 10) {
  const midnight = utcMidnight(date);
  const out = [];
  for (let m = 0; m < 1440; m += stepMinutes) {
    const at = new Date(midnight + m * 60000);
    const p = sunPosition(at, latitude, longitude);
    if (p.apparentElevation > 0) out.push({ time: at, ...p });
  }
  return out;
}
