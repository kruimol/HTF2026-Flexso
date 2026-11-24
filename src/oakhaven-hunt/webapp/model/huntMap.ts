/**
 * The clickable village map of the Oakhaven Hunt: one SVG of 2048 × 1536 over the painted map,
 * with the same grid, places and drawings as Morning Round's map (src/water-app/webapp/model/roundMap.ts),
 * so the village looks the same in every app. Every place is a button (data-place), with a glow on
 * hover/focus, a bobbing star while unvisited and a stamp once visited.
 *
 * @namespace oakhaven.hunt.model
 */

export interface HuntLandmark {
  readonly name: string;
  readonly kind?: string;
  readonly gridCell?: string;
}

export interface HuntPipe {
  readonly mapPath?: string;
}

export interface HuntPlace {
  /** Stable id, used as data-place. */
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  /** Every grid cell of this place (the forest has three). */
  readonly cells: readonly string[];
  readonly visited: boolean;
  /** Only places with a game are buttons; the others are scenery (drawing and name). */
  readonly clickable: boolean;
}

export interface HuntMapInput {
  readonly imageUrl: string;
  readonly places: readonly HuntPlace[];
  readonly pipes: readonly HuntPipe[];
  readonly texts: { readonly title: string; readonly north: string; readonly south: string; readonly visit: string; readonly visited: string };
}

interface Point {
  readonly x: number;
  readonly y: number;
}

// The village map: image size and the 8 × 8 grid on it, in px (same as Morning Round).
const IMAGE = { width: 2048, height: 1536 };
const GRID = { x: 150, y: 120, width: 1750, height: 1280 };
const CELL_W = GRID.width / 8;
const CELL_H = GRID.height / 8;
const COLUMNS = "ABCDEFGH";

function n(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Grid units (x/y from the south-west corner of A1) → image pixels. */
function toPixel(x: number, y: number): Point {
  return { x: GRID.x + x * CELL_W, y: GRID.y + (8 - y) * CELL_H };
}

/** "E6" → the pixel centre of that cell. */
export function cellCentre(gridCell: string | undefined): Point | null {
  const match = /^([A-H])([1-8])$/i.exec((gridCell ?? "").trim());
  if (!match) return null;
  return toPixel(COLUMNS.indexOf(match[1].toUpperCase()) + 0.5, Number(match[2]) - 0.5);
}

function parseMapPath(mapPath: string | undefined): Point[] {
  return (mapPath ?? "")
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number))
    .filter((pair) => pair.length === 2 && pair.every(Number.isFinite))
    .map(([x, y]) => toPixel(x, y));
}

// ------------------------------------------------------------------------------------------------
// Drawings of the places (same as Morning Round)
// ------------------------------------------------------------------------------------------------

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

/** Each drawing is centred on (0,0) and about 200 × 150 px. */
export const DRAWINGS: Readonly<Record<string, () => string>> = {
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
      .map((x, i) => `<rect class="mrStall" x="${x - 20}" y="-34" width="40" height="26"/><rect class="mrAwning${i}" x="${x - 24}" y="-44" width="48" height="12"/>`)
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

/** How far below the centre the name goes (the farms: above, clear of the grid letters). */
const LABEL_OFFSET: Readonly<Record<string, number>> = { forest: 76, farm: -70, residential: 80, market: 78, spring: 70, mill: 76, inn: 76, bakery: 76 };

/** A small picture of one place, for the place card. */
export function buildPlaceArt(kind: string): string {
  const draw = DRAWINGS[kind];
  if (!draw) return "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-120 -110 240 180" aria-hidden="true"><g>${draw()}</g></svg>`;
}

// ------------------------------------------------------------------------------------------------
// Pieces of the map
// ------------------------------------------------------------------------------------------------

/** Faint grid lines and the letters A–H / numbers 1–8 around the edge. */
function drawGrid(): string {
  let lines = "";
  let marks = "";
  for (let i = 1; i < 8; i++) {
    const x = GRID.x + i * CELL_W;
    const y = GRID.y + i * CELL_H;
    lines += `<line class="huntGridLine" x1="${n(x)}" y1="${GRID.y}" x2="${n(x)}" y2="${GRID.y + GRID.height}"/>`;
    lines += `<line class="huntGridLine" x1="${GRID.x}" y1="${n(y)}" x2="${GRID.x + GRID.width}" y2="${n(y)}"/>`;
  }
  const mark = (x: number, y: number, label: string): string =>
    `<circle class="huntGridMark" cx="${n(x)}" cy="${n(y)}" r="20"/><text class="huntGridText" x="${n(x)}" y="${n(y)}">${label}</text>`;
  for (let i = 0; i < 8; i++) {
    const x = GRID.x + (i + 0.5) * CELL_W;
    marks += mark(x, GRID.y - 4, COLUMNS[i]) + mark(x, GRID.y + GRID.height + 4, COLUMNS[i]);
    const y = GRID.y + (7 - i + 0.5) * CELL_H;
    marks += mark(GRID.x - 4, y, String(i + 1)) + mark(GRID.x + GRID.width + 4, y, String(i + 1));
  }
  return `<g aria-hidden="true">${lines}${marks}</g>`;
}

/** The river from Silverbrook Spring down to the southern edge (scenery). */
function drawRiver(): string {
  const start = cellCentre("G7") ?? { x: 1572, y: 360 };
  const d =
    `M${n(start.x + 80)},${n(start.y + 10)} ` +
    `C${n(start.x + 160)},${n(start.y + 140)} ${n(start.x + 40)},${n(start.y + 300)} ${n(start.x + 120)},${n(start.y + 460)} ` +
    `S${n(start.x + 200)},${n(start.y + 720)} ${n(start.x + 110)},${n(start.y + 860)} ` +
    `S${n(start.x + 60)},${n(GRID.y + GRID.height - 20)} ${n(start.x + 90)},${n(GRID.y + GRID.height + 10)}`;
  return `<g aria-hidden="true"><path class="huntRiver" d="${d}"/><path class="huntRiverShine" d="${d}"/></g>`;
}

function drawPipes(pipes: readonly HuntPipe[]): string {
  return `<g aria-hidden="true">${pipes
    .map((pipe) => parseMapPath(pipe.mapPath))
    .filter((path) => path.length > 1)
    .map((path) => `<path class="huntPipe" d="M${path.map((p) => `${n(p.x)},${n(p.y)}`).join(" L")}"/>`)
    .join("")}</g>`;
}

/** Five-pointed star around (0,0). */
function star(r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${n(Math.cos(angle) * radius)},${n(Math.sin(angle) * radius)}`);
  }
  return `<polygon class="huntStar" points="${points.join(" ")}"/>`;
}

