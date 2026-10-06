import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SOURCE_FILES = {
  TSL: "data/word-master/raw/TSL_12_stats.csv",
  NAWL: "data/word-master/raw/NAWL_12_stats.csv",
  "NGSL-GR": "data/word-master/raw/NGSL-GR_rank.csv",
};

const SOURCE_PRIORITY = ["TSL", "NAWL", "NGSL-GR"];
const TARGET_COUNTS = {
  1: 700,
  2: 800,
  3: 1000,
};
const LEVEL2_TSL_TARGET = 550;
const OUTPUT_PATH = "src/data/wordMaster.json";
const REPORT_PATH = "data/word-master/reports/wordMasterReport.json";

const KNOWN_PROPER_WORDS = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

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
  const absolutePath = path.resolve(process.cwd(), filePath);
  return parseCsv(readFileSync(absolutePath, "utf8"));
}

function normalizeWord(rawWord) {
  const original = rawWord.trim();
  const word = original.toLowerCase();

  if (!word) {
    return { word, valid: false, reason: "empty" };
  }

  if (/\s/.test(word)) {
    return { word, valid: false, reason: "contains-space" };
  }

  if (word.includes("-")) {
    return { word, valid: false, reason: "contains-hyphen" };
  }

  if (/\d/.test(word)) {
    return { word, valid: false, reason: "contains-digit" };
  }

  if (!/^[a-z]+$/.test(word)) {
    return { word, valid: false, reason: "non-alpha" };
  }

  if (/^[A-Z]{2,}$/.test(original)) {
    return { word, valid: false, reason: "abbreviation" };
  }

  if (KNOWN_PROPER_WORDS.has(word)) {
    return { word, valid: false, reason: "known-proper-word" };
  }

  return { word, valid: true };
}

function getRank(row, sourceName, index) {
  const rankBySource = {
    TSL: row["TSL Rank"],
    NAWL: row.Rank,
    "NGSL-GR": row.WordID,
  }[sourceName];
  const parsedRank = Number(rankBySource);

  return Number.isFinite(parsedRank) && parsedRank > 0 ? parsedRank : index + 1;
}

function getWord(row, sourceName) {
  if (sourceName === "NGSL-GR") {
    return row.Word;
  }

  return row.Word;
}

function readSource(sourceName) {
  const seen = new Set();
  const accepted = [];
  const rejected = [];

  for (const [index, row] of readCsv(SOURCE_FILES[sourceName]).entries()) {
    const rawWord = getWord(row, sourceName) ?? "";
    const normalized = normalizeWord(rawWord);
    const rank = getRank(row, sourceName, index);

    if (!normalized.valid) {
      rejected.push({ source: sourceName, rawWord, normalizedWord: normalized.word, rank, reason: normalized.reason });
      continue;
    }

    if (seen.has(normalized.word)) {
      rejected.push({
        source: sourceName,
        rawWord,
        normalizedWord: normalized.word,
        rank,
        reason: "duplicate-within-source",
      });
      continue;
    }

    seen.add(normalized.word);
    accepted.push({
      word: normalized.word,
      source: sourceName,
      rank,
    });
  }

  accepted.sort((a, b) => a.rank - b.rank || a.word.localeCompare(b.word));
  return { accepted, rejected };
}

function createSourceIndex(sourceData) {
  const index = new Map();

  for (const sourceName of SOURCE_PRIORITY) {
    for (const entry of sourceData[sourceName].accepted) {
      if (!index.has(entry.word)) {
        index.set(entry.word, []);
      }

      index.get(entry.word).push({
        name: sourceName,
        rank: entry.rank,
      });
    }
  }

  for (const sources of index.values()) {
    sources.sort(
      (a, b) =>
        SOURCE_PRIORITY.indexOf(a.name) - SOURCE_PRIORITY.indexOf(b.name) ||
        a.rank - b.rank ||
        a.name.localeCompare(b.name),
    );
  }

  return index;
}

function selectFromSource({ sourceName, count, level, sourceData, selectedWords, output, sourceIndex }) {
  let selectedCount = 0;

  for (const entry of sourceData[sourceName].accepted) {
    if (selectedCount >= count) {
      break;
    }

    if (selectedWords.has(entry.word)) {
      continue;
    }

    selectedWords.add(entry.word);
    output.push({
      word: entry.word,
      level,
      sources: sourceIndex.get(entry.word) ?? [{ name: sourceName, rank: entry.rank }],
    });
    selectedCount += 1;
  }

  return selectedCount;
}

function fillLevel({ level, targetCount, sourceOrder, sourceData, selectedWords, output, sourceIndex }) {
  const currentLevelCount = () => output.filter((entry) => entry.level === level).length;

  for (const sourceName of sourceOrder) {
    const remaining = targetCount - currentLevelCount();

    if (remaining <= 0) {
      return;
    }

    selectFromSource({
      sourceName,
      count: remaining,
      level,
      sourceData,
      selectedWords,
      output,
      sourceIndex,
    });
  }
}

