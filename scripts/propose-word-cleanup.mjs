import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const WORD_MASTER_PATH = "src/data/wordMaster.json";
const AUDIT_PATH = "reports/word-master-audit.json";
const REPORT_DIR = "reports";
const REVIEW_PATH = `${REPORT_DIR}/word-cleanup-review.csv`;
const REPLACEMENTS_PATH = `${REPORT_DIR}/word-cleanup-replacements.csv`;

const SOURCE_FILES = {
  TSL: "data/word-master/raw/TSL_12_stats.csv",
  NAWL: "data/word-master/raw/NAWL_12_stats.csv",
  "NGSL-GR": "data/word-master/raw/NGSL-GR_rank.csv",
};
const SOURCE_PRIORITY = ["TSL", "NAWL", "NGSL-GR"];
const LEVEL_REPLACEMENT_SOURCE_ORDER = {
  1: ["TSL", "NAWL", "NGSL-GR"],
  2: ["TSL", "NAWL", "NGSL-GR"],
  3: ["NAWL", "NGSL-GR", "TSL"],
};

const REVIEW_ACTIONS = ["KEEP", "REMOVE", "REVIEW"];

const BASIC_FUNCTION_OR_ULTRA_BASIC_WORDS = new Set([
  "a",
  "about",
  "after",
  "again",
  "all",
  "also",
  "and",
  "any",
  "as",
  "ask",
  "at",
  "back",
  "be",
  "because",
  "big",
  "but",
  "by",
  "can",
  "come",
  "day",
  "do",
  "down",
  "eat",
  "for",
  "from",
  "get",
  "give",
  "go",
  "good",
  "have",
  "he",
  "here",
  "how",
  "i",
  "if",
  "in",
  "it",
  "know",
  "like",
  "look",
  "make",
  "man",
  "new",
  "no",
  "not",
  "now",
  "of",
  "on",
  "one",
  "or",
  "out",
  "people",
  "say",
  "see",
  "she",
  "so",
  "some",
  "take",
  "that",
  "the",
  "then",
  "there",
  "they",
  "this",
  "time",
  "to",
  "two",
  "up",
  "use",
  "want",
  "we",
  "what",
  "when",
  "which",
  "who",
  "will",
  "with",
  "work",
  "write",
  "year",
  "yes",
  "yet",
  "you",
]);

const INDEPENDENT_INFLECTION_LIKE_WORDS = new Set([
  "anything",
  "bleed",
  "ceiling",
  "during",
  "embed",
  "everything",
  "hundred",
  "morning",
  "naked",
  "nothing",
  "offspring",
  "something",
  "watershed",
]);

const INDEPENDENT_PARTICIPIAL_ADJECTIVES = new Set([
  "hardworking",
  "incoming",
  "ongoing",
  "outdated",
  "outstanding",
  "unattended",
  "unauthorized",
  "unemployed",
  "unexpected",
  "unlimited",
  "unspecified",
  "unused",
  "upcoming",
]);

const INDEPENDENT_PLURAL_LIKE_WORDS = new Set([
  "goods",
  "graphics",
  "headquarters",
  "linguistics",
  "sometimes",
]);

function readJson(filePath) {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), filePath), "utf8"));
}

function writeFile(filePath, content) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join("|") : String(value ?? "");

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

