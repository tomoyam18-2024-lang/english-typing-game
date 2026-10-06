import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ensureDatabase, extractWords, inspectSchema } from "./generate-wordnet-sample.mjs";
import {
  evaluateWord,
  flattenWiktionarySenses,
  loadWiktionaryEntries,
  normalizeEnglishWord,
  summarizeWiktionaryMeanings,
} from "./generate-multi-dictionary-sample.mjs";

const DEFAULT_OPTIONS = {
  db: "data/wordnet/wnjpn.db",
  wordMaster: "src/data/wordMaster.json",
  wiktionary: "data/wiktionary/kaikki-jawiktionary-english.jsonl",
  outDictionary: "src/data/generated/wordDictionary.json",
  outReviewCsv: "reports/full-dictionary-review.csv",
  outLowConfidenceCsv: "reports/low-confidence-words.csv",
  outMissingCsv: "reports/missing-japanese-meanings.csv",
  outSummaryJson: "reports/full-dictionary-summary.json",
};

const EXPECTED_TOTAL = 2500;
const CONFIDENCE_VALUES = new Set(["high", "medium", "low"]);
const REVIEW_CATEGORIES = [
  "AMBIGUOUS_PRIMARY_SENSE",
  "UNNATURAL_JAPANESE",
  "MISSING_JAPANESE",
  "DICTIONARY_DISAGREEMENT",
  "LOW_CONFIDENCE",
  "TOO_MANY_SENSES",
  "DUPLICATE_MEANINGS",
  "POS_MISMATCH",
  "OTHER",
];