function buildWordMaster(sourceData) {
  const sourceIndex = createSourceIndex(sourceData);
  const selectedWords = new Set();
  const output = [];

  fillLevel({
    level: 1,
    targetCount: TARGET_COUNTS[1],
    sourceOrder: ["TSL", "NAWL", "NGSL-GR"],
    sourceData,
    selectedWords,
    output,
    sourceIndex,
  });

  selectFromSource({
    sourceName: "TSL",
    count: LEVEL2_TSL_TARGET,
    level: 2,
    sourceData,
    selectedWords,
    output,
    sourceIndex,
  });

  fillLevel({
    level: 2,
    targetCount: TARGET_COUNTS[2],
    sourceOrder: ["NAWL", "NGSL-GR", "TSL"],
    sourceData,
    selectedWords,
    output,
    sourceIndex,
  });

  fillLevel({
    level: 3,
    targetCount: TARGET_COUNTS[3],
    sourceOrder: ["NAWL", "NGSL-GR", "TSL"],
    sourceData,
    selectedWords,
    output,
    sourceIndex,
  });

  output.sort((a, b) => a.level - b.level || a.word.localeCompare(b.word));
  return output;
}

function validateWordMaster(wordMaster) {
  const levelCounts = {
    1: wordMaster.filter((entry) => entry.level === 1).length,
    2: wordMaster.filter((entry) => entry.level === 2).length,
    3: wordMaster.filter((entry) => entry.level === 3).length,
  };
  const words = wordMaster.map((entry) => entry.word);
  const uniqueWords = new Set(words);
  const invalidWords = wordMaster.filter(
    (entry) =>
      !entry.word ||
      /\s/.test(entry.word) ||
      /\d/.test(entry.word) ||
      entry.word.includes("-") ||
      !/^[a-z]+$/.test(entry.word) ||
      !Array.isArray(entry.sources) ||
      entry.sources.length === 0,
  );
  const validation = {
    total: wordMaster.length,
    levelCounts,
    duplicates: words.length - uniqueWords.size,
    emptyWords: wordMaster.filter((entry) => entry.word.length === 0).length,
    wordsWithSpaces: wordMaster.filter((entry) => /\s/.test(entry.word)).length,
    wordsWithDigits: wordMaster.filter((entry) => /\d/.test(entry.word)).length,
    invalidWords: invalidWords.length,
    missingSources: wordMaster.filter((entry) => !Array.isArray(entry.sources) || entry.sources.length === 0).length,
  };
  const passed =
    validation.total === 2500 &&
    validation.levelCounts[1] === TARGET_COUNTS[1] &&
    validation.levelCounts[2] === TARGET_COUNTS[2] &&
    validation.levelCounts[3] === TARGET_COUNTS[3] &&
    validation.duplicates === 0 &&
    validation.emptyWords === 0 &&
    validation.wordsWithSpaces === 0 &&
    validation.wordsWithDigits === 0 &&
    validation.invalidWords === 0 &&
    validation.missingSources === 0;

  return { passed, validation };
}

function writeJson(filePath, data) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function printValidation(validation) {
  console.log("Word master validation");
  console.log("----------------------");
  console.log(`Total: ${validation.total}`);
  console.log(`Level 1: ${validation.levelCounts[1]}`);
  console.log(`Level 2: ${validation.levelCounts[2]}`);
  console.log(`Level 3: ${validation.levelCounts[3]}`);
  console.log(`Duplicates: ${validation.duplicates}`);
  console.log(`Invalid words: ${validation.invalidWords}`);
  console.log(`Empty words: ${validation.emptyWords}`);
  console.log(`Words with spaces: ${validation.wordsWithSpaces}`);
  console.log(`Words with digits: ${validation.wordsWithDigits}`);
  console.log(`Missing sources: ${validation.missingSources}`);
}

function main() {
  const sourceData = Object.fromEntries(SOURCE_PRIORITY.map((sourceName) => [sourceName, readSource(sourceName)]));
  const wordMaster = buildWordMaster(sourceData);
  const { passed, validation } = validateWordMaster(wordMaster);
  const report = {
    generatedAt: new Date().toISOString(),
    validation,
    sourceCounts: Object.fromEntries(
      SOURCE_PRIORITY.map((sourceName) => [
        sourceName,
        {
          accepted: sourceData[sourceName].accepted.length,
          rejected: sourceData[sourceName].rejected.length,
        },
      ]),
    ),
    rejectedWords: Object.fromEntries(SOURCE_PRIORITY.map((sourceName) => [sourceName, sourceData[sourceName].rejected])),
    notes: [
      "No automatic stemming is applied. Source lists are treated as ranked headword/flemma lists to avoid unsafe merges.",
      "This app level assignment is independent and does not imply an official TOEIC or TOEFL score mapping.",
    ],
  };

  writeJson(OUTPUT_PATH, wordMaster);
  writeJson(REPORT_PATH, report);
  printValidation(validation);

  if (!passed) {
    throw new Error("Word master validation failed.");
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
