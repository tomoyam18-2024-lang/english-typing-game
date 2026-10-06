import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ensureDatabase, inspectSchema } from "./generate-wordnet-sample.mjs";

const DEFAULT_OPTIONS = {
  dictionary: "src/data/generated/wordDictionaryV2.json",
  db: "data/wordnet/wnjpn.db",
  outCsv: "reports/word-master-v2-human-review.csv",
};

const HEADERS = [
  "word",
  "level",
  "reviewStatus",
  "reviewReasons",
  "currentPrimaryMeaning1",
  "currentPrimaryMeaning2",
  "currentPrimaryMeaning3",
  "wordConfidence",
  "wordnetPOS",
  "wordnetJapaneseLemmas",
  "wordnetEnglishGloss",
  "wiktionaryPOS",
  "wiktionaryJapaneseMeanings",
  "wiktionaryEnglishDefinitions",
  "masterSources",
  "masterRanks",
  "recommendedAction",
  "decision",
  "editedMeaning1",
  "editedMeaning2",
  "editedMeaning3",
  "replacementWord",
];

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
    } else if (arg === "--db") {
      options.db = value;
    } else if (arg === "--out-csv") {
      options.outCsv = value;
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

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function placeholderList(values) {
  return values.map(() => "?").join(", ");
}

function unique(values) {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const text = String(value ?? "").trim();

    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    output.push(text);
  }

  return output;
}

function formatPrimaryMeaning(meaning) {
  if (!meaning) {
    return "";
  }

  return `${meaning.pos}: ${(meaning.definitions ?? []).join("・")} [${meaning.confidence ?? ""}]`;
}

function flattenWordnetSenses(entry) {
  return entry.japaneseWordNet?.senses ?? [];
}

function flattenWiktionarySenses(entry) {
  return entry.wiktionary?.senses ?? [];
}

function collectSynsets(entries) {
  return unique(entries.flatMap((entry) => flattenWordnetSenses(entry).map((sense) => sense.synset)));
}

function loadEnglishGlosses(database, schema, synsets) {
  if (synsets.length === 0) {
    return new Map();
  }

  const gloss = schema.mapping.gloss;
  const sd = "sd";
  const glossSid = gloss.optionalColumns.sid;
  const orderExpression = glossSid
    ? `CAST(${sd}.${quoteIdentifier(glossSid)} AS INTEGER)`
    : `${sd}.${quoteIdentifier(gloss.columns.def)}`;
  const rows = database
    .prepare(
      `
        SELECT DISTINCT
          ${sd}.${quoteIdentifier(gloss.columns.synset)} AS synset,
          ${sd}.${quoteIdentifier(gloss.columns.def)} AS gloss
        FROM ${quoteIdentifier(gloss.name)} ${sd}
        WHERE ${sd}.${quoteIdentifier(gloss.columns.synset)} IN (${placeholderList(synsets)})
          AND ${sd}.${quoteIdentifier(gloss.columns.lang)} = 'eng'
        ORDER BY ${sd}.${quoteIdentifier(gloss.columns.synset)}, ${orderExpression}
      `,
    )
    .all(...synsets);
  const glossesBySynset = new Map();

  for (const row of rows) {
    if (!glossesBySynset.has(row.synset)) {
      glossesBySynset.set(row.synset, []);
    }

    glossesBySynset.get(row.synset).push(row.gloss);
  }

  return glossesBySynset;
}

async function loadWordnetEnglishGlosses(entries, dbPath) {
  const synsets = collectSynsets(entries);

  if (synsets.length === 0 || !existsSync(path.resolve(process.cwd(), dbPath))) {
    return new Map();
  }

  const resolvedDbPath = await ensureDatabase(dbPath);
  const database = new DatabaseSync(resolvedDbPath, { readOnly: true });

  try {
    const schema = inspectSchema(database);
    return loadEnglishGlosses(database, schema, synsets);
  } finally {
    database.close();
  }
}

function wordnetPos(entry) {
  return unique(flattenWordnetSenses(entry).map((sense) => sense.pos)).join("|");
}

function wordnetJapaneseLemmas(entry) {
  return unique(flattenWordnetSenses(entry).flatMap((sense) => sense.japaneseLemmas ?? [])).join("|");
}

function wordnetEnglishGloss(entry, englishGlossesBySynset) {
  const lines = [];

  for (const sense of flattenWordnetSenses(entry)) {
    const glosses = englishGlossesBySynset.get(sense.synset) ?? [];

    for (const gloss of glosses) {
      lines.push(`${sense.pos}:${sense.synset}: ${gloss}`);
    }
  }

  return unique(lines).join(" || ");
}

function wiktionaryPos(entry) {
  return unique(flattenWiktionarySenses(entry).map((sense) => sense.pos)).join("|");
}

function wiktionaryJapaneseMeanings(entry) {
  return unique(
    flattenWiktionarySenses(entry).flatMap((sense) => [...(sense.displayDefinitions ?? []), ...(sense.glosses ?? [])]),
  ).join("|");
}

function wiktionaryEnglishDefinitions(entry) {
  return unique(
    flattenWiktionarySenses(entry).flatMap((sense) => [
      ...(sense.englishDefinitions ?? []),
      ...(sense.definitions ?? []).filter((definition) => /^[\x00-\x7F]+$/.test(String(definition ?? ""))),
    ]),
  ).join("|");
}

