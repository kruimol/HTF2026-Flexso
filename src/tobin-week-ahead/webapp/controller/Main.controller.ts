import Log from "sap/base/Log";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import type Dialog from "sap/m/Dialog";
import type Select from "sap/m/Select";
import type { Select$ChangeEvent } from "sap/m/Select";
import type Button from "sap/m/Button";
import type { Button$PressEvent } from "sap/m/Button";
import Fragment from "sap/ui/core/Fragment";
import Controller from "sap/ui/core/mvc/Controller";
import type ResourceBundle from "sap/base/i18n/ResourceBundle";
import type ResourceModel from "sap/ui/model/resource/ResourceModel";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import JSONModel from "sap/ui/model/json/JSONModel";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import Sorter from "sap/ui/model/Sorter";
import DateFormat from "sap/ui/core/format/DateFormat";
import {
  daysFromToday,
  formatDay,
  formatShortDay,
  isoDateFromToday,
  statusToIcon,
  statusToState,
} from "../model/formatter";

/** Text from the i18n bundle; the key itself when it is missing. */
function t(bundle: ResourceBundle, key: string, args?: unknown[]): string {
  return bundle.getText(key, args) ?? key;
}

/** One day of the forecast, as the server sends it. */
interface DayData {
  date: string;
  startQuantity: number;
  consumption: number;
  isSaturday: boolean;
  short: boolean;
}

/** One followed ingredient, as `weekAhead()` sends it. */
interface WeekAheadData {
  itemUUID: string;
  itemID: string;
  name: string;
  icon: string;
  unit: string;
  supplier: string;
  leadTimeDays: number;
  currentQuantity: number;
  minStockLevel: number;
  dataSuspect: boolean;
  status: string;
  reason: string;
  runOutDate: string | null;
  orderByDate: string | null;
  adviceQuantity: number;
  incomingQuantity: number;
  nextArrivalDate: string | null;
  ratePerDay: number;
  dataRate: number;
  rateLearned: boolean;
  samples: number;
  saturdayFactor: number;
  lastCountedOn: string | null;
  days: DayData[];
}

/** One open order, ready to display. */
interface OrderRow {
  ID: string;
  itemUUID: string;
  name: string;
  unit: string;
  quantity: number;
  expectedText: string;
  late: boolean;
}

/** One line of the stock count dialog. */
interface CountLine {
  itemUUID: string;
  quantity: string;
}

interface BriefLine {
  text: string;
  state: string;
  icon: string;
}

/** Form values of the "follow an ingredient" dialog. */
interface RuleForm {
  itemUUID: string;
  supplier: string;
  leadTimeDays: number;
  saturdayFactor: number;
}

/** Form values of the "place an order" dialog. */
interface OrderForm {
  itemUUID: string;
  unit: string;
  quantity: string;
  expectedAt: string;
}

/** Form values of the "receive a delivery" dialog (`orderID` empty = delivery without order). */
interface ReceiveForm {
  orderID: string;
  itemUUID: string;
  unit: string;
  quantity: string;
}

/** One open order as the service sends it (with the expanded item). */
interface OrderData {
  ID: string;
  item_ID: string;
  quantity: number | string;
  expectedAt: string;
  item?: { name?: string; unit?: string };
}

/**
 * The one page of Tobin's Week Ahead. The forecast comes from the OData function `weekAhead()`;
 * this controller turns it into display rows (texts from i18n, traffic-light states) in the
 * "week" view model. Which ingredients are followed is data (`SupplyRules`), not code.
 *
 * @namespace tobin.weekahead.controller
 */
export default class Main extends Controller {
  /** Fragment dialogs by name, created on first use and destroyed in `onExit`. */
  private readonly dialogs = new Map<string, Dialog>();
  /** The dialog that is currently open, for `busy` and `close`. */
  private dialog?: Dialog;

  public onInit(): void {
    const weekModel = new JSONModel({
      busy: true,
      items: [],
      brief: [],
      briefState: "None",
      dayHeaders: [],
      generatedAt: "",
      orders: [],
      form: this.emptyForm(),
      order: this.emptyOrder(),
      receive: this.emptyReceive(),
      count: { date: "", maxDate: new Date(), lines: [] },
    });
    this.getView()?.setModel(weekModel, "week");
    void this.load();
  }

  public onExit(): void {
    for (const dialog of this.dialogs.values()) dialog.destroy();
    this.dialogs.clear();
  }

  public onRefresh(): void {
    void this.load();
  }

  public onFollow(): void {
    this.getWeekModel().setProperty("/form", this.emptyForm());
    void this.openDialog("RuleDialog");
  }

