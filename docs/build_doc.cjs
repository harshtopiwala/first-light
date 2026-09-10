/**
 * Build the First Light documentation as a .docx.
 * Run: node docs/build_doc.mjs
 */
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, ImageRun,
  TableOfContents, PageOrientation, Footer, PageNumber,
} = require('docx');
const fs = require('fs');
const path = require('path');

const FIG = path.join(__dirname, 'figures');
const INK = '17181B', INK2 = '575C66', INK3 = '8B909B';
const SUN = 'B45F1E', RULE = 'E3DFD6', BAND = 'F5F2EC', WARN = '8A5A1B';
const CONTENT_W = 9360; // Letter, 1in margins, in DXA

const P = (text, o = {}) => new Paragraph({
  spacing: { after: o.after ?? 140, line: 280 },
  alignment: o.align,
  indent: o.indent,
  children: [new TextRun({ text, size: o.size ?? 21, color: o.color ?? INK,
    bold: o.bold, italics: o.italics, font: o.font })],
});

const Rich = (runs, o = {}) => new Paragraph({
  spacing: { after: o.after ?? 140, line: 280 },
  children: runs.map((r) => typeof r === 'string'
    ? new TextRun({ text: r, size: 21, color: INK })
    : new TextRun({ size: 21, color: INK, ...r })),
});

const H1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 180 },
  children: [new TextRun({ text, size: 30, bold: true, color: INK })],
});
const H2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2, spacing: { before: 260, after: 120 },
  children: [new TextRun({ text, size: 24, bold: true, color: INK })],
});
const H3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 },
  children: [new TextRun({ text, size: 22, bold: true, color: INK2 })],
});

const Bullet = (text) => new Paragraph({
  bullet: { level: 0 }, spacing: { after: 80, line: 280 },
  children: [new TextRun({ text, size: 21, color: INK })],
});

const Code = (lines) => lines.map((l, i) => new Paragraph({
  spacing: { after: i === lines.length - 1 ? 160 : 0, line: 240 },
  shading: { type: ShadingType.CLEAR, fill: BAND },
  indent: { left: 180, right: 180 },
  children: [new TextRun({ text: l || ' ', font: 'Consolas', size: 17, color: INK })],
}));

function Figure(file, caption, widthIn = 6.4) {
  const buf = fs.readFileSync(path.join(FIG, file));
  const dim = pngSize(buf);
  const w = widthIn * 96;
  const h = Math.round(w * (dim.h / dim.w));
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 },
      children: [new ImageRun({ data: buf, type: 'png', transformation: { width: w, height: h } })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 220 },
      children: [new TextRun({ text: caption, size: 17, italics: true, color: INK2 })],
    }),
  ];
}

function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function DataTable(headers, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const scale = CONTENT_W / total;
  const cols = widths.map((w) => Math.round(w * scale));
  const cell = (text, i, opts = {}) => new TableCell({
    width: { size: cols[i], type: WidthType.DXA },
    shading: opts.head ? { type: ShadingType.CLEAR, fill: opts.head } : undefined,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    children: [new Paragraph({
      spacing: { after: 0, line: 240 },
      children: [new TextRun({
        text: String(text), size: 18, bold: opts.bold,
        color: opts.color ?? INK, font: opts.mono ? 'Consolas' : undefined,
      })],
    })],
  });
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: cols,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => cell(h, i, { head: BAND, bold: true, color: INK2 })),
      }),
      ...rows.map((r) => new TableRow({
        children: r.map((v, i) => cell(v, i, { mono: i > 0 })),
      })),
    ],
  });
}

function Callout(title, lines) {
  const make = (text, bold) => new Paragraph({
    spacing: { after: 80, line: 270 },
    indent: { left: 200 },
    border: { left: { style: BorderStyle.SINGLE, size: 14, color: SUN, space: 10 } },
    shading: { type: ShadingType.CLEAR, fill: 'FBF6EF' },
    children: [new TextRun({ text, size: 20, bold, color: bold ? WARN : INK })],
  });
  return [make(title, true), ...lines.map((l) => make(l, false)),
    new Paragraph({ spacing: { after: 160 }, children: [] })];
}

// ---------------------------------------------------------------------------

const children = [];

// ---- title page
children.push(
  new Paragraph({ spacing: { before: 1800, after: 0 }, children: [
    new TextRun({ text: 'First Light', size: 56, bold: true, color: INK })] }),
  new Paragraph({ spacing: { after: 320 }, children: [
    new TextRun({ text: 'A sun, shade and snowmelt study for a single lot', size: 30, color: INK2 })] }),
  P('Working out which windows get the winter sun, whether the driveway clears itself, and when the back yard is usable - from the survey drawings and the historical weather record.', { size: 22, color: INK2 }),
  new Paragraph({ spacing: { before: 260, after: 0 }, children: [
    new TextRun({ text: 'JavaScript  \u00b7  Python  \u00b7  three.js  \u00b7  NOAA solar position  \u00b7  Open-Meteo', size: 19, color: INK3 })] }),
  new Paragraph({ spacing: { before: 900, after: 0 }, children: [
    new TextRun({ text: 'Author: Harsh Topiwala', size: 21, color: INK })] }),
  new Paragraph({ spacing: { after: 0 }, children: [
    new TextRun({ text: 'Repository: to be published', size: 21, color: INK2 })] }),
  new Paragraph({ spacing: { after: 0 }, children: [
    new TextRun({ text: 'September 2026', size: 21, color: INK2 })] }),
  new Paragraph({ children: [new PageBreak()] }),
);

