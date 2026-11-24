using { oakhaven.curse as db } from '../db/schema';

/**
 * Ilse's Ledger: what changed, when, and what is suspicious about it.
 * Served at /odata/v4/ledger — try http://localhost:4004/odata/v4/ledger/findings()
 *
 * Other apps can read the records nobody should act on:
 *   /odata/v4/ledger/TrustMarks?$filter=active eq true
 */
service LedgerService @(path: 'ledger', impl: 'srv/ledger-service') {

  @readonly
  entity TrustMarks    as projection on db.TrustMarks;

  /** Ilse browses the whole ledger at once (see the book in the app): no 1000-row cap. */
  @readonly
  @cds.query.limit: { default: 1000, max: 100000 }
  entity LedgerEntries as projection on db.LedgerEntries;

  /** One suspicious record, with the rule it breaks in plain words. */
  type Finding {
    entityName  : String;
    register    : String;   // register name in Dutch, e.g. "Sensoren"
    recordID    : UUID;
    recordLabel : String;
    rule        : String;   // sourcesDisagree | overCapacity | impossibleValue | futureDate | beforeRegister
                            // | unknownEditor | systemAccount | noName | nightChange | hiddenText | otherRegister
                            // | unknownPerson | enteredByOther | outsideApps
    explanation : String;   // one sentence Ilse can explain to the council
    changedBy   : String;   // modifiedBy of the record: a fact, not an accusation
    changedAt   : Timestamp;
    untrusted   : Boolean;  // Ilse marked the record as "niet te vertrouwen"
    mark_ID     : UUID;
    markReason  : String;
  }

  /** A moment: records changed by the same user within the same minute. */
  type LedgerEvent {
    eventKey     : String;
    at           : Timestamp;
    changedBy    : String;
    recordCount  : Integer;
    findingCount : Integer;
    records      : String;
    summary      : String;
  }

  /** The outcome of checking the seals of the ledger. */
  type LedgerCheck {
    intact      : Boolean;
    pages       : Integer;
    brokenAtSeq : Integer;
    message     : String;
  }

  /** One record the ledger follows: what it says now and how much changed since the seal. */
  type RecordInfo {
    entityName : String;
    register   : String;
    recordID   : UUID;
    recordLabel: String;
    summary    : String;   // the current values in words, e.g. "doorstroming 142 van max. 150 L/min · druk 58 PSI"
    changedBy  : String;
    changedAt  : Timestamp;
    pages      : Integer;  // pages about this record in the ledger since the seal
  }

  /** Every record the ledger follows (the sealed records). */
  function records() returns many RecordInfo;

  /** Every suspicious record, worst moment first. */
  function findings() returns many Finding;

  /** The suspicious records grouped per moment. */
  function events() returns many LedgerEvent;

  /** Walks the sealed ledger page by page. */
  function verifyLedger() returns LedgerCheck;

  /** Mark a record as "niet te vertrouwen", with Ilse's reason. */
  action markUntrusted(entityName : String, recordID : UUID, recordLabel : String, reason : String) returns Boolean;

  /** Lift a mark (it stays in the ledger as evidence). */
  action clearMark(mark_ID : UUID) returns Boolean;
}
