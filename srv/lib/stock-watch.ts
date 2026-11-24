/**
 * Status watch for Tobin's Week Ahead: writes a `Notifications` row when the status of a followed
 * ingredient CHANGES (worse or back to green) — never while it stays the same, so Tobin gets a
 * message, not a flood. The last status is kept in `SupplyRules.lastStatus`.
 */
import { toDateString, type Status, type WeekAheadItem } from './stock-forecast';

/** How often the watch re-checks the stock. */
const WATCH_INTERVAL_MS = 5 * 60_000;

/** One followed item as the watch needs it. */
export interface WatchedRule {
  readonly ruleID: string;
  readonly itemUUID: string;
  readonly lastStatus: string | null;
}

/** What to write for one item whose status changed. */
export interface StatusChange {
  readonly ruleID: string;
  readonly itemUUID: string;
  readonly status: Status;
  readonly message: string;
}

const STATUS_WORD: Readonly<Record<Status, string>> = { green: 'in orde', orange: 'let op', red: 'kritiek' };

const DAY_FORMAT = new Intl.DateTimeFormat('nl-BE', { weekday: 'long', day: 'numeric', month: 'short' });

/** "vrijdag 27 nov" from a `YYYY-MM-DD` date string. */
function dayText(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return DAY_FORMAT.format(new Date(year, month - 1, day));
}

function messageFor(item: WeekAheadItem, previous: string | null): string {
  const quantity = `${item.currentQuantity} ${item.unit}`;
  if (item.status === 'green') {
    return `${item.name} is weer in orde (${quantity} op voorraad).`;
  }
  const late = item.orderByDate !== null && item.orderByDate < toDateString(new Date());
  const order = item.orderByDate
    ? late
      ? ` Bestel nu bij ${item.supplier}.`
      : ` Bestel uiterlijk ${dayText(item.orderByDate)} bij ${item.supplier}.`
    : '';
  const from = previous ? ` (was: ${STATUS_WORD[previous as Status] ?? previous})` : '';
  const suspect = item.dataSuspect ? ' De voorraad klopt waarschijnlijk niet: tel na.' : '';
  return `${item.name}: ${STATUS_WORD[item.status]}${from}, ${quantity} op voorraad.${order}${suspect}`;
}

/**
 * Compares the current status with the last notified one. A first sighting (no `lastStatus`) only
 * produces a message when something is wrong; a green first sighting is recorded silently.
 */
export function detectChanges(
  items: readonly WeekAheadItem[],
  rules: ReadonlyMap<string, WatchedRule>,
): { notify: StatusChange[]; record: StatusChange[] } {
  const notify: StatusChange[] = [];
  const record: StatusChange[] = [];
  for (const item of items) {
    const rule = rules.get(item.itemID);
    if (!rule || rule.lastStatus === item.status) continue;
    const change: StatusChange = {
      ruleID: rule.ruleID,
      itemUUID: rule.itemUUID,
      status: item.status,
      message: messageFor(item, rule.lastStatus),
    };
    if (rule.lastStatus === null && item.status === 'green') record.push(change);
    else notify.push(change);
  }
  return { notify, record };
}

/** The slice of the `cds` facade this module uses. */
interface CdsApi {
  once(event: string, handler: () => unknown): void;
  log(module: string): { warn(...args: readonly unknown[]): void };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require('@sap/cds') as CdsApi;

/** Runs `check` once the server is up and then every few minutes; failures are logged, never fatal. */
export function startStockWatch(check: () => Promise<void>): void {
  const run = async (): Promise<void> => {
    try {
      await check();
    } catch (error) {
      cds.log('stock-watch').warn('could not check the stock status', error);
    }
  };
  cds.once('served', async () => {
    await run();
    const timer = setInterval(() => void run(), WATCH_INTERVAL_MS);
    timer.unref();
    cds.once('shutdown', () => clearInterval(timer));
  });
}
