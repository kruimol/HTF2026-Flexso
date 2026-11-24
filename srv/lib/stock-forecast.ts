/**
 * Forecast logic of Tobin's Week Ahead: pure functions, no database, no CAP.
 *
 * For one followed stock item it simulates the next {@link HORIZON_DAYS} days (Saturday is market
 * day: consumption × `saturdayFactor`) and works out when the stock runs out and when Tobin must
 * order at the latest.
 */

export type Status = 'green' | 'orange' | 'red';
export type Reason = 'ok' | 'belowMin' | 'belowHalfMin' | 'orderToday' | 'orderOverdue';

/** Days the forecast looks ahead (today included). */
export const HORIZON_DAYS = 7;
/**
 * A delivery must be there the day BEFORE the stock runs out: Tobin starts baking at 04:00,
 * before any delivery arrives. Order-by date = run-out date − lead time − this buffer.
 */
export const DELIVERY_BUFFER_DAYS = 1;

const SATURDAY = 6;

export interface ItemInput {
  itemID: string;
  name: string;
  icon: string;
  unit: string;
  currentQuantity: number;
  minStockLevel: number;
  consumptionRate: number;
}

export interface RuleInput {
  supplier: string;
  leadTimeDays: number;
  saturdayFactor: number;
}

/** An open order: `quantity` arrives on `expectedAt` (`YYYY-MM-DD`). */
export interface IncomingOrder {
  expectedAt: string;
  quantity: number;
}

export interface DayForecast {
  date: string;
  startQuantity: number;
  consumption: number;
  isSaturday: boolean;
  short: boolean;
}

export interface WeekAheadItem {
  itemID: string;
  name: string;
  icon: string;
  unit: string;
  supplier: string;
  leadTimeDays: number;
  currentQuantity: number;
  minStockLevel: number;
  dataSuspect: boolean;
  status: Status;
  reason: Reason;
  runOutDate: string | null;
  orderByDate: string | null;
  adviceQuantity: number;
  incomingQuantity: number;
  nextArrivalDate: string | null;
  days: DayForecast[];
}

/** `YYYY-MM-DD` of a date in local time (what the village clock says). */
export function toDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  return result;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Forecast of one item, starting today (`today`'s time of day is ignored). */
export function forecastItem(
  item: ItemInput,
  rule: RuleInput,
  today: Date,
  incoming: readonly IncomingOrder[] = [],
): WeekAheadItem {
  const dataSuspect = item.currentQuantity < 0;
  let quantity = Math.max(item.currentQuantity, 0);

  const days: DayForecast[] = [];
  let totalConsumption = 0;
  let runOutIndex = -1;
  // An order counts from the morning AFTER its expected day (Tobin bakes at 04:00, before deliveries);
  // an overdue order is assumed to arrive today, so it counts from tomorrow.
  const todayString = toDateString(today);
  const arrivals = incoming.map((order) => ({
    quantity: order.quantity,
    expectedAt: order.expectedAt < todayString ? todayString : order.expectedAt,
  }));
  const pending = [...arrivals].sort((a, b) => a.expectedAt.localeCompare(b.expectedAt));
  const incomingQuantity = incoming.reduce((sum, order) => sum + order.quantity, 0);
  for (let index = 0; index < HORIZON_DAYS; index++) {
    const date = addDays(today, index);
    const dateString = toDateString(date);
    while (pending.length > 0 && pending[0].expectedAt < dateString) {
      quantity += pending.shift()?.quantity ?? 0;
    }
    const isSaturday = date.getDay() === SATURDAY;
    const consumption = round2(item.consumptionRate * (isSaturday ? rule.saturdayFactor : 1));
    const short = quantity < consumption;
    if (short && runOutIndex < 0) runOutIndex = index;
    days.push({ date: dateString, startQuantity: round2(quantity), consumption, isSaturday, short });
    totalConsumption += consumption;
    quantity = Math.max(quantity - consumption, 0);
  }

  const orderByIndex = runOutIndex < 0 ? null : runOutIndex - rule.leadTimeDays - DELIVERY_BUFFER_DAYS;

  let status: Status = 'green';
  let reason: Reason = 'ok';
  if (item.currentQuantity < item.minStockLevel / 2) {
    status = 'red';
    reason = 'belowHalfMin';
  } else if (orderByIndex !== null && orderByIndex < 0) {
    status = 'red';
    reason = 'orderOverdue';
  } else if (item.currentQuantity < item.minStockLevel) {
    status = 'orange';
    reason = 'belowMin';
  } else if (orderByIndex === 0) {
    status = 'orange';
    reason = 'orderToday';
  }

  return {
    itemID: item.itemID,
    name: item.name,
    icon: item.icon,
    unit: item.unit,
    supplier: rule.supplier,
    leadTimeDays: rule.leadTimeDays,
    currentQuantity: round2(item.currentQuantity),
    minStockLevel: round2(item.minStockLevel),
    dataSuspect,
    status,
    reason,
    runOutDate: runOutIndex < 0 ? null : days[runOutIndex].date,
    orderByDate: orderByIndex === null ? null : toDateString(addDays(today, orderByIndex)),
    adviceQuantity: round2(
      Math.max(totalConsumption + item.minStockLevel - Math.max(item.currentQuantity, 0) - incomingQuantity, 0),
    ),
    incomingQuantity: round2(incomingQuantity),
    nextArrivalDate: arrivals.length === 0 ? null : arrivals.map((order) => order.expectedAt).sort()[0],
    days,
  };
}

const STATUS_RANK: Readonly<Record<Status, number>> = { red: 0, orange: 1, green: 2 };

/** Worst status first, then the earliest order-by date. */
export function sortWorstFirst<T extends WeekAheadItem>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      (a.orderByDate ?? '9999').localeCompare(b.orderByDate ?? '9999'),
  );
}
