import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_OPTIONS = {
  dictionary: "src/data/generated/wordDictionaryReviewStatus.json",
  wordnetDb: "data/wordnet/wnjpn.db",
  outAccepted: "src/data/generated/acceptedDictionary.json",
  outExistingReview: "reports/final-human-review-existing.csv",
  outGeneratedReview: "reports/final-human-review-generated.csv",
  outAllReview: "reports/final-human-review-all.csv",
};

const AI_MISSING_CANDIDATES = {
  boardroom: {
    confidence: "medium",
    candidates: [{ pos: "noun", definitions: ["役員会議室"] }],
  },
  culinary: {
    confidence: "medium",
    candidates: [{ pos: "adjective", definitions: ["料理の"] }],
  },
  indoor: {
    confidence: "medium",
    candidates: [{ pos: "adjective", definitions: ["屋内の"] }],
  },
  outdoor: {
    confidence: "medium",
    candidates: [{ pos: "adjective", definitions: ["屋外の"] }],
  },
  realtor: {
    confidence: "medium",
    candidates: [{ pos: "noun", definitions: ["不動産業者"] }],
  },
  salesperson: {
    confidence: "medium",
    candidates: [{ pos: "noun", definitions: ["販売員"] }],
  },
  shopper: {
    confidence: "medium",
    candidates: [{ pos: "noun", definitions: ["買い物客"] }],
  },
  taker: {
    confidence: "medium",
    candidates: [
      { pos: "noun", definitions: ["賭けを受ける人"] },
      { pos: "noun", definitions: ["引き受ける人"] },
    ],
  },
  carton: {
    confidence: "medium",
    candidates: [
      { pos: "noun", definitions: ["紙箱"] },
      { pos: "noun", definitions: ["カートン分"] },
    ],
  },
  cordless: {
    confidence: "medium",
    candidates: [{ pos: "adjective", definitions: ["コードレスの"] }],
  },
  downsize: {
    confidence: "medium",
    candidates: [
      { pos: "verb", definitions: ["縮小する"] },
      { pos: "verb", definitions: ["人員削減する"] },
    ],
  },
  fundraise: {
    confidence: "medium",
    candidates: [{ pos: "verb", definitions: ["資金を集める"] }],
  },
  healthcare: {
    confidence: "medium",
    candidates: [{ pos: "noun", definitions: ["医療"] }],
  },
  homemade: {
    confidence: "medium",
    candidates: [{ pos: "adjective", definitions: ["自家製の"] }],
  },
  housekeep: {
    confidence: "medium",
    candidates: [{ pos: "verb", definitions: ["家事をする"] }],
  },
  lateral: {
    confidence: "medium",
    candidates: [
      { pos: "adjective", definitions: ["側面の"] },
      { pos: "adjective", definitions: ["側方の"] },
    ],
  },
  lifeguard: {
    confidence: "medium",
    candidates: [{ pos: "noun", definitions: ["ライフガード"] }],
  },
  longitudinal: {
    confidence: "medium",
    candidates: [
      { pos: "adjective", definitions: ["長期的な"] },
      { pos: "adjective", definitions: ["縦方向の"] },
      { pos: "adjective", definitions: ["経度の"] },
    ],
  },
  non: {
    confidence: "low",
    candidates: [{ pos: "adverb", definitions: ["非"] }],
  },
  nonlinear: {
    confidence: "medium",
    candidates: [{ pos: "adjective", definitions: ["非線形の"] }],
  },
  overcrowd: {
    confidence: "medium",
    candidates: [
      { pos: "verb", definitions: ["混み合う"] },
      { pos: "verb", definitions: ["混雑させる"] },
    ],
  },
  prestigious: {
    confidence: "medium",
    candidates: [
      { pos: "adjective", definitions: ["名声のある"] },
      { pos: "adjective", definitions: ["一流の"] },
    ],
  },
  psychiatric: {
    confidence: "medium",
    candidates: [{ pos: "adjective", definitions: ["精神医学の"] }],
  },
  redecorate: {
    confidence: "medium",
    candidates: [
      { pos: "verb", definitions: ["模様替えする"] },
      { pos: "verb", definitions: ["改装する"] },
    ],
  },
  redesign: {
    confidence: "medium",
    candidates: [{ pos: "verb", definitions: ["再設計する"] }],
  },
  revolutionize: {
    confidence: "medium",
    candidates: [{ pos: "verb", definitions: ["革命的に変える"] }],
  },
  steak: {
    confidence: "medium",
    candidates: [{ pos: "noun", definitions: ["ステーキ"] }],
  },
  syntactic: {
    confidence: "medium",
    candidates: [{ pos: "adjective", definitions: ["構文の"] }],
  },
  variability: {
    confidence: "medium",
    candidates: [
      { pos: "noun", definitions: ["変動性"] },
      { pos: "noun", definitions: ["可変性"] },
    ],
  },
  communicative: {
    confidence: "medium",
    candidates: [
      { pos: "adjective", definitions: ["伝達の"] },
      { pos: "adjective", definitions: ["コミュニケーションの"] },
    ],
  },
  neo: {
    confidence: "low",
    candidates: [{ pos: "adjective", definitions: ["新しい"] }],
  },
  practitioner: {
    confidence: "medium",
    candidates: [
      { pos: "noun", definitions: ["実務者"] },
      { pos: "noun", definitions: ["開業医"] },
    ],
  },
  sensory: {
    confidence: "medium",
    candidates: [
      { pos: "adjective", definitions: ["感覚の"] },
      { pos: "adjective", definitions: ["知覚の"] },
    ],
  },
};

