/**
 * Draws the village map as one SVG: the painted map, every pipe coloured by its state and a pin per
 * part of the village with a mark (✓ ↺ ! ✕ ?) and its name, so the state never depends on colour alone.
 * Grid maths from the README ("The village map").
 *
 * @namespace rowan.council.model
 */

const IMAGE = { width: 2048, height: 1536 };
const GRID_BOUNDS = { x: 150, y: 120, width: 1750, height: 1280 };
const CELL_WIDTH = GRID_BOUNDS.width / 8;
const CELL_HEIGHT = GRID_BOUNDS.height / 8;

/** Rough width of one label character in map pixels (38px Cinzel capitals). */
const LABEL_CHAR_WIDTH = 30;

const MARKS: Readonly<Record<string, string>> = { ok: "✓", repaired: "↺", warning: "!", trouble: "✕", unknown: "?" };

export interface MapArea {
  name: string;
  gridCell: string;
  status: string;
}

export interface MapPipe {
  pipeID: string;
  status: string;
  mapPath: string;
}

function toPixel(x: number, y: number): { x: number; y: number } {
  return { x: GRID_BOUNDS.x + x * CELL_WIDTH, y: GRID_BOUNDS.y + (8 - y) * CELL_HEIGHT };
}

/** Centre of a cell like "E6", in grid units; null when the cell is not valid. */
function cellCentre(cell: string): { x: number; y: number } | null {
  const match = /^([A-H])([1-8])$/.exec(cell.trim().toUpperCase());
  if (!match) return null;
  return { x: match[1].charCodeAt(0) - 65 + 0.5, y: Number(match[2]) - 0.5 };
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function safeStatus(status: string): string {
  return status in MARKS ? status : "unknown";
}

/** The SVG markup (one root element, as `sap.ui.core.HTML` requires). */
export function buildMapSvg(imageUrl: string, areas: readonly MapArea[], pipes: readonly MapPipe[], title: string): string {
  const lines = pipes
    .map((pipe) => {
      const points = pipe.mapPath
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(",").map(Number))
        .filter((pair) => pair.length === 2 && pair.every((value) => Number.isFinite(value)))
        .map(([x, y]) => toPixel(x, y))
        .map((point) => `${point.x.toFixed(0)},${point.y.toFixed(0)}`)
        .join(" ");
      return points ? `<polyline class="rowanPipe rowanPipe--${safeStatus(pipe.status)}" points="${points}"><title>${escapeXml(pipe.pipeID)}</title></polyline>` : "";
    })
    .join("");

  // A label goes under its pin, unless it would run into the label of a pin in the same row: then above.
  const placed: Array<{ left: number; right: number; y: number }> = [];
  const pins = areas
    .map((area) => ({ area, centre: cellCentre(area.gridCell) }))
    .filter((pin): pin is { area: MapArea; centre: { x: number; y: number } } => pin.centre !== null)
    .map(({ area, centre }) => ({ area, ...toPixel(centre.x, centre.y) }))
    .sort((a, b) => a.x - b.x)
    .map(({ area, x, y }) => {
      const status = safeStatus(area.status);
      const halfWidth = (area.name.length * LABEL_CHAR_WIDTH) / 2;
      let labelY = y + 82;
      if (placed.some((label) => label.y === labelY && label.right > x - halfWidth)) labelY = y - 56;
      placed.push({ left: x - halfWidth, right: x + halfWidth, y: labelY });
      return (
        `<g><title>${escapeXml(area.name)}</title>` +
        `<circle class="rowanPin rowanPin--${status}" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="34"/>` +
        `<text class="rowanPinMark" x="${x.toFixed(0)}" y="${y.toFixed(0)}">${MARKS[status]}</text>` +
        `<text class="rowanPinLabel" x="${x.toFixed(0)}" y="${labelY.toFixed(0)}">${escapeXml(area.name)}</text></g>`
      );
    })
    .join("");

  return (
    `<div class="rowanMap"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${IMAGE.width} ${IMAGE.height}" role="img" aria-label="${escapeXml(title)}">` +
    `<image href="${escapeXml(imageUrl)}" x="0" y="0" width="${IMAGE.width}" height="${IMAGE.height}"/>` +
    lines +
    pins +
    `</svg></div>`
  );
}
