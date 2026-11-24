/**
 * The pipe puzzle at Silverbrook Spring: turn the pipes until the water runs from the spring
 * (top left) to Oakhaven (bottom right). Pure functions: board in, board / SVG out.
 *
 * Every puzzle is first built as a network that works (a random spanning tree over the grid, so
 * every pipe belongs to it), then every pipe is turned a random number of quarter turns. So every
 * puzzle can be solved.
 *
 * @namespace oakhaven.hunt.model
 */

/** Openings of a pipe, as bits: north, east, south, west. */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export interface PipeBoard {
  readonly size: number;
  /** Openings per cell, row by row. */
  readonly cells: readonly number[];
}

export interface BoardTexts {
  readonly title: string;
  readonly turn: string;
  readonly spring: string;
  readonly village: string;
}

const STEPS: ReadonlyArray<{ bit: number; opposite: number; dr: number; dc: number }> = [
  { bit: N, opposite: S, dr: -1, dc: 0 },
  { bit: E, opposite: W, dr: 0, dc: 1 },
  { bit: S, opposite: N, dr: 1, dc: 0 },
  { bit: W, opposite: E, dr: 0, dc: -1 },
];

/** A quarter turn clockwise: north → east → south → west → north. */
export function turn(mask: number): number {
  return ((mask << 1) | (mask >> 3)) & 15;
}

function turnTimes(mask: number, times: number): number {
  let m = mask;
  for (let i = 0; i < times % 4; i++) m = turn(m);
  return m;
}

