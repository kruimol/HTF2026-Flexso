/**
 * The places of the Oakhaven Hunt: who the children meet there and what mystery waits.
 *
 * Where a place lies comes from the village data (Landmarks: name, kind, gridCell); this file only
 * adds what the children see. The villagers are the four the teams talked to; a puzzle per place is
 * the next step of the hunt ("coming soon" for now).
 *
 * @namespace oakhaven.hunt.model
 */

export interface Villager {
  readonly name: string;
  readonly role: string;
  readonly initials: string;
  /** What they say when a child comes by. */
  readonly says: string;
}

export interface PlaceStory {
  /** The landmark name as in the village data. */
  readonly name: string;
  readonly kind: string;
  /** One line about the place, for children. */
  readonly about: string;
  readonly villagers: readonly Villager[];
  /** The mystery that will become this place's puzzle. */
  readonly mystery: string;
  /** The game of this place: solve it to earn the stamp. No game yet: the stamp is free. */
  readonly game?: "pipes" | "words" | "sheep" | "market" | "maze";
}

const MAREN: Villager = {
  name: "Maren Holt",
  role: "Water keeper",
  initials: "MH",
  says: "Shh, listen: the spring hums! Every drop of water in Oakhaven starts right here, and I walk the pipes every morning.",
};

const TOBIN: Villager = {
  name: "Tobin Reyes",
  role: "Baker",
  initials: "TR",
  says: "I'm the first one up in the whole village, at four in the morning. Smell that? The buns for the fair are almost ready!",
};

const ROWAN: Villager = {
  name: "Rowan Ashby",
  role: "Chair of the village council",
  initials: "RA",
  says: "Welcome to the square! Tonight the whole village comes here for the fair: lanterns, music and Tobin's buns.",
};

const ILSE: Villager = {
  name: "Ilse Vermeer",
  role: "Librarian",
  initials: "IV",
  says: "Every story of Oakhaven is written down somewhere. Some pages have strange letters on them. Can you read them?",
};

/** In the order a child would walk: from the spring down to the farms. */
export const PLACE_STORIES: readonly PlaceStory[] = [
  {
    name: "Silverbrook Spring",
    kind: "spring",
    about: "The clear spring in the hills where all of Oakhaven's water comes from.",
    villagers: [MAREN],
    mystery: "Behind the reeds is an old stone door, sealed shut. Someone signed it with two letters: W. S. Who could that be?",
    game: "pipes",
  },
  {
    name: "North Mill House",
    kind: "mill",
    about: "The old mill. Its water wheel turns all day long.",
    villagers: [],
    mystery: "How many spokes does the water wheel have? Count them on the map!",
  },
  {
    name: "North Residential Area",
    kind: "residential",
    about: "Five little houses where many villagers live.",
    villagers: [],
    mystery: "Every house has a coloured roof. Which colour appears twice?",
  },
  {
    name: "Deepwood Forest",
    kind: "forest",
    about: "Tall trees and quiet paths along the north and west of the village.",
    villagers: [],
    mystery: "Somewhere deep in the forest lies a torn page. Take your lantern and find your way between the trees!",
    game: "maze",
  },
  {
    name: "Central Market Square",
    kind: "market",
    about: "The heart of the village: stalls, a well, and tonight the fair.",
    villagers: [ROWAN, ILSE],
    mystery: "The fair is tonight, but the market wagon tipped over and everything is mixed up! Help Rowan bring every product to the right stall.",
    game: "market",
  },
  {
    name: "The Bakery",
    kind: "bakery",
    about: "Where Tobin bakes bread every day. The chimney is always smoking.",
    villagers: [TOBIN],
    mystery: "Tobin's recipe book got wet and all the words ran together. Can you find his baking words again?",
    game: "words",
  },
  {
    name: "Shepherd's Inn",
    kind: "inn",
    about: "Travellers rest here. The copper sign creaks in the wind.",
    villagers: [],
    mystery: "A traveller left a note at the inn. What does it say?",
  },
  {
    name: "South Meadow Farms",
    kind: "farm",
    about: "Fields of grain and green grass, and a few sheep.",
    villagers: [],
    mystery: "The sheep are running wild across the meadow! Can you count them? Careful: Shep the sheepdog runs along too.",
    game: "sheep",
  },
];
