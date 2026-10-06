import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  LEVEL_CONFIG,
  SOURCE_PRIORITY,
  createSourceIndex,
  filterAdvancedCandidates,
  isPotentialInflection,
  isPotentialPlural,
  readRawSource,
} from "./generate-word-master-v2.mjs";
import { generateNewEntries, normalizeStatus } from "./generate-word-dictionary-v2.mjs";

const DEFAULT_OPTIONS = {
  reviewCsv: "reports/word-master-v2-human-review-reviewed.csv",
  wordMaster: "src/data/wordMasterV2.json",
  dictionary: "src/data/generated/wordDictionaryV2.json",
  db: "data/wordnet/wnjpn.db",
  wiktionary: "data/wiktionary/kaikki-jawiktionary-english.jsonl",
  outMaster: "src/data/wordMasterV2Final.json",
  outDictionary: "src/data/generated/wordDictionaryV2Final.json",
  outReplacementReview: "reports/replacement-review.csv",
  outReplacementHistory: "reports/word-master-v2-final-replacements.csv",
  outSummary: "reports/word-dictionary-v2-final-summary.json",
};

const REVIEW_DECISIONS = new Set(["EDIT", "REPLACE"]);
const CONFIDENCE_VALUES = new Set(["high", "medium", "low"]);
const VALID_REVIEW_STATUSES = new Set(["accepted", "needs_human_review", "missing_data"]);

const REPLACEMENT_SOURCE_ORDER = {
  1: ["TSL", "BSL", "NAWL"],
  2: ["TSL", "BSL", "NAWL"],
  3: ["NAWL", "BSL", "TSL"],
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

    const key = {
      "--review-csv": "reviewCsv",
      "--word-master": "wordMaster",
      "--dictionary": "dictionary",
      "--db": "db",
      "--wiktionary": "wiktionary",
      "--out-master": "outMaster",
      "--out-dictionary": "outDictionary",
      "--out-replacement-review": "outReplacementReview",
      "--out-replacement-history": "outReplacementHistory",
      "--out-summary": "outSummary",
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

function writeJson(filePath, data) {
  writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
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
    throw new Error(`Missing CSV file: ${filePath}`);
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

function normalizeWord(word) {
  return String(word ?? "").trim().toLowerCase();
}

function normalizeJapaneseText(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[。．.]+$/g, "")
    .trim();
}

function parseMeaningText(text, index) {
  const trimmed = String(text ?? "").trim();

  if (!trimmed) {
    return null;
  }

  const separatorIndex = trimmed.indexOf(":");
  const pos = separatorIndex >= 0 ? trimmed.slice(0, separatorIndex).trim() : "unknown";
  const body = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1).trim() : trimmed;
  const definitions = body
    .replace(/\[[^\]]+\]$/g, "")
    .split(/[・;；|/]/)
    .map((definition) => definition.trim())
    .filter(Boolean);

  return {
    pos: pos || "unknown",
    definitions: definitions.length > 0 ? definitions : [body],
    sources: ["human-review"],
    confidence: "high",
    confidenceReason: "Approved during final human review.",
    primaryRank: index + 1,
  };
}

function meaningTextsFromRow(row, fallbackMeaningByWord = new Map()) {
  const editedValues = [row.editedMeaning1, row.editedMeaning2, row.editedMeaning3].map((value) => String(value ?? "").trim());

  if (editedValues.some(Boolean)) {
    return editedValues;
  }

  const currentValues = [row.currentPrimaryMeaning1, row.currentPrimaryMeaning2, row.currentPrimaryMeaning3].map((value) =>
    String(value ?? "").trim(),
  );

  if (currentValues.some(Boolean)) {
    return currentValues;
  }

  return fallbackMeaningByWord.get(row.word) ?? [];
}

function parseEditedPrimaryMeanings(row, fallbackMeaningByWord = new Map()) {
  return meaningTextsFromRow(row, fallbackMeaningByWord)
    .map((value, index) => parseMeaningText(value, index))
    .filter(Boolean);
}

