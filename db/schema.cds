namespace oakhaven.curse;

using { cuid, managed } from '@sap/cds/common';

// Every entity below uses two standard CAP aspects:
//   cuid    → a UUID key field `ID`
//   managed → createdAt, createdBy, modifiedAt, modifiedBy (filled in by CAP on every write)

// ---------------------------------------------------------------------------
// Water — the pipe network that brings water from Silverbrook Spring to the village
// ---------------------------------------------------------------------------

/** Role of a pipe in the network. */
type PipelineType : String enum {
  mainLine;
  branch;
  secondary;
}

/** A water pipe in the Oakhaven supply network. */
entity WaterPipes : cuid, managed {
  /** Human-readable pipe name, e.g. "PRIMARY-MAIN". */
  pipeID          : String;
  /** Route label, e.g. "Silverbrook Spring → Central Market Square". */
  location        : String;
  /** Landmark names (`Landmarks.name`) the pipe runs between, in flow direction. */
  startPoint      : String;
  endPoint        : String;
  pipelineType    : PipelineType;
  diameter        : Decimal(9, 2); // mm
  length          : Decimal(9, 2); // m
  nominalFlowRate : Decimal(9, 2); // L/min — what the pipe carries at full capacity
  currentFlowRate : Decimal(9, 2); // L/min — what it carries right now
  currentPressure : Decimal(9, 2); // PSI   — water pressure right now
  lastMaintenance : DateTime;
  /** Route on the village map in grid units: "x,y x,y …", x/y in [0,8] from the
   *  south-west corner of cell A1 (centre of E6 = "4.5,5.5"), in flow direction. */
  mapPath         : String;
  sensors         : Composition of many Sensors on sensors.pipe = $self;
  repairs         : Composition of many Repairs on repairs.pipe = $self;
}

/** Flow/pressure sensor mounted on a water pipe. */
entity Sensors : cuid, managed {
  pipe        : Association to WaterPipes;
  sensorID    : String;
  flowRate    : Decimal(15, 2); // L/min measured by the sensor
  pressure    : Decimal(15, 2); // PSI measured by the sensor
  lastReading : DateTime;       // when the sensor last reported
}

/** Repair performed on a water pipe. */
entity Repairs : cuid, managed {
  pipe       : Association to WaterPipes;
  repairID   : UUID;
  issue      : String;
  repairDate : DateTime;
  repairedBy : String;
}

/** Kind of a village landmark. */
type LandmarkKind : String enum {
  spring;
  mill;
  market;
  inn;
  residential;
  bakery;
  farm;
  forest;
}

/** A landmark on the Oakhaven village map (chess-board cell A1…H8). */
entity Landmarks : cuid, managed {
  name       : String;
  kind       : LandmarkKind;
  /** Cell on the village map: column A–H (west → east) + row 1–8 (south → north). */
  gridCell   : String(2);
  /** pipeID of the branch that feeds this area (residential / bakery / farm only). */
  suppliedBy : String;
}

// ---------------------------------------------------------------------------
// Food — the village pantry
// ---------------------------------------------------------------------------

/** A food product of the village stock. */
entity StockItems : cuid, managed {
  itemID          : String;          // GRAIN, MILK, …
  name            : String;
  unit            : String;          // KG, L, Dozen, Number
  icon            : String;          // sap-icon://… (Tabler icons: sap-icon://ti/<name>)
  currentQuantity : Decimal(9, 2);   // in `unit`
  minStockLevel   : Decimal(9, 2);   // in `unit` — the level the village wants to stay above
  consumptionRate : Decimal(9, 2);   // `unit` per day the village uses up
  receivals       : Composition of many StockReceivals on receivals.item = $self;
}

/** A delivery of a stock item. (No rows yet.) */
entity StockReceivals : cuid, managed {
  item             : Association to StockItems;
  quantityReceived : Decimal(9, 2); // in the item's `unit`
  supplier         : String;
  receivedAt       : DateTime;
}

/** A message about a stock item. (No rows yet.) */
entity Notifications : cuid, managed {
  item         : Association to StockItems;
  message      : String;
  acknowledged : Boolean default false;
}

/**
 * Supply rule: tells Tobin's Week Ahead which stock items to follow and how they are delivered.
 * One row per followed item — add a row (or use the app dialog) to follow a new ingredient.
 */
entity SupplyRules : cuid, managed {
  item           : Association to StockItems;
  supplier       : String;
  leadTimeDays   : Integer;           // days between ordering and delivery
  saturdayFactor : Decimal(4, 2) default 1; // consumption on Saturday (market day) = rate × factor
  lastStatus     : String;            // last status a notification was sent for (green|orange|red)
  // Learned from the stock counts (see srv/lib/stock-learning.ts); empty until the first interval is counted.
  learnedRate           : Decimal(9, 3);  // `unit` per normal day
  learnedSaturdayFactor : Decimal(4, 2);  // consumption on Saturday = learnedRate × factor
  samples               : Integer default 0; // number of count intervals learned from
}