  public onCancelDialog(): void {
    this.dialog?.close();
  }

  public async onSaveRule(): Promise<void> {
    const form = this.getWeekModel().getProperty("/form") as RuleForm;
    const model = this.getODataModel();
    const binding = model.bindContext("/saveSupplyRule(...)");
    binding.setParameter("item_ID", form.itemUUID);
    binding.setParameter("supplier", form.supplier);
    binding.setParameter("leadTimeDays", form.leadTimeDays);
    binding.setParameter("saturdayFactor", form.saturdayFactor);
    const select = Fragment.byId(this.getView()?.getId() ?? "", "ruleItem") as Select | undefined;
    const name = select?.getSelectedItem()?.getText() ?? "";
    this.dialog?.setBusy(true);
    try {
      await binding.invoke();
      this.dialog?.close();
      const bundle = await this.getBundle();

      MessageToast.show(t(bundle, "savedToast", [name]));
      await this.load();
    } catch (error) {
      Log.error("saveSupplyRule failed", String(error));
      MessageBox.error((error as Error).message);
    } finally {
      this.dialog?.setBusy(false);
    }
  }

  public async onUnfollow(event: Button$PressEvent): Promise<void> {
    const item = (event.getSource() as Button).getBindingContext("week")?.getObject() as
      | (WeekAheadData & { name: string })
      | undefined;
    if (!item) return;
    const bundle = await this.getBundle();
    MessageBox.confirm(t(bundle, "unfollowConfirm", [item.name]), {
      actions: [t(bundle, "unfollow"), MessageBox.Action.CANCEL],
      emphasizedAction: MessageBox.Action.CANCEL,
      onClose: (action: string | null) => {
        if (action === MessageBox.Action.CANCEL) return;
        void this.unfollow(item.itemUUID, item.name);
      },
    });
  }


  /** "Voorraad tellen": one line per followed ingredient, empty until Tobin fills in what he counted. */
  public onCountStock(): void {
    const items = this.getWeekModel().getProperty("/items") as Array<WeekAheadData & { name: string }>;
    const today = new Date();
    this.getWeekModel().setProperty("/count", {
      date: isoDateFromToday(0),
      maxDate: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
      lines: items.map((item) => ({
        itemUUID: item.itemUUID,
        name: item.name,
        unit: item.unit,
        current: item.currentQuantity,
        quantity: "",
      })),
    });
    void this.openDialog("CountDialog");
  }

  public async onSaveCount(): Promise<void> {
    const count = this.getWeekModel().getProperty("/count") as { date: string; lines: CountLine[] };
    const counts = count.lines
      .filter((line) => line.quantity !== "" && !Number.isNaN(Number(line.quantity)))
      .map((line) => ({ item_ID: line.itemUUID, quantity: Number(line.quantity) }));
    const binding = this.getODataModel().bindContext("/recordCounts(...)");
    binding.setParameter("counts", counts);
    binding.setParameter("countedOn", count.date);
    await this.runDialogAction(binding, "countSavedToast", "");
  }

  /** "Bestelling plaatsen" in the toolbar: empty form. */
  public onPlaceOrder(): void {
    this.getWeekModel().setProperty("/order", this.emptyOrder());
    void this.openDialog("OrderDialog");
  }

  /** The cart button of a row: the form is filled with the advice and the expected delivery day. */
  public onOrderThis(event: Button$PressEvent): void {
    const item = (event.getSource() as Button).getBindingContext("week")?.getObject() as WeekAheadData | undefined;
    if (!item) return;
    this.getWeekModel().setProperty("/order", {
      itemUUID: item.itemUUID,
      unit: item.unit,
      quantity: item.adviceQuantity > 0 ? String(item.adviceQuantity) : "",
      expectedAt: isoDateFromToday(item.leadTimeDays),
    } satisfies OrderForm);
    void this.openDialog("OrderDialog");
  }

  /** Choosing an ingredient in the order or receive dialog: show its unit (and its usual delivery day). */
  public onOrderItemChange(event: Select$ChangeEvent): void {
    const key = event.getParameter("selectedItem")?.getKey() ?? "";
    const item = this.findItem(key);
    const model = this.getWeekModel();
    model.setProperty("/order/unit", item?.unit ?? "");
    if (item) model.setProperty("/order/expectedAt", isoDateFromToday(item.leadTimeDays));
  }

  public onReceiveItemChange(event: Select$ChangeEvent): void {
    const key = event.getParameter("selectedItem")?.getKey() ?? "";
    this.getWeekModel().setProperty("/receive/unit", this.findItem(key)?.unit ?? "");
  }