function formatPrimaryMeaning(primaryMeaning) {
  if (!primaryMeaning) {
    return "";
  }

  return `${primaryMeaning.pos}: ${(primaryMeaning.definitions ?? []).join("・")} [${primaryMeaning.confidence ?? ""}]`;
}

function sourceText(sources) {
  return (sources ?? []).map((source) => `${source.name}:${source.rank}`).join("|");
}

function loadReviewDecisions(filePath) {
  const rows = readCsv(filePath);
  const decisions = new Map();

  for (const row of rows) {
    const word = normalizeWord(row.word);
    const decision = String(row.decision ?? "").trim().toUpperCase();

    if (!word || !decision) {
      continue;
    }

    if (!REVIEW_DECISIONS.has(decision)) {
      throw new Error(`${word}: unsupported decision "${decision}".`);
    }

    decisions.set(word, {
      ...row,
      word,
      decision,
      level: Number(row.level),
    });
  }

  return decisions;
}

function loadFallbackMeaningRows() {
  const fallbackByWord = new Map();
  const sources = [
    {
      file: "reports/final-human-review-all.csv",
      fields: ["currentOrGeneratedMeaning1", "currentOrGeneratedMeaning2", "currentOrGeneratedMeaning3"],
    },
    {
      file: "reports/final-human-review-generated.csv",
      fields: ["generatedJapanese1", "generatedJapanese2", "generatedJapanese3"],
    },
  ];

  for (const source of sources) {
    const absolutePath = path.resolve(process.cwd(), source.file);

    if (!existsSync(absolutePath)) {
      continue;
    }

    for (const row of readCsv(source.file)) {
      const word = normalizeWord(row.word);
      const meanings = source.fields.map((field) => String(row[field] ?? "").trim()).filter(Boolean);

      if (!word || meanings.length === 0 || fallbackByWord.has(word)) {
        continue;
      }

      fallbackByWord.set(word, meanings);
    }
  }

  return fallbackByWord;
}

function readFilteredSources() {
  const rawSourceData = {
    TSL: readRawSource("TSL"),
    NAWL: readRawSource("NAWL"),
    BSL: readRawSource("BSL"),
    NGSL_CORE: readRawSource("NGSL_CORE"),
  };
  const ngslCoreWords = new Set(rawSourceData.NGSL_CORE.accepted.map((entry) => entry.word));
  const sourceData = filterAdvancedCandidates(rawSourceData, ngslCoreWords);
  const sourceIndex = createSourceIndex(sourceData);
  const sourceReferenceWords = new Set(
    SOURCE_PRIORITY.flatMap((sourceName) => rawSourceData[sourceName].accepted.map((entry) => entry.word)),
  );

  return {
    sourceData,
    sourceIndex,
    sourceReferenceWords,
  };
}

function isCandidateSuitable(word, selectedWords, removedWords, sourceReferenceWords) {
  return (
    !selectedWords.has(word) &&
    !removedWords.has(word) &&
    !isPotentialInflection(word, sourceReferenceWords) &&
    !isPotentialPlural(word, sourceReferenceWords)
  );
}

function findReplacement({ row, sourceData, sourceIndex, selectedWords, removedWords, sourceReferenceWords }) {
  const explicitReplacement = normalizeWord(row.replacementWord);

  if (explicitReplacement) {
    if (!sourceIndex.has(explicitReplacement)) {
      throw new Error(`${row.word}: replacementWord "${explicitReplacement}" is not present in filtered TSL/NAWL/BSL sources.`);
    }

    if (!isCandidateSuitable(explicitReplacement, selectedWords, removedWords, sourceReferenceWords)) {
      throw new Error(`${row.word}: replacementWord "${explicitReplacement}" is not suitable or already selected.`);
    }

    return explicitReplacement;
  }

  const sourceOrder = REPLACEMENT_SOURCE_ORDER[row.level] ?? LEVEL_CONFIG[row.level]?.sources ?? SOURCE_PRIORITY;

  for (const sourceName of sourceOrder) {
    for (const candidate of sourceData[sourceName].accepted) {
      if (!isCandidateSuitable(candidate.word, selectedWords, removedWords, sourceReferenceWords)) {
        continue;
      }

      return candidate.word;
    }
  }

  throw new Error(`${row.word}: no suitable replacement candidate found for level ${row.level}.`);
}

