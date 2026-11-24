import Log from "sap/base/Log";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import Controller from "sap/ui/core/mvc/Controller";
import DateFormat from "sap/ui/core/format/DateFormat";
import { ValueState } from "sap/ui/core/library";
import type ResourceBundle from "sap/base/i18n/ResourceBundle";
import type ResourceModel from "sap/ui/model/resource/ResourceModel";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import JSONModel from "sap/ui/model/json/JSONModel";
import Sorter from "sap/ui/model/Sorter";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import type Dialog from "sap/m/Dialog";
import { buildMapSvg } from "../model/villageMap";

/** Text from the i18n bundle; the key itself when it is missing. */
function t(bundle: ResourceBundle, key: string, args?: unknown[]): string {
  return bundle.getText(key, args) ?? key;
}

/** One part of the village, as `villageWeek()` sends it. */
interface AreaData {
  areaKey: string;
  name: string;
  kind: string;
  gridCell: string;
  status: string;
  pipeID: string;
  weakestPipeID: string;
  currentFlow: number;
  nominalFlow: number;
  flowPercent: number;
  households: number;
  waterNote: string;
  foodIssues: number;
  foodIssueNames: string;
}

/** One problem, as `villageWeek()` sends it. */
interface ProblemData {
  problemKey: string;
  kind: string;
  tier: number;
  status: string;
  refID: string;
  name: string;
  icon: string;
  currentFlow: number;
  nominalFlow: number;
  flowPercent: number;
  affectedAreas: string;
  affectedCount: number;
  households: number;
  roundRank: number;
  reportedBroken: boolean;
  note: string;
  currentQuantity: number;
  minStockLevel: number;
  unit: string;
  runOutDate: string | null;
  daysLeft: number;
  cost: number;
  untrusted: boolean;
  doubtKind: string;
  trustReason: string;
  planned: boolean;
  planStatus: string | null; // locked week: reserved | spent | new | ''
}

interface VillageWeekData {
  weekStart: string;
  budgetTotal: number;
  budgetPlanned: number;
  budgetLeft: number;
  locked: boolean;
  lockedAt: string | null;
  budgetSpent: number;
  budgetReserved: number;
  budgetFree: number;
  areas: AreaData[];
  problems: ProblemData[];
  pipes: Array<{ pipeID: string; status: string; mapPath: string }>;
}

/** One line of a plan, as `CouncilDecisions` sends it. */
interface DecisionData {
  ID: string;
  weekStart: string;
  problemKey: string;
  kind: string;
  title: string;
  cost: number;
  status: string; // reserved | spent | released
  spentAt: string | null;
  spentBy: string | null;
  note: string | null;
}

/** One entry of the plan's log. */
interface PlanLogData {
  at: string;
  action: string; // locked | changed | spent
  summary: string;
  reason: string | null;
}

/** A problem row of the page: the server data plus display texts; `planned` is the checkbox. */
interface ProblemRow extends ProblemData {
  rank: number;
  tierText: string;
  state: ValueState;
  stateIcon: string;
  why: string;
  doubt: string;
  actionText: string;
  planText: string;
  planState: ValueState;
  planIcon: string;
}

/** What a plan line's money is doing: text, state and icon. */
interface MoneyStatus {
  moneyText: string;
  moneyState: ValueState;
  moneyIcon: string;
}

const MONEY_ICON = {
  reserved: "sap-icon://ti/lock",
  spent: "sap-icon://ti/coins",
  released: "sap-icon://ti/arrow-back-up",
  new: "sap-icon://ti/bell",
  none: "sap-icon://ti/minus",
};

const STATE: Readonly<Record<string, ValueState>> = {
  ok: ValueState.Success,
  warning: ValueState.Warning,
  trouble: ValueState.Error,
  unknown: ValueState.None,
  repaired: ValueState.Information,
};
const STATE_ICON: Readonly<Record<string, string>> = {
  ok: "sap-icon://ti/circle-check",
  warning: "sap-icon://ti/alert-triangle",
  trouble: "sap-icon://ti/alert-octagon",
  unknown: "sap-icon://ti/question-mark",
  repaired: "sap-icon://ti/tool",
};
const AREA_TEXT: Readonly<Record<string, string>> = {
  ok: "areaOk",
  warning: "areaWarning",
  trouble: "areaTrouble",
  unknown: "areaUnknown",
  repaired: "areaRepaired",
};