  public async onSaveOrder(): Promise<void> {
    const form = this.getWeekModel().getProperty("/order") as OrderForm;
    const binding = this.getODataModel().bindContext("/placeOrder(...)");
    binding.setParameter("item_ID", form.itemUUID);
    binding.setParameter("quantity", Number(form.quantity));
    binding.setParameter("expectedAt", form.expectedAt);
    const name = this.findItem(form.itemUUID)?.name ?? "";
    await this.runDialogAction(binding, "orderPlacedToast", name);
  }

  /** "Ontvangen" on an open order: the ordered quantity is the proposal. */
  public onReceiveOrder(event: Button$PressEvent): void {
    const order = (event.getSource() as Button).getBindingContext("week")?.getObject() as OrderRow | undefined;
    if (!order) return;
    this.getWeekModel().setProperty("/receive", {
      orderID: order.ID,
      itemUUID: order.itemUUID,
      unit: order.unit,
      quantity: String(order.quantity),
    } satisfies ReceiveForm);
    void this.openDialog("ReceiveDialog");
  }

  /** "Levering ontvangen" in the toolbar: a delivery nobody ordered here. */
  public onReceiveDelivery(): void {
    this.getWeekModel().setProperty("/receive", this.emptyReceive());
    void this.openDialog("ReceiveDialog");
  }

  public async onSaveReceive(): Promise<void> {
    const form = this.getWeekModel().getProperty("/receive") as ReceiveForm;
    const binding = form.orderID
      ? this.getODataModel().bindContext("/receiveOrder(...)")
      : this.getODataModel().bindContext("/receiveDelivery(...)");
    if (form.orderID) binding.setParameter("order_ID", form.orderID);
    else binding.setParameter("item_ID", form.itemUUID);
    binding.setParameter("quantityReceived", Number(form.quantity));
    const name = this.findItem(form.itemUUID)?.name ?? "";
    await this.runDialogAction(binding, "receivedToast", name);
  }

  public async onCancelOrder(event: Button$PressEvent): Promise<void> {
    const order = (event.getSource() as Button).getBindingContext("week")?.getObject() as OrderRow | undefined;
    if (!order) return;
    const bundle = await this.getBundle();
    MessageBox.confirm(t(bundle, "cancelOrderConfirm", [order.name]), {
      actions: [t(bundle, "cancelOrderAction"), MessageBox.Action.CANCEL],
      emphasizedAction: MessageBox.Action.CANCEL,
      onClose: (action: string | null) => {
        if (action === MessageBox.Action.CANCEL) return;
        void this.cancelOrder(order.ID);
      },
    });
  }

  /** The followed ingredients' forecast, fetched through the OData function. */
  private async load(): Promise<void> {
    const weekModel = this.getWeekModel();
    weekModel.setProperty("/busy", true);
    try {
      const list = this.getODataModel().bindList("/weekAhead()");
      const contexts = await list.requestContexts(0, 100);
      const data = contexts.map((context) => context.getObject() as WeekAheadData);
      const bundle = await this.getBundle();
      weekModel.setProperty("/items", data.map((item) => this.toRow(item, bundle)));
      weekModel.setProperty("/orders", await this.loadOrders(bundle));
      weekModel.setProperty("/dayHeaders", this.dayHeaders(data));
      const brief = this.toBrief(data, bundle);
      weekModel.setProperty("/brief", brief);
      weekModel.setProperty("/briefState", this.worstState(data));
      weekModel.setProperty(
        "/generatedAt",
        t(bundle, "generatedAt", [DateFormat.getTimeInstance({ style: "short" }).format(new Date())]),
      );
    } catch (error) {
      Log.error("weekAhead failed", String(error));
      MessageBox.error(t(await this.getBundle(), "loadError"));
    } finally {
      weekModel.setProperty("/busy", false);
    }
  }

  /** Runs a dialog's action; on success the dialog closes, a toast shows and the page reloads. */
  private async runDialogAction(
    binding: ReturnType<ODataModel["bindContext"]>,
    toastKey: string,
    name: string,
  ): Promise<void> {
    this.dialog?.setBusy(true);
    try {
      await binding.invoke();
      this.dialog?.close();
      MessageToast.show(t(await this.getBundle(), toastKey, [name]));
      await this.load();
    } catch (error) {
      Log.error("dialog action failed", String(error));
      MessageBox.error((error as Error).message);
    } finally {
      this.dialog?.setBusy(false);
    }
  }