/** A small, seedable random generator, so a puzzle can be replayed (and tested). */
function random(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** The solved network: a random spanning tree, the spring entering top left, Oakhaven leaving bottom right. */
export function solvedBoard(size: number, seed: number): PipeBoard {
  const rnd = random(seed);
  const cells = new Array<number>(size * size).fill(0);
  const seen = new Array<boolean>(size * size).fill(false);
  const stack = [0];
  seen[0] = true;
  while (stack.length > 0) {
    const index = stack[stack.length - 1];
    const r = Math.floor(index / size);
    const c = index % size;
    const options = STEPS.filter((step) => {
      const nr = r + step.dr;
      const nc = c + step.dc;
      return nr >= 0 && nr < size && nc >= 0 && nc < size && !seen[nr * size + nc];
    });
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const step = options[Math.floor(rnd() * options.length)];
    const next = (r + step.dr) * size + (c + step.dc);
    cells[index] |= step.bit;
    cells[next] |= step.opposite;
    seen[next] = true;
    stack.push(next);
  }
  cells[0] |= W; // from the spring
  cells[size * size - 1] |= E; // to Oakhaven
  return { size, cells };
}

/** A new puzzle: the solved network with every pipe turned at random (never already solved). */
export function newPuzzle(size: number, seed: number): PipeBoard {
  const rnd = random(seed * 7919 + 17);
  const solved = solvedBoard(size, seed);
  let cells = solved.cells.map((mask) => turnTimes(mask, Math.floor(rnd() * 4)));
  if (isSolved({ size, cells })) cells = cells.map((mask, i) => (i === 0 ? turn(mask) : mask));
  return { size, cells };
}

/** Turns the pipe in one cell a quarter turn clockwise. */
export function turnCell(board: PipeBoard, index: number): PipeBoard {
  return { size: board.size, cells: board.cells.map((mask, i) => (i === index ? turn(mask) : mask)) };
}

/** Which cells have water: everything connected to the spring (which enters cell 0 from the west). */
export function water(board: PipeBoard): boolean[] {
  const { size, cells } = board;
  const wet = new Array<boolean>(size * size).fill(false);
  if (!(cells[0] & W)) return wet;
  const queue = [0];
  wet[0] = true;
  while (queue.length > 0) {
    const index = queue.shift() as number;
    const r = Math.floor(index / size);
    const c = index % size;
    for (const step of STEPS) {
      if (!(cells[index] & step.bit)) continue;
      const nr = r + step.dr;
      const nc = c + step.dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      const next = nr * size + nc;
      if (!wet[next] && cells[next] & step.opposite) {
        wet[next] = true;
        queue.push(next);
      }
    }
  }
  return wet;
}

/** Solved when the water reaches the last cell and flows out east, into Oakhaven. */
export function isSolved(board: PipeBoard): boolean {
  const last = board.size * board.size - 1;
  return water(board)[last] && Boolean(board.cells[last] & E);
}

// ------------------------------------------------------------------------------------------------
// Drawing
// ------------------------------------------------------------------------------------------------

const CELL = 100;

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** One pipe, centred on (0,0): arms to its openings, a round joint in the middle. */
function pipe(mask: number, wet: boolean): string {
  const cls = wet ? "pzPipe pzWet" : "pzPipe";
  const arms = STEPS.filter((step) => mask & step.bit)
    .map((step) => `M0,0 L${step.dc * 50},${step.dr * 50}`)
    .join(" ");
  const count = STEPS.filter((step) => mask & step.bit).length;
  return `<path class="pzCasing" d="${arms}"/><path class="${cls}" d="${arms}"/>` +
    (count === 1 ? `<circle class="${cls}End" r="14"/>` : `<circle class="${cls}Joint" r="11"/>`);
}

/**
 * The board: the spring left of the first row, Oakhaven right of the last row, the pipes in
 * between. Every cell is a button (data-cell) that turns its pipe.
 */
export function buildBoardSvg(board: PipeBoard, texts: BoardTexts, springArt: string, villageArt: string): string {
  const { size, cells } = board;
  const wet = water(board);
  const solved = isSolved(board);
  const width = (size + 2) * CELL;
  const height = size * CELL;
  let tiles = "";
  cells.forEach((mask, i) => {
    const r = Math.floor(i / size);
    const c = i % size;
    const x = (c + 1) * CELL;
    const y = r * CELL;
    tiles += `<g class="pzTile" data-cell="${i}" tabindex="0" role="button" aria-label="${esc(`${texts.turn} ${r + 1}, ${c + 1}`)}">` +
      `<rect class="pzCell" x="${x + 3}" y="${y + 3}" width="${CELL - 6}" height="${CELL - 6}" rx="12"/>` +
      `<g transform="translate(${x + CELL / 2},${y + CELL / 2})">${pipe(mask, wet[i])}</g></g>`;
  });
  // The spring feeds the first cell from the west; the last cell feeds Oakhaven to the east.
  const inlet = `<path class="pzCasing" d="M${CELL * 0.62},${CELL / 2} L${CELL},${CELL / 2}"/><path class="pzPipe pzWet" d="M${CELL * 0.62},${CELL / 2} L${CELL},${CELL / 2}"/>`;
  const outY = (size - 1) * CELL + CELL / 2;
  const outlet = `<path class="pzCasing" d="M${(size + 1) * CELL},${outY} L${(size + 1) * CELL + CELL * 0.3},${outY}"/>` +
    `<path class="${solved ? "pzPipe pzWet" : "pzPipe"}" d="M${(size + 1) * CELL},${outY} L${(size + 1) * CELL + CELL * 0.3},${outY}"/>`;
  const spring = `<g transform="translate(${CELL / 2 - 4},${CELL / 2 - 6}) scale(0.5)">${springArt}</g>` +
    `<text class="pzLabel" x="${CELL / 2}" y="${CELL - 4}">${esc(texts.spring)}</text>`;
  const village = `<g class="${solved ? "pzVillage pzVillageWet" : "pzVillage"}" transform="translate(${(size + 1) * CELL + CELL / 2 + 4},${outY - 6}) scale(0.42)">${villageArt}</g>` +
    `<text class="pzLabel" x="${(size + 1) * CELL + CELL / 2}" y="${outY + CELL / 2 - 4}">${esc(texts.village)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="group" aria-label="${esc(texts.title)}">` +
    `<rect class="pzBoard" x="${CELL}" y="0" width="${size * CELL}" height="${height}" rx="16"/>` +
    inlet + outlet + tiles + spring + village + `</svg>`;
}
