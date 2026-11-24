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

  /** One part of the village: in order or not, and why. */
  type Area {
    areaKey        : String;
    name           : String;
    kind           : String;
    gridCell       : String;
    status         : String;        // ok | warning | trouble | unknown
    pipeID         : String;        // the pipe that brings the water in, '' = none in the register
    weakestPipeID  : String;        // worst pipe on the way from the spring, '' = all fine
    currentFlow    : Decimal(9, 2);
    nominalFlow    : Decimal(9, 2);
    flowPercent    : Integer;
    foodIssues     : Integer;       // bakery: Tobin's ingredients that are not green
    foodIssueNames : String;
  }

  /** One problem the council can spend money on, ranked. */
  type Problem {
    problemKey      : String;       // water:<pipeID> | food:<itemID>
    kind            : String;       // water | food
    tier            : Integer;      // 1 no water, 2 hunger this week, 3 water warning, 4 pantry warning, 5 nobody depends on it
    status          : String;       // warning | trouble
    refID           : String;
    name            : String;
    icon            : String;
    currentFlow     : Decimal(9, 2);
    nominalFlow     : Decimal(9, 2);
    flowPercent     : Integer;
    affectedAreas   : String;
    affectedCount   : Integer;
    currentQuantity : Decimal(9, 2);
    minStockLevel   : Decimal(9, 2);
    unit            : String;
    runOutDate      : Date;
    daysLeft        : Integer;      // -1 = not within the week
    cost            : Integer;      // crowns
    untrusted       : Boolean;      // Ilse marked it, or the record holds an impossible value
    trustReason     : String;
    planned         : Boolean;      // fits in the budget, most urgent first
  }

  /** A pipe on the village map, coloured by its state. */
  type PipeLine {
    pipeID  : String;
    status  : String;
    mapPath : String;
  }

  type VillageWeek {
    weekStart     : Date;
    budgetTotal   : Integer;
    budgetPlanned : Integer;
    budgetLeft    : Integer;
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

  /** The council agrees on its plan for the week (replaces an earlier plan of the same week). */
  action decide(weekStart : Date, entries : many DecisionEntry, note : String) returns Boolean;
}
