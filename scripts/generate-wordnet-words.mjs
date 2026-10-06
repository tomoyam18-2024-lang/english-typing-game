import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const POS_LABELS = {
  n: "名詞",
  v: "動詞",
  a: "形容詞",
  s: "形容詞",
  r: "副詞",
};
const MAX_PRIMARY_MEANINGS = 3;

const DEFAULT_OPTIONS = {
  db: "data/wordnet/wnjpn.db",
  words: "data/wordnet/words.json",
  out: "src/data/generatedWords.json",
  source: "lemmas",
};

function printHelp() {
  console.log(`Usage:
  node scripts/generate-wordnet-words.mjs [options]

Options:
  --db <path>       Japanese WordNet SQLite database path.
                    Default: ${DEFAULT_OPTIONS.db}
  --words <path>    Input word list. Supports JSON or text.
                    Default: ${DEFAULT_OPTIONS.words}
  --out <path>      Output generated JSON path.
                    Default: ${DEFAULT_OPTIONS.out}
  --source <type>   Meaning source: lemmas, glosses, or both.
                    Default: ${DEFAULT_OPTIONS.source}
  --help            Show this help.

JSON input examples:
  ["apple", "read"]
  [{ "word": "apple", "level": 1 }, { "word": "read", "level": 1 }]

Text input examples:
  apple
  read,1
`);
}

function parseArgs(argv) {
  const options = { ...DEFAULT_OPTIONS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (!(key in DEFAULT_OPTIONS)) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options[key] = value;
    index += 1;
  }

  if (!["lemmas", "glosses", "both"].includes(options.source)) {
    throw new Error("--source must be one of: lemmas, glosses, both");
  }

  return options;
}

function normalizeWordEntry(entry) {
  if (typeof entry === "string") {
    return { word: entry.trim(), level: 1 };
  }

  if (entry && typeof entry.word === "string") {
    return {
      word: entry.word.trim(),
      level: Number.isInteger(entry.level) ? entry.level : 1,
    };
  }

  throw new Error(`Invalid word entry: ${JSON.stringify(entry)}`);
}

function readWordEntries(wordsPath) {
  const raw = readFileSync(wordsPath, "utf8");

  if (wordsPath.endsWith(".json")) {
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed) ? parsed : parsed.words;

    if (!Array.isArray(entries)) {
      throw new Error("JSON word input must be an array or an object with a words array.");
    }

    return entries.map(normalizeWordEntry).filter((entry) => entry.word.length > 0);
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const [word, level] = line.split(/[\t,]/).map((value) => value.trim());
      return {
        word,
        level: level ? Number(level) : 1,
      };
    })
    .map(normalizeWordEntry);
}

function getPosLabel(pos) {
  return POS_LABELS[pos] ?? pos;
}

function addDefinition(groupedMeanings, pos, definition) {
  const trimmedDefinition = definition?.trim();

  if (!trimmedDefinition) {
    return;
  }

  const posLabel = getPosLabel(pos);

  if (!groupedMeanings.has(posLabel)) {
    groupedMeanings.set(posLabel, new Set());
  }

  groupedMeanings.get(posLabel).add(trimmedDefinition);
}

function selectPrimaryMeanings(meanings) {
  return meanings
    .filter((meaning) => meaning.definitions.length > 0)
    .slice(0, MAX_PRIMARY_MEANINGS)
    .map((meaning) => ({
      pos: meaning.pos,
      definition: meaning.definitions[0],
    }));
}

function findSenses(database, word) {
  const normalizedWord = word.toLowerCase();
  const underscoredWord = normalizedWord.replaceAll(" ", "_");

  return database
    .prepare(
      `
        SELECT DISTINCT
          w.pos AS pos,
          s.synset AS synset,
          CAST(s.rank AS INTEGER) AS rank
        FROM word w
        INNER JOIN sense s ON s.wordid = w.wordid
        WHERE w.lang = 'eng'
          AND s.lang = 'eng'
          AND lower(w.lemma) IN (?, ?)
        ORDER BY w.pos, rank, s.synset
      `,
    )
    .all(normalizedWord, underscoredWord);
}

function findJapaneseLemmas(database, synset) {
  return database
    .prepare(
      `
        SELECT DISTINCT jw.lemma AS definition
        FROM sense js
        INNER JOIN word jw ON jw.wordid = js.wordid
        WHERE js.synset = ?
          AND js.lang = 'jpn'
          AND jw.lang = 'jpn'
        ORDER BY CAST(js.rank AS INTEGER), jw.lemma
      `,
    )
    .all(synset)
    .map((row) => row.definition);
}

function findJapaneseGlosses(database, synset) {
  return database
    .prepare(
      `
        SELECT DISTINCT def AS definition
        FROM synset_def
        WHERE synset = ?
          AND lang = 'jpn'
        ORDER BY CAST(sid AS INTEGER), def
      `,
    )
    .all(synset)
    .map((row) => row.definition);
}

function generateEntry(database, inputEntry, source) {
  const groupedMeanings = new Map();
  const senses = findSenses(database, inputEntry.word);

  for (const sense of senses) {
    if (source === "lemmas" || source === "both") {
      for (const definition of findJapaneseLemmas(database, sense.synset)) {
        addDefinition(groupedMeanings, sense.pos, definition);
      }
    }

    if (source === "glosses" || source === "both") {
      for (const definition of findJapaneseGlosses(database, sense.synset)) {
        addDefinition(groupedMeanings, sense.pos, definition);
      }
    }
  }

  const meanings = [...groupedMeanings.entries()].map(([pos, definitions]) => ({
    pos,
    definitions: [...definitions],
  }));

  return {
    word: inputEntry.word,
    level: inputEntry.level,
    primaryMeanings: selectPrimaryMeanings(meanings),
    meanings,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const dbPath = path.resolve(process.cwd(), options.db);
  const wordsPath = path.resolve(process.cwd(), options.words);
  const outPath = path.resolve(process.cwd(), options.out);
  const wordEntries = readWordEntries(wordsPath);
  const database = new DatabaseSync(dbPath, { readOnly: true });

  try {
    const generatedWords = wordEntries.map((entry) => generateEntry(database, entry, options.source));
    const missingWords = generatedWords.filter((entry) => entry.meanings.length === 0);

    if (missingWords.length > 0) {
      console.warn(
        `Warning: ${missingWords.length} word(s) had no Japanese WordNet meanings: ${missingWords
          .map((entry) => entry.word)
          .join(", ")}`,
      );
    }

    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(generatedWords, null, 2)}\n`, "utf8");
    console.log(`Generated ${generatedWords.length} word entries: ${outPath}`);
  } finally {
    database.close();
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
