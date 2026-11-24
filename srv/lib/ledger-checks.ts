/**
 * Ilse's Ledger: the checks that find suspicious records — "zonder toverij".
 *
 * Every check is a fixed rule that produces one sentence in plain Dutch with the real numbers, so
 * Ilse can explain it to the village council herself. No scores, no guessing. The checks only
 * state facts ("laatst gewijzigd door …"); they never name a culprit.
 *
 * Pure functions: the rows go in, the findings come out (loading happens in ledger-service.ts).
 */

/** The `managed` fields every register row has. */
export interface ManagedRow {
  ID: string;
  createdAt: string | null;
  createdBy: string | null;
  modifiedAt: string | null;
  modifiedBy: string | null;
}

export interface PipeRow extends ManagedRow {
  pipeID: string | null;
  nominalFlowRate: number | string | null;
  currentFlowRate: number | string | null;
  currentPressure: number | string | null;
  lastMaintenance: string | null;
}

export interface SensorRow extends ManagedRow {
  pipe_ID: string | null;
  sensorID: string | null;
  flowRate: number | string | null;
  pressure: number | string | null;
  lastReading: string | null;
}

export interface RepairRow extends ManagedRow {
  pipe_ID: string | null;
  issue: string | null;
  repairDate: string | null;
  repairedBy: string | null;
}

export interface StockRow extends ManagedRow {
  itemID: string | null;
  name: string | null;
  unit: string | null;
  currentQuantity: number | string | null;
  minStockLevel: number | string | null;
  consumptionRate: number | string | null;
}

export interface LandmarkRow extends ManagedRow {
  name: string | null;
}

/** A change the ledger saw while the record's `modifiedAt` stayed the same. */
export interface OutsideChange {
  entityName: string;
  recordID: string;
  recordLabel: string;
  field: string;
  oldValue: string;
  newValue: string;
  at: string;
}

export interface Registers {
  pipes: readonly PipeRow[];
  sensors: readonly SensorRow[];
  repairs: readonly RepairRow[];
  stock: readonly StockRow[];
  landmarks: readonly LandmarkRow[];
  outside: readonly OutsideChange[];
}

export type Rule =
  | 'sourcesDisagree'
  | 'overCapacity'
  | 'impossibleValue'
  | 'futureDate'
  | 'beforeRegister'
  | 'unknownEditor'
  | 'unknownPerson'
  | 'enteredByOther'
  | 'outsideApps';

export interface Finding {
  entityName: string;
  register: string;
  recordID: string;
  recordLabel: string;
  rule: Rule;
  explanation: string;
  changedBy: string;
  changedAt: string | null;
}

/** A moment: records changed by the same user in the same minute, at least one of them suspicious. */
export interface LedgerEvent {
  eventKey: string;
  at: string;
  changedBy: string;
  recordCount: number;
  findingCount: number;
  records: string;
  summary: string;
}

/** Register names as Ilse knows them. */
export const REGISTER_NAMES: Readonly<Record<string, string>> = {
  WaterPipes: 'Waterleidingen',
  Sensors: 'Sensoren',
  Repairs: 'Reparaties',
  StockItems: 'Voorraad',
  Landmarks: 'Plaatsen',
};

/**
 * Users that wrote to the registers and are people (or bodies) of the village, taken from the data.
 * `anonymous` is what CAP records for a change made through one of the village apps (no login).
 */
const KNOWN_EDITORS = new Set(['council', 'maren.holt', 'tobin.reyes', 'rowan.ashby', 'ilse.vermeer', 'anonymous']);

/** The villagers by name, as they appear in `Repairs.repairedBy`, with their user name. */
const VILLAGERS: Readonly<Record<string, string>> = {
  'Maren Holt': 'maren.holt',
  'Tobin Reyes': 'tobin.reyes',
  'Rowan Ashby': 'rowan.ashby',
  'Ilse Vermeer': 'ilse.vermeer',
};

/** Users that register work on behalf of others (no mismatch when they enter a repair). */
const REGISTERS_FOR_OTHERS = new Set(['council', 'anonymous']);

/** Two sources "tell the same story" when they differ by no more than rounding. */
const SAME_STORY_TOLERANCE = 0.5;

/** A date counts as "in the future" only beyond this margin (clocks differ a little). */
const FUTURE_MARGIN_MS = 5 * 60_000;

/** Oakhaven lies in Belgium: dates in the sentences are village time, like in the app. */
const VILLAGE_TIME_ZONE = 'Europe/Brussels';

const DATE_FORMAT = new Intl.DateTimeFormat('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: VILLAGE_TIME_ZONE });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('nl-BE', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: VILLAGE_TIME_ZONE,
});

function num(value: number | string | null): number | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 140 instead of "140.00". */
function show(value: number): string {
  return String(Math.round(value * 100) / 100).replace('.', ',');
}

function day(iso: string): string {
  return DATE_FORMAT.format(new Date(iso));
}

