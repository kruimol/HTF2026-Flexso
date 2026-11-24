/**
 * Ilse's timeline: every write in the village registers on one time axis, so she sees when it began
 * and whether it happened all at once or bit by bit. Pure functions: events in, SVG / summary out.
 *
 * Times are village time (the clock the registers write in, UTC), like the rest of the ledger.
 * The drawing is plain static SVG (no animation): Ilse works on an old laptop.
 *
 * @namespace ilse.ledger.model
 */

export type Level = "normal" | "suspect" | "alarm";

export interface TimelineEvent {
  at: string;
  /** "Aangemaakt", "Gewijzigd", or what the ledger saw. */
  what: string;
  entityName: string;
  register: string;
  recordID: string;
  recordLabel: string;
  by: string;
  level: Level;
  /** Short names of the checks the record breaks (only on its suspicious event). */
  reasons: string;
}

export interface TimelineSummary {
  suspectCount: number;
  days: number;
  first: TimelineEvent | null;
  last: TimelineEvent | null;
  /** The biggest moment: suspicious writes by the same user within the same minute. */
  biggest: { at: string; by: string; count: number; registers: number } | null;
}

export interface TimelineTexts {
  readonly title: string;
  readonly normal: string;
  readonly suspect: string;
  readonly alarm: string;
  readonly now: string;
}

