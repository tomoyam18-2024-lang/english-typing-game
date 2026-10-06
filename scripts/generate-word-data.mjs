import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_OPTIONS = {
  words: "scripts/test-words.json",
  dictionary: "scripts/test-dictionary.json",
  out: "src/data/generatedWords.ts",
};

const POS_ORDER = ["noun", "verb", "adjective", "adverb"];
const MAX_PRIMARY_MEANINGS = 3;
const DEFAULT_RANK = Number.MAX_SAFE_INTEGER;

function printHelp() {
  console.log(`Usage:
  node scripts/generate-word-data.mjs [options]

Options:
  --words <path>       Input word list. Supports JSON or text.
                       Default: ${DEFAULT_OPTIONS.words}
  --dictionary <path>  Dictionary fixture JSON to import.
                       Default: ${DEFAULT_OPTIONS.dictionary}
  --out <path>         Output TypeScript data file.
                       Default: ${DEFAULT_OPTIONS.out}
  --help               Show this help.

JSON word input examples:
  ["apple", "read"]
  [{ "word": "apple", "level": 1 }, { "word": "read", "level": 1 }]

Text word input examples:
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
      return normalizeWordEntry({ word, level: level ? Number(level) : 1 });
    });
}

function readDictionaryEntries(dictionaryPath) {
  const parsed = JSON.parse(readFileSync(dictionaryPath, "utf8"));
  const entries = Array.isArray(parsed) ? parsed : parsed.entries;

  if (!Array.isArray(entries)) {
    throw new Error("Dictionary JSON must be an array or an object with an entries array.");
  }

  return entries.map((entry) => {
    if (!entry || typeof entry.word !== "string" || typeof entry.pos !== "string") {
      throw new Error(`Invalid dictionary entry: ${JSON.stringify(entry)}`);
    }

    if (!Array.isArray(entry.definitions)) {
      throw new Error(`Dictionary entry definitions must be an array: ${JSON.stringify(entry)}`);
    }

    return {
      word: entry.word.trim().toLowerCase(),
      pos: entry.pos.trim().toLowerCase(),
      rank: Number.isFinite(Number(entry.rank)) ? Number(entry.rank) : DEFAULT_RANK,
      definitions: entry.definitions
        .filter((definition) => typeof definition === "string")
        .map((definition) => definition.trim())
        .filter((definition) => definition.length > 0),
    };
  });
}

function createDictionaryIndex(dictionaryEntries) {
  const index = new Map();

  for (const entry of dictionaryEntries) {
    if (!index.has(entry.word)) {
      index.set(entry.word, new Map());
    }

    const meaningsByPos = index.get(entry.word);

    if (!meaningsByPos.has(entry.pos)) {
      meaningsByPos.set(entry.pos, new Map());
    }

    const definitionsByText = meaningsByPos.get(entry.pos);
    for (const definition of entry.definitions) {
      const currentRank = definitionsByText.get(definition);

      if (currentRank === undefined || entry.rank < currentRank) {
        definitionsByText.set(definition, entry.rank);
      }
    }
  }

  return index;
}

function comparePos(a, b) {
  const aIndex = POS_ORDER.indexOf(a);
  const bIndex = POS_ORDER.indexOf(b);

  if (aIndex !== -1 || bIndex !== -1) {
    return (aIndex === -1 ? POS_ORDER.length : aIndex) - (bIndex === -1 ? POS_ORDER.length : bIndex);
  }

  return a.localeCompare(b);
}

function compareDefinitionsByRank([, rankA], [, rankB]) {
  if (rankA !== rankB) {
    return rankA - rankB;
  }

  return 0;
}

function toMeanings(meaningsByPos) {
  return [...meaningsByPos.entries()]
    .sort(([a], [b]) => comparePos(a, b))
    .map(([pos, definitionsByText]) => ({
      pos,
      definitions: [...definitionsByText.entries()]
        .sort(compareDefinitionsByRank)
        .map(([definition]) => definition),
    }));
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

function buildWordEntry(inputEntry, dictionaryIndex) {
  const meaningsByPos = dictionaryIndex.get(inputEntry.word.toLowerCase()) ?? new Map();
  const meanings = toMeanings(meaningsByPos);

  return {
    word: inputEntry.word,
    level: inputEntry.level,
    primaryMeanings: selectPrimaryMeanings(meanings),
    meanings,
  };
}

function toTypeScript(entries) {
  return `import type { WordEntry } from "./words";

// This file is generated by scripts/generate-word-data.mjs.
// Do not edit by hand; update scripts/test-words.json or the dictionary source instead.
export const generatedWords = ${JSON.stringify(entries, null, 2)} satisfies WordEntry[];
`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const wordsPath = path.resolve(process.cwd(), options.words);
  const dictionaryPath = path.resolve(process.cwd(), options.dictionary);
  const outPath = path.resolve(process.cwd(), options.out);
  const wordEntries = readWordEntries(wordsPath);
  const dictionaryEntries = readDictionaryEntries(dictionaryPath);
  const dictionaryIndex = createDictionaryIndex(dictionaryEntries);
  const generatedWords = wordEntries.map((entry) => buildWordEntry(entry, dictionaryIndex));
  const missingWords = generatedWords.filter((entry) => entry.meanings.length === 0);

  if (missingWords.length > 0) {
    console.warn(
      `Warning: ${missingWords.length} word(s) had no dictionary meanings: ${missingWords
        .map((entry) => entry.word)
        .join(", ")}`,
    );
  }

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, toTypeScript(generatedWords), "utf8");
  console.log(`Generated ${generatedWords.length} word entries: ${outPath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
