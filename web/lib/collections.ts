// Curated cross-media collections — knowledge no single API provides.
// IP collections use query strings resolved live against TMDB, IGDB, and
// MangaDex. Thematic collections (collectionType: "thematic") have empty
// queries and are populated entirely through the editor's manual-includes
// list — each item hand-picked rather than auto-discovered.

export interface CollectionTheme {
  // "R G B" triplets (0–255, space-separated) — matches the CSS custom
  // property format used throughout app/globals.css.
  primary: string;
  secondary: string;
}

export interface CollectionQueries {
  movie?: string | string[];
  tvShow?: string | string[];
  game?: string | string[];
  manga?: string | string[];
}

export interface CollectionDef {
  slug: string;
  name: string;
  tagline: string;
  theme: CollectionTheme;
  queries: CollectionQueries;
  // When set, movies are fetched via the TMDB Collection API (more accurate
  // than text search for oddly-titled entries) instead of plain query search.
  movieCollectionId?: number;
  featured?: boolean;
  // "thematic" = curated by trope/genre, populated via manual includes only.
  // Absent = IP/franchise collection (query-driven).
  collectionType?: "thematic";
}

export const COLLECTIONS: CollectionDef[] = [

  // ── IP Collections (24) ─────────────────────────────────────────────────────

  {
    slug: "star-wars",
    movieCollectionId: 10,
    name: "Star Wars",
    tagline: "A galaxy far, far away.",
    theme: { primary: "20 20 24", secondary: "230 190 80" },
    queries: {
      movie: "Star Wars",
      tvShow: ["The Mandalorian", "Andor", "Ahsoka", "The Bad Batch", "Obi-Wan Kenobi"],
      game: ["Star Wars Jedi", "Star Wars Battlefront", "Star Wars Squadrons"],
    },
    featured: true,
  },
  {
    slug: "marvel-cinematic-universe",
    name: "Marvel Cinematic Universe",
    tagline: "Earth's mightiest heroes, one shared universe.",
    theme: { primary: "178 24 30", secondary: "20 20 24" },
    queries: {
      movie: ["Avengers", "Iron Man", "Captain America", "Thor", "Guardians of the Galaxy", "Doctor Strange", "Black Panther", "Ant-Man", "Spider-Man: Homecoming", "Spider-Man: Far From Home", "Spider-Man: No Way Home"],
      tvShow: ["WandaVision", "Loki", "Hawkeye", "Moon Knight", "She-Hulk", "Ms. Marvel", "Secret Invasion"],
    },
    featured: true,
  },
  {
    slug: "dc-universe",
    name: "DC Universe",
    tagline: "Heroes. Villains. Legends.",
    theme: { primary: "16 20 40", secondary: "220 190 40" },
    queries: {
      movie: ["Batman", "The Dark Knight", "Superman", "Wonder Woman", "Justice League", "Aquaman", "Shazam", "The Flash", "Joker", "Black Adam"],
      tvShow: ["Arrow", "The Flash", "Supergirl", "Gotham", "Peacemaker", "Harley Quinn"],
      game: ["Batman: Arkham", "Injustice"],
    },
    featured: true,
  },
  {
    slug: "harry-potter",
    movieCollectionId: 1241,
    name: "Harry Potter",
    tagline: "The boy who lived.",
    theme: { primary: "116 26 26", secondary: "182 148 76" },
    queries: { movie: ["Harry Potter", "Fantastic Beasts"], game: "Hogwarts Legacy" },
    featured: true,
  },
  {
    slug: "lord-of-the-rings",
    name: "The Lord of the Rings",
    tagline: "One ring to rule them all.",
    theme: { primary: "24 60 40", secondary: "196 164 90" },
    queries: { movie: ["The Lord of the Rings", "The Hobbit"], tvShow: "The Rings of Power", game: "Shadow of Mordor" },
    featured: true,
  },
  {
    slug: "game-of-thrones",
    name: "Game of Thrones",
    tagline: "Winter is coming.",
    theme: { primary: "20 20 24", secondary: "150 30 30" },
    queries: { tvShow: ["Game of Thrones", "House of the Dragon"] },
    featured: true,
  },
  {
    slug: "one-piece",
    name: "One Piece",
    tagline: "I'm gonna be King of the Pirates!",
    theme: { primary: "200 30 30", secondary: "40 70 190" },
    queries: { manga: "One Piece", tvShow: "One Piece", game: "One Piece" },
    featured: true,
  },
  {
    slug: "naruto",
    name: "Naruto",
    tagline: "Believe it.",
    theme: { primary: "230 140 20", secondary: "20 20 24" },
    queries: { manga: "Naruto", tvShow: ["Naruto", "Boruto"], game: "Naruto" },
  },
  {
    slug: "dragon-ball",
    name: "Dragon Ball",
    tagline: "It's over 9000!",
    theme: { primary: "230 150 20", secondary: "40 90 190" },
    queries: { manga: "Dragon Ball", tvShow: ["Dragon Ball Z", "Dragon Ball Super"], game: "Dragon Ball" },
  },
  {
    slug: "pokemon",
    name: "Pokémon",
    tagline: "Gotta catch 'em all.",
    theme: { primary: "230 190 20", secondary: "40 90 190" },
    queries: { game: "Pokémon", tvShow: "Pokémon", manga: "Pokémon", movie: "Pokémon" },
    featured: true,
  },
  {
    slug: "the-legend-of-zelda",
    name: "The Legend of Zelda",
    tagline: "It's dangerous to go alone.",
    theme: { primary: "20 90 60", secondary: "220 190 90" },
    queries: { game: "The Legend of Zelda" },
    featured: true,
  },
  {
    slug: "final-fantasy",
    name: "Final Fantasy",
    tagline: "The power of friendship... and summons.",
    theme: { primary: "20 20 30", secondary: "60 190 210" },
    queries: { game: "Final Fantasy", movie: "Final Fantasy" },
    featured: true,
  },
  {
    slug: "studio-ghibli",
    name: "Studio Ghibli",
    tagline: "Every moment, a wonder.",
    theme: { primary: "55 90 55", secondary: "195 165 105" },
    queries: {
      movie: ["Spirited Away", "My Neighbor Totoro", "Princess Mononoke", "Howl's Moving Castle", "Nausicaä of the Valley of the Wind", "Castle in the Sky", "Kiki's Delivery Service", "Porco Rosso", "The Wind Rises", "Grave of the Fireflies", "Whisper of the Heart", "The Cat Returns", "The Tale of the Princess Kaguya", "When Marnie Was There", "The Boy and the Heron"],
    },
    featured: true,
  },
  {
    slug: "disney",
    name: "Disney",
    tagline: "Where dreams come true.",
    theme: { primary: "18 30 65", secondary: "195 165 75" },
    queries: {
      movie: ["The Lion King", "The Little Mermaid", "Beauty and the Beast", "Aladdin", "Mulan", "Moana", "Encanto", "Frozen", "Tangled", "Lilo & Stitch", "Hercules", "Tarzan", "The Hunchback of Notre Dame", "Pocahontas"],
      tvShow: ["DuckTales", "Kim Possible", "Phineas and Ferb"],
      game: "Disney",
    },
    featured: true,
  },
  {
    slug: "pixar",
    name: "Pixar",
    tagline: "Imagination has no limits.",
    theme: { primary: "30 75 170", secondary: "230 185 50" },
    queries: {
      movie: ["Toy Story", "Finding Nemo", "The Incredibles", "WALL-E", "Up", "Inside Out", "Coco", "Soul", "Luca", "Turning Red", "Brave", "Monsters Inc", "Cars", "A Bug's Life", "Onward", "Elemental"],
    },
    featured: true,
  },
  {
    slug: "dreamworks-animation",
    name: "DreamWorks Animation",
    tagline: "Stories for all ages.",
    theme: { primary: "20 70 60", secondary: "220 140 50" },
    queries: {
      // Array of sub-franchise names — each becomes its own named row on the
      // collection page instead of one merged "Movies" row.
      movie: ["Shrek", "How to Train Your Dragon", "Kung Fu Panda", "Madagascar", "Ice Age"],
    },
  },
  {
    slug: "james-bond",
    movieCollectionId: 645,
    name: "James Bond",
    tagline: "The name's Bond. James Bond.",
    theme: { primary: "12 14 18", secondary: "160 30 40" },
    queries: { movie: "James Bond", game: "GoldenEye" },
  },
  {
    slug: "jurassic-park",
    movieCollectionId: 328,
    name: "Jurassic Park",
    tagline: "Life finds a way.",
    theme: { primary: "20 60 30", secondary: "230 60 40" },
    queries: { movie: ["Jurassic Park", "Jurassic World"] },
  },
  {
    slug: "dune",
    name: "Dune",
    tagline: "He who controls the spice controls the universe.",
    theme: { primary: "75 55 20", secondary: "200 165 80" },
    queries: { movie: "Dune", tvShow: "Dune" },
  },
  {
    slug: "alien-predator",
    name: "Alien / Predator",
    tagline: "In space, no one can hear you scream.",
    theme: { primary: "10 12 14", secondary: "100 155 80" },
    queries: {
      movie: ["Alien", "Prometheus", "Predator", "Alien vs. Predator"],
      game: ["Alien: Isolation", "Aliens: Fireteam Elite"],
    },
  },
  {
    slug: "halo",
    name: "Halo",
    tagline: "Finish the fight.",
    theme: { primary: "20 60 90", secondary: "230 230 240" },
    queries: { game: "Halo", tvShow: "Halo" },
    featured: true,
  },
  {
    slug: "resident-evil",
    movieCollectionId: 17255,
    name: "Resident Evil",
    tagline: "Itchy. Tasty.",
    theme: { primary: "16 16 16", secondary: "150 20 20" },
    queries: { game: "Resident Evil", movie: "Resident Evil" },
  },
  {
    slug: "monsterverse",
    name: "Monsterverse",
    tagline: "Titans collide.",
    theme: { primary: "20 40 24", secondary: "230 120 30" },
    queries: { movie: ["Godzilla", "Kong: Skull Island"], game: "Godzilla" },
  },
  {
    slug: "transformers",
    movieCollectionId: 8650,
    name: "Transformers",
    tagline: "More than meets the eye.",
    theme: { primary: "20 24 30", secondary: "210 40 30" },
    queries: { movie: "Transformers", game: "Transformers" },
  },

  // ── Thematic Collections (24) ────────────────────────────────────────────────
  // All have empty queries — populate each via the editor's manual-includes
  // list. Items added there appear in the per-type rows on the page.

  {
    slug: "found-footage",
    name: "Found Footage",
    tagline: "You weren't supposed to see this.",
    theme: { primary: "12 12 12", secondary: "180 160 140" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "slashers",
    name: "Slashers",
    tagline: "The killer is still out there.",
    theme: { primary: "14 14 14", secondary: "200 20 20" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "psychological-horror",
    name: "Psychological Horror",
    tagline: "The horror was inside all along.",
    theme: { primary: "20 14 30", secondary: "160 40 160" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "cosmic-horror",
    name: "Cosmic Horror",
    tagline: "The universe is indifferent to your survival.",
    theme: { primary: "10 14 20", secondary: "60 130 150" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "gothic",
    name: "Gothic",
    tagline: "Beauty and dread, intertwined.",
    theme: { primary: "18 14 24", secondary: "120 80 160" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "anthology-horror",
    name: "Anthology Horror",
    tagline: "Every story ends badly.",
    theme: { primary: "16 16 16", secondary: "210 80 30" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "mecha",
    name: "Mecha",
    tagline: "Pilots, launch!",
    theme: { primary: "14 20 30", secondary: "60 160 220" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "isekai",
    name: "Isekai",
    tagline: "Transported to another world.",
    theme: { primary: "20 16 36", secondary: "140 100 210" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "wuxia-cultivation",
    name: "Wuxia & Cultivation",
    tagline: "The path to immortality is long.",
    theme: { primary: "10 30 20", secondary: "80 180 120" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "fairy-tale-retellings",
    name: "Fairy Tale Retellings",
    tagline: "Once upon a time, reimagined.",
    theme: { primary: "30 20 40", secondary: "190 130 200" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "time-travel",
    name: "Time Travel",
    tagline: "When are we?",
    theme: { primary: "14 16 30", secondary: "60 140 230" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "heist",
    name: "Heist",
    tagline: "Nothing goes according to plan.",
    theme: { primary: "16 16 16", secondary: "200 160 60" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "spy-espionage",
    name: "Spy & Espionage",
    tagline: "Eyes on target.",
    theme: { primary: "12 16 12", secondary: "60 180 80" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "true-crime",
    name: "True Crime",
    tagline: "The truth is stranger than fiction.",
    theme: { primary: "20 18 16", secondary: "160 40 40" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "courtroom-drama",
    name: "Courtroom Drama",
    tagline: "All rise.",
    theme: { primary: "16 24 40", secondary: "180 150 80" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "survival",
    name: "Survival",
    tagline: "Whatever it takes.",
    theme: { primary: "24 20 14", secondary: "180 120 40" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "martial-arts",
    name: "Martial Arts",
    tagline: "The fist speaks louder than words.",
    theme: { primary: "20 16 14", secondary: "180 40 30" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "pirates",
    name: "Pirates",
    tagline: "The sea belongs to no one.",
    theme: { primary: "16 30 40", secondary: "180 150 90" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "sports",
    name: "Sports",
    tagline: "Leave it all on the field.",
    theme: { primary: "20 70 40", secondary: "220 220 220" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "coming-of-age",
    name: "Coming of Age",
    tagline: "Figuring it out.",
    theme: { primary: "40 24 16", secondary: "220 170 80" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "robots-and-ai",
    name: "Robots & AI",
    tagline: "What does it mean to be human?",
    theme: { primary: "16 20 30", secondary: "80 160 230" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "slow-burn",
    name: "Slow Burn",
    tagline: "Worth the wait.",
    theme: { primary: "30 14 20", secondary: "190 120 140" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "enemies-to-lovers",
    name: "Enemies to Lovers",
    tagline: "I hate you. Don't stop.",
    theme: { primary: "40 12 16", secondary: "210 90 100" },
    queries: {},
    collectionType: "thematic",
  },
  {
    slug: "cooking-and-food",
    name: "Cooking & Food",
    tagline: "Food is love.",
    theme: { primary: "30 20 10", secondary: "210 160 60" },
    queries: {},
    collectionType: "thematic",
  },
];

export function getCollection(slug: string): CollectionDef | undefined {
  return COLLECTIONS.find((c) => c.slug === slug);
}