/** An order Tobin placed with a supplier: on its way until it is received or cancelled. */
entity StockOrders : cuid, managed {
  item             : Association to StockItems;
  quantity         : Decimal(9, 2);          // ordered, in the item's `unit`
  expectedAt       : Date;                   // the day the delivery should arrive
  status           : String default 'open';  // open | received | cancelled
  receivedQuantity : Decimal(9, 2);          // what actually arrived (set on receive)
}

/** A stock count: what Tobin really found on the shelf. The forecast learns from the differences. */
entity StockCounts : cuid, managed {
  item        : Association to StockItems;
  quantity    : Decimal(9, 2);   // counted, in the item's `unit`
  countedOn   : Date;            // the day it was counted (counts are start-of-day: counted in the morning)
  consumed    : Decimal(9, 2);   // used since the previous count (null for the first count)
  days        : Integer;         // days between the previous count and this one
}

// ---------------------------------------------------------------------------
// Ilse's Ledger — evidence of tampering: marks, a sealed change log and record fingerprints
// ---------------------------------------------------------------------------

/** Ilse marked a record as "not to be trusted": nobody should act on it. */
entity TrustMarks : cuid, managed {
  entityName  : String;                // e.g. "Sensors"
  recordID    : UUID;                  // ID of the marked record
  recordLabel : String;                // human label, e.g. "SENS-004"
  reason      : String(1000);          // Ilse's own words
  markedBy    : String;
  active      : Boolean default true;  // false = the mark was lifted (kept as evidence)
}

/**
 * One page of the sealed ledger: one changed field of one record. Every page carries the hash of
 * the page before it, so removing or editing an old page breaks the chain (see srv/lib/ledger-seal.ts).
 */
entity LedgerEntries : cuid {
  seq        : Integer;      // page number, 1, 2, 3 …
  at         : Timestamp;    // when the ledger noticed the change
  entityName : String;
  recordID   : UUID;
  recordLabel: String;
  field      : String;
  oldValue   : String(1000);
  newValue   : String(1000);
  changedBy  : String;       // modifiedBy of the record, or "?" when it changed outside the apps
  outsideApps: Boolean default false; // the record changed but its modifiedAt did not
  prevHash   : String(64);
  hash       : String(64);
}

/** Last known state of a followed record: what the ledger compares against. */
entity RecordSeals {
  key entityName : String;
  key recordID   : UUID;
  snapshot       : LargeString;  // JSON of the followed fields
  modifiedAt     : Timestamp;    // modifiedAt of the record when it was sealed
  sealedAt       : Timestamp;
}

// ---------------------------------------------------------------------------
// The Council's Monday — what the village council decided to pay for, per week
// ---------------------------------------------------------------------------

/**
 * One line of the council's weekly plan: money for one problem.
 * reserved → spent (automatically, when Maren logs the repair or Tobin receives the delivery) · released (taken out
 * of the plan, with a reason). Only reserved and spent lines count against the week's budget.
 */
entity CouncilDecisions : cuid, managed {
  weekStart  : Date;                    // the Monday of the meeting
  problemKey : String;                  // water:<pipeID> | food:<itemID>
  kind       : String;                  // water | food
  title      : String;                  // what it was about, e.g. "North Mill House → North Residential Area"
  cost       : Integer;                 // crowns out of the weekly budget
  note       : String(500);             // optional note of the council
  status     : String default 'reserved'; // reserved | spent | released
  spentAt    : Timestamp;               // when the work was done (repair logged / delivery received)
  spentBy    : String;                  // who did it, e.g. "Maren Holt"
}

/** A week the council locked its plan: from then on the plan only changes with a reason. */
entity CouncilWeeks {
  key weekStart : Date;
  lockedAt      : Timestamp;
  seenKeys      : LargeString;          // problems on the page when the plan was locked: later ones are "new since Monday"
}

/** The log of the plan: locked, changed (with the reason), money spent. Nothing is ever deleted from it. */
entity CouncilPlanLog : cuid, managed {
  weekStart  : Date;
  at         : Timestamp;
  action     : String;                  // locked | changed | spent
  summary    : String(1000);            // what changed, in plain words
  reason     : String(1000);            // the council's reason (for a change)
}

// ---------------------------------------------------------------------------
// Morning Round (Maren) — a pipe she saw is broken, until she logs the repair
// ---------------------------------------------------------------------------

/** Maren reports a broken pipe (a leak she saw, a burst joint …). Open until a repair is logged for that pipe. */
entity PipeReports : cuid, managed {
  pipe       : Association to WaterPipes;
  issue      : String(500);              // what she saw, in her own words
  reportedBy : String;
  reportedAt : Timestamp;
  closedAt   : Timestamp;                // set when a repair is logged for the pipe; null = still broken
  repair     : Association to Repairs;   // the repair that closed it
}