function parseCsv(text) {
  const lines = text
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

function readCsv(filePath) {
  return parseCsv(readFileSync(path.resolve(process.cwd(), filePath), "utf8"));
}

function normalizeWord(rawWord) {
  const original = rawWord.trim();
  const word = original.toLowerCase();

  if (!word || /\s/.test(word) || word.includes("-") || /\d/.test(word) || !/^[a-z]+$/.test(word)) {
    return null;
  }

  if (/^[A-Z]{2,}$/.test(original)) {
    return null;
  }

  return word;
}

function getRank(row, sourceName, index) {
  const rankValue =
    {
      TSL: row["TSL Rank"],
      NAWL: row.Rank,
      "NGSL-GR": row.WordID,
    }[sourceName] ?? "";
  const parsedRank = Number(rankValue);

  return Number.isFinite(parsedRank) && parsedRank > 0 ? parsedRank : index + 1;
}

function readSource(sourceName) {
  const seen = new Set();
  const accepted = [];
  const sourcePath = SOURCE_FILES[sourceName];

  if (!existsSync(path.resolve(process.cwd(), sourcePath))) {
    return accepted;
  }

  for (const [index, row] of readCsv(sourcePath).entries()) {
    const rawWord = row.Word ?? "";
    const word = normalizeWord(rawWord);

    if (!word || seen.has(word)) {
      continue;
    }

    seen.add(word);
    accepted.push({
      word,
      source: sourceName,
      rank: getRank(row, sourceName, index),
    });
  }

  accepted.sort((a, b) => a.rank - b.rank || a.word.localeCompare(b.word));
  return accepted;
}

function formatSourceNames(sources) {
  return sources.map((source) => source.name).join("|");
}

function formatRanks(sources) {
  return sources.map((source) => `${source.name}:${source.rank}`).join("|");
}

function getEntryByWord(wordMaster) {
  return new Map(wordMaster.map((entry) => [entry.word, entry]));
}

function getFamilyBaseByWord(wordFamilies) {
  const familyBaseByWord = new Map();

  for (const family of wordFamilies) {
    for (const word of family.words) {
      familyBaseByWord.set(word, family.base);
    }
  }

  return familyBaseByWord;
}

function possibleBaseWordsForInflection(word) {
  const candidates = new Set();

  if (word.endsWith("ing") && word.length > 5) {
    const stem = word.slice(0, -3);
    candidates.add(stem);
    candidates.add(`${stem}e`);

    if (/([bcdfghjklmnpqrstvwxyz])\1$/.test(stem)) {
      candidates.add(stem.slice(0, -1));
    }
  }

  if (word.endsWith("ied") && word.length > 5) {
    candidates.add(`${word.slice(0, -3)}y`);
  }

  if (word.endsWith("ed") && word.length > 4) {
    const stem = word.slice(0, -2);
    candidates.add(stem);
    candidates.add(`${stem}e`);

    if (/([bcdfghjklmnpqrstvwxyz])\1$/.test(stem)) {
      candidates.add(stem.slice(0, -1));
    }
  }

  return [...candidates].filter((candidate) => candidate.length >= 3);
}

function possibleSingulars(word) {
  const candidates = new Set();

  if (word.endsWith("ies") && word.length > 4) {
    candidates.add(`${word.slice(0, -3)}y`);
  }

  if (word.endsWith("es") && word.length > 4) {
    candidates.add(word.slice(0, -2));
  }

  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) {
    candidates.add(word.slice(0, -1));
  }

  return [...candidates].filter((candidate) => candidate.length >= 3);
}

function possibleComparisonBases(word) {
  const candidates = new Set();

  if (word.endsWith("iest") && word.length > 5) {
    candidates.add(`${word.slice(0, -4)}y`);
  }

  if (word.endsWith("ier") && word.length > 4) {
    candidates.add(`${word.slice(0, -3)}y`);
  }

  if (word.endsWith("est") && word.length > 5) {
    const stem = word.slice(0, -3);
    candidates.add(stem);
    candidates.add(`${stem}e`);
  }

  if (word.endsWith("er") && word.length > 4) {
    const stem = word.slice(0, -2);
    candidates.add(stem);
    candidates.add(`${stem}e`);
  }

  return [...candidates].filter((candidate) => candidate.length >= 3);
}

function actionRank(action) {
  return REVIEW_ACTIONS.indexOf(action);
}

function strongerAction(currentAction, nextAction) {
  return actionRank(nextAction) > actionRank(currentAction) ? nextAction : currentAction;
}

function compactIssues(categories) {
  return categories
    .map((category) =>
      ({
        "potential-abbreviation": "abbreviation",
        "potential-inflection": "inflection",
        "comparative-superlative": "comparative-superlative",
        "potential-plural": "plural",
        "word-family-candidate": "word-family",
        "very-short": "very-short",
        "very-long": "very-long",
        "possibly-too-basic": "too-basic",
        "possibly-specialized": "specialized",
        "typing-suitability": "typing-suitability",
      })[category] ?? category,
    )
    .join("|");
}

