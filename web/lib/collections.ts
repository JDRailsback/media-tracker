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
  curated?: CollectionCurated;
}

export const COLLECTIONS: CollectionDef[] = [
  {
    slug: "star-wars",
    name: "Star Wars",
    tagline: "A galaxy far, far away.",
    theme: { primary: "20 20 24", secondary: "230 190 80" },
    queries: {},
    curated: {
      movie: ["Star Wars", "The Empire Strikes Back", "Return of the Jedi", "The Phantom Menace", "Attack of the Clones", "Revenge of the Sith", "The Force Awakens", "The Last Jedi", "The Rise of Skywalker", "Rogue One", "Solo: A Star Wars Story", "Star Wars: The Clone Wars"],
      tvShow: ["The Mandalorian", "Andor", "Ahsoka", "Star Wars: The Bad Batch", "Obi-Wan Kenobi", "The Book of Boba Fett", "Star Wars: The Clone Wars", "Star Wars Rebels", "The Acolyte", "Star Wars: Visions", "Star Wars: Skeleton Crew", "Star Wars: Tales of the Jedi", "Star Wars: Tales of the Empire"],
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
      tvShow: ["WandaVision", "Loki", "The Falcon and the Winter Soldier", "Hawkeye", "Moon Knight", "Ms. Marvel", "She-Hulk: Attorney at Law", "Secret Invasion", "What If...?", "Echo", "Agatha All Along", "Daredevil", "Daredevil: Born Again", "Agents of S.H.I.E.L.D.", "Ironheart", "Wonder Man"],
      // Same precedent as DC's game list below — blends continuities outside
      // the strict MCU film timeline (Insomniac's Spider-Man universe, LEGO
      // crossovers, fighting games) rather than requiring in-canon-only,
      // since "Marvel games" is what people actually mean by this shelf.
      game: ["Marvel's Spider-Man", "Marvel's Spider-Man: Miles Morales", "Marvel's Spider-Man 2", "Marvel's Avengers", "Marvel's Midnight Suns", "Marvel's Guardians of the Galaxy", "Marvel Ultimate Alliance", "Marvel Ultimate Alliance 2", "Marvel Ultimate Alliance 3: The Black Order", "Marvel vs. Capcom 2", "Marvel vs. Capcom 3: Fate of Two Worlds", "Ultimate Marvel vs. Capcom 3", "Marvel vs. Capcom: Infinite", "LEGO Marvel Super Heroes", "LEGO Marvel's Avengers", "LEGO Marvel Super Heroes 2", "Marvel Rivals", "Marvel Snap"],
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
      tvShow: ["Arrow", "The Flash", "Supergirl", "Gotham", "Titans", "Doom Patrol", "Peacemaker", "Harley Quinn", "Smallville", "Superman & Lois", "Batman: The Animated Series", "Young Justice", "Watchmen", "The Sandman", "Lucifer", "Creature Commandos"],
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
      // The HBO reboot series (announced 2023, filming for a 2026 premiere)
      // — no prior TV entry existed in this franchise before it, which is
      // why this array was missing entirely (verified live: with no tvShow
      // keywords at all, the real upcoming show could never be admitted).
      tvShow: ["Harry Potter"],
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
      movie: ["The SpongeBob SquarePants Movie", "The SpongeBob Movie: Sponge Out of Water", "The SpongeBob Movie: Sponge on the Run", "Jimmy Neutron: Boy Genius", "The Rugrats Movie", "Rango", "Teenage Mutant Ninja Turtles: Mutant Mayhem", "The Last Airbender", "The Adventures of Tintin", "Good Burger", "Harriet"],
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
      tvShow: ["Pokémon", "Pokémon Concierge", "Pokémon Horizons"],
      movie: ["Pokémon Detective Pikachu", "Pokémon: The First Movie", "Pokémon the Movie 2000"],
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
      game: ["Resident Evil", "Resident Evil 2", "Resident Evil 3", "Resident Evil 4", "Resident Evil 5", "Resident Evil 6", "Resident Evil 7: Biohazard", "Resident Evil Village", "Resident Evil Zero", "Resident Evil Code: Veronica", "Resident Evil: Revelations", "Resident Evil: Revelations 2"],
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
];

export function getCollection(slug: string): CollectionDef | undefined {
  return COLLECTIONS.find((c) => c.slug === slug);
}
