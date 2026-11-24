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
}

interface VillageWeekData {
  weekStart: string;
  budgetTotal: number;
  budgetPlanned: number;
  budgetLeft: number;
  areas: AreaData[];
  problems: ProblemData[];
  pipes: Array<{ pipeID: string; status: string; mapPath: string }>;
}

interface DecisionData {
  weekStart: string;
  problemKey: string;
  kind: string;
  title: string;
  cost: number;
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
}

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

function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * The one page of The Council's Monday. Everything comes from the OData function `villageWeek()`
 * (srv/council-service.ts); this controller turns it into display rows with texts from i18n in the
 * "council" view model, keeps the budget up to date while the council ticks problems in or out,
 * and stores the plan with the action `decide`.
 *
 * @namespace rowan.council.controller
 */
export default class Main extends Controller {
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
      budget: { total: 0, planned: 0, left: 0, percent: 0, barText: "", leftText: "", state: ValueState.None, unfunded: [] },
      decisions: [],
    });
    this.getView()?.setModel(model, "council");
    void this.load();
  }

  public onRefresh(): void {
    void this.load();
  }

  /** The council ticked a problem in or out of the plan: the budget follows. */
  public async onTogglePlan(): Promise<void> {
    this.updateBudget(await this.getBundle());
  }

  public async onSaveDecision(): Promise<void> {
    const model = this.getModel();
    const bundle = await this.getBundle();
    const problems = model.getProperty("/problems") as ProblemRow[];
    const binding = this.getODataModel().bindContext("/decide(...)");
    binding.setParameter("weekStart", model.getProperty("/weekStart") as string);
    binding.setParameter(
      "entries",
      problems
        .filter((problem) => problem.planned)
        .map((problem) => ({ problemKey: problem.problemKey, kind: problem.kind, title: problem.name, cost: problem.cost })),
    );
    binding.setParameter("note", "");
    model.setProperty("/busy", true);
    try {
      await binding.invoke();
      MessageToast.show(t(bundle, "decisionSaved"));
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

      // A plan already stored for this week wins over the proposal of the server.
      const savedThisWeek = decisions.filter((decision) => decision.weekStart === week.weekStart);
      const savedKeys = new Set(savedThisWeek.map((decision) => decision.problemKey));

      const problems = week.problems.map((problem, index) =>
        this.toProblemRow(problem, index + 1, savedThisWeek.length > 0 ? savedKeys.has(problem.problemKey) : problem.planned, bundle),
      );
      model.setProperty("/weekStart", week.weekStart);
      model.setProperty("/subtitle", t(bundle, "pageSubtitle", [longDay.format(parseIsoDate(week.weekStart))]));
      model.setProperty("/budget/total", week.budgetTotal);
      model.setProperty("/problems", problems);
      model.setProperty("/areas", week.areas.map((area) => this.toAreaRow(area, bundle)));
      model.setProperty(
        "/mapSvg",
        buildMapSvg(sap.ui.require.toUrl("rowan/council/img/oakhaven-map.jpg"), week.areas, week.pipes, t(bundle, "mapAlt")),
      );
      const openKeys = new Set(week.problems.map((problem) => problem.problemKey));
      const repairedKeys = new Set(week.pipes.filter((pipe) => pipe.status === "repaired").map((pipe) => `water:${pipe.pipeID}`));
      model.setProperty(
        "/decisions",
        decisions.map((decision) => this.toDecisionRow(decision, week.weekStart, openKeys, repairedKeys, bundle)),
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

  /** Budget bar, what is left and what does not fit, from the ticked problems. Also refreshes the summary. */
  private updateBudget(bundle: ResourceBundle): void {
    const model = this.getModel();
    const total = model.getProperty("/budget/total") as number;
    const problems = model.getProperty("/problems") as ProblemRow[];
    const planned = problems.filter((problem) => problem.planned).reduce((sum, problem) => sum + problem.cost, 0);
    const left = total - planned;
    const state = left < 0 ? ValueState.Error : left < total * 0.2 ? ValueState.Warning : ValueState.Success;
    const unfunded = problems
      .filter((problem) => !problem.planned)
      .map((problem) => ({
        text: t(bundle, "unfundedLine", [problem.name, problem.tierText, problem.cost]),
        icon: problem.icon,
      }));
    model.setProperty("/budget/planned", planned);
    model.setProperty("/budget/left", left);
    model.setProperty("/budget/percent", total > 0 ? Math.min(100, Math.round((planned / total) * 100)) : 0);
    model.setProperty("/budget/barText", t(bundle, "budgetBar", [planned, total]));
    model.setProperty("/budget/leftText", left < 0 ? t(bundle, "budgetOver", [-left]) : t(bundle, "budgetLeft", [left]));
    model.setProperty("/budget/state", state);
    model.setProperty("/budget/unfunded", unfunded);
    this.updateSummary(bundle);
  }

  /** The few lines at the top: how many parts are not in order, what the plan costs, what is left out. */
  private updateSummary(bundle: ResourceBundle): void {
    const model = this.getModel();
    const areas = model.getProperty("/areas") as Array<{ status: string }>;
    const problems = model.getProperty("/problems") as ProblemRow[];
    const budget = model.getProperty("/budget") as { total: number; planned: number; unfunded: unknown[] };
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
        text: t(bundle, "summaryProblems", [problems.length, budget.planned, budget.total]),
        state: budget.planned > budget.total ? ValueState.Error : ValueState.Information,
        icon: "sap-icon://ti/coins",
      });
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

  private toProblemRow(problem: ProblemData, rank: number, planned: boolean, bundle: ResourceBundle): ProblemRow {
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

    const unknown = problem.status === "unknown";
    return {
      ...problem,
      planned,
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

  private toDecisionRow(
    decision: DecisionData,
    thisWeek: string,
    openKeys: ReadonlySet<string>,
    repairedKeys: ReadonlySet<string>,
    bundle: ResourceBundle,
  ): DecisionData & { weekText: string; actionText: string; outcomeText: string; outcomeIcon: string; outcomeState: ValueState } {
    const current = decision.weekStart === thisWeek;
    const still = openKeys.has(decision.problemKey);
    // Maren logged the repair: the council sees its money at work, even in the week it decided.
    const repaired = repairedKeys.has(decision.problemKey);
    let outcome: { text: string; icon: string; state: ValueState };
    if (repaired) outcome = { text: t(bundle, "outcomeRepaired"), icon: STATE_ICON.repaired, state: ValueState.Information };
    else if (current) outcome = { text: t(bundle, "outcomePlanned"), icon: "sap-icon://ti/checklist", state: ValueState.Information };
    else if (still) outcome = { text: t(bundle, "outcomeStill"), icon: STATE_ICON.warning, state: ValueState.Warning };
    else outcome = { text: t(bundle, "outcomeSolved"), icon: STATE_ICON.ok, state: ValueState.Success };
    return {
      ...decision,
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
