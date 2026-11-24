import Controller from "sap/ui/core/mvc/Controller";
import Fragment from "sap/ui/core/Fragment";
import JSONModel from "sap/ui/model/json/JSONModel";
import MessageToast from "sap/m/MessageToast";
import type Dialog from "sap/m/Dialog";
import type HTML from "sap/ui/core/HTML";
import type ResourceBundle from "sap/base/i18n/ResourceBundle";
import type ResourceModel from "sap/ui/model/resource/ResourceModel";
import { buildHuntMap, buildPlaceArt, type HuntPipe, type HuntPlace } from "../model/huntMap";
import { PLACE_STORIES, type PlaceStory } from "../model/places";

/** Where the places lie when the village data cannot be read (same as db/data Landmarks). */
const FALLBACK_CELLS: Readonly<Record<string, readonly string[]>> = {
  "Silverbrook Spring": ["G7"],
  "North Mill House": ["E6"],
  "Central Market Square": ["D4"],
  "Shepherd's Inn": ["F3"],
  "North Residential Area": ["C6"],
  "The Bakery": ["A3"],
  "South Meadow Farms": ["E1"],
  "Deepwood Forest": ["C8", "B8", "A6"],
};

/** Stamps are kept in this browser: a child's own progress (a convenience, not village data). */
const STAMPS_KEY = "oakhaven.hunt.stamps";

/** The slice of the browser DOM this controller uses (the tsconfig has no DOM lib). */
interface DomElement {
  addEventListener(type: string, listener: (event: DomEvent) => void): void;
  closest?(selector: string): DomElement | null;
  getAttribute?(name: string): string | null;
}

interface DomEvent {
  readonly target: unknown;
  readonly key?: string;
  preventDefault(): void;
}

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): Storage | null {
  try {
    return (globalThis as unknown as { localStorage: Storage }).localStorage;
  } catch {
    return null;
  }
}

