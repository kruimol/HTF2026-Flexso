import IconPool from "sap/ui/core/IconPool";
import UIComponent from "sap/ui/core/UIComponent";

/**
 * The Oakhaven Hunt: a clickable map of the village for the children of Oakhaven.
 * Everything it needs (models, root view, i18n) is declared in manifest.json.
 *
 * @namespace oakhaven.hunt
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
