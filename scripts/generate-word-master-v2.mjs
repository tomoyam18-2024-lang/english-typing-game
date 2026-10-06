import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE_FILES = {
  TSL: "data/word-master/raw/TSL_12_stats.csv",
  NAWL: "data/word-master/raw/NAWL_12_stats.csv",
  BSL: "data/word-master/raw/BSL_120_stats.csv",
  NGSL_CORE: "data/word-master/raw/NGSL_12_stats.csv",
};

const OUTPUT_PATH = "src/data/wordMasterV2.json";
const REUSABLE_DICTIONARY_PATH = "src/data/generated/wordDictionaryV2Reusable.json";
const SUMMARY_PATH = "data/word-master/reports/wordMasterV2Report.json";
const REMOVED_REPORT_PATH = "reports/removed-from-master.csv";
const NEW_WORDS_CSV_PATH = "reports/new-words-needing-dictionary-data.csv";
const NEW_WORDS_JSON_PATH = "reports/new-words-needing-dictionary-data.json";
const LEVEL_SAMPLE_PATH = "reports/master-v2-level-samples.csv";

const SOURCE_PRIORITY = ["TSL", "NAWL", "BSL"];

const LEVEL_CONFIG = {
  1: {
    label: "Business Advanced",
    maxWords: 700,
    sources: ["TSL"],
  },
  2: {
    label: "Advanced",
    maxWords: 800,
    sources: ["TSL", "BSL"],
  },
  3: {
    label: "Academic Advanced",
    maxWords: 1000,
    sources: ["NAWL"],
  },
};

const FUNCTION_WORDS = new Set([
  "a",
  "about",
  "above",
  "across",
  "after",
  "again",
  "against",
  "all",
  "almost",
  "also",
  "although",
  "am",
  "among",
  "an",
  "and",
  "any",
  "are",
  "around",
  "as",
  "at",
  "because",
  "been",
  "before",
  "behind",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "done",
  "down",
  "during",
  "each",
  "either",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "many",
  "may",
  "me",
  "might",
  "more",
  "most",
  "must",
  "my",
  "myself",
  "near",
  "neither",
  "no",
  "nor",
  "not",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "us",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "whether",
  "which",
  "while",
  "who",
  "whom",
  "whose",
  "why",
  "will",
  "with",
  "would",
  "yes",
  "yet",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
]);

const NUMERAL_WORDS = new Set([
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
  "hundred",
  "thousand",
  "million",
  "billion",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
]);

const PREFIX_WORDS = new Set([
  "anti",
  "auto",
  "bi",
  "co",
  "de",
  "eco",
  "ex",
  "fore",
  "hyper",
  "inter",
  "intra",
  "macro",
  "micro",
  "mid",
  "mini",
  "mono",
  "multi",
  "neo",
  "non",
  "over",
  "poly",
  "post",
  "pre",
  "pro",
  "re",
  "semi",
  "sub",
  "super",
  "tele",
  "trans",
  "tri",
  "ultra",
  "uni",
]);

const CALENDAR_WORDS = new Set([
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
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

const KNOWN_ABBREVIATIONS = new Set([
  "atm",
  "b2b",
  "b2c",
  "ceo",
  "cfo",
  "cio",
  "coo",
  "cpa",
  "crm",
  "dna",
  "erp",
  "gdp",
  "hr",
  "ipo",
  "it",
  "llc",
  "mba",
  "ngo",
  "roi",
  "sms",
  "tv",
  "uk",
  "usa",
  "vat",
]);

const MANUAL_EXCLUDE_REASONS = new Map([
  ["mister", "TITLE_WORD"],
  ["salespeople", "INFLECTION"],
]);

const INDEPENDENT_PLURAL_LIKE_WORDS = new Set([
  "assets",
  "earnings",
  "economics",
  "ethics",
  "goods",
  "graphics",
  "headquarters",
  "logistics",
  "linguistics",
  "macroeconomics",
  "means",
  "premises",
  "proceeds",
  "savings",
  "series",
]);

const INDEPENDENT_INFLECTION_LIKE_WORDS = new Set([
  "according",
  "advertising",
  "building",
  "concerned",
  "existing",
  "following",
  "funding",
  "housing",
  "marketing",
  "outstanding",
  "processing",
  "training",
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

  if (!existsSync(absolutePath)) {
    throw new Error(`Missing source file: ${filePath}`);
  }

  return parseCsv(readFileSync(absolutePath, "utf8"));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), filePath), "utf8"));
}

