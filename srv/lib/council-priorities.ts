/**
 * Priority logic of The Council's Monday: pure functions, no database, no CAP.
 *
 * Turns the state of the village into
 * - one status per part of the village ("in orde" or not), and
 * - one ranked list of problems, each with the action the council can pay for and its cost,
 * and spends the weekly budget on that list, most urgent first.
 *
 * The council does not judge the water or the food itself — Rowan: "Maren knows best for the water
 * and Tobin for the food". Each pipe arrives with Maren's status (her morning round: thresholds,
 * old readings, repairs, pipes she reported broken) and each pantry item with Tobin's status.
 *
 * Rowan's rule for what comes first: a part of the village without water, or someone going hungry
 * this week. The tiers below follow that rule; everything else comes after.
 */

export type AreaStatus = 'ok' | 'repaired' | 'warning' | 'trouble' | 'unknown';
export type ProblemKind = 'water' | 'food';
/** Maren's status of a pipe (srv/lib/water-priority.ts). */
export type WaterStatus = 'alarm' | 'unknown' | 'warning' | 'repaired' | 'ok';
/** Why the council should not simply pay: who or what casts doubt on the numbers. */
export type DoubtKind = '' | 'ilse' | 'data' | 'waterData' | 'noReading';

/** Weekly budget of the council, in crowns (Rowan). */
export const WEEK_BUDGET = 500;
/** A pipe repair costs about this much (Rowan). */
export const PIPE_REPAIR_COST = 120;
/** An emergency food delivery costs this much EXTRA; the food itself comes out of the pantry money (Rowan). */
export const EMERGENCY_DELIVERY_COST = 80;

/** Days the council looks ahead: one meeting to the next. */
export const WEEK_DAYS = 7;

/** Parts of the village nobody lives or works in: not shown as a part of the village. */
const SKIPPED_KINDS = new Set(['forest']);
/** Where the water comes from: it has no supplying pipe by definition. */
const SOURCE_KINDS = new Set(['spring']);
/** Tobin's followed ingredients are what the bakery needs to bake. */
const BAKERY_KIND = 'bakery';

/** One pipe with Maren's judgement of it (one stop of her morning round). */
export interface PipeInput {
  ID: string;
  pipeID: string;
  location: string;
  startPoint: string;
  endPoint: string;
  nominalFlowRate: number;
  currentFlowRate: number;
  mapPath: string;
  status: WaterStatus;
  roundRank: number; // Maren's visiting order: her priority (families, bakery, farms …)
  servedNames: string; // places that depend on it (", "-separated), by Maren's downstream walk
  households: number;
  dataWarning: string; // Maren's check: sensor and pipe record do not add up, tampered repair …
  reportedBroken: boolean; // Maren saw it broken herself
  note: string; // Maren's own line: what is wrong, or the repair she logged
}

export interface LandmarkInput {
  ID: string;
  name: string;
  kind: string;
  gridCell: string;
  suppliedBy: string | null;
}

/** One pantry item, with the status Tobin's forecast gave it (or the simple check for items he does not follow). */
export interface FoodInput {
  itemUUID: string;
  itemID: string;
  name: string;
  unit: string;
  icon: string;
  currentQuantity: number;
  minStockLevel: number;
  status: 'green' | 'orange' | 'red';
  runOutDate: string | null; // first day it is not enough, null = not this week
  followedByTobin: boolean;
  dataSuspect: boolean; // impossible value in the records (e.g. negative stock)
}

/** Ilse's active trust marks, by record ID (pipes, sensors mapped to their pipe, stock items). */
export type TrustMarks = ReadonlyMap<string, string>;

export interface Area {
  areaKey: string;
  name: string;
  kind: string;
  gridCell: string;
  status: AreaStatus;
  pipeID: string; // the pipe that brings the water in, '' = none in the register
  weakestPipeID: string; // worst pipe on the way from the spring, '' = all fine
  currentFlow: number; // of the weakest pipe (or the supplying pipe when all is fine)
  nominalFlow: number;
  flowPercent: number;
  households: number;
  waterNote: string; // Maren's line for the weakest pipe when it is reported broken or repaired
  foodIssues: number; // bakery: Tobin's ingredients that are not green
  foodIssueNames: string;
}

