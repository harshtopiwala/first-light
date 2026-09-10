#!/usr/bin/env python3
"""Derive site geometry from a preliminary plot plan (Civil 3D vector PDF).

Nothing here is measured by hand. The drawing is a vector PDF, so the lot
boundary, the house footprint and the north arrow are all real geometry in
PDF user space. We read those paths, convert them with the drawing's stated
1:300 scale, and then assert the results against the dimensions the surveyor
printed on the sheet. If an assertion fails, the extraction is wrong and the
script refuses to emit a site file.

Usage:
    python tools/extract_plot_geometry.py <plot-plan.pdf> -o data/site.json
"""
from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from dataclasses import dataclass, field

import pdfplumber

# The sheet states SCALE 1:300 and "ALL DISTANCES SHOWN ARE IN METER".
# 1 PDF point = 1/72 in; at 1:300 that is 0.0254/72*300 m on the ground.
PT_TO_M = 0.0254 / 72 * 300

# Colour the CAD layer uses for the building footprint.
HOUSE_RGB = (0.0, 0.47843, 0.12157)
COLOUR_TOL = 0.02

# Endpoint snapping tolerance, in points. Civil 3D emits coincident endpoints
# to within a rounding error; 0.4 pt is ~4 cm on the ground.
SNAP_PT = 0.4

# Dimensions printed on the sheet, used as the acceptance test.
EXPECTED = {
    "lot_width_m": 8.92,
    "lot_depth_m": 35.00,
    "lot_area_m2": 312.20,
    # The sheet's HOUSE AREA includes the second-floor cantilever noted as
    # "6.25 x 2nd Flr." projecting 1.22 m. The traced polygon is the foundation
    # at grade, so we reconcile against sheet area minus that projection.
    "house_area_m2": 151.62,
    "cantilever_width_m": 6.25,
    "cantilever_projection_m": 1.22,
    "rear_setback_m": 8.369,
    "front_setback_m": 5.600,
    "west_setback_m": 0.050,
    "east_setback_m": 1.555,
}
TOL_M = 0.05
TOL_AREA_M2 = 3.0


@dataclass
class Extraction:
    warnings: list[str] = field(default_factory=list)

    def check(self, name: str, got: float, want: float, tol: float) -> None:
        delta = abs(got - want)
        status = "PASS" if delta <= tol else "FAIL"
        print(f"  [{status}] {name:<18} extracted={got:9.3f}  on sheet={want:9.3f}  Δ={delta:.3f}")
        if status == "FAIL":
            self.warnings.append(f"{name}: extracted {got:.3f} vs sheet {want:.3f}")


def seg_length(l) -> float:
    return math.hypot(l["x1"] - l["x0"], l["bottom"] - l["top"])


def is_house_colour(obj) -> bool:
    c = obj.get("stroking_color")
    if not c or len(c) != 3:
        return False
    return all(abs(a - b) < COLOUR_TOL for a, b in zip(c, HOUSE_RGB))


def snap(v: float) -> float:
    return round(v / SNAP_PT) * SNAP_PT


def north_bearing_from_page_up(page) -> float:
    """Return plan north as degrees clockwise from page-up.

    The north symbol is a surveyor's needle: a hatched bulb and the letter N at
    the tail, tapering to a point at the north end. pdfplumber reports bounding
    boxes rather than directed segments, so the shaft gives us the *axis* but not
    which way it points. We resolve the sign by comparing the centroid of the
    small hatch strokes (the tail bulb) with the centroid of the large needle
    outline (the tip): north runs bulb -> tip.
    """
    corner = lambda o: o["top"] < 200 and o["x0"] > 430
    oblique = [
        l for l in page.lines
        if corner(l) and abs(l["x1"] - l["x0"]) > 2 and abs(l["bottom"] - l["top"]) > 2
    ]
    if not oblique:
        raise RuntimeError("no north-arrow shaft found")
    shaft = max(oblique, key=seg_length)
    axis_dx = shaft["x1"] - shaft["x0"]
    axis_dy = shaft["bottom"] - shaft["top"]

    def area(c):
        return (c["x1"] - c["x0"]) * (c["bottom"] - c["top"])

    # Restrict to the shaft's immediate neighbourhood: the sheet border arc and
    # the "N" glyph also live in this corner and would otherwise be picked up.
    pad = 12.0
    near = lambda c: (c["x0"] > shaft["x0"] - pad and c["x1"] < shaft["x1"] + pad
                      and c["top"] > shaft["top"] - pad and c["bottom"] < shaft["bottom"] + pad)
    curves = [c for c in page.curves if corner(c) and near(c)]
    tips = [c for c in curves if area(c) > 200]
    bulbs = [c for c in curves if 0 < area(c) <= 200]
    if not tips or not bulbs:
        raise RuntimeError("cannot identify needle tip and tail bulb")
    tip = max(tips, key=area)
    tx = (tip["x0"] + tip["x1"]) / 2
    ty = (tip["top"] + tip["bottom"]) / 2
    bx = sum((c["x0"] + c["x1"]) / 2 for c in bulbs) / len(bulbs)
    by = sum((c["top"] + c["bottom"]) / 2 for c in bulbs) / len(bulbs)

    # A bounding box cannot distinguish a "/" stroke from a "\\" stroke, so a
    # 180-degree flip is not enough: we need both component signs. Take the
    # magnitudes from the shaft bbox (precise) and the signs from bulb -> tip.
    axis_dx = abs(axis_dx) * (1 if tx >= bx else -1)
    axis_dy = abs(axis_dy) * (1 if ty >= by else -1)

    # PDF 'top' grows downward, so page-up is -dy.
    return math.degrees(math.atan2(axis_dx, -axis_dy)) % 360


