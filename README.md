# First Light

A sun, shade and snowmelt study for a single new-build lot in southwest Edmonton,
and a tool that runs the same study for any lot.

Buying a house from a plan in Canada means committing to an orientation before
anything is built. Which windows get the winter sun, whether the driveway clears
itself, when the back yard becomes usable again - all of it is fixed the moment
you pick a lot, and none of it appears on a feature sheet. This works out those
answers from the survey drawings, real solar geometry and the weather record.

**[Open the report](first-light.html)** - one self-contained file, no server, no
install. Everything on the page is computed in the browser at load.

---

## Three findings

1. **The driveway takes 96 per cent of December's daylight.** 7.3 of the 7.5
   hours that exist, lit from seven minutes after sunrise to three minutes before
   sunset. Winter sunrise here is at bearing 130.4 degrees against a frontage of
   114.42, so the surface that has to be shovelled is the one pointed at the
   winter sun. By June it drops to 70 per cent, which is the right way round.

2. **Every window faces front or back.** Both long elevations are blank - soffit
   vents only. On a zero-lot-line home the frontage bearing is not one input
   among many; it is the only thing that determines interior daylight.

3. **A six-foot fence matters more than the neighbours.** Modelling both
   flanking houses costs the back yard about 0.8 hours in December. A 1.83 m
   rear fence costs it 5.5, because at 13 degrees of solar altitude that fence
   throws a 7.9 m shadow - wider than the lot. It is also the only variable in
   the study the owner can still change.

## Status

| Stage | State |
|---|---|
| Survey geometry extraction | done, self-verifying |
| Solar position and event engine | done, validated to within 10 seconds |
| Shading and insolation | done |
| Snow and melt model | done; **provisional**, running on synthetic weather |
| 3D report | done |
| Documentation | done |

## Architecture

```
src/
  solar.js          NOAA/Meeus solar position, sunrise/sunset, refraction
  site-geometry.js  massing height field, sloped ground, sun-vector transform
  shading.js        per-cell horizon profiles, sky view, clear-sky irradiance
  climate.js        Open-Meteo archive client + offline fallback generator
  snowmelt.js       surface energy balance snowpack model
  scene3d.js        three.js scene, real sun placement, cast shadows
  app.js            report front end; computes every figure at load
tools/
  extract_plot_geometry.py  survey PDF -> data/site.json, with assertions
  validate-solar.mjs        solar engine vs published references
  compute-shading.mjs       shading run -> data/shading.json
  compute-melt.mjs          melt run, joins shading to weather
  build-standalone.mjs      bundles everything into first-light.html
docs/
  make_figures.py   documentation figures, drawn from engine output
data/
  site.json         lot and footprint, derived from the plot plan
  building.json     massing, traced to printed dimensions on the elevations
  shading.json      per-zone sun hours and insolation
HomeDesign.md       design system; read before building any UI
```

The browser runs the same `src/` modules the tools do. There is no second
implementation to drift out of sync.

**The design decision that makes it interactive.** Rather than testing every
ground cell against the building at every timestep, each cell's horizon profile
is computed once: for each of 120 compass bearings, the elevation the sun must
clear before that patch is lit. After that, any instant is a lookup. 678 cells
take about 490 ms to profile and 43 ms for a full year of monthly accumulation,
which is what makes a live "change the bearing and recompute" control
affordable - the profile does not depend on which way the lot points.

## Reading it

**[Open the report](first-light.html)** - a single self-contained file. Download it and
double-click; no server, no install, no build step. The survey geometry is embedded
and every figure is computed in the browser when the page loads.

`index.html` is the same report as ES modules with the data fetched at runtime. It is
what GitHub Pages serves, and it needs a web server - browsers block modules and fetch
on `file://`. Locally, `npm run serve` and open `localhost:8000`.

### Publishing to GitHub Pages

Settings, Pages, deploy from branch `main`, folder `/ (root)`. Two things to do first:

1. Replace `REPLACE-WITH-YOUR-PAGES-URL` in the `og:url` and `og:image` tags in
   `index.html`. They must be absolute URLs or no link preview renders.
2. Rebuild the standalone afterwards so it carries the same tags: `npm run build`.

## A note on privacy

The civic address, lot, block, plan and job numbers, the surveying firm and the owner
details have been removed from everything in this repository. Site coordinates are the
neighbourhood centroid rounded to two decimal places, about a kilometre, which changes
day length by under three seconds and noon altitude by 0.004 degrees.

