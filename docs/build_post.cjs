const {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, HeadingLevel,
} = require('docx');
const fs = require('fs');
const path = require('path');

const INK = '17181B', INK2 = '575C66', INK3 = '8B909B', RULE = 'C9C3B6';

const P = (runs, o = {}) => new Paragraph({
  spacing: { after: o.after ?? 150, line: 276 },
  alignment: o.align,
  children: (Array.isArray(runs) ? runs : [runs]).map((r) => typeof r === 'string'
    ? new TextRun({ text: r, size: o.size ?? 21, color: o.color ?? INK, italics: o.italics })
    : new TextRun({ size: o.size ?? 21, color: o.color ?? INK, ...r })),
});

const H = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 300, after: 120 },
  children: [new TextRun({ text, size: 26, bold: true, color: INK })],
});

const RULE_P = () => new Paragraph({
  spacing: { before: 160, after: 200 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 6 } },
  children: [],
});

const children = [
  P([{ text: 'Given, When, Then by Harsh - First Light: a sun study for one lot', bold: true, size: 30 }],
    { after: 100 }),
  P('What I expected to confirm in an afternoon took a month, and told me something I had not thought to ask.',
    { italics: true, color: INK2, size: 21 }),
  RULE_P(),

  P('Buying your first home in Canada is harder than it looks from the outside, and the seasons are most of the reason. How much sun the driveway gets in January decides whether you are chipping ice off it before work. How much the back yard gets in June decides whether anything grows in it, and whether your family sits outside after dinner.'),
  P('You commit to all of it before a single wall goes up, by choosing a rectangle on a subdivision map.'),
  P('So I built a simulation to check whether the lot we chose made sense. Not whether it felt right - whether the numbers said so.'),

  H('GIVEN'),
  P([{ text: 'Nobody computes this for you.', bold: true }]),
  P('A show home is built on a show lot. The one you buy is a rectangle on a plan with a frontage bearing nobody mentions, and the questions that matter about it have numerical answers that never get worked out. How many hours of direct sun does the driveway get on the shortest day. Is the back yard bright enough to grow vegetables. Will the deck be usable at seven in the evening in July.'),
  P('Our lot made that sharper than most. It is a zero-lot-line skinny home, and when I read the elevation drawings properly I noticed something I had walked past a dozen times: both long walls are blank. Soffit vents, not one window on either side. Orientation is not one factor among many here. It is the only thing that determines interior daylight.'),
  P([{ text: 'The goal: work out, from the survey drawings and the weather record, what this lot actually gives us in each season.', bold: true }]),

  H('WHEN'),
  P('The plan was straightforward. Read the plot plan, model the house, put the sun in the right place, see what falls where. A weekend.'),
  P('It was not a weekend. Four things went wrong, and each one was more interesting than the thing it interrupted.'),
  P([{ text: 'The frontage bearing nearly went in backwards. ', bold: true },
    'The plot plan is a vector PDF, so the north arrow is real geometry - but the library reports a bounding box, not a direction. My first fix flipped the vector 180 degrees, which does not work: a bounding box cannot tell a forward slash from a backslash, and flipping never turns one into the other. Everything downstream depended on that number.']),
  P([{ text: 'The source I validated against was wrong. ', bold: true },
    'A well-known sunrise website disagreed with my engine by 3.8 minutes on every single day of the year. A constant offset is not error, it is a definition. Sunrise is conventionally the moment the sun\u2019s geometric elevation hits minus 0.833 degrees, a figure that already contains the refraction allowance; they were applying it to the refracted elevation and double-counting. My numbers matched the published solstice day lengths to within ten seconds, so I documented the difference instead of tuning to match it.']),
  P([{ text: 'A published model failed a unit check. ', bold: true },
    'For the snow I used the standard citation from glaciology, and applied at daily resolution its radiation term came out at 2 per cent of its temperature term. That is physically impossible on a sunny driveway. I threw it out and wrote an explicit energy balance instead, where every term can be checked: melting a kilogram of ice takes 334 kilojoules, and nobody gets to tune that.']),
  P([{ text: 'Then every surface melted on the same day, ', bold: true },
    'which defeated the entire point. The missing physics was albedo feedback: a sunlit patch goes bare in places, dark ground shows through, reflectivity collapses from 0.7 to 0.2, and it absorbs three times the energy. It runs away. The shaded yard never gets patchy, stays white, keeps reflecting.']),
  H('THEN'),
  P([{ text: 'The driveway takes 96 per cent of the daylight that exists in December. ', bold: true },
    '7.3 of 7.5 hours, lit from seven minutes after sunrise to three minutes before sunset. Winter sunrise here is at bearing 130 degrees; our frontage is 114. The one surface I have to shovel is the one surface pointed at the winter sun.']),
  P([{ text: 'And it is close to the best orientation available. ', bold: true },
    'I swept all 360 degrees of frontage bearing. December driveway sun peaks at 7.5 hours; we get 7.3, and a north-facing lot would get 1.8. Due south would match us in winter but take 15.4 hours in June against our 11.9 - so we get near-maximum winter sun while shedding three and a half hours of summer heat on the same concrete.']),
  P([{ text: 'The back yard averages 6.2 hours a day through the growing season, ', bold: true },
    'which is full sun by the horticultural definition. Tomatoes, not just herbs.']),
  P([{ text: 'The finding I did not go looking for: the fence. ', bold: true },
    'I assumed the neighbouring houses were the thing to worry about. Modelling both costs the back yard about 0.8 hours in December. A standard six-foot rear fence costs it 5.5, because at 13 degrees of solar altitude that fence throws a 7.9 metre shadow - wider than the lot. In June it eats the evenings: the lawn keeps 0.3 hours of sun after five while the deck, further from the fence, keeps 3.0. That is the one variable in the whole study I can still change.']),
  P([{ text: 'And the result I did not want. ', bold: true },
    'I expected the sunny driveway to clear weeks before the shaded yard. The model says five days. My weather is synthetic, and the generator produces more mid-winter thaws than the real record, each one wiping the pack and resetting the signal I was measuring. So the snow chapter is published as provisional rather than dressed up. Tuning it until it looked impressive was available and would have been the wrong move.']),

  H('A note on how this was built'),
  P('I used AI throughout, and I would rather say so plainly.'),
  P('It was wrong three times in ways worth naming. It reached for that glaciology model confidently, and the coefficients did not survive a two-minute energy calculation. It expected weeks of melt separation, as I did, and what it built said five days. And the first interface it designed landed squarely on the default AI look - warm cream, serif headings, terracotta accent - which I rejected, because the point was that this should not look generated.'),
  P('Every one of those was caught by running the thing and checking, not by asking again. Deciding what to build, which assumption was load-bearing, and when an answer was too convenient to accept does not delegate. The sensitivity runs that found the fence were mine, and so was the call to publish a five-day result instead of a five-week one.'),
  P('Writing the code was never the slow part. Knowing which number to distrust was.'),

  RULE_P(),
  P([{ text: 'Full write-up and code: ', size: 21 },
     { text: '[repository link]', bold: true, size: 21 }]),
  P('#DataEngineering #Python #JavaScript #HomeBuying #Canada #SideProjects #AI',
    { color: INK2, size: 20 }),
];

const doc = new Document({
  creator: 'Harsh Topiwala',
  title: 'First Light - LinkedIn post',
  styles: { default: { document: { run: { font: 'Calibri', size: 21, color: INK } } } },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, bottom: 1080, left: 1200, right: 1200 },
      },
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join(__dirname, '..', 'First_Light_LinkedIn_Post.docx');
  fs.writeFileSync(out, buf);
  const words = children.reduce((n, p) => n + JSON.stringify(p).split(/\s+/).length, 0);
  console.log('wrote', out, (buf.length / 1024).toFixed(0) + ' KB');
});
