import Log from "sap/base/Log";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import type Button from "sap/m/Button";
import type { Button$PressEvent } from "sap/m/Button";
import type Dialog from "sap/m/Dialog";
import Fragment from "sap/ui/core/Fragment";
import Controller from "sap/ui/core/mvc/Controller";
import type ResourceBundle from "sap/base/i18n/ResourceBundle";
import type ResourceModel from "sap/ui/model/resource/ResourceModel";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import JSONModel from "sap/ui/model/json/JSONModel";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import Sorter from "sap/ui/model/Sorter";
import type ObjectIdentifier from "sap/m/ObjectIdentifier";
import type Link from "sap/m/Link";
import { dateTime, ruleIcon } from "../model/formatter";
import { buildTimelineSvg, monthKey, summarize, villageTime, type Level, type TimelineEvent } from "../model/timeline";

/** Text from the i18n bundle; the key itself when it is missing. */
function t(bundle: ResourceBundle, key: string, args?: unknown[]): string {
  return bundle.getText(key, args) ?? key;
}

/** One finding, as `findings()` sends it. */
interface FindingData {
  entityName: string;
  register: string;
  recordID: string;
  recordLabel: string;
  rule: string;
  explanation: string;
  changedBy: string;
  changedAt: string | null;
  untrusted: boolean;
  mark_ID: string | null;
  markReason: string | null;
}

/** One moment, as `events()` sends it. */
interface EventData {
  at: string;
  changedBy: string;
  recordCount: number;
  records: string;
  summary: string;
}

interface LedgerCheckData {
  intact: boolean;
  pages: number;
  brokenAtSeq: number | null;
  message: string;
}

/** One page of the sealed ledger. */
interface PageData {
  seq: number;
  at: string;
  entityName: string;
  recordID: string | null;
  recordLabel: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  outsideApps: boolean;
}

/** One followed record, as `records()` sends it. */
/** Writers that are not a person, or no name at all: red on the timeline (Ilse's own words). */
const ALARM_USERS = new Set(["system", "admin", "root", "service", "sys", "cron", "batch", "anonymous", "unknown", "", "?"]);

/** 00:00 up to 04:00 village time (UTC): "dan werkt hier niemand". */
function isNight(iso: string): boolean {
  const hour = new Date(iso).getUTCHours();
  return Number.isFinite(hour) && hour < 4;
}

/** Checks about values that simply cannot be right ("dingen die gewoon niet kunnen kloppen"). */
const IMPOSSIBLE_RULES = new Set(["sourcesDisagree", "overCapacity", "impossibleValue", "futureDate", "beforeRegister"]);

/** An event on the timeline, as the list shows it, with the kinds of suspicion Ilse filters on. */
interface TimelineRow extends TimelineEvent {
  time: string;
  month: string;
  byText: string;
  night: boolean;
  noPerson: boolean;
  impossible: boolean;
}

type TimelineCategory = "all" | "suspect" | "night" | "noPerson" | "impossible";
type TimelinePeriod = "all" | "recent" | "midNovember" | "custom";

const DAY_MS = 86_400_000;

interface RecordInfoData {
  entityName: string;
  register: string;
  recordID: string;
  recordLabel: string;
  summary: string;
  changedBy: string;
  changedAt: string | null;
  createdBy: string;
  createdAt: string | null;
  pages: number;
}

/** A record in the tab "Alle records". */
interface AllRecordRow extends RecordInfoData {
  changedText: string;
  historyText: string;
  state: string;
  stateText: string;
  stateIcon: string;
  untrusted: boolean;
  reasons: Reason[];
}

/** A page as the book shows it. */
interface BookPage extends PageData {
  registerName: string;
  fieldText: string;
  changeText: string;
  byText: string;
  isRecord: boolean;
  isNew: boolean;
}

/** Field names as Ilse would say them, per register. */
const FIELD_NAMES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  WaterPipes: {
    pipeID: "leidingnummer", location: "ligging", startPoint: "beginpunt", endPoint: "eindpunt",
    pipelineType: "soort leiding", diameter: "diameter (mm)", length: "lengte (m)",
    nominalFlowRate: "maximale doorstroming (L/min)", currentFlowRate: "doorstroming (L/min)",
    currentPressure: "druk (PSI)", lastMaintenance: "laatste onderhoud", mapPath: "plaats op de kaart",
  },
  Sensors: { pipe_ID: "leiding", sensorID: "sensornummer", flowRate: "gemeten doorstroming (L/min)", pressure: "gemeten druk (PSI)" },
  Repairs: { pipe_ID: "leiding", issue: "omschrijving", repairDate: "datum van de reparatie", repairedBy: "hersteld door" },
  StockItems: {
    itemID: "artikelcode", name: "naam", unit: "eenheid", currentQuantity: "voorraad",
    minStockLevel: "minimum", consumptionRate: "dagverbruik",
  },
  Landmarks: { name: "naam", kind: "soort", gridCell: "vak op de kaart", suppliedBy: "krijgt water van" },
};

