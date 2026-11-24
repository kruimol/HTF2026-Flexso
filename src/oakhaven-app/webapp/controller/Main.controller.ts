import Controller from "sap/ui/core/mvc/Controller";
import JSONModel from "sap/ui/model/json/JSONModel";
import type ResourceModel from "sap/ui/model/resource/ResourceModel";
import type ResourceBundle from "sap/base/i18n/ResourceBundle";
import type { ListBase$UpdateFinishedEvent } from "sap/m/ListBase";

/**
 * The one page of the Oakhaven app. Every table is bound straight to the OData services in
 * Main.view.xml, so this controller only keeps a small "view" model with UI state.
 *
 * @namespace oakhaven.village.controller
 */
export default class Main extends Controller {
  public onInit(): void {
    const viewModel = new JSONModel({
      // Resolved through the module system so the image also loads inside the launchpad.
      mapUrl: sap.ui.require.toUrl("oakhaven/village/img/oakhaven-map.jpg"),
      counts: {},
      untrusted: [],
      untrustedText: "",
    });
    this.getView()?.setModel(viewModel, "view");
    void this.loadUntrusted(viewModel);
  }

  /**
   * Ilse's Ledger: the records Ilse marked "niet te vertrouwen". Shown above the registers so nobody
   * acts on them. Silent when the ledger service is not there (e.g. on a branch without it).
   */
  private async loadUntrusted(viewModel: JSONModel): Promise<void> {
    try {
      const response = await fetch("/odata/v4/ledger/TrustMarks?$filter=active eq true&$select=entityName,recordLabel,reason");
      if (!response.ok) return;
      const body = (await response.json()) as { value?: Array<{ recordLabel: string | null; reason: string | null }> };
      const marks = body.value ?? [];
      if (marks.length === 0) return;
      const bundle = (await (this.getOwnerComponent()?.getModel("i18n") as ResourceModel).getResourceBundle()) as ResourceBundle;
      const list = marks.map((mark) => `${mark.recordLabel ?? "?"} (${mark.reason ?? ""})`).join("; ");
      viewModel.setProperty("/untrusted", marks);
      viewModel.setProperty("/untrustedText", bundle.getText("untrustedText", [String(marks.length), list]) ?? "");
    } catch {
      // No ledger, no warning.
    }
  }

  /** Shows the number of rows of a table as the count on its tab. */
  public onTableUpdateFinished(event: ListBase$UpdateFinishedEvent): void {
    const view = this.getView();
    const table = event.getSource();
    if (!view || !table) return;
    const viewModel = view.getModel("view") as JSONModel;
    viewModel.setProperty(`/counts/${view.getLocalId(table.getId())}`, event.getParameter("total"));
  }
}