function evaluateSuspiciousEntry(entry, wordSet, familyBaseByWord) {
  let proposedAction = "KEEP";
  const reasons = [];
  const baseWords = new Set();
  const categories = entry.categories ?? [];

  if (categories.includes("potential-abbreviation")) {
    proposedAction = strongerAction(proposedAction, "REVIEW");
    reasons.push(
      "Flagged by the audit abbreviation token list after lowercasing; review because this entry is more likely a very basic pronoun/function word than a true acronym.",
    );
  }

  if (categories.includes("potential-inflection")) {
    const bases = possibleBaseWordsForInflection(entry.word).filter((candidate) => wordSet.has(candidate));
    bases.forEach((base) => baseWords.add(base));

    if (INDEPENDENT_INFLECTION_LIKE_WORDS.has(entry.word)) {
      reasons.push("Looks suffix-like, but is a common independent lexical item; do not remove by suffix alone.");
    } else if (INDEPENDENT_PARTICIPIAL_ADJECTIVES.has(entry.word)) {
      proposedAction = strongerAction(proposedAction, "REVIEW");
      reasons.push(
        "Looks participial, but is commonly used as an adjective or fixed lexical item; review before any removal.",
      );
    } else if (bases.length > 0) {
      proposedAction = strongerAction(proposedAction, "REMOVE");
      reasons.push(
        `Clear inflection-like form with base word ${bases.join("|")} present in wordMaster and no known independent-entry exception.`,
      );
    } else {
      reasons.push("Ends with an inflection-like suffix, but no matching base word exists in wordMaster.");
    }
  }

  if (categories.includes("comparative-superlative")) {
    const bases = possibleComparisonBases(entry.word).filter((candidate) => wordSet.has(candidate));
    bases.forEach((base) => baseWords.add(base));
    proposedAction = strongerAction(proposedAction, "REVIEW");
    reasons.push("Possible comparative/superlative form, but may also be an independent word; review manually.");
  }

  if (categories.includes("potential-plural")) {
    const singulars = possibleSingulars(entry.word).filter((candidate) => wordSet.has(candidate));
    singulars.forEach((base) => baseWords.add(base));

    if (INDEPENDENT_PLURAL_LIKE_WORDS.has(entry.word)) {
      if (entry.word === "graphics") {
        proposedAction = strongerAction(proposedAction, "REVIEW");
        reasons.push(
          "Plural-like form with an independent graphics/visuals sense; review rather than auto-removing.",
        );
      } else {
        reasons.push("Plural-like form has an independent lexical meaning; keep unless later review says otherwise.");
      }
    } else if (singulars.length > 0) {
      proposedAction = strongerAction(proposedAction, "REMOVE");
      reasons.push(
        `Simple plural-like form with singular ${singulars.join("|")} present in wordMaster and no known independent-entry exception.`,
      );
    }
  }

  if (categories.includes("word-family-candidate")) {
    const familyBase = familyBaseByWord.get(entry.word);
    if (familyBase) {
      baseWords.add(familyBase);
    }
    reasons.push("Part of a derivational word-family candidate; keep by default because derived forms can differ by POS or meaning.");
  }

  if (categories.includes("very-short")) {
    if (BASIC_FUNCTION_OR_ULTRA_BASIC_WORDS.has(entry.word)) {
      proposedAction = strongerAction(proposedAction, "REVIEW");
      reasons.push("Very short and very basic for the app's advanced-learning target; review for possible replacement.");
    } else {
      reasons.push("Very short, but short lexical words are kept unless another issue applies.");
    }
  }

  if (categories.includes("very-long")) {
    reasons.push("Long word, but spelling looks normal and long words remain useful typing targets.");
  }

  if (categories.includes("possibly-too-basic") && BASIC_FUNCTION_OR_ULTRA_BASIC_WORDS.has(entry.word)) {
    proposedAction = strongerAction(proposedAction, "REVIEW");
    reasons.push("Audit marked it as very basic for its advanced level.");
  }

  if (categories.includes("possibly-specialized")) {
    proposedAction = strongerAction(proposedAction, "REVIEW");
    reasons.push("Specialized academic-looking term; review suitability for a general advanced typing game.");
  }

  if (categories.includes("typing-suitability") && entry.word.length <= 2) {
    proposedAction = strongerAction(proposedAction, "REVIEW");
    reasons.push("One- or two-letter word may be awkward and too easy for typing-game practice.");
  }

  return {
    proposedAction,
    baseWords: [...baseWords].sort(),
    reason: [...new Set(reasons)].join(" "),
  };
}