/** User names as people: "maren.holt" → "Maren Holt". */
const PEOPLE: Readonly<Record<string, string>> = {
  "maren.holt": "Maren Holt",
  "tobin.reyes": "Tobin Reyes",
  "rowan.ashby": "Rowan Ashby",
  "ilse.vermeer": "Ilse Vermeer",
  council: "De dorpsraad",
  "ilse.ledger": "Het grootboek zelf",
  system: "Systeemaccount 'system'",
  anonymous: "Zonder naam",
  "?": "Onbekend",
};

export function personName(user: string | null | undefined): string {
  if (!user) return "Onbekend";
  return PEOPLE[user] ?? user;
}

/** "2026-08-20T09:00:00.000Z" → "20 aug 2026, 09:00:00"; anything else unchanged. */
function readableValue(value: string | null): string {
  if (value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return dateTime(value) || value;
  return value ?? "";
}

/** How many pages the book shows at once. */
const BOOK_SPREAD = 20;

/** Ilse's own actions in the ledger are not news to her. */
const OWN_USERS = new Set(["ilse.vermeer", "ilse.ledger"]);

/** Register names as Ilse knows them (same as the server). */
const REGISTER_NAMES: Readonly<Record<string, string>> = {
  WaterPipes: "Waterleidingen",
  Sensors: "Sensoren",
  Repairs: "Reparaties",
  StockItems: "Voorraad",
  Landmarks: "Plaatsen",
};

/** Where this browser remembers Ilse's last check (a convenience: the ledger itself is on the server). */
const LAST_SEEN_KEY = "ilse.ledger.lastSeen";

/** The ledger syncs every 15 s; the page looks every minute, like Morning Round. */
const AUTO_REFRESH_MS = 60_000;

function readLastSeen(): string | null {
  try {
    return (globalThis as unknown as { localStorage: { getItem(key: string): string | null } }).localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

function writeLastSeen(iso: string): void {
  try {
    (globalThis as unknown as { localStorage: { setItem(key: string, value: string): void } }).localStorage.setItem(LAST_SEEN_KEY, iso);
  } catch {
    // No storage (private mode): the strip simply starts over next visit.
  }
}

interface MarkData {
  ID: string;
  markedBy: string | null;
  createdAt: string | null;
}

/** Not suspicion but a question for the register's owner (same list as the server's ASK_RULES). */
const ASK_RULES = new Set(["otherRegister"]);

interface Reason {
  state: string;
  rule: string;
  ruleText: string;
  icon: string;
  explanation: string;
}

/** One suspicious record with all the checks it breaks: one row, one mark. */
interface RecordRow {
  key: string;
  entityName: string;
  register: string;
  recordID: string;
  recordLabel: string;
  changedText: string;
  reasons: Reason[];
  askOnly: boolean;
  untrusted: boolean;
  markID: string | null;
  markReasonText: string;
  markedText: string;
}

/**
 * The one page of Ilse's Ledger. Findings, moments and the seal check come from the OData
 * functions of LedgerService; this controller groups the findings per record (Ilse marks a
 * record, not a single check) and keeps them in the "ledger" view model. The sealed ledger
 * table is bound straight to `/LedgerEntries`.
 *
 * @namespace ilse.ledger.controller
 */
export default class Main extends Controller {
  private markDialog?: Dialog;
  private bundle?: ResourceBundle;
  private refreshTimer?: ReturnType<typeof setInterval>;

  public onInit(): void {
    this.getView()?.setModel(
      new JSONModel({
        busy: true,
        records: [],
        askRecords: [],
        allRecords: [],
        allView: [],
        allSearch: "",
        allRegister: "",
        dossier: [],
        moments: [],
        summary: { suspect: "", marked: "", ask: "" },
        seal: { title: "", message: "", state: "None", strip: "Information", icon: "" },
        mark: { title: "", entityName: "", recordID: "", recordLabel: "", reasons: [], reason: "" },
        lastSeen: readLastSeen(),
        tab: "timeline",
        timeline: {
          all: [], view: [], svg: "", svgRecent: "", began: "", pace: "", biggest: "",
          category: "all", period: "all", fromDate: null, toDate: null, counts: {}, periodText: "",
        },
        book: {
          pages: [], view: [], start: -1, register: "", search: "", outsideOnly: false, newOnly: false,
          recordID: "", recordText: "", registers: [], position: "", hasPrev: false, hasNext: false, goto: "",
        },
        since: { text: "", type: "Information", hasNews: false },
      }),
      "ledger",
    );
    void this.load();
    this.refreshTimer = setInterval(() => void this.load(), AUTO_REFRESH_MS);
  }

  public onExit(): void {
    this.markDialog?.destroy();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  /** "Alles gezien": from now on, only what comes after this moment is new. */
  public onSeen(): void {
    const now = new Date().toISOString();
    writeLastSeen(now);
    this.getLedgerModel().setProperty("/lastSeen", now);
    void this.load();
  }

  /* ------------------------------ All records ------------------------------ */

  public onAllFilter(): void {
    const model = this.getLedgerModel();
    const search = String(model.getProperty("/allSearch") ?? "").trim().toLowerCase();
    const register = String(model.getProperty("/allRegister") ?? "");
    model.setProperty("/allView", (model.getProperty("/allRecords") as AllRecordRow[]).filter((row) =>
      (!register || row.entityName === register) &&
      (!search || `${row.recordLabel} ${row.summary}`.toLowerCase().includes(search))));
  }

  /** "Alle records": open the history of a record in the ledger. */
  public onAllHistory(event: { getSource(): unknown }): void {
    const row = (event.getSource() as ObjectIdentifier).getBindingContext("ledger")?.getObject() as AllRecordRow | undefined;
    if (row) void this.showHistory(row.recordID, row.recordLabel, row.register);
  }

  private async loadAllRecords(bundle: ResourceBundle, findings: readonly RecordRow[]): Promise<void> {
    const byKey = new Map(findings.map((row) => [row.key, row]));
    const rows = (await this.getODataModel().bindList("/records()").requestContexts(0, 100000)).map((context) => {
      const info = context.getObject() as RecordInfoData;
      const finding = byKey.get(`${info.entityName}|${info.recordID}`);
      const untrusted = Boolean(finding?.untrusted);
      const suspect = Boolean(finding && !finding.askOnly);
      const ask = Boolean(finding?.askOnly);
      return {
        ...info,
        changedText: info.changedAt ? t(bundle, "lastChange", [dateTime(info.changedAt), personName(info.changedBy)]) : "",
        historyText: info.pages === 0 ? t(bundle, "allUnchanged") : t(bundle, "allChanged", [info.pages]),
        untrusted,
        reasons: finding?.reasons ?? [],
        state: untrusted ? "Error" : suspect ? "Warning" : ask ? "Information" : "Success",
        stateText: t(bundle, untrusted ? "untrusted" : suspect ? "allSuspect" : ask ? "allAsk" : "allOk"),
        stateIcon: untrusted ? "sap-icon://ti/flag-3" : suspect ? "sap-icon://ti/alert-triangle"
          : ask ? "sap-icon://ti/arrows-exchange" : "sap-icon://ti/circle-check",
      } satisfies AllRecordRow;
    });
    const model = this.getLedgerModel();
    model.setProperty("/allRecords", rows);
    this.onAllFilter();
    this.loadTimeline(bundle, rows, byKey);
  }

  /* ------------------------------ The timeline ------------------------------ */

  /** Any filter changed: what kind of suspicion, and which period. */
  public onTimelineFilter(): void {
    if (this.bundle) this.renderTimeline(this.bundle);
  }

  /** The period as [from, to] in village time (UTC); null = open. */
  private timelinePeriod(): [string | null, string | null] {
    const model = this.getLedgerModel();
    const period = model.getProperty("/timeline/period") as TimelinePeriod;
    const now = new Date();
    if (period === "recent") return [new Date(now.getTime() - 30 * DAY_MS).toISOString(), null];
    if (period === "midNovember") {
      // Ilse: "zeker rond midden november" — 10 to 20 November of this year.
      const year = now.getUTCFullYear();
      return [new Date(Date.UTC(year, 10, 10)).toISOString(), new Date(Date.UTC(year, 10, 20, 23, 59, 59)).toISOString()];
    }
    if (period === "custom") {
      const from = model.getProperty("/timeline/fromDate") as Date | null;
      const to = model.getProperty("/timeline/toDate") as Date | null;
      // The picker gives local midnight; read the chosen calendar days as village days.
      const day = (date: Date | null, end: boolean): string | null => date
        ? new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), end ? 23 : 0, end ? 59 : 0, end ? 59 : 0)).toISOString()
        : null;
      return [day(from, false), day(to ?? from, true)];
    }
    return [null, null];
  }

  /** Applies the filters to the list, the two time axes and the answers on top. */
  private renderTimeline(bundle: ResourceBundle): void {
    const model = this.getLedgerModel();
    const all = (model.getProperty("/timeline/all") as TimelineRow[] | null) ?? [];
    const category = model.getProperty("/timeline/category") as TimelineCategory;
    const [from, to] = this.timelinePeriod();
    const inPeriod = (row: TimelineRow): boolean => (!from || row.at >= from) && (!to || row.at <= to);
    const ofKind: Record<TimelineCategory, (row: TimelineRow) => boolean> = {
      all: () => true,
      suspect: (row) => row.level !== "normal",
      night: (row) => row.night,
      noPerson: (row) => row.noPerson,
      impossible: (row) => row.impossible,
    };
    const periodRows = all.filter(inPeriod);
    model.setProperty("/timeline/counts", Object.fromEntries(
      (Object.keys(ofKind) as TimelineCategory[]).map((key) => [key, periodRows.filter(ofKind[key]).length])));
    const rows = periodRows.filter(ofKind[category]);
    model.setProperty("/timeline/view", rows);
    model.setProperty("/timeline/periodText", from || to
      ? t(bundle, "tlPeriodShown", [from ? villageTime(from).slice(0, 10) : "…", to ? villageTime(to).slice(0, 10) : t(bundle, "tlNow")])
      : "");

    const texts = {
      title: t(bundle, "tlTitle"), normal: t(bundle, "tlNormal"), suspect: t(bundle, "tlSuspect"), alarm: t(bundle, "tlAlarm"), now: t(bundle, "tlNow"),
    };
    const now = new Date();
    const chart = (svg: string): string => (svg ? `<div class="ilseTimeline">${svg}</div>` : `<div class="ilseTimeline"></div>`);
    model.setProperty("/timeline/svg", chart(buildTimelineSvg(rows, now, texts, from ?? undefined, to ?? undefined)));
    // The close-up of the last 30 days only adds something when the whole period is shown.
    model.setProperty("/timeline/svgRecent", from || to ? "" : chart(buildTimelineSvg(rows, now, texts, new Date(now.getTime() - 30 * DAY_MS).toISOString())));

    const summary = summarize(rows.map((row) => ({ ...row, by: row.byText })));
    const first = summary.first;
    model.setProperty("/timeline/began", first
      ? t(bundle, "tlBegan", [villageTime(first.at), first.register, first.recordLabel, first.what.toLowerCase(), first.by])
      : t(bundle, "tlBeganNone"));
    model.setProperty("/timeline/pace", !first || !summary.last ? "" : summary.days === 1
      ? t(bundle, "tlOneDay", [summary.suspectCount, villageTime(first.at).slice(0, 10)])
      : t(bundle, "tlPace", [summary.suspectCount, summary.days, villageTime(first.at).slice(0, 10), villageTime(summary.last.at).slice(0, 10)]));
    model.setProperty("/timeline/biggest", summary.biggest && summary.biggest.count > 1
      ? t(bundle, "tlBiggest", [villageTime(summary.biggest.at), summary.biggest.count, summary.biggest.by, summary.biggest.registers])
      : "");
  }

  public onTimelineRecord(event: { getSource(): unknown }): void {
    const row = (event.getSource() as Link).getBindingContext("ledger")?.getObject() as TimelineRow | undefined;
    if (row?.recordID) void this.showHistory(row.recordID, row.recordLabel, row.register);
  }

  /**
   * Every write on one time axis. Before the seal the registers only know "aangemaakt" and "laatst
   * gewijzigd" per record; after the seal the ledger knows every change, so those pages are used.
   */
  private loadTimeline(bundle: ResourceBundle, records: readonly AllRecordRow[], findings: ReadonlyMap<string, RecordRow>): void {
    const model = this.getLedgerModel();
    const pages = model.getProperty("/book/pages") as BookPage[];
    const sealAt = pages.find((page) => page.field === "(verzegeling)")?.at ?? null;
    const events: TimelineEvent[] = [];
    const levelOf = (user: string, at: string, outside: boolean, suspect: boolean): Level =>
      outside || ALARM_USERS.has(user) || isNight(at) ? "alarm" : suspect ? "suspect" : "normal";

    for (const record of records) {
      const finding = findings.get(`${record.entityName}|${record.recordID}`);
      const suspect = Boolean(finding && !finding.askOnly);
      const reasons = suspect ? (finding?.reasons ?? []).filter((r) => r.state !== "Information").map((r) => r.ruleText).join(", ") : "";
      const impossible = (finding?.reasons ?? []).some((r) => IMPOSSIBLE_RULES.has(r.rule));
      const touches = [{ at: record.createdAt, by: record.createdBy, what: t(bundle, "tlCreated") }];
      if (record.changedAt && record.changedAt !== record.createdAt) {
        touches.push({ at: record.changedAt, by: record.changedBy, what: t(bundle, "tlModified") });
      }
      touches.forEach((touch, index) => {
        if (!touch.at || (sealAt && touch.at >= sealAt)) return; // after the seal: the ledger pages tell it
        const latest = index === touches.length - 1;
        const level = levelOf(touch.by, touch.at, false, suspect && latest);
        events.push({
          at: touch.at, what: touch.what, entityName: record.entityName, register: record.register,
          recordID: record.recordID, recordLabel: record.recordLabel, by: touch.by,
          level, reasons: level !== "normal" ? reasons : "",
          // The impossible value is in the record now: it came with its last write.
          impossible: impossible && latest,
        } as TimelineEvent & { impossible: boolean });
      });
    }

    // After the seal: one event per record per moment the ledger wrote pages (Ilse's own marks left out).
    const grouped = new Map<string, BookPage[]>();
    for (const page of pages) {
      if (!page.recordID || OWN_USERS.has(page.changedBy) || (sealAt && page.at < sealAt)) continue;
      const key = `${page.at}|${page.recordID}`;
      grouped.set(key, [...(grouped.get(key) ?? []), page]);
    }
    for (const group of grouped.values()) {
      const page = group[0];
      const finding = findings.get(`${page.entityName}|${page.recordID ?? ""}`);
      const suspect = Boolean(finding && !finding.askOnly);
      events.push({
        at: page.at,
        what: group.map((p) => (p.field.startsWith("(") ? p.changeText : `${p.fieldText}: ${p.changeText}`)).join(" · "),
        entityName: page.entityName, register: page.registerName, recordID: page.recordID ?? "", recordLabel: page.recordLabel,
        by: page.changedBy,
        level: levelOf(page.changedBy, page.at, group.some((p) => p.outsideApps), suspect),
        reasons: "",
        outside: group.some((p) => p.outsideApps),
      } as TimelineEvent & { outside: boolean });
    }

    events.sort((a, b) => a.at.localeCompare(b.at));
    const rows: TimelineRow[] = events.map((event) => {
      const extra = event as TimelineEvent & { impossible?: boolean; outside?: boolean };
      return {
        ...event, time: villageTime(event.at), month: monthKey(event.at), byText: personName(event.by),
        night: isNight(event.at),
        noPerson: ALARM_USERS.has(event.by) || Boolean(extra.outside),
        impossible: Boolean(extra.impossible),
      };
    });
    model.setProperty("/timeline/all", rows);
    this.renderTimeline(bundle);
  }

  /* ------------------------------ Browsing the ledger ------------------------------ */

  public onBookFilter(): void {
    this.getLedgerModel().setProperty("/book/start", -1); // a new selection opens at its last pages
    this.renderBook();
  }

  public onBookFirst(): void {
    this.getLedgerModel().setProperty("/book/start", 0);
    this.renderBook();
  }

  public onBookPrev(): void {
    const model = this.getLedgerModel();
    model.setProperty("/book/start", Math.max(0, (model.getProperty("/book/start") as number) - BOOK_SPREAD));
    this.renderBook();
  }

  public onBookNext(): void {
    const model = this.getLedgerModel();
    model.setProperty("/book/start", (model.getProperty("/book/start") as number) + BOOK_SPREAD);
    this.renderBook();
  }

  public onBookLast(): void {
    this.getLedgerModel().setProperty("/book/start", -1);
    this.renderBook();
  }

  /** "Ga naar blz. 37": opens the spread that holds page 37 (or the first page after it). */
  public onBookGoto(): void {
    const model = this.getLedgerModel();
    const wanted = Number(model.getProperty("/book/goto"));
    if (!Number.isFinite(wanted)) return;
    const pages = this.filteredPages();
    let index = pages.findIndex((page) => page.seq >= wanted);
    if (index < 0) index = pages.length - 1;
    model.setProperty("/book/start", Math.max(0, Math.floor(index / BOOK_SPREAD) * BOOK_SPREAD));
    this.renderBook();
  }

  /** Click a record in the book: browse only its pages. */
  public onBookShowRecord(event: { getSource(): unknown }): void {
    const page = (event.getSource() as Link).getBindingContext("ledger")?.getObject() as BookPage | undefined;
    if (page?.recordID) void this.showHistory(page.recordID, page.recordLabel, page.registerName);
  }

  /** Click a suspicious record: open its history in the ledger. */
  public onShowHistory(event: { getSource(): unknown }): void {
    const row = (event.getSource() as ObjectIdentifier).getBindingContext("ledger")?.getObject() as RecordRow | undefined;
    if (row) void this.showHistory(row.recordID, row.recordLabel, row.register);
  }

  public onBookClearRecord(): void {
    const model = this.getLedgerModel();
    model.setProperty("/book/recordID", "");
    model.setProperty("/book/recordText", "");
    this.onBookFilter();
  }

  private async showHistory(recordID: string, label: string, register: string): Promise<void> {
    const model = this.getLedgerModel();
    model.setProperty("/book/recordID", recordID);
    model.setProperty("/book/recordText", t(await this.getBundle(), "bookRecord", [label, register]));
    model.setProperty("/book/register", "");
    model.setProperty("/book/search", "");
    model.setProperty("/book/outsideOnly", false);
    model.setProperty("/book/newOnly", false);
    model.setProperty("/tab", "ledger");
    this.onBookFilter();
  }

  /** The pages that match the filters, oldest first (like a book). */
  private filteredPages(): BookPage[] {
    const book = this.getLedgerModel().getProperty("/book") as {
      pages: BookPage[]; register: string; search: string; outsideOnly: boolean; newOnly: boolean; recordID: string;
    };
    const search = book.search.trim().toLowerCase();
    return book.pages.filter((page) =>
      (!book.recordID || page.recordID === book.recordID) &&
      (!book.register || (book.register === "-" ? !page.entityName : page.entityName === book.register)) &&
      (!search || page.recordLabel.toLowerCase().includes(search)) &&
      (!book.outsideOnly || page.outsideApps) &&
      (!book.newOnly || page.isNew));
  }

  /** Shows one spread of 20 pages; start -1 means "the last pages". */
  private renderBook(): void {
    const model = this.getLedgerModel();
    const bundle = this.bundle;
    const pages = this.filteredPages();
    const total = (model.getProperty("/book/pages") as BookPage[]).length;
    const lastStart = Math.max(0, Math.floor((pages.length - 1) / BOOK_SPREAD) * BOOK_SPREAD);
    let start = model.getProperty("/book/start") as number;
    if (start < 0 || start > lastStart) start = lastStart;
    const view = pages.slice(start, start + BOOK_SPREAD);
    model.setProperty("/book/start", start);
    model.setProperty("/book/view", view);
    model.setProperty("/book/hasPrev", start > 0);
    model.setProperty("/book/hasNext", start + BOOK_SPREAD < pages.length);
    const filtered = pages.length !== total;
    model.setProperty("/book/position", !bundle ? "" : view.length === 0 ? t(bundle, "bookEmpty") : t(bundle,
      filtered ? "bookPositionFiltered" : "bookPosition",
      [view[0].seq, view[view.length - 1].seq, filtered ? pages.length : total]));
  }

  /** Reads the whole ledger (oldest first) for the book. */
  private async loadBook(bundle: ResourceBundle): Promise<void> {
    const model = this.getLedgerModel();
    const lastSeen = model.getProperty("/lastSeen") as string | null;
    const empty = t(bundle, "empty");
    const pages = (
      await this.getODataModel().bindList("/LedgerEntries", undefined, [new Sorter("seq")]).requestContexts(0, 100000)
    ).map((context) => {
      const page = context.getObject() as PageData;
      const oldValue = readableValue(page.oldValue);
      const newValue = readableValue(page.newValue);
      // Pages the ledger writes about itself or about a whole record: a sentence, not "was → werd".
      const special: Record<string, [string, string]> = {
        "(verzegeling)": [t(bundle, "pageSeal"), newValue],
        "(nieuw record)": [t(bundle, "pageNew"), t(bundle, "pageNewText", [newValue])],
        "(record verwijderd)": [t(bundle, "pageDeleted"), t(bundle, "pageDeletedText", [oldValue])],
        "(gemarkeerd: niet te vertrouwen)": [t(bundle, "pageMarked"), t(bundle, "pageMarkedText", [newValue])],
        "(markering opgeheven)": [t(bundle, "pageCleared"), t(bundle, "pageClearedText", [oldValue])],
      };
      const [fieldText, changeText] = special[page.field] ?? [
        FIELD_NAMES[page.entityName]?.[page.field] ?? page.field,
        t(bundle, "change", [oldValue || empty, newValue || empty]),
      ];
      return {
        ...page,
        registerName: REGISTER_NAMES[page.entityName] ?? t(bundle, "pageLedger"),
        fieldText,
        changeText,
        byText: personName(page.changedBy),
        isRecord: Boolean(page.recordID),
        isNew: Boolean(lastSeen && page.at > lastSeen && !OWN_USERS.has(page.changedBy)),
      } satisfies BookPage;
    });
    model.setProperty("/book/pages", pages);
    model.setProperty("/book/registers", [
      { key: "", text: t(bundle, "bookAll") },
      ...Object.entries(REGISTER_NAMES).map(([key, text]) => ({ key, text })),
      { key: "-", text: t(bundle, "bookLedgerOnly") },
    ]);
    this.renderBook();
  }

  public onRefresh(): void {
    void this.load();
  }

  /** "40 → 999" for a ledger page; "(leeg)" for an empty side. */
  public formatChange(pattern: string, oldValue: string | null, newValue: string | null, empty: string): string {
    if (!pattern) return "";
    return pattern.replace("{0}", oldValue || empty).replace("{1}", newValue || empty);
  }

  public async onMark(event: Button$PressEvent): Promise<void> {
    const row = (event.getSource() as Button).getBindingContext("ledger")?.getObject() as RecordRow | undefined;
    if (!row) return;
    const bundle = await this.getBundle();
    this.getLedgerModel().setProperty("/mark", {
      title: t(bundle, "markTitle", [row.recordLabel]),
      entityName: row.entityName,
      recordID: row.recordID,
      recordLabel: row.recordLabel,
      reasons: row.reasons,
      reason: "",
    });
    const dialog = await this.getMarkDialog();
    dialog.open();
  }

  public onCancelMark(): void {
    this.markDialog?.close();
  }

  public async onSaveMark(): Promise<void> {
    const mark = this.getLedgerModel().getProperty("/mark") as {
      entityName: string;
      recordID: string;
      recordLabel: string;
      reason: string;
    };
    const binding = this.getODataModel().bindContext("/markUntrusted(...)");
    binding.setParameter("entityName", mark.entityName);
    binding.setParameter("recordID", mark.recordID);
    binding.setParameter("recordLabel", mark.recordLabel);
    binding.setParameter("reason", mark.reason);
    this.markDialog?.setBusy(true);
    try {
      await binding.invoke();
      this.markDialog?.close();
      MessageToast.show(t(await this.getBundle(), "markedToast", [mark.recordLabel]));
      await this.load();
    } catch (error) {
      Log.error("markUntrusted failed", String(error));
      MessageBox.error((error as Error).message);
    } finally {
      this.markDialog?.setBusy(false);
    }
  }

  public async onClearMark(event: Button$PressEvent): Promise<void> {
    const row = (event.getSource() as Button).getBindingContext("ledger")?.getObject() as RecordRow | undefined;
    if (!row?.markID) return;
    const bundle = await this.getBundle();
    MessageBox.confirm(t(bundle, "clearConfirm", [row.recordLabel]), {
      actions: [t(bundle, "clearButton"), MessageBox.Action.CANCEL],
      emphasizedAction: MessageBox.Action.CANCEL,
      onClose: (action: string | null) => {
        if (action === MessageBox.Action.CANCEL || !row.markID) return;
        void this.clearMark(row.markID, row.recordLabel);
      },
    });
  }

  public onPrint(): void {
    // The tsconfig has no DOM lib: describe the one browser function we use.
    (globalThis as unknown as { print(): void }).print();
  }

  private async clearMark(markID: string, label: string): Promise<void> {
    const binding = this.getODataModel().bindContext("/clearMark(...)");
    binding.setParameter("mark_ID", markID);
    try {
      await binding.invoke();
      MessageToast.show(t(await this.getBundle(), "clearedToast", [label]));
      await this.load();
    } catch (error) {
      Log.error("clearMark failed", String(error));
      MessageBox.error((error as Error).message);
    }
  }

  private async load(): Promise<void> {
    const ledgerModel = this.getLedgerModel();
    ledgerModel.setProperty("/busy", true);
    try {
      const model = this.getODataModel();
      const bundle = await this.getBundle();
      this.bundle = bundle;
      // findings() first: it brings the sealed ledger up to date before anything else is read.
      const findings = (await model.bindList("/findings()").requestContexts(0, 1000)).map(
        (context) => context.getObject() as FindingData,
      );
      const [events, check, marks] = await Promise.all([
        model.bindList("/events()").requestContexts(0, 200),
        model.bindContext("/verifyLedger()").getBoundContext()?.requestObject() as Promise<LedgerCheckData>,
        model
          .bindList("/TrustMarks", undefined, undefined, [new Filter("active", FilterOperator.EQ, true)])
          .requestContexts(0, 1000),
      ]);
      const markInfo = new Map(
        marks.map((context) => {
          const mark = context.getObject() as MarkData;
          return [mark.ID, mark];
        }),
      );

      const all = this.toRecords(findings, markInfo, bundle);
      // "Verdacht" holds real suspicion only; a record that is merely a question for the owner of its
      // register (e.g. Maren updating the stock) gets its own tab, so it never looks suspicious.
      const records = all.filter((row) => !row.askOnly);
      const askRecords = all.filter((row) => row.askOnly);
      ledgerModel.setProperty("/records", records);
      ledgerModel.setProperty("/askRecords", askRecords);
      ledgerModel.setProperty("/dossier", all.filter((row) => row.untrusted));
      ledgerModel.setProperty(
        "/moments",
        events.map((context) => {
          const moment = context.getObject() as EventData;
          return {
            ...moment,
            many: moment.recordCount > 1,
            countText: moment.recordCount > 1 ? t(bundle, "momentMany", [moment.recordCount]) : t(bundle, "momentOne"),
          };
        }),
      );
      ledgerModel.setProperty("/summary", {
        suspect: t(bundle, "summarySuspect", [records.length]),
        ask: t(bundle, "summaryAsk", [askRecords.length]),
        marked: t(bundle, "summaryMarked", [all.filter((row) => row.untrusted).length]),
      });
      ledgerModel.setProperty("/seal", {
        title: t(bundle, check.intact ? "sealIntact" : "sealBroken"),
        message: check.message,
        state: check.intact ? "Success" : "Error",
        strip: check.intact ? "Success" : "Error",
        icon: check.intact ? "sap-icon://ti/shield-check" : "sap-icon://ti/shield-x",
      });
      await this.loadSince(bundle);
      await this.loadBook(bundle);
      await this.loadAllRecords(bundle, all);
    } catch (error) {
      Log.error("loading the ledger failed", String(error));
      MessageBox.error(t(await this.getBundle(), "loadError"));
    } finally {
      ledgerModel.setProperty("/busy", false);
    }
  }

  /** The strip "since your last check": how many new pages, in which registers, how many outside the apps. */
  private async loadSince(bundle: ResourceBundle): Promise<void> {
    const ledgerModel = this.getLedgerModel();
    const lastSeen = ledgerModel.getProperty("/lastSeen") as string | null;
    if (!lastSeen) {
      // First visit: everything is new; from now on the strip counts what comes after.
      const now = new Date().toISOString();
      writeLastSeen(now);
      ledgerModel.setProperty("/lastSeen", now);
      ledgerModel.setProperty("/since", { text: t(bundle, "sinceFirst"), type: "Information", hasNews: false });
      return;
    }
    const pages = (
      await this.getODataModel()
        .bindList("/LedgerEntries", undefined, undefined, [new Filter("at", FilterOperator.GT, lastSeen)])
        .requestContexts(0, 1000)
    )
      .map((context) => context.getObject() as PageData)
      .filter((page) => !OWN_USERS.has(page.changedBy));
    if (pages.length === 0) {
      ledgerModel.setProperty("/since", { text: t(bundle, "sinceNothing", [dateTime(lastSeen)]), type: "Success", hasNews: false });
      return;
    }
    const registers = [...new Set(pages.map((page) => REGISTER_NAMES[page.entityName] ?? (page.entityName || "grootboek")))].join(", ");
    const outside = pages.filter((page) => page.outsideApps).length;
    const text = [
      t(bundle, "sinceNews", [pages.length, dateTime(lastSeen), registers]),
      outside > 0 ? t(bundle, "sinceOutside", [outside]) : "",
    ].filter(Boolean).join(" ");
    ledgerModel.setProperty("/since", { text, type: outside > 0 ? "Error" : "Warning", hasNews: true });
  }

  /** Findings → one row per record, in the order the server sent them (worst moment first). */
  private toRecords(findings: readonly FindingData[], marks: ReadonlyMap<string, MarkData>, bundle: ResourceBundle): RecordRow[] {
    const rows = new Map<string, RecordRow>();
    for (const finding of findings) {
      const key = `${finding.entityName}|${finding.recordID}`;
      let row = rows.get(key);
      if (!row) {
        const mark = finding.mark_ID ? marks.get(finding.mark_ID) : undefined;
        row = {
          key,
          entityName: finding.entityName,
          register: finding.register,
          recordID: finding.recordID,
          recordLabel: finding.recordLabel,
          changedText: finding.changedAt ? t(bundle, "lastChange", [dateTime(finding.changedAt), personName(finding.changedBy)]) : "",
          reasons: [],
          askOnly: true,
          untrusted: finding.untrusted,
          markID: finding.mark_ID,
          markReasonText: finding.markReason ? t(bundle, "markedReason", [finding.markReason]) : "",
          markedText: mark ? t(bundle, "dossierMarkedBy", [personName(mark.markedBy), dateTime(mark.createdAt)]) : "",
        };
        rows.set(key, row);
      }
      const ask = ASK_RULES.has(finding.rule);
      if (!ask) row.askOnly = false;
      row.reasons.push({
        state: ask ? "Information" : "Warning",
        rule: finding.rule,
        ruleText: t(bundle, `rule_${finding.rule}`),
        icon: ruleIcon(finding.rule),
        explanation: finding.explanation,
      });
    }
    return [...rows.values()];
  }

  private async getMarkDialog(): Promise<Dialog> {
    if (!this.markDialog) {
      const view = this.getView();
      if (!view) throw new Error("view not ready");
      this.markDialog = (await Fragment.load({
        id: view.getId(),
        name: "ilse.ledger.view.MarkDialog",
        controller: this,
      })) as Dialog;
      view.addDependent(this.markDialog);
    }
    return this.markDialog;
  }

  private getLedgerModel(): JSONModel {
    return this.getView()?.getModel("ledger") as JSONModel;
  }

  private getODataModel(): ODataModel {
    return this.getOwnerComponent()?.getModel() as ODataModel;
  }

  private async getBundle(): Promise<ResourceBundle> {
    const i18n = this.getOwnerComponent()?.getModel("i18n") as ResourceModel;
    return (await i18n.getResourceBundle()) as ResourceBundle;
  }
}
