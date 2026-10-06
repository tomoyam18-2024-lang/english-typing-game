import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  wordMaster: "src/data/wordMasterV2.json",
  dictionary: "src/data/generated/wordDictionaryReviewStatus.json",
  wiktionary: "data/wiktionary/kaikki-jawiktionary-english.jsonl",
  humanReview: "reports/final-human-review-all-reviewed.csv",
  outDictionary: "src/data/generated/wordDictionaryV2.json",
  outFinalReviewCsv: "reports/word-master-v2-final-review.csv",
  outSummaryJson: "reports/word-dictionary-v2-summary.json",
};

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

const CONFIDENCE_VALUES = new Set(["high", "medium", "low"]);
const REVIEW_STATUSES = new Set(["accepted", "needs_human_review", "missing_data"]);

function printHelp() {
  console.log(`Usage:
  node scripts/generate-word-dictionary-v2.mjs [options]

Options:
  --db <path>                 Japanese WordNet SQLite DB path.
                              Default: ${DEFAULT_OPTIONS.db}
  --word-master <path>        Word Master V2 JSON path.
                              Default: ${DEFAULT_OPTIONS.wordMaster}
  --dictionary <path>         Existing review-status dictionary JSON.
                              Default: ${DEFAULT_OPTIONS.dictionary}
  --wiktionary <path>         Japanese Wiktionary English JSONL or JSONL.GZ file.
                              Default: ${DEFAULT_OPTIONS.wiktionary}
  --human-review <path>       Optional completed human review CSV.
                              Default: ${DEFAULT_OPTIONS.humanReview}
  --out-dictionary <path>     Generated V2 dictionary JSON path.
                              Default: ${DEFAULT_OPTIONS.outDictionary}
  --out-final-review-csv <path>
                              Final review CSV path.
                              Default: ${DEFAULT_OPTIONS.outFinalReviewCsv}
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

    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    const key = {
      "--db": "db",
      "--word-master": "wordMaster",
      "--dictionary": "dictionary",
      "--wiktionary": "wiktionary",
      "--human-review": "humanReview",
      "--out-dictionary": "outDictionary",
      "--out-final-review-csv": "outFinalReviewCsv",
      "--out-summary-json": "outSummaryJson",
    }[arg];

    if (!key) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options[key] = value;
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

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"' && inQuotes && nextCharacter === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
}

function readCsv(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);

  if (!existsSync(absolutePath)) {
    return [];
  }

  const lines = readFileSync(absolutePath, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""]));
  });
}

function normalizeJapaneseText(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[。．.]+$/g, "")
    .trim();
}

function uniqueNormalized(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const text = String(value ?? "").normalize("NFKC").trim();
    const key = normalizeJapaneseText(text);

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

function meaningDisplay(primaryMeaning) {
  if (!primaryMeaning) {
    return "";
  }

  return `${primaryMeaning.pos}: ${primaryMeaning.definitions.join("・")}`;
}

function normalizeMeaningKey(primaryMeaning) {
  return `${primaryMeaning.pos}:${primaryMeaning.definitions
    .map((definition) => normalizeJapaneseText(definition))
    .sort()
    .join("|")}`;
}

function hasDuplicatePrimaryMeanings(primaryMeanings) {
  const exactKeys = new Set();
  const firstDefinitionKeys = new Set();

  for (const primaryMeaning of primaryMeanings) {
    const key = normalizeMeaningKey(primaryMeaning);
    const firstDefinition = `${primaryMeaning.pos}:${normalizeJapaneseText(primaryMeaning.definitions[0] ?? "")}`;

    if (exactKeys.has(key) || (primaryMeaning.definitions.length > 1 && firstDefinitionKeys.has(firstDefinition))) {
      return true;
    }

    exactKeys.add(key);
    firstDefinitionKeys.add(firstDefinition);
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

  return finalCandidates.some(
    (candidate) => candidate.sources.includes("japanese-wordnet") && candidate.sources.includes("ja-wiktionary"),
  )
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

function normalizeStatus(status, reviewRequired) {
  const raw = String(status ?? "").trim().toLowerCase().replaceAll("-", "_");

  if (raw === "accepted" || raw === "auto_accept" || (!raw && reviewRequired === false)) {
    return "accepted";
  }

  if (raw === "missing_data" || raw === "missing_japanese" || raw === "missing") {
    return "missing_data";
  }

  if (
    raw === "needs_human_review" ||
    raw === "needs_review" ||
    raw === "review_required" ||
    raw === "reviewrequired" ||
    raw === "human_review_required" ||
    reviewRequired === true
  ) {
    return "needs_human_review";
  }

  return raw && REVIEW_STATUSES.has(raw) ? raw : "needs_human_review";
}

function hasEmptyJapanese(entry) {
  return entry.primaryMeanings.some((meaning) => meaning.definitions.some((definition) => !normalizeJapaneseText(definition)));
}

function hasLongJapanese(entry) {
  return entry.primaryMeanings.some((meaning) =>
    meaning.definitions.some((definition) => [...normalizeJapaneseText(definition)].length >= 18),
  );
}

function hasAnyDictionaryGrounding(entry) {
  return Boolean(entry.coverage?.japaneseWordNet || entry.coverage?.wiktionary);
}

function hasClearPrimaryGrounding(entry) {
  return entry.primaryMeanings.some(
    (meaning) =>
      Array.isArray(meaning.sources) &&
      meaning.sources.some((source) => source === "japanese-wordnet" || source === "ja-wiktionary"),
  );
}

function safeAutoAccept(entry) {
  const reasons = new Set(entry.reviewReasons ?? []);

  if (entry.primaryMeanings.length === 0 || entry.primaryMeanings.length > 3) {
    return false;
  }

  if (entry.wordConfidence === "low" || entry.primaryMeanings.some((meaning) => meaning.confidence === "low")) {
    return false;
  }

  if (reasons.has("MISSING_JAPANESE")) {
    return false;
  }

  const severeReasons = [
    "UNNATURAL_JAPANESE",
    "LOW_CONFIDENCE",
    "DICTIONARY_DISAGREEMENT",
    "DUPLICATE_MEANINGS",
    "POS_MISMATCH",
    "OTHER",
  ];

  if (severeReasons.some((reason) => reasons.has(reason))) {
    return false;
  }

  if (hasEmptyJapanese(entry) || hasLongJapanese(entry) || hasDuplicatePrimaryMeanings(entry.primaryMeanings)) {
    return false;
  }

  if (!hasAnyDictionaryGrounding(entry) || !hasClearPrimaryGrounding(entry)) {
    return false;
  }

  return true;
}

function statusForGeneratedEntry(entry) {
  if (
    entry.primaryMeanings.length === 0 ||
    entry.reviewReasons.includes("MISSING_JAPANESE") ||
    (!entry.coverage?.japaneseWordNet && !entry.coverage?.wiktionary)
  ) {
    return "missing_data";
  }

  return safeAutoAccept(entry) ? "accepted" : "needs_human_review";
}

function statusForReusedEntry(entry) {
  const normalized = normalizeStatus(entry.reviewStatus, entry.reviewRequired);

  if (normalized === "accepted" && entry.primaryMeanings?.length >= 1 && entry.primaryMeanings.length <= 3) {
    return "accepted";
  }

  if (
    normalized === "missing_data" ||
    !Array.isArray(entry.primaryMeanings) ||
    entry.primaryMeanings.length === 0 ||
    entry.reviewReasons?.includes("MISSING_JAPANESE") ||
    (!entry.coverage?.japaneseWordNet && !entry.coverage?.wiktionary)
  ) {
    return "missing_data";
  }

  return "needs_human_review";
}

function createPrimaryMeaningFromEditedText(text, fallback, index) {
  const trimmed = String(text ?? "").trim();

  if (!trimmed) {
    return null;
  }

  const [maybePos, ...rest] = trimmed.split(":");
  const hasPos = rest.length > 0 && /^[A-Za-z ]+$/.test(maybePos.trim());
  const pos = hasPos ? maybePos.trim() : fallback?.pos ?? "unknown";
  const body = hasPos ? rest.join(":").trim() : trimmed;
  const definitions = body
    .replace(/\[[^\]]+\]$/g, "")
    .split(/[・;；|/]/)
    .map((definition) => definition.trim())
    .filter(Boolean);

  return {
    pos,
    definitions: uniqueNormalized(definitions.length > 0 ? definitions : [body]),
    sources: ["human-review"],
    confidence: "high",
    confidenceReason: "Primary meaning was edited during human review.",
    primaryRank: index + 1,
  };
}

function loadHumanReviewDecisions(filePath) {
  const rows = readCsv(filePath);
  const decisions = new Map();

  for (const row of rows) {
    const decision = String(row.decision ?? "").trim().toUpperCase();

    if (!["ACCEPT", "EDIT", "EXCLUDE"].includes(decision)) {
      continue;
    }

    decisions.set(row.word, {
      decision,
      editedMeaning1: row.editedMeaning1 ?? "",
      editedMeaning2: row.editedMeaning2 ?? "",
      editedMeaning3: row.editedMeaning3 ?? "",
      row,
    });
  }

  return decisions;
}

function applyHumanDecision(entry, decision) {
  if (!decision) {
    return entry;
  }

  const reviewHistory = [
    ...(entry.reviewHistory ?? []),
    {
      stage: "word-master-v2-human-review",
      decision: decision.decision,
      appliedAt: new Date().toISOString(),
    },
  ];

  if (decision.decision === "ACCEPT") {
    return {
      ...entry,
      reviewStatus: "accepted",
      reviewRequired: false,
      reviewHistory,
    };
  }

  if (decision.decision === "EDIT") {
    const editedPrimaryMeanings = [decision.editedMeaning1, decision.editedMeaning2, decision.editedMeaning3]
      .map((text, index) => createPrimaryMeaningFromEditedText(text, entry.primaryMeanings[index], index))
      .filter(Boolean);

    return {
      ...entry,
      primaryMeanings: editedPrimaryMeanings,
      wordConfidence: editedPrimaryMeanings.length > 0 ? "high" : entry.wordConfidence,
      reviewStatus: editedPrimaryMeanings.length > 0 ? "accepted" : "needs_human_review",
      reviewRequired: editedPrimaryMeanings.length === 0,
      reviewReasons: editedPrimaryMeanings.length > 0 ? [] : entry.reviewReasons,
      reviewHistory,
    };
  }

  return {
    ...entry,
    reviewStatus: "excluded",
    reviewRequired: true,
    reviewHistory,
  };
}

function buildGeneratedDictionaryEntry(masterEntry, wordnetEntry, wiktionaryEntries) {
  const normalizedWord = normalizeEnglishWord(wordnetEntry.word);
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
  const wiktionarySummary = summarizeWiktionaryMeanings(wiktionarySenses);
  const baseEntry = {
    word: masterEntry.word,
    level: masterEntry.level,
    sources: masterEntry.sources,
    meanings: buildMeanings(wordnetEntry, wiktionarySenses),
    primaryMeanings,
    wordConfidence: confidence,
    reviewRequired: mergedReview.categories.length > 0,
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
    generation: {
      source: "word-master-v2-new-word",
      normalizedWord,
    },
  };
  const reviewStatus = statusForGeneratedEntry(baseEntry);

  return {
    ...baseEntry,
    reviewStatus,
    reviewRequired: reviewStatus !== "accepted",
  };
}

function sourceHistory(entry) {
  const sourceText = (entry.sources ?? []).map((source) => `${source.name}:${source.rank}`).join("|");
  const previousStatus = entry.previousReviewStatus ? `previousStatus=${entry.previousReviewStatus}` : "";
  const reuseType = entry.dictionaryReuseType ? `reuse=${entry.dictionaryReuseType}` : "";

  return [reuseType, previousStatus, sourceText].filter(Boolean).join("; ");
}

function buildFinalReviewRows(dictionary) {
  return dictionary
    .filter((entry) => entry.reviewStatus !== "accepted")
    .map((entry) => ({
      word: entry.word,
      level: entry.level,
      primaryMeaning1: formatPrimaryMeaning(entry.primaryMeanings[0]),
      primaryMeaning2: formatPrimaryMeaning(entry.primaryMeanings[1]),
      primaryMeaning3: formatPrimaryMeaning(entry.primaryMeanings[2]),
      wordConfidence: entry.wordConfidence,
      reviewStatus: entry.reviewStatus,
      reviewReasons: (entry.reviewReasons ?? []).join("|"),
      wordnetCoverage: Boolean(entry.coverage?.japaneseWordNet),
      wiktionaryCoverage: Boolean(entry.coverage?.wiktionary),
      sourceHistory: sourceHistory(entry),
      recommendedAction:
        entry.reviewStatus === "missing_data"
          ? "MISSING_DATA"
          : entry.primaryMeanings.length > 0
            ? "CHOOSE_FROM_CANDIDATES"
            : "FIND_DICTIONARY_DATA",
    }));
}

function countBy(items, callback) {
  const counts = {};

  for (const item of items) {
    const key = callback(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

function wordConfidenceCounts(words) {
  return words.reduce(
    (counts, word) => {
      const key = String(word.wordConfidence ?? "low").toUpperCase();
      counts[key] += 1;
      return counts;
    },
    { HIGH: 0, MEDIUM: 0, LOW: 0 },
  );
}

function validateDictionary(dictionary, wordMaster, humanDecisions) {
  const errors = [];
  const words = dictionary.map((entry) => entry.word);
  const wordSet = new Set(words);
  const masterWords = wordMaster.map((entry) => entry.word);
  const duplicateCount = words.length - wordSet.size;
  const levelCounts = countBy(dictionary, (entry) => entry.level);

  if (dictionary.length !== wordMaster.length) {
    errors.push(`Total should be ${wordMaster.length}, got ${dictionary.length}.`);
  }

  if (levelCounts[1] !== 700 || levelCounts[2] !== 800 || levelCounts[3] !== 808) {
    errors.push(`Level counts should be 700/800/808, got ${levelCounts[1] ?? 0}/${levelCounts[2] ?? 0}/${levelCounts[3] ?? 0}.`);
  }

  if (duplicateCount !== 0) {
    errors.push(`Duplicate word count should be 0, got ${duplicateCount}.`);
  }

  const missingMasterWords = masterWords.filter((word) => !wordSet.has(word));

  if (missingMasterWords.length > 0) {
    errors.push(`Missing wordMasterV2 words: ${missingMasterWords.slice(0, 20).join(", ")}`);
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

    if (entry.reviewStatus === "accepted" && (entry.primaryMeanings.length < 1 || entry.primaryMeanings.length > 3)) {
      errors.push(`${entry.word}: accepted word must have 1-3 primaryMeanings.`);
    }

    if (!REVIEW_STATUSES.has(entry.reviewStatus)) {
      errors.push(`${entry.word}: reviewStatus is invalid: ${entry.reviewStatus}`);
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

  const excludedWordsInMaster = [...humanDecisions.entries()]
    .filter(([, decision]) => decision.decision === "EXCLUDE")
    .map(([word]) => word)
    .filter((word) => wordSet.has(word));

  if (excludedWordsInMaster.length > 0) {
    errors.push(`Human-reviewed EXCLUDE words are still in wordMasterV2: ${excludedWordsInMaster.join(", ")}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    duplicateCount,
    levelCounts: {
      1: levelCounts[1] ?? 0,
      2: levelCounts[2] ?? 0,
      3: levelCounts[3] ?? 0,
    },
  };
}