function writeJson(filePath, data) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function csvEscape(value) {
  const text = Array.isArray(value) || (value && typeof value === "object") ? JSON.stringify(value) : String(value ?? "");

  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function writeCsv(filePath, rows, headers) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  const lines = [headers.join(",")];

  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  }

  writeFileSync(absolutePath, `${lines.join("\n")}\n`, "utf8");
}

function normalizeWord(rawWord) {
  const original = String(rawWord ?? "").trim();
  const word = original.toLowerCase();

  if (!word) {
    return { word, valid: false, reason: "EMPTY" };
  }

  if (/\s/.test(word)) {
    return { word, valid: false, reason: "SPACE" };
  }

  if (word.includes("-")) {
    return { word, valid: false, reason: "HYPHEN" };
  }

  if (/\d/.test(word)) {
    return { word, valid: false, reason: "DIGIT" };
  }

  if (!/^[a-z]+$/.test(word)) {
    return { word, valid: false, reason: "NON_ALPHA" };
  }

  if (/^[A-Z]{2,}$/.test(original)) {
    return { word, valid: false, reason: "ABBREVIATION" };
  }

  return { word, valid: true };
}

function getRawWord(row) {
  return row.Word ?? row.Lemma ?? row.word ?? row.lemma ?? "";
}

function getRank(row, sourceName, index) {
  const candidatesBySource = {
    TSL: ["TSL Rank", "Rank", "SFI Rank"],
    NAWL: ["Rank", "NAWL Rank", "SFI Rank"],
    BSL: ["BSL Rank", "Rank", "SFI Rank"],
    NGSL_CORE: ["SFI Rank", "Rank"],
  };

  for (const field of candidatesBySource[sourceName] ?? ["Rank"]) {
    const parsedRank = Number(row[field]);

    if (Number.isFinite(parsedRank) && parsedRank > 0) {
      return parsedRank;
    }
  }

  return index + 1;
}

function basicExclusionReason(word, ngslCoreWords) {
  if (MANUAL_EXCLUDE_REASONS.has(word)) {
    return MANUAL_EXCLUDE_REASONS.get(word);
  }

  if (ngslCoreWords.has(word)) {
    return "BASIC_NGSL_WORD";
  }

  if (FUNCTION_WORDS.has(word)) {
    return "FUNCTION_WORD";
  }

  if (NUMERAL_WORDS.has(word)) {
    return "NUMERAL";
  }

  if (PREFIX_WORDS.has(word)) {
    return "PREFIX";
  }

  if (CALENDAR_WORDS.has(word)) {
    return "PROPER_NOUN";
  }

  if (KNOWN_ABBREVIATIONS.has(word)) {
    return "ABBREVIATION";
  }

  return "";
}

