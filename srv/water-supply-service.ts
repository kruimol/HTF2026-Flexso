/**
 * Handlers of `WaterSupplyService` (see `water-supply-service.cds`).
 *
 * Everything you can read from the service is served by CAP's generic provider — no code needed.
 * Add a handler here only when you need logic: `this.before(...)` to validate, `this.on(...)` to
 * implement an action, `this.after(...)` to enrich what is read.
 *
 * `@sap/cds` ships no TypeScript declarations in this project, so it is loaded with `require`
 * and the part of its API this file uses is described in the small interfaces below.
 */
import { startDemoSensorFeed } from './lib/demo-freshness';
import { randomUUID } from 'node:crypto';
import {
  planMorningRound,
  type LandmarkInput,
  type MorningRound,
  type PipeInput,
  type RepairInput,
  type SensorInput,
} from './lib/water-priority';

// 👋 EXAMPLE — the shape of a WaterPipes row as our handler sees it. Every field is optional:
//    the client decides which fields it asks for ($select).
interface PipeRow {
  ID?: string;
  lastMaintenance?: string | null;
  daysSinceMaintenance?: number | null;
}

/** The slice of a CAP service this file uses. */
interface CdsService {
  init(): Promise<void>;
  after(event: string, entity: string, handler: (results: unknown) => unknown): void;
  on(event: string, handler: (req: ActionRequest) => unknown): void;
}

/** The parameters of the `logRepair` action, as CAP hands them to the handler. */
interface ActionRequest {
  readonly data: {
    readonly pipe_ID?: string | null;
    readonly issue?: string | null;
    readonly repairDate?: string | null;
    readonly repairedBy?: string | null;
  };
  error(code: number, message: string, target?: string): unknown;
}

/** A CQL SELECT after `.columns(...)`: await it directly, or narrow it with `.where(...)`. */
interface SelectColumns<T> extends PromiseLike<T[]> {
  where(predicate: Readonly<Record<string, unknown>>): PromiseLike<T[]>;
}

