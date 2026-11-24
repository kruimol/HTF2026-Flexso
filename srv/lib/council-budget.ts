/**
 * The council's locked budget: pure functions, no database, no CAP.
 *
 * Once the council locks its plan on Monday, each line holds money:
 * - reserved: set aside for that problem, it cannot go anywhere else;
 * - spent: the work is done — Maren logged the repair of the pipe, or Tobin received a delivery of
 *   the item — so the money is gone for good (it is spent when the work is done, not when decided);
 * - released: taken out of the plan, with the council's reason. The money is free again.
 *
 * Rowan: "We have never agreed on what to do with money in the middle of the week, and I won't invent
 * a rule for you." So nothing is paid automatically mid-week; the plan only changes with a reason.
 */

export type LineStatus = 'reserved' | 'spent' | 'released';

export interface DecisionLine {
  ID: string;
  weekStart: string;
  problemKey: string; // water:<pipeID> | food:<itemID>
  kind: string;
  title: string;
  cost: number;
  status: LineStatus;
  createdAt: string; // when the council decided it
}

/** Work that was done: a repair Maren logged, or a delivery Tobin received. */
export interface WorkDone {
  problemKey: string;
  at: string; // when it was logged
  by: string;
}

export interface Spending {
  ID: string;
  spentAt: string;
  spentBy: string;
}

export interface BudgetState {
  total: number;
  spent: number;
  reserved: number;
  free: number;
}

export interface PlanChange {
  release: DecisionLine[];
  add: Array<{ problemKey: string; kind: string; title: string; cost: number }>;
}

export interface PlanEntry {
  problemKey: string;
  kind: string;
  title: string;
  cost: number;
}

/**
 * Reserved lines whose work was done after the council decided: they become spent.
 * The first matching job after the decision counts (a repair before the decision paid for itself).
 */
export function findSpending(lines: readonly DecisionLine[], work: readonly WorkDone[]): Spending[] {
  const result: Spending[] = [];
  for (const line of lines) {
    if (line.status !== 'reserved') continue;
    const done = work
      .filter((job) => job.problemKey === line.problemKey && job.at >= line.createdAt)
      .sort((a, b) => a.at.localeCompare(b.at))[0];
    if (done) result.push({ ID: line.ID, spentAt: done.at, spentBy: done.by });
  }
  return result;
}

/** Spent + reserved count against the week; released lines do not. */
export function budgetOf(lines: readonly DecisionLine[], total: number): BudgetState {
  const sum = (status: LineStatus): number =>
    lines.filter((line) => line.status === status).reduce((acc, line) => acc + line.cost, 0);
  const spent = sum('spent');
  const reserved = sum('reserved');
  return { total, spent, reserved, free: total - spent - reserved };
}

/**
 * What changes when the council sends a new plan for a locked week. Spent money cannot come back:
 * a spent line missing from the new plan is an error (returned as `spentMissing`).
 */
export function planChange(
  lines: readonly DecisionLine[],
  entries: readonly PlanEntry[],
): PlanChange & { spentMissing: DecisionLine[] } {
  const wanted = new Set(entries.map((entry) => entry.problemKey));
  const active = lines.filter((line) => line.status !== 'released');
  const activeKeys = new Set(active.map((line) => line.problemKey));
  return {
    release: active.filter((line) => line.status === 'reserved' && !wanted.has(line.problemKey)),
    add: entries.filter((entry) => !activeKeys.has(entry.problemKey)),
    spentMissing: active.filter((line) => line.status === 'spent' && !wanted.has(line.problemKey)),
  };
}
