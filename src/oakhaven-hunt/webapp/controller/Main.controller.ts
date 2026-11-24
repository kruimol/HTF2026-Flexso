import Controller from "sap/ui/core/mvc/Controller";
import Fragment from "sap/ui/core/Fragment";
import JSONModel from "sap/ui/model/json/JSONModel";
import MessageToast from "sap/m/MessageToast";
import type Dialog from "sap/m/Dialog";
import type HTML from "sap/ui/core/HTML";
import type ResourceBundle from "sap/base/i18n/ResourceBundle";
import type ResourceModel from "sap/ui/model/resource/ResourceModel";
import { buildHuntMap, buildPlaceArt, DRAWINGS, type HuntPipe, type HuntPlace } from "../model/huntMap";
import { buildBoardSvg, isSolved, newPuzzle, turnCell, type PipeBoard } from "../model/pipePuzzle";
import { buildWordGridSvg, newWordGrid, wordAt, type WordGrid } from "../model/wordSearch";
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

/** The pipe puzzle: 5 × 5 is right for children; small enough for a phone too. */
const PUZZLE_SIZE = 5;

/** The word search: 10 × 10, words from the i18n file (so the language of the words can change). */
const WORD_GRID_SIZE = 10;

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
  private gameDialog?: Dialog;
  private board?: PipeBoard;
  private wordDialog?: Dialog;
  private wordGrid?: WordGrid;
  private wordStart: number | null = null;
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
        place: { id: "", name: "", about: "", art: "", villagers: [], hasVillagers: false, mystery: "", visited: false, game: "" },
        game: { svg: "", moves: 0, solved: false },
        words: { svg: "", list: [], found: 0, total: 0, solved: false },
      }),
      "hunt",
    );
    void this.load();
  }

  public onExit(): void {
    this.placeDialog?.destroy();
    this.gameDialog?.destroy();
    this.wordDialog?.destroy();
  }

  /* ------------------------------ The pipe puzzle (Silverbrook Spring) ------------------------------ */

  /** From the place card: play the place's game. */
  public async onPlay(): Promise<void> {
    this.placeDialog?.close();
    const game = this.getHuntModel().getProperty("/place/game") as string;
    if (game === "words") {
      await this.newWords();
      (await this.getWordDialog()).open();
      return;
    }
    this.newBoard();
    (await this.getGameDialog()).open();
  }

  /* ------------------------------ The word search (The Bakery) ------------------------------ */

  public async onNewWords(): Promise<void> {
    await this.newWords();
  }

  public onCloseWords(): void {
    this.wordDialog?.close();
  }

  private async newWords(): Promise<void> {
    const bundle = await this.getBundle();
    const words = this.text(bundle, "wordsBakery").split(",").map((word) => word.trim().toUpperCase()).filter(Boolean);
    this.wordGrid = newWordGrid(words, WORD_GRID_SIZE, Math.floor(Math.random() * 1_000_000) + 1);
    this.wordStart = null;
    const model = this.getHuntModel();
    model.setProperty("/words/list", words.map((word) => ({ word, found: false })));
    model.setProperty("/words/total", words.length);
    model.setProperty("/words/found", 0);
    model.setProperty("/words/solved", false);
    await this.drawWords();
  }

  /**
   * A letter was clicked. First click: the first letter of a word. Second click: its last letter.
   * Not a word? Then the second click becomes the start of a new try.
   */
  private async clickLetter(index: number): Promise<void> {
    const model = this.getHuntModel();
    if (!this.wordGrid || model.getProperty("/words/solved")) return;
    if (this.wordStart === null || this.wordStart === index) {
      this.wordStart = this.wordStart === index ? null : index;
    } else {
      const word = wordAt(this.wordGrid, this.wordStart, index);
      const list = model.getProperty("/words/list") as Array<{ word: string; found: boolean }>;
      const entry = list.find((item) => item.word === word && !item.found);
      if (entry) {
        entry.found = true;
        model.setProperty("/words/list", [...list]);
        const found = list.filter((item) => item.found).length;
        model.setProperty("/words/found", found);
        this.wordStart = null;
        if (found === list.length) {
          model.setProperty("/words/solved", true);
          await this.earnStamp(); // all of Tobin's words found: the stamp of the bakery
        }
      } else {
        this.wordStart = index;
      }
    }
    await this.drawWords();
  }

  private async drawWords(): Promise<void> {
    if (!this.wordGrid) return;
    const bundle = await this.getBundle();
    const model = this.getHuntModel();
    const found = (model.getProperty("/words/list") as Array<{ word: string; found: boolean }>).filter((item) => item.found).map((item) => item.word);
    model.setProperty("/words/svg", `<div class="wsWrap">${buildWordGridSvg(this.wordGrid, found, this.wordStart, {
      title: this.text(bundle, "wordsTitle"),
      letter: this.text(bundle, "wordsLetter"),
    })}</div>`);
    const html = this.byId("wordBoard") as HTML | undefined;
    if (html) setTimeout(() => this.listenFor(html, "data-letter", (value) => void this.clickLetter(Number(value))), 0);
  }

  private async getWordDialog(): Promise<Dialog> {
    if (!this.wordDialog) {
      const view = this.getView();
      if (!view) throw new Error("view not ready");
      this.wordDialog = (await Fragment.load({ id: view.getId(), name: "oakhaven.hunt.view.WordGame", controller: this })) as Dialog;
      view.addDependent(this.wordDialog);
      const html = this.byId("wordBoard") as HTML | undefined;
      html?.attachAfterRendering(() => this.listenFor(html, "data-letter", (value) => void this.clickLetter(Number(value))));
    }
    return this.wordDialog;
  }

  public onNewPuzzle(): void {
    this.newBoard();
  }

  public onCloseGame(): void {
    this.gameDialog?.close();
  }

  private newBoard(): void {
    this.board = newPuzzle(PUZZLE_SIZE, Math.floor(Math.random() * 1_000_000) + 1);
    const model = this.getHuntModel();
    model.setProperty("/game/moves", 0);
    model.setProperty("/game/solved", false);
    void this.drawBoard();
  }

  /** A pipe was clicked: turn it, and see whether the water reaches Oakhaven. */
  private async turnPipe(index: number): Promise<void> {
    const model = this.getHuntModel();
    if (!this.board || model.getProperty("/game/solved")) return;
    this.board = turnCell(this.board, index);
    model.setProperty("/game/moves", (model.getProperty("/game/moves") as number) + 1);
    if (isSolved(this.board)) {
      model.setProperty("/game/solved", true);
      await this.earnStamp(); // solving the puzzle earns the stamp of the spring
    }
    await this.drawBoard();
  }

  private async drawBoard(): Promise<void> {
    if (!this.board) return;
    const bundle = await this.getBundle();
    this.getHuntModel().setProperty("/game/svg", `<div class="pzWrap">${buildBoardSvg(this.board, {
      title: this.text(bundle, "pipesTitle"),
      turn: this.text(bundle, "pipesTurn"),
      spring: this.text(bundle, "pipesSpring"),
      village: this.text(bundle, "pipesVillage"),
    }, DRAWINGS.spring(), DRAWINGS.residential())}</div>`);
    const html = this.byId("pipeBoard") as HTML | undefined;
    if (html) {
      // The board is re-drawn after every turn: listen on the new SVG as soon as it is there.
      setTimeout(() => this.listenFor(html, "data-cell", (value) => void this.turnPipe(Number(value))), 0);
    }
  }

  private async getGameDialog(): Promise<Dialog> {
    if (!this.gameDialog) {
      const view = this.getView();
      if (!view) throw new Error("view not ready");
      this.gameDialog = (await Fragment.load({ id: view.getId(), name: "oakhaven.hunt.view.PipeGame", controller: this })) as Dialog;
      view.addDependent(this.gameDialog);
      const html = this.byId("pipeBoard") as HTML | undefined;
      html?.attachAfterRendering(() => this.listenFor(html, "data-cell", (value) => void this.turnPipe(Number(value))));
    }
    return this.gameDialog;
  }

  /** Collect the stamp of the open place (places without a game yet). */
  public async onCollectStamp(): Promise<void> {
    await this.earnStamp();
  }

  private async earnStamp(): Promise<void> {
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
    this.listenFor(map, "data-place", (id) => void this.openPlace(id));
  }

  /**
   * Click, Enter and Space on an element with the given attribute inside an HTML control's SVG
   * (once per SVG: the SVG is replaced when it is re-drawn).
   */
  private listenFor(html: HTML, attribute: string, handler: (value: string) => void): void {
    const root = html.getDomRef() as unknown as DomElement | null;
    const flags = root as unknown as Record<string, boolean> | null;
    if (!root || !flags || flags[`hunt-${attribute}`]) return;
    flags[`hunt-${attribute}`] = true;
    const choose = (event: DomEvent): void => {
      const element = (event.target as DomElement | null)?.closest?.(`[${attribute}]`);
      const value = element?.getAttribute?.(attribute);
      if (value === null || value === undefined) return;
      event.preventDefault();
      handler(value);
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
      game: story.game ?? "",
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