const longDay = DateFormat.getDateInstance({ pattern: "EEEE d MMMM" });
const shortDay = DateFormat.getDateInstance({ pattern: "EEEE d MMM" });
const dateTime = DateFormat.getDateTimeInstance({ pattern: "EEEE d MMM, HH:mm" });

function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * The one page of The Council's Monday. Everything comes from the OData function `villageWeek()`
 * (srv/council-service.ts); this controller turns it into display rows with texts from i18n in the
 * "council" view model, keeps the budget up to date while the council ticks problems in or out,
 * and locks or changes the plan with the action `decide` (a change of a locked plan asks the reason).
 *
 * @namespace rowan.council.controller
 */
export default class Main extends Controller {
  /** Asks the reason of a change to a locked plan; destroyed in `onExit`. */
  private reasonDialog?: Dialog;

  public onInit(): void {
    const model = new JSONModel({
      busy: true,
      subtitle: "",
      generatedAt: "",
      weekStart: "",
      summary: [],
      problems: [],
      areas: [],
      mapSvg: "<div></div>",
      budget: {
        total: 0,
        spent: 0,
        reserved: 0,
        left: 0,
        percent: 0,
        barText: "",
        leftText: "",
        state: ValueState.None,
        unfunded: [],
      },
      locked: false,
      lockedText: "",
      editing: false,
      reason: "",
      planLines: [],
      planLog: [],
      decisions: [],
    });
    this.getView()?.setModel(model, "council");
    void this.load();
  }

  public onExit(): void {
    this.reasonDialog?.destroy();
  }

  public onRefresh(): void {
    void this.load();
  }

  /** The council ticked a problem in or out of the plan: the budget follows. */
  public async onTogglePlan(): Promise<void> {
    this.updateBudget(await this.getBundle());
  }

  /** Monday evening: lock the plan. All money in it is reserved from now on. */
  public async onSaveDecision(): Promise<void> {
    await this.sendPlan("", "decisionSaved");
  }

  /** A locked plan only changes on purpose: open it for changes (spent lines stay locked). */
  public onEditPlan(): void {
    this.getModel().setProperty("/editing", true);
  }

  public onCancelEdit(): void {
    this.getModel().setProperty("/editing", false);
    void this.load();
  }

  /** Save a change of a locked plan: first ask the reason, it goes into the plan's log. */
  public async onSaveChange(): Promise<void> {
    this.getModel().setProperty("/reason", "");
    this.reasonDialog ??= (await this.loadFragment({ name: "rowan.council.view.ReasonDialog" })) as Dialog;
    this.reasonDialog.open();
  }

  public onCancelReason(): void {
    this.reasonDialog?.close();
  }

  public async onConfirmChange(): Promise<void> {
    const reason = (this.getModel().getProperty("/reason") as string).trim();
    if (!reason) return;
    this.reasonDialog?.close();
    await this.sendPlan(reason, "changeSaved");
  }

  /** Sends the ticked plan to `decide`: locks it (no reason) or changes the locked plan (with a reason). */
  private async sendPlan(reason: string, toastKey: string): Promise<void> {
    const model = this.getModel();
    const bundle = await this.getBundle();
    const problems = model.getProperty("/problems") as ProblemRow[];
    const shownKeys = new Set(problems.map((problem) => problem.problemKey));
    // Lines of the plan that are no longer on the list (e.g. a pipe Maren repaired) stay as they are.
    const hidden = (model.getProperty("/planLines") as DecisionData[]).filter(
      (line) => line.status !== "released" && !shownKeys.has(line.problemKey),
    );
    const entries = [
      ...problems
        .filter((problem) => problem.planned)
        .map((problem) => ({ problemKey: problem.problemKey, kind: problem.kind, title: problem.name, cost: problem.cost })),
      ...hidden.map((line) => ({ problemKey: line.problemKey, kind: line.kind, title: line.title, cost: line.cost })),
    ];
    const binding = this.getODataModel().bindContext("/decide(...)");
    binding.setParameter("weekStart", model.getProperty("/weekStart") as string);
    binding.setParameter("entries", entries);
    binding.setParameter("reason", reason);
    model.setProperty("/busy", true);
    try {
      await binding.invoke();
      MessageToast.show(t(bundle, toastKey));
      model.setProperty("/editing", false);
      await this.load();
    } catch (error) {
      Log.error("decide failed", String(error));
      MessageBox.error((error as Error).message);
    } finally {
      model.setProperty("/busy", false);
    }
  }