  private async cancelOrder(orderID: string): Promise<void> {
    const binding = this.getODataModel().bindContext("/cancelOrder(...)");
    binding.setParameter("order_ID", orderID);
    try {
      await binding.invoke();
      MessageToast.show(t(await this.getBundle(), "orderCancelledToast"));
      await this.load();
    } catch (error) {
      Log.error("cancelOrder failed", String(error));
      MessageBox.error((error as Error).message);
    }
  }

  /** The followed ingredient with this item UUID (from the last load). */
  private findItem(itemUUID: string): (WeekAheadData & { name: string }) | undefined {
    const items = this.getWeekModel().getProperty("/items") as Array<WeekAheadData & { name: string }>;
    return items.find((item) => item.itemUUID === itemUUID);
  }

  /** Open orders, soonest first, as display rows. */
  private async loadOrders(bundle: ResourceBundle): Promise<OrderRow[]> {
    const list = this.getODataModel().bindList(
      "/StockOrders",
      undefined,
      [new Sorter("expectedAt")],
      [new Filter("status", FilterOperator.EQ, "open")],
      { $expand: { item: { $select: "name,unit" } } },
    );
    const contexts = await list.requestContexts(0, 100);
    return contexts.map((context) => {
      const order = context.getObject() as OrderData;
      const late = daysFromToday(order.expectedAt) < 0;
      return {
        ID: order.ID,
        itemUUID: order.item_ID,
        name: order.item?.name ?? "",
        unit: order.item?.unit ?? "",
        quantity: Number(order.quantity),
        expectedText: late ? t(bundle, "expectedLate", [formatDay(order.expectedAt)]) : this.dayText(order.expectedAt, bundle),
        late,
      };
    });
  }

  private emptyOrder(): OrderForm {
    return { itemUUID: "", unit: "", quantity: "", expectedAt: isoDateFromToday(1) };
  }

  private emptyReceive(): ReceiveForm {
    return { orderID: "", itemUUID: "", unit: "", quantity: "" };
  }

  private async unfollow(itemUUID: string, name: string): Promise<void> {
    const binding = this.getODataModel().bindContext("/removeSupplyRule(...)");
    binding.setParameter("item_ID", itemUUID);
    try {
      await binding.invoke();
      MessageToast.show(t(await this.getBundle(), "removedToast", [name]));
      await this.load();
    } catch (error) {
      Log.error("removeSupplyRule failed", String(error));
      MessageBox.error((error as Error).message);
    }
  }

  private async openDialog(name: string): Promise<void> {
    const view = this.getView();
    if (!view) return;
    let dialog = this.dialogs.get(name);
    if (!dialog) {
      dialog = (await Fragment.load({
        id: view.getId(),
        name: `tobin.weekahead.view.${name}`,
        controller: this,
      })) as Dialog;
      view.addDependent(dialog);
      this.dialogs.set(name, dialog);
    }
    this.dialog = dialog;
    dialog.open();
  }

  /** Display row of one ingredient: raw numbers plus the texts, states and icons built from i18n. */
  private toRow(item: WeekAheadData, bundle: ResourceBundle): Record<string, unknown> {
    const orderBy = this.orderByText(item, bundle);
    return {
      ...item,
      state: statusToState(item.status),
      statusIcon: statusToIcon(item.status),
      statusText: t(bundle, this.statusKey(item.reason)),
      runsOutText: item.runOutDate ? this.dayText(item.runOutDate, bundle) : t(bundle, "runsOutNone"),
      orderByText: orderBy,
      incomingText: item.incomingQuantity > 0 && item.nextArrivalDate
        ? t(bundle, "incomingText", [item.incomingQuantity, item.unit, this.dayText(item.nextArrivalDate, bundle)])
        : t(bundle, "incomingNone"),
      rateText: item.rateLearned
        ? t(bundle, "rateLearned", [this.round1(item.ratePerDay), item.unit, item.samples, this.round1(item.dataRate)])
        : t(bundle, "rateData", [this.round1(item.dataRate), item.unit]),
      countedText: item.lastCountedOn
        ? t(bundle, "countedOn", [this.dayText(item.lastCountedOn, bundle)])
        : t(bundle, "countedNever"),
      leadTimeText: item.leadTimeDays === 1 ? t(bundle, "leadTimeOne") : t(bundle, "leadTime", [item.leadTimeDays]),
      days: item.days.map((day) => ({ ...day, state: day.short ? "Error" : "None" })),
    };
  }

  private statusKey(reason: string): string {
    switch (reason) {
      case "belowHalfMin":
        return "statusBelowHalfMin";
      case "belowMin":
        return "statusBelowMin";
      case "orderToday":
        return "statusOrderToday";
      case "orderOverdue":
        return "statusOrderOverdue";
      default:
        return "statusOk";
    }
  }

