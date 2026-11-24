import DateFormat from "sap/ui/core/format/DateFormat";
import { ValueState } from "sap/ui/core/library";

/** The ISO date (`YYYY-MM-DD`) the server sends, as a local Date. */
export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

const dayName = DateFormat.getDateInstance({ pattern: "EEEE d MMM" });
const shortDay = DateFormat.getDateInstance({ pattern: "EEE d/M" });

/** "vrijdag 27 nov" */
export function formatDay(iso: string): string {
  return dayName.format(parseIsoDate(iso));
}

/** "vr 27/11" — column header of the day table. */
export function formatShortDay(iso: string): string {
  return shortDay.format(parseIsoDate(iso));
}

/** Whole days from today (local) to the ISO date: 0 = today, -1 = yesterday. */
export function daysFromToday(iso: string, now: Date = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((parseIsoDate(iso).getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

/** Traffic light of the server → semantic UI5 state (always shown with text + icon too). */
export function statusToState(status: string): ValueState {
  switch (status) {
    case "red":
      return ValueState.Error;
    case "orange":
      return ValueState.Warning;
    default:
      return ValueState.Success;
  }
}

export function statusToIcon(status: string): string {
  switch (status) {
    case "red":
      return "sap-icon://ti/alert-octagon";
    case "orange":
      return "sap-icon://ti/alert-triangle";
    default:
      return "sap-icon://ti/circle-check";
  }
}

/** `YYYY-MM-DD` of a local date (what `<DatePicker valueFormat="yyyy-MM-dd">` and the server use). */
export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** `days` days after today, as an ISO date. */
export function isoDateFromToday(days: number, now: Date = new Date()): string {
  return toIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
}
