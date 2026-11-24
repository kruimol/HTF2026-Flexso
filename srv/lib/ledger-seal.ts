/**
 * Ilse's Ledger: the sealed change log.
 *
 * `managed` only keeps the LAST change of a record, so nobody can see what a record looked like
 * before. This module keeps that history itself: it remembers the last known state of every
 * followed record (`RecordSeals`) and, every few seconds, compares the registers with it. Every
 * changed field becomes one page in `LedgerEntries` with the old and the new value.
 *
 * - It compares data instead of hooking into writes, so it also sees changes made with plain SQL,
 *   past CAP — exactly what The Desync did. Such a change leaves `modifiedAt` untouched: the page
 *   gets `outsideApps = true`.
 * - Every page carries the hash of the page before it (a chain, like numbered and sealed pages):
 *   editing or tearing out an old page breaks the chain, and `verifyLedger()` shows where.
 *
 * `Sensors.lastReading` is not followed: srv/lib/demo-freshness.ts stamps it every 20 s.
 */
import { createHash } from 'node:crypto';

const LEDGER = 'oakhaven.curse.LedgerEntries';
const SEALS = 'oakhaven.curse.RecordSeals';

/** How often the ledger compares the registers with the seals. */
const SYNC_INTERVAL_MS = 15_000;

/** "Previous hash" of the very first page. */
const GENESIS_HASH = '0'.repeat(64);

/** The registers the ledger follows, with the fields that matter and how to name a record. */
const FOLLOWED: ReadonlyArray<{ entityName: string; fields: readonly string[]; labelField: string }> = [
  {
    entityName: 'WaterPipes',
    labelField: 'pipeID',
    fields: ['pipeID', 'location', 'startPoint', 'endPoint', 'pipelineType', 'diameter', 'length',
      'nominalFlowRate', 'currentFlowRate', 'currentPressure', 'lastMaintenance', 'mapPath'],
  },
  { entityName: 'Sensors', labelField: 'sensorID', fields: ['pipe_ID', 'sensorID', 'flowRate', 'pressure'] },
  { entityName: 'Repairs', labelField: 'issue', fields: ['pipe_ID', 'issue', 'repairDate', 'repairedBy'] },
  { entityName: 'StockItems', labelField: 'name', fields: ['itemID', 'name', 'unit', 'currentQuantity', 'minStockLevel', 'consumptionRate'] },
  { entityName: 'Landmarks', labelField: 'name', fields: ['name', 'kind', 'gridCell', 'suppliedBy'] },
];

/** One page as it is stored. */
export interface LedgerEntryRow {
  ID?: string;
  seq: number;
  at: string;
  entityName: string;
  recordID: string | null;
  recordLabel: string;
  field: string;
  oldValue: string;
  newValue: string;
  changedBy: string;
  outsideApps: boolean;
  prevHash: string;
  hash: string;
}

/** A page before it is numbered and sealed. */
export type NewEntry = Omit<LedgerEntryRow, 'ID' | 'seq' | 'at' | 'prevHash' | 'hash'>;

export interface LedgerCheck {
  intact: boolean;
  pages: number;
  brokenAtSeq: number | null;
  message: string;
}

interface SealRow {
  entityName: string;
  recordID: string;
  snapshot: string;
  modifiedAt: string | null;
}

type Row = Record<string, unknown> & { ID: string; modifiedAt: string | null; modifiedBy: string | null };