function readStamps(): string[] {
  try {
    const raw = storage()?.getItem(STAMPS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeStamps(stamps: readonly string[]): void {
  try {
    storage()?.setItem(STAMPS_KEY, JSON.stringify(stamps));
  } catch {
    // No storage (private mode): stamps last until the page is closed.
  }
}

function idOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * The Oakhaven Hunt: a clickable map of the village for the children. Click a place to see who
 * lives there and what mystery waits, and collect its stamp. Puzzles per place are the next step.
 *
 * @namespace oakhaven.hunt.controller
 */
export default class Main extends Controller {
  private placeDialog?: Dialog;
  private cells = new Map<string, string[]>();
  private pipes: HuntPipe[] = [];
  private listening = false;

  public onInit(): void {
    const stamps = readStamps();
    this.getView()?.setModel(
      new JSONModel({
        stamps,
        progress: "",
        allFound: false,
        place: { id: "", name: "", about: "", art: "", villagers: [], hasVillagers: false, mystery: "", visited: false },
      }),
      "hunt",
    );
    void this.load();
  }

  public onExit(): void {
    this.placeDialog?.destroy();
  }

  /** Collect the stamp of the open place. */
  public async onCollectStamp(): Promise<void> {
    const model = this.getHuntModel();
    const id = model.getProperty("/place/id") as string;
    const stamps = model.getProperty("/stamps") as string[];
    if (!id || stamps.includes(id)) return;
    const next = [...stamps, id];
    writeStamps(next);
    model.setProperty("/stamps", next);
    model.setProperty("/place/visited", true);
    MessageToast.show(this.text(await this.getBundle(), "stampToast", [model.getProperty("/place/name") as string]));
    this.render(await this.getBundle());
  }

  public onCloseDialog(): void {
    this.placeDialog?.close();
  }

  /** Start over: all stamps back in the box. */
  public async onReset(): Promise<void> {
    writeStamps([]);
    this.getHuntModel().setProperty("/stamps", []);
    this.render(await this.getBundle());
  }

  /** Reads where the places and pipes are from the village data; falls back to the known map. */
  private async load(): Promise<void> {
    try {
      const [landmarks, pipes] = await Promise.all([
        fetch("/odata/v4/water-supply/Landmarks?$select=name,kind,gridCell").then((r) => r.json()) as Promise<{
          value?: Array<{ name: string; kind?: string; gridCell?: string }>;
        }>,
        fetch("/odata/v4/water-supply/WaterPipes?$select=mapPath").then((r) => r.json()) as Promise<{ value?: HuntPipe[] }>,
      ]);
      for (const landmark of landmarks.value ?? []) {
        if (!landmark.gridCell) continue;
        const list = this.cells.get(landmark.name) ?? [];
        if (!list.includes(landmark.gridCell)) list.push(landmark.gridCell);
        this.cells.set(landmark.name, list);
      }
      this.pipes = pipes.value ?? [];
    } catch {
      // No village data: the map still works with the known places, without pipes.
    }
    this.render(await this.getBundle());
  }

  private places(stamps: readonly string[]): HuntPlace[] {
    return PLACE_STORIES.map((story) => {
      const id = idOf(story.name);
      return {
        id,
        name: story.name,
        kind: story.kind,
        cells: this.cells.get(story.name) ?? FALLBACK_CELLS[story.name] ?? [],
        visited: stamps.includes(id),
      };
    });
  }

  /** Draws the map and the progress. */
  private render(bundle: ResourceBundle): void {
    const model = this.getHuntModel();
    const stamps = model.getProperty("/stamps") as string[];
    const total = PLACE_STORIES.length;
    const found = PLACE_STORIES.filter((story) => stamps.includes(idOf(story.name))).length;
    model.setProperty("/progress", this.text(bundle, "progress", [found, total]));
    model.setProperty("/allFound", found === total);

    const map = this.byId("map") as HTML | undefined;
    if (!map) return;
    map.setContent(
      buildHuntMap({
        imageUrl: sap.ui.require.toUrl("oakhaven/hunt/img/oakhaven-map.jpg"),
        places: this.places(stamps),
        pipes: this.pipes,
        texts: {
          title: this.text(bundle, "mapTitle"),
          north: this.text(bundle, "regionNorth"),
          south: this.text(bundle, "regionSouth"),
          visit: this.text(bundle, "ariaVisit"),
          visited: this.text(bundle, "ariaVisited"),
        },
      }),
    );
    if (!this.listening) {
      this.listening = true;
      map.attachAfterRendering(() => this.listen(map));
    }
    // setContent may swap the SVG without a full re-render: listen on the new one too.
    setTimeout(() => this.listen(map), 0);
  }

  /** One click / Enter / Space handler on the map: which place was chosen? */
  private listen(map: HTML): void {
    const root = map.getDomRef() as unknown as DomElement | null;
    if (!root || (root as unknown as { huntListening?: boolean }).huntListening) return;
    (root as unknown as { huntListening?: boolean }).huntListening = true;
    const choose = (event: DomEvent): void => {
      const place = (event.target as DomElement | null)?.closest?.("[data-place]");
      const id = place?.getAttribute?.("data-place");
      if (!id) return;
      event.preventDefault();
      void this.openPlace(id);
    };
    root.addEventListener("click", choose);
    root.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") choose(event);
    });
  }

  private async openPlace(id: string): Promise<void> {
    const story = PLACE_STORIES.find((candidate) => idOf(candidate.name) === id) as PlaceStory | undefined;
    if (!story) return;
    const model = this.getHuntModel();
    const stamps = model.getProperty("/stamps") as string[];
    model.setProperty("/place", {
      id,
      name: story.name,
      about: story.about,
      art: `<div class="huntArt">${buildPlaceArt(story.kind)}</div>`,
      villagers: story.villagers,
      hasVillagers: story.villagers.length > 0,
      mystery: story.mystery,
      visited: stamps.includes(id),
    });
    const dialog = await this.getPlaceDialog();
    dialog.open();
  }

  private async getPlaceDialog(): Promise<Dialog> {
    if (!this.placeDialog) {
      const view = this.getView();
      if (!view) throw new Error("view not ready");
      this.placeDialog = (await Fragment.load({ id: view.getId(), name: "oakhaven.hunt.view.PlaceDialog", controller: this })) as Dialog;
      view.addDependent(this.placeDialog);
    }
    return this.placeDialog;
  }

  private getHuntModel(): JSONModel {
    return this.getView()?.getModel("hunt") as JSONModel;
  }

  private text(bundle: ResourceBundle, key: string, args?: unknown[]): string {
    return bundle.getText(key, args) ?? key;
  }

  private async getBundle(): Promise<ResourceBundle> {
    const i18n = this.getOwnerComponent()?.getModel("i18n") as ResourceModel;
    return (await i18n.getResourceBundle()) as ResourceBundle;
  }
}
