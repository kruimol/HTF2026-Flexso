/**
 * The maze in Deepwood Forest: walk with your lantern from the top-left corner to the torn page in
 * the bottom-right corner. The walls are rows of trees. Pure functions: seed in, maze / SVG out.
 *
 * Every maze is a "perfect" maze (a random spanning tree over the grid): exactly one way between any
 * two spots, so it can always be solved.
 *
 * @namespace oakhaven.hunt.model
 */

/** Open sides of a cell, as bits: north, east, south, west. */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export type Direction = "up" | "right" | "down" | "left";

export interface Maze {
  readonly cols: number;
  readonly rows: number;
  /** Open sides per cell, row by row. */
  readonly cells: readonly number[];
}

const STEP: Readonly<Record<Direction, { bit: number; opposite: number; dr: number; dc: number }>> = {
  up: { bit: N, opposite: S, dr: -1, dc: 0 },
  right: { bit: E, opposite: W, dr: 0, dc: 1 },
  down: { bit: S, opposite: N, dr: 1, dc: 0 },
  left: { bit: W, opposite: E, dr: 0, dc: -1 },
};

function random(seed: number): () => number {
  let s = (Math.imul(seed >>> 0, 2654435761) ^ 0x9e3779b9) >>> 0 || 1;
  const next = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  for (let i = 0; i < 4; i++) next();
  return next;
}

/** A new perfect maze (randomised depth-first search: long, winding paths). */
export function newMaze(cols: number, rows: number, seed: number): Maze {
  const rnd = random(seed);
  const cells = new Array<number>(cols * rows).fill(0);
  const seen = new Array<boolean>(cols * rows).fill(false);
  const stack = [0];
  seen[0] = true;
  while (stack.length > 0) {
    const index = stack[stack.length - 1];
    const r = Math.floor(index / cols);
    const c = index % cols;
    const options = (Object.keys(STEP) as Direction[]).filter((dir) => {
      const nr = r + STEP[dir].dr;
      const nc = c + STEP[dir].dc;
      return nr >= 0 && nr < rows && nc >= 0 && nc < cols && !seen[nr * cols + nc];
    });
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const step = STEP[options[Math.floor(rnd() * options.length)]];
    const next = (r + step.dr) * cols + (c + step.dc);
    cells[index] |= step.bit;
    cells[next] |= step.opposite;
    seen[next] = true;
    stack.push(next);
  }
  return { cols, rows, cells };
}

/** Where a step from `from` in `dir` lands, or null when a tree is in the way. */
export function move(maze: Maze, from: number, dir: Direction): number | null {
  const step = STEP[dir];
  if (!(maze.cells[from] & step.bit)) return null;
  const r = Math.floor(from / maze.cols) + step.dr;
  const c = (from % maze.cols) + step.dc;
  if (r < 0 || r >= maze.rows || c < 0 || c >= maze.cols) return null;
  return r * maze.cols + c;
}

/** The direction from one cell to a neighbouring cell, or null when they are not neighbours. */
export function directionTo(maze: Maze, from: number, to: number): Direction | null {
  const dr = Math.floor(to / maze.cols) - Math.floor(from / maze.cols);
  const dc = (to % maze.cols) - (from % maze.cols);
  const found = (Object.keys(STEP) as Direction[]).find((dir) => STEP[dir].dr === dr && STEP[dir].dc === dc);
  return found ?? null;
}

/** The shortest way from start to goal (for tests, and the "hint" later). */
export function solution(maze: Maze, start: number, goal: number): number[] {
  const previous = new Map<number, number>([[start, -1]]);
  const queue = [start];
  while (queue.length > 0) {
    const cell = queue.shift() as number;
    if (cell === goal) break;
    for (const dir of Object.keys(STEP) as Direction[]) {
      const next = move(maze, cell, dir);
      if (next !== null && !previous.has(next)) {
        previous.set(next, cell);
        queue.push(next);
      }
    }
  }
  const path: number[] = [];
  for (let cell = goal; cell !== -1 && previous.has(cell); cell = previous.get(cell) as number) path.unshift(cell);
  return path;
}

