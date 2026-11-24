/**
 * Connect the products with the stalls at Central Market Square: click a product, then the stall
 * that sells it. The three stalls are the three coloured stalls of the village map; the products are
 * Oakhaven's own stock (the StockItems register). Pure functions: seed in, game / SVG out.
 *
 * @namespace oakhaven.hunt.model
 */

export type StallId = "bakery" | "dairy" | "farm";

export interface Stall {
  readonly id: StallId;
  readonly name: string;
  /** Awning colour class: the same three colours as the stalls on the map. */
  readonly awning: string;
}

export interface Product {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  readonly stall: StallId;
}

export interface MarketGame {
  /** The products of this game, in the order they stand on the left. */
  readonly products: readonly Product[];
}

export const STALLS: readonly Stall[] = [
  { id: "bakery", name: "Bakery stall", awning: "mrAwning0" },
  { id: "dairy", name: "Dairy stall", awning: "mrAwning1" },
  { id: "farm", name: "Farm stall", awning: "mrAwning2" },
];

/** Oakhaven's stock (db/data StockItems), each at the stall that would sell it. */
export const PRODUCTS: readonly Product[] = [
  { id: "bread", name: "Bread", emoji: "🍞", stall: "bakery" },
  { id: "flour", name: "Flour", emoji: "🥣", stall: "bakery" },
  { id: "salt", name: "Salt", emoji: "🧂", stall: "bakery" },
  { id: "milk", name: "Milk", emoji: "🥛", stall: "dairy" },
  { id: "cheese", name: "Cheese", emoji: "🧀", stall: "dairy" },
  { id: "butter", name: "Butter", emoji: "🧈", stall: "dairy" },
  { id: "eggs", name: "Eggs", emoji: "🥚", stall: "dairy" },
  { id: "apples", name: "Apples", emoji: "🍎", stall: "farm" },
  { id: "potatoes", name: "Potatoes", emoji: "🥔", stall: "farm" },
  { id: "grain", name: "Grain", emoji: "🌾", stall: "farm" },
];

/** How many products per stall in one game. */
const PER_STALL = 2;

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

function shuffle<T>(list: readonly T[], rnd: () => number): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** A new game: two products for every stall, shuffled. */
export function newMarket(seed: number): MarketGame {
  const rnd = random(seed);
  const picked = STALLS.flatMap((stall) => shuffle(PRODUCTS.filter((p) => p.stall === stall.id), rnd).slice(0, PER_STALL));
  return { products: shuffle(picked, rnd) };
}

export function stallOf(id: string): Stall | undefined {
  return STALLS.find((stall) => stall.id === id);
}

export function productOf(id: string): Product | undefined {
  return PRODUCTS.find((product) => product.id === id);
}

// ------------------------------------------------------------------------------------------------
// Drawing
// ------------------------------------------------------------------------------------------------

const WIDTH = 900;
const ROW = 70;
const PRODUCT_X = 40;
const PRODUCT_W = 250;
const STALL_X = 580;
const STALL_W = 280;

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A market stall around (0,0): counter, posts, coloured awning, a sign with its name. */
function stallArt(stall: Stall): string {
  return (
    `<rect class="mkPost" x="-118" y="-46" width="10" height="92"/><rect class="mkPost" x="108" y="-46" width="10" height="92"/>` +
    `<rect class="mkCounter" x="-124" y="10" width="248" height="40" rx="6"/>` +
    `<path class="${stall.awning}" d="M-132,-46 L132,-46 L124,-72 L-124,-72 Z"/>` +
    [-110, -66, -22, 22, 66, 110].map((x) => `<circle class="${stall.awning}" cx="${x}" cy="-44" r="11"/>`).join("") +
    `<text class="mkSign" x="0" y="36">${esc(stall.name)}</text>`
  );
}

/**
 * The square: products left, stalls right, a line for every product already brought to its stall.
 * Products carry data-product, stalls data-stall (buttons).
 */
export function buildMarketSvg(
  game: MarketGame,
  matched: Readonly<Record<string, StallId>>,
  selected: string | null,
  texts: { title: string; pick: string; bring: string },
): string {
  const height = Math.max(game.products.length * ROW + 40, STALLS.length * 140 + 20);
  const productY = (i: number): number => 30 + i * ROW + ROW / 2;
  const stallY = (i: number): number => (height / STALLS.length) * (i + 0.5) + 10;
  const stallIndex = (id: StallId): number => STALLS.findIndex((stall) => stall.id === id);

  const lines = game.products
    .map((product, i) => {
      const stall = matched[product.id];
      if (!stall) return "";
      const y1 = productY(i);
      const y2 = stallY(stallIndex(stall)) + 30;
      const x1 = PRODUCT_X + PRODUCT_W;
      const x2 = STALL_X - 10;
      const cls = STALLS[stallIndex(stall)].awning;
      return `<path class="mkLine ${cls}Line" d="M${x1},${y1} C${x1 + 120},${y1} ${x2 - 120},${y2} ${x2},${y2}"/>` +
        `<circle class="mkDot ${cls}" cx="${x1}" cy="${y1}" r="8"/><circle class="mkDot ${cls}" cx="${x2}" cy="${y2}" r="8"/>`;
    })
    .join("");

  const products = game.products
    .map((product, i) => {
      const y = productY(i);
      const done = Boolean(matched[product.id]);
      const cls = `mkProduct${done ? " mkDone" : ""}${selected === product.id ? " mkSelected" : ""}`;
      return `<g class="${cls}" data-product="${product.id}" tabindex="${done ? -1 : 0}" role="button" aria-label="${esc(`${texts.pick} ${product.name}`)}">` +
        `<rect class="mkCard" x="${PRODUCT_X}" y="${y - ROW / 2 + 6}" width="${PRODUCT_W}" height="${ROW - 12}" rx="14"/>` +
        `<text class="mkEmoji" x="${PRODUCT_X + 36}" y="${y}">${product.emoji}</text>` +
        `<text class="mkName" x="${PRODUCT_X + 74}" y="${y}">${esc(product.name)}</text></g>`;
    })
    .join("");

  const stalls = STALLS.map((stall, i) =>
    `<g class="mkStall" data-stall="${stall.id}" tabindex="0" role="button" aria-label="${esc(`${texts.bring} ${stall.name}`)}">` +
    `<rect class="mkStallHit" x="${STALL_X - 20}" y="${stallY(i) - 80}" width="${STALL_W + 40}" height="140" rx="16"/>` +
    `<g transform="translate(${STALL_X + STALL_W / 2},${stallY(i)})">${stallArt(stall)}</g></g>`).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" role="group" aria-label="${esc(texts.title)}">` +
    `<rect class="mkSquare" x="0" y="0" width="${WIDTH}" height="${height}" rx="16"/>` +
    lines + stalls + products + `</svg>`;
}
