/**
 * Count the sheep at South Meadow Farms: one wave of sheep runs across the meadow, then the child
 * picks how many there were. Shep the sheepdog runs along too, and he does not count. Wrong? A new
 * wave, try again. Pure functions: seed in, wave / SVG out.
 *
 * The running is plain CSS animation (no timers in the drawing), so it stays smooth.
 *
 * @namespace oakhaven.hunt.model
 */

export type Runner = "sheep" | "dog";

export interface RunnerInWave {
  readonly kind: Runner;
  /** 0, 1 or 2: the three lanes of the meadow, back to front. */
  readonly lane: number;
  /** Seconds after the start of the wave. */
  readonly delay: number;
  /** Seconds to cross the meadow. */
  readonly duration: number;
  /** A little hop or not. */
  readonly hop: boolean;
}

export interface Wave {
  readonly runners: readonly RunnerInWave[];
  /** The answer: how many sheep (Shep not included). */
  readonly sheep: number;
  /** Seconds until the last runner has left the meadow. */
  readonly length: number;
}

/** One round: how many sheep, how fast (seconds to cross), over how long they arrive, how many dogs. */
const SETTINGS = { min: 5, max: 8, slow: 4.2, fast: 3.2, spread: 5.5, dogs: 1 };

function random(seed: number): () => number {
  // Mix the seed first: small seeds would otherwise give small first numbers.
  let s = (Math.imul(seed >>> 0, 2654435761) ^ 0x9e3779b9) >>> 0 || 1;
  for (let i = 0; i < 4; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
  }
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** A wave. Some sheep come in little groups, so they overlap. */
export function newWave(seed: number): Wave {
  const settings = SETTINGS;
  const rnd = random(seed);
  const between = (a: number, b: number): number => a + rnd() * (b - a);
  const sheep = settings.min + Math.floor(rnd() * (settings.max - settings.min + 1));
  const runners: RunnerInWave[] = [];
  let time = 0.3;
  while (runners.length < sheep) {
    // A group of 1–3 sheep at almost the same moment, in different lanes.
    const group = Math.min(sheep - runners.length, 1 + Math.floor(rnd() * 3));
    const lanes = [0, 1, 2].sort(() => rnd() - 0.5);
    for (let i = 0; i < group; i++) {
      runners.push({
        kind: "sheep",
        lane: lanes[i],
        delay: Math.round((time + between(0, 0.35)) * 100) / 100,
        duration: Math.round(between(settings.fast, settings.slow) * 100) / 100,
        hop: rnd() < 0.5,
      });
    }
    time += settings.spread / Math.max(1, sheep / 1.6) * between(0.6, 1.4);
  }
  for (let i = 0; i < settings.dogs; i++) {
    runners.push({
      kind: "dog",
      lane: Math.floor(rnd() * 3),
      delay: Math.round(between(0.8, time) * 100) / 100,
      duration: Math.round(between(settings.fast * 0.8, settings.fast) * 100) / 100,
      hop: false,
    });
  }
  const length = Math.max(...runners.map((runner) => runner.delay + runner.duration));
  return { runners, sheep, length: Math.round(length * 100) / 100 };
}

/** Five answers around the right one (never below 1), in order. */
export function answerOptions(sheep: number, seed: number): number[] {
  const rnd = random(seed * 31 + 7);
  const lowest = Math.max(1, sheep - Math.floor(rnd() * 5));
  return [0, 1, 2, 3, 4].map((i) => lowest + i);
}

// ------------------------------------------------------------------------------------------------
// Drawing
// ------------------------------------------------------------------------------------------------

const WIDTH = 1000;
const HEIGHT = 360;
const LANE_Y = [140, 210, 285];
const LANE_SCALE = [0.8, 0.9, 1];

/** Wool: a cloud of puffs around the body, drawn twice (a soft outline, then the white wool). */
const WOOL: ReadonlyArray<readonly [number, number, number]> = [
  [-26, -2, 13], [-16, -14, 14], [0, -18, 15], [16, -14, 14], [26, -2, 13],
  [18, 10, 13], [0, 13, 14], [-18, 10, 13], [0, -2, 18],
];

/** A sheep facing right, around (0,0): shadow, legs that walk, woolly body, tail, friendly face. */
function sheepArt(): string {
  const legs =
    `<rect class="scLeg scLegA" x="-22" y="12" width="7" height="24" rx="3.5"/>` +
    `<rect class="scLeg scLegB" x="-10" y="14" width="7" height="22" rx="3.5"/>` +
    `<rect class="scLeg scLegB" x="10" y="14" width="7" height="22" rx="3.5"/>` +
    `<rect class="scLeg scLegA" x="21" y="12" width="7" height="24" rx="3.5"/>`;
  const outline = WOOL.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + 2.5}"/>`).join("");
  const wool = WOOL.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("");
  const curls = [[-14, -6], [4, -10], [-4, 6], [14, 2]]
    .map(([x, y]) => `<path class="scCurl" d="M${x - 4},${y} q4,-5 8,0"/>`).join("");
  const head =
    `<g transform="translate(36,-8)">` +
    `<ellipse class="scEar" cx="-6" cy="-8" rx="8" ry="4" transform="rotate(-30,-6,-8)"/>` +
    `<ellipse class="scHead" cx="4" cy="2" rx="12" ry="11"/>` +
    `<circle class="scTuft" cx="-2" cy="-8" r="5"/><circle class="scTuft" cx="5" cy="-10" r="5"/>` +
    `<ellipse class="scEar" cx="12" cy="-6" rx="7" ry="3.5" transform="rotate(30,12,-6)"/>` +
    `<circle class="scEyeWhite" cx="8" cy="0" r="3.4"/><circle class="scPupil" cx="9" cy="0.5" r="1.8"/><circle class="scGlint" cx="9.6" cy="-0.4" r="0.7"/>` +
    `<ellipse class="scNostril" cx="14" cy="7" rx="1.6" ry="1.1"/></g>`;
  return `<ellipse class="scShadow" cx="0" cy="38" rx="34" ry="6"/>` + legs +
    `<circle class="scTail" cx="-38" cy="-6" r="7"/>` +
    `<g class="scWoolEdge">${outline}</g><g class="scWool">${wool}</g>${curls}` + head;
}