/** The slice of the `cds` facade this module uses. */
interface CdsApi {
  readonly ql: {
    readonly SELECT: {
      from(entity: string): {
        columns(...columns: readonly string[]): PromiseLike<unknown[]> & {
          orderBy(order: string): PromiseLike<unknown[]>;
        };
      };
      one: { from(entity: string): { columns(...columns: readonly string[]): { orderBy(order: string): PromiseLike<unknown> } } };
    };
    readonly INSERT: { into(entity: string): { entries(rows: readonly object[]): PromiseLike<unknown> } };
    readonly UPSERT: { into(entity: string): { entries(rows: readonly object[]): PromiseLike<unknown> } };
    readonly DELETE: { from(entity: string): { where(predicate: Readonly<Record<string, unknown>>): PromiseLike<unknown> } };
  };
  once(event: string, handler: () => unknown): void;
  log(module: string): { info(...args: readonly unknown[]): void; warn(...args: readonly unknown[]): void };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require('@sap/cds') as CdsApi;
const { SELECT, INSERT, UPSERT, DELETE } = cds.ql;
const log = cds.log('ledger');

/** The seal of one page: covers its own content and the hash of the page before. */
export function pageHash(page: Omit<LedgerEntryRow, 'ID' | 'hash'>): string {
  const content = [page.prevHash, page.seq, page.at, page.entityName, page.recordID ?? '', page.field,
    page.oldValue, page.newValue, page.changedBy, page.outsideApps];
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/** A value as the ledger writes it down: numbers without trailing zeros, empty for null. */
function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string' && /^-?\d+\.\d+$/.test(value)) return String(Number(value));
  return String(value);
}

function snapshotOf(row: Row, fields: readonly string[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field, text(row[field])]));
}

/** Runs one sync at a time: the interval and a request never write the same page number twice. */
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

/** Numbers, seals and stores new pages after the last one. */
async function appendUnlocked(entries: readonly NewEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const last = (await SELECT.one.from(LEDGER).columns('seq', 'hash').orderBy('seq desc')) as
    | { seq: number; hash: string }
    | undefined;
  let seq = last?.seq ?? 0;
  let prevHash = last?.hash ?? GENESIS_HASH;
  const at = new Date().toISOString();
  const rows: LedgerEntryRow[] = entries.map((entry) => {
    seq += 1;
    const page = { ...entry, seq, at, prevHash };
    const hash = pageHash(page);
    prevHash = hash;
    return { ...page, hash };
  });
  await INSERT.into(LEDGER).entries(rows);
}

/** Adds pages written by the ledger app itself (e.g. Ilse marking a record). */
export function appendEntries(entries: readonly NewEntry[]): Promise<void> {
  return serialized(() => appendUnlocked(entries));
}

