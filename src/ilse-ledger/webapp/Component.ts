import IconPool from "sap/ui/core/IconPool";
import UIComponent from "sap/ui/core/UIComponent";

/**
 * Ilse's Ledger: what changed in the village registers, when, and what is suspicious about it.
 * Everything it needs (models, root view, i18n) is declared in manifest.json.
 *
 * @namespace ilse.ledger
 */
export default class Component extends UIComponent {
  public static metadata = {
    manifest: "json",
    interfaces: ["sap.ui.core.IAsyncContentCreation"],
  };

  public init(): void {
    // Tabler Icons (served by srv/lib/icon-fonts.ts): `sap-icon://ti/<name>`.
    IconPool.registerFont({
      fontFamily: "tabler-icons",
      fontURI: "/vendor/tabler-icons/",
      collectionName: "ti",
      lazy: true,
    });
    super.init();
  }
}