def shoelace(poly) -> float:
    s = 0.0
    for i in range(len(poly)):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % len(poly)]
        s += x0 * y1 - x1 * y0
    return abs(s) / 2


MIN_WALL_PT = 8.0  # ~0.85 m; shorter green strokes are dimension ticks


def trace_footprint(page) -> list[tuple[float, float]]:
    """Stitch the building-layer segments into the outer footprint polygon.

    The layer also carries the interior house/garage partition, which meets the
    west wall at a T-junction. Walking the outer face rather than following the
    first available edge keeps the partition out of the boundary.
    """
    segs = []
    for l in page.lines:
        if not is_house_colour(l) or seg_length(l) < MIN_WALL_PT:
            continue
        a = (snap(l["x0"]), snap(l["top"]))
        b = (snap(l["x1"]), snap(l["bottom"]))
        if a != b:
            segs.append((a, b))

    adj: dict[tuple, list[tuple]] = defaultdict(list)
    for a, b in segs:
        if b not in adj[a]:
            adj[a].append(b)
        if a not in adj[b]:
            adj[b].append(a)

    start = min(adj, key=lambda p: (p[1], p[0]))

    def walk(pick_max: bool):
        poly = [start]
        prev, cur = None, start
        for _ in range(500):
            nxts = [n for n in adj[cur] if n != prev]
            if not nxts:
                return None
            if prev is None:
                nxt = max(nxts, key=lambda n: n[0])
            else:
                inc = math.atan2(cur[1] - prev[1], cur[0] - prev[0])
                def turn(n):
                    a = math.atan2(n[1] - cur[1], n[0] - cur[0]) - inc
                    return (a + 2 * math.pi) % (2 * math.pi)
                nxt = max(nxts, key=turn) if pick_max else min(nxts, key=turn)
            if nxt == start:
                return poly
            poly.append(nxt)
            prev, cur = cur, nxt
        return None

    cands = [p for p in (walk(True), walk(False)) if p and len(p) >= 4]
    if not cands:
        raise RuntimeError("footprint trace did not close")
    return max(cands, key=shoelace)  # the outer face has the largest area


