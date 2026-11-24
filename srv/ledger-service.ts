/**
 * Handlers of `LedgerService` (see `ledger-service.cds`): Ilse's Ledger.
 *
 * - `findings()` runs the fixed checks of `lib/ledger-checks.ts` over the registers and adds
 *   Ilse's marks ("niet te vertrouwen").
 * - `events()` groups the findings per moment (same user, same minute).
 * - `verifyLedger()` checks the seals of the change log kept by `lib/ledger-seal.ts`.
 * - `markUntrusted` / `clearMark` write a mark — and a page in the ledger, so marks are evidence too.
 *
 * `@sap/cds` ships no TypeScript declarations in this project, so it is loaded with `require`
 * and the part of its API this file uses is described in the small interfaces below.
 */
import {
  groupEvents,
  runChecks,
  type Finding,
  type LandmarkRow,
  type OutsideChange,
  type PipeRow,
  type RepairRow,
  type SensorRow,
  type StockRow,
} from './lib/ledger-checks';
import { appendEntries, FOLLOWED, startLedgerSync, syncLedger, verifyLedger } from './lib/ledger-seal';
import { REGISTER_NAMES } from './lib/ledger-checks';

const NS = 'oakhaven.curse';
const TRUST_MARKS = `${NS}.TrustMarks`;
const LEDGER = `${NS}.LedgerEntries`;
const MANAGED = ['ID', 'createdAt', 'createdBy', 'modifiedAt', 'modifiedBy'] as const;

/** Who marks: the ledger is Ilse's app (there is no login in Oakhaven). */
const MARKED_BY = 'ilse.vermeer';

interface MarkData {
  entityName?: string;
  recordID?: string;
  recordLabel?: string;
  reason?: string;
}

interface MarkRow {
  ID: string;
  entityName: string;
  recordID: string;
  recordLabel: string | null;
  reason: string | null;
  active: boolean | null;
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
  readonly ql: {
    readonly SELECT: {
      from(entity: string): {
        columns(...columns: readonly string[]): {
          where(predicate: Readonly<Record<string, unknown>>): PromiseLike<unknown[]>;
        } & PromiseLike<unknown[]>;
      };
    };
    readonly INSERT: { into(entity: string): { entries(rows: readonly object[]): PromiseLike<unknown> } };
    readonly UPDATE: {
      (entity: string): { set(values: object): { where(predicate: Readonly<Record<string, unknown>>): PromiseLike<unknown> } };
    };
  };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require('@sap/cds') as CdsApi;
const { SELECT, INSERT, UPDATE } = cds.ql;

const REGISTERS = new Set(['WaterPipes', 'Sensors', 'Repairs', 'StockItems', 'Landmarks']);

/** Reads every register and runs the checks; worst moment (most records at once) first. */
async function loadFindings(): Promise<Array<Finding & { untrusted: boolean; mark_ID: string | null; markReason: string | null }>> {
  await syncLedger(); // the ledger is always up to date when Ilse looks
  const [pipes, sensors, repairs, stock, landmarks, outside, marks] = await Promise.all([
    SELECT.from(`${NS}.WaterPipes`).columns(...MANAGED, 'pipeID', 'nominalFlowRate', 'currentFlowRate', 'currentPressure', 'lastMaintenance'),
    SELECT.from(`${NS}.Sensors`).columns(...MANAGED, 'pipe_ID', 'sensorID', 'flowRate', 'pressure', 'lastReading'),
    SELECT.from(`${NS}.Repairs`).columns(...MANAGED, 'pipe_ID', 'issue', 'repairDate', 'repairedBy'),
    SELECT.from(`${NS}.StockItems`).columns(...MANAGED, 'itemID', 'name', 'unit', 'currentQuantity', 'minStockLevel', 'consumptionRate'),
    SELECT.from(`${NS}.Landmarks`).columns(...MANAGED, 'name'),
    SELECT.from(LEDGER).columns('entityName', 'recordID', 'recordLabel', 'field', 'oldValue', 'newValue', 'at').where({ outsideApps: true }),
    SELECT.from(TRUST_MARKS).columns('ID', 'entityName', 'recordID', 'reason').where({ active: true }),
  ]);

  const findings = runChecks(
    {
      pipes: pipes as PipeRow[],
      sensors: sensors as SensorRow[],
      repairs: repairs as RepairRow[],
      stock: stock as StockRow[],
      landmarks: landmarks as LandmarkRow[],
      outside: (outside as OutsideChange[]).filter((change) => change.recordID),
    },
    new Date(),
  );

  const markByRecord = new Map((marks as MarkRow[]).map((mark) => [`${mark.entityName}|${mark.recordID}`, mark]));
  const rank = new Map(groupEvents(findings).map((event, index) => [event.eventKey, index]));
  const rankOf = (finding: Finding): number => {
    const minute = finding.changedAt ? new Date(finding.changedAt).toISOString().slice(0, 16) : '';
    return rank.get(`${finding.changedBy}|${minute}`) ?? Number.MAX_SAFE_INTEGER;
  };

  return findings
    .map((finding) => {
      const mark = markByRecord.get(`${finding.entityName}|${finding.recordID}`);
      return { ...finding, untrusted: Boolean(mark), mark_ID: mark?.ID ?? null, markReason: mark?.reason ?? null };
    })
    .sort((a, b) => rankOf(a) - rankOf(b) || a.register.localeCompare(b.register) || a.recordLabel.localeCompare(b.recordLabel));
}

/** 142 instead of 142.00. */
function n(value: unknown): string {
  if (value === null || value === undefined || value === '') return '?';
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round(number * 100) / 100).replace('.', ',') : String(value);
}

