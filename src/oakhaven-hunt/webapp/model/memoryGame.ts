/**
 * The memory game in North Residential Area: find the pairs of the people and houses of Oakhaven.
 * Eight pairs: the four villagers the teams talked to and the four coloured roofs of the
 * neighbourhood on the map. Pure functions: seed in, deck / SVG out.
 *
 * @namespace oakhaven.hunt.model
 */

export interface Face {
  readonly id: string;
  readonly name: string;
  readonly kind: "person" | "house";
}

export const FACES: readonly Face[] = [
  { id: "maren", name: "Maren", kind: "person" },
  { id: "tobin", name: "Tobin", kind: "person" },
  { id: "rowan", name: "Rowan", kind: "person" },
  { id: "ilse", name: "Ilse", kind: "person" },
  { id: "terracotta", name: "Red roof", kind: "house" },
  { id: "sand", name: "Sand roof", kind: "house" },
  { id: "lilac", name: "Lilac roof", kind: "house" },
  { id: "sky", name: "Blue roof", kind: "house" },
];

export const COLUMNS = 4;

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

/** A shuffled deck: every face twice. Returns the face id per card. */
export function newDeck(seed: number): string[] {
  const rnd = random(seed);
  const deck = FACES.flatMap((face) => [face.id, face.id]);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function faceOf(id: string): Face | undefined {
  return FACES.find((face) => face.id === id);
}

// ------------------------------------------------------------------------------------------------
// Drawing
// ------------------------------------------------------------------------------------------------

const CARD_W = 120;
const CARD_H = 140;
const GAP = 16;

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A villager around (0,0): head, body in their colour, and the thing they are known for. */
function person(id: string): string {
  const coat: Record<string, string> = { maren: "mmCoatMaren", tobin: "mmCoatTobin", rowan: "mmCoatRowan", ilse: "mmCoatIlse" };
  const item: Record<string, string> = {
    // Maren: a water droplet
    maren: `<path class="mmDrop" d="M30,-6 C36,4 42,10 42,17 A12,12 0 1 1 18,17 C18,10 24,4 30,-6 Z"/>`,
    // Tobin: a loaf of bread and a baker's hat
    tobin: `<ellipse class="mmBread" cx="30" cy="16" rx="16" ry="10"/><path class="mmCrust" d="M20,12 L24,20 M28,10 L32,20 M36,12 L38,18"/>` +
      `<path class="mmHat" d="M-14,-36 C-20,-52 -6,-58 0,-50 C6,-58 20,-52 14,-36 Z"/>`,
    // Rowan: the chain of office of the council
    rowan: `<path class="mmChain" d="M-14,-12 Q0,4 14,-12"/><circle class="mmMedal" cx="0" cy="-2" r="6"/>`,
    // Ilse: a book and glasses
    ilse: `<rect class="mmBook" x="16" y="2" width="26" height="30" rx="3"/><line class="mmBookLine" x1="22" y1="10" x2="36" y2="10"/>` +
      `<circle class="mmGlasses" cx="-5" cy="-26" r="5"/><circle class="mmGlasses" cx="7" cy="-26" r="5"/>`,
  };
  return `<path class="${coat[id] ?? "mmCoatMaren"}" d="M-24,40 C-24,6 -14,-8 0,-8 C14,-8 24,6 24,40 Z"/>` +
    `<circle class="mmFace" cx="0" cy="-26" r="15"/>` + (item[id] ?? "");
}

/** A house with a coloured roof, like the houses of the neighbourhood on the map. */
function house(id: string): string {
  return `<rect class="mrHouseWall" x="-32" y="-10" width="64" height="48"/>` +
    `<polygon class="mrRoof${id[0].toUpperCase()}${id.slice(1)}" points="-42,-10 0,-46 42,-10"/>` +
    `<rect class="mrHouseDoor" x="-8" y="16" width="16" height="22"/><rect class="mmWindow" x="-24" y="0" width="12" height="12"/><rect class="mmWindow" x="12" y="0" width="12" height="12"/>`;
}

/**
 * The 4 × 4 cards. Open and matched cards show their face; closed cards show the copper back with
 * the Oakhaven oak. Every closed card is a button (data-card).
 */
export function buildMemorySvg(
  deck: readonly string[],
  open: readonly number[],
  matched: readonly number[],
  texts: { title: string; card: string },
): string {
  const rows = Math.ceil(deck.length / COLUMNS);
  const width = COLUMNS * CARD_W + (COLUMNS + 1) * GAP;
  const height = rows * CARD_H + (rows + 1) * GAP;
  const cards = deck
    .map((id, i) => {
      const x = GAP + (i % COLUMNS) * (CARD_W + GAP);
      const y = GAP + Math.floor(i / COLUMNS) * (CARD_H + GAP);
      const face = faceOf(id);
      const shown = open.includes(i) || matched.includes(i);
      const done = matched.includes(i);
      const cx = x + CARD_W / 2;
      if (!shown) {
        return `<g class="mmCard" data-card="${i}" tabindex="0" role="button" aria-label="${esc(`${texts.card} ${i + 1}`)}">` +
          `<rect class="mmBack" x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="14"/>` +
          `<rect class="mmBackFrame" x="${x + 8}" y="${y + 8}" width="${CARD_W - 16}" height="${CARD_H - 16}" rx="10"/>` +
          `<g transform="translate(${cx},${y + CARD_H / 2})"><circle class="mmOak" cx="0" cy="-8" r="22"/><rect class="mmTrunk" x="-5" y="10" width="10" height="20" rx="3"/></g></g>`;
      }
      const art = face?.kind === "person" ? person(id) : house(id);
      return `<g class="mmCard mmOpen${done ? " mmMatched" : ""}" aria-label="${esc(face?.name ?? id)}">` +
        `<rect class="mmFront" x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="14"/>` +
        `<g transform="translate(${cx},${y + CARD_H / 2 - 8})">${art}</g>` +
        `<text class="mmName" x="${cx}" y="${y + CARD_H - 12}">${esc(face?.name ?? id)}</text></g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="group" aria-label="${esc(texts.title)}">${cards}</svg>`;
}
