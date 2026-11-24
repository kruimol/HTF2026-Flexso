/**
 * Learning from stock counts: pure functions, no database, no CAP.
 *
 * Tobin counts the shelf now and then. Between two counts the stock goes down by what was used:
 * `consumed = previous count + deliveries since − new count`. Spread over the days in between
 * (Saturday weighs `saturdayFactor`) this gives an observed use per normal day. The rate the
 * forecast uses moves a little towards every observation (exponential smoothing), starting from the
 * rate in the village records, so one odd day does not turn the forecast upside down.
 *
 * A count is read as "stock at the start of that day" (counted in the morning), the same moment
 * the forecast uses for its day columns.
 */

/** How far one observation moves the learned value (0–1). */
export const LEARNING_WEIGHT = 0.3;
/** Counts further apart than this are not turned into a daily rate (too vague). */
export const MAX_GAP_DAYS = 14;
/** One observation may be at most this many times above/below the current value. */
const MAX_OBSERVATION_RATIO = 4;
const MIN_OBSERVATION_RATIO = 0.25;
const MIN_SATURDAY_FACTOR = 0.5;
const MAX_SATURDAY_FACTOR = 5;

const SATURDAY = 6;

export interface LearningState {
  /** Use per normal day, in the item's unit. */
  rate: number;
  /** Use on a Saturday relative to a normal day. */
  saturdayFactor: number;
  /** Count intervals learned from so far. */
  samples: number;
}

export interface CountInterval {
  previousQuantity: number;
  /** Delivered between the two counts. */
  received: number;
  newQuantity: number;
  /** `YYYY-MM-DD` of the previous and the new count. */
  previousDate: string;
  newDate: string;
}

export interface LearningResult {
  state: LearningState;
  /** Used between the two counts. */
  consumed: number;
  /** Days between the counts. */
  days: number;
  /** What this interval says about a normal day (or about the Saturday factor, see `learned`). */
  observation: number;
  learned: 'rate' | 'saturdayFactor';
}

function parseDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const smooth = (current: number, observed: number): number =>
  current * (1 - LEARNING_WEIGHT) + observed * LEARNING_WEIGHT;

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Whole days from `from` to `to` (local dates). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Updates the learned state with one count interval, or returns null when the interval says
 * nothing usable (same day, too far apart, or more stock than expected after the deliveries).
 */
export function learnFromCount(state: LearningState, interval: CountInterval): LearningResult | null {
  const days = daysBetween(interval.previousDate, interval.newDate);
  if (days < 1 || days > MAX_GAP_DAYS) return null;

  const consumed = interval.previousQuantity + interval.received - interval.newQuantity;
  if (consumed < 0) return null;

  // The days covered: from the previous count day up to (not including) the new count day.
  const start = parseDate(interval.previousDate);
  let saturdays = 0;
  for (let offset = 0; offset < days; offset++) {
    if (new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset).getDay() === SATURDAY) saturdays++;
  }

  // Exactly one Saturday on its own: the cleanest evidence of the market-day factor.
  if (days === 1 && saturdays === 1 && state.rate > 0) {
    const observed = clamp(consumed / state.rate, MIN_SATURDAY_FACTOR, MAX_SATURDAY_FACTOR);
    return {
      state: {
        ...state,
        saturdayFactor: round(smooth(state.saturdayFactor, observed), 2),
        samples: state.samples + 1,
      },
      consumed: round(consumed, 2),
      days,
      observation: round(observed, 2),
      learned: 'saturdayFactor',
    };
  }

  const weight = days - saturdays + saturdays * state.saturdayFactor;
  const raw = consumed / weight;
  const observed =
    state.rate > 0 ? clamp(raw, state.rate * MIN_OBSERVATION_RATIO, state.rate * MAX_OBSERVATION_RATIO) : raw;
  return {
    state: { ...state, rate: round(smooth(state.rate, observed), 3), samples: state.samples + 1 },
    consumed: round(consumed, 2),
    days,
    observation: round(observed, 3),
    learned: 'rate',
  };
}