function masterSources(entry) {
  return unique((entry.sources ?? []).map((source) => source.name)).join("|");
}

function masterRanks(entry) {
  return unique((entry.sources ?? []).map((source) => `${source.name}:${source.rank}`)).join("|");
}

function recommendedAction(entry, englishGlossText) {
  if (entry.reviewStatus === "needs_human_review") {
    if ((entry.primaryMeanings ?? []).length > 0 && !String(entry.reviewReasons ?? "").includes("MISSING_JAPANESE")) {
      return "EDIT_MEANING";
    }

    return "HUMAN_DECISION_REQUIRED";
  }

  if (entry.reviewStatus === "missing_data") {
    if ((entry.primaryMeanings ?? []).length > 0) {
      return "EDIT_MEANING";
    }

    if (englishGlossText || wiktionaryJapaneseMeanings(entry)) {
      return "ADD_MEANING";
    }

    if (!(entry.coverage?.japaneseWordNet || entry.coverage?.wiktionary)) {
      return "REPLACE_WORD";
    }

    return "HUMAN_DECISION_REQUIRED";
  }

  return "ACCEPT_CURRENT";
}

function compareReviewEntries(a, b) {
  const groupOrder = {
    needs_human_review: 0,
    missing_data: 1,
  };

  return (
    (groupOrder[a.reviewStatus] ?? 99) - (groupOrder[b.reviewStatus] ?? 99) ||
    a.level - b.level ||
    a.word.localeCompare(b.word)
  );
}

function buildRows(entries, englishGlossesBySynset) {
  return entries.sort(compareReviewEntries).map((entry) => {
    const englishGlossText = wordnetEnglishGloss(entry, englishGlossesBySynset);

    return {
      word: entry.word,
      level: entry.level,
      reviewStatus: entry.reviewStatus,
      reviewReasons: (entry.reviewReasons ?? []).join("|"),
      currentPrimaryMeaning1: formatPrimaryMeaning(entry.primaryMeanings?.[0]),
      currentPrimaryMeaning2: formatPrimaryMeaning(entry.primaryMeanings?.[1]),
      currentPrimaryMeaning3: formatPrimaryMeaning(entry.primaryMeanings?.[2]),
      wordConfidence: entry.wordConfidence,
      wordnetPOS: wordnetPos(entry),
      wordnetJapaneseLemmas: wordnetJapaneseLemmas(entry),
      wordnetEnglishGloss: englishGlossText,
      wiktionaryPOS: wiktionaryPos(entry),
      wiktionaryJapaneseMeanings: wiktionaryJapaneseMeanings(entry),
      wiktionaryEnglishDefinitions: wiktionaryEnglishDefinitions(entry),
      masterSources: masterSources(entry),
      masterRanks: masterRanks(entry),
      recommendedAction: recommendedAction(entry, englishGlossText),
      decision: "",
      editedMeaning1: "",
      editedMeaning2: "",
      editedMeaning3: "",
      replacementWord: "",
    };
  });
}

function validateRows(rows) {
  const words = rows.map((row) => row.word);
  const duplicateWords = words.length - new Set(words).size;
  const needsReview = rows.filter((row) => row.reviewStatus === "needs_human_review").length;
  const missingData = rows.filter((row) => row.reviewStatus === "missing_data").length;
  const errors = [];

  if (rows.length !== 74) {
    errors.push(`Total review rows should be 74, got ${rows.length}.`);
  }

  if (needsReview !== 12) {
    errors.push(`Needs review rows should be 12, got ${needsReview}.`);
  }

  if (missingData !== 62) {
    errors.push(`Missing data rows should be 62, got ${missingData}.`);
  }

  if (duplicateWords !== 0) {
    errors.push(`Duplicate words should be 0, got ${duplicateWords}.`);
  }

  return {
    ok: errors.length === 0,
    total: rows.length,
    needsReview,
    missingData,
    duplicateWords,
    errors,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(`Usage: node scripts/create-word-master-v2-human-review.mjs [--dictionary path] [--db path] [--out-csv path]`);
    return;
  }

  const dictionaryJson = readJson(options.dictionary);
  const words = Array.isArray(dictionaryJson) ? dictionaryJson : dictionaryJson.words;
  const reviewEntries = words.filter((entry) => entry.reviewStatus === "needs_human_review" || entry.reviewStatus === "missing_data");
  const englishGlossesBySynset = await loadWordnetEnglishGlosses(reviewEntries, options.db);
  const rows = buildRows(reviewEntries, englishGlossesBySynset);
  const validation = validateRows(rows);

  writeCsv(options.outCsv, rows, HEADERS);

  console.log("Word Master V2 human review CSV");
  console.log("-------------------------------");
  console.log(`Total review rows: ${validation.total}`);
  console.log(`Needs review: ${validation.needsReview}`);
  console.log(`Missing data: ${validation.missingData}`);
  console.log(`Duplicate words: ${validation.duplicateWords}`);
  console.log(`Output: ${options.outCsv}`);

  if (!validation.ok) {
    throw new Error(`Human review CSV validation failed:\n${validation.errors.join("\n")}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