function buildReviewRows(wordMaster, audit) {
  const wordSet = new Set(wordMaster.map((entry) => entry.word));
  const entryByWord = getEntryByWord(wordMaster);
  const familyBaseByWord = getFamilyBaseByWord(audit.wordFamilies ?? []);
  const suspiciousWords = audit.suspiciousWords ?? [];

  return suspiciousWords
    .map((suspiciousEntry) => {
      const entry = entryByWord.get(suspiciousEntry.word);

      if (!entry) {
        return null;
      }

      const evaluation = evaluateSuspiciousEntry(suspiciousEntry, wordSet, familyBaseByWord);

      return {
        word: entry.word,
        level: entry.level,
        issue: compactIssues(suspiciousEntry.categories ?? []),
        proposed_action: evaluation.proposedAction,
        base_word: evaluation.baseWords.join("|"),
        reason: evaluation.reason,
        sources: formatSourceNames(entry.sources),
        ranks: formatRanks(entry.sources),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.level - b.level || a.word.localeCompare(b.word) || a.issue.localeCompare(b.issue));
}

function createSourceIndex(sourceData) {
  const sourceIndex = new Map();

  for (const sourceName of SOURCE_PRIORITY) {
    for (const entry of sourceData[sourceName]) {
      if (!sourceIndex.has(entry.word)) {
        sourceIndex.set(entry.word, []);
      }

      sourceIndex.get(entry.word).push({
        name: sourceName,
        rank: entry.rank,
      });
    }
  }

  for (const sources of sourceIndex.values()) {
    sources.sort(
      (a, b) =>
        SOURCE_PRIORITY.indexOf(a.name) - SOURCE_PRIORITY.indexOf(b.name) ||
        a.rank - b.rank ||
        a.name.localeCompare(b.name),
    );
  }

  return sourceIndex;
}

function buildReplacementCandidates(wordMaster, removeRows) {
  if (removeRows.length === 0) {
    return [];
  }

  const sourceData = Object.fromEntries(SOURCE_PRIORITY.map((sourceName) => [sourceName, readSource(sourceName)]));
  const sourceIndex = createSourceIndex(sourceData);
  const selectedWords = new Set(wordMaster.map((entry) => entry.word));
  const reservedReplacementWords = new Set();
  const candidates = [];

  for (const removeRow of removeRows) {
    const sourceOrder = LEVEL_REPLACEMENT_SOURCE_ORDER[removeRow.level] ?? SOURCE_PRIORITY;
    let replacement = null;

    for (const sourceName of sourceOrder) {
      replacement = sourceData[sourceName].find(
        (candidate) => !selectedWords.has(candidate.word) && !reservedReplacementWords.has(candidate.word),
      );

      if (replacement) {
        break;
      }
    }

    if (!replacement) {
      candidates.push({
        removed_word: removeRow.word,
        removed_level: removeRow.level,
        replacement_word: "",
        replacement_sources: "",
        replacement_ranks: "",
        reason: "No unused source-list candidate found for this level.",
      });
      continue;
    }

    reservedReplacementWords.add(replacement.word);
    const sources = sourceIndex.get(replacement.word) ?? [{ name: replacement.source, rank: replacement.rank }];
    candidates.push({
      removed_word: removeRow.word,
      removed_level: removeRow.level,
      replacement_word: replacement.word,
      replacement_sources: formatSourceNames(sources),
      replacement_ranks: formatRanks(sources),
      reason: "Unused source-list candidate selected deterministically by level source order and rank.",
    });
  }

  return candidates;
}

function summarize(rows) {
  return {
    KEEP: rows.filter((row) => row.proposed_action === "KEEP").length,
    REMOVE: rows.filter((row) => row.proposed_action === "REMOVE").length,
    REVIEW: rows.filter((row) => row.proposed_action === "REVIEW").length,
  };
}

function main() {
  const wordMaster = readJson(WORD_MASTER_PATH);
  const audit = readJson(AUDIT_PATH);
  const reviewRows = buildReviewRows(wordMaster, audit);
  const removeRows = reviewRows.filter((row) => row.proposed_action === "REMOVE");
  const replacementRows = buildReplacementCandidates(wordMaster, removeRows);
  const counts = summarize(reviewRows);

  writeCsv(REVIEW_PATH, reviewRows, ["word", "level", "issue", "proposed_action", "base_word", "reason", "sources", "ranks"]);
  writeCsv(REPLACEMENTS_PATH, replacementRows, [
    "removed_word",
    "removed_level",
    "replacement_word",
    "replacement_sources",
    "replacement_ranks",
    "reason",
  ]);

  console.log("Word Cleanup Review");
  console.log("-------------------");
  console.log(`Rows: ${reviewRows.length}`);
  console.log(`KEEP: ${counts.KEEP}`);
  console.log(`REMOVE: ${counts.REMOVE}`);
  console.log(`REVIEW: ${counts.REVIEW}`);
  console.log(`Replacement candidates: ${replacementRows.length}`);
  console.log("");
  console.log("Review files generated:");
  console.log(`- ${REVIEW_PATH}`);
  console.log(`- ${REPLACEMENTS_PATH}`);
  console.log("");
  console.log("No wordMaster entries were modified.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
