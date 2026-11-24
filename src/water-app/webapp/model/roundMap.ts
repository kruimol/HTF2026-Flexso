import encodeXML from "sap/base/security/encodeXML";

/**
 * Maren's route map for the evening view, drawn as one SVG on top of the painted village: the
 * places as little drawings (houses, bakery, farms, mill …), the pipes by status, her route and a
 * water droplet at every place that depends on a pipe.
 *
 * It answers her two questions at a glance:
 *  - "Where do I go first, then where?" → her walking route: numbered stops on the problem pipes,
 *    joined by a footpath in visiting order (1 → 2 → 3).
 *  - "Who is sitting without water?" → a water droplet at every place that depends on a pipe,
 *    filled to the share of normal flow that actually reaches it.
 * Pipe colour = state of the pipe; stop numbers are neutral, they only mean "order".
 *
 * Pure string building — the controller puts the result into a `sap.ui.core.HTML` control.
 * Colours and line styles live in css/style.css (classes `mr…`).
 */

/** A pipe as the map needs it (subset of `RoundStop`). */
export interface MapPipe {
  readonly rank?: number;
  readonly pipeID?: string;
  readonly status?: string;
  readonly pipelineType?: string;
  readonly mapPath?: string;
  /** true = it needs Maren, so it is a stop on her route. */
  readonly onRound?: boolean;
}

/** A landmark as the map needs it (`MapPlace` of the water service). */
export interface MapLandmark {
  readonly name?: string;
  readonly kind?: string;
  readonly gridCell?: string;
  readonly supplyStatus?: string;
  readonly supplyPercentage?: number | null;
}

/** Texts of the legend, from i18n. */
export interface MapTexts {
  readonly legendTitle: string;
  readonly route: string;
  readonly alarm: string;
  readonly unknown: string;
  readonly warning: string;
  readonly repaired: string;
  readonly ok: string;
  readonly droplet: string;
}

export interface MapInput {
  readonly imageUrl: string;
  /** Id of the caption that describes the map; also used to make SVG ids unique. */
  readonly labelledBy: string;
  readonly pipes: readonly MapPipe[];
  readonly places: readonly MapLandmark[];
  readonly texts: MapTexts;
}

// The village map (README → "The village map"): image size and the 8 × 8 grid on it, in px.
const IMAGE = { width: 2048, height: 1536 };
const GRID = { x: 150, y: 120, width: 1750, height: 1280 };
const CELL_W = GRID.width / 8;
const CELL_H = GRID.height / 8;
const COLUMNS = "ABCDEFGH";

/** Places that get a water droplet: the ones Maren's rules say depend on the water. */
const DEPENDS_ON_WATER = new Set(["residential", "bakery", "farm"]);

interface Point {
  readonly x: number;
  readonly y: number;
}

function n(value: number): string {
  return value.toFixed(1);
}

/** Grid units (x/y from the south-west corner of A1) → image pixels. */
function toPixel(x: number, y: number): Point {
  return { x: GRID.x + x * CELL_W, y: GRID.y + (8 - y) * CELL_H };
}

/** "E6" → the pixel centre of that cell. */
function cellCentre(gridCell: string | undefined): Point | null {
  const match = /^([A-H])([1-8])$/i.exec((gridCell ?? "").trim());
  if (!match) return null;
  return toPixel(COLUMNS.indexOf(match[1].toUpperCase()) + 0.5, Number(match[2]) - 0.5);
}

function parseMapPath(mapPath: string | undefined): Point[] {
  return (mapPath ?? "")
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number))
    .filter((xy) => xy.length === 2 && xy.every(Number.isFinite))
    .map(([x, y]) => toPixel(x, y));
}

/** The point halfway along a path (by length): where the stop number goes. */
function halfway(path: readonly Point[]): Point {
  const lengths = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y));
  let remaining = lengths.reduce((sum, l) => sum + l, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const t = lengths[i] === 0 ? 0 : remaining / lengths[i];
      return { x: path[i].x + (path[i + 1].x - path[i].x) * t, y: path[i].y + (path[i + 1].y - path[i].y) * t };
    }
    remaining -= lengths[i];
  }
  return path[path.length - 1];
}

/**
 * The footpath between the stops: one gentle curve per leg (so it reads as a walk, not as another
 * pipe) plus an arrow halfway each leg showing the walking direction.
 */