// ------------------------------------------------------------------------------------------------
// Drawing
// ------------------------------------------------------------------------------------------------

const CELL = 72;

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A row of trees along a wall from (x1,y1) to (x2,y2). */
function treeWall(x1: number, y1: number, x2: number, y2: number): string {
  const trees = 3;
  let out = `<line class="fmWall" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  for (let i = 0; i <= trees; i++) {
    const x = x1 + ((x2 - x1) * i) / trees;
    const y = y1 + ((y2 - y1) * i) / trees;
    out += `<circle class="fmTree" cx="${x}" cy="${y}" r="${i % 2 === 0 ? 11 : 9}"/>`;
  }
  return out;
}

/** The child with a lantern, around (0,0). */
function walker(): string {
  return (
    `<circle class="fmGlow" r="30"/>` +
    `<circle class="fmHead" cx="0" cy="-12" r="9"/><path class="fmBody" d="M-10,14 L0,-4 L10,14 Z"/>` +
    `<line class="fmArm" x1="4" y1="2" x2="14" y2="6"/><circle class="fmLantern" cx="16" cy="10" r="5"/>`
  );
}

/** The torn page, around (0,0). */
function page(): string {
  return `<path class="fmPage" d="M-16,-20 L14,-20 L18,-12 L12,-6 L18,2 L14,20 L-16,20 Z"/>` +
    `<line class="fmInk" x1="-10" y1="-10" x2="8" y2="-10"/><line class="fmInk" x1="-10" y1="-2" x2="6" y2="-2"/><line class="fmInk" x1="-10" y1="6" x2="9" y2="6"/>`;
}

/**
 * The forest: the walkway, a trail of where you have been, the trees (walls), the page and the
 * walker. Every cell is a button (data-cell): click a neighbouring cell to walk there.
 */
export function buildMazeSvg(maze: Maze, at: number, trail: readonly number[], texts: { title: string; walk: string }): string {
  const { cols, rows, cells } = maze;
  const width = cols * CELL;
  const height = rows * CELL;
  const centre = (cell: number): { x: number; y: number } => ({ x: (cell % cols) * CELL + CELL / 2, y: Math.floor(cell / cols) * CELL + CELL / 2 });
  const goal = cols * rows - 1;

  const hits = cells.map((_, i) => {
    const { x, y } = centre(i);
    return `<rect class="fmCell" data-cell="${i}" x="${x - CELL / 2}" y="${y - CELL / 2}" width="${CELL}" height="${CELL}" aria-label="${esc(texts.walk)}"/>`;
  }).join("");

  const trailPath = trail.length > 1
    ? `<polyline class="fmTrail" points="${trail.map((cell) => `${centre(cell).x},${centre(cell).y}`).join(" ")}"/>`
    : "";

  let walls = "";
  cells.forEach((mask, i) => {
    const x = (i % cols) * CELL;
    const y = Math.floor(i / cols) * CELL;
    // Draw the north and west wall of every cell, plus the outer east and south edge.
    if (!(mask & N)) walls += treeWall(x, y, x + CELL, y);
    if (!(mask & W)) walls += treeWall(x, y, x, y + CELL);
    if (i % cols === cols - 1 && !(mask & E)) walls += treeWall(x + CELL, y, x + CELL, y + CELL);
    if (Math.floor(i / cols) === rows - 1 && !(mask & S)) walls += treeWall(x, y + CELL, x + CELL, y + CELL);
  });

  const g = centre(goal);
  const w = centre(at);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 -14 ${width + 28} ${height + 28}" role="group" aria-label="${esc(texts.title)}" tabindex="0" class="fmSvg">` +
    `<rect class="fmGround" x="-14" y="-14" width="${width + 28}" height="${height + 28}" rx="16"/>` +
    hits + trailPath +
    `<g transform="translate(${g.x},${g.y})">${page()}</g>` +
    walls +
    `<g class="fmWalker" transform="translate(${w.x},${w.y})">${walker()}</g>` +
    `</svg>`;
}