function d(value: unknown): string {
  if (!value) return '?';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value)
    : new Intl.DateTimeFormat('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/** The current values of a record in a few words, per register. */
function summaryOf(entityName: string, row: Record<string, unknown>, pipeNames: ReadonlyMap<string, string>): string {
  const pipe = pipeNames.get(String(row.pipe_ID ?? '')) ?? '?';
  switch (entityName) {
    case 'WaterPipes':
      return `doorstroming ${n(row.currentFlowRate)} van max. ${n(row.nominalFlowRate)} L/min · druk ${n(row.currentPressure)} PSI · onderhoud ${d(row.lastMaintenance)}`;
    case 'Sensors':
      return `op ${pipe} · meet ${n(row.flowRate)} L/min · ${n(row.pressure)} PSI`;
    case 'Repairs':
      return `aan ${pipe} · op ${d(row.repairDate)} · door ${row.repairedBy ?? '?'}`;
    case 'StockItems':
      return `voorraad ${n(row.currentQuantity)} ${row.unit ?? ''} · minimum ${n(row.minStockLevel)} · per dag ${n(row.consumptionRate)}`;
    case 'Landmarks':
      return `${row.kind ?? '?'} · vak ${row.gridCell ?? '?'}${row.suppliedBy ? ` · water van ${row.suppliedBy}` : ''}`;
    default:
      return '';
  }
}

/** Every followed record with its current values and how many ledger pages are about it. */
async function loadRecords(): Promise<object[]> {
  await syncLedger();
  const pages = (await SELECT.from(LEDGER).columns('entityName', 'recordID')) as Array<{ entityName: string; recordID: string | null }>;
  const count = new Map<string, number>();
  for (const page of pages) {
    if (!page.recordID) continue;
    const key = `${page.entityName}|${page.recordID}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  const pipes = (await SELECT.from(`${NS}.WaterPipes`).columns('ID', 'pipeID')) as Array<{ ID: string; pipeID: string }>;
  const pipeNames = new Map(pipes.map((pipe) => [pipe.ID, pipe.pipeID]));
  const result: object[] = [];
  for (const register of FOLLOWED) {
    const rows = (await SELECT.from(`${NS}.${register.entityName}`).columns(
      'ID', 'modifiedAt', 'modifiedBy', ...register.fields)) as Array<Record<string, unknown> & { ID: string }>;
    for (const row of rows) {
      result.push({
        entityName: register.entityName,
        register: REGISTER_NAMES[register.entityName] ?? register.entityName,
        recordID: row.ID,
        recordLabel: String(row[register.labelField] ?? row.ID),
        summary: summaryOf(register.entityName, row, pipeNames),
        changedBy: row.modifiedBy ?? '?',
        changedAt: row.modifiedAt ?? null,
        pages: count.get(`${register.entityName}|${row.ID}`) ?? 0,
      });
    }
  }
  return result;
}

export default class LedgerService extends cds.ApplicationService {
  override async init(): Promise<void> {
    this.on('findings', () => loadFindings());

    this.on('events', async () => groupEvents(await loadFindings()));

    this.on('verifyLedger', () => verifyLedger());

    this.on('records', () => loadRecords());

    this.on('markUntrusted', async (req) => {
      const { entityName, recordID, recordLabel, reason } = req.data as MarkData;
      if (!entityName || !REGISTERS.has(entityName)) return req.error(400, 'Onbekend register.', 'entityName');
      if (!recordID) return req.error(400, 'Kies een record.', 'recordID');
      if (!reason?.trim()) return req.error(400, 'Schrijf kort waarom dit niet te vertrouwen is.', 'reason');

      const existing = (await SELECT.from(TRUST_MARKS).columns('ID').where({ entityName, recordID, active: true })) as MarkRow[];
      if (existing.length > 0) return req.error(409, 'Dit record is al gemarkeerd als niet te vertrouwen.', 'recordID');

      await INSERT.into(TRUST_MARKS).entries([
        { entityName, recordID, recordLabel: recordLabel ?? '', reason: reason.trim(), markedBy: MARKED_BY, active: true },
      ]);
      await appendEntries([
        { entityName, recordID, recordLabel: recordLabel ?? '', field: '(gemarkeerd: niet te vertrouwen)',
          oldValue: '', newValue: reason.trim(), changedBy: MARKED_BY, outsideApps: false },
      ]);
      return true;
    });

    this.on('clearMark', async (req) => {
      const { mark_ID } = req.data as { mark_ID?: string };
      if (!mark_ID) return req.error(400, 'Kies een markering.', 'mark_ID');
      const [mark] = (await SELECT.from(TRUST_MARKS).columns('ID', 'entityName', 'recordID', 'recordLabel', 'reason', 'active').where({ ID: mark_ID })) as MarkRow[];
      if (!mark?.active) return req.error(404, 'Deze markering bestaat niet (meer).', 'mark_ID');

      await UPDATE(TRUST_MARKS).set({ active: false }).where({ ID: mark_ID });
      await appendEntries([
        { entityName: mark.entityName, recordID: mark.recordID, recordLabel: mark.recordLabel ?? '', field: '(markering opgeheven)',
          oldValue: mark.reason ?? '', newValue: '', changedBy: MARKED_BY, outsideApps: false },
      ]);
      return true;
    });

    startLedgerSync();
    return super.init();
  }
}