function footpath(stops: readonly Point[]): { d: string; arrows: string } {
  if (stops.length < 2) return { d: "", arrows: "" };
  let d = `M${n(stops[0].x)},${n(stops[0].y)}`;
  let arrows = "";
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    // control point: the midpoint, pushed sideways by 30 % of the distance
    const c = { x: (a.x + b.x) / 2 - (b.y - a.y) * 0.3, y: (a.y + b.y) / 2 + (b.x - a.x) * 0.3 };
    d += ` Q${n(c.x)},${n(c.y)} ${n(b.x)},${n(b.y)}`;
    // halfway the quadratic curve (t = 0.5); its direction there is b - a
    const mid = { x: 0.25 * a.x + 0.5 * c.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * c.y + 0.25 * b.y };
    const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    arrows += `<path class="mrRouteArrow" d="M-16,-13 L16,0 L-16,13 Z" transform="translate(${n(mid.x)},${n(mid.y)}) rotate(${n(angle)})"/>`;
  }
  return { d, arrows };
}

// ---------------------------------------------------------------------------------------------
// Illustrations for the evening view — every icon is drawn around (0,0) and moved into place.
// ---------------------------------------------------------------------------------------------

/** A little house: walls, roof, door. */
function house(x: number, y: number, width: number, roofClass: string): string {
  const h = width * 0.7;
  const roof = `${n(x - width * 0.62)},${n(y - h / 2)} ${n(x)},${n(y - h / 2 - width * 0.5)} ${n(x + width * 0.62)},${n(y - h / 2)}`;
  return (
    `<rect class="mrHouseWall" x="${n(x - width / 2)}" y="${n(y - h / 2)}" width="${n(width)}" height="${n(h)}"/>` +
    `<polygon class="${roofClass}" points="${roof}"/>` +
    `<rect class="mrHouseDoor" x="${n(x - width * 0.12)}" y="${n(y + h / 2 - h * 0.45)}" width="${n(width * 0.24)}" height="${n(h * 0.45)}"/>`
  );
}

function tree(x: number, y: number, r: number): string {
  return `<circle class="mrTree" cx="${n(x)}" cy="${n(y)}" r="${n(r)}"/><circle class="mrTreeShine" cx="${n(x - r * 0.3)}" cy="${n(y - r * 0.3)}" r="${n(r * 0.35)}"/>`;
}

const ICONS: Readonly<Record<string, () => string>> = {
  spring: () =>
    `<ellipse class="mrPond" rx="78" ry="40"/><ellipse class="mrPondRing" rx="46" ry="20"/>` +
    `<ellipse class="mrStone" cx="-76" cy="-14" rx="14" ry="9"/><ellipse class="mrStone" cx="70" cy="22" rx="16" ry="10"/><ellipse class="mrStone" cx="24" cy="-40" rx="12" ry="8"/>`,
  mill: () =>
    house(-22, 6, 64, "mrRoofTerracotta") +
    `<g transform="translate(38,14)"><circle class="mrWheel" r="34"/>` +
    [0, 45, 90, 135].map((a) => `<line class="mrWheelSpoke" x1="0" y1="-34" x2="0" y2="34" transform="rotate(${a})"/>`).join("") +
    `<circle class="mrWheelHub" r="7"/></g>`,
  market: () =>
    `<ellipse class="mrSquare" rx="96" ry="46"/>` +
    [-52, 0, 52]
      .map((x, i) => `<rect class="mrStall" x="${x - 20}" y="-34" width="40" height="26"/><rect class="mrAwning mrAwning${i}" x="${x - 24}" y="-44" width="48" height="12"/>`)
      .join("") +
    `<circle class="mrWell" cy="18" r="13"/><circle class="mrPond" cy="18" r="7"/>`,
  inn: () =>
    house(0, 4, 96, "mrRoofTerracotta") +
    `<rect class="mrChimney" x="22" y="-70" width="14" height="28"/>` +
    `<line class="mrSignPost" x1="62" y1="38" x2="62" y2="-4"/><rect class="mrSign" x="54" y="-2" width="26" height="18"/>`,
  residential: () =>
    house(-46, -14, 40, "mrRoofTerracotta") +
    house(0, -22, 40, "mrRoofSand") +
    house(46, -14, 40, "mrRoofLilac") +
    house(-24, 30, 40, "mrRoofSky") +
    house(26, 30, 40, "mrRoofTerracotta"),
  bakery: () =>
    house(0, 6, 84, "mrRoofSand") +
    `<rect class="mrChimney" x="18" y="-62" width="14" height="26"/>` +
    `<circle class="mrSmoke" cx="25" cy="-76" r="8"/><circle class="mrSmoke" cx="34" cy="-92" r="10"/>` +
    `<ellipse class="mrBread" cx="-58" cy="34" rx="18" ry="11"/>`,
  farm: () =>
    `<rect class="mrField" x="-92" y="-36" width="84" height="56" transform="rotate(-6)"/>` +
    `<rect class="mrFieldGreen" x="0" y="-40" width="84" height="56" transform="rotate(-6)"/>` +
    [-80, -60, -40].map((x) => tree(x, 46, 11)).join("") +
    `<ellipse class="mrSheep" cx="40" cy="44" rx="13" ry="9"/><ellipse class="mrSheep" cx="64" cy="48" rx="13" ry="9"/>`,
  forest: () =>
    [
      [-60, -10, 26],
      [-20, -26, 30],
      [24, -16, 28],
      [62, -2, 24],
      [-36, 22, 26],
      [10, 20, 30],
      [52, 30, 22],
    ]
      .map(([x, y, r]) => tree(x, y, r))
      .join(""),
};