/** One clickable place: hit area, glow, drawing(s), name, and a star or a stamp. */
function drawPlace(place: HuntPlace, texts: HuntMapInput["texts"]): string {
  const centres = place.cells.map(cellCentre).filter((point): point is Point => point !== null);
  if (centres.length === 0) return "";
  const main = centres[0];
  const draw = DRAWINGS[place.kind] ?? ((): string => `<circle class="mrPin" r="18"/>`);
  const art = centres
    .map((c) => `<circle class="huntHalo" cx="${n(c.x)}" cy="${n(c.y)}" r="118"/><circle class="huntHit" cx="${n(c.x)}" cy="${n(c.y)}" r="118"/>` +
      `<g transform="translate(${n(c.x)},${n(c.y)})">${draw()}</g>`)
    .join("");
  const label = `<text class="mrPlaceLabel" x="${n(main.x)}" y="${n(main.y + (LABEL_OFFSET[place.kind] ?? 70))}">${esc(place.name)}</text>`;
  const badge = place.visited
    ? `<g transform="translate(${n(main.x + 92)},${n(main.y - 70)})"><circle class="huntStamp" r="26"/><path class="huntStampTick" d="M-11,0 L-3,9 L12,-9"/></g>`
    : `<g transform="translate(${n(main.x + 92)},${n(main.y - 70)})"><g>${star(26)}</g></g>`;
  if (!place.clickable) {
    const scenery = centres.map((c) => `<g transform="translate(${n(c.x)},${n(c.y)})">${draw()}</g>`).join("");
    return `<g class="huntScenery" aria-hidden="true">${scenery}${label.replace('class="mrPlaceLabel"', 'class="mrPlaceLabel mrPlaceScenery"')}</g>`;
  }
  const aria = `${place.name}, ${place.visited ? texts.visited : texts.visit}`;
  return `<g class="huntPlace" data-place="${esc(place.id)}" tabindex="0" role="button" aria-label="${esc(aria)}"><title>${esc(aria)}</title>${art}${label}${badge}</g>`;
}

/** The whole clickable map. */
export function buildHuntMap(input: HuntMapInput): string {
  const regions =
    `<text class="huntRegion" x="${n(toPixel(4.35, 7.55).x)}" y="${n(toPixel(4.35, 7.55).y)}">${esc(input.texts.north)}</text>` +
    `<text class="huntRegion" x="${n(toPixel(2.2, 0.8).x)}" y="${n(toPixel(2.2, 0.8).y)}">${esc(input.texts.south)}</text>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${IMAGE.width} ${IMAGE.height}" role="group" aria-label="${esc(input.texts.title)}">` +
    `<image href="${esc(input.imageUrl)}" x="0" y="0" width="${IMAGE.width}" height="${IMAGE.height}"/>` +
    `<rect class="mrMapVeil" x="0" y="0" width="${IMAGE.width}" height="${IMAGE.height}"/>` +
    drawGrid() +
    drawRiver() +
    drawPipes(input.pipes) +
    `<g aria-hidden="true">${regions}</g>` +
    input.places.map((place) => drawPlace(place, input.texts)).join("") +
    `</svg>`
  );
}