function buildCoverage(dictionary) {
  return {
    japaneseWordNet: dictionary.filter((entry) => entry.coverage?.japaneseWordNet).length,
    wiktionary: dictionary.filter((entry) => entry.coverage?.wiktionary).length,
    both: dictionary.filter((entry) => entry.coverage?.japaneseWordNet && entry.coverage?.wiktionary).length,
    neither: dictionary.filter((entry) => !entry.coverage?.japaneseWordNet && !entry.coverage?.wiktionary).length,
  };
}

function printSummary(summary) {
  console.log("## Word Dictionary V2");
  console.log("");
  console.log(`Total words: ${summary.totalWords}`);
  console.log("");
  console.log(`Reused dictionary entries: ${summary.reusedDictionaryEntries}`);
  console.log(`New dictionary entries processed: ${summary.newDictionaryEntriesProcessed}`);
  console.log("");
  console.log("Reused entries:");
  console.log(`Already accepted: ${summary.reusedEntries.alreadyAccepted}`);
  console.log(`Still requiring review: ${summary.reusedEntries.stillRequiringReview}`);
  console.log("");
  console.log("New 354:");
  console.log(`Accepted automatically: ${summary.newEntries.acceptedAutomatically}`);
  console.log(`Review required: ${summary.newEntries.reviewRequired}`);
  console.log(`Missing data: ${summary.newEntries.missingData}`);
  console.log("");
  console.log("Final status:");
  console.log(`Accepted: ${summary.finalStatus.accepted}`);
  console.log(`Needs review: ${summary.finalStatus.needsReview}`);
  console.log(`Missing data: ${summary.finalStatus.missingData}`);
  console.log("");
  console.log("Word-level confidence:");
  console.log(`HIGH: ${summary.wordConfidence.HIGH}`);
  console.log(`MEDIUM: ${summary.wordConfidence.MEDIUM}`);
  console.log(`LOW: ${summary.wordConfidence.LOW}`);
  console.log("");
  console.log("Japanese WordNet coverage:");
  console.log(`Japanese WordNet: ${summary.coverage.japaneseWordNet}`);
  console.log(`Wiktionary: ${summary.coverage.wiktionary}`);
  console.log(`Both: ${summary.coverage.both}`);
  console.log(`Neither: ${summary.coverage.neither}`);
  console.log("");
  console.log("Validation:");
  console.log(`Total: ${summary.validation.total}`);
  console.log(`Duplicates: ${summary.validation.duplicates}`);
  console.log(`Errors: ${summary.validation.errors.length}`);
}

