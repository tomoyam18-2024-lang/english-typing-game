import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_OPTIONS = {
  dictionary: "src/data/generated/wordDictionary.json",
  outAutoAccept: "reports/review-auto-accept.csv",
  outNeedsHuman: "reports/review-needs-human.csv",
  outMissingData: "reports/review-missing-data.csv",
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

const DECISIONS = ["AUTO_ACCEPT", "NEEDS_REVIEW", "MISSING_DATA"];
const CONFIDENCES = ["high", "medium", "low"];

function printHelp() {
  console.log(`Usage:
  node scripts/triage-dictionary-review.mjs [options]

Options:
  --dictionary <path>       Generated word dictionary JSON.
                            Default: ${DEFAULT_OPTIONS.dictionary}
  --out-auto-accept <path>  AUTO_ACCEPT candidate CSV path.
                            Default: ${DEFAULT_OPTIONS.outAutoAccept}
  --out-needs-human <path>  Human review CSV path.
                            Default: ${DEFAULT_OPTIONS.outNeedsHuman}
  --out-missing-data <path> Missing data CSV path.
                            Default: ${DEFAULT_OPTIONS.outMissingData}
  --help                    Show this help.
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

    if (arg === "--dictionary") {
      options.dictionary = value;
    } else if (arg === "--out-auto-accept") {
      options.outAutoAccept = value;
    } else if (arg === "--out-needs-human") {
      options.outNeedsHuman = value;
    } else if (arg === "--out-missing-data") {
      options.outMissingData = value;
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

function normalizeJapaneseText(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[。．.]+$/g, "")
    .trim();
}

function formatPrimaryMeaning(primaryMeaning) {
  if (!primaryMeaning) {
    return "";
  }

  return `${primaryMeaning.pos}: ${primaryMeaning.definitions.join("・")} [${primaryMeaning.confidence}]`;
}

function hasEmptyJapanese(entry) {
  return entry.primaryMeanings.some((meaning) => meaning.definitions.some((definition) => !normalizeJapaneseText(definition)));
}

function hasLongJapanese(entry) {
  return entry.primaryMeanings.some((meaning) =>
    meaning.definitions.some((definition) => [...normalizeJapaneseText(definition)].length >= 18),
  );
}

function hasDuplicatePrimaryMeanings(entry) {
  const exactKeys = new Set();
  const firstDefinitionKeys = new Set();

  for (const meaning of entry.primaryMeanings) {
    const key = `${meaning.pos}:${meaning.definitions.map(normalizeJapaneseText).sort().join("|")}`;
    const firstDefinitionKey = `${meaning.pos}:${normalizeJapaneseText(meaning.definitions[0] ?? "")}`;

    if (exactKeys.has(key) || (meaning.definitions.length > 1 && firstDefinitionKeys.has(firstDefinitionKey))) {
      return true;
    }

    exactKeys.add(key);
    firstDefinitionKeys.add(firstDefinitionKey);
  }

  return false;
}

function hasLowPrimaryConfidence(entry) {
  return entry.primaryMeanings.some((meaning) => meaning.confidence === "low");
}

function hasInvalidPrimaryConfidence(entry) {
  return entry.primaryMeanings.some((meaning) => !CONFIDENCES.includes(meaning.confidence));
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

function hasHighPrimaryConfidence(entry) {
  return entry.primaryMeanings.some((meaning) => meaning.confidence === "high");
}

function isOnlyVolumeOrAmbiguityReview(entry) {
  return entry.reviewReasons.every((reason) => reason === "AMBIGUOUS_PRIMARY_SENSE" || reason === "TOO_MANY_SENSES");
}

function classifyEntry(entry) {
  const reasons = new Set(entry.reviewReasons ?? []);
  const primaryCount = entry.primaryMeanings.length;

  if (
    primaryCount === 0 ||
    reasons.has("MISSING_JAPANESE") ||
    (!entry.coverage?.japaneseWordNet && !entry.coverage?.wiktionary)
  ) {
    return {
      decision: "MISSING_DATA",
      decisionReason:
        primaryCount === 0
          ? "No primary meanings were generated from the available dictionaries."
          : "Japanese meaning coverage is missing from both usable dictionary sources.",
    };
  }

  const severeReasons = [
    "UNNATURAL_JAPANESE",
    "LOW_CONFIDENCE",
    "DICTIONARY_DISAGREEMENT",
    "DUPLICATE_MEANINGS",
    "POS_MISMATCH",
    "OTHER",
  ].filter((reason) => reasons.has(reason));

  if (entry.wordConfidence === "low") {
    return {
      decision: "NEEDS_REVIEW",
      decisionReason: "Word-level confidence is LOW.",
    };
  }

  if (hasLowPrimaryConfidence(entry)) {
    return {
      decision: "NEEDS_REVIEW",
      decisionReason: "At least one primary meaning has LOW confidence.",
    };
  }

  if (severeReasons.length > 0) {
    return {
      decision: "NEEDS_REVIEW",
      decisionReason: `Contains non-auto-acceptable review reason(s): ${severeReasons.join("|")}.`,
    };
  }

  if (hasInvalidPrimaryConfidence(entry)) {
    return {
      decision: "NEEDS_REVIEW",
      decisionReason: "At least one primary meaning has an invalid confidence value.",
    };
  }

  if (hasEmptyJapanese(entry) || hasLongJapanese(entry)) {
    return {
      decision: "NEEDS_REVIEW",
      decisionReason: "Primary Japanese display text is empty or too long for safe automatic acceptance.",
    };
  }

  if (hasDuplicatePrimaryMeanings(entry)) {
    return {
      decision: "NEEDS_REVIEW",
      decisionReason: "Primary meanings contain likely duplicate display rows.",
    };
  }

  if (!hasAnyDictionaryGrounding(entry) || !hasClearPrimaryGrounding(entry)) {
    return {
      decision: "MISSING_DATA",
      decisionReason: "Dictionary grounding is insufficient for safe display.",
    };
  }

  if (!isOnlyVolumeOrAmbiguityReview(entry)) {
    return {
      decision: "NEEDS_REVIEW",
      decisionReason: "Review reason is outside safe volume/ambiguity-only auto-accept rules.",
    };
  }

  if (reasons.has("AMBIGUOUS_PRIMARY_SENSE") && !hasHighPrimaryConfidence(entry)) {
    return {
      decision: "NEEDS_REVIEW",
      decisionReason:
        "AMBIGUOUS_PRIMARY_SENSE remains and no selected primary meaning has HIGH confidence.",
    };
  }

  return {
    decision: "AUTO_ACCEPT",
    decisionReason:
      "Review was caused only by sense volume/ambiguity; primary meanings are non-empty, medium-or-better confidence, naturally sized, non-duplicate, and dictionary-grounded.",
  };
}

function rowFor(entry, triage) {
  return {
    word: entry.word,
    level: entry.level,
    primaryMeaning1: formatPrimaryMeaning(entry.primaryMeanings[0]),
    primaryMeaning2: formatPrimaryMeaning(entry.primaryMeanings[1]),
    primaryMeaning3: formatPrimaryMeaning(entry.primaryMeanings[2]),
    wordConfidence: entry.wordConfidence,
    reviewReasons: entry.reviewReasons.join("|"),
    wordnetCoverage: Boolean(entry.coverage?.japaneseWordNet),
    wiktionaryCoverage: Boolean(entry.coverage?.wiktionary),
    decision: triage.decision,
    decisionReason: triage.decisionReason,
  };
}

function emptyDecisionConfidenceCounts() {
  return Object.fromEntries(
    DECISIONS.map((decision) => [
      decision,
      {
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0,
      },
    ]),
  );
}

function confidenceKey(confidence) {
  return String(confidence ?? "").toUpperCase();
}

function summarize(reviewEntries, rowsByDecision) {
  const byConfidence = emptyDecisionConfidenceCounts();
  const reviewReasonBreakdown = Object.fromEntries(REVIEW_CATEGORIES.map((category) => [category, 0]));
  const levelStats = Object.fromEntries(
    [1, 2, 3].map((level) => [
      level,
      {
        AUTO_ACCEPT: 0,
        NEEDS_REVIEW: 0,
        MISSING_DATA: 0,
      },
    ]),
  );

  for (const entry of reviewEntries) {
    for (const reason of entry.reviewReasons) {
      reviewReasonBreakdown[reason] = (reviewReasonBreakdown[reason] ?? 0) + 1;
    }
  }

  for (const [decision, rows] of Object.entries(rowsByDecision)) {
    for (const row of rows) {
      const key = confidenceKey(row.wordConfidence);

      if (byConfidence[decision][key] == null) {
        byConfidence[decision][key] = 0;
      }

      byConfidence[decision][key] += 1;

      if (levelStats[row.level]) {
        levelStats[row.level][decision] += 1;
      }
    }
  }

  return {
    originalReviewWords: reviewEntries.length,
    decisionCounts: Object.fromEntries(DECISIONS.map((decision) => [decision, rowsByDecision[decision].length])),
    byConfidence,
    reviewReasonBreakdown,
    levelStats,
  };
}

function printSummary(summary) {
  console.log("Review triage");
  console.log("-------------");
  console.log("");
  console.log(`Original review words: ${summary.originalReviewWords}`);
  console.log("");
  console.log(`AUTO_ACCEPT: ${summary.decisionCounts.AUTO_ACCEPT}`);
  console.log(`NEEDS_REVIEW: ${summary.decisionCounts.NEEDS_REVIEW}`);
  console.log(`MISSING_DATA: ${summary.decisionCounts.MISSING_DATA}`);
  console.log("");
  console.log("By confidence:");
  console.log("");

  for (const decision of DECISIONS) {
    console.log(decision);
    console.log(`HIGH: ${summary.byConfidence[decision].HIGH}`);
    console.log(`MEDIUM: ${summary.byConfidence[decision].MEDIUM}`);
    console.log(`LOW: ${summary.byConfidence[decision].LOW}`);
    console.log("");
  }

  console.log("Review reason breakdown:");
  for (const category of REVIEW_CATEGORIES) {
    console.log(`${category}: ${summary.reviewReasonBreakdown[category] ?? 0}`);
  }
  console.log("");

  for (const level of [1, 2, 3]) {
    console.log(`Level ${level}:`);
    console.log(`AUTO_ACCEPT: ${summary.levelStats[level].AUTO_ACCEPT}`);
    console.log(`NEEDS_REVIEW: ${summary.levelStats[level].NEEDS_REVIEW}`);
    console.log(`MISSING_DATA: ${summary.levelStats[level].MISSING_DATA}`);
    console.log("");
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const dictionary = readJson(options.dictionary);
  const reviewEntries = (dictionary.words ?? []).filter((entry) => entry.reviewRequired);
  const rowsByDecision = {
    AUTO_ACCEPT: [],
    NEEDS_REVIEW: [],
    MISSING_DATA: [],
  };

  for (const entry of reviewEntries) {
    const triage = classifyEntry(entry);
    rowsByDecision[triage.decision].push(rowFor(entry, triage));
  }

  const totalRows = Object.values(rowsByDecision).reduce((total, rows) => total + rows.length, 0);

  if (totalRows !== reviewEntries.length) {
    throw new Error(`Triage row count mismatch: ${totalRows} rows for ${reviewEntries.length} review entries.`);
  }

  const headers = [
    "word",
    "level",
    "primaryMeaning1",
    "primaryMeaning2",
    "primaryMeaning3",
    "wordConfidence",
    "reviewReasons",
    "wordnetCoverage",
    "wiktionaryCoverage",
    "decision",
    "decisionReason",
  ];

  writeCsv(options.outAutoAccept, rowsByDecision.AUTO_ACCEPT, headers);
  writeCsv(options.outNeedsHuman, rowsByDecision.NEEDS_REVIEW, headers);
  writeCsv(options.outMissingData, rowsByDecision.MISSING_DATA, headers);

  printSummary(summarize(reviewEntries, rowsByDecision));
  console.log("Files generated:");
  console.log(`- ${options.outAutoAccept}`);
  console.log(`- ${options.outNeedsHuman}`);
  console.log(`- ${options.outMissingData}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
