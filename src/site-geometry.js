/**
 * Site geometry in lot coordinates.
 *
 * Origin is the front-west lot corner as emitted by tools/extract_plot_geometry.py.
 *   +x runs along the frontage toward the east boundary
 *   +y runs from the front property line toward the rear
 *   +z is up
 *
 * The lot's frontage bearing rotates this frame onto the compass. Everything
 * downstream works in lot coordinates and asks this module to convert a sun
 * azimuth into a direction vector, so no other file has to know the bearing.
 */

const RAD = Math.PI / 180;

export class SiteModel {
  /**
   * @param {object} site      parsed data/site.json
   * @param {object} building  parsed data/building.json
   * @param {object} [opts]
   * @param {boolean} [opts.fence=true]      model the proposed fence line
   * @param {number}  [opts.fenceHeight=1.83] fence height, metres (6 ft)
   * @param {boolean} [opts.neighbours=false] model the two flanking houses
   */
  constructor(site, building, opts = {}) {
    this.site = site;
    this.building = building;
    this.opts = { fence: true, fenceHeight: 1.83, neighbours: false, ...opts };

    this.lotWidth = site.lot.width_m;
    this.lotDepth = site.lot.depth_m;
    this.frontAzimuth = site.orientation.front_azimuth_deg;

    // Compass bearing of each lot axis.
    this.axisAzimuthX = (this.frontAzimuth - 90 + 360) % 360;
    this.axisAzimuthY = (this.frontAzimuth + 180) % 360;

    this.footprint = site.house.footprint;
    this.houseMinX = Math.min(...this.footprint.map((p) => p[0]));
    this.houseMaxX = Math.max(...this.footprint.map((p) => p[0]));
    this.houseMinY = Math.min(...this.footprint.map((p) => p[1]));
    this.houseMaxY = Math.max(...this.footprint.map((p) => p[1]));

    this.eave = building.derived_above_grade.eave_m;
    this.ridge = building.derived_above_grade.ridge_m;
    this.ridgeX = (this.houseMinX + this.houseMaxX) / 2;
    this.halfWidth = (this.houseMaxX - this.houseMinX) / 2;

    // Lot falls toward the street: rear design grades average 90.61, front
    // 89.715 on the plot plan's local datum, so 0.895 m over the 35 m depth.
    this.grade = { fallMetres: 0.895 };

    // The house sits on one finished-floor elevation, referenced to the grade
    // at its own front wall - it does not follow the slope of the lot.
    this.houseDatum = this.groundHeight(this.houseMinY);
  }

  /** Design grade at a given depth into the lot, metres above the front corner. */
  groundHeight(y) {
    return (this.grade.fallMetres * y) / this.lotDepth;
  }

  /** Unit vector pointing at the sun, in lot coordinates. */
  sunVector(azimuthDeg, elevationDeg) {
    const c = Math.cos(elevationDeg * RAD);
    return {
      x: c * Math.cos((azimuthDeg - this.axisAzimuthX) * RAD),
      y: c * Math.cos((azimuthDeg - this.axisAzimuthY) * RAD),
      z: Math.sin(elevationDeg * RAD),
    };
  }