The survey PDFs are gitignored. They carry the address, a phone number, an email
address and DocuSign envelope IDs. `data/site.json` holds everything downstream needs.

## Running it

```bash
npm run validate    # solar engine against published references
npm run shading     # per-zone sun hours          (--no-fence, --neighbours)
npm run melt        # melt model                  (--years 10, needs network)
npm run build       # rebuild first-light.html
npm run serve       # then open localhost:8000

python3 tools/extract_plot_geometry.py plot.pdf -o data/site.json
```

Node 20 or later, no npm dependencies. The survey extractor needs `pdfplumber`.
The scripts in `docs/` that build the Word documents need `npm install docx`.

## Publishing

`index.html` loads real ES modules and fetches the JSON, so it needs to be
served over http. GitHub Pages does that, which makes it the right entry point
for the hosted site. `first-light.html` is a build artifact of the same source
with every module inlined and the survey data embedded, for people who want to
download one file and double-click it.

Before publishing, replace `REPLACE-WITH-YOUR-PAGES-URL` in the `og:url` and
`og:image` tags in `index.html`. Link previews need absolute URLs; a relative
path renders no card at all.

## Validation

`tools/validate-solar.mjs` imports the shipping module and checks it against
published figures and against invariants that need no source.

```
December solstice day length   7h 27m 37s   reference 7h 27m 42s   D 5 s
June solstice day length      17h 02m 52s   reference 17h 02m 42s   D 10 s
Solar noon, worst of 12 days                                       D 9 s
Noon altitude, worst of 12 days                                    D 0.04 deg
```

The harness also records a **known divergence**: a widely used sunrise website
runs 3.8 minutes long every day of the year, because it solves for apparent
elevation -0.833 degrees where the USNO convention solves for geometric
-0.833, the refraction allowance already being inside that constant. That gap
is measured and asserted to stay in band rather than tuned away.

## Assumptions, and what each one costs

The preliminary plot plan is treated as final. Where it defers a value, a
standard assumption is taken and recorded with its measured sensitivity.

| Assumption | Value | Cost if wrong |
|---|---|---|
| Finished floor above grade | 0.65 m | Negligible. Moving it 50 mm changed no zone by more than 0.1 h |
| Rear fence | 1.83 m, three sides | Large. Removing it returns 5.5 h of December sun to the back lawn |
| Deck | 3.96 x 4.0 m | Small, confined to the deck |
| Neighbouring houses | omitted | Measured: 0.7 h in June, 0.1 h in December on the driveway |
| Trees | omitted | Negligible at planting size; deciduous stock is bare in melt season |
| Melt thermal terms | -20 + 12*T W/m2 | Unquantified. Most of the melt model's uncertainty lives here |

The fence is the only assumption that changes a conclusion.

## The melt model is provisional

This is the weakest part of the project and should be read as such. Every melt
figure currently comes from a synthetic year generated from Edmonton monthly
normals, because the environment it was developed in had no network access. The
generator reproduces the monthly means and the persistence of prairie cold
snaps, but it produces more mid-winter thaws than the real record, and each one
wipes the snowpack and resets the divergence between sunlit and shaded ground -
which is exactly the signal being measured. The separation comes out at five
days where weeks were expected.

The Open-Meteo client is written and ready. It needs no API key and sends CORS
headers, so `npm run melt -- --years 10` on a machine with network replaces the
synthetic year with ten years of ERA5 reanalysis. Until that is done, the melt
chapter illustrates the method rather than reporting a result.

The geometry and the physics are unaffected. Only the weather is synthetic.

## Privacy

The survey PDFs are not committed and are covered by `.gitignore`. They carry
the civic address, the parcel identifiers, a phone number and an email address.
Everything downstream needs is already in `data/site.json`.

The coordinates in the source are the neighbourhood centroid rounded to two
decimal places, about a kilometre. At this latitude that is under three seconds
of solar time, so the results are identical and the repository does not carry a
parcel-level fix.

## Prior art

[ShadeMap](https://shademap.app) computes global shadow rasters from LiDAR,
elevation models and OpenStreetMap footprints, and aggregates sun exposure
hourly, daily or annually. It answers *where does shadow fall*. It does not
answer *should I buy this lot*: no weather, no snow, no seasonal livability, no
interpretation. This project is narrow by comparison and deep in the one place a
first-time buyer needs depth.

## Licence

MIT. See [LICENSE](LICENSE).
