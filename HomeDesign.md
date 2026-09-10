# HomeDesign.md

Design system for **First Light**. Any agent or person building UI in this
repo reads this file first and follows it exactly. Values here are the values -
do not invent colours, sizes or spacing that are not in this document.

---

## 1. Visual theme and atmosphere

A printed field report, not a dashboard. The reference points are a surveyor's
plot plan, a scientific journal figure, and a well-set architecture monograph.
Warm paper, black ink, one accent, and a great deal of quiet.

The subject is a house and the sun. Neither needs decoration. Every pixel that
is not data, a diagram or a sentence is a pixel working against the argument.
If a reader could mistake a screen for a template, the design has failed.

Three commitments:

- **Evidence is the hero.** Diagrams and figures run full width; prose runs in
  a narrow measure beside or beneath them. The page alternates between the two.
- **Nothing floats.** No cards hovering over backgrounds, no drop shadows on
  chrome, no glassmorphism. Content sits on the page and is separated by rules
  and whitespace, the way it would be in print.
- **One accent, earned.** The amber is the sun. It marks direct sunlight,
  interactive affordances and nothing else. A screen with amber in three
  places is over-decorated.

Density is low. Whitespace is generous but not fashionably vast - this is a
document to be read, not an art installation.

---

## 2. Colour palette and roles

```
--paper           #FCFBF8   page canvas, warm off-white
--paper-sunk      #F5F2EC   recessed areas, table header bands, code blocks
--surface         #FFFFFF   figure plates and anything that must read as white
--rule            #E3DFD6   hairlines, table borders, section dividers
--rule-strong     #C9C3B6   emphasised dividers, axis lines

--ink             #17181B   body text, headings
--ink-secondary   #575C66   captions, labels, secondary prose
--ink-tertiary    #8B909B   axis ticks, footnotes, disabled states

--sun             #B45F1E   THE accent. Direct sunlight, links, active controls
--sun-tint        #F3E5D4   fills behind sun-coded areas, hover backgrounds
--shade           #35506B   the cool counterpart. Shadow, shaded ground
--shade-tint      #DFE5EB   fills behind shade-coded areas

--snow            #6E93B8   snowpack series in charts
--warn            #8A5A1B   caveats, provisional data, assumption flags
```

Role rules:

- `--sun` never appears as a large fill. It is a line, a marker, a small
  swatch, or type. Large warm areas use `--sun-tint`.
- `--warn` is for anything the model assumed rather than measured. Every
  assumption in the UI carries it. This is a credibility feature, not a
  decoration.
- Never use pure black (`#000`) or pure white on the canvas. `--ink` and
  `--paper` are the extremes.
- No gradients anywhere except inside data ramps (section 10).

### Dark mode

Not supported. This is a document with a paper metaphor. Do not add a dark
theme; if a dark surface is needed for a 3D scene, that scene is a plate with
its own interior treatment, not a theme change.

---

## 3. Typography

```
--font-display  "Source Serif 4", Georgia, serif
--font-body     "Source Serif 4", Georgia, serif
--font-ui       "Inter", system-ui, -apple-system, sans-serif
--font-mono     "IBM Plex Mono", ui-monospace, monospace
```

Serif for anything the reader reads. Sans for anything the reader operates.
Mono for anything the reader compares. That division is absolute: a number in
a table is mono, a number in a sentence is serif.

| Role | Family | Size | Weight | Line height | Tracking |
|---|---|---|---|---|---|
| Page title | display | 44px / 34px mobile | 400 | 1.12 | -0.02em |
| Section head | display | 28px | 600 | 1.2 | -0.01em |
| Subhead | display | 20px | 600 | 1.3 | 0 |
| Body | body | 18px / 17px mobile | 400 | 1.62 | 0 |
| Lead paragraph | body | 21px | 400 | 1.55 | 0 |
| Figure caption | ui | 13px | 400 | 1.5 | 0 |
| Eyebrow / label | ui | 11px | 600 | 1.2 | 0.09em, uppercase |
| Table and data | mono | 13px | 400 | 1.45 | 0 |
| Big statistic | mono | 40px | 400 | 1.0 | -0.01em |
| Button | ui | 14px | 500 | 1 | 0.01em |

Rules:

- All numerals in tables and charts use `font-variant-numeric: tabular-nums`.
  Columns of figures must align on the digit.
- Body measure is capped at **68 characters**. Never let prose run the full
  width of a wide screen.
- One em dash per page at most. Prefer a full stop.
- Units are set in `--ink-tertiary` at 0.85em beside their value, never in the
  same weight as the number.

---

## 4. Components

### Figure plate
The primary component. A full-width `--surface` block with a hairline top and
bottom rule, 32px internal padding, no border radius, no shadow. Holds a
diagram, chart or 3D scene. Caption sits below the rule in `ui` 13px
`--ink-secondary`, prefixed with a bold `Figure N.`

### Data table
`--paper-sunk` header band, `mono` 13px throughout, 1px `--rule` between rows,
no vertical borders, no zebra striping. Numeric columns right-aligned. Row
hover fills `--sun-tint`. The first column is a label in `ui`, not mono.