/** Where a droplet sits relative to its place (default: up and to the right). */
const DROPLET_OFFSET: Readonly<Record<string, Point>> = { residential: { x: -112, y: -58 } };

/** How far below the centre the name goes (wide icons need more room). */
const LABEL_OFFSET: Readonly<Record<string, number>> = { forest: 76, farm: 86, residential: 80, market: 78, spring: 70, mill: 76, inn: 76, bakery: 76 };

// ---------------------------------------------------------------------------------------------
// Pieces of the map
// ---------------------------------------------------------------------------------------------

/** A droplet around (0,0), 86 px tall: the tip at y = -44, the round bottom at y = 42. */
const DROPLET = "M0,-44 C16,-22 30,-6 30,12 A30,30 0 1 1 -30,12 C-30,-6 -16,-22 0,-44 Z";
const DROPLET_TOP = -44;
const DROPLET_HEIGHT = 86;
/** Droplet size next to a drawing (1 = 86 px tall). */
const DROPLET_SCALE = 1.15;

function drawPipes(pipes: readonly MapPipe[]): string {
  // fine pipes first, the round's first stop last — so it is drawn on top
  const ordered = [...pipes].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  return ordered
    .map((pipe) => {
      const path = parseMapPath(pipe.mapPath);
      if (path.length < 2) return "";
      const attrs = `points="${path.map((p) => `${n(p.x)},${n(p.y)}`).join(" ")}"`;
      const backup = pipe.pipelineType === "secondary" ? " mrPipeBackup" : "";
      return (
        `<g class="mrPipe" data-status="${encodeXML(pipe.status ?? "ok")}"><title>${encodeXML(pipe.pipeID ?? "")}</title>` +
        `<polyline ${attrs} class="mrPipeCasing"/><polyline ${attrs} class="mrPipeLine${backup}"/></g>`
      );
    })
    .join("");
}

function drawDroplet(place: MapLandmark, clipId: string, at: Point): string {
  // null = "I don't know" somewhere on the way: an empty droplet with a question mark
  const known = place.supplyPercentage !== null && place.supplyPercentage !== undefined;
  const percentage = Math.max(0, Math.min(100, place.supplyPercentage ?? 0));
  const fill = known ? (DROPLET_HEIGHT * percentage) / 100 : 0;
  return (
    `<g class="mrDrop" data-status="${encodeXML(place.supplyStatus || "ok")}" transform="translate(${n(at.x)},${n(at.y)}) scale(${DROPLET_SCALE})">` +
    `<clipPath id="${clipId}"><path d="${DROPLET}"/></clipPath>` +
    `<path class="mrDropShell" d="${DROPLET}"/>` +
    `<rect class="mrDropWater" clip-path="url(#${clipId})" x="-32" y="${n(DROPLET_TOP + DROPLET_HEIGHT - fill)}" width="64" height="${n(fill)}"/>` +
    `<path class="mrDropOutline" d="${DROPLET}"/>` +
    `<text class="mrDropText" y="24">${known ? `${percentage}%` : place.supplyStatus === "repaired" ? "✓" : "?"}</text></g>`
  );
}

