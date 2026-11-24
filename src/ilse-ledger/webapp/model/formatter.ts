import DateFormat from "sap/ui/core/format/DateFormat";
import Locale from "sap/ui/core/Locale";

/**
 * Small display helpers for Ilse's Ledger.
 *
 * @namespace ilse.ledger.model
 */

/** Icon per check, so each kind of finding is recognisable at a glance (always next to text). */
const RULE_ICONS: Readonly<Record<string, string>> = {
  sourcesDisagree: "sap-icon://ti/arrows-diff",
  overCapacity: "sap-icon://ti/gauge",
  impossibleValue: "sap-icon://ti/math-off",
  futureDate: "sap-icon://ti/calendar-time",
  beforeRegister: "sap-icon://ti/history",
  unknownEditor: "sap-icon://ti/user-question",
  systemAccount: "sap-icon://ti/robot",
  noName: "sap-icon://ti/user-off",
  nightChange: "sap-icon://ti/moon",
  hiddenText: "sap-icon://ti/eye",
  otherRegister: "sap-icon://ti/arrows-exchange",
  unknownPerson: "sap-icon://ti/user-question",
  enteredByOther: "sap-icon://ti/users",
  outsideApps: "sap-icon://ti/door-exit",
};

export function ruleIcon(rule: string): string {
  return RULE_ICONS[rule] ?? "sap-icon://ti/alert-triangle";
}

// Dutch, like the sentences the server writes, also inside an English launchpad. Village time is
// the clock the registers write in (UTC), the same clock as the sentences (see ledger-checks.ts).
const DATE_TIME = DateFormat.getDateTimeInstance({ style: "medium", UTC: true }, new Locale("nl-BE"));

/** "17 nov 2026, 03:13:00" from an ISO timestamp; empty when unknown. */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DATE_TIME.format(date);
}

export default { ruleIcon, dateTime };