/** The slice of the `cds` facade this file uses. */
interface CdsApi {
  readonly ApplicationService: new (...args: readonly never[]) => CdsService;
  readonly ql: {
    readonly SELECT: {
      from(entity: string): {
        columns<T = PipeRow>(...columns: readonly string[]): SelectColumns<T>;
      };
    };
    INSERT: { into(entity: string): { entries(data: Readonly<Record<string, unknown>>): PromiseLike<unknown> } };
  };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require('@sap/cds') as CdsApi;
const { SELECT, INSERT } = cds.ql;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 👋 EXAMPLE — fills in the computed field `daysSinceMaintenance` on every pipe that is read.
 *
 * Registered with `this.after('READ', 'WaterPipes', …)`: CAP has already read the rows from the
 * database and hands them to us just before it sends them to the client — we only add a value.
 */
async function addDaysSinceMaintenance(results: unknown): Promise<void> {
  // 👋 EXAMPLE — reading a collection (/WaterPipes) gives an array; reading one pipe
  //    (/WaterPipes(<ID>)) gives a single object. Treat both the same way.
  const rows = (Array.isArray(results) ? results : [results]).filter(
    (row): row is PipeRow => row !== null && typeof row === 'object',
  );

  // 👋 EXAMPLE — the client may ask for only SOME fields, e.g. `$select=pipeID,daysSinceMaintenance`.
  //    UI5 always does that: it only requests the fields a view binds. Then `lastMaintenance` — the
  //    input we need — is not in the row. CAP always adds the key (`ID`), so we look the missing
  //    inputs up ourselves: ONE query for all rows that need it (never one query per row).
  const missingIds = rows.filter((row) => !('lastMaintenance' in row) && row.ID).map((row) => row.ID);
  const lastMaintenanceById = new Map<string, string | null | undefined>();
  if (missingIds.length > 0) {
    const pipes = await SELECT.from('oakhaven.curse.WaterPipes')
      .columns('ID', 'lastMaintenance')
      .where({ ID: { in: missingIds } });
    for (const pipe of pipes) lastMaintenanceById.set(pipe.ID ?? '', pipe.lastMaintenance);
  }

  // 👋 EXAMPLE — the actual calculation: whole days between the last maintenance and now.
  //    Computed on every read, so it is always up to date — nothing is stored.
  const now = Date.now();
  for (const row of rows) {
    const lastMaintenance = 'lastMaintenance' in row ? row.lastMaintenance : lastMaintenanceById.get(row.ID ?? '');
    row.daysSinceMaintenance = lastMaintenance
      ? Math.floor((now - Date.parse(lastMaintenance)) / MS_PER_DAY)
      : null;
  }
}

/** 💧 Maren's morning round: reads pipes, landmarks and sensors once and ranks the pipes. */
async function morningRound(): Promise<MorningRound> {
  const [pipes, landmarks, sensors] = await Promise.all([
    SELECT.from('oakhaven.curse.WaterPipes').columns<PipeInput>(
      'ID', 'pipeID', 'location', 'startPoint', 'endPoint', 'pipelineType',
      'nominalFlowRate', 'currentFlowRate', 'currentPressure', 'lastMaintenance', 'mapPath', 'modifiedAt',
    ),
    SELECT.from('oakhaven.curse.Landmarks').columns<LandmarkInput>('name', 'kind', 'gridCell', 'suppliedBy'),
    SELECT.from('oakhaven.curse.Sensors').columns<SensorInput>('sensorID', 'pipe_ID', 'flowRate', 'pressure', 'lastReading', 'modifiedAt'),
  ]);
  const repairs = await SELECT.from('oakhaven.curse.Repairs').columns<RepairInput>('pipe_ID', 'issue', 'repairDate', 'repairedBy');
  return planMorningRound(pipes, landmarks, sensors, new Date(), repairs);
}

/** 💧 Maren logs a repair: validate, then add it to the repair log. */
async function logRepair(req: ActionRequest): Promise<unknown> {
  const issue = req.data.issue?.trim();
  const repairedBy = req.data.repairedBy?.trim();
  const date = req.data.repairDate ?? '';
  const today = new Date().toISOString().slice(0, 10);
  if (!req.data.pipe_ID) return req.error(400, 'Which pipe was repaired?', 'pipe_ID');
  if (!issue) return req.error(400, 'What was wrong? Describe the repair.', 'issue');
  if (!repairedBy) return req.error(400, 'Who did the repair?', 'repairedBy');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return req.error(400, 'Give the date of the repair.', 'repairDate');
  if (date > today) return req.error(400, 'A repair cannot be in the future.', 'repairDate');

  const [pipe] = await SELECT.from('oakhaven.curse.WaterPipes').columns('ID').where({ ID: req.data.pipe_ID });
  if (!pipe) return req.error(404, 'That pipe does not exist.', 'pipe_ID');

  // A repair logged for today counts from now; one for an earlier day from noon that day.
  const repairDate = date === today ? `${new Date().toISOString().slice(0, 19)}Z` : `${date}T12:00:00Z`;
  const repair = { ID: randomUUID(), pipe_ID: req.data.pipe_ID, repairID: randomUUID(), issue, repairDate, repairedBy };
  await INSERT.into('oakhaven.curse.Repairs').entries(repair);
  return repair;
}

export default class WaterSupplyService extends cds.ApplicationService {
  override async init(): Promise<void> {
    // 👋 EXAMPLE — register the handler: after every READ of WaterPipes, add daysSinceMaintenance.
    this.after('READ', 'WaterPipes', addDaysSinceMaintenance);

    // 💧 Maren — GET /odata/v4/water-supply/morningRound()
    this.on('morningRound', morningRound);
    this.on('logRepair', logRepair);

    startDemoSensorFeed();
    return super.init();
  }
}
