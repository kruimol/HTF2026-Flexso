/**
 * 💧 Maren's morning round — which pipe first, then which, and why.
 *
 * Pure logic (no CAP, no database): it takes the pipes, landmarks and sensors as plain rows and
 * returns every pipe in the order Maren should visit it. `water-supply-service.ts` feeds it from
 * the database; the `morningRound()` function of the water service returns its result.
 *
 * Every rule below comes from the chat with Maren Holt (the water keeper). The numbers are hers —
 * change them here and nowhere else.
 */

// ---------------------------------------------------------------------------------------------
// Maren's rules
// ---------------------------------------------------------------------------------------------

/**
 * "Either one is enough." Flow is measured against what that pipe normally carries.
 *  - alarm:   flow below half of normal, or pressure under 25 PSI → "I drop everything"
 *  - warning: flow below 80 % of normal, or pressure under 40 PSI → "I go and look this week"
 */
export const THRESHOLDS = {
  alarm: { flowRatio: 0.5, pressurePsi: 25 },
  warning: { flowRatio: 0.8, pressurePsi: 40 },
} as const;

/**
 * "A missing number, or one older than 15 minutes, means I simply don't know, and I'd rather see
 *  'I don't know' than be falsely reassured. Someone has to go and look, so it comes after the
 *  alarms but before the 'this week' ones." — Maren
 */
export const STALE_AFTER_MINUTES = 15;

/**
 * "After a job I want to note it myself: which pipe, what was wrong, the date and who did it. From
 *  then on that pipe should show as repaired, until new readings say otherwise." — Maren
 * `repaired` = a repair was logged after the pipe's last change in readings.
 */
export type PipeStatus = 'alarm' | 'unknown' | 'warning' | 'repaired' | 'ok';

/** Who sits behind a pipe. Lower rank = Maren goes there first (at the same status). */
export type DependantGroup = 'village' | 'families' | 'bakery' | 'farms' | 'nobody';

interface GroupRule {
  readonly rank: number;
  /** Maren's own reason — shown to her, so she sees why the list is in this order. */
  readonly why: string;
}

/**
 * "Families first, then The Bakery, because that's bread for the whole village. South Meadow
 *  Farms comes last, since the animals can manage half a day on the troughs."
 * "The backup loop always comes last, even when it's in alarm, because nobody depends on it."
 * `village` is our own rule: a main line that feeds several groups downstream outranks each of them.
 */
const GROUP_RULES: Readonly<Record<DependantGroup, GroupRule>> = {
  village: { rank: 0, why: 'Everything downstream depends on it' },
  families: { rank: 1, why: 'Families come first' },
  bakery: { rank: 2, why: 'Bread for the whole village' },
  farms: { rank: 3, why: 'Animals can manage half a day on the troughs' },
  nobody: { rank: 9, why: 'Backup loop: nobody depends on it for their water' },
};

/** Which landmark kinds count as "somebody who depends on this water". */
const GROUP_BY_LANDMARK_KIND: Readonly<Record<string, DependantGroup>> = {
  residential: 'families',
  bakery: 'bakery',
  farm: 'farms',
};

/** Not in the data — Maren told us: "That's about 140 households in North Residential Area." */
const HOUSEHOLDS_BY_LANDMARK: Readonly<Record<string, number>> = {
  'North Residential Area': 140,
};

/**
 * Confirmed by Maren: "SOUTH-BRANCH first. The backup loop always comes last, even when it's in
 * alarm, because nobody depends on it for their water. The farmers do depend on SOUTH-BRANCH, so a
 * 'this week' problem there still beats an alarm on SECONDARY-LOOP."
 * `true` = the backup loop goes after every other problem pipe, whatever its status.
 */
export const BACKUP_LOOP_AFTER_ALL_PROBLEMS = true;

/** A sensor reading more than this share above the pipe's capacity is physically implausible. */
const SENSOR_OVER_CAPACITY_TOLERANCE = 0.05;
/** Sensor and pipe record disagree when they differ by more than this share of nominal flow. */
const SENSOR_DISAGREEMENT_TOLERANCE = 0.1;

// ---------------------------------------------------------------------------------------------
// Input and output shapes
// ---------------------------------------------------------------------------------------------

/** A decimal as the database driver may return it (number or numeric string). */
type DbNumber = number | string | null | undefined;