export function dateTime(iso: string): string {
  return DATE_TIME_FORMAT.format(new Date(iso));
}

function time(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** The first moment anything was written in the registers: the register did not exist before. */
export function registerStart(registers: Registers): string | null {
  const all: ManagedRow[] = [...registers.pipes, ...registers.sensors, ...registers.repairs, ...registers.stock, ...registers.landmarks];
  let first: number | null = null;
  for (const row of all) {
    const t = time(row.createdAt);
    if (t !== null && (first === null || t < first)) first = t;
  }
  return first === null ? null : new Date(first).toISOString();
}

export function runChecks(registers: Registers, now: Date): Finding[] {
  const findings: Finding[] = [];
  const start = time(registerStart(registers));
  const future = now.getTime() + FUTURE_MARGIN_MS;
  const pipesById = new Map(registers.pipes.map((pipe) => [pipe.ID, pipe]));

  const add = (entityName: string, row: ManagedRow, recordLabel: string, rule: Rule, explanation: string): void => {
    findings.push({
      entityName,
      register: REGISTER_NAMES[entityName] ?? entityName,
      recordID: row.ID,
      recordLabel,
      rule,
      explanation,
      changedBy: row.modifiedBy ?? '?',
      changedAt: row.modifiedAt,
    });
  };

  /** Dates that cannot be right: in the future, or before the register existed. */
  const checkDate = (entityName: string, row: ManagedRow, label: string, what: string, iso: string | null): void => {
    const t = time(iso);
    if (t === null || !iso) return;
    if (t > future) {
      add(entityName, row, label, 'futureDate', `${what} staat op ${day(iso)}, maar die dag moet nog komen.`);
    } else if (start !== null && t < start) {
      add(entityName, row, label, 'beforeRegister',
        `${what} staat op ${day(iso)}, nog voor het dorpsregister bestond (eerste invoer op ${day(new Date(start).toISOString())}).`);
    }
  };

  /** Every row: who last wrote it. */
  const checkEditor = (entityName: string, row: ManagedRow, label: string): void => {
    for (const [user, when, verb] of [
      [row.createdBy, row.createdAt, 'Aangemaakt'],
      [row.modifiedBy, row.modifiedAt, 'Laatst gewijzigd'],
    ] as const) {
      if (user && !KNOWN_EDITORS.has(user)) {
        const at = when ? ` op ${dateTime(when)}` : '';
        add(entityName, row, label, 'unknownEditor', `${verb} door '${user}'${at}. Dat is geen persoon of instantie uit het dorp.`);
        return; // one finding per row is enough: created and modified by the same unknown user say the same
      }
    }
  };

  for (const pipe of registers.pipes) {
    const label = pipe.pipeID ?? pipe.ID;
    const nominal = num(pipe.nominalFlowRate);
    const flow = num(pipe.currentFlowRate);
    const pressure = num(pipe.currentPressure);
    if (flow !== null && flow < 0) add('WaterPipes', pipe, label, 'impossibleValue', `De leiding ${label} meldt een doorstroming van ${show(flow)} L/min. Water stroomt niet negatief.`);
    if (pressure !== null && pressure < 0) add('WaterPipes', pipe, label, 'impossibleValue', `De leiding ${label} meldt een druk van ${show(pressure)} PSI. Druk kan niet negatief zijn.`);
    if (flow !== null && nominal !== null && flow > nominal) {
      add('WaterPipes', pipe, label, 'overCapacity', `De leiding ${label} meldt ${show(flow)} L/min, maar ze kan hoogstens ${show(nominal)} L/min dragen.`);
    }
    checkDate('WaterPipes', pipe, label, `Het laatste onderhoud van ${label}`, pipe.lastMaintenance);
    checkEditor('WaterPipes', pipe, label);
  }

  for (const sensor of registers.sensors) {
    const label = sensor.sensorID ?? sensor.ID;
    const pipe = sensor.pipe_ID ? pipesById.get(sensor.pipe_ID) : undefined;
    const flow = num(sensor.flowRate);
    const pressure = num(sensor.pressure);
    if (flow !== null && flow < 0) add('Sensors', sensor, label, 'impossibleValue', `Sensor ${label} meet ${show(flow)} L/min. Water stroomt niet negatief.`);
    if (pressure !== null && pressure < 0) add('Sensors', sensor, label, 'impossibleValue', `Sensor ${label} meet ${show(pressure)} PSI. Druk kan niet negatief zijn.`);
    if (pipe) {
      const pipeLabel = pipe.pipeID ?? pipe.ID;
      const pipeFlow = num(pipe.currentFlowRate);
      const pipePressure = num(pipe.currentPressure);
      const nominal = num(pipe.nominalFlowRate);
      if (flow !== null && pipeFlow !== null && Math.abs(flow - pipeFlow) > SAME_STORY_TOLERANCE) {
        add('Sensors', sensor, label, 'sourcesDisagree',
          `De leiding ${pipeLabel} meldt ${show(pipeFlow)} L/min, maar haar eigen sensor ${label} meet ${show(flow)} L/min. Die twee zouden hetzelfde moeten zeggen.`);
      }
      if (pressure !== null && pipePressure !== null && Math.abs(pressure - pipePressure) > SAME_STORY_TOLERANCE) {
        add('Sensors', sensor, label, 'sourcesDisagree',
          `De leiding ${pipeLabel} meldt ${show(pipePressure)} PSI, maar haar eigen sensor ${label} meet ${show(pressure)} PSI. Die twee zouden hetzelfde moeten zeggen.`);
      }
      if (flow !== null && nominal !== null && flow > nominal) {
        add('Sensors', sensor, label, 'overCapacity',
          `Sensor ${label} meet ${show(flow)} L/min, maar de leiding ${pipeLabel} kan hoogstens ${show(nominal)} L/min dragen.`);
      }
    }
    checkDate('Sensors', sensor, label, `De laatste meting van ${label}`, sensor.lastReading);
    checkEditor('Sensors', sensor, label);
  }

  for (const repair of registers.repairs) {
    const pipe = repair.pipe_ID ? pipesById.get(repair.pipe_ID) : undefined;
    const label = `${pipe?.pipeID ?? '?'}: ${repair.issue ?? ''}`.trim();
    checkDate('Repairs', repair, label, 'De reparatie', repair.repairDate);
    const name = repair.repairedBy?.trim();
    if (name) {
      const user = VILLAGERS[name];
      if (!user) {
        add('Repairs', repair, label, 'unknownPerson', `De reparatie staat op naam van '${name}'. Die naam komt niet voor bij de dorpelingen.`);
      } else if (repair.createdBy && repair.createdBy !== user && !REGISTERS_FOR_OTHERS.has(repair.createdBy)) {
        add('Repairs', repair, label, 'enteredByOther', `De reparatie staat op naam van ${name}, maar werd ingevoerd door '${repair.createdBy}'.`);
      }
    }
    checkEditor('Repairs', repair, label);
  }

  for (const item of registers.stock) {
    const label = item.name ?? item.itemID ?? item.ID;
    const unit = item.unit ?? '';
    for (const [value, what] of [
      [num(item.currentQuantity), 'De voorraad'],
      [num(item.minStockLevel), 'Het minimum'],
      [num(item.consumptionRate), 'Het dagverbruik'],
    ] as const) {
      if (value !== null && value < 0) {
        add('StockItems', item, label, 'impossibleValue', `${what} van ${label.toLowerCase()} staat op ${show(value)} ${unit}. Dat kan niet negatief zijn.`);
      }
    }
    checkEditor('StockItems', item, label);
  }

  for (const landmark of registers.landmarks) checkEditor('Landmarks', landmark, landmark.name ?? landmark.ID);

  // Changes the sealed ledger saw while the record's "last modified" stamp did not move.
  for (const change of registers.outside) {
    findings.push({
      entityName: change.entityName,
      register: REGISTER_NAMES[change.entityName] ?? change.entityName,
      recordID: change.recordID,
      recordLabel: change.recordLabel,
      rule: 'outsideApps',
      explanation: `Het veld '${change.field}' veranderde van ${change.oldValue || '(leeg)'} naar ${change.newValue || '(leeg)'} op ${dateTime(change.at)}, maar het record zegt dat het niet gewijzigd werd. Iemand ging buiten de apps om.`,
      changedBy: '?',
      changedAt: change.at,
    });
  }

  return findings;
}

/** Groups the suspicious records by "same user, same minute": one moment, one story. */
export function groupEvents(findings: readonly Finding[]): LedgerEvent[] {
  const groups = new Map<string, { at: string; changedBy: string; records: Map<string, string>; findings: number }>();
  for (const finding of findings) {
    if (!finding.changedAt) continue;
    const minute = new Date(finding.changedAt).toISOString().slice(0, 16);
    const key = `${finding.changedBy}|${minute}`;
    const group = groups.get(key) ?? { at: `${minute}:00Z`, changedBy: finding.changedBy, records: new Map(), findings: 0 };
    group.records.set(`${finding.entityName}|${finding.recordID}`, `${finding.register}: ${finding.recordLabel}`);
    group.findings += 1;
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const records = [...group.records.values()];
      const registers = new Set([...group.records.keys()].map((k) => REGISTER_NAMES[k.split('|')[0]] ?? k));
      return {
        eventKey: key,
        at: group.at,
        changedBy: group.changedBy,
        recordCount: records.length,
        findingCount: group.findings,
        records: records.join(' · '),
        summary:
          records.length > 1
            ? `Op ${dateTime(group.at)} raakte '${group.changedBy}' ${records.length} records aan in ${registers.size} register(s), binnen dezelfde minuut.`
            : `Op ${dateTime(group.at)} raakte '${group.changedBy}' één verdacht record aan.`,
      };
    })
    .sort((a, b) => b.recordCount - a.recordCount || b.at.localeCompare(a.at));
}