function printHelp() {
  console.log(`Usage:
  node scripts/prepare-final-review.mjs [options]

Options:
  --dictionary <path>          Review-status dictionary JSON.
                               Default: ${DEFAULT_OPTIONS.dictionary}
  --wordnet-db <path>          Japanese WordNet SQLite database path.
                               Default: ${DEFAULT_OPTIONS.wordnetDb}
  --out-accepted <path>        Accepted frozen dictionary path.
                               Default: ${DEFAULT_OPTIONS.outAccepted}
  --out-existing-review <path> Final review CSV for NEEDS_HUMAN words.
                               Default: ${DEFAULT_OPTIONS.outExistingReview}
  --out-generated-review <path>
                               Final review CSV for MISSING_DATA generated candidates.
                               Default: ${DEFAULT_OPTIONS.outGeneratedReview}
  --out-all-review <path>      Combined final review CSV path.
                               Default: ${DEFAULT_OPTIONS.outAllReview}
  --help                       Show this help.
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
      "--dictionary": "dictionary",
      "--wordnet-db": "wordnetDb",
      "--out-accepted": "outAccepted",
      "--out-existing-review": "outExistingReview",
      "--out-generated-review": "outGeneratedReview",
      "--out-all-review": "outAllReview",
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

function uniqueBy(values, getKey) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const key = getKey(value);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}

function formatMeaning(meaning) {
  return meaning ? `${meaning.pos}: ${meaning.definitions.join("・")}` : "";
}

function formatGeneratedMeaning(candidate) {
  return candidate ? `${candidate.pos}: ${candidate.definitions.join("・")}` : "";
}

function flatten(values) {
  return values.flat().filter((value) => String(value ?? "").trim().length > 0);
}

function wordnetPos(entry) {
  return [...new Set(entry.japaneseWordNet.senses.map((sense) => sense.pos))].join("|");
}

function wordnetJapaneseLemmas(entry) {
  return [...new Set(flatten(entry.japaneseWordNet.senses.map((sense) => sense.japaneseLemmas)))].join("|");
}

function wordnetGlosses(entry) {
  return [...new Set(flatten(entry.japaneseWordNet.senses.map((sense) => sense.japaneseGlosses ?? [sense.japaneseGloss])))].join("|");
}

function wordnetRanks(entry) {
  return entry.japaneseWordNet.senses.map((sense) => `${sense.synset}:${sense.rank ?? ""}`).join("|");
}

function wordnetTagCounts(entry) {
  return entry.japaneseWordNet.senses.map((sense) => `${sense.synset}:${sense.freq ?? ""}`).join("|");
}

function wiktionaryPos(entry) {
  return [...new Set(entry.wiktionary.senses.map((sense) => sense.pos))].join("|");
}

function wiktionaryMeanings(entry) {
  return [...new Set(flatten(entry.wiktionary.senses.map((sense) => sense.glosses)))].join("|");
}

function wiktionarySenseOrders(entry) {
  return entry.wiktionary.senses.map((sense) => `${sense.pos}:${sense.senseOrder}`).join("|");
}

function recommendedAction(entry) {
  if (
    entry.reviewReasons.includes("UNNATURAL_JAPANESE") ||
    /\d|[A-Z]/.test(entry.primaryMeanings.flatMap((meaning) => meaning.definitions).join(""))
  ) {
    return "EXCLUDE_WORD";
  }

  if (entry.meanings.length > 0 || entry.wiktionary.senses.length > 0 || entry.japaneseWordNet.senses.length > 0) {
    return "CHOOSE_FROM_CANDIDATES";
  }

  return "KEEP_CURRENT";
}

function existingReviewRow(entry) {
  return {
    word: entry.word,
    level: entry.level,
    currentPrimaryMeaning1: formatMeaning(entry.primaryMeanings[0]),
    currentPrimaryMeaning2: formatMeaning(entry.primaryMeanings[1]),
    currentPrimaryMeaning3: formatMeaning(entry.primaryMeanings[2]),
    wordConfidence: entry.wordConfidence,
    reviewReasons: entry.reviewReasons.join("|"),
    wordnetPOS: wordnetPos(entry),
    wordnetJapaneseLemmas: wordnetJapaneseLemmas(entry),
    wordnetGlosses: wordnetGlosses(entry),
    wordnetSenseRank: wordnetRanks(entry),
    wordnetTagCount: wordnetTagCounts(entry),
    wiktionaryPOS: wiktionaryPos(entry),
    wiktionaryJapaneseMeanings: wiktionaryMeanings(entry),
    wiktionarySenseOrder: wiktionarySenseOrders(entry),
    recommendedAction: recommendedAction(entry),
  };
}

function loadEnglishWordNetGlosses(dbPath, words) {
  const database = new DatabaseSync(path.resolve(process.cwd(), dbPath), { readOnly: true });
  const normalizedWords = words.map((word) => word.toLowerCase());
  const placeholders = normalizedWords.map(() => "?").join(", ");
  const byWord = new Map(words.map((word) => [word, []]));

  if (normalizedWords.length === 0) {
    database.close();
    return byWord;
  }

  const statement = database.prepare(`
    SELECT
      lower(w.lemma) AS word,
      se.synset AS synset,
      sy.pos AS rawPos,
      se.rank AS rank,
      se.freq AS freq,
      sd.def AS definition
    FROM word w
    INNER JOIN sense se
      ON se.wordid = w.wordid AND se.lang = 'eng'
    LEFT JOIN synset sy
      ON sy.synset = se.synset
    LEFT JOIN synset_def sd
      ON sd.synset = se.synset AND sd.lang = 'eng'
    WHERE w.lang = 'eng' AND lower(w.lemma) IN (${placeholders})
    ORDER BY CAST(NULLIF(se.rank, '') AS INTEGER), se.synset, sd.def
  `);

  try {
    const rowsByWord = new Map();

    for (const row of statement.all(...normalizedWords)) {
      const normalizedWord = row.word;

      if (!rowsByWord.has(normalizedWord)) {
        rowsByWord.set(normalizedWord, []);
      }

      rowsByWord.get(normalizedWord).push({
          word: row.word,
          synset: row.synset,
          pos: { n: "noun", v: "verb", a: "adjective", s: "adjective", r: "adverb" }[row.rawPos] ?? row.rawPos,
          definition: row.definition ?? "",
          rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : null,
          tagCount: Number.isFinite(Number(row.freq)) ? Number(row.freq) : null,
      });
    }

    for (const word of words) {
      const rows = uniqueBy(
        rowsByWord.get(word.toLowerCase()) ?? [],
        (row) => `${row.synset}:${row.definition}`,
      );

      byWord.set(word, rows);
    }
  } finally {
    database.close();
  }

  return byWord;
}

function generatedReviewRow(entry, englishDefinitions) {
  const config = AI_MISSING_CANDIDATES[entry.word];
  const hasEnglishDefinitions = englishDefinitions.length > 0;
  const canGenerate = Boolean(config && hasEnglishDefinitions);
  const candidates = canGenerate ? config.candidates.slice(0, 3) : [];
  const source = canGenerate ? "ai-generated-from-english-wordnet-gloss" : "insufficient-source-data";
  const notes = canGenerate
    ? "AI-generated Japanese candidates from English WordNet gloss only; human review is required before use."
    : "No sufficient English WordNet definition was available in the local data, or no safe AI candidate was prepared.";

  return {
    word: entry.word,
    level: entry.level,
    englishPOS: [...new Set(englishDefinitions.map((definition) => definition.pos))].join("|"),
    englishDefinition1: englishDefinitions[0]?.definition ?? "",
    englishDefinition2: englishDefinitions[1]?.definition ?? "",
    englishDefinition3: englishDefinitions[2]?.definition ?? "",
    generatedJapanese1: formatGeneratedMeaning(candidates[0]),
    generatedJapanese2: formatGeneratedMeaning(candidates[1]),
    generatedJapanese3: formatGeneratedMeaning(candidates[2]),
    generationConfidence: canGenerate ? config.confidence : "",
    source,
    notes,
    decision: "",
    _candidates: candidates,
  };
}

function allReviewRows(existingRows, generatedRows) {
  return [
    ...existingRows.map((row) => ({
      word: row.word,
      level: row.level,
      reviewType: "existing-dictionary",
      currentOrGeneratedMeaning1: row.currentPrimaryMeaning1,
      currentOrGeneratedMeaning2: row.currentPrimaryMeaning2,
      currentOrGeneratedMeaning3: row.currentPrimaryMeaning3,
      confidence: row.wordConfidence,
      reviewReasons: row.reviewReasons,
      source: "japanese-wordnet|ja-wiktionary",
      decision: "",
      editedMeaning1: "",
      editedMeaning2: "",
      editedMeaning3: "",
    })),
    ...generatedRows.map((row) => ({
      word: row.word,
      level: row.level,
      reviewType: row.source === "insufficient-source-data" ? "missing-data-insufficient" : "missing-data-generated",
      currentOrGeneratedMeaning1: row.generatedJapanese1,
      currentOrGeneratedMeaning2: row.generatedJapanese2,
      currentOrGeneratedMeaning3: row.generatedJapanese3,
      confidence: row.generationConfidence,
      reviewReasons: "MISSING_JAPANESE",
      source: row.source,
      decision: "",
      editedMeaning1: "",
      editedMeaning2: "",
      editedMeaning3: "",
    })),
  ];
}

function validate(allWords, acceptedWords, reviewRows) {
  const allSet = new Set(allWords.map((entry) => entry.word));
  const outputWords = [...acceptedWords.map((entry) => entry.word), ...reviewRows.map((row) => row.word)];
  const outputSet = new Set(outputWords);

  return {
    acceptedPlusReview: acceptedWords.length + reviewRows.length,
    duplicates: outputWords.length - outputSet.size,
    missingWords: [...allSet].filter((word) => !outputSet.has(word)).length,
  };
}

function printSummary(summary) {
  console.log("Final review preparation");
  console.log("------------------------");
  console.log("");
  console.log(`Total words: ${summary.totalWords}`);
  console.log("");
  console.log(`Accepted and frozen: ${summary.accepted}`);
  console.log("");
  console.log(`Human review from existing dictionary data: ${summary.existingReview}`);
  console.log("");
  console.log(`Missing-data words: ${summary.missingData}`);
  console.log(`- AI candidates generated: ${summary.aiGenerated}`);
  console.log(`- Insufficient English source data: ${summary.insufficientSourceData}`);
  console.log("");
  console.log(`Final human-review workload: ${summary.finalHumanReviewWorkload}`);
  console.log("");
  console.log("Validation:");
  console.log(`Accepted + review = ${summary.validation.acceptedPlusReview}`);
  console.log(`Duplicates = ${summary.validation.duplicates}`);
  console.log(`Missing words = ${summary.validation.missingWords}`);
  console.log("");
  console.log("Files generated:");
  for (const file of summary.files) {
    console.log(`- ${file}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const dictionary = readJson(options.dictionary);
  const words = dictionary.words ?? [];
  const acceptedWords = words.filter((entry) => entry.reviewStatus === "accepted");
  const existingReviewWords = words.filter((entry) => entry.reviewStatus === "needs_human_review");
  const missingWords = words.filter((entry) => entry.reviewStatus === "missing_data");
  const englishDefinitionsByWord = loadEnglishWordNetGlosses(
    options.wordnetDb,
    missingWords.map((entry) => entry.word),
  );
  const existingRows = existingReviewWords.map(existingReviewRow);
  const generatedRows = missingWords.map((entry) =>
    generatedReviewRow(entry, englishDefinitionsByWord.get(entry.word) ?? []),
  );
  const allRows = allReviewRows(existingRows, generatedRows);
  const validation = validate(words, acceptedWords, allRows);
  const summary = {
    totalWords: words.length,
    accepted: acceptedWords.length,
    existingReview: existingReviewWords.length,
    missingData: missingWords.length,
    aiGenerated: generatedRows.filter((row) => row.source !== "insufficient-source-data").length,
    insufficientSourceData: generatedRows.filter((row) => row.source === "insufficient-source-data").length,
    finalHumanReviewWorkload: allRows.length,
    validation,
    files: [options.outAccepted, options.outExistingReview, options.outGeneratedReview, options.outAllReview],
  };

  if (validation.acceptedPlusReview !== words.length || validation.duplicates !== 0 || validation.missingWords !== 0) {
    throw new Error(`Final review validation failed: ${JSON.stringify(validation)}`);
  }

  writeFile(
    options.outAccepted,
    `${JSON.stringify(
      {
        metadata: {
          sourceDictionary: options.dictionary,
          note:
            "Accepted frozen dictionary candidates. Raw Japanese WordNet data, Wiktionary data, confidence, review history, and source metadata are preserved. Do not rewrite primaryMeanings in later automated steps without explicit review.",
        },
        summary: {
          accepted: acceptedWords.length,
        },
        words: acceptedWords.map((entry) => ({
          ...entry,
          reviewStatus: "accepted",
        })),
      },
      null,
      2,
    )}\n`,
  );
  writeCsv(options.outExistingReview, existingRows, [
    "word",
    "level",
    "currentPrimaryMeaning1",
    "currentPrimaryMeaning2",
    "currentPrimaryMeaning3",
    "wordConfidence",
    "reviewReasons",
    "wordnetPOS",
    "wordnetJapaneseLemmas",
    "wordnetGlosses",
    "wordnetSenseRank",
    "wordnetTagCount",
    "wiktionaryPOS",
    "wiktionaryJapaneseMeanings",
    "wiktionarySenseOrder",
    "recommendedAction",
  ]);
  writeCsv(
    options.outGeneratedReview,
    generatedRows.map(({ _candidates, ...row }) => row),
    [
      "word",
      "level",
      "englishPOS",
      "englishDefinition1",
      "englishDefinition2",
      "englishDefinition3",
      "generatedJapanese1",
      "generatedJapanese2",
      "generatedJapanese3",
      "generationConfidence",
      "source",
      "notes",
      "decision",
    ],
  );
  writeCsv(options.outAllReview, allRows, [
    "word",
    "level",
    "reviewType",
    "currentOrGeneratedMeaning1",
    "currentOrGeneratedMeaning2",
    "currentOrGeneratedMeaning3",
    "confidence",
    "reviewReasons",
    "source",
    "decision",
    "editedMeaning1",
    "editedMeaning2",
    "editedMeaning3",
  ]);

  printSummary(summary);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
