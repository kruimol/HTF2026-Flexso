using { oakhaven.curse as db } from '../db/schema';

/**
 * The Council's Monday: how Oakhaven is doing this week and where the money should go.
 * Served at /odata/v4/council — try http://localhost:4004/odata/v4/council/villageWeek()
 *
 * Reads the water register, Tobin's food forecast and Ilse's trust marks; writes nothing but the
 * council's own decisions.
 */
service CouncilService @(path: 'council', impl: 'srv/council-service') {

  @readonly
  entity CouncilDecisions as projection on db.CouncilDecisions;

  @readonly
  entity CouncilPlanLog   as projection on db.CouncilPlanLog;

  /** One part of the village: in order or not, and why. */
  type Area {
    areaKey        : String;
    name           : String;
    kind           : String;
    gridCell       : String;
    status         : String;        // ok | repaired | warning | trouble | unknown
    pipeID         : String;        // the pipe that brings the water in, '' = none in the register
    weakestPipeID  : String;        // worst pipe on the way from the spring, '' = all fine
    currentFlow    : Decimal(9, 2);
    nominalFlow    : Decimal(9, 2);
    flowPercent    : Integer;
    households     : Integer;       // Maren: families behind the pipe
    waterNote      : String;        // Maren's line when the pipe is reported broken or repaired
    foodIssues     : Integer;       // bakery: Tobin's ingredients that are not green
    foodIssueNames : String;
  }

  /** One problem the council can spend money on, ranked. */
  type Problem {
    problemKey      : String;       // water:<pipeID> | food:<itemID>
    kind            : String;       // water | food
    tier            : Integer;      // 1 no water, 2 hunger this week, 3 water warning, 4 pantry warning, 5 nobody depends on it
    status          : String;       // warning | trouble | unknown
    refID           : String;
    name            : String;
    icon            : String;
    currentFlow     : Decimal(9, 2);
    nominalFlow     : Decimal(9, 2);
    flowPercent     : Integer;
    affectedAreas   : String;
    affectedCount   : Integer;
    households      : Integer;
    roundRank       : Integer;      // Maren's visiting order (water)
    reportedBroken  : Boolean;      // Maren saw it broken herself
    note            : String;       // what Maren saw
    currentQuantity : Decimal(9, 2);
    minStockLevel   : Decimal(9, 2);
    unit            : String;
    runOutDate      : Date;
    daysLeft        : Integer;      // -1 = not within the week
    cost            : Integer;      // crowns
    untrusted       : Boolean;      // Ilse marked it, or the record holds an impossible value
    doubtKind       : String;       // ilse | data (impossible value) | waterData (Maren's data check) | noReading
    trustReason     : String;
    planned         : Boolean;      // fits in the budget, most urgent first
    planStatus      : String;       // locked week: reserved | spent | new (came up after the plan was locked) | ''
  }

  /** A pipe on the village map, coloured by its state. */
  type PipeLine {
    pipeID  : String;
    status  : String;        // ok | repaired | warning | trouble | unknown
    mapPath : String;
  }

  type VillageWeek {
    weekStart     : Date;
    budgetTotal   : Integer;
    budgetPlanned : Integer;
    budgetLeft    : Integer;
    locked        : Boolean;        // the council locked this week's plan
    lockedAt      : Timestamp;
    budgetSpent   : Integer;        // work done: gone for good
    budgetReserved : Integer;       // set aside, work not done yet
    budgetFree    : Integer;
    areas         : many Area;
    problems      : many Problem;
    pipes         : many PipeLine;
  }

  /** The whole picture of this week, the biggest problems first. */
  function villageWeek() returns VillageWeek;

  /** One line of the plan the council agrees on. */
  type DecisionEntry {
    problemKey : String;
    kind       : String;
    title      : String;
    cost       : Integer;
  }

  /**
   * The first call of a week locks the plan: the money of every line is reserved. After that the plan
   * only changes with a reason (logged in CouncilPlanLog), and spent money cannot come back.
   */
  action decide(weekStart : Date, entries : many DecisionEntry, reason : String) returns Boolean;
}