export interface PipeInput {
  readonly ID?: string;
  readonly pipeID?: string | null;
  readonly location?: string | null;
  readonly startPoint?: string | null;
  readonly endPoint?: string | null;
  readonly pipelineType?: string | null;
  readonly nominalFlowRate?: DbNumber;
  readonly currentFlowRate?: DbNumber;
  readonly currentPressure?: DbNumber;
  readonly lastMaintenance?: string | null;
  readonly mapPath?: string | null;
  /** When the pipe record (its readings) last changed. */
  readonly modifiedAt?: string | null;
}

export interface LandmarkInput {
  readonly name?: string | null;
  readonly kind?: string | null;
  readonly gridCell?: string | null;
  readonly suppliedBy?: string | null;
}

export interface SensorInput {
  readonly sensorID?: string | null;
  readonly pipe_ID?: string | null;
  readonly flowRate?: DbNumber;
  readonly pressure?: DbNumber;
  readonly lastReading?: string | null;
  /** When the sensor's values last changed (the demo feed only touches lastReading). */
  readonly modifiedAt?: string | null;
}

export interface RepairInput {
  readonly pipe_ID?: string | null;
  readonly issue?: string | null;
  readonly repairDate?: string | null;
  readonly repairedBy?: string | null;
}

/** One stop of the round — matches the CDS type `WaterSupplyService.RoundStop`. */
export interface RoundStop {
  rank: number;
  pipe_ID: string | null;
  pipeID: string;
  location: string;
  pipelineType: string;
  status: PipeStatus;
  flowPercentage: number | null;
  nominalFlowRate: number | null;
  currentFlowRate: number | null;
  currentPressure: number | null;
  /** What is wrong, e.g. "Flow 31 % of normal (alarm below 50 %) · Pressure 22 PSI (alarm below 25)". */
  problems: string;
  dependants: DependantGroup;
  /** One line for the phone: who sits without water. */
  headline: string;
  /** Every place downstream that depends on this pipe. */
  servedPlaces: string;
  households: number;
  /** Why this pipe is at this position. */
  orderReason: string;
  /** Something in the data that does not add up — check before trusting the numbers. */
  dataWarning: string;
  daysSinceMaintenance: number | null;
  mapPath: string;
}

/** A landmark for the map: where it is and whether its water supply is at risk. */
export interface MapPlace {
  name: string;
  kind: string;
  gridCell: string;
  /** Worst status of the pipes it depends on ('' for places that don't depend on a pipe). */
  supplyStatus: PipeStatus | '';
  /** Share of normal flow that reaches it: the lowest flow % of every pipe on its way (null = no pipe). */
  supplyPercentage: number | null;
  households: number;
}

export interface MorningRound {
  generatedAt: string;
  alarmCount: number;
  unknownCount: number;
  repairedCount: number;
  warningCount: number;
  okCount: number;
  /** Pipes that need Maren, in visiting order. */
  stops: RoundStop[];
  /** Pipes that are fine — for the evening view. */
  fine: RoundStop[];
  /** Every landmark, for the village map. */
  places: MapPlace[];
}

// ---------------------------------------------------------------------------------------------
// The logic
// ---------------------------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const STATUS_ORDER: Readonly<Record<PipeStatus, number>> = { alarm: 0, unknown: 1, warning: 2, repaired: 3, ok: 4 };