async function generateNewEntries(newMasterEntries, options) {
  if (newMasterEntries.length === 0) {
    return [];
  }

  const dbPath = await ensureDatabase(options.db);
  const database = new DatabaseSync(dbPath, { readOnly: true });
  let wordnetWords;

  try {
    const schema = inspectSchema(database);
    wordnetWords = extractWords(database, schema, newMasterEntries);
  } finally {
    database.close();
  }

  const targetWords = new Set(newMasterEntries.map((entry) => normalizeEnglishWord(entry.word)));
  const wiktionaryLoad = await loadWiktionaryEntries(options.wiktionary, targetWords);
  const masterByWord = new Map(newMasterEntries.map((entry) => [entry.word, entry]));

  return wordnetWords.map((wordnetEntry) => {
    const normalizedWord = normalizeEnglishWord(wordnetEntry.word);
    const wiktionaryEntries = wiktionaryLoad.entriesByWord.get(normalizedWord) ?? [];
    const entry = buildGeneratedDictionaryEntry(masterByWord.get(wordnetEntry.word), wordnetEntry, wiktionaryEntries);

    return {
      ...entry,
      dictionaryReuseType: "new",
    };
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const wordMaster = readJson(options.wordMaster);
  const existingDictionaryJson = readJson(options.dictionary);
  const existingWords = Array.isArray(existingDictionaryJson) ? existingDictionaryJson : existingDictionaryJson.words;
  const existingByWord = new Map(existingWords.map((entry) => [entry.word, entry]));
  const humanDecisions = loadHumanReviewDecisions(options.humanReview);
  const reusedMasterEntries = wordMaster.filter((entry) => existingByWord.has(entry.word));
  const newMasterEntries = wordMaster.filter((entry) => !existingByWord.has(entry.word));
  const newEntries = await generateNewEntries(newMasterEntries, options);
  const newByWord = new Map(newEntries.map((entry) => [entry.word, entry]));
  const dictionary = [];
  const excludedHumanReviewWords = [];

  for (const masterEntry of wordMaster) {
    const existingEntry = existingByWord.get(masterEntry.word);
    let entry;

    if (existingEntry) {
      const previousReviewStatus = normalizeStatus(existingEntry.reviewStatus, existingEntry.reviewRequired);
      entry = {
        ...existingEntry,
        previousMaster: {
          level: existingEntry.level,
          sources: existingEntry.sources ?? [],
        },
        previousReviewStatus,
        level: masterEntry.level,
        sources: masterEntry.sources,
        dictionaryReuseType: "reused",
      };
      entry = {
        ...entry,
        reviewStatus: statusForReusedEntry(entry),
      };
      entry.reviewRequired = entry.reviewStatus !== "accepted";
    } else {
      entry = newByWord.get(masterEntry.word);
    }

    if (!entry) {
      throw new Error(`Dictionary entry was not generated for ${masterEntry.word}.`);
    }

    const humanDecision = humanDecisions.get(masterEntry.word);
    const entryAfterHumanDecision = applyHumanDecision(entry, humanDecision);

    if (entryAfterHumanDecision.reviewStatus === "excluded") {
      excludedHumanReviewWords.push(masterEntry.word);
    }

    if (entryAfterHumanDecision.reviewStatus !== "excluded") {
      dictionary.push({
        meanings: [],
        primaryMeanings: [],
        reviewReasons: [],
        ...entryAfterHumanDecision,
        reviewStatus: normalizeStatus(entryAfterHumanDecision.reviewStatus, entryAfterHumanDecision.reviewRequired),
      });
    }
  }

  const validation = validateDictionary(dictionary, wordMaster, humanDecisions);
  const finalReviewRows = buildFinalReviewRows(dictionary);
  const reusedEntries = dictionary.filter((entry) => entry.dictionaryReuseType === "reused");
  const generatedEntries = dictionary.filter((entry) => entry.dictionaryReuseType === "new");
  const finalStatus = {
    accepted: dictionary.filter((entry) => entry.reviewStatus === "accepted").length,
    needsReview: dictionary.filter((entry) => entry.reviewStatus === "needs_human_review").length,
    missingData: dictionary.filter((entry) => entry.reviewStatus === "missing_data").length,
  };
  const summary = {
    totalWords: dictionary.length,
    reusedDictionaryEntries: reusedEntries.length,
    newDictionaryEntriesProcessed: generatedEntries.length,
    reusedEntries: {
      alreadyAccepted: reusedEntries.filter((entry) => entry.reviewStatus === "accepted").length,
      stillRequiringReview: reusedEntries.filter((entry) => entry.reviewStatus !== "accepted").length,
      statusBreakdown: countBy(reusedEntries, (entry) => entry.reviewStatus),
      previousStatusBreakdown: countBy(reusedEntries, (entry) => entry.previousReviewStatus ?? "unknown"),
    },
    newEntries: {
      acceptedAutomatically: generatedEntries.filter((entry) => entry.reviewStatus === "accepted").length,
      reviewRequired: generatedEntries.filter((entry) => entry.reviewStatus === "needs_human_review").length,
      missingData: generatedEntries.filter((entry) => entry.reviewStatus === "missing_data").length,
    },
    finalStatus,
    wordConfidence: wordConfidenceCounts(dictionary),
    coverage: buildCoverage(dictionary),
    validation: {
      total: dictionary.length,
      levelCounts: validation.levelCounts,
      duplicates: validation.duplicateCount,
      errors: validation.errors,
    },
    humanReview: {
      inputPath: options.humanReview,
      decisionsApplied: humanDecisions.size,
      excludedWordsInV2: excludedHumanReviewWords,
    },
    files: {
      dictionary: options.outDictionary,
      finalReview: options.outFinalReviewCsv,
      summary: options.outSummaryJson,
    },
  };

  writeFile(
    options.outDictionary,
    `${JSON.stringify(
      {
        metadata: {
          wordMasterPath: options.wordMaster,
          reusedDictionaryPath: options.dictionary,
          japaneseWordNetDbPath: options.db,
          wiktionaryPath: options.wiktionary,
          humanReviewPath: existsSync(path.resolve(process.cwd(), options.humanReview)) ? options.humanReview : null,
          note:
            "Generated Word Dictionary V2. This data is not connected to the game runtime and preserves raw Japanese WordNet/Wiktionary data where available.",
          deterministic: true,
        },
        summary,
        words: dictionary,
      },
      null,
      2,
    )}\n`,
  );
  writeCsv(options.outFinalReviewCsv, finalReviewRows, [
    "word",
    "level",
    "primaryMeaning1",
    "primaryMeaning2",
    "primaryMeaning3",
    "wordConfidence",
    "reviewStatus",
    "reviewReasons",
    "wordnetCoverage",
    "wiktionaryCoverage",
    "sourceHistory",
    "recommendedAction",
  ]);
  writeFile(options.outSummaryJson, `${JSON.stringify(summary, null, 2)}\n`);
  printSummary(summary);

  if (!validation.ok) {
    throw new Error(`Word Dictionary V2 validation failed:\n${validation.errors.join("\n")}`);
  }
}

export {
  generateNewEntries,
  normalizeStatus,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