  private async load(): Promise<void> {
    const model = this.getModel();
    model.setProperty("/busy", true);
    try {
      const bundle = await this.getBundle();
      const week = (await this.getODataModel().bindContext("/villageWeek()").requestObject()) as VillageWeekData;
      const decisions = await this.loadDecisions();
      const thisWeek = decisions.filter((decision) => decision.weekStart === week.weekStart);

      // The server knows the plan: the proposal before Monday's lock, the locked plan after it.
      const problems = week.problems.map((problem, index) => this.toProblemRow(problem, index + 1, bundle));
      model.setProperty("/weekStart", week.weekStart);
      model.setProperty("/subtitle", t(bundle, "pageSubtitle", [longDay.format(parseIsoDate(week.weekStart))]));
      model.setProperty("/locked", week.locked);
      model.setProperty(
        "/lockedText",
        week.locked && week.lockedAt ? t(bundle, "lockedAt", [dateTime.format(new Date(week.lockedAt))]) : "",
      );
      model.setProperty("/budget/total", week.budgetTotal);
      model.setProperty("/budget/spent", week.budgetSpent);
      model.setProperty("/problems", problems);
      model.setProperty("/planLines", thisWeek.map((line) => ({ ...line, ...this.moneyOf(line, bundle) })));
      model.setProperty("/planLog", await this.loadPlanLog(week.weekStart));
      model.setProperty("/areas", week.areas.map((area) => this.toAreaRow(area, bundle)));
      model.setProperty(
        "/mapSvg",
        buildMapSvg(sap.ui.require.toUrl("rowan/council/img/oakhaven-map.jpg"), week.areas, week.pipes, t(bundle, "mapAlt")),
      );
      const openKeys = new Set(week.problems.map((problem) => problem.problemKey));
      const repairedKeys = new Set(week.pipes.filter((pipe) => pipe.status === "repaired").map((pipe) => `water:${pipe.pipeID}`));
      model.setProperty(
        "/decisions",
        decisions
          .filter((decision) => decision.weekStart !== week.weekStart && decision.status !== "released")
          .map((decision) => this.toDecisionRow(decision, openKeys, repairedKeys, bundle)),
      );
      this.updateBudget(bundle);
      model.setProperty(
        "/generatedAt",
        t(bundle, "generatedAt", [DateFormat.getTimeInstance({ style: "short" }).format(new Date())]),
      );
    } catch (error) {
      Log.error("villageWeek failed", String(error));
      MessageBox.error(t(await this.getBundle(), "loadError"));
    } finally {
      model.setProperty("/busy", false);
    }
  }

  private async loadDecisions(): Promise<DecisionData[]> {
    const list = this.getODataModel().bindList("/CouncilDecisions", undefined, [new Sorter("weekStart", true), new Sorter("createdAt")]);
    const contexts = await list.requestContexts(0, 200);
    return contexts.map((context) => context.getObject() as DecisionData);
  }

  private async loadPlanLog(weekStart: string): Promise<Array<PlanLogData & { atText: string; icon: string }>> {
    const list = this.getODataModel().bindList("/CouncilPlanLog", undefined, [new Sorter("at", true)], [
      new Filter("weekStart", FilterOperator.EQ, weekStart),
    ]);
    const contexts = await list.requestContexts(0, 100);
    return contexts.map((context) => {
      const entry = context.getObject() as PlanLogData;
      const icon = entry.action === "spent" ? MONEY_ICON.spent : entry.action === "changed" ? "sap-icon://ti/pencil" : MONEY_ICON.reserved;
      return { ...entry, atText: dateTime.format(new Date(entry.at)), icon };
    });
  }

