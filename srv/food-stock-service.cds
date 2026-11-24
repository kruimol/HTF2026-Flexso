using { oakhaven.curse as db } from '../db/schema';

/**
 * Food data of Oakhaven: the village pantry.
 * Served at /odata/v4/food-stock — try http://localhost:4004/odata/v4/food-stock/StockItems
 */
// `impl` points CAP at the TypeScript handler file (written without the `.ts` extension).
service FoodStockService @(path: 'food-stock', impl: 'srv/food-stock-service') {

  @readonly
  entity StockItems     as projection on db.StockItems;

  @readonly
  entity StockReceivals as projection on db.StockReceivals;

  @readonly
  entity Notifications  as projection on db.Notifications;

  @readonly
  entity SupplyRules    as projection on db.SupplyRules;

  @readonly
  entity StockOrders    as projection on db.StockOrders;

  @readonly
  entity StockCounts    as projection on db.StockCounts;

  // --- Tobin's Week Ahead -------------------------------------------------------------------

  /** One day of the forecast: the stock at the start of the day (when Tobin starts baking). */
  type DayForecast {
    date          : Date;
    startQuantity : Decimal(9, 2);
    consumption   : Decimal(9, 2);
    isSaturday    : Boolean;
    short         : Boolean;   // not enough stock to bake the whole day
  }

  /** The week ahead of one followed ingredient. */
  type WeekAheadItem {
    itemUUID        : UUID;
    itemID          : String;
    name            : String;
    icon            : String;
    unit            : String;
    supplier        : String;
    leadTimeDays    : Integer;
    currentQuantity : Decimal(9, 2);
    minStockLevel   : Decimal(9, 2);
    dataSuspect     : Boolean;      // stock below zero: the record is unreliable
    status          : String;       // green | orange | red
    reason          : String;       // ok | belowMin | belowHalfMin | orderToday | orderOverdue
    runOutDate      : Date;         // first day the stock is not enough, null = not within a week
    orderByDate     : Date;         // last day to order, null = nothing to order this week
    adviceQuantity  : Decimal(9, 2); // how much to order to get through the week above the minimum (open orders deducted)
    incomingQuantity : Decimal(9, 2); // total of the open orders on their way
    nextArrivalDate : Date;         // earliest expected arrival of an open order (never in the past)
    ratePerDay      : Decimal(9, 3); // use per normal day the forecast works with
    dataRate        : Decimal(9, 3); // use per day in the village records
    rateLearned     : Boolean;      // true once the forecast learned from stock counts
    samples         : Integer;      // count intervals learned from
    saturdayFactor  : Decimal(4, 2); // Saturday use relative to a normal day
    lastCountedOn   : Date;         // day of the last stock count, null = never counted
    days            : many DayForecast;
  }

  /** The forecast of every followed ingredient, worst first. */
  function weekAhead() returns many WeekAheadItem;

  /** Follow an ingredient (or change its supply rule). */
  action saveSupplyRule(item_ID : UUID, supplier : String, leadTimeDays : Integer, saturdayFactor : Decimal(4, 2)) returns Boolean;

  /** Stop following an ingredient. */
  action removeSupplyRule(item_ID : UUID) returns Boolean;

  /** Register an order that is on its way. */
  action placeOrder(item_ID : UUID, quantity : Decimal(9, 2), expectedAt : Date) returns Boolean;

  /** An open order arrived: adds what arrived to the stock and closes the order. */
  action receiveOrder(order_ID : UUID, quantityReceived : Decimal(9, 2)) returns Boolean;

  /** A delivery arrived that was not ordered here: adds it to the stock. */
  action receiveDelivery(item_ID : UUID, quantityReceived : Decimal(9, 2)) returns Boolean;

  /** One stock count entry: what was really found on the shelf. */
  type CountEntry {
    item_ID  : UUID;
    quantity : Decimal(9, 2);
  }

  /** Register a stock count (morning). Replaces the stock and teaches the forecast the real use. */
  action recordCounts(counts : many CountEntry, countedOn : Date) returns Boolean;

  /** Cancel an open order. */
  action cancelOrder(order_ID : UUID) returns Boolean;
}
