/**
 * The word search at the bakery: find Tobin's baking words in a grid of letters. Pure functions.
 *
 * For children: words only run left → right, top → bottom, or diagonally down-right. A child marks
 * a word by clicking its first and then its last letter (works with mouse, touch and keyboard).
 * A selection made backwards (last letter first) counts too.
 *
 * @namespace oakhaven.hunt.model
 */

export interface WordPlacement {
  readonly word: string;
  /** Cell indexes, from the first to the last letter. */
  readonly cells: readonly number[];
}

export interface WordGrid {
  readonly size: number;
  readonly letters: readonly string[];
  readonly placements: readonly WordPlacement[];
}

export interface WordTexts {
  readonly title: string;
  readonly letter: string;
}

/** Right, down, diagonally down-right. */
const DIRECTIONS: ReadonlyArray<{ dr: number; dc: number }> = [
  { dr: 0, dc: 1 },
  { dr: 1, dc: 0 },
  { dr: 1, dc: 1 },
];

const ALPHABET = "ABCDEFGHIJKLMNOPRSTUVWY";

function random(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Places every word (longest first) at a random free spot; letters may be shared when they are the
 * same. The rest is filled with random letters. Tries again with another seed if a word does not fit.
 */
export function newWordGrid(words: readonly string[], size: number, seed: number): WordGrid {
  for (let attempt = 0; attempt < 50; attempt++) {
    const rnd = random(seed + attempt * 101);
    const letters = new Array<string>(size * size).fill("");
    const placements: WordPlacement[] = [];
    let ok = true;
    for (const word of [...words].map((w) => w.toUpperCase()).sort((a, b) => b.length - a.length)) {
      let placed = false;
      for (let tries = 0; tries < 300 && !placed; tries++) {
        const { dr, dc } = DIRECTIONS[Math.floor(rnd() * DIRECTIONS.length)];
        const r0 = Math.floor(rnd() * (size - (dr ? word.length - 1 : 0)));
        const c0 = Math.floor(rnd() * (size - (dc ? word.length - 1 : 0)));
        const cells = [...word].map((_, i) => (r0 + dr * i) * size + (c0 + dc * i));
        if (cells.every((cell, i) => letters[cell] === "" || letters[cell] === word[i])) {
          cells.forEach((cell, i) => (letters[cell] = word[i]));
          placements.push({ word, cells });
          placed = true;
        }
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (let i = 0; i < letters.length; i++) if (!letters[i]) letters[i] = ALPHABET[Math.floor(rnd() * ALPHABET.length)];
    return { size, letters, placements };
  }
  throw new Error("words do not fit in the grid");
}

/** The cells on a straight line from a to b (row, column or diagonal), or null when not straight. */
export function lineCells(size: number, a: number, b: number): number[] | null {
  const ar = Math.floor(a / size);
  const ac = a % size;
  const br = Math.floor(b / size);
  const bc = b % size;
  const dr = Math.sign(br - ar);
  const dc = Math.sign(bc - ac);
  const length = Math.max(Math.abs(br - ar), Math.abs(bc - ac));
  if (!(ar === br || ac === bc || Math.abs(br - ar) === Math.abs(bc - ac))) return null;
  return Array.from({ length: length + 1 }, (_, i) => (ar + dr * i) * size + (ac + dc * i));
}

/** The word a selection from a to b marks, if it is one of the hidden words (either way round). */
export function wordAt(grid: WordGrid, a: number, b: number): string | null {
  const cells = lineCells(grid.size, a, b);
  if (!cells || cells.length < 2) return null;
  const key = (list: readonly number[]): string => list.join(",");
  const forward = key(cells);
  const backward = key([...cells].reverse());
  const hit = grid.placements.find((p) => key(p.cells) === forward || key(p.cells) === backward);
  return hit?.word ?? null;
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const CELL = 60;

/**
 * The grid: found words get a golden band behind their letters, the first letter of a selection
 * a copper ring. Every letter is a button (data-letter).
 */
export function buildWordGridSvg(grid: WordGrid, found: readonly string[], selected: number | null, texts: WordTexts): string {
  const { size, letters } = grid;
  const centre = (cell: number): { x: number; y: number } => ({
    x: (cell % size) * CELL + CELL / 2,
    y: Math.floor(cell / size) * CELL + CELL / 2,
  });
  const bands = grid.placements
    .filter((p) => found.includes(p.word))
    .map((p, i) => {
      const a = centre(p.cells[0]);
      const b = centre(p.cells[p.cells.length - 1]);
      return `<line class="wsBand wsBand${i % 4}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
    })
    .join("");
  const ring = selected === null ? "" : `<circle class="wsSelected" cx="${centre(selected).x}" cy="${centre(selected).y}" r="24"/>`;
  const cells = letters
    .map((letter, i) => {
      const { x, y } = centre(i);
      const label = `${texts.letter} ${letter}, ${Math.floor(i / size) + 1}, ${(i % size) + 1}`;
      return `<g class="wsCell" data-letter="${i}" tabindex="0" role="button" aria-label="${esc(label)}">` +
        `<rect class="wsHit" x="${x - CELL / 2}" y="${y - CELL / 2}" width="${CELL}" height="${CELL}"/>` +
        `<text class="wsLetter" x="${x}" y="${y}">${esc(letter)}</text></g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size * CELL} ${size * CELL}" role="group" aria-label="${esc(texts.title)}">` +
    `<rect class="wsBoard" x="0" y="0" width="${size * CELL}" height="${size * CELL}" rx="14"/>` +
    bands + ring + cells + `</svg>`;
}