  /**
   * Budget bar, what is left and what does not fit. Also refreshes the summary.
   * - not locked: the ticked problems are the proposal;
   * - locked: spent money (work done) + reserved money (the ticked lines that are not spent yet, and
   *   plan lines no longer on the list) — while changing the plan, the ticks count.
   */
  private updateBudget(bundle: ResourceBundle): void {
    const model = this.getModel();
    const total = model.getProperty("/budget/total") as number;
    const locked = model.getProperty("/locked") as boolean;
    const problems = model.getProperty("/problems") as ProblemRow[];
    const shownKeys = new Set(problems.map((problem) => problem.problemKey));
    const lines = model.getProperty("/planLines") as DecisionData[];

    const spent = locked ? lines.filter((line) => line.status === "spent").reduce((sum, line) => sum + line.cost, 0) : 0;
    const hiddenReserved = locked
      ? lines.filter((line) => line.status === "reserved" && !shownKeys.has(line.problemKey)).reduce((sum, line) => sum + line.cost, 0)
      : 0;
    const reserved =
      hiddenReserved +
      problems.filter((problem) => problem.planned && problem.planStatus !== "spent").reduce((sum, problem) => sum + problem.cost, 0);
    const left = total - spent - reserved;
    const state = left < 0 ? ValueState.Error : left < total * 0.2 ? ValueState.Warning : ValueState.Success;
    const unfunded = problems
      .filter((problem) => !problem.planned)
      .map((problem) => ({
        text: t(bundle, problem.planStatus === "new" ? "unfundedNewLine" : "unfundedLine", [problem.name, problem.tierText, problem.cost]),
        icon: problem.planStatus === "new" ? MONEY_ICON.new : problem.icon,
      }));
    model.setProperty("/budget/spent", spent);
    model.setProperty("/budget/reserved", reserved);
    model.setProperty("/budget/left", left);
    model.setProperty("/budget/percent", total > 0 ? Math.min(100, Math.round(((spent + reserved) / total) * 100)) : 0);
    model.setProperty(
      "/budget/barText",
      locked ? t(bundle, "budgetBarLocked", [spent, reserved, Math.max(left, 0)]) : t(bundle, "budgetBar", [reserved, total]),
    );
    model.setProperty("/budget/leftText", left < 0 ? t(bundle, "budgetOver", [-left]) : t(bundle, "budgetLeft", [left]));
    model.setProperty("/budget/state", state);
    model.setProperty("/budget/unfunded", unfunded);
    this.updateSummary(bundle);
  }

  /** Reserved, spent or released: what the money of one plan line is doing. */
  private moneyOf(line: DecisionData, bundle: ResourceBundle): MoneyStatus {
    if (line.status === "spent") {
      const when = line.spentAt ? dateTime.format(new Date(line.spentAt)) : "";
      const key = line.kind === "food" ? "moneySpentFood" : "moneySpentWater";
      return { moneyText: t(bundle, key, [when, line.spentBy ?? "?"]), moneyState: ValueState.Success, moneyIcon: MONEY_ICON.spent };
    }
    if (line.status === "released") {
      return { moneyText: t(bundle, "moneyReleased", [line.note ?? ""]), moneyState: ValueState.None, moneyIcon: MONEY_ICON.released };
    }
    return { moneyText: t(bundle, "moneyReserved"), moneyState: ValueState.Information, moneyIcon: MONEY_ICON.reserved };
  }

