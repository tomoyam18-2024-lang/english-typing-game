import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_OPTIONS = {
  dictionary: "src/data/generated/wordDictionaryV2Final.json",
  outWords: "src/data/generated/gameWords.json",
  outSummary: "src/data/generated/gameWordsSummary.json",
};

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

    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--dictionary") {
      options.dictionary = value;
    } else if (arg === "--out-words") {
      options.outWords = value;
    } else if (arg === "--out-summary") {
      options.outSummary = value;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }

    index += 1;
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), filePath), "utf8"));
}

function writeJson(filePath, data) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeDefinition(definition) {
  return String(definition ?? "").trim();
}

function toGameWord(entry) {
  return {
    word: entry.word,
    level: entry.level,
    primaryMeanings: entry.primaryMeanings.slice(0, 3).map((meaning) => ({
      pos: meaning.pos,
      definitions: (meaning.definitions ?? []).map(normalizeDefinition).filter(Boolean),
    })),
  };
}

function levelCounts(words) {
  return {
    1: words.filter((word) => word.level === 1).length,
    2: words.filter((word) => word.level === 2).length,
    3: words.filter((word) => word.level === 3).length,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log("Usage: node scripts/generate-game-words.mjs [--dictionary path] [--out-words path]");
    return;
  }

  const dictionaryJson = readJson(options.dictionary);
  const dictionaryWords = Array.isArray(dictionaryJson) ? dictionaryJson : dictionaryJson.words;
  const excludedReviewRequired = [];
  const excludedNoPrimaryMeanings = [];
  const gameWords = [];

  for (const entry of dictionaryWords) {
    if (entry.reviewStatus !== "accepted") {
      excludedReviewRequired.push(entry.word);
      continue;
    }

    if (!Array.isArray(entry.primaryMeanings) || entry.primaryMeanings.length === 0) {
      console.warn(`Skipping accepted word with no primaryMeanings: ${entry.word}`);
      excludedNoPrimaryMeanings.push(entry.word);
      continue;
    }

    const gameWord = toGameWord(entry);

    if (gameWord.primaryMeanings.length === 0) {
      console.warn(`Skipping accepted word with empty game primaryMeanings: ${entry.word}`);
      excludedNoPrimaryMeanings.push(entry.word);
      continue;
    }

    gameWords.push(gameWord);
  }

  gameWords.sort((a, b) => a.level - b.level || a.word.localeCompare(b.word));

  const duplicateCount = gameWords.length - new Set(gameWords.map((word) => word.word)).size;
  const overLimitCount = gameWords.filter((word) => word.primaryMeanings.length > 3).length;
  const counts = levelCounts(gameWords);
  const summary = {
    generatedAt: new Date().toISOString(),
    sourceDictionary: options.dictionary,
    acceptedDictionaryWords: dictionaryWords.filter((entry) => entry.reviewStatus === "accepted").length,
    playableWords: gameWords.length,
    levelCounts: counts,
    excludedBecauseReviewRequired: excludedReviewRequired.length,
    excludedBecauseNoPrimaryMeanings: excludedNoPrimaryMeanings.length,
    excludedReviewRequiredWords: excludedReviewRequired,
    excludedNoPrimaryMeaningWords: excludedNoPrimaryMeanings,
    validation: {
      duplicates: duplicateCount,
      primaryMeaningsOverLimit: overLimitCount,
    },
  };

  writeJson(options.outWords, gameWords);
  writeJson(options.outSummary, summary);

  console.log("Game words generation");
  console.log("---------------------");
  console.log(`Accepted words: ${summary.acceptedDictionaryWords}`);
  console.log(`Playable words: ${summary.playableWords}`);
  console.log(`Level 1: ${counts[1]}`);
  console.log(`Level 2: ${counts[2]}`);
  console.log(`Level 3: ${counts[3]}`);
  console.log(`Excluded because review required: ${summary.excludedBecauseReviewRequired}`);
  console.log(`Excluded because no primary meanings: ${summary.excludedBecauseNoPrimaryMeanings}`);
  console.log(`Duplicates: ${duplicateCount}`);
  console.log(`primaryMeanings over limit: ${overLimitCount}`);

  if (duplicateCount > 0 || overLimitCount > 0) {
    throw new Error("Generated game words failed validation.");
  }
}

main();
