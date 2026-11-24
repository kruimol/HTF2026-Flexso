import Localization from "sap/base/i18n/Localization";
import IconPool from "sap/ui/core/IconPool";
import UIComponent from "sap/ui/core/UIComponent";

/**
 * Tobin's Week Ahead. Everything the app needs (models, root view, i18n) is declared in manifest.json.
 *
 * @namespace tobin.weekahead
 */
export default class Component extends UIComponent {
  public static metadata = {
    manifest: "json",
    interfaces: ["sap.ui.core.IAsyncContentCreation"],
  };

  public init(): void {
    // Tobin is a Dutch-speaking baker: dates ("vrijdag 27 nov") follow the village, not the browser.
    Localization.setLanguage("nl");
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