  /** The few lines at the top: how many parts are not in order, what the plan costs, what is left out. */
  private updateSummary(bundle: ResourceBundle): void {
    const model = this.getModel();
    const areas = model.getProperty("/areas") as Array<{ status: string }>;
    const problems = model.getProperty("/problems") as ProblemRow[];
    const budget = model.getProperty("/budget") as { total: number; spent: number; reserved: number; left: number; unfunded: unknown[] };
    const planned = budget.spent + budget.reserved;
    const notOk = areas.filter((area) => area.status === "trouble" || area.status === "warning").length;

    const lines: Array<{ text: string; state: ValueState; icon: string }> = [];
    if (notOk === 0 && problems.length === 0) {
      lines.push({ text: t(bundle, "summaryAllGood"), state: ValueState.Success, icon: STATE_ICON.ok });
    } else {
      lines.push({
        text: t(bundle, "summaryAreas", [notOk, areas.length]),
        state: notOk > 0 ? ValueState.Error : ValueState.Success,
        icon: "sap-icon://ti/map-pin",
      });
      lines.push({
        text: t(bundle, "summaryProblems", [problems.length, planned, budget.total]),
        state: planned > budget.total ? ValueState.Error : ValueState.Information,
        icon: "sap-icon://ti/coins",
      });
      // Locked plan: what came up after Monday is not paid by itself — the council decides.
      const fresh = problems.filter((problem) => problem.planStatus === "new").length;
      if (fresh > 0) {
        lines.push({
          text: t(bundle, "summaryNew", [fresh, Math.max(budget.left, 0)]),
          state: ValueState.Warning,
          icon: MONEY_ICON.new,
        });
      }
      if (budget.unfunded.length > 0) {
        lines.push({ text: t(bundle, "summaryUnfunded", [budget.unfunded.length]), state: ValueState.Warning, icon: STATE_ICON.warning });
      }
      const doubts = problems.filter((problem) => problem.untrusted).length;
      if (doubts > 0) {
        lines.push({ text: t(bundle, "summaryDoubt", [doubts]), state: ValueState.Warning, icon: "sap-icon://ti/scale" });
      }
    }
    model.setProperty("/summary", lines);
  }

  private toProblemRow(problem: ProblemData, rank: number, bundle: ResourceBundle): ProblemRow {
    let why: string;
    if (problem.kind === "water") {
      // "North Residential Area (~140 gezinnen)" when Maren knows how many families live behind the pipe.
      const affected =
        problem.households > 0 && problem.affectedCount === 1
          ? t(bundle, "households", [problem.affectedAreas, problem.households])
          : problem.affectedAreas;
      const args = [affected, problem.currentFlow, problem.nominalFlow, problem.flowPercent];
      if (problem.reportedBroken) why = t(bundle, "waterReported", [problem.note, affected]);
      else if (problem.status === "unknown") why = t(bundle, "waterUnknown", [affected]);
      else why = t(bundle, problem.tier === 1 ? "waterNoWater" : problem.tier === 5 ? "waterNobody" : "waterLow", args);
    } else if (problem.runOutDate && problem.daysLeft === 0) {
      why = t(bundle, "foodToday", [problem.currentQuantity, problem.unit, problem.minStockLevel]);
    } else if (problem.runOutDate) {
      why = t(bundle, "foodRunsOut", [
        problem.currentQuantity,
        problem.unit,
        problem.minStockLevel,
        shortDay.format(parseIsoDate(problem.runOutDate)),
      ]);
    } else {
      why = t(bundle, "foodLow", [problem.currentQuantity, problem.unit, problem.minStockLevel]);
    }

    let doubt = "";
    switch (problem.doubtKind) {
      case "data":
        doubt = t(bundle, "doubtData", [problem.currentQuantity, problem.unit]);
        break;
      case "waterData":
        doubt = t(bundle, "doubtWaterData", [problem.trustReason]);
        break;
      case "noReading":
        doubt = t(bundle, "doubtNoReading");
        break;
      case "ilse":
        doubt = problem.trustReason ? t(bundle, "doubtIlse", [problem.trustReason]) : t(bundle, "doubtIlseNoReason");
        break;
      default:
        break;
    }

    // Locked plan: what the money of this problem is doing (reserved, spent, new since Monday, not in the plan).
    const planStatus = problem.planStatus ?? "";
    const plan =
      planStatus === "spent"
        ? { planText: t(bundle, "planSpent"), planState: ValueState.Success, planIcon: MONEY_ICON.spent }
        : planStatus === "reserved"
          ? { planText: t(bundle, "planReserved"), planState: ValueState.Information, planIcon: MONEY_ICON.reserved }
          : planStatus === "new"
            ? { planText: t(bundle, "planNew"), planState: ValueState.Warning, planIcon: MONEY_ICON.new }
            : { planText: t(bundle, "planNone"), planState: ValueState.None, planIcon: MONEY_ICON.none };

    const unknown = problem.status === "unknown";
    return {
      ...problem,
      ...plan,
      planStatus,
      rank,
      tierText: unknown ? t(bundle, "tierUnknown") : t(bundle, `tier${problem.tier}`),
      state: STATE[problem.status] ?? ValueState.None,
      stateIcon: unknown ? STATE_ICON.unknown : problem.kind === "water" ? "sap-icon://ti/droplet-off" : "sap-icon://ti/mood-sad",
      why,
      doubt,
      actionText: t(bundle, problem.kind === "food" ? "actionDelivery" : unknown ? "actionInspect" : "actionRepair"),
    };
  }