/** Compares every followed register with its seals; writes a page per changed field. */
async function syncUnlocked(): Promise<number> {
  const seals = (await SELECT.from(SEALS).columns('entityName', 'recordID', 'snapshot', 'modifiedAt')) as SealRow[];
  const firstSeal = seals.length === 0;
  const sealByKey = new Map(seals.map((seal) => [`${seal.entityName}|${seal.recordID}`, seal]));
  const entries: NewEntry[] = [];
  const newSeals: object[] = [];
  const now = new Date().toISOString();
  let sealed = 0;

  for (const register of FOLLOWED) {
    const rows = (await SELECT.from(`oakhaven.curse.${register.entityName}`).columns(
      'ID', 'modifiedAt', 'modifiedBy', ...register.fields,
    )) as Row[];
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${register.entityName}|${row.ID}`;
      seen.add(key);
      const snapshot = snapshotOf(row, register.fields);
      const recordLabel = text(row[register.labelField]) || row.ID;
      const seal = sealByKey.get(key);
      const sealRow = { entityName: register.entityName, recordID: row.ID, snapshot: JSON.stringify(snapshot), modifiedAt: row.modifiedAt, sealedAt: now };

      if (!seal) {
        sealed += 1;
        newSeals.push(sealRow);
        if (!firstSeal) {
          entries.push({ entityName: register.entityName, recordID: row.ID, recordLabel, field: '(nieuw record)',
            oldValue: '', newValue: recordLabel, changedBy: row.modifiedBy ?? '?', outsideApps: false });
        }
        continue;
      }

      const before = JSON.parse(seal.snapshot) as Record<string, string>;
      const changed = register.fields.filter((field) => (before[field] ?? '') !== snapshot[field]);
      if (changed.length === 0) continue;
      const outsideApps = (seal.modifiedAt ?? '') === (row.modifiedAt ?? '');
      for (const field of changed) {
        entries.push({ entityName: register.entityName, recordID: row.ID, recordLabel, field,
          oldValue: before[field] ?? '', newValue: snapshot[field], changedBy: outsideApps ? '?' : row.modifiedBy ?? '?', outsideApps });
      }
      newSeals.push(sealRow);
    }

    for (const seal of seals.filter((s) => s.entityName === register.entityName && !seen.has(`${s.entityName}|${s.recordID}`))) {
      const before = JSON.parse(seal.snapshot) as Record<string, string>;
      entries.push({ entityName: register.entityName, recordID: seal.recordID, recordLabel: before[register.labelField] || seal.recordID,
        field: '(record verwijderd)', oldValue: before[register.labelField] ?? '', newValue: '', changedBy: '?', outsideApps: true });
      await DELETE.from(SEALS).where({ entityName: seal.entityName, recordID: seal.recordID });
    }
  }

  if (firstSeal && sealed > 0) {
    entries.push({ entityName: '', recordID: null, recordLabel: 'Het dorpsregister', field: '(verzegeling)',
      oldValue: '', newValue: `${sealed} records verzegeld`, changedBy: 'ilse.ledger', outsideApps: false });
  }
  if (newSeals.length > 0) await UPSERT.into(SEALS).entries(newSeals);
  await appendUnlocked(entries);
  if (entries.length > 0) log.info(`${entries.length} ledger page(s) written`);
  return entries.length;
}

/** Brings the ledger up to date with the registers. */
export function syncLedger(): Promise<number> {
  return serialized(syncUnlocked);
}

/** Walks the chain page by page: numbers must follow, every seal must match. */
export async function verifyLedger(): Promise<LedgerCheck> {
  const pages = (await SELECT.from(LEDGER).columns(
    'seq', 'at', 'entityName', 'recordID', 'recordLabel', 'field', 'oldValue', 'newValue', 'changedBy', 'outsideApps', 'prevHash', 'hash',
  ).orderBy('seq')) as LedgerEntryRow[];
  let prevHash = GENESIS_HASH;
  for (const [index, page] of pages.entries()) {
    const expectedSeq = index + 1;
    const own = pageHash({ ...page, outsideApps: Boolean(page.outsideApps) });
    if (page.seq !== expectedSeq) {
      return { intact: false, pages: pages.length, brokenAtSeq: expectedSeq,
        message: `Bladzijde ${expectedSeq} ontbreekt: na bladzijde ${expectedSeq - 1} volgt bladzijde ${page.seq}.` };
    }
    if (page.prevHash !== prevHash) {
      return { intact: false, pages: pages.length, brokenAtSeq: page.seq,
        message: `Bladzijde ${page.seq} past niet meer op bladzijde ${page.seq - 1}: daar werd iets veranderd of weggenomen.` };
    }
    if (own !== page.hash) {
      return { intact: false, pages: pages.length, brokenAtSeq: page.seq,
        message: `Het zegel van bladzijde ${page.seq} klopt niet: de inhoud werd achteraf veranderd.` };
    }
    prevHash = page.hash;
  }
  return { intact: true, pages: pages.length, brokenAtSeq: null,
    message: pages.length === 0 ? 'Het grootboek is nog leeg.' : `Alle ${pages.length} bladzijden zijn ongeschonden.` };
}

/** Seals the registers once the server is up, then keeps the ledger in sync. */
export function startLedgerSync(): void {
  const run = async (): Promise<void> => {
    try {
      await syncLedger();
    } catch (error) {
      log.warn('could not sync the ledger', error);
    }
  };
  cds.once('served', async () => {
    await run();
    const timer = setInterval(() => void run(), SYNC_INTERVAL_MS);
    timer.unref();
    cds.once('shutdown', () => clearInterval(timer));
  });
}