function applyEditedMeaning(entry, row, fallbackMeaningByWord) {
  const primaryMeanings = parseEditedPrimaryMeanings(row, fallbackMeaningByWord);

  if (primaryMeanings.length === 0) {
    throw new Error(`${entry.word}: EDIT decision has no editedMeaning values.`);
  }

  return {
    ...entry,
    primaryMeanings,
    wordConfidence: "high",
    reviewStatus: "accepted",
    reviewRequired: false,
    reviewReasons: [],
    reviewNotes: [
      ...(entry.reviewNotes ?? []),
      "Final human review accepted edited primary meanings.",
    ],
    reviewHistory: [
      ...(entry.reviewHistory ?? []),
      {
        stage: "word-dictionary-v2-final",
        decision: "EDIT",
        previousPrimaryMeanings: entry.primaryMeanings ?? [],
        previousReviewStatus: entry.reviewStatus ?? null,
        previousReviewReasons: entry.reviewReasons ?? [],
        editedPrimaryMeanings: primaryMeanings,
      },
    ],
  };
}

function makeReplacementHistoryRow(removedEntry, replacementEntry, row) {
  return {
    removedWord: row.word,
    level: row.level,
    removedSources: sourceText(removedEntry.sources),
    replacementWord: replacementEntry.word,
    replacementSources: sourceText(replacementEntry.sources),
    reason: "human-review-replace",
  };
}

function buildReplacementReviewRows(entries) {
  return entries
    .filter(
      (entry) =>
        entry.reviewStatus !== "accepted" ||
        entry.wordConfidence === "low" ||
        (entry.reviewReasons ?? []).includes("MISSING_JAPANESE"),
    )
    .map((entry) => ({
      word: entry.word,
      level: entry.level,
      primaryMeaning1: formatPrimaryMeaning(entry.primaryMeanings?.[0]),
      primaryMeaning2: formatPrimaryMeaning(entry.primaryMeanings?.[1]),
      primaryMeaning3: formatPrimaryMeaning(entry.primaryMeanings?.[2]),
      wordConfidence: entry.wordConfidence,
      reviewStatus: entry.reviewStatus,
      reviewReasons: (entry.reviewReasons ?? []).join("|"),
      wordnetCoverage: Boolean(entry.coverage?.japaneseWordNet),
      wiktionaryCoverage: Boolean(entry.coverage?.wiktionary),
      replacementFor: entry.replacementFor,
      recommendedAction: entry.reviewStatus === "missing_data" ? "CHECK_OR_REPLACE" : "REVIEW_PRIMARY_MEANINGS",
    }));
}