export interface Problem {
  problemKey: string; // water:<pipeID> | food:<itemID>
  kind: ProblemKind;
  tier: number; // 1 no water, 2 hunger this week, 3 water warning, 4 pantry warning, 5 no part of the village depends on it
  status: 'warning' | 'trouble' | 'unknown';
  refID: string; // pipeID or itemID
  name: string; // pipe location or item name
  icon: string;
  // water
  currentFlow: number;
  nominalFlow: number;
  flowPercent: number;
  affectedAreas: string; // ", "-separated names
  affectedCount: number;
  households: number;
  roundRank: number; // Maren's order; 0 for food
  reportedBroken: boolean;
  note: string; // Maren's line (reported broken: what she saw)
  // food
  currentQuantity: number;
  minStockLevel: number;
  unit: string;
  runOutDate: string | null;
  daysLeft: number; // -1 = not within the week
  // money and trust
  cost: number;
  untrusted: boolean;
  doubtKind: DoubtKind;
  trustReason: string; // Ilse's reason, or Maren's data warning
  planned: boolean; // fits in the budget, in priority order
}

export interface PipeLine {
  pipeID: string;
  status: AreaStatus;
  mapPath: string;
}

export interface VillageWeek {
  weekStart: string;
  budgetTotal: number;
  budgetPlanned: number;
  budgetLeft: number;
  areas: Area[];
  problems: Problem[];
  pipes: PipeLine[];
}

const STATUS_RANK: Readonly<Record<AreaStatus, number>> = { trouble: 0, warning: 1, unknown: 2, repaired: 3, ok: 4 };

/** Maren's word for a pipe → the council's word for the part of the village behind it. */
const AREA_STATUS: Readonly<Record<WaterStatus, AreaStatus>> = {
  alarm: 'trouble',
  warning: 'warning',
  unknown: 'unknown',
  repaired: 'repaired',
  ok: 'ok',
};

function ratioOf(pipe: PipeInput): number {
  return pipe.nominalFlowRate > 0 ? pipe.currentFlowRate / pipe.nominalFlowRate : 1;
}

export function pipeStatus(pipe: PipeInput): AreaStatus {
  return AREA_STATUS[pipe.status] ?? 'unknown';
}

const percent = (ratio: number): number => Math.round(ratio * 100);

/** `YYYY-MM-DD` of a date in local time. */
function toDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Monday of the week `today` is in: the council meets on Mondays. */
export function weekStartOf(today: Date): string {
  const offset = (today.getDay() + 6) % 7; // Monday = 0
  return toDateString(new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset));
}

function daysUntil(date: string | null, today: Date): number {
  if (!date) return -1;
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(year, month - 1, day);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

/**
 * The simple pantry check for an item Tobin does not follow, with the same thresholds as his
 * forecast: under half the minimum is red, under the minimum orange. Runs out = stock / use per day.
 */
export function plainFoodStatus(
  item: { currentQuantity: number; minStockLevel: number; consumptionRate: number },
  today: Date,
): { status: FoodInput['status']; runOutDate: string | null } {
  const stock = Math.max(item.currentQuantity, 0);
  let status: FoodInput['status'] = 'green';
  if (item.currentQuantity < item.minStockLevel / 2) status = 'red';
  else if (item.currentQuantity < item.minStockLevel) status = 'orange';
  let runOutDate: string | null = null;
  if (item.consumptionRate > 0) {
    const days = Math.floor(stock / item.consumptionRate);
    if (days < WEEK_DAYS) {
      runOutDate = toDateString(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days));
    }
  }
  return { status, runOutDate };
}

/**
 * The pipes the water flows through from the spring to `landmark`, last pipe first.
 * The walk stops at the spring: a loop that flows back into it does not feed the village.
 */
