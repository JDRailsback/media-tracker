// Curated cross-media collections — knowledge no single API provides.
// Every collection's membership is the `curated` field: an exact,
// hand-picked title list per type, chosen by franchise/theme knowledge (not
// title-text matching — e.g. Nickelodeon includes "Avatar: The Last
// Airbender" and "Rango", Star Wars includes "Knights of the Old Republic").
// scripts/rebuild-collections.ts resolves these titles to catalog_items ids
// ONCE, into the collection_items table — a static grouping, never updated
// live. To change a collection: edit its curated list here and rerun
// `npm run rebuild-collections`, or pin/hide individual items through the
// editor (includeOverrides/excludeIds), which layer on top at read time.
//
// `queries` remains in the type only because the editor/override DB row
// still carries the field — it is NOT used to populate anything anymore.

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

export type CollectionPartType = "movie" | "tvShow" | "game" | "manga";

// Exact, hand-picked title lists per type — the sole population source for
// a collection. Resolved against catalog_items by exact → prefix → contains
// title match (an id lookup for a hand-chosen title, not discovery); a title
// the catalog doesn't have yet is logged by the rebuild script and simply
// resolves later once a bigger ingest includes it.
export type CollectionCurated = Partial<Record<CollectionPartType, string[]>>;

export interface CollectionDef {
  slug: string;
  name: string;
  tagline: string;
  theme: CollectionTheme;
  queries: CollectionQueries;
  // Dead field, kept only because the editor form/override rows still carry
  // it — the TMDB Collection endpoint hasn't been called since the app went
  // catalog-only, and curated lists replaced it as the membership source.
  movieCollectionId?: number;
  featured?: boolean;
  // "thematic" = curated by trope/genre rather than a franchise/IP.
  collectionType?: "thematic";
  curated?: CollectionCurated;
}