function validateFinal({ master, dictionary, editRows, replaceRows, replacementEntries, fallbackMeaningByWord }) {
  const errors = [];
  const masterWords = master.map((entry) => entry.word);
  const dictionaryWords = dictionary.map((entry) => entry.word);
  const masterSet = new Set(masterWords);
  const dictionarySet = new Set(dictionaryWords);
  const duplicates = masterWords.length - masterSet.size;
  const dictionaryDuplicates = dictionaryWords.length - dictionarySet.size;
  const levelCounts = {
    1: master.filter((entry) => entry.level === 1).length,
    2: master.filter((entry) => entry.level === 2).length,
    3: master.filter((entry) => entry.level === 3).length,
  };

  if (master.length !== 2308) {
    errors.push(`Total words should be 2308, got ${master.length}.`);
  }

  if (dictionary.length !== 2308) {
    errors.push(`Dictionary total should be 2308, got ${dictionary.length}.`);
  }

  if (levelCounts[1] !== 700 || levelCounts[2] !== 800 || levelCounts[3] !== 808) {
    errors.push(`Level counts should be 700/800/808, got ${levelCounts[1]}/${levelCounts[2]}/${levelCounts[3]}.`);
  }

  if (duplicates !== 0) {
    errors.push(`Master duplicate words should be 0, got ${duplicates}.`);
  }

  if (dictionaryDuplicates !== 0) {
    errors.push(`Dictionary duplicate words should be 0, got ${dictionaryDuplicates}.`);
  }

  const missingDictionaryWords = masterWords.filter((word) => !dictionarySet.has(word));

  if (missingDictionaryWords.length > 0) {
    errors.push(`Dictionary is missing master words: ${missingDictionaryWords.slice(0, 20).join(", ")}`);
  }

  const replacedWordsStillPresent = replaceRows.map((row) => row.word).filter((word) => masterSet.has(word));

  if (replacedWordsStillPresent.length > 0) {
    errors.push(`REPLACE words still present in final master: ${replacedWordsStillPresent.join(", ")}`);
  }

  const primaryOverLimit = dictionary.filter((entry) => (entry.primaryMeanings ?? []).length > 3);

  if (primaryOverLimit.length > 0) {
    errors.push(`primaryMeanings over 3: ${primaryOverLimit.map((entry) => entry.word).join(", ")}`);
  }

  const acceptedWithoutPrimary = dictionary.filter(
    (entry) => entry.reviewStatus === "accepted" && (!Array.isArray(entry.primaryMeanings) || entry.primaryMeanings.length === 0),
  );

  if (acceptedWithoutPrimary.length > 0) {
    errors.push(`Accepted words without primaryMeanings: ${acceptedWithoutPrimary.map((entry) => entry.word).join(", ")}`);
  }

  for (const entry of master) {
    if (!Array.isArray(entry.sources) || entry.sources.length === 0) {
      errors.push(`${entry.word}: source information is missing.`);
    }
  }

  for (const entry of dictionary) {
    if (!Array.isArray(entry.sources) || entry.sources.length === 0) {
      errors.push(`${entry.word}: dictionary source information is missing.`);
    }

    if (!VALID_REVIEW_STATUSES.has(entry.reviewStatus)) {
      errors.push(`${entry.word}: invalid reviewStatus ${entry.reviewStatus}.`);
    }

    if (!CONFIDENCE_VALUES.has(entry.wordConfidence)) {
      errors.push(`${entry.word}: invalid wordConfidence ${entry.wordConfidence}.`);
    }
  }

  const dictionaryByWord = new Map(dictionary.map((entry) => [entry.word, entry]));

  for (const row of editRows) {
    const entry = dictionaryByWord.get(row.word);
    const expected = parseEditedPrimaryMeanings(row, fallbackMeaningByWord).map((meaning) =>
      `${meaning.pos}:${meaning.definitions.map(normalizeJapaneseText).join("|")}`,
    );
    const actual = (entry?.primaryMeanings ?? []).map((meaning) =>
      `${meaning.pos}:${meaning.definitions.map(normalizeJapaneseText).join("|")}`,
    );

    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      errors.push(`${row.word}: edited meanings were not reflected in primaryMeanings.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    duplicates,
    dictionaryDuplicates,
    levelCounts,
    primaryOverLimit: primaryOverLimit.length,
    acceptedWithoutPrimary: acceptedWithoutPrimary.length,
    replacementReviewCount: buildReplacementReviewRows(replacementEntries).length,
  };
}

function countFinalStatus(dictionary) {
  return {
    accepted: dictionary.filter((entry) => entry.reviewStatus === "accepted").length,
    needsReview: dictionary.filter((entry) => entry.reviewStatus === "needs_human_review").length,
    missingData: dictionary.filter((entry) => entry.reviewStatus === "missing_data").length,
  };
}

function printSummary(summary) {
  console.log("## Final Dictionary Build");
  console.log("");
  console.log(`Total: ${summary.total}`);
  console.log("");
  console.log(`Human-reviewed EDIT applied: ${summary.humanReviewedEditApplied}`);
  console.log(`Human-reviewed REPLACE applied: ${summary.humanReviewedReplaceApplied}`);
  console.log("");
  console.log(`Replacement words added: ${summary.replacementWordsAdded}`);
  console.log(`Replacement words accepted: ${summary.replacementWordsAccepted}`);
  console.log(`Replacement words requiring review: ${summary.replacementWordsRequiringReview}`);
  console.log("");
  console.log(`Final accepted: ${summary.finalStatus.accepted}`);
  console.log(`Final needs review: ${summary.finalStatus.needsReview}`);
  console.log(`Final missing data: ${summary.finalStatus.missingData}`);
  console.log("");
  console.log(`Level 1: ${summary.levelCounts[1]}`);
  console.log(`Level 2: ${summary.levelCounts[2]}`);
  console.log(`Level 3: ${summary.levelCounts[3]}`);
  console.log("");
  console.log(`Duplicates: ${summary.duplicates}`);
  console.log(`Validation errors: ${summary.validationErrors.length}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(
      "Usage: node scripts/build-word-dictionary-v2-final.mjs --review-csv <reviewed-csv> [--out-master path] [--out-dictionary path]",
    );
    return;
  }

  const reviewDecisions = loadReviewDecisions(options.reviewCsv);
  const fallbackMeaningByWord = loadFallbackMeaningRows();
  const editRows = [...reviewDecisions.values()].filter((row) => row.decision === "EDIT");
  const replaceRows = [...reviewDecisions.values()].filter((row) => row.decision === "REPLACE");
  const master = readJson(options.wordMaster);
  const dictionaryJson = readJson(options.dictionary);
  const dictionary = Array.isArray(dictionaryJson) ? dictionaryJson : dictionaryJson.words;
  const masterByWord = new Map(master.map((entry) => [entry.word, entry]));
  const dictionaryByWord = new Map(dictionary.map((entry) => [entry.word, entry]));
  const removedWords = new Set(replaceRows.map((row) => row.word));
  const selectedWords = new Set(master.map((entry) => entry.word).filter((word) => !removedWords.has(word)));
  const { sourceData, sourceIndex, sourceReferenceWords } = readFilteredSources();
  const finalMaster = master.filter((entry) => !removedWords.has(entry.word));
  const replacementHistory = [];
  const replacementMasterEntries = [];

  for (const row of replaceRows) {
    const removedEntry = masterByWord.get(row.word);

    if (!removedEntry) {
      throw new Error(`${row.word}: REPLACE word was not found in wordMasterV2.`);
    }

    const replacementWord = findReplacement({
      row,
      sourceData,
      sourceIndex,
      selectedWords,
      removedWords,
      sourceReferenceWords,
    });
    const replacementEntry = {
      word: replacementWord,
      level: row.level,
      sources: sourceIndex.get(replacementWord),
      replacementFor: row.word,
    };

    selectedWords.add(replacementWord);
    finalMaster.push({
      word: replacementEntry.word,
      level: replacementEntry.level,
      sources: replacementEntry.sources,
    });
    replacementMasterEntries.push(replacementEntry);
    replacementHistory.push(makeReplacementHistoryRow(removedEntry, replacementEntry, row));
  }

  finalMaster.sort((a, b) => a.level - b.level || a.word.localeCompare(b.word));

  const replacementEntries = await generateNewEntries(replacementMasterEntries, {
    db: options.db,
    wiktionary: options.wiktionary,
  });
  const replacementEntriesByWord = new Map(
    replacementEntries.map((entry) => [
      entry.word,
      {
        ...entry,
        dictionaryReuseType: "replacement",
        replacementFor: replacementMasterEntries.find((candidate) => candidate.word === entry.word)?.replacementFor ?? null,
        reviewHistory: [
          ...(entry.reviewHistory ?? []),
          {
            stage: "word-dictionary-v2-final",
            decision: "REPLACEMENT_ADDED",
            replacementFor: replacementMasterEntries.find((candidate) => candidate.word === entry.word)?.replacementFor ?? null,
          },
        ],
      },
    ]),
  );
  const finalDictionary = [];

  for (const masterEntry of finalMaster) {
    const replacementEntry = replacementEntriesByWord.get(masterEntry.word);

    if (replacementEntry) {
      finalDictionary.push({
        ...replacementEntry,
        level: masterEntry.level,
        sources: masterEntry.sources,
      });
      continue;
    }

    const entry = dictionaryByWord.get(masterEntry.word);

    if (!entry) {
      throw new Error(`${masterEntry.word}: dictionary entry missing.`);
    }

    const decisionRow = reviewDecisions.get(masterEntry.word);
    const normalizedEntry = {
      ...entry,
      level: masterEntry.level,
      sources: masterEntry.sources,
      reviewStatus: normalizeStatus(entry.reviewStatus, entry.reviewRequired),
    };

    if (decisionRow?.decision === "EDIT") {
      finalDictionary.push(applyEditedMeaning(normalizedEntry, decisionRow, fallbackMeaningByWord));
    } else {
      finalDictionary.push(normalizedEntry);
    }
  }

  finalDictionary.sort((a, b) => a.level - b.level || a.word.localeCompare(b.word));

  const replacementReviewRows = buildReplacementReviewRows([...replacementEntriesByWord.values()]);
  const validation = validateFinal({
    master: finalMaster,
    dictionary: finalDictionary,
    editRows,
    replaceRows,
    replacementEntries: [...replacementEntriesByWord.values()],
    fallbackMeaningByWord,
  });
  const finalStatus = countFinalStatus(finalDictionary);
  const summary = {
    generatedAt: new Date().toISOString(),
    total: finalMaster.length,
    reviewCsv: options.reviewCsv,
    humanReviewedEditApplied: editRows.length,
    humanReviewedReplaceApplied: replaceRows.length,
    replacementWordsAdded: replacementMasterEntries.length,
    replacementWordsAccepted: [...replacementEntriesByWord.values()].filter((entry) => entry.reviewStatus === "accepted").length,
    replacementWordsRequiringReview: replacementReviewRows.length,
    finalStatus,
    levelCounts: validation.levelCounts,
    duplicates: validation.duplicates,
    validationErrors: validation.errors,
    files: {
      wordMaster: options.outMaster,
      wordDictionary: options.outDictionary,
      replacementReview: options.outReplacementReview,
      replacementHistory: options.outReplacementHistory,
      summary: options.outSummary,
    },
  };

  writeJson(options.outMaster, finalMaster);
  writeJson(options.outDictionary, {
    metadata: {
      wordMasterPath: options.outMaster,
      sourceWordMasterPath: options.wordMaster,
      sourceDictionaryPath: options.dictionary,
      reviewCsvPath: options.reviewCsv,
      note:
        "Final dictionary generated from Word Dictionary V2 plus human-reviewed EDIT/REPLACE decisions. It is not connected to the game runtime.",
      deterministic: true,
      removedWords: replacementHistory,
    },
    summary,
    words: finalDictionary,
  });
  writeCsv(options.outReplacementReview, replacementReviewRows, [
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
    "replacementFor",
    "recommendedAction",
  ]);
  writeCsv(options.outReplacementHistory, replacementHistory, [
    "removedWord",
    "level",
    "removedSources",
    "replacementWord",
    "replacementSources",
    "reason",
  ]);
  writeJson(options.outSummary, summary);
  printSummary(summary);

  if (!validation.ok) {
    throw new Error(`Final dictionary validation failed:\n${validation.errors.join("\n")}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
