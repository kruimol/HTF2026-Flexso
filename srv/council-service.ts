/**
 * Handlers of CouncilService (srv/council-service.cds): The Council's Monday.
 *
 * `villageWeek()` gathers the state of the village and hands it to `lib/council-priorities.ts`:
 * - water: Maren's morning round (`WaterSupplyService.morningRound()`): her status per pipe, who
 *   depends on it, her data checks and the pipes she reported broken or repaired;
 * - food: Tobin's forecast (`FoodStockService.weekAhead()`) for the ingredients he follows,
 *   the same thresholds for the rest of the pantry;
 * - trust: Ilse's active marks (a marked sensor counts for its pipe).
 * `decide` locks the plan of the week (money reserved per line) or changes a locked plan, with a reason.
 * Reserved money becomes spent when the work is done (lib/council-budget.ts).
 *
 * `@sap/cds` ships no TypeScript declarations in this project, so it is loaded with `require`
 * and the part of its API this file uses is described in the small interfaces below.
 */
import {
  WEEK_BUDGET,
  buildVillageWeek,
  plainFoodStatus,
  type FoodInput,
  type LandmarkInput,
  type PipeInput,
  type VillageWeek,
  type WaterStatus,
} from './lib/council-priorities';
import { budgetOf, findSpending, planChange, type DecisionLine, type PlanEntry, type WorkDone } from './lib/council-budget';

const WATER_PIPES = 'oakhaven.curse.WaterPipes';
const LANDMARKS = 'oakhaven.curse.Landmarks';
const SENSORS = 'oakhaven.curse.Sensors';
const STOCK_ITEMS = 'oakhaven.curse.StockItems';
const TRUST_MARKS = 'oakhaven.curse.TrustMarks';
const DECISIONS = 'oakhaven.curse.CouncilDecisions';
const WEEKS = 'oakhaven.curse.CouncilWeeks';
const PLAN_LOG = 'oakhaven.curse.CouncilPlanLog';
const REPAIRS = 'oakhaven.curse.Repairs';
const RECEIVALS = 'oakhaven.curse.StockReceivals';

/** One followed ingredient as Tobin's `weekAhead()` returns it (only the fields used here). */
interface ForecastRow {
  itemUUID: string;
  status: string;
  runOutDate: string | null;
  dataSuspect: boolean;
}

interface PipeRow {
  ID: string;
  pipeID: string;
  location: string | null;
  startPoint: string | null;
  endPoint: string | null;
  nominalFlowRate: number | string | null;
  currentFlowRate: number | string | null;
  mapPath: string | null;
}

/** One stop of Maren's morning round (only the fields the council uses). */
interface RoundStopRow {
  pipeID: string;
  rank: number | null;
  status: string | null;
  servedNames: string | null;
  households: number | null;
  dataWarning: string | null;
  reportedBroken: boolean | null;
  problems: string | null;
}

const WATER_STATUSES: readonly WaterStatus[] = ['alarm', 'unknown', 'warning', 'repaired', 'ok'];

/** Maren's fields of one pipe; a pipe missing from her round counts as "I don't know". */
function marenOn(stop: RoundStopRow | undefined): Pick<
  PipeInput,
  'status' | 'roundRank' | 'servedNames' | 'households' | 'dataWarning' | 'reportedBroken' | 'note'
> {
  const status = WATER_STATUSES.find((candidate) => candidate === stop?.status) ?? 'unknown';
  return {
    status,
    roundRank: stop?.rank ?? 99,
    servedNames: stop?.servedNames ?? '',
    households: stop?.households ?? 0,
    dataWarning: stop?.dataWarning ?? '',
    reportedBroken: stop?.reportedBroken ?? false,
    note: stop?.problems ?? '',
  };
}

interface LandmarkRow {
  ID: string;
  name: string;
  kind: string | null;
  gridCell: string | null;
  suppliedBy: string | null;
}

interface ItemRow {
  ID: string;
  itemID: string;
  name: string | null;
  unit: string | null;
  icon: string | null;
  currentQuantity: number | string | null;
  minStockLevel: number | string | null;
  consumptionRate: number | string | null;
}

interface MarkRow {
  entityName: string | null;
  recordID: string;
  reason: string | null;
}

interface SensorRow {
  ID: string;
  pipe_ID: string;
}

interface DecideData {
  weekStart?: string;
  entries?: Array<{ problemKey?: string; kind?: string; title?: string; cost?: number }>;
  reason?: string;
}

interface DecisionRow {
  ID: string;
  weekStart: string | null;
  problemKey: string | null;
  kind: string | null;
  title: string | null;
  cost: number | string | null;
  status: string | null;
  createdAt: string | null;
}