  private toAreaRow(area: AreaData, bundle: ResourceBundle): AreaData & { state: ValueState; stateIcon: string; stateText: string; reason: string } {
    const reasons: string[] = [];
    if (area.kind === "spring") {
      reasons.push(t(bundle, "areaReasonSource"));
    } else if (!area.pipeID) {
      reasons.push(t(bundle, "areaReasonUnknown"));
    } else if (area.waterNote) {
      reasons.push(t(bundle, "areaReasonMaren", [area.waterNote]));
    } else if (area.weakestPipeID && area.weakestPipeID !== area.pipeID) {
      reasons.push(t(bundle, "areaReasonWaterVia", [area.weakestPipeID, area.flowPercent, area.currentFlow, area.nominalFlow]));
    } else {
      reasons.push(t(bundle, "areaReasonWater", [area.flowPercent, area.currentFlow, area.nominalFlow]));
    }
    if (area.households > 0) reasons.push(t(bundle, "areaReasonHouseholds", [area.households]));
    if (area.foodIssues > 0) reasons.push(t(bundle, "areaReasonFood", [area.foodIssueNames]));
    return {
      ...area,
      state: STATE[area.status] ?? ValueState.None,
      stateIcon: STATE_ICON[area.status] ?? STATE_ICON.unknown,
      stateText: t(bundle, AREA_TEXT[area.status] ?? "areaUnknown"),
      reason: reasons.join(" "),
    };
  }

  /** A line of an earlier week: what the money did, and whether the problem is solved now. */
  private toDecisionRow(
    decision: DecisionData,
    openKeys: ReadonlySet<string>,
    repairedKeys: ReadonlySet<string>,
    bundle: ResourceBundle,
  ): DecisionData & MoneyStatus & { weekText: string; actionText: string; outcomeText: string; outcomeIcon: string; outcomeState: ValueState } {
    const still = openKeys.has(decision.problemKey);
    let outcome: { text: string; icon: string; state: ValueState };
    if (repairedKeys.has(decision.problemKey)) {
      outcome = { text: t(bundle, "outcomeRepaired"), icon: STATE_ICON.repaired, state: ValueState.Information };
    } else if (still) {
      outcome = { text: t(bundle, "outcomeStill"), icon: STATE_ICON.warning, state: ValueState.Warning };
    } else {
      outcome = { text: t(bundle, "outcomeSolved"), icon: STATE_ICON.ok, state: ValueState.Success };
    }
    return {
      ...decision,
      ...(decision.status === "reserved"
        ? { moneyText: t(bundle, "moneyNeverSpent"), moneyState: ValueState.None, moneyIcon: MONEY_ICON.released }
        : this.moneyOf(decision, bundle)),
      weekText: shortDay.format(parseIsoDate(decision.weekStart)),
      actionText: t(bundle, decision.kind === "water" ? "actionRepair" : "actionDelivery"),
      outcomeText: outcome.text,
      outcomeIcon: outcome.icon,
      outcomeState: outcome.state,
    };
  }

  private getModel(): JSONModel {
    return this.getView()?.getModel("council") as JSONModel;
  }

  private getODataModel(): ODataModel {
    return this.getOwnerComponent()?.getModel() as ODataModel;
  }

  private async getBundle(): Promise<ResourceBundle> {
    const model = this.getOwnerComponent()?.getModel("i18n") as ResourceModel;
    return await model.getResourceBundle();
  }
}
