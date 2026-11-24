import Controller from "sap/ui/core/mvc/Controller";
import JSONModel from "sap/ui/model/json/JSONModel";
import Device from "sap/ui/Device";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import type Dialog from "sap/m/Dialog";
import type Control from "sap/ui/core/Control";
import type Event from "sap/ui/base/Event";
import type Context from "sap/ui/model/odata/v4/Context";
import Log from "sap/base/Log";
import type HTML from "sap/ui/core/HTML";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import type ODataContextBinding from "sap/ui/model/odata/v4/ODataContextBinding";
import type ResourceModel from "sap/ui/model/resource/ResourceModel";
import type ResourceBundle from "sap/base/i18n/ResourceBundle";
import { buildRoundMap, type MapLandmark, type MapPipe } from "../model/roundMap";

/** The part of the `morningRound()` result the controller reads itself (see srv/water-supply-service.cds). */
interface MorningRoundResult {
  readonly stops?: readonly MapPipe[];
  readonly fine?: readonly MapPipe[];
  readonly places?: readonly MapLandmark[];
}

/** The repair form's state (named model "repair"). */
interface RepairForm {
  pipe_ID: string;
  pipeID: string;
  issue: string;
  repairDate: string;
  repairedBy: string;
  maxDate: Date;
  busy: boolean;
}

/** Remembers who did the last repair on this device, so Maren does not type her name every time. */
const LAST_REPAIRER_KEY = "oakhaven.waterapp.lastRepairer";