function time(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function day(value: string | null | undefined): string {
  return (value ?? '').slice(0, 10);
}

function toNumber(value: DbNumber): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)} %`;
}

/**
 * Status of one pipe by Maren's thresholds, plus the reasons in plain words.
 * `readingAgeMinutes`: how old the pipe's newest sensor reading is (null = no reading at all).
 */
export function assessPipe(
  pipe: PipeInput,
  readingAgeMinutes: number | null,
): { status: PipeStatus; flowRatio: number | null; problems: string[] } {
  const nominal = toNumber(pipe.nominalFlowRate);
  const flow = toNumber(pipe.currentFlowRate);
  const pressure = toNumber(pipe.currentPressure);
  const flowRatio = nominal !== null && nominal > 0 && flow !== null ? flow / nominal : null;

  // Old or no reading: the numbers can't be trusted either way — "I don't know", go and look.
  if (readingAgeMinutes === null) {
    return { status: 'unknown', flowRatio, problems: ['No sensor reading — I don\'t know, go and look'] };
  }
  if (readingAgeMinutes > STALE_AFTER_MINUTES) {
    const age =
      readingAgeMinutes >= 2 * 24 * 60
        ? `${Math.round(readingAgeMinutes / (24 * 60))} days`
        : readingAgeMinutes >= 120
          ? `${Math.round(readingAgeMinutes / 60)} hours`
          : `${Math.round(readingAgeMinutes)} min`;
    return {
      status: 'unknown',
      flowRatio,
      problems: [`Last reading ${age} ago (older than ${STALE_AFTER_MINUTES} min) — I don't know, go and look`],
    };
  }

  const problems: string[] = [];
  let status: PipeStatus = 'ok';
  const raise = (to: PipeStatus): void => {
    if (STATUS_ORDER[to] < STATUS_ORDER[status]) status = to;
  };

  if (flowRatio !== null) {
    if (flowRatio < THRESHOLDS.alarm.flowRatio) {
      raise('alarm');
      problems.push(`Flow ${percent(flowRatio)} of normal (alarm below ${percent(THRESHOLDS.alarm.flowRatio)})`);
    } else if (flowRatio < THRESHOLDS.warning.flowRatio) {
      raise('warning');
      problems.push(`Flow ${percent(flowRatio)} of normal (check below ${percent(THRESHOLDS.warning.flowRatio)})`);
    }
  }
  if (pressure !== null) {
    if (pressure < THRESHOLDS.alarm.pressurePsi) {
      raise('alarm');
      problems.push(`Pressure ${pressure} PSI (alarm below ${THRESHOLDS.alarm.pressurePsi})`);
    } else if (pressure < THRESHOLDS.warning.pressurePsi) {
      raise('warning');
      problems.push(`Pressure ${pressure} PSI (check below ${THRESHOLDS.warning.pressurePsi})`);
    }
  }
  // A missing number: "I don't know" — unless the number we do have is already an alarm
  // ("either one is enough").
  if (flowRatio === null || pressure === null) {
    raise('unknown');
    problems.push(`No ${flowRatio === null ? 'flow' : 'pressure'} reading — I don't know, go and look`);
  }
  return { status, flowRatio, problems };
}

/**
 * Every landmark that depends on a pipe: the places it supplies directly (`Landmarks.suppliedBy`)
 * plus everything behind it — a pipe feeds every pipe that starts where it ends. Water stops at a
 * secondary (backup) pipe: nobody depends on it, so it passes nothing on.
 */
export function placesDownstream(
  pipe: PipeInput,
  pipes: readonly PipeInput[],
  landmarks: readonly LandmarkInput[],
): LandmarkInput[] {
  const found = new Map<string, LandmarkInput>();
  const visited = new Set<string>();
  const walk = (current: PipeInput): void => {
    const key = current.pipeID ?? '';
    if (visited.has(key) || current.pipelineType === 'secondary') return;
    visited.add(key);
    for (const landmark of landmarks) {
      if (landmark.suppliedBy === current.pipeID && landmark.kind && GROUP_BY_LANDMARK_KIND[landmark.kind]) {
        found.set(landmark.name ?? '', landmark);
      }
    }
    for (const next of pipes) {
      if (next.startPoint && next.startPoint === current.endPoint) walk(next);
    }
  };
  walk(pipe);
  return [...found.values()];
}

function dependantGroupOf(places: readonly LandmarkInput[]): DependantGroup {
  const groups = new Set(places.map((place) => GROUP_BY_LANDMARK_KIND[place.kind ?? ''] ?? 'nobody'));
  if (groups.size === 0) return 'nobody';
  if (groups.size > 1) return 'village';
  return [...groups][0];
}

function bestRankOf(places: readonly LandmarkInput[]): number {
  return Math.min(GROUP_RULES.nobody.rank, ...places.map((p) => GROUP_RULES[GROUP_BY_LANDMARK_KIND[p.kind ?? ''] ?? 'nobody'].rank));
}

function placeLabel(place: LandmarkInput): string {
  const households = HOUSEHOLDS_BY_LANDMARK[place.name ?? ''];
  return households ? `${place.name} (~${households} households)` : place.name ?? '';
}

function headlineFor(group: DependantGroup, places: readonly LandmarkInput[], households: number, status: PipeStatus): string {
  switch (group) {
    case 'village':
      return `Main line — ${places.length} places depend on it`;
    case 'families':
      if (status === 'ok' || status === 'repaired') return households > 0 ? `Feeds ~${households} households` : 'Feeds families';
      if (status === 'unknown') return households > 0 ? `~${households} households — no reliable reading` : 'Families — no reliable reading';
      return households > 0 ? `~${households} households on weak taps` : 'Families on weak taps';
    case 'bakery':
      return 'The Bakery — bread for the whole village';
    case 'farms':
      return 'South Meadow Farms — animals on the troughs';
    default:
      return 'Backup loop — nobody depends on it';
  }
}