function supplyChain(landmark: LandmarkInput, pipes: readonly PipeInput[], sources: ReadonlySet<string>): PipeInput[] {
  if (SOURCE_KINDS.has(landmark.kind)) return [];
  const chain: PipeInput[] = [];
  let pipe =
    pipes.find((candidate) => candidate.pipeID === landmark.suppliedBy) ??
    pipes.find((candidate) => candidate.endPoint === landmark.name);
  const seen = new Set<string>();
  while (pipe && !seen.has(pipe.pipeID)) {
    seen.add(pipe.pipeID);
    chain.push(pipe);
    const start = pipe.startPoint;
    pipe = sources.has(start) ? undefined : pipes.find((candidate) => candidate.endPoint === start);
  }
  return chain;
}

/** Worst first: Maren's status, then the lowest flow. */
function worstPipe(chain: readonly PipeInput[]): PipeInput | undefined {
  return [...chain].sort(
    (a, b) => STATUS_RANK[pipeStatus(a)] - STATUS_RANK[pipeStatus(b)] || ratioOf(a) - ratioOf(b),
  )[0];
}

/** Everything the council sees on Monday. */
export function buildVillageWeek(
  pipes: readonly PipeInput[],
  landmarks: readonly LandmarkInput[],
  food: readonly FoodInput[],
  trust: TrustMarks,
  today: Date,
): VillageWeek {
  // --- Parts of the village ---------------------------------------------------------------------
  const areas: Area[] = [];
  const sources = new Set(landmarks.filter((landmark) => SOURCE_KINDS.has(landmark.kind)).map((landmark) => landmark.name));
  const bakeryIssues = food.filter((item) => item.followedByTobin && item.status !== 'green');
  for (const landmark of landmarks) {
    if (SKIPPED_KINDS.has(landmark.kind)) continue;
    const chain = supplyChain(landmark, pipes, sources);
    const weakest = worstPipe(chain);
    let status: AreaStatus = SOURCE_KINDS.has(landmark.kind) ? 'ok' : weakest ? pipeStatus(weakest) : 'unknown';
    const isBakery = landmark.kind === BAKERY_KIND;
    if (isBakery && bakeryIssues.length > 0) {
      const foodStatus: AreaStatus = bakeryIssues.some((item) => item.status === 'red') ? 'trouble' : 'warning';
      if (STATUS_RANK[foodStatus] < STATUS_RANK[status]) status = foodStatus;
    }
    const notFine = weakest && pipeStatus(weakest) !== 'ok' ? weakest : undefined;
    const shown = notFine ?? chain[0];
    areas.push({
      areaKey: landmark.ID,
      name: landmark.name,
      kind: landmark.kind,
      gridCell: landmark.gridCell,
      status,
      pipeID: chain[0]?.pipeID ?? '',
      weakestPipeID: notFine?.pipeID ?? '',
      currentFlow: shown?.currentFlowRate ?? 0,
      nominalFlow: shown?.nominalFlowRate ?? 0,
      flowPercent: shown ? percent(ratioOf(shown)) : 0,
      households: pipes.find((pipe) => pipe.pipeID === landmark.suppliedBy)?.households ?? 0,
      waterNote: notFine && (notFine.reportedBroken || notFine.status === 'repaired') ? notFine.note : '',
      foodIssues: isBakery ? bakeryIssues.length : 0,
      foodIssueNames: isBakery ? bakeryIssues.map((item) => item.name).join(', ') : '',
    });
  }
  areas.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name));

  // --- Problems ---------------------------------------------------------------------------------
  const problems: Problem[] = [];
  for (const pipe of pipes) {
    if (pipe.status === 'ok' || pipe.status === 'repaired') continue;
    const affected = pipe.servedNames ? pipe.servedNames.split(', ').filter((name) => name) : [];
    // Doubt, strongest first: Ilse marked it · Maren has no reading · Maren's data check fails.
    // A pipe Maren saw broken herself is not in doubt, whatever the data says.
    const ilse = trust.get(pipe.ID);
    let doubtKind: DoubtKind = '';
    let trustReason = '';
    if (ilse !== undefined) [doubtKind, trustReason] = ['ilse', ilse];
    else if (pipe.status === 'unknown') [doubtKind, trustReason] = ['noReading', pipe.note];
    else if (pipe.dataWarning && !pipe.reportedBroken) [doubtKind, trustReason] = ['waterData', pipe.dataWarning];
    problems.push({
      ...emptyProblem(),
      problemKey: `water:${pipe.pipeID}`,
      kind: 'water',
      tier: affected.length === 0 ? 5 : pipe.status === 'alarm' ? 1 : 3,
      status: pipe.status === 'alarm' ? 'trouble' : pipe.status === 'unknown' ? 'unknown' : 'warning',
      refID: pipe.pipeID,
      name: pipe.location,
      icon: 'sap-icon://ti/droplet-off',
      currentFlow: pipe.currentFlowRate,
      nominalFlow: pipe.nominalFlowRate,
      flowPercent: percent(ratioOf(pipe)),
      affectedAreas: affected.join(', '),
      affectedCount: affected.length,
      households: pipe.households,
      roundRank: pipe.roundRank,
      reportedBroken: pipe.reportedBroken,
      note: pipe.reportedBroken ? pipe.note : '',
      // "I don't know": Maren goes and looks first — that costs nothing yet.
      cost: pipe.status === 'unknown' ? 0 : PIPE_REPAIR_COST,
      untrusted: doubtKind !== '',
      doubtKind,
      trustReason,
    });
  }
  for (const item of food) {
    if (item.status === 'green') continue;
    const daysLeft = daysUntil(item.runOutDate, today);
    const ilse = trust.get(item.itemUUID);
    const doubtKind: DoubtKind = ilse !== undefined ? 'ilse' : item.dataSuspect ? 'data' : '';
    problems.push({
      ...emptyProblem(),
      problemKey: `food:${item.itemID}`,
      kind: 'food',
      tier: item.status === 'red' && item.runOutDate !== null ? 2 : 4,
      status: item.status === 'red' ? 'trouble' : 'warning',
      refID: item.itemID,
      name: item.name,
      icon: item.icon || 'sap-icon://ti/basket',
      currentQuantity: item.currentQuantity,
      minStockLevel: item.minStockLevel,
      unit: item.unit,
      runOutDate: item.runOutDate,
      daysLeft,
      cost: EMERGENCY_DELIVERY_COST,
      untrusted: doubtKind !== '',
      doubtKind,
      trustReason: ilse ?? '',
    });
  }
  problems.sort(compareProblems);

  // --- Budget: most urgent first; a problem with doubt on its numbers is checked first, not paid ---
  let left = WEEK_BUDGET;
  for (const problem of problems) {
    if (!problem.untrusted && problem.cost <= left) {
      problem.planned = true;
      left -= problem.cost;
    }
  }

  return {
    weekStart: weekStartOf(today),
    budgetTotal: WEEK_BUDGET,
    budgetPlanned: WEEK_BUDGET - left,
    budgetLeft: left,
    areas,
    problems,
    pipes: pipes.map((pipe) => ({ pipeID: pipe.pipeID, status: pipeStatus(pipe), mapPath: pipe.mapPath })),
  };
}

/** Tier first; within a tier: Maren's order for water, the earliest run-out for food. */
function compareProblems(a: Problem, b: Problem): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.kind === 'water' && b.kind === 'water') return a.roundRank - b.roundRank;
  const daysA = a.daysLeft < 0 ? Number.MAX_SAFE_INTEGER : a.daysLeft;
  const daysB = b.daysLeft < 0 ? Number.MAX_SAFE_INTEGER : b.daysLeft;
  return daysA - daysB || a.name.localeCompare(b.name);
}

function emptyProblem(): Problem {
  return {
    problemKey: '',
    kind: 'water',
    tier: 4,
    status: 'warning',
    refID: '',
    name: '',
    icon: '',
    currentFlow: 0,
    nominalFlow: 0,
    flowPercent: 0,
    affectedAreas: '',
    affectedCount: 0,
    households: 0,
    roundRank: 0,
    reportedBroken: false,
    note: '',
    currentQuantity: 0,
    minStockLevel: 0,
    unit: '',
    runOutDate: null,
    daysLeft: -1,
    cost: 0,
    untrusted: false,
    doubtKind: '',
    trustReason: '',
    planned: false,
  };
}