  private dayText(iso: string, bundle: ResourceBundle): string {
    const delta = daysFromToday(iso);
    if (delta === 0) return t(bundle, "today");
    if (delta === 1) return t(bundle, "tomorrow");
    return formatDay(iso);
  }

  private orderByText(item: WeekAheadData, bundle: ResourceBundle): string {
    if (!item.orderByDate) return t(bundle, "orderByNone");
    const delta = daysFromToday(item.orderByDate);
    if (delta < 0) return t(bundle, "orderByOverdue", [formatDay(item.orderByDate)]);
    if (delta === 0) return t(bundle, "orderByToday");
    return this.dayText(item.orderByDate, bundle);
  }

  private dayHeaders(items: WeekAheadData[]): Array<{ label: string; isSaturday: boolean }> {
    const days = items[0]?.days ?? [];
    return days.map((day) => ({ label: formatShortDay(day.date), isSaturday: day.isSaturday }));
  }

  /** Short list of what needs attention, worst first (the server already sorted the items). */
  private toBrief(items: WeekAheadData[], bundle: ResourceBundle): BriefLine[] {
    const lines: BriefLine[] = [];
    for (const item of items) {
      if (item.dataSuspect) {
        lines.push({
          text: t(bundle, "briefSuspect", [item.name, item.currentQuantity, item.unit]),
          state: "Warning",
          icon: "sap-icon://ti/help-circle",
        });
      }
      if (item.rateLearned && item.dataRate > 0 && Math.abs(item.ratePerDay - item.dataRate) / item.dataRate >= 0.1) {
        lines.push({
          text: t(bundle, "briefLearned", [item.name, this.round1(item.ratePerDay), item.unit, this.round1(item.dataRate)]),
          state: "Information",
          icon: "sap-icon://ti/chart-line",
        });
      }
      if (item.incomingQuantity > 0 && item.nextArrivalDate) {
        lines.push({
          text: t(bundle, "briefIncoming", [item.name, item.incomingQuantity, item.unit, this.dayText(item.nextArrivalDate, bundle)]),
          state: "Information",
          icon: "sap-icon://ti/truck-delivery",
        });
      }
      if (item.status === "green") continue;
      lines.push({
        text: this.briefText(item, bundle),
        state: statusToState(item.status),
        icon: statusToIcon(item.status),
      });
    }
    if (lines.length === 0) {
      lines.push({ text: t(bundle, "briefAllGood"), state: "Success", icon: statusToIcon("green") });
    }
    if (items.some((item) => item.lastCountedOn === null)) {
      lines.push({ text: t(bundle, "briefCountHint"), state: "None", icon: "sap-icon://inventory" });
    }
    return lines;
  }

  private briefText(item: WeekAheadData, bundle: ResourceBundle): string {
    const orderBy = item.orderByDate ? this.dayText(item.orderByDate, bundle) : "";
    const runOut = item.runOutDate ? this.dayText(item.runOutDate, bundle) : "";
    switch (item.reason) {
      case "belowHalfMin":
        return t(bundle, "briefBelowHalfMin", [item.name, item.currentQuantity, item.unit, item.minStockLevel, item.adviceQuantity, item.supplier]);
      case "orderOverdue":
        return t(bundle, "briefOrderOverdue", [item.name, orderBy, item.adviceQuantity, item.unit, item.supplier, runOut]);
      case "orderToday":
        return t(bundle, "briefOrderToday", [item.name, item.adviceQuantity, item.unit, item.supplier, runOut]);
      default:
        return item.orderByDate
          ? t(bundle, "briefBelowMin", [item.name, item.currentQuantity, item.unit, item.minStockLevel, orderBy, item.supplier])
          : t(bundle, "briefBelowMinNoOrder", [item.name, item.currentQuantity, item.unit, item.minStockLevel]);
    }
  }

  private round1(value: number): number {
    return Math.round(value * 10) / 10;
  }

  private worstState(items: WeekAheadData[]): string {
    if (items.some((item) => item.status === "red")) return "Error";
    if (items.some((item) => item.status === "orange")) return "Warning";
    return "Success";
  }

  private emptyForm(): RuleForm {
    return { itemUUID: "", supplier: "", leadTimeDays: 1, saturdayFactor: 1 };
  }

  private getWeekModel(): JSONModel {
    return this.getView()?.getModel("week") as JSONModel;
  }

  private getODataModel(): ODataModel {
    return this.getOwnerComponent()?.getModel() as ODataModel;
  }

  private async getBundle(): Promise<ResourceBundle> {
    const model = this.getOwnerComponent()?.getModel("i18n") as ResourceModel;
    return await model.getResourceBundle();
  }
}
