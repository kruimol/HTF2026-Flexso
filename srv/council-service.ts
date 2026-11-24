/**
 * Handlers of CouncilService (srv/council-service.cds): The Council's Monday.
 *
 * `villageWeek()` gathers the state of the village and hands it to `lib/council-priorities.ts`:
 * - water: the pipes and which part of the village each one feeds (Landmarks.suppliedBy);
 * - food: Tobin's forecast (`FoodStockService.weekAhead()`) for the ingredients he follows,
 *   the same thresholds for the rest of the pantry;
 * - trust: Ilse's active marks (a marked sensor counts for its pipe).
 * `decide` stores the plan the council agrees on.
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
} from './lib/council-priorities';

const WATER_PIPES = 'oakhaven.curse.WaterPipes';
const LANDMARKS = 'oakhaven.curse.Landmarks';
const SENSORS = 'oakhaven.curse.Sensors';
const STOCK_ITEMS = 'oakhaven.curse.StockItems';
const TRUST_MARKS = 'oakhaven.curse.TrustMarks';
const DECISIONS = 'oakhaven.curse.CouncilDecisions';

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
  note?: string;
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
    readonly DELETE: { from(entity: string): { where(predicate: Readonly<Record<string, unknown>>): PromiseLike<unknown> } };
  };
  log(module: string): { info(...args: readonly unknown[]): void };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require('@sap/cds') as CdsApi;
const { SELECT, INSERT, DELETE } = cds.ql;
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

export default class CouncilService extends cds.ApplicationService {
  override async init(): Promise<void> {
    this.on('villageWeek', async () => {
      const today = new Date();
      const pipes = (await SELECT.from(WATER_PIPES).columns(
        'ID', 'pipeID', 'location', 'startPoint', 'endPoint', 'nominalFlowRate', 'currentFlowRate', 'mapPath',
      )) as PipeRow[];
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
    });

    this.on('decide', async (req) => {
      const { weekStart, entries, note } = req.data as DecideData;
      if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return req.error(400, 'Geef de maandag van de week op.', 'weekStart');
      const lines = (entries ?? []).filter((entry) => entry.problemKey);
      const total = lines.reduce((sum, entry) => sum + (entry.cost ?? 0), 0);
      if (total > WEEK_BUDGET) {
        return req.error(400, `Het plan kost ${total} kronen; er is maar ${WEEK_BUDGET} per week.`, 'entries');
      }
      await DELETE.from(DECISIONS).where({ weekStart });
      if (lines.length > 0) {
        await INSERT.into(DECISIONS).entries(
          lines.map((entry) => ({
            weekStart,
            problemKey: entry.problemKey,
            kind: entry.kind ?? '',
            title: entry.title ?? '',
            cost: entry.cost ?? 0,
            note: note ?? '',
          })),
        );
      }
      log.info(`council plan for ${weekStart}: ${lines.length} line(s), ${total} crowns`);
      return true;
    });

    return super.init();
  }
}