/** One place: its drawing, a water droplet beside it if it depends on a pipe, and its name (once). */
function drawPlace(place: MapLandmark, index: number, idPrefix: string, labelled: Set<string>): { art: string; label: string } {
  const centre = cellCentre(place.gridCell);
  const draw = ICONS[place.kind ?? ""];
  if (!centre || !draw) return { art: "", label: "" };
  const name = place.name ?? "";
  const firstOfName = !labelled.has(name);
  labelled.add(name);

  let art = `<g class="mrPlace" transform="translate(${n(centre.x)},${n(centre.y)})">${draw()}</g>`;
  if (DEPENDS_ON_WATER.has(place.kind ?? "")) {
    // the droplet sits beside the drawing like a tag (left of the houses: their pipe arrives from the right)
    const offset = DROPLET_OFFSET[place.kind ?? ""] ?? { x: 96, y: -66 };
    art += drawDroplet(place, `${idPrefix}-drop${index}`, { x: centre.x + offset.x, y: centre.y + offset.y });
  }
  const label = firstOfName
    ? `<text class="mrPlaceLabel${place.kind === "forest" ? " mrPlaceScenery" : ""}" x="${n(centre.x)}" y="${n(centre.y + (LABEL_OFFSET[place.kind ?? ""] ?? 70))}">${encodeXML(name)}</text>`
    : "";
  return { art, label };
}

function drawRoute(stops: readonly MapPipe[]): { path: string; marks: string } {
  const points = [...stops]
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((stop) => ({ stop, path: parseMapPath(stop.mapPath) }))
    .filter(({ path }) => path.length >= 2)
    .map(({ stop, path }) => ({ stop, at: halfway(path) }));
  const { d, arrows } = footpath(points.map((p) => p.at));
  const route = d ? `<path class="mrRouteShadow" d="${d}"/><path class="mrRoute" d="${d}"/>${arrows}` : "";
  const marks = points
    .map(
      ({ stop, at }) =>
        `<g class="mrStopMark" transform="translate(${n(at.x)},${n(at.y)})"><circle r="${stop.rank === 1 ? 36 : 30}"/>` +
        `<text dy="0.35em">${encodeXML(String(stop.rank ?? ""))}</text></g>`,
    )
    .join("");
  return { path: route, marks };
}

function drawLegend(texts: MapTexts): string {
  const width = 470;
  const x = GRID.x + GRID.width - width - 20;
  const y = GRID.y + GRID.height - 356;
  const row = (i: number, swatch: string, text: string): string =>
    `<g transform="translate(${x + 28},${y + 78 + i * 38})">${swatch}<text class="mrLegendText" x="66" dy="0.35em">${encodeXML(text)}</text></g>`;
  const pipe = (status: string): string =>
    `<g class="mrPipe" data-status="${status}"><line class="mrPipeCasing" x1="0" y1="0" x2="46" y2="0"/><line class="mrPipeLine" x1="0" y1="0" x2="46" y2="0"/></g>`;
  return (
    `<g class="mrLegend"><rect class="mrLegendBox" x="${x}" y="${y}" width="${width}" height="342" rx="18"/>` +
    `<text class="mrLegendTitle" x="${x + 28}" y="${y + 42}">${encodeXML(texts.legendTitle)}</text>` +
    row(0, `<g class="mrStopMark" transform="translate(22,0)"><circle r="17"/><text dy="0.35em" class="mrStopMarkSmall">1</text></g>`, texts.route) +
    row(1, pipe("alarm"), texts.alarm) +
    row(2, pipe("unknown"), texts.unknown) +
    row(3, pipe("warning"), texts.warning) +
    row(4, pipe("repaired"), texts.repaired) +
    row(5, pipe("ok"), texts.ok) +
    row(6, `<g class="mrDrop" data-status="alarm" transform="translate(22,0) scale(0.36)"><path class="mrDropOutline" d="${DROPLET}"/><rect class="mrDropWater" x="-30" y="12" width="60" height="30"/></g>`, texts.droplet) +
    `</g>`
  );
}

/** The complete SVG (wrapped in a div, as `sap.ui.core.HTML` needs one root element). */
export function buildRoundMap(input: MapInput): string {
  const idPrefix = input.labelledBy.replace(/[^\w-]/g, "_") || "mrMap";
  const labelled = new Set<string>();
  const places = input.places.map((place, i) => drawPlace(place, i, idPrefix, labelled));
  const route = drawRoute(input.pipes.filter((pipe) => pipe.onRound));
  return (
    `<div class="mrMapWrap"><svg class="mrMap" viewBox="0 0 ${IMAGE.width} ${IMAGE.height}" role="img" aria-labelledby="${encodeXML(input.labelledBy)}" xmlns="http://www.w3.org/2000/svg">` +
    `<image href="${encodeXML(input.imageUrl)}" width="${IMAGE.width}" height="${IMAGE.height}"/>` +
    `<rect class="mrMapVeil" width="${IMAGE.width}" height="${IMAGE.height}"/>` +
    drawPipes(input.pipes) +
    route.path +
    places.map((place) => place.art).join("") +
    places.map((place) => place.label).join("") +
    route.marks +
    drawLegend(input.texts) +
    `</svg></div>`
  );
}