// ---- contents
children.push(H1('Contents'));
children.push(new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// ---- 1
children.push(H1('1. The Problem'));
children.push(P('Buying a house from a plan in Canada means committing to an orientation before anything is built. You choose a lot from a subdivision map, sign, and wait a year. Which rooms get morning light, whether the driveway clears itself after a snowfall, when the back yard becomes usable again in spring - all of it is fixed the moment you pick the lot, and none of it appears on a feature sheet.'));
children.push(P('The seasons are more pronounced here than the marketing material suggests. Edmonton sits at 53.4 degrees north. On the shortest day of the year there are seven and a half hours of daylight and the sun never climbs higher than thirteen degrees above the horizon; on the longest there are seventeen hours and it reaches sixty. A house that is bright and warm in July can be a north-facing box in January, and the difference is entirely a function of which way the lot points.'));
children.push(P('Show homes are built on show lots. The one you buy is a rectangle on a plan with a bearing you were never told, and the questions that actually matter about it - how many hours of sun does the driveway get in December, is the back yard bright enough to grow vegetables, will the deck be usable at seven in the evening in June - have numerical answers that nobody computes for you.'));
children.push(P('This project computes them. It reads the survey drawings, works out the true solar geometry for the site, and produces per-surface answers with the assumptions stated and their sensitivities measured.'));

children.push(H2('Why this matters beyond one lot'));
children.push(P('The same method applies to any new-build lot anywhere. The inputs are a frontage bearing, a latitude, and the dimensions of the lot and the house, all of which appear on documents a buyer already has. The tool is parameterised so that turning the frontage recomputes everything, which means the question "would a different lot in this subdivision have been better?" becomes answerable rather than a matter of opinion.'));

// ---- 2
children.push(H1('2. What the Project Does'));
children.push(P('The tool takes the survey drawings for a lot and produces, for every half-metre patch of open ground on it, the number of hours of direct sun that patch receives on any day of the year, together with a snowpack model for the winter.'));
children.push(H3('Input'));
children.push(Bullet('A preliminary plot plan as a vector PDF, which carries the lot boundary, the house footprint, the setbacks and a north arrow.'));
children.push(Bullet('The builder\u2019s architectural elevation set, which carries the heights.'));
children.push(Bullet('Latitude and longitude, to about a hundred metres.'));
children.push(H3('Output'));
children.push(Bullet('Per-zone direct sun hours for every month, against the daylight available that day.'));
children.push(Bullet('Growing-season averages classified into the standard horticultural bands, and evening sun after 5pm on the longest day.'));
children.push(Bullet('A daily snowpack for each patch of ground through the winter, driven by the sun each patch actually receives.'));
children.push(Bullet('An interactive 3D report that runs in a browser with no server and no build tooling.'));
children.push(P('Everything is computed from first principles at run time. There are no precomputed numbers pasted into the page.'));

// ---- 3
children.push(H1('3. Results'));
children.push(P('The lot studied is a zero-lot-line skinny home on a 8.922 by 35.001 metre parcel in southwest Edmonton, with a frontage bearing of 114.42 degrees - east-south-east.'));
children.push(...Figure('1788993541597_image.png', 'Figure 1 - The headline result, computed in the browser at page load.', 5.6));

children.push(H2('The three findings'));
children.push(Rich([{ text: 'The driveway faces the winter sunrise. ', bold: true },
  'In December it receives 7.3 of the 7.5 hours of daylight that exist - 96 per cent. It is lit from 08:55 to 16:20, against a sunrise of 08:48 and a sunset of 16:17. Winter sunrise here is at bearing 130.4 degrees against a frontage of 114.42, so the sun comes up almost square to the front of the house and tracks across it all morning. The surface that has to be shovelled is the one surface pointed at the winter sun.']));
children.push(Rich([{ text: 'The seasons invert, in the right direction. ', bold: true },
  'By June the driveway drops to 70 per cent of available daylight while the back yard rises to 44 per cent. The two surfaces are not competing for the same season: the driveway wins the winter, when clearing it matters, and gives the sun back in the summer, when it does not.']));
children.push(Rich([{ text: 'Every window faces front or back. ', bold: true },
  'Both long elevations of this house are blank - soffit vents and nothing else. On a zero-lot-line home the frontage bearing is not one input among many; it is the only thing that determines interior daylight, because there is no side glazing to compensate with.']));

children.push(...Figure('fig2_plan_heatmap.png', 'Figure 2 - Direct sun hours on open ground at half-metre resolution. The same lot, six months apart.', 5.2));

children.push(H2('Sun hours by zone'));
children.push(DataTable(
  ['Zone', 'Dec', 'Mar', 'Jun', 'Sep', 'May-Sep avg', 'Evening after 5pm, Jun'],
  [
    ['Daylight available', '7.5', '11.8', '17.0', '12.7', '15.5', '-'],
    ['Driveway', '7.3', '9.9', '11.9', '10.3', '11.3', '0.0'],
    ['Front walk', '7.5', '11.7', '15.0', '12.7', '14.3', '3.2'],
    ['Rear deck', '0.0', '2.2', '7.0', '3.1', '5.6', '3.0'],
    ['Back yard', '0.5', '3.6', '7.4', '4.1', '6.2', '0.3'],
    ['East side yard', '0.3', '2.5', '7.7', '3.2', '5.8', '1.0'],
  ], [2600, 800, 800, 800, 800, 1400, 2160]));
children.push(new Paragraph({ spacing: { before: 100, after: 200 }, children: [
  new TextRun({ text: 'Hours of direct sun on a clear day. Cloud reduces all of these proportionally; the ranking between zones does not change.', size: 17, italics: true, color: INK2 })] }));

children.push(...Figure('fig3_monthly_hours.png', 'Figure 3 - Direct sun through the year, by zone, against the daylight available that day.', 6.2));

children.push(H2('Two results that were not part of the original goal'));
children.push(Rich([{ text: 'The lot is within 0.2 hours of the best possible orientation. ', bold: true },
  'Sweeping all 360 degrees of frontage bearing, December driveway sun peaks at 7.5 hours across a broad plateau from roughly 150 to 210 degrees. This lot, at 114.42, gets 7.3. A north-facing frontage would get 1.8. So the orientation is worth 5.5 hours of December sun over the worst case, and it sits essentially at the optimum.']));
children.push(Rich([{ text: 'And it is better than due south. ', bold: true },
  'A due-south frontage gets the same 7.5 hours in December but 15.4 in June. This lot gets 11.9. It takes near-maximum winter sun on the driveway while shedding three and a half hours of summer sun on the same surface. Due south would have been marginally better in January and meaningfully worse in July.']));
children.push(...Figure('fig4_bearing_sweep.png', 'Figure 4 - Sun hours against frontage bearing. Every point is a full recomputation of the shading model.', 6.2));

children.push(H2('The fence'));
children.push(P('The single largest lever on this property is not the neighbours, the trees or the house. It is the rear fence.'));
children.push(P('Modelling both flanking houses costs the driveway 0.7 hours in June and 0.1 in December, and the back yard about 0.8 hours - second-order everywhere. A 1.83 metre rear fence costs the back yard 5.5 hours of December sun, because at 13 degrees solar altitude that fence throws a 7.9 metre shadow, which is wider than the lot. In June it costs the evening: by eight o\u2019clock the sun is ten degrees up and the same fence shadows 10.4 metres of a 8.4 metre yard, which is why the lawn holds 0.3 hours of sun after five while the deck, further from the fence, holds 3.0.'));
children.push(...Callout('Why this is the useful finding', [
  'A buyer cannot change their frontage bearing after they sign. They can choose whether and how to fence.',
  'On this lot that choice is worth more than the two houses next door combined.',
]));
children.push(...Figure('1788993488434_image.png', 'Figure 5 - Growing-season and evening sun, as presented in the report.', 6.2));

// ---- 4
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(H1('4. Architecture'));
children.push(P('The pipeline runs in one direction: survey drawings to geometry, geometry to solar exposure, solar exposure plus weather to snowpack. The browser runs the same modules the command-line tools run, so there is no second implementation to drift out of sync.'));
children.push(...Figure('fig1_pipeline.png', 'Figure 6 - End-to-end pipeline. The solar engine feeds both the shading and the melt models.', 6.4));

children.push(H2('The design decision that makes it interactive'));
children.push(P('The expensive part of a sun study is asking, for every patch of ground and every minute of the year, whether anything is in the way. Done directly that is tens of millions of ray tests, which is far too slow to sit behind a slider.'));
children.push(P('Instead, each ground cell\u2019s horizon profile is computed once: for each of 120 compass bearings, the elevation the sun must clear before that patch is lit. After that, any instant is a lookup - find the bearing, compare elevations. Profiling 678 cells takes about 490 milliseconds; a full year of monthly accumulation then takes 43.'));
children.push(P('The profile depends on what the house and the fence block, not on which way the lot points. So rotating the frontage needs no reprofiling at all, only re-accumulation. That is the reason the bearing control in the report responds immediately while changing the fence shows a visible recompute.'));

children.push(H2('Module layout'));
children.push(DataTable(['Module', 'Responsibility'], [
  ['src/solar.js', 'NOAA / Meeus solar position, sunrise and sunset, refraction'],
  ['src/site-geometry.js', 'Massing height field, sloped ground, sun-vector transform'],
  ['src/shading.js', 'Horizon profiles, sky view factor, clear-sky irradiance'],
  ['src/climate.js', 'Open-Meteo archive client and offline fallback generator'],
  ['src/snowmelt.js', 'Surface energy balance snowpack model'],
  ['src/scene3d.js', 'three.js scene, real sun placement, cast shadows'],
  ['src/app.js', 'Report front end; computes every figure at load'],
  ['tools/extract_plot_geometry.py', 'Survey PDF to site.json, with assertions'],
  ['tools/validate-solar.mjs', 'Solar engine against published references'],
  ['tools/build-standalone.mjs', 'Bundles everything into one HTML file'],
], [3400, 5960]));

// ---- 5
children.push(H1('5. Reading the Survey'));
children.push(P('Nothing in the site model is measured by hand. A plot plan produced in Civil 3D is a vector PDF, which means the lot boundary, the house footprint and the north arrow are all real geometry in PDF user space. The extractor reads those paths, converts them with the drawing\u2019s stated 1:300 scale, and then asserts the results against the dimensions the surveyor printed on the same sheet. If an assertion fails, the extraction is wrong and the script refuses to emit a site file.'));
children.push(...Code([
  'Lot boundary',
  '  [PASS] lot width (m)      extracted=    8.922  on sheet=    8.920  D=0.002',
  '  [PASS] lot depth (m)      extracted=   35.001  on sheet=   35.000  D=0.001',
  '  [PASS] lot area (m2)      extracted=  312.272  on sheet=  312.200  D=0.072',
  'House footprint',
  '  [PASS] foundation + cant. extracted=  151.525  on sheet=  151.620  D=0.095',
  '  [PASS] rear setback       extracted=    8.384  on sheet=    8.369  D=0.015',
  '  [PASS] front setback      extracted=    5.620  on sheet=    5.600  D=0.020',
  '  [PASS] west setback       extracted=    0.060  on sheet=    0.050  D=0.010',
  '  [PASS] east setback       extracted=    1.538  on sheet=    1.555  D=0.017',
]));
children.push(P('The scale check is the load-bearing one. The lot side lines measure 330.72 points, which at 1:300 is 35.000 metres exactly, and the frontage is 84.30 points or 8.92 metres. Once that holds, every other dimension follows.'));

children.push(H2('The bearing'));
children.push(P('The frontage bearing was the number everything else depended on, and it had to be right. A protractor reading off the printed plan gave 115 degrees. The extractor derives it from the north symbol: 65.58 degrees clockwise from sheet-up, which puts the frontage at 114.42. The two agree to within 0.6 degrees.'));
children.push(P('Two traps here are worth recording. The first is that a phone compass reading would have been useless without correction - magnetic declination at Edmonton is about 14 degrees east - except that iOS displays true north by default, which is why the phone happened to agree. The second is that Alberta subdivision plans are referenced to 3TM grid north rather than true north, and grid convergence at this longitude is about 0.3 degrees, which is below the resolution of the drawing and can be ignored.'));

children.push(H2('The heights'));
children.push(P('The elevation sheet prints 22 feet 6 inches to the midpoint of the peak and 25 feet 9 inches to the ridge. Edmonton measures building height to the midpoint between eave and ridge, so the eave follows arithmetically: twice 6.858 minus 7.849 gives 5.867 metres above the finished floor.'));
children.push(P('That figure is then confirmed a second, independent way. Stacking the storeys from the floor plans - 9 feet 1 inch main floor, plus a 16 inch engineered floor system, plus 8 feet 1 inch second floor - gives 5.639 metres to the top of the second-floor ceiling, leaving 0.228 metres for top plate and truss heel. That is exactly the right remainder. Two routes through different drawings agreeing to a quarter of a metre is a much stronger result than either one alone.'));

// ---- 6
children.push(H1('6. Installation and Usage'));
children.push(H3('Requirements'));
children.push(Bullet('Node.js 20 or later. No npm dependencies.'));
children.push(Bullet('Python 3.8 or later with pdfplumber, for the survey extractor only.'));
children.push(Bullet('A browser, for the report.'));
children.push(H3('Reading the report'));
children.push(P('Download first-light.html and open it. It is a single self-contained file with the survey geometry embedded, so it needs no web server and no internet connection except to load three.js and the fonts from a CDN. If three.js is blocked, the 3D figure shows an explanatory message and every other figure still works.'));
children.push(H3('Running the tools'));
children.push(...Code([
  'node tools/validate-solar.mjs              # engine against published references',
  'node tools/compute-shading.mjs             # per-zone sun hours',
  'node tools/compute-shading.mjs --no-fence  # fence sensitivity',
  'node tools/compute-shading.mjs --neighbours',
  'node tools/compute-melt.mjs --years 10     # needs network for Open-Meteo',
  'node tools/build-standalone.mjs            # rebuild the single-file report',
  '',
  'python3 tools/extract_plot_geometry.py plot.pdf -o data/site.json',
]));
children.push(P('The development version, index.html, loads real ES modules and fetches the JSON, which browsers block on file:// for security reasons. Serve it with npm run serve and open localhost:8000, or just use the standalone build.'));

// ---- 7
children.push(H1('7. Output Format'));
children.push(P('Two JSON artefacts carry everything the report needs.'));
children.push(DataTable(['File', 'Contents', 'Provenance'], [
  ['data/site.json', 'Lot dimensions, house footprint polygon, setbacks, frontage bearing', 'Generated, self-verifying'],
  ['data/building.json', 'Storey heights, eave and ridge, roof form, glazing, deck', 'Hand-traced to printed dimensions'],
  ['data/shading.json', 'Per-zone sun hours and insolation by month, sky view factors', 'Generated'],
], [2400, 4560, 2400]));
children.push(P('Every value in building.json records the sheet and the dimension string it came from, and every assumption records its status and its measured sensitivity. That is deliberate: a reader who disagrees with an assumption can find where it entered and what it is worth.'));

// ---- 8
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(H1('8. Engineering Challenges'));
children.push(P('Most of the effort went into problems that were not visible at the outset. They are recorded in the order they were encountered, because the sequence is itself informative - each fix exposed the next constraint.'));

children.push(H2('8.1 The north arrow could not be read from its bounding box'));
children.push(P('The extractor needed the direction of the north symbol. The PDF library reports a bounding box for each stroke rather than a directed segment, which gives the axis of the arrow shaft but not which way it points.'));
children.push(P('The first fix was to flip the vector 180 degrees when it pointed the wrong way. That is insufficient, and the reason is worth stating: a bounding box cannot distinguish a forward slash from a backslash. Both have identical boxes. A 180-degree flip turns a forward slash into a forward slash pointing the other way; it never turns it into a backslash. What was needed was both component signs, not one overall sign.'));
children.push(P('The resolution takes the magnitudes from the shaft bounding box, which are precise, and the signs from the geometry of the symbol itself: the centroid of the small hatch strokes that form the tail bulb, compared against the centroid of the large outline that forms the needle tip. North runs bulb to tip.'));

children.push(H2('8.2 A 7.7 square metre discrepancy that turned out to be a feature'));
children.push(P('The traced footprint came to 143.90 square metres against the 151.62 printed on the sheet. A 5 per cent gap is too large to be rounding and too small to be a misread boundary.'));
children.push(P('The difference is the second-floor cantilever, noted on the drawing as a 6.25 metre run projecting 1.22 metres over the inset garage wall. That is 7.62 square metres, and the reconciliation closes to 0.09.'));
children.push(P('This matters for shadows rather than for bookkeeping: at grade the footprint is a six-cornered polygon, but above roughly three metres the massing is the full rectangle. A model that used the printed area as a simple footprint would have been wrong in both directions at once.'));

children.push(H2('8.3 The reference source was wrong'));
children.push(P('The solar engine was validated against a widely used sunrise and sunset website. It disagreed by 3.8 minutes on every day of the year - 81 seconds early on sunrise, 146 seconds late on sunset.'));
children.push(P('A constant offset is not random error, so one of the two was systematically wrong. The cause is a convention difference. Sunrise is conventionally defined as the instant the geometric elevation of the sun reaches minus 0.833 degrees, that constant already containing the 0.267 degree solar semi-diameter and the 0.567 degree mean refraction. The reference solves for apparent elevation minus 0.833 instead, which double-counts refraction and lengthens every day.'));
children.push(P('The engine\u2019s figures were then checked against Edmonton\u2019s published solstice day lengths, which are durations and therefore immune to time-zone and daylight-saving handling. They matched to five and ten seconds. The harness now measures the divergence from the website and asserts that it stays in band, rather than tuning to match it.'));
children.push(...Callout('The lesson', [
  'A validation target is a hypothesis too. When a model and a reference disagree by a constant, the constant is the evidence: it points at a definition, not at a bug.',
]));

children.push(H2('8.4 A published model whose coefficients did not survive a unit check'));
children.push(P('The melt model was first built on Hock\u2019s restricted degree-day model, which is the standard citation for exactly this problem: melt as a temperature index with an added term for potential direct radiation, so that shaded and sunlit ground melt at different rates.'));
children.push(P('Applied at daily resolution with the published coefficients, the radiation term came out at about 2 per cent of the temperature term. That is physically impossible at a sunny site. A day of 100 watts per square metre incident on snow at 0.7 albedo delivers roughly 2.6 megajoules of absorbed energy, which is nearly eight millimetres of melt - not a rounding correction.'));
children.push(P('Rather than guess whether the published coefficients were hourly or daily and risk shipping a miscitation, the model was replaced with an explicit surface energy balance in which every term can be checked against physics. Melting a kilogram of ice takes 334 kilojoules, and a kilogram of water spread over a square metre is one millimetre, so the conversion from watts to melt is not a fitted parameter.'));

children.push(H2('8.5 Every surface melted on the same day'));
children.push(P('The first energy-balance run produced a two-day separation between the driveway and the back yard, when the whole premise was that a sunlit surface clears substantially earlier.'));
children.push(P('The missing physics was albedo feedback. Every cell had the same albedo regardless of how much snow was left on it. In reality a sunlit surface goes patchy, dark ground shows through, effective albedo collapses from about 0.7 towards 0.2, and it begins absorbing three times the energy - so it runs away. The shaded yard never reaches that threshold, stays uniformly white, and keeps reflecting.'));
children.push(P('Adding fractional snow cover and the albedo that follows from it took the separation from two days to five. Honest, but still not the weeks that were expected. Section 11 records why.'));

children.push(H2('8.6 Three of four bugs were in the test harness'));
children.push(P('The 3D scene could not be tested in the sandbox, because there is no browser and no WebGL. The response was to stub three.js and execute the bundle against a fake DOM, which caught real problems - but the first three failures the suite reported were defects in the stub rather than in the code. The stub was not storing materials on Line objects, and was not converting numeric colours into Color instances the way the real library does.'));
children.push(...Callout('The lesson', [
  'A passing test suite is only as trustworthy as its fakes. A stub that is wrong in the same direction as the code under test will agree with it happily.',
]));

children.push(H2('8.7 Summary'));
children.push(DataTable(['Problem', 'Symptom', 'Resolution'], [
  ['North arrow direction', 'Bearing 180 degrees out', 'Signs from tail-to-tip centroids, magnitudes from the box'],
  ['Footprint area mismatch', '7.7 m2 short of the sheet', 'Reconciled as the second-floor cantilever'],
  ['Reference disagreement', 'Constant 3.8 min offset', 'Convention difference; documented, not tuned away'],
  ['Radiation term negligible', '2 per cent of temperature term', 'Replaced with explicit energy balance'],
  ['No melt separation', 'All zones cleared together', 'Added fractional cover and albedo feedback'],
  ['Test stub defects', 'Failures in code that was correct', 'Fixed the stub; re-ran'],
], [2600, 3000, 3760]));

// ---- 9
children.push(H1('9. Validation'));
children.push(P('The validation harness imports the same module the browser runs. There is no second implementation to drift away from the first.'));
children.push(...Code([
  'A. Solstice day length  (published city figures; a duration, so DST-independent)',
  '   December solstice   7h 27m 37s   reference  7h 27m 42s   D 5 s',
  '   June solstice      17h 02m 52s   reference 17h 02m 42s   D 10 s',
  'B. Solar noon and noon altitude  (daily table, September 2026)',
  '   solar noon, worst of 12 days                             D 9 s',
  '   noon altitude, worst of 12 days                          D 0.04 deg',
  'C. Geometric invariants  (no external source)',
  '   solstice noon altitudes, equinox symmetry, EoT extremes  all in tolerance',
]));
children.push(P('Section C is the part that needs no reference at all. Noon altitude at the solstices must equal 90 minus the latitude plus or minus the obliquity; the two equinoxes must produce the same day length; the equation of time must reach about minus 14.2 minutes in February and plus 16.4 in November. A model that satisfies those has not been fitted to anything.'));
children.push(H3('What the approximation would have cost'));
children.push(P('The day-of-year cosine approximation for declination, which is what most quick sun calculators use, errs by up to half a degree. Dropping the equation of time shifts clock times by up to a quarter of an hour. At 13 degrees midwinter altitude an 8.45 metre ridge throws 36.6 metres of shadow, and a one degree error in altitude moves that edge by 2.7 metres - across a lot that is only 8.9 metres wide.'));

// ---- 10
children.push(H1('10. Key Learnings'));
children.push(Rich([{ text: 'Derive the same number twice, through different documents. ', bold: true },
  'The eave height came out of the elevation sheet arithmetically and out of the floor plans by stacking storeys, and the two agreed to 0.228 metres, which is exactly the top plate and truss heel. Neither derivation alone would have been convincing. Agreement between independent routes is worth more than precision in either.']));
children.push(Rich([{ text: 'When a model and a reference disagree by a constant, look for a definition. ', bold: true },
  'A 3.8 minute offset on every day of the year is not error, it is a convention. Random error looks random.']));
children.push(Rich([{ text: 'Check the units on a published coefficient before you trust it. ', bold: true },
  'A model from the literature applied at the wrong time resolution is not a citation, it is a mistake with a bibliography attached. The check that caught it was an order-of-magnitude energy calculation that took two minutes.']));
children.push(Rich([{ text: 'Measure the sensitivity instead of arguing about the assumption. ', bold: true },
  'Whether to include the neighbouring houses could have been debated indefinitely. Running the model both ways answered it in a minute: 0.7 hours in June, 0.1 in December. The same run found that the fence, which nobody had thought about, was worth 5.5 hours.']));
children.push(Rich([{ text: 'A negative result is still a result. ', bold: true },
  'The melt separation came back at five days when weeks were expected. Tuning until it looked impressive was available and was the wrong move. What the model actually says, with its weakness stated, is more useful than a number that cannot be defended.']));
children.push(Rich([{ text: 'Test doubles need testing. ', bold: true },
  'Three of the first four failures reported by the 3D test suite were defects in the stub, not the code.']));

// ---- 11
children.push(H1('11. Limitations and Future Work'));
children.push(H2('The melt model is provisional'));
children.push(P('This is the weakest part of the project and it should be read as such. The sandbox in which the model was developed has no network access, so every melt figure here comes from a synthetic year generated from Edmonton monthly normals rather than from observations.'));
children.push(P('The generator reproduces the monthly means and the day-to-day persistence of prairie cold snaps, but it produces more mid-winter thaws than the real record does. Each one wipes the snowpack and resets the divergence between sunlit and shaded ground, which is precisely the signal being measured. The pack peaks at about 23 millimetres water equivalent and then goes in a single warm spell.'));
children.push(...Figure('fig5_melt_season.png', 'Figure 7 - Snowpack through the winter under synthetic weather. The step change in March is the artefact described above.', 6.2));
children.push(P('The Open-Meteo client is written and ready. It requires no API key, sends CORS headers so a browser can call it directly, and returns temperature, precipitation and measured shortwave radiation - which means the cloud factor comes from observations rather than a normals table. Running the melt tool with network access replaces the synthetic year with ten years of ERA5 reanalysis. Until that has been done, the melt chapter is illustrative of the method rather than a result.'));
children.push(P('The geometry and the physics are unaffected by this. The sun figures rest on surveyed dimensions and validated solar position; only the weather is synthetic.'));

children.push(H2('Other known limitations'));
children.push(Bullet('Finished floor above grade is a standard assumption, because the plot plan is preliminary and defers the elevation to final plot. It is derived two ways that agree at 0.65 metres, and the result is insensitive across the plausible range.'));
children.push(Bullet('The thermal terms in the melt model lump net longwave, sensible and latent heat into a linear function of air temperature. That is a standard simplification and it is where most of the melt uncertainty lives.'));
children.push(Bullet('Trees are omitted. Two are required by the City landscaping condition, but at planting size their shading is negligible and deciduous stock is bare through the entire melt season.'));
children.push(Bullet('Snow clearing is not modelled. In reality a driveway gets shovelled and the yard gets the pile, which would widen the separation the model already finds.'));
children.push(Bullet('The horizon profile assumes nothing beyond the lot obstructs the sun. That holds on flat prairie subdivision land and would not hold on a ravine lot or near a mid-rise.'));

children.push(H2('Possible extensions'));
children.push(Bullet('Run against the live weather record and republish the melt chapter as a result rather than an illustration.'));
children.push(Bullet('Rooftop solar yield, which the shading engine already has the geometry for.'));
children.push(Bullet('Interior daylight, projecting the window schedule from the elevations onto room floor plans.'));
children.push(Bullet('A lot comparison mode that ranks every lot in a subdivision phase by whatever the buyer says they care about.'));

// ---- 12
children.push(H1('12. Repository Structure'));
children.push(...Code([
  'first-light/',
  '\u251c\u2500\u2500 first-light.html          # standalone report, no server needed',
  '\u251c\u2500\u2500 index.html                # development version, needs a server',
  '\u251c\u2500\u2500 HomeDesign.md             # design system',
  '\u251c\u2500\u2500 README.md',
  '\u251c\u2500\u2500 package.json',
  '\u251c\u2500\u2500 src/',
  '\u2502   \u251c\u2500\u2500 solar.js              # NOAA / Meeus solar position',
  '\u2502   \u251c\u2500\u2500 site-geometry.js      # massing, ground, sun-vector transform',
  '\u2502   \u251c\u2500\u2500 shading.js            # horizon profiles, irradiance',
  '\u2502   \u251c\u2500\u2500 climate.js            # Open-Meteo client + fallback',
  '\u2502   \u251c\u2500\u2500 snowmelt.js           # surface energy balance',
  '\u2502   \u251c\u2500\u2500 scene3d.js            # three.js scene',
  '\u2502   \u2514\u2500\u2500 app.js                # report front end',
  '\u251c\u2500\u2500 tools/',
  '\u2502   \u251c\u2500\u2500 extract_plot_geometry.py',
  '\u2502   \u251c\u2500\u2500 validate-solar.mjs',
  '\u2502   \u251c\u2500\u2500 compute-shading.mjs',
  '\u2502   \u251c\u2500\u2500 compute-melt.mjs',
  '\u2502   \u2514\u2500\u2500 build-standalone.mjs',
  '\u2514\u2500\u2500 data/',
  '    \u251c\u2500\u2500 site.json',
  '    \u251c\u2500\u2500 building.json',
  '    \u2514\u2500\u2500 shading.json',
]));
children.push(P('The survey PDFs themselves are not committed. They carry the civic address and the parcel identifiers, and site.json contains everything downstream needs.'));

// ---- Appendix
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(H1('Appendix A. Method'));

children.push(H2('A.1 Coordinate frames'));
children.push(P('Site coordinates have their origin at the front-west lot corner, with x running along the frontage toward the east boundary, y running from the front property line toward the rear, and z up. The frontage bearing rotates this frame onto the compass, so the bearing of the x axis is the frontage bearing minus 90 degrees and the bearing of the y axis is the frontage bearing plus 180.'));
children.push(P('A sun at azimuth A and elevation e therefore has, in site coordinates, the direction cosines cos(e)cos(A - Ax) along x, cos(e)cos(A - Ay) along y, and sin(e) along z, where Ax and Ay are the axis bearings. Only this module knows the bearing; everything downstream works in site coordinates.'));

children.push(H2('A.2 Solar position'));
children.push(P('Solar position follows the NOAA implementation of Meeus, Astronomical Algorithms, chapters 25 and 28, rather than the day-of-year cosine approximation. The sequence is: Julian day from the instant; Julian century; geometric mean longitude and mean anomaly of the sun; eccentricity of Earth\u2019s orbit; the equation of centre; true and apparent longitude; mean obliquity of the ecliptic with the nutation correction; and from those, declination and the equation of time.'));
children.push(P('Declination is arcsin(sin(obliquity) sin(apparent longitude)). The equation of time uses the standard series in y = tan squared of half the corrected obliquity.'));
children.push(P('Apparent elevation adds atmospheric refraction using the NOAA piecewise approximation, which switches form above 5 degrees, between minus 0.575 and 5 degrees, and below minus 0.575.'));
children.push(H3('Sunrise and sunset'));
children.push(P('The hour angle at which the sun reaches a target elevation h is arccos of the quantity (cos(90 - h) - sin(lat)sin(dec)) divided by (cos(lat)cos(dec)), returning null when that quantity leaves the range minus one to one, which is polar day or night.'));
children.push(P('The target elevation is minus 0.833 degrees: 0.267 for the solar semi-diameter plus 0.567 for mean horizontal refraction. This is applied to the geometric elevation, following the USNO convention. An optional horizon dip of 0.0347 times the square root of the observer elevation in metres is available but is not used in the published figures, because the reference sources do not apply it.'));
children.push(P('Solar noon in UTC minutes is 720 minus four times the longitude minus the equation of time. Sunrise and sunset are solar noon minus and plus four times the hour angle. The hour angle is solved at local solar noon and then refined once at the event time, because declination moves measurably across a seventeen-hour summer day at this latitude.'));

children.push(H2('A.3 Massing and the height field'));
children.push(P('The house is represented as a height field over the footprint polygon. Inside the polygon the height is the eave plus a roof rise; outside it is null unless a fence occupies that point.'));
children.push(P('The roof is a gable whose ridge runs the length of the house at the footprint mid-width, hipped over the last half-width at the rear. The rise at a point is the ridge-minus-eave height scaled by one minus the normalised distance across from the ridge line, then scaled again near the rear by the normalised distance from the rear wall.'));
children.push(P('The lot falls 0.895 metres from rear to front, a 2.6 per cent grade toward the street, taken from the design grade elevations on the plot plan. Ground height at a depth y is that fall times y over the lot depth. The house does not follow this slope: it sits on one finished-floor elevation referenced to the grade at its own front wall, which means the rear yard, being higher, sees a slightly shorter house than the front does.'));

children.push(H2('A.4 Horizon profiles'));
children.push(P('For each ground cell and each of 120 azimuth bins, the ray is marched horizontally in 0.25 metre steps out to 45 metres. At each step the obstruction height at that point is read from the height field, and the elevation angle to the top of that obstruction is arctan of the height difference over the horizontal distance. The maximum over the march is the horizon angle for that bin.'));
children.push(P('A cell is lit at a given instant when the sun\u2019s apparent elevation exceeds the horizon angle interpolated between the two adjacent bins. The interpolation matters: 120 bins is three degrees apart, and a shadow edge moving across the lot would otherwise step rather than sweep.'));
children.push(P('The sky view factor for diffuse radiation is the mean over bins of cos squared of the horizon angle, which is the fraction of a vertical slice of sky above the horizon under uniform-sky weighting.'));

children.push(H2('A.5 Clear-sky irradiance'));
children.push(P('Direct normal irradiance uses Kasten-Young air mass with a pressure correction for site elevation and the Meinel broadband transmittance:'));
children.push(...Code([
  'airMass = 1 / (sin(e) + 0.50572 * (e + 6.07995)^-1.6364)',
  'm       = airMass * exp(-siteElevation / 8434)',
  'DNI     = 1367 * eccentricity(date) * 0.7^(m^0.678)',
]));
children.push(P('The eccentricity correction is one plus 0.033 cos(2 pi doy / 365.25). Diffuse on the horizontal is estimated at ten per cent of the direct beam projected onto the horizontal, a Liu-Jordan style approximation.'));
children.push(P('This is a deliberately simple model. Its absolute level is rescaled against measured radiation when observations are available, so what matters is that its shape against solar elevation is right, not its calibration.'));

children.push(H2('A.6 Snowmelt'));
children.push(P('Melt is a surface energy balance rather than a temperature index, so that every term can be checked against physics rather than against a fitted coefficient.'));
children.push(...Code([
  'cover    = min(1, swe / 15)                       fractional snow cover',
  'albedo   = cover * snowAlbedo + (1 - cover) * 0.20',
  'snowAlbedo = 0.50 + 0.35 * exp(-age / 8)          fresh 0.85, aged 0.50',
  '',
  'shortwave = (1 - albedo) * cloud * (direct + diffuse * skyView)',
  'thermal   = -20 + 12 * airTemperature             W/m2',
  'melt      = max(0, shortwave + thermal) * 86400 / 334000   mm w.e./day',
]));
children.push(P('The conversion constant is not a parameter. Melting a kilogram of ice requires 334 kilojoules, and a kilogram of water over a square metre is one millimetre of water equivalent.'));
children.push(P('The shortwave term is where the geometry enters, because the direct beam is the per-cell figure produced by the shading engine and the diffuse is scaled by that cell\u2019s sky view factor. Two patches of ground on the same lot on the same day therefore receive genuinely different amounts of energy.'));
children.push(H3('Albedo feedback'));
children.push(P('The fractional cover term is what makes a sunlit surface clear weeks before a shaded one rather than a day before. Melt lowers the pack, the pack goes patchy, effective albedo collapses from about 0.7 towards 0.2, and the surface begins absorbing roughly three times the energy it did - so it runs away. A shaded surface never reaches the threshold, stays uniformly white, and keeps reflecting. Without this feedback every surface on a property melts together, which is not what a prairie spring looks like.'));
children.push(H3('Accumulation'));
children.push(P('Precipitation falls as snow below 0 degrees, as rain above 2, and is linearly partitioned between. Snowfall of at least 2 millimetres water equivalent resets the surface age, and therefore the albedo, to fresh.'));
children.push(H3('The thermal parameterisation'));
children.push(P('Net longwave, sensible and latent heat are lumped into minus 20 plus 12 times the air temperature, in watts per square metre. The offset represents net longwave loss under an open winter sky; the coefficient represents the combined turbulent and longwave sensitivity to air temperature. A full energy balance would need humidity, wind speed and cloud base to resolve these separately. This linearisation is the standard simplification and it is where most of the model\u2019s uncertainty lives, which is why both constants are stated at the top of the module rather than buried in an expression.'));

children.push(H2('A.7 Weather data'));
children.push(P('The primary source is the Open-Meteo historical archive, which serves ERA5 reanalysis back to 1940, requires no API key, and sends CORS headers so a browser can call it directly. The daily fields used are mean, maximum and minimum temperature, precipitation sum, and shortwave radiation sum. The last of these, divided by the modelled clear-sky total, gives an observed cloud factor rather than an assumed one.'));
children.push(P('Seasons are grouped August to July rather than by calendar year, so that a winter\u2019s accumulation is not cut in half at the end of December.'));
children.push(P('The offline fallback synthesises a daily year from Edmonton monthly normals using a first-order autoregressive process around a smooth seasonal mean, with a persistence coefficient of 0.72 and month-specific standard deviations. This reproduces both the monthly mean and the persistence of cold snaps and thaws, so the count of above-freezing days is realistic even though the individual days are invented. Every figure derived from it is marked provisional.'));

children.push(H2('A.8 Zone definitions'));
children.push(P('Ground zones are rectangles in site coordinates, derived from the footprint rather than drawn by hand. The driveway spans the garage width between the front wall and the front property line. The front walk is the strip beside the inset garage. The deck is centred on the rear wall at the width given by the deck nailer on the rear elevation. The back yard is everything between the deck and the rear property line. The east side yard is the 1.54 metre strip under the maintenance easement.'));
children.push(P('Zone figures are the mean over the cells falling inside the rectangle at 0.5 metre spacing, which is 678 cells over the open ground of this lot.'));

children.push(H2('A.9 Horticultural bands'));
children.push(P('Growing-season figures are the mean of the monthly clear-day sun hours for May through September. The categories are the conventional ones used in horticulture: full sun is six hours a day or more, part sun four to six, part shade two to four, and full shade below two. Evening sun is the number of hours a zone is more than half lit after 5pm local time on 21 June.'));

children.push(H2('A.10 References'));
children.push(Bullet('Meeus, J. Astronomical Algorithms, second edition. Willmann-Bell, 1998. Chapters 25 and 28.'));
children.push(Bullet('NOAA Global Monitoring Laboratory, Solar Calculation Details.'));
children.push(Bullet('United States Naval Observatory, definitions of rise, set and twilight.'));
children.push(Bullet('Kasten, F. and Young, A. T. Revised optical air mass tables and approximation formula. Applied Optics 28, 1989.'));
children.push(Bullet('Hock, R. A distributed temperature-index ice and snowmelt model including potential direct solar radiation. Journal of Glaciology 45(149), 1999. Considered and not used; see section 8.4.'));
children.push(Bullet('Open-Meteo Historical Weather API, ERA5 reanalysis.'));
children.push(Bullet('Environment and Climate Change Canada, Canadian Climate Normals 1991-2020, Edmonton.'));

// ---------------------------------------------------------------------------

const doc = new Document({
  creator: 'Harsh Topiwala',
  title: 'First Light - Documentation',
  description: 'A sun, shade and snowmelt study for a single lot',
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 21, color: INK } },
    },
  },
  features: { updateFields: true },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
      },
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ children: ['Page ', PageNumber.CURRENT], size: 17, color: INK3 })],
        })],
      }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join(__dirname, '..', 'First_Light_Documentation.docx');
  fs.writeFileSync(out, buf);
  console.log('wrote', out, (buf.length / 1024).toFixed(0) + ' KB');
});