function printHelp() {
  console.log(`Usage:
  node scripts/generate-full-dictionary.mjs [options]

Options:
  --db <path>                 Japanese WordNet SQLite DB path.
                              Default: ${DEFAULT_OPTIONS.db}
  --word-master <path>        wordMaster JSON path.
                              Default: ${DEFAULT_OPTIONS.wordMaster}
  --wiktionary <path>         Japanese Wiktionary English JSONL or JSONL.GZ file.
                              Default: ${DEFAULT_OPTIONS.wiktionary}
  --out-dictionary <path>     Generated dictionary JSON path.
                              Default: ${DEFAULT_OPTIONS.outDictionary}
  --out-review-csv <path>     Review-required CSV path.
                              Default: ${DEFAULT_OPTIONS.outReviewCsv}
  --out-low-confidence-csv <path>
                              Low word-confidence CSV path.
                              Default: ${DEFAULT_OPTIONS.outLowConfidenceCsv}
  --out-missing-csv <path>    Missing Japanese meanings CSV path.
                              Default: ${DEFAULT_OPTIONS.outMissingCsv}
  --out-summary-json <path>   Summary JSON path.
                              Default: ${DEFAULT_OPTIONS.outSummaryJson}
  --help                      Show this help.
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

    if (key === "word-master") {
      options.wordMaster = value;
    } else if (key === "out-dictionary") {
      options.outDictionary = value;
    } else if (key === "out-review-csv") {
      options.outReviewCsv = value;
    } else if (key === "out-low-confidence-csv") {
      options.outLowConfidenceCsv = value;
    } else if (key === "out-missing-csv") {
      options.outMissingCsv = value;
    } else if (key === "out-summary-json") {
      options.outSummaryJson = value;
    } else if (key in options) {
      options[key] = value;
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

function writeFile(filePath, content) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

function csvEscape(value) {
  const text =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value == null
      ? String(value ?? "")
      : JSON.stringify(value);

  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function writeCsv(filePath, rows, headers) {
  const lines = [headers.join(",")];

  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  }

  writeFile(filePath, `${lines.join("\n")}\n`);
}

function uniqueNormalized(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const text = String(value ?? "").normalize("NFKC").trim();
    const key = text.replace(/\s+/g, "");

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(text);
  }

  return result;
}

function groupWiktionaryMeanings(wiktionarySenses) {
  const grouped = new Map();

  for (const sense of wiktionarySenses) {
    if (!grouped.has(sense.pos)) {
      grouped.set(sense.pos, []);
    }

    grouped.get(sense.pos).push(...(sense.glosses ?? []));
  }

  return [...grouped.entries()]
    .map(([pos, definitions]) => ({
      source: "ja-wiktionary",
      pos,
      definitions: uniqueNormalized(definitions),
    }))
    .filter((meaning) => meaning.definitions.length > 0);
}

function buildMeanings(wordnetEntry, wiktionarySenses) {
  return [
    ...(wordnetEntry.meanings ?? []).map((meaning) => ({
      source: "japanese-wordnet",
      pos: meaning.pos,
      definitions: meaning.definitions,
    })),
    ...groupWiktionaryMeanings(wiktionarySenses),
  ];
}

function formatPrimaryMeaning(primaryMeaning) {
  if (!primaryMeaning) {
    return "";
  }

  return `${primaryMeaning.pos}: ${primaryMeaning.definitions.join("・")} [${primaryMeaning.confidence}]`;
}

function normalizeMeaningKey(primaryMeaning) {
  return `${primaryMeaning.pos}:${primaryMeaning.definitions.map((definition) =>
    String(definition ?? "")
      .normalize("NFKC")
      .replace(/\s+/g, "")
      .replace(/[。．.]+$/g, ""),
  ).join("|")}`;
}

function hasDuplicatePrimaryMeanings(primaryMeanings) {
  const keys = new Set();
  const firstDefinitions = new Set();

  for (const primaryMeaning of primaryMeanings) {
    const key = normalizeMeaningKey(primaryMeaning);
    const firstDefinition = `${primaryMeaning.pos}:${String(primaryMeaning.definitions[0] ?? "")
      .normalize("NFKC")
      .replace(/\s+/g, "")}`;

    if (keys.has(key) || (primaryMeaning.definitions.length > 1 && firstDefinitions.has(firstDefinition))) {
      return true;
    }

    keys.add(key);
    firstDefinitions.add(firstDefinition);
  }

  return false;
}

function topWordnetPos(wordnetEntry) {
  return wordnetEntry.primaryCandidateSenses?.[0]?.pos ?? wordnetEntry.primaryMeaningCandidates?.[0]?.pos ?? "";
}

function topWiktionaryPos(wiktionarySenses) {
  return wiktionarySenses.find((sense) => sense.glosses.length > 0)?.pos ?? "";
}

function dictionaryAgreement(wordnetCoverage, wiktionaryCoverage, finalCandidates) {
  if (!wordnetCoverage && !wiktionaryCoverage) {
    return "missing";
  }

  if (wordnetCoverage && !wiktionaryCoverage) {
    return "wordnet-only";
  }

  if (!wordnetCoverage && wiktionaryCoverage) {
    return "wiktionary-only";
  }

  return finalCandidates.some((candidate) => candidate.sources.includes("japanese-wordnet") && candidate.sources.includes("ja-wiktionary"))
    ? "supported-by-both"
    : "disagreement";
}

function mergeReviewCategories(wordnetEntry, wiktionarySenses, evaluation, primaryMeanings, agreement) {
  const categories = new Set(evaluation.reviewCategories);
  const reasons = [...evaluation.reviewReasons];

  if (hasDuplicatePrimaryMeanings(primaryMeanings)) {
    categories.add("DUPLICATE_MEANINGS");
    reasons.push("Two or more selected primary meanings look duplicated after safe normalization.");
  }

  const wordnetPos = topWordnetPos(wordnetEntry);
  const wiktionaryPos = topWiktionaryPos(wiktionarySenses);

  if (agreement === "disagreement" && wordnetPos && wiktionaryPos && wordnetPos !== wiktionaryPos) {
    categories.add("POS_MISMATCH");
    reasons.push(`Top POS differs between dictionaries: WordNet=${wordnetPos}, Wiktionary=${wiktionaryPos}.`);
  }

  return {
    categories: [...categories].sort((a, b) => REVIEW_CATEGORIES.indexOf(a) - REVIEW_CATEGORIES.indexOf(b)),
    reasons,
  };
}

function wordConfidence(primaryMeanings, reviewCategories) {
  if (
    primaryMeanings.length === 0 ||
    primaryMeanings.some((meaning) => meaning.confidence === "low") ||
    reviewCategories.some((category) =>
      ["MISSING_JAPANESE", "UNNATURAL_JAPANESE", "DICTIONARY_DISAGREEMENT", "LOW_CONFIDENCE", "POS_MISMATCH"].includes(
        category,
      ),
    )
  ) {
    return "low";
  }

  if (reviewCategories.length > 0 || primaryMeanings.some((meaning) => meaning.confidence === "medium")) {
    return "medium";
  }

  return "high";
}

function primaryMeaningConfidenceCounts(words) {
  return words.reduce(
    (counts, word) => {
      for (const meaning of word.primaryMeanings) {
        counts[meaning.confidence.toUpperCase()] += 1;
      }

      return counts;
    },
    { HIGH: 0, MEDIUM: 0, LOW: 0 },
  );
}

function wordConfidenceCounts(words) {
  return words.reduce(
    (counts, word) => {
      counts[word.wordConfidence.toUpperCase()] += 1;
      return counts;
    },
    { HIGH: 0, MEDIUM: 0, LOW: 0 },
  );
}

function reviewBreakdown(words) {
  const counts = Object.fromEntries(REVIEW_CATEGORIES.map((category) => [category, 0]));

  for (const word of words) {
    for (const category of word.reviewReasons) {
      counts[category] += 1;
    }
  }

  return counts;
}

function buildLevelStats(words) {
  return [1, 2, 3].map((level) => {
    const levelWords = words.filter((word) => word.level === level);

    return {
      level,
      good: levelWords.filter((word) => !word.reviewRequired).length,
      review: levelWords.filter((word) => word.reviewRequired).length,
    };
  });
}

function buildMissingReason(wordnetEntry, wiktionaryEntries, wiktionarySenses, wordnetCoverage, wiktionaryCoverage) {
  const reasons = [];

  if (!wordnetCoverage && !wiktionaryCoverage) {
    reasons.push("No Japanese meaning was available from either dictionary.");
  }

  if (wordnetEntry.found && !wordnetCoverage) {
    reasons.push("Japanese WordNet had English synsets but no Japanese lemmas.");
  }

  if (wiktionaryEntries.length > 0 && !wiktionaryCoverage) {
    reasons.push("Japanese Wiktionary had an English entry but no Japanese gloss was extracted.");
  }

  return reasons.join(" ");
}

function validateDictionary(dictionary, wordMaster) {
  const errors = [];
  const words = dictionary.map((entry) => entry.word);
  const wordSet = new Set(words);
  const masterWords = wordMaster.map((entry) => entry.word);
  const duplicateCount = words.length - wordSet.size;

  if (dictionary.length !== EXPECTED_TOTAL) {
    errors.push(`Total should be ${EXPECTED_TOTAL}, got ${dictionary.length}.`);
  }

  if (dictionary.length !== wordMaster.length) {
    errors.push(`Generated count ${dictionary.length} does not match wordMaster count ${wordMaster.length}.`);
  }

  if (duplicateCount !== 0) {
    errors.push(`Duplicate word count should be 0, got ${duplicateCount}.`);
  }

  const missingMasterWords = masterWords.filter((word) => !wordSet.has(word));

  if (missingMasterWords.length > 0) {
    errors.push(`Missing wordMaster words: ${missingMasterWords.slice(0, 20).join(", ")}`);
  }

  for (const entry of dictionary) {
    if (![1, 2, 3].includes(entry.level)) {
      errors.push(`${entry.word}: level is missing or invalid.`);
    }

    if (!Array.isArray(entry.sources) || entry.sources.length === 0) {
      errors.push(`${entry.word}: source information is missing.`);
    }

    if (!Array.isArray(entry.primaryMeanings) || entry.primaryMeanings.length > 3) {
      errors.push(`${entry.word}: primaryMeanings must have at most 3 entries.`);
    }

    if (!entry.reviewRequired && entry.primaryMeanings.length === 0) {
      errors.push(`${entry.word}: reviewRequired=false but primaryMeanings is empty.`);
    }

    if (!CONFIDENCE_VALUES.has(entry.wordConfidence)) {
      errors.push(`${entry.word}: wordConfidence is invalid or missing.`);
    }

    for (const primaryMeaning of entry.primaryMeanings) {
      if (!CONFIDENCE_VALUES.has(primaryMeaning.confidence)) {
        errors.push(`${entry.word}: primaryMeaning confidence is invalid.`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    duplicateCount,
  };
}

function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}

function printSummary(summary) {
  console.log("Full dictionary generation");
  console.log("--------------------------");
  console.log("");
  console.log(`Total words: ${summary.totalWords}`);
  console.log("");
  console.log(`Japanese WordNet coverage: ${summary.coverage.japaneseWordNet}`);
  console.log(`Wiktionary coverage: ${summary.coverage.wiktionary}`);
  console.log(`Both sources available: ${summary.coverage.both}`);
  console.log(`WordNet only: ${summary.coverage.wordnetOnly}`);
  console.log(`Wiktionary only: ${summary.coverage.wiktionaryOnly}`);
  console.log(`Neither source available: ${summary.coverage.neither}`);
  console.log("");
  console.log(`Good without review: ${summary.goodWithoutReview}`);
  console.log(`Review required: ${summary.reviewRequired}`);
  console.log(`Auto-usable ratio: ${formatPercent(summary.autoUsableRatio)}`);
  console.log("");
  console.log("Word-level confidence:");
  console.log(`HIGH: ${summary.wordConfidence.HIGH}`);
  console.log(`MEDIUM: ${summary.wordConfidence.MEDIUM}`);
  console.log(`LOW: ${summary.wordConfidence.LOW}`);
  console.log("");
  console.log("Primary-meaning confidence:");
  console.log(`HIGH: ${summary.primaryMeaningConfidence.HIGH}`);
  console.log(`MEDIUM: ${summary.primaryMeaningConfidence.MEDIUM}`);
  console.log(`LOW: ${summary.primaryMeaningConfidence.LOW}`);
  console.log("");
  console.log("Review breakdown:");
  for (const category of REVIEW_CATEGORIES) {
    console.log(`${category}: ${summary.reviewBreakdown[category]}`);
  }
  console.log("");
  for (const levelStat of summary.levelStats) {
    console.log(`Level ${levelStat.level}:`);
    console.log(`Good: ${levelStat.good}`);
    console.log(`Review: ${levelStat.review}`);
    console.log("");
  }
  console.log("Validation:");
  console.log(`Total: ${summary.validation.total}`);
  console.log(`Duplicates: ${summary.validation.duplicates}`);
  console.log(`Errors: ${summary.validation.errors.length}`);
  console.log("");
  console.log("Files generated:");
  console.log(`- ${summary.files.dictionary}`);
  console.log(`- ${summary.files.review}`);
  console.log(`- ${summary.files.lowConfidence}`);
  console.log(`- ${summary.files.missing}`);
  console.log(`- ${summary.files.summary}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const wordMaster = readJson(options.wordMaster);
  const dbPath = await ensureDatabase(options.db);
  const database = new DatabaseSync(dbPath, { readOnly: true });

  let wordnetWords;

  try {
    const schema = inspectSchema(database);
    wordnetWords = extractWords(database, schema, wordMaster);
  } finally {
    database.close();
  }

  const targetWords = new Set(wordMaster.map((entry) => normalizeEnglishWord(entry.word)));
  const wiktionaryLoad = await loadWiktionaryEntries(options.wiktionary, targetWords);
  const wordMasterByWord = new Map(wordMaster.map((entry) => [entry.word, entry]));
  const dictionary = [];
  const reviewRows = [];
  const lowConfidenceRows = [];
  const missingRows = [];

  for (const wordnetEntry of wordnetWords) {
    const masterEntry = wordMasterByWord.get(wordnetEntry.word);
    const normalizedWord = normalizeEnglishWord(wordnetEntry.word);
    const wiktionaryEntries = wiktionaryLoad.entriesByWord.get(normalizedWord) ?? [];
    const wiktionarySenses = flattenWiktionarySenses(wiktionaryEntries);
    const evaluation = evaluateWord(wordnetEntry, wiktionarySenses);
    const wordnetCoverage = (wordnetEntry.japaneseLemmaCount ?? 0) > 0;
    const wiktionaryCoverage = wiktionarySenses.some((sense) => sense.glosses.length > 0);
    const agreement = dictionaryAgreement(wordnetCoverage, wiktionaryCoverage, evaluation.finalCandidates);
    const primaryMeanings = evaluation.finalCandidates.map((candidate, index) => ({
      pos: candidate.pos,
      definitions: candidate.definitions,
      sources: candidate.sources,
      confidence: candidate.confidence,
      confidenceReason: candidate.confidenceReason,
      primaryRank: index + 1,
      sourceRefs: {
        synset: candidate.synset || null,
        wiktionarySenseId: candidate.wiktionarySenseId || null,
      },
    }));
    const mergedReview = mergeReviewCategories(wordnetEntry, wiktionarySenses, evaluation, primaryMeanings, agreement);
    const confidence = wordConfidence(primaryMeanings, mergedReview.categories);
    const reviewRequired = mergedReview.categories.length > 0;
    const wiktionarySummary = summarizeWiktionaryMeanings(wiktionarySenses);

    const dictionaryEntry = {
      word: masterEntry.word,
      level: masterEntry.level,
      sources: masterEntry.sources,
      meanings: buildMeanings(wordnetEntry, wiktionarySenses),
      primaryMeanings,
      wordConfidence: confidence,
      reviewRequired,
      reviewReasons: mergedReview.categories,
      reviewNotes: mergedReview.reasons,
      coverage: {
        japaneseWordNet: wordnetCoverage,
        wiktionary: wiktionaryCoverage,
        dictionaryAgreement: agreement,
      },
      japaneseWordNet: {
        found: wordnetEntry.found,
        numberOfSynsets: wordnetEntry.numberOfSynsets,
        japaneseLemmaCount: wordnetEntry.japaneseLemmaCount,
        senses: wordnetEntry.senses,
      },
      wiktionary: {
        found: wiktionaryEntries.length > 0,
        entryCount: wiktionaryEntries.length,
        senseCount: wiktionarySenses.length,
        senses: wiktionarySummary,
      },
    };

    dictionary.push(dictionaryEntry);

    const rowBase = {
      word: dictionaryEntry.word,
      level: dictionaryEntry.level,
      primaryMeaning1: formatPrimaryMeaning(primaryMeanings[0]),
      primaryMeaning2: formatPrimaryMeaning(primaryMeanings[1]),
      primaryMeaning3: formatPrimaryMeaning(primaryMeanings[2]),
      wordConfidence: dictionaryEntry.wordConfidence,
      reviewReasons: dictionaryEntry.reviewReasons.join("|"),
      wordnetCoverage,
      wiktionaryCoverage,
      dictionaryAgreement: agreement,
      notes: dictionaryEntry.reviewNotes.join(" "),
    };

    if (reviewRequired) {
      reviewRows.push(rowBase);
    }

    if (confidence === "low") {
      lowConfidenceRows.push(rowBase);
    }

    const missingReason = buildMissingReason(
      wordnetEntry,
      wiktionaryEntries,
      wiktionarySenses,
      wordnetCoverage,
      wiktionaryCoverage,
    );

    if (missingReason) {
      missingRows.push({
        word: dictionaryEntry.word,
        level: dictionaryEntry.level,
        wordnetEnglishEntryFound: wordnetEntry.found,
        wordnetCoverage,
        wiktionaryEntryFound: wiktionaryEntries.length > 0,
        wiktionaryCoverage,
        reason: missingReason,
      });
    }
  }

  const validation = validateDictionary(dictionary, wordMaster);

  if (!validation.ok) {
    throw new Error(`Generated dictionary failed validation:\n${validation.errors.join("\n")}`);
  }

  const coverage = {
    japaneseWordNet: dictionary.filter((entry) => entry.coverage.japaneseWordNet).length,
    wiktionary: dictionary.filter((entry) => entry.coverage.wiktionary).length,
    both: dictionary.filter((entry) => entry.coverage.japaneseWordNet && entry.coverage.wiktionary).length,
    wordnetOnly: dictionary.filter((entry) => entry.coverage.japaneseWordNet && !entry.coverage.wiktionary).length,
    wiktionaryOnly: dictionary.filter((entry) => !entry.coverage.japaneseWordNet && entry.coverage.wiktionary).length,
    neither: dictionary.filter((entry) => !entry.coverage.japaneseWordNet && !entry.coverage.wiktionary).length,
  };
  const goodWithoutReview = dictionary.filter((entry) => !entry.reviewRequired).length;
  const summary = {
    totalWords: dictionary.length,
    coverage,
    goodWithoutReview,
    reviewRequired: dictionary.length - goodWithoutReview,
    autoUsableRatio: dictionary.length === 0 ? 0 : (goodWithoutReview / dictionary.length) * 100,
    wordConfidence: wordConfidenceCounts(dictionary),
    primaryMeaningConfidence: primaryMeaningConfidenceCounts(dictionary),
    reviewBreakdown: reviewBreakdown(dictionary),
    levelStats: buildLevelStats(dictionary),
    validation: {
      total: dictionary.length,
      duplicates: validation.duplicateCount,
      errors: validation.errors,
    },
    wiktionaryInput: {
      path: options.wiktionary,
      lineCount: wiktionaryLoad.lineCount,
      parseErrors: wiktionaryLoad.parseErrors,
      matchedEntries: wiktionaryLoad.matchedEntries,
    },
    files: {
      dictionary: options.outDictionary,
      review: options.outReviewCsv,
      lowConfidence: options.outLowConfidenceCsv,
      missing: options.outMissingCsv,
      summary: options.outSummaryJson,
    },
  };

  writeFile(
    options.outDictionary,
    `${JSON.stringify(
      {
        metadata: {
          wordMasterPath: options.wordMaster,
          japaneseWordNetDbPath: options.db,
          wiktionaryPath: options.wiktionary,
          note:
            "Generated dictionary data for review. This file is not connected to the game runtime yet and contains only Japanese WordNet and Japanese Wiktionary derived data.",
          deterministic: true,
        },
        summary,
        words: dictionary,
      },
      null,
      2,
    )}\n`,
  );
  writeCsv(options.outReviewCsv, reviewRows, [
    "word",
    "level",
    "primaryMeaning1",
    "primaryMeaning2",
    "primaryMeaning3",
    "wordConfidence",
    "reviewReasons",
    "wordnetCoverage",
    "wiktionaryCoverage",
    "dictionaryAgreement",
    "notes",
  ]);
  writeCsv(options.outLowConfidenceCsv, lowConfidenceRows, [
    "word",
    "level",
    "primaryMeaning1",
    "primaryMeaning2",
    "primaryMeaning3",
    "wordConfidence",
    "reviewReasons",
    "wordnetCoverage",
    "wiktionaryCoverage",
    "dictionaryAgreement",
    "notes",
  ]);
  writeCsv(options.outMissingCsv, missingRows, [
    "word",
    "level",
    "wordnetEnglishEntryFound",
    "wordnetCoverage",
    "wiktionaryEntryFound",
    "wiktionaryCoverage",
    "reason",
  ]);
  writeFile(options.outSummaryJson, `${JSON.stringify(summary, null, 2)}\n`);

  printSummary(summary);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
