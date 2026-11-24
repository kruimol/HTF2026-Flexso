import IconPool from "sap/ui/core/IconPool";
import UIComponent from "sap/ui/core/UIComponent";

/**
 * Morning Round — Maren's water app. Models, root view and i18n are declared in manifest.json.
 *
 * @namespace oakhaven.waterapp
 */
export default class Component extends UIComponent {
  public static metadata = {
    manifest: "json",
    interfaces: ["sap.ui.core.IAsyncContentCreation"],
  };

  public init(): void {
    // Tabler Icons (served by srv/lib/icon-fonts.ts): `sap-icon://ti/<name>`, see https://tabler.io/icons
    IconPool.registerFont({
      fontFamily: "tabler-icons",
      fontURI: "/vendor/tabler-icons/",
      collectionName: "ti",
      lazy: true,
    });
    super.init();
  }
}