def drop_collinear(poly):
    out = []
    n = len(poly)
    for i in range(n):
        a, b, c = poly[i - 1], poly[i], poly[(i + 1) % n]
        cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        if abs(cross) > 1e-6:
            out.append(b)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("-o", "--out", default="data/site.json")
    args = ap.parse_args()

    ex = Extraction()

    with pdfplumber.open(args.pdf) as pdf:
        page = pdf.pages[0]

        # ---- lot boundary: the two 35.00 m side lines define x-extent, and
        # their shared span defines y-extent.
        sides = [
            l for l in page.lines
            if abs(l["x1"] - l["x0"]) < 0.2
            and 320 < seg_length(l) < 340
            and l["top"] < 560
        ]
        xs = sorted({round(l["x0"], 2) for l in sides})
        if len(xs) != 2:
            raise RuntimeError(f"expected 2 lot side lines, found x={xs}")
        west_pt, east_pt = xs
        rear_pt = min(l["top"] for l in sides)
        front_pt = max(l["bottom"] for l in sides)

        lot_w = (east_pt - west_pt) * PT_TO_M
        lot_d = (front_pt - rear_pt) * PT_TO_M

        print("\nLot boundary")
        ex.check("lot width (m)", lot_w, EXPECTED["lot_width_m"], TOL_M)
        ex.check("lot depth (m)", lot_d, EXPECTED["lot_depth_m"], TOL_M)
        ex.check("lot area (m2)", lot_w * lot_d, EXPECTED["lot_area_m2"], TOL_AREA_M2)

        # ---- house footprint
        poly_pt = drop_collinear(trace_footprint(page))
        house_area = shoelace(poly_pt) * PT_TO_M ** 2
        hx0 = min(p[0] for p in poly_pt)
        hx1 = max(p[0] for p in poly_pt)
        hy0 = min(p[1] for p in poly_pt)
        hy1 = max(p[1] for p in poly_pt)

        print("\nHouse footprint")
        print(f"  traced {len(poly_pt)} corners")
        cantilever = EXPECTED["cantilever_width_m"] * EXPECTED["cantilever_projection_m"]
        ex.check("foundation + cant.", house_area + cantilever,
                 EXPECTED["house_area_m2"], TOL_AREA_M2)
        print(f"         (foundation at grade {house_area:.2f} m2 "
              f"+ 2nd-floor cantilever {cantilever:.2f} m2)")
        ex.check("rear setback", (hy0 - rear_pt) * PT_TO_M, EXPECTED["rear_setback_m"], TOL_M)
        ex.check("front setback", (front_pt - hy1) * PT_TO_M, EXPECTED["front_setback_m"], TOL_M)
        ex.check("west setback", (hx0 - west_pt) * PT_TO_M, EXPECTED["west_setback_m"], TOL_M)
        ex.check("east setback", (east_pt - hx1) * PT_TO_M, EXPECTED["east_setback_m"], TOL_M)

        # ---- plan north
        phi = north_bearing_from_page_up(page)
        front_az = (180.0 - phi) % 360.0
        print("\nOrientation")
        print(f"  north arrow      {phi:7.2f}° clockwise from page-up")
        print(f"  front azimuth    {front_az:7.2f}° (plan bearing)")
        print(f"  rear azimuth     {(front_az + 180) % 360:7.2f}°")

    if ex.warnings:
        print("\nEXTRACTION FAILED:")
        for w in ex.warnings:
            print("  -", w)
        return 1

    # ---- emit in site coordinates: metres, origin at the front-west lot corner,
    # +x along the frontage toward the east boundary, +y toward the rear.
    def to_site(p):
        return [round((p[0] - west_pt) * PT_TO_M, 3),
                round((front_pt - p[1]) * PT_TO_M, 3)]

    site = {
        "id": "sw-edmonton-zll-lot",
        "label": "A zero-lot-line lot in southwest Edmonton",
        "source": {
            "document": "Preliminary plot plan, Alberta land surveyor",
            "scale": "1:300",
            "note": "Preliminary, for siting purposes only. Final elevations to be "
                    "determined at final plot.",
        },
        "builder": "Cantiro Homes",
        "model": "Family Spaces 24 Prairie (Standard)",
        "geometry_units": "metres",
        "lot": {
            "width_m": round(lot_w, 3),
            "depth_m": round(lot_d, 3),
            "area_m2": round(lot_w * lot_d, 2),
            "corners": [[0, 0], [round(lot_w, 3), 0],
                        [round(lot_w, 3), round(lot_d, 3)], [0, round(lot_d, 3)]],
        },
        "house": {
            "footprint": [to_site(p) for p in poly_pt],
            "foundation_area_m2": round(house_area, 2),
            "sheet_house_area_m2": EXPECTED["house_area_m2"],
            "cantilever": {
                "width_m": EXPECTED["cantilever_width_m"],
                "projection_m": EXPECTED["cantilever_projection_m"],
                "note": "Second floor projects over the inset garage wall on the "
                        "zero-lot-line side. Above roughly 3 m the massing is the "
                        "full lot-width rectangle.",
            },
            "coverage_pct": round(100 * house_area / (lot_w * lot_d), 2),
            "setbacks_m": {
                "front": round((front_pt - hy1) * PT_TO_M, 3),
                "rear": round((hy0 - rear_pt) * PT_TO_M, 3),
                "west": round((hx0 - west_pt) * PT_TO_M, 3),
                "east": round((east_pt - hx1) * PT_TO_M, 3),
            },
        },
        "orientation": {
            "front_azimuth_deg": round(front_az, 2),
            "north_arrow_cw_from_page_up_deg": round(phi, 2),
            "datum_note": "Bearing read from the plan's north symbol. Alberta "
                          "subdivision plans are referenced to 3TM grid north; "
                          "grid convergence at this longitude is about 0.3°, "
                          "which is below the resolution of the drawing.",
        },
    }

    with open(args.out, "w") as f:
        json.dump(site, f, indent=2)
    print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