function readRawSource(sourceName) {
  const seen = new Set();
  const accepted = [];
  const rejected = [];

  for (const [index, row] of readCsv(SOURCE_FILES[sourceName]).entries()) {
    const rawWord = getRawWord(row);
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
        reason: "DUPLICATE_WITHIN_SOURCE",
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

function filterAdvancedCandidates(sourceData, ngslCoreWords) {
  const filtered = {};

  for (const sourceName of SOURCE_PRIORITY) {
    const accepted = [];
    const rejected = [...sourceData[sourceName].rejected];

    for (const entry of sourceData[sourceName].accepted) {
      const reason = basicExclusionReason(entry.word, ngslCoreWords);

      if (reason) {
        rejected.push({
          source: sourceName,
          rawWord: entry.word,
          normalizedWord: entry.word,
          rank: entry.rank,
          reason,
        });
        continue;
      }

      accepted.push(entry);
    }

    filtered[sourceName] = { accepted, rejected };
  }

  return filtered;
}

function buildWordMasterV2(sourceData) {
  const sourceIndex = createSourceIndex(sourceData);
  const selectedWords = new Set();
  const output = [];

  function selectFromSource(sourceName, level, maxLevelWords) {
    let selectedCount = output.filter((entry) => entry.level === level).length;

    for (const entry of sourceData[sourceName].accepted) {
      if (selectedCount >= maxLevelWords) {
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
  }

  selectFromSource("TSL", 1, LEVEL_CONFIG[1].maxWords);

  // Reserve NAWL words for the academic level before BSL can claim overlapping items.
  selectFromSource("NAWL", 3, LEVEL_CONFIG[3].maxWords);

  for (const sourceName of LEVEL_CONFIG[2].sources) {
    selectFromSource(sourceName, 2, LEVEL_CONFIG[2].maxWords);
  }

  output.sort((a, b) => {
    if (a.level !== b.level) {
      return a.level - b.level;
    }

    return getSelectionRank(a) - getSelectionRank(b) || a.word.localeCompare(b.word);
  });

  return output;
}

function getSelectionRank(entry) {
  const primarySource = entry.level === 3 ? "NAWL" : entry.level === 2 ? "TSL" : "TSL";
  const source = entry.sources.find((candidate) => candidate.name === primarySource) ?? entry.sources[0];
  return source?.rank ?? Number.MAX_SAFE_INTEGER;
}

function baseCandidates(word) {
  const candidates = new Set();

  if (word.endsWith("ies") && word.length > 4) {
    candidates.add(`${word.slice(0, -3)}y`);
  }

  if (word.endsWith("es") && word.length > 4) {
    candidates.add(word.slice(0, -2));
  }

  if (word.endsWith("s") && word.length > 3) {
    candidates.add(word.slice(0, -1));
  }

  if (word.endsWith("ied") && word.length > 5) {
    candidates.add(`${word.slice(0, -3)}y`);
  }

  if (word.endsWith("ed") && word.length > 4) {
    candidates.add(word.slice(0, -2));
    candidates.add(`${word.slice(0, -1)}e`);
  }

  if (word.endsWith("ing") && word.length > 5) {
    candidates.add(word.slice(0, -3));
    candidates.add(`${word.slice(0, -3)}e`);
  }

  return [...candidates].filter((candidate) => candidate.length > 1);
}

function isPotentialPlural(word, referenceWords) {
  if (INDEPENDENT_PLURAL_LIKE_WORDS.has(word)) {
    return false;
  }

  if (word.endsWith("ies") && referenceWords.has(`${word.slice(0, -3)}y`)) {
    return true;
  }

  if (word.endsWith("es") && referenceWords.has(word.slice(0, -2))) {
    return true;
  }

  return word.endsWith("s") && word.length > 3 && referenceWords.has(word.slice(0, -1));
}

function isPotentialInflection(word, referenceWords) {
  if (INDEPENDENT_INFLECTION_LIKE_WORDS.has(word)) {
    return false;
  }

  if (!/(ed|ing|ied)$/.test(word)) {
    return false;
  }

  return baseCandidates(word).some((candidate) => referenceWords.has(candidate));
}

function looksLikeAbbreviation(word) {
  return KNOWN_ABBREVIATIONS.has(word) || (word.length <= 4 && !/[aeiouy]/.test(word));
}

function sourceText(sources) {
  return sources.map((source) => `${source.name}:${source.rank}`).join("|");
}

function classifyRemovedWord(word, oldEntry, ngslCoreWords, referenceWords) {
  const reason = basicExclusionReason(word, ngslCoreWords);

  if (reason) {
    if (reason === "BASIC_NGSL_WORD") {
      return "BASIC_NGSL_WORD";
    }

    if (["FUNCTION_WORD", "NUMERAL", "PREFIX", "INFLECTION"].includes(reason)) {
      return reason;
    }

    return "OTHER";
  }

  if (isPotentialInflection(word, referenceWords) || isPotentialPlural(word, referenceWords)) {
    return "INFLECTION";
  }

  if (oldEntry.sources?.some((source) => source.name === "NGSL-GR")) {
    return "BASIC_NGSL_WORD";
  }

  return "OTHER";
}

function deterministicSample(items, count) {
  if (items.length <= count) {
    return items;
  }

  if (count <= 1) {
    return [items[0]];
  }

  const sampled = [];

  for (let index = 0; index < count; index += 1) {
    const sourceIndex = Math.floor((index * (items.length - 1)) / (count - 1));
    sampled.push(items[sourceIndex]);
  }

  return sampled;
}

function loadGeneratedDictionary() {
  const candidates = [
    "src/data/generated/wordDictionaryReviewStatus.json",
    "src/data/generated/wordDictionary.json",
    "src/data/generated/acceptedDictionary.json",
  ];

  for (const filePath of candidates) {
    const absolutePath = path.resolve(process.cwd(), filePath);

    if (!existsSync(absolutePath)) {
      continue;
    }

    const parsed = readJson(filePath);
    const words = Array.isArray(parsed) ? parsed : parsed.words;

    if (Array.isArray(words)) {
      return { filePath, data: parsed, words };
    }
  }

  return { filePath: "", data: null, words: [] };
}

function buildReuseData(wordMasterV2, dictionaryWords) {
  const dictionaryByWord = new Map(dictionaryWords.map((entry) => [entry.word, entry]));
  const reusable = [];
  const newWords = [];

  for (const masterEntry of wordMasterV2) {
    const dictionaryEntry = dictionaryByWord.get(masterEntry.word);

    if (!dictionaryEntry) {
      newWords.push(masterEntry);
      continue;
    }

    reusable.push({
      ...dictionaryEntry,
      previousMaster: {
        level: dictionaryEntry.level,
        sources: dictionaryEntry.sources ?? [],
      },
      level: masterEntry.level,
      sources: masterEntry.sources,
      wordMasterVersion: "v2",
    });
  }

  return { reusable, newWords };
}

function buildAudit(wordMasterV2, ngslCoreWords, referenceWords) {
  const levelCounts = {
    1: wordMasterV2.filter((entry) => entry.level === 1).length,
    2: wordMasterV2.filter((entry) => entry.level === 2).length,
    3: wordMasterV2.filter((entry) => entry.level === 3).length,
  };
  const words = wordMasterV2.map((entry) => entry.word);
  const uniqueWords = new Set(words);

  return {
    total: wordMasterV2.length,
    levelCounts,
    duplicates: words.length - uniqueWords.size,
    emptyWords: wordMasterV2.filter((entry) => entry.word.length === 0).length,
    invalidWords: wordMasterV2.filter((entry) => !/^[a-z]+$/.test(entry.word)).length,
    missingSources: wordMasterV2.filter((entry) => !Array.isArray(entry.sources) || entry.sources.length === 0).length,
    ngslCoreOverlap: wordMasterV2.filter((entry) => ngslCoreWords.has(entry.word)).length,
    shortWords: wordMasterV2.filter((entry) => entry.word.length <= 3).length,
    numerals: wordMasterV2.filter((entry) => NUMERAL_WORDS.has(entry.word)).length,
    functionWords: wordMasterV2.filter((entry) => FUNCTION_WORDS.has(entry.word)).length,
    prefixes: wordMasterV2.filter((entry) => PREFIX_WORDS.has(entry.word)).length,
    plurals: wordMasterV2.filter((entry) => isPotentialPlural(entry.word, referenceWords)).length,
    inflections: wordMasterV2.filter((entry) => isPotentialInflection(entry.word, referenceWords)).length,
    properNouns: wordMasterV2.filter((entry) => CALENDAR_WORDS.has(entry.word)).length,
    abbreviations: wordMasterV2.filter((entry) => looksLikeAbbreviation(entry.word)).length,
  };
}

function printSummary(summary) {
  console.log("## Word Master V2");
  console.log("");
  console.log(`Old total: ${summary.oldTotal}`);
  console.log(`New total: ${summary.newTotal}`);
  console.log("");
  console.log(`Kept from old master: ${summary.keptFromOldMaster}`);
  console.log(`Removed from old master: ${summary.removedFromOldMaster}`);
  console.log(`Newly added: ${summary.newlyAdded}`);
  console.log("");
  console.log(`Level 1: ${summary.levelCounts[1]}`);
  console.log(`Level 2: ${summary.levelCounts[2]}`);
  console.log(`Level 3: ${summary.levelCounts[3]}`);
  console.log("");
  console.log(`NGSL core overlap: ${summary.audit.ngslCoreOverlap}`);
  console.log(`Potential basic/function words: ${summary.audit.functionWords + summary.audit.numerals}`);
  console.log(`Potential inflections: ${summary.audit.inflections}`);
  console.log(`Potential prefixes: ${summary.audit.prefixes}`);
  console.log(`Potential plurals: ${summary.audit.plurals}`);
  console.log("");
  console.log(`Existing dictionary data reusable: ${summary.existingDictionaryDataReusable}`);
  console.log(`New words needing dictionary processing: ${summary.newWordsNeedingDictionaryProcessing}`);
}

function main() {
  const rawSourceData = {
    TSL: readRawSource("TSL"),
    NAWL: readRawSource("NAWL"),
    BSL: readRawSource("BSL"),
    NGSL_CORE: readRawSource("NGSL_CORE"),
  };
  const ngslCoreWords = new Set(rawSourceData.NGSL_CORE.accepted.map((entry) => entry.word));
  const sourceData = filterAdvancedCandidates(rawSourceData, ngslCoreWords);
  const sourceReferenceWords = new Set(
    SOURCE_PRIORITY.flatMap((sourceName) => rawSourceData[sourceName].accepted.map((entry) => entry.word)),
  );

  const wordMasterV2 = buildWordMasterV2(sourceData);
  const oldMaster = readJson("src/data/wordMaster.json");
  const oldMasterByWord = new Map(oldMaster.map((entry) => [entry.word, entry]));
  const v2Words = new Set(wordMasterV2.map((entry) => entry.word));
  const oldWords = new Set(oldMaster.map((entry) => entry.word));
  const removed = oldMaster
    .filter((entry) => !v2Words.has(entry.word))
    .map((entry) => ({
      word: entry.word,
      oldLevel: entry.level,
      sources: sourceText(entry.sources ?? []),
      reason: classifyRemovedWord(entry.word, entry, ngslCoreWords, sourceReferenceWords),
    }));
  const newlyAdded = wordMasterV2.filter((entry) => !oldWords.has(entry.word));
  const { filePath: dictionarySourcePath, words: dictionaryWords } = loadGeneratedDictionary();
  const { reusable, newWords } = buildReuseData(wordMasterV2, dictionaryWords);
  const audit = buildAudit(wordMasterV2, ngslCoreWords, sourceReferenceWords);
  const levelSamples = [1, 2, 3].flatMap((level) =>
    deterministicSample(
      wordMasterV2.filter((entry) => entry.level === level),
      100,
    ).map((entry, index) => ({
      level,
      sampleIndex: index + 1,
      word: entry.word,
      sources: sourceText(entry.sources),
    })),
  );
  const summary = {
    generatedAt: new Date().toISOString(),
    sourceFiles: SOURCE_FILES,
    sourcePolicy: {
      primarySources: ["TSL 1.2", "NAWL 1.2", "BSL 1.2"],
      excludedSource: "NGSL-GR is not used as a primary supply source for V2.",
      ngslCoreUse: "NGSL 1.2 core is used as an exclusion and audit set.",
      note: "Level sizes are caps, not fixed quotas. The generator does not backfill from NGSL-GR to force exactly 2,500 words.",
    },
    oldTotal: oldMaster.length,
    newTotal: wordMasterV2.length,
    keptFromOldMaster: wordMasterV2.filter((entry) => oldMasterByWord.has(entry.word)).length,
    removedFromOldMaster: removed.length,
    newlyAdded: newlyAdded.length,
    levelCounts: audit.levelCounts,
    audit,
    existingDictionaryDataReusable: reusable.length,
    newWordsNeedingDictionaryProcessing: newWords.length,
    dictionaryReuseSource: dictionarySourcePath,
    sourceCounts: Object.fromEntries(
      [...SOURCE_PRIORITY, "NGSL_CORE"].map((sourceName) => [
        sourceName,
        {
          acceptedRaw: rawSourceData[sourceName].accepted.length,
          rejectedRaw: rawSourceData[sourceName].rejected.length,
          acceptedForV2: sourceData[sourceName]?.accepted.length ?? rawSourceData[sourceName].accepted.length,
          rejectedForV2: sourceData[sourceName]?.rejected.length ?? rawSourceData[sourceName].rejected.length,
        },
      ]),
    ),
  };

  writeJson(OUTPUT_PATH, wordMasterV2);
  writeJson(REUSABLE_DICTIONARY_PATH, {
    metadata: {
      generatedAt: summary.generatedAt,
      wordMasterPath: OUTPUT_PATH,
      sourceDictionary: dictionarySourcePath,
      note: "Non-destructive reuse view for words that exist in wordMasterV2. Existing dictionary files are not modified.",
    },
    summary: {
      reusable: reusable.length,
      newWordsNeedingDictionaryProcessing: newWords.length,
    },
    words: reusable,
  });
  writeJson(SUMMARY_PATH, summary);
  writeJson(NEW_WORDS_JSON_PATH, newWords);
  writeCsv(REMOVED_REPORT_PATH, removed, ["word", "oldLevel", "sources", "reason"]);
  writeCsv(
    NEW_WORDS_CSV_PATH,
    newWords.map((entry) => ({
      word: entry.word,
      level: entry.level,
      sources: sourceText(entry.sources),
    })),
    ["word", "level", "sources"],
  );
  writeCsv(LEVEL_SAMPLE_PATH, levelSamples, ["level", "sampleIndex", "word", "sources"]);

  printSummary(summary);

  if (
    audit.duplicates > 0 ||
    audit.emptyWords > 0 ||
    audit.invalidWords > 0 ||
    audit.missingSources > 0 ||
    audit.ngslCoreOverlap > 0
  ) {
    throw new Error("Word Master V2 validation failed.");
  }
}

export {
  LEVEL_CONFIG,
  SOURCE_FILES,
  SOURCE_PRIORITY,
  createSourceIndex,
  filterAdvancedCandidates,
  isPotentialInflection,
  isPotentialPlural,
  readRawSource,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