export const COLLECTIONS: CollectionDef[] = [

  // ── IP Collections (24) ─────────────────────────────────────────────────────

  {
    slug: "star-wars",
    name: "Star Wars",
    tagline: "A galaxy far, far away.",
    theme: { primary: "20 20 24", secondary: "230 190 80" },
    queries: {},
    curated: {
      movie: ["Star Wars", "The Empire Strikes Back", "Return of the Jedi", "The Phantom Menace", "Attack of the Clones", "Revenge of the Sith", "The Force Awakens", "The Last Jedi", "The Rise of Skywalker", "Rogue One", "Solo: A Star Wars Story", "Star Wars: The Clone Wars"],
      tvShow: ["The Mandalorian", "Andor", "Ahsoka", "Star Wars: The Bad Batch", "Obi-Wan Kenobi", "The Book of Boba Fett", "Star Wars: The Clone Wars", "Star Wars Rebels", "The Acolyte", "Star Wars: Visions", "Star Wars: Skeleton Crew"],
      game: ["Star Wars Jedi: Fallen Order", "Star Wars Jedi: Survivor", "Star Wars: Battlefront", "Star Wars: Battlefront II", "Star Wars Battlefront", "Star Wars Battlefront II", "Star Wars: Squadrons", "Star Wars: Knights of the Old Republic", "Star Wars: Knights of the Old Republic II", "Star Wars: The Old Republic", "Star Wars: Republic Commando", "Star Wars: Empire at War", "Star Wars: The Force Unleashed", "Star Wars: The Force Unleashed II", "LEGO Star Wars: The Skywalker Saga", "LEGO Star Wars: The Complete Saga", "Star Wars Outlaws", "Star Wars: Dark Forces", "Star Wars: Jedi Knight II - Jedi Outcast", "Star Wars: Jedi Knight - Jedi Academy"],
    },
    featured: true,
  },
  {
    slug: "marvel-cinematic-universe",
    name: "Marvel Cinematic Universe",
    tagline: "Earth's mightiest heroes, one shared universe.",
    theme: { primary: "178 24 30", secondary: "20 20 24" },
    queries: {},
    curated: {
      movie: ["Iron Man", "Iron Man 2", "Iron Man 3", "The Incredible Hulk", "Thor", "Captain America: The First Avenger", "The Avengers", "Thor: The Dark World", "Captain America: The Winter Soldier", "Guardians of the Galaxy", "Avengers: Age of Ultron", "Ant-Man", "Captain America: Civil War", "Doctor Strange", "Guardians of the Galaxy Vol. 2", "Spider-Man: Homecoming", "Thor: Ragnarok", "Black Panther", "Avengers: Infinity War", "Ant-Man and the Wasp", "Captain Marvel", "Avengers: Endgame", "Spider-Man: Far From Home", "Black Widow", "Shang-Chi and the Legend of the Ten Rings", "Eternals", "Spider-Man: No Way Home", "Doctor Strange in the Multiverse of Madness", "Thor: Love and Thunder", "Black Panther: Wakanda Forever", "Ant-Man and the Wasp: Quantumania", "Guardians of the Galaxy Vol. 3", "The Marvels", "Deadpool & Wolverine", "Captain America: Brave New World", "Thunderbolts", "The Fantastic 4: First Steps"],
      tvShow: ["WandaVision", "Loki", "The Falcon and the Winter Soldier", "Hawkeye", "Moon Knight", "Ms. Marvel", "She-Hulk: Attorney at Law", "Secret Invasion", "What If...?", "Echo", "Agatha All Along", "Daredevil", "Daredevil: Born Again", "Agents of S.H.I.E.L.D."],
    },
    featured: true,
  },
  {
    slug: "dc-universe",
    name: "DC Universe",
    tagline: "Heroes. Villains. Legends.",
    theme: { primary: "16 20 40", secondary: "220 190 40" },
    queries: {},
    curated: {
      movie: ["Batman Begins", "The Dark Knight", "The Dark Knight Rises", "Batman", "Batman Returns", "Batman Forever", "Batman & Robin", "Man of Steel", "Batman v Superman: Dawn of Justice", "Suicide Squad", "Wonder Woman", "Justice League", "Zack Snyder's Justice League", "Aquaman", "Aquaman and the Lost Kingdom", "Shazam!", "Shazam! Fury of the Gods", "Birds of Prey (and the Fantabulous Emancipation of One Harley Quinn)", "Wonder Woman 1984", "The Suicide Squad", "The Batman", "Black Adam", "The Flash", "Blue Beetle", "Joker", "Joker: Folie à Deux", "Superman", "Superman II", "Superman Returns", "Watchmen", "V for Vendetta", "Constantine", "The Lego Batman Movie", "Batman: Mask of the Phantasm", "Batman: The Killing Joke", "Batman: Under the Red Hood"],
      tvShow: ["Arrow", "The Flash", "Supergirl", "Gotham", "Titans", "Doom Patrol", "Peacemaker", "Harley Quinn", "Smallville", "Superman & Lois", "Batman: The Animated Series", "Young Justice", "Watchmen", "The Sandman", "Lucifer"],
      game: ["Batman: Arkham Asylum", "Batman: Arkham City", "Batman: Arkham Knight", "Batman: Arkham Origins", "Injustice: Gods Among Us", "Injustice 2", "Gotham Knights", "Suicide Squad: Kill the Justice League", "LEGO Batman: The Videogame"],
    },
    featured: true,
  },
  {
    slug: "harry-potter",
    name: "Harry Potter",
    tagline: "The boy who lived.",
    theme: { primary: "116 26 26", secondary: "182 148 76" },
    queries: {},
    curated: {
      movie: ["Harry Potter and the Philosopher's Stone", "Harry Potter and the Chamber of Secrets", "Harry Potter and the Prisoner of Azkaban", "Harry Potter and the Goblet of Fire", "Harry Potter and the Order of the Phoenix", "Harry Potter and the Half-Blood Prince", "Harry Potter and the Deathly Hallows: Part 1", "Harry Potter and the Deathly Hallows: Part 2", "Fantastic Beasts and Where to Find Them", "Fantastic Beasts: The Crimes of Grindelwald", "Fantastic Beasts: The Secrets of Dumbledore"],
      game: ["Hogwarts Legacy", "LEGO Harry Potter: Years 1-4", "LEGO Harry Potter: Years 5-7"],
    },
    featured: true,
  },
  {
    slug: "lord-of-the-rings",
    name: "The Lord of the Rings",
    tagline: "One ring to rule them all.",
    theme: { primary: "24 60 40", secondary: "196 164 90" },
    queries: {},
    curated: {
      movie: ["The Lord of the Rings: The Fellowship of the Ring", "The Lord of the Rings: The Two Towers", "The Lord of the Rings: The Return of the King", "The Hobbit: An Unexpected Journey", "The Hobbit: The Desolation of Smaug", "The Hobbit: The Battle of the Five Armies", "The Lord of the Rings: The War of the Rohirrim"],
      tvShow: ["The Lord of the Rings: The Rings of Power"],
      game: ["Middle-earth: Shadow of Mordor", "Middle-earth: Shadow of War", "LEGO The Lord of the Rings", "The Lord of the Rings: Return to Moria", "The Lord of the Rings Online"],
    },
    featured: true,
  },
  {
    slug: "nickelodeon",
    name: "Nickelodeon",
    tagline: "The first kids' network.",
    theme: { primary: "235 110 20", secondary: "255 250 245" },
    queries: {},
    curated: {
      tvShow: ["SpongeBob SquarePants", "Avatar: The Last Airbender", "The Legend of Korra", "Rugrats", "Hey Arnold!", "The Fairly OddParents", "Danny Phantom", "The Adventures of Jimmy Neutron: Boy Genius", "iCarly", "Drake & Josh", "Victorious", "Zoey 101", "The Loud House", "Invader Zim", "The Ren & Stimpy Show", "CatDog", "Rocket Power", "The Wild Thornberrys", "Big Time Rush", "Ned's Declassified School Survival Guide", "Are You Afraid of the Dark?", "Kamp Koral: SpongeBob's Under Years", "Teenage Mutant Ninja Turtles"],
      movie: ["The SpongeBob SquarePants Movie", "The SpongeBob Movie: Sponge Out of Water", "The SpongeBob Movie: Sponge on the Run", "Jimmy Neutron: Boy Genius", "The Rugrats Movie", "Rango", "Teenage Mutant Ninja Turtles: Mutant Mayhem", "The Last Airbender", "The Adventures of Tintin", "Good Burger", "Harriet the Spy"],
      game: ["SpongeBob SquarePants: Battle for Bikini Bottom", "SpongeBob SquarePants: Battle for Bikini Bottom - Rehydrated", "SpongeBob SquarePants: The Cosmic Shake", "Nickelodeon All-Star Brawl", "Teenage Mutant Ninja Turtles: Shredder's Revenge", "SpongeBob SquarePants: Creature From the Krusty Krab"],
    },
    featured: true,
  },
  {
    slug: "one-piece",
    name: "One Piece",
    tagline: "I'm gonna be King of the Pirates!",
    theme: { primary: "200 30 30", secondary: "40 70 190" },
    queries: {},
    curated: {
      manga: ["One Piece"],
      tvShow: ["One Piece"],
      movie: ["One Piece Film Red", "One Piece: Stampede", "One Piece Film: GOLD", "One Piece Film: Z", "One Piece Film: Strong World"],
      game: ["One Piece: Pirate Warriors 4", "One Piece: Pirate Warriors 3", "One Piece Odyssey", "One Piece: Burning Blood", "One Piece: World Seeker", "One Piece: Unlimited World Red"],
    },
    featured: true,
  },
  {
    slug: "naruto",
    name: "Naruto",
    tagline: "Believe it.",
    theme: { primary: "230 140 20", secondary: "20 20 24" },
    queries: {},
    curated: {
      tvShow: ["Naruto", "Naruto Shippūden", "Boruto: Naruto Next Generations"],
      movie: ["The Last: Naruto the Movie", "Road to Ninja: Naruto the Movie", "Boruto: Naruto the Movie"],
      game: ["Naruto Shippuden: Ultimate Ninja Storm 4", "Naruto Shippuden: Ultimate Ninja Storm 3", "Naruto Shippuden: Ultimate Ninja Storm 2", "Naruto: Ultimate Ninja Storm", "Naruto x Boruto: Ultimate Ninja Storm Connections", "Naruto to Boruto: Shinobi Striker"],
    },
  },
  {
    slug: "dragon-ball",
    name: "Dragon Ball",
    tagline: "It's over 9000!",
    theme: { primary: "230 150 20", secondary: "40 90 190" },
    queries: {},
    curated: {
      tvShow: ["Dragon Ball", "Dragon Ball Z", "Dragon Ball GT", "Dragon Ball Super", "Dragon Ball Daima"],
      movie: ["Dragon Ball Super: Broly", "Dragon Ball Super: Super Hero", "Dragon Ball Z: Battle of Gods", "Dragon Ball Z: Resurrection 'F'"],
      game: ["Dragon Ball FighterZ", "Dragon Ball Z: Kakarot", "Dragon Ball: Xenoverse", "Dragon Ball: Xenoverse 2", "Dragon Ball: Sparking! Zero", "Dragon Ball Z: Budokai Tenkaichi 3", "Dragon Ball Z: Budokai 3"],
    },
  },
  {
    slug: "pokemon",
    name: "Pokémon",
    tagline: "Gotta catch 'em all.",
    theme: { primary: "230 190 20", secondary: "40 90 190" },
    queries: {},
    curated: {
      game: ["Pokémon Red Version", "Pokémon Blue Version", "Pokémon Yellow Version", "Pokémon Gold Version", "Pokémon Silver Version", "Pokémon Crystal Version", "Pokémon Ruby Version", "Pokémon Sapphire Version", "Pokémon Emerald Version", "Pokémon FireRed Version", "Pokémon LeafGreen Version", "Pokémon Diamond Version", "Pokémon Pearl Version", "Pokémon Platinum Version", "Pokémon HeartGold Version", "Pokémon SoulSilver Version", "Pokémon Black Version", "Pokémon White Version", "Pokémon X", "Pokémon Y", "Pokémon Omega Ruby", "Pokémon Alpha Sapphire", "Pokémon Sun", "Pokémon Moon", "Pokémon: Let's Go, Pikachu!", "Pokémon Sword", "Pokémon Shield", "Pokémon Brilliant Diamond", "Pokémon Legends: Arceus", "Pokémon Scarlet", "Pokémon Violet", "Pokémon Go", "Pokémon Colosseum", "Pokkén Tournament", "New Pokémon Snap", "Pokémon Mystery Dungeon: Explorers of Time"],
      tvShow: ["Pokémon", "Pokémon Concierge", "Pokémon Horizons: The Series"],
      movie: ["Pokémon Detective Pikachu", "Pokémon: The First Movie", "Pokémon: The Movie 2000"],
    },
    featured: true,
  },
  {
    slug: "the-legend-of-zelda",
    name: "The Legend of Zelda",
    tagline: "It's dangerous to go alone.",
    theme: { primary: "20 90 60", secondary: "220 190 90" },
    queries: {},
    curated: {
      game: ["The Legend of Zelda: Breath of the Wild", "The Legend of Zelda: Tears of the Kingdom", "The Legend of Zelda: Ocarina of Time", "The Legend of Zelda: Majora's Mask", "The Legend of Zelda: A Link to the Past", "The Legend of Zelda: Twilight Princess", "The Legend of Zelda: Skyward Sword", "The Legend of Zelda: The Wind Waker", "The Legend of Zelda: Link's Awakening", "The Legend of Zelda: A Link Between Worlds", "The Legend of Zelda: The Minish Cap", "The Legend of Zelda: Echoes of Wisdom", "The Legend of Zelda", "Zelda II: The Adventure of Link", "The Legend of Zelda: Oracle of Ages", "The Legend of Zelda: Phantom Hourglass", "The Legend of Zelda: Spirit Tracks", "Hyrule Warriors: Age of Calamity", "Cadence of Hyrule: Crypt of the NecroDancer"],
    },
    featured: true,
  },
  {
    slug: "final-fantasy",
    name: "Final Fantasy",
    tagline: "The power of friendship... and summons.",
    theme: { primary: "20 20 30", secondary: "60 190 210" },
    queries: {},
    curated: {
      game: ["Final Fantasy", "Final Fantasy II", "Final Fantasy III", "Final Fantasy IV", "Final Fantasy V", "Final Fantasy VI", "Final Fantasy VII", "Final Fantasy VIII", "Final Fantasy IX", "Final Fantasy X", "Final Fantasy XII", "Final Fantasy XIII", "Final Fantasy XIV", "Final Fantasy XV", "Final Fantasy XVI", "Final Fantasy VII Remake", "Final Fantasy VII Rebirth", "Crisis Core: Final Fantasy VII", "Final Fantasy Tactics", "Final Fantasy X-2", "Stranger of Paradise: Final Fantasy Origin", "World of Final Fantasy", "Dissidia Final Fantasy NT"],
      movie: ["Final Fantasy VII: Advent Children", "Final Fantasy: The Spirits Within", "Kingsglaive: Final Fantasy XV"],
    },
    featured: true,
  },
  {
    slug: "studio-ghibli",
    name: "Studio Ghibli",
    tagline: "Every moment, a wonder.",
    theme: { primary: "55 90 55", secondary: "195 165 105" },
    queries: {},
    curated: {
      // Nausicaä (pre-Ghibli but canon) isn't in the current catalog — left
      // in so it resolves automatically on a future, larger ingest.
      movie: ["Spirited Away", "My Neighbor Totoro", "Princess Mononoke", "Howl's Moving Castle", "Nausicaä of the Valley of the Wind", "Castle in the Sky", "Kiki's Delivery Service", "Porco Rosso", "The Wind Rises", "Grave of the Fireflies", "Whisper of the Heart", "The Cat Returns", "The Tale of the Princess Kaguya", "When Marnie Was There", "The Boy and the Heron", "Ponyo", "Arrietty", "From Up on Poppy Hill", "Pom Poko", "Only Yesterday", "Tales from Earthsea", "Ocean Waves", "My Neighbors the Yamadas"],
    },
    featured: true,
  },
  {
    slug: "disney",
    name: "Disney",
    tagline: "Where dreams come true.",
    theme: { primary: "18 30 65", secondary: "195 165 75" },
    queries: {},
    curated: {
      movie: ["Snow White and the Seven Dwarfs", "Pinocchio", "Fantasia", "Dumbo", "Bambi", "Cinderella", "Alice in Wonderland", "Peter Pan", "Lady and the Tramp", "Sleeping Beauty", "One Hundred and One Dalmatians", "The Jungle Book", "The Aristocats", "Robin Hood", "The Fox and the Hound", "The Great Mouse Detective", "Oliver & Company", "The Little Mermaid", "Beauty and the Beast", "Aladdin", "The Lion King", "Pocahontas", "The Hunchback of Notre Dame", "Hercules", "Mulan", "Tarzan", "The Emperor's New Groove", "Atlantis: The Lost Empire", "Lilo & Stitch", "Treasure Planet", "Brother Bear", "Chicken Little", "Meet the Robinsons", "Bolt", "The Princess and the Frog", "Tangled", "Wreck-It Ralph", "Ralph Breaks the Internet", "Frozen", "Frozen II", "Big Hero 6", "Zootopia", "Zootopia 2", "Moana", "Moana 2", "Raya and the Last Dragon", "Encanto", "Strange World", "Wish", "Maleficent", "Cruella", "Enchanted", "Mary Poppins", "Hocus Pocus", "The Nightmare Before Christmas"],
      tvShow: ["DuckTales", "Kim Possible", "Phineas and Ferb", "Gravity Falls", "The Owl House", "Amphibia", "Star vs. the Forces of Evil", "Darkwing Duck", "TaleSpin", "Gargoyles", "Recess"],
      game: ["Kingdom Hearts", "Kingdom Hearts II", "Kingdom Hearts III", "Disney Dreamlight Valley", "Epic Mickey", "Disney's Aladdin", "The Lion King"],
    },
    featured: true,
  },
  {
    slug: "pixar",
    name: "Pixar",
    tagline: "Imagination has no limits.",
    theme: { primary: "30 75 170", secondary: "230 185 50" },
    queries: {},
    curated: {
      movie: ["Toy Story", "Toy Story 2", "Toy Story 3", "Toy Story 4", "A Bug's Life", "Monsters, Inc.", "Monsters University", "Finding Nemo", "Finding Dory", "The Incredibles", "Incredibles 2", "Cars", "Cars 2", "Cars 3", "Ratatouille", "WALL·E", "Up", "Brave", "Inside Out", "Inside Out 2", "The Good Dinosaur", "Coco", "Onward", "Soul", "Luca", "Turning Red", "Lightyear", "Elemental", "Elio"],
    },
    featured: true,
  },
  {
    slug: "dreamworks-animation",
    name: "DreamWorks Animation",
    tagline: "Stories for all ages.",
    theme: { primary: "20 70 60", secondary: "220 140 50" },
    queries: {},
    curated: {
      movie: ["Shrek", "Shrek 2", "Shrek the Third", "Shrek Forever After", "Puss in Boots", "Puss in Boots: The Last Wish", "How to Train Your Dragon", "How to Train Your Dragon 2", "How to Train Your Dragon: The Hidden World", "Kung Fu Panda", "Kung Fu Panda 2", "Kung Fu Panda 3", "Kung Fu Panda 4", "Madagascar", "Madagascar: Escape 2 Africa", "Madagascar 3: Europe's Most Wanted", "Penguins of Madagascar", "The Croods", "Trolls", "The Boss Baby", "Megamind", "Monsters vs Aliens", "Antz", "The Prince of Egypt", "The Road to El Dorado", "Spirit: Stallion of the Cimarron", "Shark Tale", "Over the Hedge", "Bee Movie", "Rise of the Guardians", "Captain Underpants: The First Epic Movie", "Abominable", "The Bad Guys", "The Wild Robot", "Chicken Run", "Flushed Away"],
    },
  },
  {
    slug: "james-bond",
    name: "James Bond",
    tagline: "The name's Bond. James Bond.",
    theme: { primary: "12 14 18", secondary: "160 30 40" },
    queries: {},
    curated: {
      movie: ["Dr. No", "From Russia with Love", "Goldfinger", "Thunderball", "You Only Live Twice", "On Her Majesty's Secret Service", "Diamonds Are Forever", "Live and Let Die", "The Man with the Golden Gun", "The Spy Who Loved Me", "Moonraker", "For Your Eyes Only", "Octopussy", "A View to a Kill", "The Living Daylights", "Licence to Kill", "GoldenEye", "Tomorrow Never Dies", "The World Is Not Enough", "Die Another Day", "Casino Royale", "Quantum of Solace", "Skyfall", "Spectre", "No Time to Die"],
      game: ["GoldenEye 007"],
    },
  },
  {
    slug: "jurassic-park",
    name: "Jurassic Park",
    tagline: "Life finds a way.",
    theme: { primary: "20 60 30", secondary: "230 60 40" },
    queries: {},
    curated: {
      movie: ["Jurassic Park", "The Lost World: Jurassic Park", "Jurassic Park III", "Jurassic World", "Jurassic World: Fallen Kingdom", "Jurassic World Dominion", "Jurassic World Rebirth"],
      tvShow: ["Jurassic World Camp Cretaceous", "Jurassic World: Chaos Theory"],
      game: ["Jurassic World Evolution", "Jurassic World Evolution 2", "Jurassic Park: The Game"],
    },
  },
  {
    slug: "dune",
    name: "Dune",
    tagline: "He who controls the spice controls the universe.",
    theme: { primary: "75 55 20", secondary: "200 165 80" },
    queries: {},
    curated: {
      movie: ["Dune", "Dune: Part Two", "Jodorowsky's Dune"],
      tvShow: ["Dune: Prophecy", "Children of Dune", "Frank Herbert's Dune"],
      game: ["Dune: Spice Wars", "Dune: Awakening", "Dune II: The Building of a Dynasty", "Dune 2000", "Emperor: Battle for Dune"],
    },
  },
  {
    slug: "alien-predator",
    name: "Alien / Predator",
    tagline: "In space, no one can hear you scream.",
    theme: { primary: "10 12 14", secondary: "100 155 80" },
    queries: {},
    curated: {
      movie: ["Alien", "Aliens", "Alien³", "Alien Resurrection", "Prometheus", "Alien: Covenant", "Alien: Romulus", "Predator", "Predator 2", "AVP: Alien vs. Predator", "Predators", "The Predator", "Prey", "Predator: Killer of Killers"],
      tvShow: ["Alien: Earth"],
      game: ["Alien: Isolation", "Aliens: Fireteam Elite", "Aliens: Dark Descent", "Predator: Hunting Grounds", "Aliens vs. Predator"],
    },
  },
  {
    slug: "halo",
    name: "Halo",
    tagline: "Finish the fight.",
    theme: { primary: "20 60 90", secondary: "230 230 240" },
    queries: {},
    curated: {
      game: ["Halo: Combat Evolved", "Halo 2", "Halo 3", "Halo 3: ODST", "Halo: Reach", "Halo 4", "Halo 5: Guardians", "Halo Infinite", "Halo Wars", "Halo Wars 2", "Halo: The Master Chief Collection", "Halo: Spartan Assault"],
      tvShow: ["Halo", "Halo Legends", "Halo 4: Forward Unto Dawn"],
    },
    featured: true,
  },
  {
    slug: "resident-evil",
    name: "Resident Evil",
    tagline: "Itchy. Tasty.",
    theme: { primary: "16 16 16", secondary: "150 20 20" },
    queries: {},
    curated: {
      game: ["Resident Evil", "Resident Evil 2", "Resident Evil 3", "Resident Evil 4", "Resident Evil 5", "Resident Evil 6", "Resident Evil 7: Biohazard", "Resident Evil Village", "Resident Evil 0", "Resident Evil Code: Veronica", "Resident Evil: Revelations", "Resident Evil: Revelations 2"],
      movie: ["Resident Evil", "Resident Evil: Apocalypse", "Resident Evil: Extinction", "Resident Evil: Afterlife", "Resident Evil: Retribution", "Resident Evil: The Final Chapter", "Resident Evil: Welcome to Raccoon City", "Resident Evil: Degeneration", "Resident Evil: Vendetta", "Resident Evil: Death Island"],
      tvShow: ["Resident Evil", "Resident Evil: Infinite Darkness"],
    },
  },
  {
    slug: "monsterverse",
    name: "Monsterverse",
    tagline: "Titans collide.",
    theme: { primary: "20 40 24", secondary: "230 120 30" },
    queries: {},
    curated: {
      movie: ["Godzilla", "Kong: Skull Island", "Godzilla: King of the Monsters", "Godzilla vs. Kong", "Godzilla x Kong: The New Empire", "Shin Godzilla", "Godzilla Minus One", "King Kong"],
      tvShow: ["Monarch: Legacy of Monsters", "Godzilla Singular Point", "Skull Island"],
      game: ["GigaBash", "Dawn of the Monsters"],
    },
  },
  {
    slug: "transformers",
    name: "Transformers",
    tagline: "More than meets the eye.",
    theme: { primary: "20 24 30", secondary: "210 40 30" },
    queries: {},
    curated: {
      movie: ["Transformers", "Transformers: Revenge of the Fallen", "Transformers: Dark of the Moon", "Transformers: Age of Extinction", "Transformers: The Last Knight", "Bumblebee", "Transformers: Rise of the Beasts", "Transformers One", "The Transformers: The Movie"],
      tvShow: ["Transformers: Prime", "Transformers: EarthSpark"],
      game: ["Transformers: Fall of Cybertron", "Transformers: War for Cybertron", "Transformers: Devastation"],
    },
  },

  // ── Thematic Collections (24) ────────────────────────────────────────────────

  {
    slug: "found-footage",
    name: "Found Footage",
    tagline: "You weren't supposed to see this.",
    theme: { primary: "12 12 12", secondary: "180 160 140" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["The Blair Witch Project", "Paranormal Activity", "Paranormal Activity 2", "Paranormal Activity 3", "Cloverfield", "REC", "Chronicle", "As Above, So Below", "Trollhunter", "V/H/S", "The Visit", "Unfriended", "Creep", "Host", "Grave Encounters", "The Taking of Deborah Logan"],
    },
  },
  {
    slug: "slashers",
    name: "Slashers",
    tagline: "The killer is still out there.",
    theme: { primary: "14 14 14", secondary: "200 20 20" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["Halloween", "Friday the 13th", "A Nightmare on Elm Street", "Scream", "Scream 2", "Child's Play", "The Texas Chain Saw Massacre", "I Know What You Did Last Summer", "Candyman", "Happy Death Day", "Black Christmas", "My Bloody Valentine", "Terrifier", "Terrifier 2", "X", "Pearl", "Freaky", "The Strangers", "Urban Legend"],
      game: ["Dead by Daylight", "Friday the 13th: The Game"],
    },
  },
  {
    slug: "psychological-horror",
    name: "Psychological Horror",
    tagline: "The horror was inside all along.",
    theme: { primary: "20 14 30", secondary: "160 40 160" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["The Shining", "Hereditary", "Black Swan", "Get Out", "The Babadook", "Midsommar", "Shutter Island", "The Others", "Sinister", "The Lighthouse", "Rosemary's Baby", "Jacob's Ladder", "The Witch", "Us", "Smile", "The Invisible Man", "Saint Maud"],
      tvShow: ["The Haunting of Hill House", "Hannibal"],
      game: ["Silent Hill 2", "SOMA", "Layers of Fear", "Visage"],
    },
  },
  {
    slug: "cosmic-horror",
    name: "Cosmic Horror",
    tagline: "The universe is indifferent to your survival.",
    theme: { primary: "10 14 20", secondary: "60 130 150" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["The Thing", "Annihilation", "Color Out of Space", "In the Mouth of Madness", "Event Horizon", "The Void", "Underwater", "The Mist", "The Endless", "Nope"],
      tvShow: ["Lovecraft Country"],
      game: ["Bloodborne", "Call of Cthulhu", "The Sinking City", "Dredge", "Returnal", "Dead Space", "Eternal Darkness: Sanity's Requiem"],
      manga: ["Uzumaki"],
    },
  },
  {
    slug: "gothic",
    name: "Gothic",
    tagline: "Beauty and dread, intertwined.",
    theme: { primary: "18 14 24", secondary: "120 80 160" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["Crimson Peak", "Sleepy Hollow", "Bram Stoker's Dracula", "The Others", "Interview with the Vampire", "Corpse Bride", "Nosferatu", "Edward Scissorhands", "Sweeney Todd: The Demon Barber of Fleet Street", "The Woman in Black", "Dark Shadows", "The Phantom of the Opera", "Mary Shelley's Frankenstein"],
      tvShow: ["Wednesday", "Penny Dreadful", "The Haunting of Bly Manor", "Castlevania", "Interview with the Vampire"],
      game: ["Castlevania: Symphony of the Night", "Bloodborne"],
      manga: ["Berserk"],
    },
  },
  {
    slug: "anthology-horror",
    name: "Anthology Horror",
    tagline: "Every story ends badly.",
    theme: { primary: "16 16 16", secondary: "210 80 30" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["Creepshow", "Trick 'r Treat", "V/H/S", "V/H/S/2", "Tales from the Crypt: Demon Knight", "Twilight Zone: The Movie", "Southbound", "The Mortuary Collection"],
      tvShow: ["American Horror Story", "Black Mirror", "The Twilight Zone", "Tales from the Crypt", "Guillermo del Toro's Cabinet of Curiosities", "Love, Death & Robots", "Creepshow"],
    },
  },
  {
    slug: "mecha",
    name: "Mecha",
    tagline: "Pilots, launch!",
    theme: { primary: "14 20 30", secondary: "60 160 220" },
    queries: {},
    collectionType: "thematic",
    curated: {
      tvShow: ["Neon Genesis Evangelion", "Code Geass: Lelouch of the Rebellion", "Gurren Lagann", "Darling in the Franxx", "Mobile Suit Gundam", "Mobile Suit Gundam: Iron-Blooded Orphans", "Mobile Suit Gundam: The Witch from Mercury", "Voltron: Legendary Defender"],
      movie: ["Pacific Rim", "Pacific Rim: Uprising", "The Iron Giant"],
      game: ["Armored Core VI: Fires of Rubicon", "Titanfall 2", "Zone of the Enders: The 2nd Runner", "MechWarrior 5: Mercenaries"],
    },
  },
  {
    slug: "isekai",
    name: "Isekai",
    tagline: "Transported to another world.",
    theme: { primary: "20 16 36", secondary: "140 100 210" },
    queries: {},
    collectionType: "thematic",
    curated: {
      tvShow: ["Re:Zero", "That Time I Got Reincarnated as a Slime", "KonoSuba", "Sword Art Online", "The Rising of the Shield Hero", "Mushoku Tensei: Jobless Reincarnation", "Overlord", "No Game No Life", "The Devil Is a Part-Timer!", "Inuyasha", "The Eminence in Shadow", "Ascendance of a Bookworm"],
      manga: ["Tensei Shitara Slime datta Ken", "Mushoku Tensei", "Kage no Jitsuryokusha"],
    },
  },
  {
    slug: "wuxia-cultivation",
    name: "Wuxia & Cultivation",
    tagline: "The path to immortality is long.",
    theme: { primary: "10 30 20", secondary: "80 180 120" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["Crouching Tiger, Hidden Dragon", "Hero", "House of Flying Daggers", "The Grandmaster", "Curse of the Golden Flower", "Kung Fu Hustle", "Fearless", "Shadow"],
      tvShow: ["The Untamed", "Word of Honor"],
      game: ["Black Myth: Wukong", "Sifu", "Jade Empire", "Nine Sols"],
      manga: ["Tales of Demons and Gods", "Martial Peak"],
    },
  },
  {
    slug: "fairy-tale-retellings",
    name: "Fairy Tale Retellings",
    tagline: "Once upon a time, reimagined.",
    theme: { primary: "30 20 40", secondary: "190 130 200" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["Into the Woods", "Maleficent", "Maleficent: Mistress of Evil", "Cinderella", "Snow White and the Huntsman", "The Huntsman: Winter's War", "Enchanted", "Disenchanted", "Red Riding Hood", "Ella Enchanted", "A Cinderella Story", "Hoodwinked!", "Puss in Boots: The Last Wish", "Shrek", "Pan", "Alice in Wonderland"],
      tvShow: ["Once Upon a Time", "Grimm"],
    },
  },
  {
    slug: "time-travel",
    name: "Time Travel",
    tagline: "When are we?",
    theme: { primary: "14 16 30", secondary: "60 140 230" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["Back to the Future", "Back to the Future Part II", "Back to the Future Part III", "Looper", "Interstellar", "Edge of Tomorrow", "About Time", "Twelve Monkeys", "Primer", "The Terminator", "Terminator 2: Judgment Day", "Tenet", "Palm Springs", "Groundhog Day", "Source Code", "Predestination", "Donnie Darko"],
      tvShow: ["Dark", "Loki", "Steins;Gate", "Erased", "The Umbrella Academy", "Outlander"],
      game: ["Life Is Strange", "Braid", "Outer Wilds", "Chrono Trigger", "Quantum Break"],
    },
  },
  {
    slug: "heist",
    name: "Heist",
    tagline: "Nothing goes according to plan.",
    theme: { primary: "16 16 16", secondary: "200 160 60" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["Ocean's Eleven", "Ocean's Twelve", "Ocean's Thirteen", "Ocean's Eight", "The Italian Job", "Inside Man", "Baby Driver", "Now You See Me", "Now You See Me 2", "Heat", "Logan Lucky", "The Town", "Widows", "Den of Thieves", "The Bank Job", "Army of the Dead"],
      tvShow: ["Money Heist", "Lupin", "Leverage"],
      game: ["Payday 2", "Grand Theft Auto V", "Monaco: What's Yours Is Mine"],
    },
  },
  {
    slug: "spy-espionage",
    name: "Spy & Espionage",
    tagline: "Eyes on target.",
    theme: { primary: "12 16 12", secondary: "60 180 80" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["Mission: Impossible", "Mission: Impossible - Ghost Protocol", "Mission: Impossible - Rogue Nation", "Mission: Impossible - Fallout", "The Bourne Identity", "The Bourne Supremacy", "The Bourne Ultimatum", "Kingsman: The Secret Service", "Kingsman: The Golden Circle", "Tinker Tailor Soldier Spy", "Argo", "Spy", "Atomic Blonde", "The Man from U.N.C.L.E.", "Bridge of Spies", "Mr. & Mrs. Smith", "True Lies", "Salt", "Red Sparrow"],
      tvShow: ["The Americans", "Homeland", "Killing Eve", "Slow Horses", "24", "The Night Manager", "Alias"],
      game: ["Metal Gear Solid V: The Phantom Pain", "Metal Gear Solid 3: Snake Eater", "Metal Gear Solid", "Splinter Cell"],
    },
  },
  {
    slug: "true-crime",
    name: "True Crime",
    tagline: "The truth is stranger than fiction.",
    theme: { primary: "20 18 16", secondary: "160 40 40" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["Zodiac", "Catch Me If You Can", "I, Tonya", "Goodfellas", "The Irishman", "American Gangster", "BlacKkKlansman", "Spotlight", "Dog Day Afternoon", "The Wolf of Wall Street", "Pain & Gain", "Bernie"],
      tvShow: ["Making a Murderer", "Mindhunter", "Dahmer", "Narcos", "American Crime Story", "When They See Us", "Unbelievable", "Tiger King", "The Jinx"],
    },
  },
  {
    slug: "courtroom-drama",
    name: "Courtroom Drama",
    tagline: "All rise.",
    theme: { primary: "16 24 40", secondary: "180 150 80" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["12 Angry Men", "A Few Good Men", "My Cousin Vinny", "Anatomy of a Murder", "Just Mercy", "The Trial of the Chicago 7", "A Time to Kill", "Philadelphia", "Primal Fear", "The Judge", "Fracture", "The Lincoln Lawyer", "Erin Brockovich", "Dark Waters", "Legally Blonde", "Marshall"],
      tvShow: ["Better Call Saul", "Suits", "How to Get Away with Murder", "The Lincoln Lawyer", "Boston Legal"],
      game: ["Phoenix Wright: Ace Attorney"],
    },
  },
  {
    slug: "survival",
    name: "Survival",
    tagline: "Whatever it takes.",
    theme: { primary: "24 20 14", secondary: "180 120 40" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["Cast Away", "127 Hours", "The Revenant", "Life of Pi", "Into the Wild", "The Martian", "Gravity", "The Grey", "Everest", "Society of the Snow", "Buried", "Fall", "Apollo 13", "Wild"],
      tvShow: ["Lost", "Yellowjackets", "The Wilds"],
      game: ["Subnautica", "The Long Dark", "Don't Starve", "The Forest", "Green Hell", "ARK: Survival Evolved", "Rust", "Valheim"],
    },
  },
  {
    slug: "martial-arts",
    name: "Martial Arts",
    tagline: "The fist speaks louder than words.",
    theme: { primary: "20 16 14", secondary: "180 40 30" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["Enter the Dragon", "Ip Man", "Ip Man 2", "Ip Man 3", "The Raid", "The Raid 2", "Kill Bill: Vol. 1", "Kill Bill: Vol. 2", "Ong Bak: Muay Thai Warrior", "The Karate Kid", "Crouching Tiger, Hidden Dragon", "Drunken Master", "Police Story", "Fist of Fury", "Kung Fu Hustle", "Shang-Chi and the Legend of the Ten Rings"],
      tvShow: ["Cobra Kai", "Warrior", "Into the Badlands", "Baki", "Kengan Ashura"],
      game: ["Sifu", "Mortal Kombat 11", "Street Fighter 6", "Tekken 8", "Absolver"],
      manga: ["Kengan Asura", "Baki"],
    },
  },
  {
    slug: "pirates",
    name: "Pirates",
    tagline: "The sea belongs to no one.",
    theme: { primary: "16 30 40", secondary: "180 150 90" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["Pirates of the Caribbean: The Curse of the Black Pearl", "Pirates of the Caribbean: Dead Man's Chest", "Pirates of the Caribbean: At World's End", "Pirates of the Caribbean: On Stranger Tides", "Pirates of the Caribbean: Dead Men Tell No Tales", "Hook", "Treasure Planet", "Muppet Treasure Island", "Cutthroat Island", "The Pirates! In an Adventure with Scientists!"],
      tvShow: ["Black Sails", "Our Flag Means Death", "One Piece"],
      game: ["Sea of Thieves", "Assassin's Creed IV Black Flag", "Return to Monkey Island", "The Secret of Monkey Island", "Skull and Bones"],
      manga: ["One Piece"],
    },
  },
  {
    slug: "sports",
    name: "Sports",
    tagline: "Leave it all on the field.",
    theme: { primary: "20 70 40", secondary: "220 220 220" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["Rocky", "Rocky II", "Rocky IV", "Rocky Balboa", "Creed", "Creed II", "Creed III", "Remember the Titans", "Miracle", "Moneyball", "The Blind Side", "Rudy", "Million Dollar Baby", "Raging Bull", "Field of Dreams", "A League of Their Own", "Space Jam", "Coach Carter", "The Sandlot", "Ford v Ferrari", "Rush", "King Richard", "Challengers", "Air"],
      tvShow: ["Ted Lasso", "Friday Night Lights", "Blue Lock", "Haikyu!!"],
      game: ["Rocket League", "Tony Hawk's Pro Skater 1+2"],
      manga: ["Haikyu", "Blue Lock", "Slam Dunk"],
    },
  },
  {
    slug: "coming-of-age",
    name: "Coming of Age",
    tagline: "Figuring it out.",
    theme: { primary: "40 24 16", secondary: "220 170 80" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["The Breakfast Club", "Lady Bird", "Stand by Me", "Superbad", "The Perks of Being a Wallflower", "Boyhood", "Dead Poets Society", "The Edge of Seventeen", "Eighth Grade", "Call Me by Your Name", "Moonlight", "Sing Street", "The Way Way Back", "Ferris Bueller's Day Off", "Almost Famous", "Juno", "Napoleon Dynamite", "Mid90s", "Booksmart", "Little Women", "The Spectacular Now"],
      tvShow: ["Freaks and Geeks", "Sex Education", "Derry Girls", "Heartstopper", "Never Have I Ever", "Euphoria"],
      game: ["Life Is Strange", "Night in the Woods", "Oxenfree"],
    },
  },
  {
    slug: "robots-and-ai",
    name: "Robots & AI",
    tagline: "What does it mean to be human?",
    theme: { primary: "16 20 30", secondary: "80 160 230" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["Ex Machina", "Her", "I, Robot", "A.I. Artificial Intelligence", "Blade Runner", "Blade Runner 2049", "The Terminator", "Terminator 2: Judgment Day", "WALL·E", "The Matrix", "RoboCop", "Chappie", "Big Hero 6", "The Iron Giant", "M3GAN", "Upgrade", "The Creator", "2001: A Space Odyssey", "Free Guy", "After Yang"],
      tvShow: ["Westworld", "Black Mirror", "Person of Interest", "Pluto", "Humans"],
      game: ["Detroit: Become Human", "NieR: Automata", "Portal", "Portal 2", "Horizon Zero Dawn", "Horizon Forbidden West", "Stray", "The Talos Principle", "SOMA"],
      manga: ["Pluto"],
    },
  },
  {
    slug: "slow-burn",
    name: "Slow Burn",
    tagline: "Worth the wait.",
    theme: { primary: "30 14 20", secondary: "190 120 140" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["There Will Be Blood", "No Country for Old Men", "Drive", "Prisoners", "Zodiac", "The Green Knight", "The Lighthouse", "First Reformed", "Nightcrawler", "Sicario", "Blade Runner 2049", "Once Upon a Time in Hollywood", "The Master", "A Ghost Story"],
      tvShow: ["True Detective", "Better Call Saul", "Mare of Easttown", "The Night Of", "Sharp Objects", "Severance", "Mindhunter"],
      game: ["Firewatch", "Death Stranding", "What Remains of Edith Finch"],
    },
  },
  {
    slug: "enemies-to-lovers",
    name: "Enemies to Lovers",
    tagline: "I hate you. Don't stop.",
    theme: { primary: "40 12 16", secondary: "210 90 100" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["Pride & Prejudice", "10 Things I Hate About You", "You've Got Mail", "How to Lose a Guy in 10 Days", "The Proposal", "Anyone but You", "The Hating Game", "Mr. & Mrs. Smith", "Cruel Intentions", "Much Ado About Nothing", "Beauty and the Beast"],
      tvShow: ["Bridgerton", "Kaguya-sama: Love is War", "Toradora!"],
      manga: ["Kaguya-sama", "Toradora"],
    },
  },
  {
    slug: "cooking-and-food",
    name: "Cooking & Food",
    tagline: "Food is love.",
    theme: { primary: "30 20 10", secondary: "210 160 60" },
    queries: {},
    collectionType: "thematic",
    curated: {
      movie: ["Ratatouille", "Chef", "The Menu", "Julie & Julia", "Burnt", "Chocolat", "The Hundred-Foot Journey", "Jiro Dreams of Sushi", "Pig", "The Taste of Things", "No Reservations"],
      tvShow: ["The Bear", "Chef's Table", "The Great British Bake Off", "Hell's Kitchen", "MasterChef", "Food Wars! Shokugeki no Soma", "Delicious in Dungeon"],
      game: ["Overcooked! 2", "Cooking Mama", "Venba"],
      manga: ["Shokugeki no", "Dungeon Meshi"],
    },
  },
];

export function getCollection(slug: string): CollectionDef | undefined {
  return COLLECTIONS.find((c) => c.slug === slug);
}