  /** Is (x, y) inside the house footprint? Ray-crossing test. */
  insideFootprint(x, y) {
    const p = this.footprint;
    let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i];
      const [xj, yj] = p[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /**
   * Absolute height of the top of whatever occupies (x, y), or null if nothing
   * does. Heights are on the same datum as groundHeight().
   *
   * Roof form: a gable whose ridge runs the length of the house, hipped over
   * the last half-width at the rear, matching sheets 1 to 4. The garage end is
   * treated as part of the same gable - the front gables on sheet 1 are
   * decorative and sit below the main ridge.
   */
  obstructionHeight(x, y) {
    if (this.insideFootprint(x, y)) {
      const acrossFraction = 1 - Math.abs(x - this.ridgeX) / this.halfWidth;
      let rise = (this.ridge - this.eave) * Math.max(0, acrossFraction);
      const fromRear = this.houseMaxY - y;
      if (fromRear < this.halfWidth) {
        rise *= Math.max(0, fromRear / this.halfWidth); // rear hip
      }
      return this.houseDatum + this.eave + rise;
    }

    if (this.opts.neighbours) {
      // Every lot in this zero-lot-line row is built the same way: the house
      // sits 0.06 m off its own west boundary with a 1.54 m yard on the east.
      // So the neighbour to the west presents a wall 1.60 m from ours, and the
      // neighbour to the east sits 1.60 m the other way.
      const w = this.houseMaxX - this.houseMinX;
      const westEast = this.houseMinX - this.site.house.setbacks_m.east - this.site.lot.width_m + this.lotWidth;
      const spans = [
        [-this.site.house.setbacks_m.east - w, -this.site.house.setbacks_m.east],
        [this.lotWidth + this.site.house.setbacks_m.west,
         this.lotWidth + this.site.house.setbacks_m.west + w],
      ];
      for (const [x0, x1] of spans) {
        if (x >= x0 && x <= x1 && y >= this.houseMinY && y <= this.houseMaxY) {
          const half = (x1 - x0) / 2;
          const mid = (x0 + x1) / 2;
          let rise = (this.ridge - this.eave) * Math.max(0, 1 - Math.abs(x - mid) / half);
          const fromRear = this.houseMaxY - y;
          if (fromRear < half) rise *= Math.max(0, fromRear / half);
          return this.houseDatum + this.eave + rise;
        }
      }
    }

    if (this.opts.fence) {
      const t = 0.12; // fence line sits on the lot boundary
      const onSide = x < t || x > this.lotWidth - t;
      const onRear = y > this.lotDepth - t;
      // Rear yard only, three sides: the fence returns to the house at the
      // rear corners, which is how this row is fenced. Nothing across the
      // frontage and nothing alongside the house.
      if ((onSide && y > this.houseMaxY) || onRear) {
        return this.groundHeight(y) + this.opts.fenceHeight;
      }
    }

    return null;
  }

  /** Named ground zones, in lot coordinates. Rectangles, [x0, y0, x1, y1]. */
  zones() {
    const f = this.footprint;
    const garageWestX = Math.max(...f.filter((p) => p[1] === this.houseMinY).map((p) => p[0])) === this.houseMaxX
      ? Math.min(...f.filter((p) => p[1] === this.houseMinY).map((p) => p[0]))
      : this.houseMinX;
    const deckHalf = this.building.deck.width_m / 2;
    const deckCentre = (this.houseMinX + this.houseMaxX) / 2;

    return {
      driveway: {
        label: 'Driveway',
        rect: [garageWestX, 0, this.houseMaxX, this.houseMinY],
        note: 'Between the garage door and the front property line.',
      },
      front_walk: {
        label: 'Front walk and entry',
        rect: [0, 0, garageWestX, this.houseMinY],
        note: 'The strip beside the garage that reaches the front door.',
      },
      deck: {
        label: 'Rear deck',
        rect: [deckCentre - deckHalf, this.houseMaxY, deckCentre + deckHalf,
               this.houseMaxY + this.building.deck.depth_m],
        note: 'Sized from the 13 ft deck nailer on the rear elevation.',
      },
      back_yard: {
        label: 'Back yard beyond the deck',
        rect: [0, this.houseMaxY + this.building.deck.depth_m, this.lotWidth, this.lotDepth],
        note: 'Open lawn between the deck and the rear property line.',
      },
      side_yard_east: {
        label: 'East side yard',
        rect: [this.houseMaxX, this.houseMinY, this.lotWidth, this.houseMaxY],
        note: '1.54 m strip under the maintenance easement.',
      },
    };
  }

  /** Regular sample grid over the open ground of the lot. */
  cells(spacing = 0.5) {
    const out = [];
    for (let y = spacing / 2; y < this.lotDepth; y += spacing) {
      for (let x = spacing / 2; x < this.lotWidth; x += spacing) {
        if (this.insideFootprint(x, y)) continue;
        out.push({ x, y, z: this.groundHeight(y) });
      }
    }
    return out;
  }
}