function dogArt(): string {
  return (
    `<ellipse class="scShadow" cx="4" cy="34" rx="38" ry="6"/>` +
    `<g class="scDogLegs"><rect x="-22" y="8" width="7" height="24" rx="3"/><rect x="-8" y="10" width="7" height="22" rx="3"/>` +
    `<rect x="10" y="10" width="7" height="22" rx="3"/><rect x="22" y="8" width="7" height="24" rx="3"/></g>` +
    `<ellipse class="scDog" cx="0" cy="0" rx="34" ry="15"/><ellipse class="scDogWhite" cx="10" cy="6" rx="14" ry="8"/>` +
    `<path class="scDogTail" d="M-32,-4 Q-48,-24 -40,-30"/>` +
    `<ellipse class="scDog" cx="40" cy="-12" rx="14" ry="11"/><path class="scDogEar" d="M34,-22 L30,-6 L40,-14 Z"/>` +
    `<circle class="scEye" cx="46" cy="-14" r="2.2"/><circle class="scNose" cx="54" cy="-10" r="3"/>`
  );
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The meadow with the wave running across it. Each runner starts off-screen left; the CSS animation
 * (scRun) carries it to the right, after its delay. `running` false = the empty meadow.
 */
export function buildMeadowSvg(wave: Wave | null, running: boolean, title: string): string {
  const fence = Array.from({ length: 21 }, (_, i) => `<rect class="scPost" x="${i * 50 - 3}" y="300" width="8" height="46" rx="2"/>`).join("");
  const backdrop =
    `<rect class="scSky" x="0" y="0" width="${WIDTH}" height="${HEIGHT}"/>` +
    `<path class="scHill" d="M0,120 Q200,60 420,105 T1000,95 L1000,${HEIGHT} L0,${HEIGHT} Z"/>` +
    `<rect class="scGrass" x="0" y="150" width="${WIDTH}" height="${HEIGHT - 150}"/>` +
    `<circle class="scSun" cx="880" cy="58" r="34"/>`;
  const foreFence = `${fence}<rect class="scRail" x="0" y="312" width="${WIDTH}" height="8" rx="3"/><rect class="scRail" x="0" y="332" width="${WIDTH}" height="8" rx="3"/>`;
  const runners = !wave || !running
    ? ""
    : [...wave.runners]
      .sort((a, b) => a.lane - b.lane) // back lanes first, front lanes on top
      .map((runner) => {
        const art = runner.kind === "sheep" ? sheepArt() : dogArt();
        const style = `animation-duration:${runner.duration}s;animation-delay:${runner.delay}s`;
        // The lane only shrinks the animal, not the road: every runner crosses the whole meadow
        // (the run is in screen units, outside the scale) and ends well past the right edge.
        return `<g transform="translate(0,${LANE_Y[runner.lane]})">` +
          `<g class="scRunner" style="${style}"><g transform="scale(${LANE_SCALE[runner.lane]})">` +
          `<g class="${runner.hop ? "scHop" : "scTrot"}" style="animation-delay:${runner.delay}s">${art}</g></g></g></g>`;
      })
      .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${esc(title)}">` +
    backdrop + runners + foreFence + `</svg>`;
}