/** Sensor vs pipe record: flags readings that cannot be right, so Maren knows what to check. */
function sensorWarning(pipe: PipeInput, sensors: readonly SensorInput[]): string {
  const nominal = toNumber(pipe.nominalFlowRate);
  const flow = toNumber(pipe.currentFlowRate);
  const warnings: string[] = [];
  if (flow !== null && nominal !== null && nominal > 0 && flow > nominal * (1 + SENSOR_OVER_CAPACITY_TOLERANCE)) {
    warnings.push(`The pipe record says ${flow} L/min — more than this pipe can carry (${nominal}). Check before trusting it.`);
  }
  for (const sensor of sensors.filter((s) => s.pipe_ID === pipe.ID)) {
    const sensorFlow = toNumber(sensor.flowRate);
    if (sensorFlow === null || nominal === null || nominal <= 0) continue;
    if (sensorFlow > nominal * (1 + SENSOR_OVER_CAPACITY_TOLERANCE)) {
      warnings.push(`${sensor.sensorID} reads ${sensorFlow} L/min — more than this pipe can carry (${nominal}). Sensor faulty or data tampered?`);
    } else if (flow !== null && Math.abs(sensorFlow - flow) > nominal * SENSOR_DISAGREEMENT_TOLERANCE) {
      warnings.push(`${sensor.sensorID} reads ${sensorFlow} L/min, the pipe record says ${flow}.`);
    }
  }
  return warnings.join(' ');
}

interface Ranked {
  readonly stop: RoundStop;
  readonly tier: number;
  readonly statusOrder: number;
  readonly groupRank: number;
  readonly placeCount: number;
  readonly flowRatio: number;
  readonly pressure: number;
}