interface WeekRow {
  weekStart?: string;
  lockedAt?: string | null;
  seenKeys?: string | null;
}

/** The slice of a CAP request this file uses. */
interface CdsRequest<T> {
  readonly data: T;
  error(code: number, message: string, target?: string): void;
}

/** The slice of a CAP service this file uses. */
interface CdsService {
  init(): Promise<void>;
  on(event: string, handler: (req: CdsRequest<never>) => unknown): void;
}

/** The slice of the `cds` facade this file uses. */
interface CdsApi {
  readonly ApplicationService: new (...args: readonly never[]) => CdsService;
  readonly connect: { to(service: string): Promise<{ send(event: string, data?: object): Promise<unknown> }> };
  readonly ql: {
    readonly SELECT: {
      from(entity: string): {
        columns(...columns: readonly string[]): {
          where(predicate: Readonly<Record<string, unknown>>): PromiseLike<unknown[]>;
        } & PromiseLike<unknown[]>;
      };
    };
    readonly INSERT: { into(entity: string): { entries(rows: readonly object[]): PromiseLike<unknown> } };
    readonly UPDATE: (entity: string) => { set(values: object): { where(predicate: Readonly<Record<string, unknown>>): PromiseLike<unknown> } };
  };
  log(module: string): { info(...args: readonly unknown[]): void };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require('@sap/cds') as CdsApi;
const { SELECT, INSERT, UPDATE } = cds.ql;
const log = cds.log('council');

const num = (value: number | string | null | undefined): number => Number(value ?? 0);

/** The pantry: Tobin's forecast where he follows an item, the same thresholds for the rest. */
async function loadFood(today: Date): Promise<FoodInput[]> {
  const food = await cds.connect.to('FoodStockService');
  const forecast = ((await food.send('weekAhead')) ?? []) as ForecastRow[];
  const byUUID = new Map(forecast.map((row) => [row.itemUUID, row]));

  const items = (await SELECT.from(STOCK_ITEMS).columns(
    'ID', 'itemID', 'name', 'unit', 'icon', 'currentQuantity', 'minStockLevel', 'consumptionRate',
  )) as ItemRow[];
  return items.map((item) => {
    const followed = byUUID.get(item.ID);
    const currentQuantity = num(item.currentQuantity);
    const minStockLevel = num(item.minStockLevel);
    const plain = plainFoodStatus({ currentQuantity, minStockLevel, consumptionRate: num(item.consumptionRate) }, today);
    return {
      itemUUID: item.ID,
      itemID: item.itemID,
      name: item.name ?? item.itemID,
      unit: item.unit ?? '',
      icon: item.icon ?? '',
      currentQuantity,
      minStockLevel,
      status: followed ? (followed.status as FoodInput['status']) : plain.status,
      runOutDate: followed ? followed.runOutDate : plain.runOutDate,
      followedByTobin: followed !== undefined,
      dataSuspect: followed ? followed.dataSuspect : currentQuantity < 0,
    };
  });
}

/** Ilse's active marks by record ID; a marked sensor casts doubt on its pipe. */
async function loadTrust(): Promise<Map<string, string>> {
  const marks = (await SELECT.from(TRUST_MARKS).columns('entityName', 'recordID', 'reason').where({ active: true })) as MarkRow[];
  const trust = new Map<string, string>();
  const sensorMarks = marks.filter((mark) => mark.entityName === 'Sensors');
  for (const mark of marks) trust.set(mark.recordID, mark.reason ?? '');
  if (sensorMarks.length > 0) {
    const sensors = (await SELECT.from(SENSORS)
      .columns('ID', 'pipe_ID')
      .where({ ID: { in: sensorMarks.map((mark) => mark.recordID) } })) as SensorRow[];
    for (const sensor of sensors) trust.set(sensor.pipe_ID, trust.get(sensor.ID) ?? '');
  }
  return trust;
}

/** Everything the council sees, without the plan: the village and its ranked problems. */
async function loadVillageWeek(today: Date): Promise<VillageWeek> {
  const pipes = (await SELECT.from(WATER_PIPES).columns(
    'ID', 'pipeID', 'location', 'startPoint', 'endPoint', 'nominalFlowRate', 'currentFlowRate', 'mapPath',
  )) as PipeRow[];
  // Maren's judgement of every pipe: her morning round (thresholds, old readings, repairs, reports).
  const water = await cds.connect.to('WaterSupplyService');
  const round = (await water.send('morningRound')) as { stops?: RoundStopRow[]; fine?: RoundStopRow[] } | null;
  const rounds = new Map([...(round?.stops ?? []), ...(round?.fine ?? [])].map((stop) => [stop.pipeID, stop]));
  const landmarks = (await SELECT.from(LANDMARKS).columns('ID', 'name', 'kind', 'gridCell', 'suppliedBy')) as LandmarkRow[];

  return buildVillageWeek(
    pipes.map(
      (pipe): PipeInput => ({
        ID: pipe.ID,
        pipeID: pipe.pipeID,
        location: pipe.location ?? pipe.pipeID,
        startPoint: pipe.startPoint ?? '',
        endPoint: pipe.endPoint ?? '',
        nominalFlowRate: num(pipe.nominalFlowRate),
        currentFlowRate: num(pipe.currentFlowRate),
        mapPath: pipe.mapPath ?? '',
        ...marenOn(rounds.get(pipe.pipeID)),
      }),
    ),
    landmarks.map(
      (landmark): LandmarkInput => ({
        ID: landmark.ID,
        name: landmark.name,
        kind: landmark.kind ?? '',
        gridCell: landmark.gridCell ?? '',
        suppliedBy: landmark.suppliedBy,
      }),
    ),
    await loadFood(today),
    await loadTrust(),
    today,
  );
}

async function loadLines(where: Readonly<Record<string, unknown>>): Promise<DecisionLine[]> {
  const rows = (await SELECT.from(DECISIONS)
    .columns('ID', 'weekStart', 'problemKey', 'kind', 'title', 'cost', 'status', 'createdAt')
    .where(where)) as DecisionRow[];
  return rows.map((row) => ({
    ID: row.ID,
    weekStart: row.weekStart ?? '',
    problemKey: row.problemKey ?? '',
    kind: row.kind ?? '',
    title: row.title ?? '',
    cost: num(row.cost),
    status: row.status === 'spent' || row.status === 'released' ? row.status : 'reserved',
    createdAt: row.createdAt ?? '',
  }));
}

/**
 * Reserved money becomes spent as soon as the work is done: Maren logged the repair of the pipe, or
 * Tobin received a delivery of the item, after the council decided. Written down once, for good.
 */
async function bookSpending(): Promise<void> {
  const reserved = await loadLines({ status: 'reserved' });
  if (reserved.length === 0) return;

  const [pipes, items, repairs, receivals] = await Promise.all([
    SELECT.from(WATER_PIPES).columns('ID', 'pipeID') as PromiseLike<Array<{ ID: string; pipeID: string }>>,
    SELECT.from(STOCK_ITEMS).columns('ID', 'itemID') as PromiseLike<Array<{ ID: string; itemID: string }>>,
    SELECT.from(REPAIRS).columns('pipe_ID', 'repairedBy', 'createdAt') as PromiseLike<
      Array<{ pipe_ID: string; repairedBy: string | null; createdAt: string | null }>
    >,
    SELECT.from(RECEIVALS).columns('item_ID', 'supplier', 'createdAt') as PromiseLike<
      Array<{ item_ID: string; supplier: string | null; createdAt: string | null }>
    >,
  ]);
  const pipeID = new Map(pipes.map((pipe) => [pipe.ID, pipe.pipeID]));
  const itemID = new Map(items.map((item) => [item.ID, item.itemID]));
  const work: WorkDone[] = [
    ...repairs.map((repair) => ({ problemKey: `water:${pipeID.get(repair.pipe_ID) ?? ''}`, at: repair.createdAt ?? '', by: repair.repairedBy ?? '' })),
    ...receivals.map((receival) => ({ problemKey: `food:${itemID.get(receival.item_ID) ?? ''}`, at: receival.createdAt ?? '', by: receival.supplier ?? '' })),
  ];

  for (const spending of findSpending(reserved, work)) {
    const line = reserved.find((candidate) => candidate.ID === spending.ID);
    await UPDATE(DECISIONS).set({ status: 'spent', spentAt: spending.spentAt, spentBy: spending.spentBy }).where({ ID: spending.ID });
    await INSERT.into(PLAN_LOG).entries([
      {
        weekStart: line?.weekStart ?? '',
        at: spending.spentAt,
        action: 'spent',
        summary: `${line?.cost ?? 0} kronen uitgegeven: ${line?.title ?? ''} (${spending.spentBy || '?'})`,
        reason: '',
      },
    ]);
    log.info(`council money spent: ${line?.problemKey} by ${spending.spentBy}`);
  }
}

export default class CouncilService extends cds.ApplicationService {
  override async init(): Promise<void> {
    this.on('villageWeek', async () => {
      const today = new Date();
      await bookSpending();
      const week = await loadVillageWeek(today);
      const lines = await loadLines({ weekStart: week.weekStart });
      const [locked] = (await SELECT.from(WEEKS).columns('lockedAt', 'seenKeys').where({ weekStart: week.weekStart })) as WeekRow[];
      if (!locked) {
        // Not locked yet: the proposal of the priorities (most urgent first, up to the budget).
        return { ...week, locked: false, lockedAt: null, budgetSpent: 0, budgetReserved: week.budgetPlanned, budgetFree: week.budgetLeft };
      }

      // Locked: the plan is what the council decided; problems that came up later are "new since Monday".
      const seen = new Set((locked.seenKeys ?? '').split(',').filter((key) => key));
      const byKey = new Map(lines.filter((line) => line.status !== 'released').map((line) => [line.problemKey, line]));
      const budget = budgetOf(lines, WEEK_BUDGET);
      return {
        ...week,
        problems: week.problems.map((problem) => ({
          ...problem,
          planned: byKey.has(problem.problemKey),
          planStatus: byKey.get(problem.problemKey)?.status ?? (seen.has(problem.problemKey) ? '' : 'new'),
        })),
        budgetPlanned: budget.spent + budget.reserved,
        budgetLeft: budget.free,
        locked: true,
        lockedAt: locked.lockedAt,
        budgetSpent: budget.spent,
        budgetReserved: budget.reserved,
        budgetFree: budget.free,
      };
    });

    this.on('decide', async (req) => {
      const { weekStart, entries, reason } = req.data as DecideData;
      if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return req.error(400, 'Geef de maandag van de week op.', 'weekStart');
      const wanted: PlanEntry[] = (entries ?? [])
        .filter((entry) => entry.problemKey)
        .map((entry) => ({ problemKey: entry.problemKey ?? '', kind: entry.kind ?? '', title: entry.title ?? '', cost: entry.cost ?? 0 }));
      const now = new Date().toISOString();
      const [locked] = (await SELECT.from(WEEKS).columns('weekStart').where({ weekStart })) as WeekRow[];

      if (!locked) {
        // Monday evening: the council locks its plan. All money in it is reserved from now on.
        const total = wanted.reduce((sum, entry) => sum + entry.cost, 0);
        if (total > WEEK_BUDGET) return req.error(400, `Het plan kost ${total} kronen; er is maar ${WEEK_BUDGET} per week.`, 'entries');
        const week = await loadVillageWeek(new Date());
        await INSERT.into(WEEKS).entries([{ weekStart, lockedAt: now, seenKeys: week.problems.map((problem) => problem.problemKey).join(',') }]);
        if (wanted.length > 0) {
          await INSERT.into(DECISIONS).entries(wanted.map((entry) => ({ weekStart, ...entry, note: '', status: 'reserved' })));
        }
        await INSERT.into(PLAN_LOG).entries([
          { weekStart, at: now, action: 'locked', summary: `Plan vastgelegd: ${wanted.length} regels, ${total} kronen gereserveerd.`, reason: '' },
        ]);
        log.info(`council plan for ${weekStart} locked: ${wanted.length} line(s), ${total} crowns`);
        return true;
      }

      // Locked week: a change needs a reason, and spent money cannot come back.
      if (!reason?.trim()) return req.error(400, 'Het plan is vastgelegd: geef een reden voor de wijziging.', 'reason');
      const lines = await loadLines({ weekStart });
      const change = planChange(lines, wanted);
      if (change.spentMissing.length > 0) {
        return req.error(400, `Al uitgegeven, kan niet meer uit het plan: ${change.spentMissing.map((line) => line.title).join(', ')}.`, 'entries');
      }
      const after = budgetOf(lines, WEEK_BUDGET);
      const released = change.release.reduce((sum, line) => sum + line.cost, 0);
      const added = change.add.reduce((sum, entry) => sum + entry.cost, 0);
      const free = after.free + released - added;
      if (free < 0) return req.error(400, `Daarvoor is ${-free} kronen te weinig vrij.`, 'entries');
      if (change.release.length === 0 && change.add.length === 0) return true;

      if (change.release.length > 0) {
        await UPDATE(DECISIONS).set({ status: 'released', note: reason.trim() }).where({ ID: { in: change.release.map((line) => line.ID) } });
      }
      if (change.add.length > 0) {
        await INSERT.into(DECISIONS).entries(change.add.map((entry) => ({ weekStart, ...entry, note: reason.trim(), status: 'reserved' })));
      }
      const parts = [
        ...change.add.map((entry) => `erbij: ${entry.title} (${entry.cost})`),
        ...change.release.map((line) => `vrijgegeven: ${line.title} (${line.cost})`),
      ];
      await INSERT.into(PLAN_LOG).entries([{ weekStart, at: now, action: 'changed', summary: `Plan gewijzigd: ${parts.join('; ')}.`, reason: reason.trim() }]);
      log.info(`council plan for ${weekStart} changed: ${parts.join('; ')}`);
      return true;
    });

    return super.init();
  }
}
