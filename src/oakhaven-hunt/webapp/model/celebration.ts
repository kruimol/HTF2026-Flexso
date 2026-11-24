/**
 * The prize of the Oakhaven Hunt: all stamps collected → balloons and a pizza from Tobin, and a
 * voucher with a code to show at Tobin's stall at the fair. Pure functions.
 *
 * @namespace oakhaven.hunt.model
 */

/** A short code that is easy to read out: no 0/O or 1/I. */
export function prizeCode(random: () => number = Math.random): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += letters[Math.floor(random() * letters.length)];
  return `OAK-${code}`;
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A balloon around (0,0) with its string; it floats up (CSS) after `delay` seconds. */
function balloon(x: number, colour: string, delay: number, sway: number): string {
  return `<g transform="translate(${x},0)"><g class="ceBalloon" style="animation-delay:${delay}s;--sway:${sway}px">` +
    `<path class="ceString" d="M0,52 C-8,72 8,92 0,118"/>` +
    `<ellipse class="${colour}" cx="0" cy="0" rx="34" ry="42"/>` +
    `<path class="${colour}" d="M-6,40 L6,40 L0,50 Z"/>` +
    `<ellipse class="ceShine" cx="-12" cy="-16" rx="7" ry="12"/></g></g>`;
}

/** Tobin's pizza around (0,0): crust, sauce, cheese, toppings, slice lines. */
function pizza(): string {
  const pepperoni = [[-40, -30], [30, -44], [48, 18], [-10, 40], [-52, 22], [8, -6]]
    .map(([x, y]) => `<circle class="cePepperoni" cx="${x}" cy="${y}" r="13"/>`).join("");
  const basil = [[-24, -50], [52, -12], [-46, -4], [26, 44]]
    .map(([x, y]) => `<ellipse class="ceBasil" cx="${x}" cy="${y}" rx="8" ry="4" transform="rotate(${x},${x},${y})"/>`).join("");
  const slices = [0, 60, 120].map((a) => `<line class="ceSlice" x1="-86" y1="0" x2="86" y2="0" transform="rotate(${a})"/>`).join("");
  return `<circle class="ceCrust" r="96"/><circle class="ceSauce" r="82"/>` +
    `<path class="ceCheese" d="M-74,-20 C-60,-70 0,-86 40,-70 C80,-54 84,-6 70,34 C54,74 4,86 -34,72 C-74,56 -86,20 -74,-20 Z"/>` +
    pepperoni + basil + slices;
}

/** The party: balloons rising behind Tobin's pizza. */
export function buildCelebrationSvg(title: string): string {
  const balloons = [
    balloon(70, "ceRed", 0, 10), balloon(170, "ceBlue", 0.6, -12), balloon(270, "ceGold", 0.2, 8),
    balloon(530, "ceGreen", 0.9, -10), balloon(630, "ceLilac", 0.3, 12), balloon(730, "ceRed", 1.2, -8),
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 320" role="img" aria-label="${esc(title)}">` +
    `<g transform="translate(0,150)">${balloons}</g>` +
    `<g transform="translate(400,170)"><g class="cePizza">${pizza()}</g></g>` +
    `</svg>`;
}