const MONTH = new Intl.DateTimeFormat("nl-BE", { month: "short", year: "numeric", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("nl-BE", { day: "numeric", month: "short", timeZone: "UTC" });
const DAY_TIME = new Intl.DateTimeFormat("nl-BE", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
});

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function n(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** How the moments are counted: same user, same minute. */
function minuteKey(event: TimelineEvent): string {
  return `${event.by}|${event.at.slice(0, 16)}`;
}

/** The answers to Ilse's two questions, as numbers (the sentences are in i18n). */
export function summarize(events: readonly TimelineEvent[]): TimelineSummary {
  const suspect = events.filter((event) => event.level !== "normal").sort((a, b) => a.at.localeCompare(b.at));
  const groups = new Map<string, TimelineEvent[]>();
  for (const event of suspect) groups.set(minuteKey(event), [...(groups.get(minuteKey(event)) ?? []), event]);
  let biggest: TimelineSummary["biggest"] = null;
  for (const group of groups.values()) {
    if (!biggest || group.length > biggest.count) {
      biggest = { at: group[0].at, by: group[0].by, count: group.length, registers: new Set(group.map((e) => e.entityName)).size };
    }
  }
  return {
    suspectCount: suspect.length,
    days: new Set(suspect.map((event) => event.at.slice(0, 10))).size,
    first: suspect[0] ?? null,
    last: suspect[suspect.length - 1] ?? null,
    biggest,
  };
}

/** Village date and time: "17/11/2026 03:13". */
export function villageTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DAY_TIME.format(date).replace(",", "");
}

/** "2026-11 · nov. 2026": sorts by time and reads as a month. */
export function monthKey(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : `${iso.slice(0, 7)} · ${MONTH.format(date)}`;
}

/**
 * The time axis: one dot per write, stacked when they fall on the same day; grey = normal,
 * orange = suspicious record, red = system account / no name / night / outside the apps.
 */
export function buildTimelineSvg(events: readonly TimelineEvent[], now: Date, texts: TimelineTexts, fromIso?: string, toIso?: string): string {
  const width = 1200;
  const height = 300;
  const left = 40;
  const right = width - 30;
  const base = 220;
  const dot = 6;
  const step = 14;
  const maxStack = 10;
  // A zoomed view (e.g. the last 30 days) only shows what falls inside it.
  const from = fromIso ? Date.parse(fromIso) : null;
  const to = toIso ? Date.parse(toIso) : null;
  const shown = events.filter((event) => (from === null || Date.parse(event.at) >= from) && (to === null || Date.parse(event.at) <= to));
  if (shown.length === 0) return "";
  events = shown;

  const times = events.map((event) => Date.parse(event.at)).filter(Number.isFinite);
  const first = new Date(Math.min(...times));
  const start = from ?? Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
  const end = to ?? Math.max(now.getTime(), ...times);
  const x = (t: number): number => left + ((t - start) / Math.max(1, end - start)) * (right - left);

  // Ticks: per month for the whole period, per week (with the day) for a short period.
  let ticks = "";
  const tick = (t: number, label: string): void => {
    const tx = x(t);
    ticks += `<line class="tlTick" x1="${n(tx)}" y1="${base}" x2="${n(tx)}" y2="${base + 10}"/>`;
    ticks += `<text class="tlMonth" x="${n(tx + 4)}" y="${base + 30}">${esc(label)}</text>`;
  };
  if (end - start <= 62 * 86_400_000) {
    for (let t = start; t <= end - 3 * 86_400_000; t += 7 * 86_400_000) tick(t, DAY.format(new Date(t)));
  } else {
    for (let m = new Date(start); m.getTime() <= end; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
      tick(m.getTime(), MONTH.format(m));
    }
  }

  // Dots, stacked per day. Suspicious ones go at the bottom of the stack, so they are never hidden
  // under "+N" on a busy day.
  const order: Record<Level, number> = { normal: 0, suspect: 1, alarm: 2 };
  const perDay = new Map<string, TimelineEvent[]>();
  for (const event of events) perDay.set(event.at.slice(0, 10), [...(perDay.get(event.at.slice(0, 10)) ?? []), event]);
  let dots = "";
  for (const [day, list] of perDay) {
    const dx = x(Date.parse(`${day}T12:00:00Z`));
    const sorted = [...list].sort((a, b) => order[b.level] - order[a.level]);
    sorted.slice(0, maxStack).forEach((event, i) => {
      dots += `<circle class="tlDot tl-${event.level}" cx="${n(dx)}" cy="${n(base - 12 - i * step)}" r="${dot}">` +
        `<title>${esc(`${villageTime(event.at)} · ${event.register}: ${event.recordLabel} · ${event.what} · ${event.by}`)}</title></circle>`;
    });
    if (sorted.length > maxStack) {
      dots += `<text class="tlMore" x="${n(dx)}" y="${n(base - 12 - maxStack * step)}">+${sorted.length - maxStack}</text>`;
    }
  }

  // The biggest suspicious moment gets a label, so the eye goes there first.
  const summary = summarize(events);
  let marker = "";
  if (summary.biggest && summary.biggest.count > 1) {
    const mx = x(Date.parse(`${summary.biggest.at.slice(0, 10)}T12:00:00Z`)); // on its day's stack
    marker = `<line class="tlMarker" x1="${n(mx)}" y1="40" x2="${n(mx)}" y2="${base}"/>` +
      `<text class="tlMarkerText" x="${n(mx)}" y="30" text-anchor="${mx > width / 2 ? "end" : "start"}">${esc(`${villageTime(summary.biggest.at)} · ${summary.biggest.count}× in één minuut`)}</text>`;
  }

  const legend = ([["normal", texts.normal], ["suspect", texts.suspect], ["alarm", texts.alarm]] as const)
    .map(([level, label], i) => `<circle class="tlDot tl-${level}" cx="${left + 8 + i * 260}" cy="${height - 18}" r="${dot}"/>` +
      `<text class="tlLegend" x="${left + 22 + i * 260}" y="${height - 13}">${esc(label)}</text>`)
    .join("");

  const nowX = x(Math.min(now.getTime(), end));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(texts.title)}">` +
    `<line class="tlAxis" x1="${left}" y1="${base}" x2="${right}" y2="${base}"/>${ticks}` +
    `<line class="tlNow" x1="${n(nowX)}" y1="50" x2="${n(nowX)}" y2="${base}"/><text class="tlNowText" x="${n(nowX - 4)}" y="62" text-anchor="end">${esc(texts.now)}</text>` +
    marker + dots + legend + `</svg>`;
}