### Statistic block
A big mono number, a `ui` uppercase eyebrow above it, and one line of serif
context below. Used at most three to a screen. No box, no border - separated
from neighbours by whitespace and an optional left hairline rule.

### Control
Sliders, month pickers, toggles. Track is `--rule`, filled portion `--sun`,
thumb is a 14px `--surface` circle with a 1px `--rule-strong` border. Labels
are `ui` 11px uppercase. Controls are always grouped in a horizontal bar with
a hairline above, never floating over the visual.

### Button
Text buttons only for secondary actions: `--sun`, no underline until hover.
Primary action is a filled `--ink` rectangle, `--paper` text, 4px radius,
10px/18px padding. There is no third button style.

### Assumption flag
Inline `ui` 11px in `--warn` with a small preceding dot, used wherever the
model assumed a value. Clicking reveals a note explaining what was assumed and
the sensitivity. Never hide these behind a menu.

### Source note
Set below any figure that used external data. `ui` 12px `--ink-tertiary`,
naming the source and the retrieval date.

---

## 5. Layout

Spacing scale, 4px base: `4, 8, 12, 16, 24, 32, 48, 64, 96, 128`. Nothing
outside this scale.

Grid: 12 columns, 24px gutters, max content width **1180px**. Prose occupies
columns 3–9 (or a `680px` measure, whichever is narrower). Figure plates break
out to the full 1180px. Wide tables may break out to 1180px; narrow ones stay
in the prose measure.

Vertical rhythm: 96px between major sections, 48px between a figure and the
prose that follows, 24px between paragraphs.

The page reads as a sequence: lead → figure plate → prose → figure plate →
prose. Never stack two plates back to back without prose between them.

---

## 6. Depth and elevation

There is one elevation: the page. Nothing is above it.

- No `box-shadow` on any chrome, card, button, panel or table.
- Separation is achieved with hairline rules and whitespace only.
- The single permitted shadow is inside a 3D scene, cast by the model's own
  geometry, because that shadow is the subject matter.
- Border radius is 0 everywhere except buttons (4px) and control thumbs
  (circular). No rounded cards.

---

## 7. Do and do not

**Do**
- Lead with the number, then explain it.
- Label every axis, including units.
- Show the assumption next to the result it affects.
- Use the same colour for the same concept on every screen: amber is sun,
  slate is shade, everywhere, always.
- Let figures breathe. A cramped chart looks unreliable.

**Do not**
- Add a card, a shadow, or a rounded panel.
- Use amber as a background fill for anything larger than a swatch.
- Use more than one accent colour.
- Animate on scroll. Transitions are for state changes only, 150ms ease.
- Use icons decoratively. An icon must replace a word, not accompany one.
- Put a chart legend where a direct label on the series would work.
- Render a value with more precision than the model supports. Sun hours get
  one decimal; melt dates get a day; bearings get two decimals because the
  survey supports it.

---

## 8. Responsive behaviour

Breakpoints: `640px`, `900px`, `1180px`.

- Below 900px the grid collapses to a single column; figure plates run edge to
  edge with 16px padding and lose their side rules.
- Below 640px, page title drops to 34px, body to 17px, and wide data tables
  become horizontally scrollable inside their plate rather than reflowing.
  Never reflow a data table into stacked cards; the comparison is the point.
- Controls stack vertically below 640px and gain 44px minimum touch targets.
- The 3D scene keeps a 4:3 aspect on mobile and 16:9 above 900px.

---

## 9. Data visualisation

This is a data project, so the chart rules are part of the design system.

- **Sun ramp** (sequential, for sun hours and insolation):
  `#F3EDE3 → #E6CFA8 → #D3A461 → #B45F1E`
- **Shade ramp** (sequential, for shadow duration):
  `#E8ECEF → #B8C4CF → #7089A4 → #35506B`
- **Divergent** (only for comparing against a baseline):
  shade ramp reversed through `--paper` into the sun ramp.

Rules:
- Axis lines and ticks in `--rule-strong` and `--ink-tertiary`. No gridlines
  unless a value must be read off the chart, and then hairline `--rule` only.
- Direct-label series at the end of the line. Legends are a fallback.
- Bar charts start at zero. Line charts may not.
- A shaded uncertainty band is `--rule` at 50% opacity, never a colour tint.
- Colour never carries meaning alone - pair it with position, label or shape.
- Maps and plan views are always north-up **or** carry an explicit north
  arrow. Never both rotated and unlabelled.

---

## 10. Agent prompt guide

Quick reference when generating UI for this repo:

> Build with `--paper` canvas, `--ink` text, `--sun` as the only accent. Source
> Serif 4 for prose, Inter for controls, IBM Plex Mono for all figures. No
> shadows, no rounded cards, no gradients. Separate with hairline rules and
> whitespace. Prose capped at 68 characters; figure plates break out to full
> width. Tabular numerals everywhere numbers align. Flag every model
> assumption inline in `--warn`. Cite every external data source below its
> figure.

Anti-patterns that mean you have drifted: a rounded card with a drop shadow, a
purple-to-blue gradient hero, an icon beside every heading, a legend where a
direct label would do, a number with five decimal places, a dark theme toggle.
