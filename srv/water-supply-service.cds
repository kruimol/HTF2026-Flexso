using { oakhaven.curse as db } from '../db/schema';

/**
 * Water data of Oakhaven: pipes, their sensors and repairs, and the village landmarks.
 * Served at /odata/v4/water-supply — try http://localhost:4004/odata/v4/water-supply/WaterPipes
 */
// `impl` points CAP at the TypeScript handler file (written without the `.ts` extension).
service WaterSupplyService @(path: 'water-supply', impl: 'srv/water-supply-service') {

  @readonly
  entity WaterPipes as projection on db.WaterPipes {
    *,
    // 👋 EXAMPLE — a computed field. `virtual` = part of the API, but not a column in the database.
    //    CAP returns null for it until a handler fills it in: see addDaysSinceMaintenance in
    //    water-supply-service.ts. Shown as a column in src/oakhaven-app/webapp/view/Main.view.xml.
    virtual null as daysSinceMaintenance : Integer
  };

  @readonly
  entity Sensors    as projection on db.Sensors;

  @readonly
  entity Repairs    as projection on db.Repairs;

  @readonly
  entity Landmarks  as projection on db.Landmarks;

  // 💧 Maren's morning round — logic in srv/lib/water-priority.ts, shown by src/water-app.
  //    Try it: http://localhost:4004/odata/v4/water-supply/morningRound()

  /** One pipe on the round: its status, who depends on it and why it is at this position. */
  type RoundStop {
    rank                 : Integer;
    pipe_ID              : UUID;
    pipeID               : String;
    location             : String;
    pipelineType         : String;
    status               : String;        // alarm | unknown | warning | repaired | ok
    flowPercentage       : Integer;       // currentFlowRate / nominalFlowRate, in %
    nominalFlowRate      : Decimal(9, 2); // L/min
    currentFlowRate      : Decimal(9, 2); // L/min
    currentPressure      : Decimal(9, 2); // PSI
    problems             : String;        // what is wrong, in plain words
    dependants           : String;        // village | families | bakery | farms | nobody
    headline             : String;        // one line for the phone: who sits without water
    servedPlaces         : String;        // every place downstream that depends on this pipe
    households           : Integer;
    orderReason          : String;        // why this pipe is at this position
    dataWarning          : String;        // sensor and pipe record do not add up
    daysSinceMaintenance : Integer;
    mapPath              : String;
  }

  /** A landmark on the village map, with the state of its water supply. */
  type MapPlace {
    name         : String;
    kind         : String;
    gridCell     : String;
    supplyStatus : String;   // worst status of the pipes it depends on: alarm | unknown | warning | ok | ''
    supplyPercentage : Integer; // share of normal flow that reaches it (lowest flow % on its way)
    households   : Integer;
  }

  /** The whole round: the pipes that need Maren (in visiting order) and the ones that are fine. */
  type MorningRound {
    generatedAt  : Timestamp;
    alarmCount   : Integer;
    unknownCount : Integer;        // no reading, or older than 15 minutes
    repairedCount : Integer;       // repaired, waiting for new readings
    warningCount : Integer;
    okCount      : Integer;
    stops        : many RoundStop;
    fine         : many RoundStop;
    places       : many MapPlace;
  }

  /** Where Maren goes first, then where, and why — computed from the live pipe data. */
  function morningRound() returns MorningRound;

  /**
   * 💧 Maren logs a repair herself after a job: which pipe, what was wrong, the date and who did it.
   * The pipe then shows as repaired until new readings come in (see srv/lib/water-priority.ts).
   */
  action logRepair(pipe_ID : UUID, issue : String, repairDate : Date, repairedBy : String) returns Repairs;
}