/** Plans the round: every pipe, assessed and ranked by Maren's rules. */
export function planMorningRound(
  pipes: readonly PipeInput[],
  landmarks: readonly LandmarkInput[],
  sensors: readonly SensorInput[],
  now: Date = new Date(),
  repairs: readonly RepairInput[] = [],
): MorningRound {
  // Worst status per landmark over every pipe it depends on (directly or upstream).
  const supplyByPlace = new Map<string, PipeStatus>();
  const percentageByPlace = new Map<string, number>();

  const ranked: Ranked[] = pipes.map((pipe) => {
    const readings = sensors
      .filter((sensor) => sensor.pipe_ID === pipe.ID && sensor.lastReading)
      .map((sensor) => Date.parse(sensor.lastReading ?? ''))
      .filter((time) => !Number.isNaN(time));
    const readingAgeMinutes = readings.length > 0 ? (now.getTime() - Math.max(...readings)) / 60_000 : null;
    const assessed = assessPipe(pipe, readingAgeMinutes);
    let { status } = assessed;
    const { flowRatio } = assessed;
    let { problems } = assessed;

    // Logged repairs: the newest one that is not in the future. If it is newer than the last change
    // in the pipe's readings, the pipe shows as repaired until new readings come in.
    const ownRepairs = repairs.filter((repair) => repair.pipe_ID === pipe.ID);
    const futureRepairs = ownRepairs.filter((repair) => time(repair.repairDate) > now.getTime());
    const latestRepair = ownRepairs
      .filter((repair) => time(repair.repairDate) <= now.getTime())
      .sort((a, b) => time(b.repairDate) - time(a.repairDate))[0];
    const lastReadingChange = Math.max(
      time(pipe.modifiedAt),
      ...sensors.filter((sensor) => sensor.pipe_ID === pipe.ID).map((sensor) => time(sensor.modifiedAt)),
    );
    if (latestRepair && time(latestRepair.repairDate) > lastReadingChange) {
      status = 'repaired';
      problems = [
        `Repaired ${day(latestRepair.repairDate)} by ${latestRepair.repairedBy ?? '?'}: ${latestRepair.issue ?? ''} — waiting for new readings`,
      ];
    }
    const places = placesDownstream(pipe, pipes, landmarks);
    for (const place of places) {
      const key = place.name ?? '';
      const current = supplyByPlace.get(key);
      if (current === undefined || STATUS_ORDER[status] < STATUS_ORDER[current]) supplyByPlace.set(key, status);
      if (flowRatio !== null && status !== 'unknown' && status !== 'repaired') {
        const percentage = Math.round(flowRatio * 100);
        percentageByPlace.set(key, Math.min(percentage, percentageByPlace.get(key) ?? percentage));
      }
    }
    const dependants = dependantGroupOf(places);
    const households = places.reduce((sum, place) => sum + (HOUSEHOLDS_BY_LANDMARK[place.name ?? ''] ?? 0), 0);
    const isBackup = dependants === 'nobody';
    const lastMaintenance = pipe.lastMaintenance ? Date.parse(pipe.lastMaintenance) : NaN;
    // tier 0: problems with people behind them · tier 1: the backup loop's problems · tier 2: fine
    const tier = status === 'ok' || status === 'repaired' ? 2 : isBackup && BACKUP_LOOP_AFTER_ALL_PROBLEMS ? 1 : 0;

    const stop: RoundStop = {
      rank: 0,
      pipe_ID: pipe.ID ?? null,
      pipeID: pipe.pipeID ?? '',
      location: pipe.location ?? '',
      pipelineType: pipe.pipelineType ?? '',
      status,
      flowPercentage: flowRatio === null ? null : Math.round(flowRatio * 100),
      nominalFlowRate: toNumber(pipe.nominalFlowRate),
      currentFlowRate: toNumber(pipe.currentFlowRate),
      currentPressure: toNumber(pipe.currentPressure),
      problems: problems.join(' · '),
      dependants,
      headline: headlineFor(dependants, places, households, status),
      servedPlaces: places.map(placeLabel).join(', '),
      households,
      orderReason: '',
      dataWarning: [
        sensorWarning(pipe, sensors),
        ...futureRepairs.map(
          (repair) => `A repair is logged for ${day(repair.repairDate)}, a date in the future — ignored. Tampered record?`,
        ),
      ]
        .filter((warning) => warning)
        .join(' '),
      daysSinceMaintenance: Number.isNaN(lastMaintenance) ? null : Math.floor((now.getTime() - lastMaintenance) / MS_PER_DAY),
      mapPath: pipe.mapPath ?? '',
    };
    return {
      stop,
      tier,
      statusOrder: STATUS_ORDER[status],
      groupRank: bestRankOf(places),
      placeCount: places.length,
      flowRatio: flowRatio ?? 1,
      pressure: toNumber(pipe.currentPressure) ?? Number.POSITIVE_INFINITY,
    };
  });

  // Maren's order: status first ("an alarm always beats a 'this week' problem"), then who sits
  // behind the pipe, then how many places depend on it, then the worst numbers.
  ranked.sort(
    (a, b) =>
      a.tier - b.tier ||
      a.statusOrder - b.statusOrder ||
      a.groupRank - b.groupRank ||
      b.placeCount - a.placeCount ||
      a.flowRatio - b.flowRatio ||
      a.pressure - b.pressure,
  );

  ranked.forEach((entry, index) => {
    const { stop } = entry;
    stop.rank = index + 1;
    const statusText =
      stop.status === 'alarm'
        ? 'Alarm'
        : stop.status === 'unknown'
          ? "I don't know"
          : stop.status === 'warning'
            ? 'Check this week'
            : stop.status === 'repaired'
              ? 'Repaired'
              : 'OK';
    stop.orderReason =
      entry.tier === 1
        ? `${statusText}, but ${GROUP_RULES.nobody.why.toLowerCase()} — always after the other problems`
        : `${statusText} · ${GROUP_RULES[stop.dependants].why}`;
  });

  const stops = ranked.filter((entry) => entry.tier < 2).map((entry) => entry.stop);
  const fine = ranked.filter((entry) => entry.tier === 2).map((entry) => entry.stop);
  return {
    generatedAt: now.toISOString(),
    alarmCount: stops.filter((s) => s.status === 'alarm').length,
    unknownCount: stops.filter((s) => s.status === 'unknown').length,
    warningCount: stops.filter((s) => s.status === 'warning').length,
    okCount: fine.length,
    repairedCount: fine.filter((s) => s.status === 'repaired').length,
    stops,
    fine,
    places: landmarks.map((landmark) => ({
      name: landmark.name ?? '',
      kind: landmark.kind ?? '',
      gridCell: landmark.gridCell ?? '',
      supplyStatus: supplyByPlace.get(landmark.name ?? '') ?? '',
      // "I don't know" anywhere on the way: no percentage either (the droplet shows a question mark).
      // Repaired: the old numbers no longer count until new readings come in — no percentage either.
      supplyPercentage: ['unknown', 'repaired'].includes(supplyByPlace.get(landmark.name ?? '') ?? '')
        ? null
        : percentageByPlace.get(landmark.name ?? '') ?? null,
      households: HOUSEHOLDS_BY_LANDMARK[landmark.name ?? ''] ?? 0,
    })),
  };
}
