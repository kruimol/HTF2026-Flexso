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
  | 'systemAccount'
  | 'noName'
  | 'nightChange'
  | 'hiddenText'
  | 'otherRegister'
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

/** Users that wrote to the registers and are people (or bodies) of the village, taken from the data. */
const KNOWN_EDITORS = new Set(['council', 'maren.holt', 'tobin.reyes', 'rowan.ashby', 'ilse.vermeer']);

/**
 * Accounts that are not a person: nobody vouches for what they write. Ilse: "een wijziging door een
 * systeemaccount […] baart mij zorgen".
 */
const SYSTEM_ACCOUNTS = new Set(['system', 'admin', 'root', 'service', 'sys', 'cron', 'batch']);

/**
 * "No name": what CAP records for a change made without logging in (every village app today), or no
 * user at all. The change may be honest, but nobody can say who made it.
 */
const NO_NAME = new Set(['anonymous', 'unknown', '']);

/**
 * Ilse: "tussen middernacht en vier uur 's nachts, want dan werkt hier niemand". From 00:00 up to,
 * not including, 04:00 village time: at 04:00 Tobin, the baker, is the first in the village to get up.
 */
const NIGHT_FROM_HOUR = 0;
const NIGHT_UNTIL_HOUR = 4;

/**
 * Who looks after which register: Maren the water (pipes, sensors, repairs), Tobin "alles over
 * voedsel en voorraden", the council the places.
 */
const REGISTER_OWNERS: Readonly<Record<string, { user: string; name: string; ask: string }>> = {
  WaterPipes: { user: 'maren.holt', name: 'Maren Holt, de waterwachter', ask: 'Maren' },
  Sensors: { user: 'maren.holt', name: 'Maren Holt, de waterwachter', ask: 'Maren' },
  Repairs: { user: 'maren.holt', name: 'Maren Holt, de waterwachter', ask: 'Maren' },
  StockItems: { user: 'tobin.reyes', name: 'Tobin Reyes, de bakker', ask: 'Tobin' },
  Landmarks: { user: 'council', name: 'de dorpsraad', ask: 'de raad' },
};

/** Villagers whose writing in someone else's register is pointed out (the council registers for others). */
const VILLAGER_ROLES: Readonly<Record<string, string>> = {
  'maren.holt': 'Maren Holt (waterwachter)',
  'tobin.reyes': 'Tobin Reyes (bakker)',
  'ilse.vermeer': 'Ilse Vermeer (bibliothecaresse)',
};

/**
 * Rules that are not suspicion but a question for the owner of the register ("na te vragen").
 * Ilse: "Of Tobin aan de watersensoren mag komen, weet ik niet; dat moet je aan Maren Holt vragen."
 * So writing in someone else's register is pointed out, never counted as suspicious, and never
 * makes a moment.
 */
export const ASK_RULES: ReadonlySet<Rule> = new Set<Rule>(['otherRegister']);

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

/**
 * Village time = the time as the registers write it down (UTC). The registers record work at 09:00,
 * 12:30 … in that clock; converting to Belgian time would shift every moment an hour and push a
 * change at 03:13 out of Ilse's night window. The app shows the same clock.
 */
const VILLAGE_TIME_ZONE = 'UTC';
const HOUR_FORMAT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: VILLAGE_TIME_ZONE });

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

/**
 * Letters that are not language: a Base64 word (a common way to write any text with letters and
 * digits only) that decodes to readable text. Ilse: "Ze eindigt met vreemde letters die ik niet kan
 * lezen." Only words of 12+ characters that decode to mostly printable text count, so ordinary
 * words and IDs are left alone.
 */
export function hiddenTexts(value: string | null): Array<{ encoded: string; decoded: string }> {
  if (!value) return [];
  const found: Array<{ encoded: string; decoded: string }> = [];
  for (const [encoded] of value.matchAll(/[A-Za-z0-9+/]{12,}={0,2}/g)) {
    if (encoded.length % 4 !== 0 || !/[0-9+/=]/.test(encoded) || !/[a-z]/.test(encoded) || !/[A-Z]/.test(encoded)) continue;
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const printable = [...decoded].filter((char) => char >= ' ' && char <= '~').length;
    if (decoded.length >= 4 && printable === decoded.length && /[A-Za-z]{3}/.test(decoded)) found.push({ encoded, decoded });
  }
  return found;
}

/** True between 00:00 and 04:00 village time. */
export function isNight(iso: string | null): boolean {
  const t = time(iso);
  if (t === null) return false;
  const hour = Number(HOUR_FORMAT.format(new Date(t)));
  return hour >= NIGHT_FROM_HOUR && hour < NIGHT_UNTIL_HOUR;
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

  /** Every row: who wrote it, and when. One finding per kind per row is enough. */
  const checkEditor = (entityName: string, row: ManagedRow, label: string): void => {
    const writes = [
      [row.createdBy, row.createdAt, 'Aangemaakt'],
      [row.modifiedBy, row.modifiedAt, 'Laatst gewijzigd'],
    ] as const;
    const seen = new Set<Rule>();
    const once = (rule: Rule, explanation: string): void => {
      if (seen.has(rule)) return;
      seen.add(rule);
      add(entityName, row, label, rule, explanation);
    };
    for (const [rawUser, when, verb] of writes) {
      const user = (rawUser ?? '').trim();
      const at = when ? ` op ${dateTime(when)}` : '';
      if (SYSTEM_ACCOUNTS.has(user.toLowerCase())) {
        once('systemAccount', `${verb} door het systeemaccount '${user}'${at}. Een systeemaccount is geen persoon: niemand staat in voor deze wijziging.`);
      } else if (NO_NAME.has(user.toLowerCase())) {
        once('noName', `${verb} zonder naam${at} (${user ? `'${user}'` : 'geen gebruiker'}): niet na te gaan wie dit deed.`);
      } else if (!KNOWN_EDITORS.has(user)) {
        once('unknownEditor', `${verb} door '${user}'${at}. Dat is geen persoon of instantie uit het dorp.`);
      }
      const owner = REGISTER_OWNERS[entityName];
      const role = VILLAGER_ROLES[user];
      if (owner && role && owner.user !== user) {
        once('otherRegister', `${verb} door ${role}${at}. Het register ${REGISTER_NAMES[entityName] ?? entityName} hoort bij ${owner.name}. Of dat mocht, weet alleen ${owner.ask}: vraag het na. Op zich is dit geen bewijs.`);
      }
      if (isNight(when)) {
        once('nightChange', `${verb} op ${dateTime(when as string)}, tussen middernacht en vier uur 's nachts. Dan werkt er niemand in Oakhaven.`);
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
    for (const { encoded, decoded } of hiddenTexts(repair.issue)) {
      add('Repairs', repair, label, 'hiddenText',
        `De nota bevat de tekens '${encoded}'. Dat is geen taal maar Base64, een gewone manier om tekst met letters en cijfers te schrijven. Ontcijferd staat er: '${decoded}'.`);
    }
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
    if (!finding.changedAt || ASK_RULES.has(finding.rule)) continue; // a question is not a suspicious moment
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