function readLastRepairer(): string {
  try {
    return window.localStorage.getItem(LAST_REPAIRER_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberRepairer(name: string): void {
  try {
    window.localStorage.setItem(LAST_REPAIRER_KEY, name);
  } catch {
    // storage blocked: just ask again next time
  }
}

/** Maren checks the list while walking: refresh it every minute. */
const REFRESH_INTERVAL_MS = 60_000;

/**
 * Morning Round: the pipes in the order Maren should visit them (computed by `morningRound()` in
 * the water service, rules in srv/lib/water-priority.ts). Two modes on one page: "Round" — big and
 * simple for the phone at 6 am — and "Details" — village map and table for the evening on the laptop.
 *
 * @namespace oakhaven.waterapp.controller
 */
export default class Main extends Controller {
  private roundBinding?: ODataContextBinding;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private loading = false;
  private lastRound?: MorningRoundResult;
  private repairDialog?: Dialog;

  public onInit(): void {
    const viewModel = new JSONModel({
      // Phone → the round; laptop/tablet → the details. The switch in the header changes it.
      mode: Device.system.phone ? "round" : "details",
      // phone: icon-only mode switch, so it never covers the title
      phone: Device.system.phone,
      busy: false,
    });
    this.getView()?.setModel(viewModel, "view");

    const model = this.getOwnerComponent()?.getModel() as ODataModel | undefined;
    if (!model) return;
    // Deferred operation binding for the unbound function; invoke() calls GET …/morningRound().
    this.roundBinding = model.bindContext("/morningRound(...)") as ODataContextBinding;
    void this.loadRound(true);
    this.refreshTimer = setInterval(() => void this.loadRound(false), REFRESH_INTERVAL_MS);
  }

  public onExit(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.roundBinding?.destroy();
  }

  public onRefresh(): void {
    void this.loadRound(true);
  }

  /** Tap a pipe (card, chip, row or button) → the repair form for that pipe. */
  public async onLogRepair(event: Event): Promise<void> {
    const source = event.getSource() as Control;
    const stop = (source.getBindingContext() as Context | undefined)?.getObject() as
      | { pipe_ID?: string; pipeID?: string }
      | undefined;
    if (!stop?.pipe_ID) return;
    const today = new Date();
    const form: RepairForm = {
      pipe_ID: stop.pipe_ID,
      pipeID: stop.pipeID ?? "",
      issue: "",
      repairDate: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
      repairedBy: readLastRepairer(),
      maxDate: today,
      busy: false,
    };
    this.getView()?.setModel(new JSONModel(form), "repair");
    this.repairDialog ??= (await this.loadFragment({ name: "oakhaven.waterapp.view.LogRepairDialog" })) as Dialog;
    this.repairDialog.open();
  }

  public onCancelRepair(): void {
    this.repairDialog?.close();
  }

  /** Save: call the logRepair action, then refresh the round (the pipe now shows as repaired). */
  public async onSaveRepair(): Promise<void> {
    const repairModel = this.getView()?.getModel("repair") as JSONModel | undefined;
    const odata = this.getOwnerComponent()?.getModel() as ODataModel | undefined;
    if (!repairModel || !odata) return;
    const form = repairModel.getData() as RepairForm;
    repairModel.setProperty("/busy", true);
    const action = odata.bindContext("/logRepair(...)") as ODataContextBinding;
    action.setParameter("pipe_ID", form.pipe_ID);
    action.setParameter("issue", form.issue.trim());
    action.setParameter("repairDate", form.repairDate);
    action.setParameter("repairedBy", form.repairedBy.trim());
    try {
      await action.invoke();
      rememberRepairer(form.repairedBy.trim());
      this.repairDialog?.close();
      const bundle = await this.getBundle();
      MessageToast.show(bundle?.getText("repairSaved", [form.pipeID]) ?? "Repair logged");
      await this.loadRound(false);
    } catch (error) {
      MessageBox.error(error instanceof Error ? error.message : String(error));
    } finally {
      repairModel.setProperty("/busy", false);
      action.destroy();
    }
  }

  /** Round ↔ Details. The map is only drawn while it is visible, so draw it when Details opens. */
  public onModeChange(): void {
    void this.drawMap(this.lastRound);
  }

  /** Calls morningRound(), binds the page to its result and redraws the map. */
  private async loadRound(showProgress: boolean): Promise<void> {
    const binding = this.roundBinding;
    if (!binding || this.loading) return;
    this.loading = true;
    const viewModel = this.getView()?.getModel("view") as JSONModel | undefined;
    if (showProgress) viewModel?.setProperty("/busy", true);
    try {
      await binding.invoke();
      const context = binding.getBoundContext();
      const page = this.byId("page");
      if (page && page.getBindingContext() !== context) page.setBindingContext(context);
      this.lastRound = (await context.requestObject()) as MorningRoundResult | undefined;
      await this.drawMap(this.lastRound);
    } catch (error) {
      Log.error("morningRound() failed", String(error), "oakhaven.waterapp");
      // Only bother Maren when she asked for it — a failed background refresh keeps the old list.
      if (showProgress) MessageBox.error((await this.getBundle())?.getText("loadError") ?? "loadError");
    } finally {
      this.loading = false;
      viewModel?.setProperty("/busy", false);
    }
  }

  /** Draws Maren's route map: pipes by status, her route in order, and how much water reaches each place. */
  private async drawMap(round: MorningRoundResult | undefined): Promise<void> {
    const map = this.byId("map") as HTML | undefined;
    const viewModel = this.getView()?.getModel("view") as JSONModel | undefined;
    // Not visible (Round mode on the phone): skip — onModeChange draws it when Details opens.
    if (!map || !round || viewModel?.getProperty("/mode") !== "details") return;
    const bundle = await this.getBundle();
    const text = (key: string): string => bundle?.getText(key) ?? key;
    const stops = (round.stops ?? []).map((pipe) => ({ ...pipe, onRound: true }));
    map.setContent(
      buildRoundMap({
        imageUrl: sap.ui.require.toUrl("oakhaven/waterapp/img/oakhaven-map.jpg"),
        labelledBy: this.createId("mapCaption") ?? "",
        pipes: [...stops, ...(round.fine ?? [])],
        places: round.places ?? [],
        texts: {
          legendTitle: text("legendTitle"),
          route: text("legendRoute"),
          alarm: text("legendAlarm"),
          unknown: text("legendUnknown"),
          warning: text("legendWarning"),
          repaired: text("legendRepaired"),
          ok: text("legendOk"),
          droplet: text("legendDroplet"),
        },
      }),
    );
  }

  private async getBundle(): Promise<ResourceBundle | undefined> {
    const i18n = this.getOwnerComponent()?.getModel("i18n") as ResourceModel | undefined;
    return i18n?.getResourceBundle();
  }
}
