import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const INPUT_PATH = "src/data/wordMaster.json";
const REPORT_DIR = "reports";
const TARGET_COUNTS = {
  1: 700,
  2: 800,
  3: 1000,
};
const SOURCE_PRIORITY_BY_LEVEL = {
  1: ["TSL", "NAWL", "NGSL-GR"],
  2: ["TSL", "NAWL", "NGSL-GR"],
  3: ["NAWL", "NGSL-GR", "TSL"],
};

const ABBREVIATION_LIKE_WORDS = new Set([
  "ad",
  "ai",
  "ceo",
  "cd",
  "dna",
  "dvd",
  "gps",
  "id",
  "it",
  "pc",
  "rna",
  "tv",
  "uk",
  "usa",
]);

const PROPER_NOUN_LIKE_WORDS = new Set([
  "africa",
  "african",
  "america",
  "american",
  "asia",
  "asian",
  "australia",
  "australian",
  "britain",
  "british",
  "canada",
  "canadian",
  "china",
  "chinese",
  "england",
  "english",
  "europe",
  "european",
  "france",
  "french",
  "germany",
  "german",
  "india",
  "indian",
  "japan",
  "japanese",
  "korea",
  "korean",
  "london",
]);

const VERY_BASIC_WORDS = new Set([
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
  "boy",
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
  "her",
  "here",
  "him",
  "his",
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
  "me",
  "my",
  "new",
  "no",
  "not",
  "now",
  "of",
  "on",
  "one",
  "or",
  "our",
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
  "their",
  "them",
  "then",
  "there",
  "they",
  "this",
  "time",
  "to",
  "two",
  "up",
  "us",
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

const SPECIALIZED_SUFFIXES = [
  "ase",
  "itis",
  "ology",
  "ological",
  "ologist",
  "osis",
  "um",
  "ium",
  "phobia",
  "phobic",
  "graphy",
  "metric",
  "genesis",
];
const COMPARATIVE_BASE_HINTS = new Set([
  "bad",
  "big",
  "bright",
  "cheap",
  "clean",
  "close",
  "cold",
  "cool",
  "dark",
  "deep",
  "early",
  "easy",
  "fast",
  "great",
  "happy",
  "hard",
  "heavy",
  "high",
  "hot",
  "large",
  "late",
  "light",
  "long",
  "low",
  "near",
  "new",
  "old",
  "poor",
  "quick",
  "rich",
  "safe",
  "short",
  "simple",
  "slow",
  "small",
  "smooth",
  "strong",
  "tall",
  "warm",
  "weak",
  "wide",
  "young",
]);

function readWordMaster() {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), INPUT_PATH), "utf8"));
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

function writeJson(filePath, data) {
  writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function writeFile(filePath, content) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

function sourcesToString(sources) {
  return sources.map((source) => `${source.name}:${source.rank}`).join("|");
}

function getPreferredSource(entry) {
  const priority = SOURCE_PRIORITY_BY_LEVEL[entry.level] ?? ["TSL", "NAWL", "NGSL-GR"];

  for (const sourceName of priority) {
    const source = entry.sources.find((candidate) => candidate.name === sourceName);

    if (source) {
      return source;
    }
  }

  return entry.sources[0] ?? { name: "UNKNOWN", rank: Number.MAX_SAFE_INTEGER };
}

function compareByLevelOrder(a, b) {
  const aSource = getPreferredSource(a);
  const bSource = getPreferredSource(b);
  const priority = SOURCE_PRIORITY_BY_LEVEL[a.level] ?? ["TSL", "NAWL", "NGSL-GR"];
  const sourceDiff = priority.indexOf(aSource.name) - priority.indexOf(bSource.name);

  return sourceDiff || aSource.rank - bSource.rank || a.word.localeCompare(b.word);
}

function validateBasic(wordMaster) {
  const words = wordMaster.map((entry) => entry.word);
  const uniqueWords = new Set(words);
  const invalidLevelCount = wordMaster.filter((entry) => ![1, 2, 3].includes(entry.level)).length;
  const missingSources = wordMaster.filter((entry) => !Array.isArray(entry.sources) || entry.sources.length === 0).length;

  return {
    total: wordMaster.length,
    levelCounts: {
      1: wordMaster.filter((entry) => entry.level === 1).length,
      2: wordMaster.filter((entry) => entry.level === 2).length,
      3: wordMaster.filter((entry) => entry.level === 3).length,
    },
    duplicates: words.length - uniqueWords.size,
    emptyWords: wordMaster.filter((entry) => entry.word.length === 0).length,
    wordsWithDigits: wordMaster.filter((entry) => /\d/.test(entry.word)).length,
    wordsWithSpaces: wordMaster.filter((entry) => /\s/.test(entry.word)).length,
    missingSources,
    invalidLevels: invalidLevelCount,
  };
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

function familyKey(word) {
  let key = word;

  const suffixRules = [
    ["ization", ""],
    ["ational", "ate"],
    ["ically", "ic"],
    ["ically", ""],
    ["fulness", "ful"],
    ["iveness", "ive"],
    ["ability", "able"],
    ["ibility", "ible"],
    ["ation", "ate"],
    ["ition", "it"],
    ["ically", ""],
    ["ical", "ic"],
    ["ally", "al"],
    ["ingly", ""],
    ["edly", ""],
    ["ment", ""],
    ["ness", ""],
    ["ance", ""],
    ["ence", ""],
    ["ancy", ""],
    ["ency", ""],
    ["tion", "t"],
    ["sion", "s"],
    ["ity", ""],
    ["ive", ""],
    ["ous", ""],
    ["ful", ""],
    ["less", ""],
    ["able", ""],
    ["ible", ""],
    ["ally", ""],
    ["ly", ""],
    ["al", ""],
    ["ic", ""],
    ["ize", ""],
    ["ise", ""],
    ["ate", ""],
    ["ing", ""],
    ["ed", ""],
    ["er", ""],
    ["or", ""],
    ["s", ""],
  ];

  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;

    for (const [suffix, replacement] of suffixRules) {
      if (key.endsWith(suffix) && key.length - suffix.length >= 5) {
        key = `${key.slice(0, -suffix.length)}${replacement}`;
        changed = true;
        break;
      }
    }

    if (!changed) {
      break;
    }
  }

  if (key.endsWith("y") && key.length >= 6) {
    key = key.slice(0, -1);
  }

  return key.length >= 5 ? key : word;
}

function buildFamilyGroups(wordMaster) {
  const groups = new Map();

  for (const entry of wordMaster) {
    const key = familyKey(entry.word);

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(entry);
  }

  return [...groups.entries()]
    .filter(([, entries]) => entries.length >= 3)
    .map(([base, entries]) => ({
      base,
      words: entries.map((entry) => entry.word).sort(),
      levels: [...new Set(entries.map((entry) => entry.level))].sort((a, b) => a - b),
      size: entries.length,
    }))
    .sort((a, b) => b.size - a.size || a.base.localeCompare(b.base));
}

function detectSuspiciousWords(wordMaster, familyGroups) {
  const wordSet = new Set(wordMaster.map((entry) => entry.word));
  const familyByWord = new Map();

  for (const family of familyGroups) {
    for (const word of family.words) {
      familyByWord.set(word, family.base);
    }
  }

  return wordMaster
    .map((entry) => {
      const categories = [];
      const reasons = [];
      const inflectionBases = possibleBaseWordsForInflection(entry.word).filter((candidate) => wordSet.has(candidate));
      const pluralBases = possibleSingulars(entry.word).filter((candidate) => wordSet.has(candidate));
      const comparisonBases = possibleComparisonBases(entry.word).filter(
        (candidate) => wordSet.has(candidate) && COMPARATIVE_BASE_HINTS.has(candidate),
      );
      const hasInflectionalSuffix =
        (entry.word.endsWith("ing") && entry.word.length > 5) || (entry.word.endsWith("ed") && entry.word.length > 4);

      if (PROPER_NOUN_LIKE_WORDS.has(entry.word)) {
        categories.push("potential-proper-noun");
        reasons.push("Known proper-noun or demonym/language-like word.");
      }

      if (ABBREVIATION_LIKE_WORDS.has(entry.word)) {
        categories.push("potential-abbreviation");
        reasons.push("Known abbreviation-like token after lowercasing.");
      }

      if (inflectionBases.length > 0 || hasInflectionalSuffix) {
        categories.push("potential-inflection");
        reasons.push(
          inflectionBases.length > 0
            ? `Looks like an inflected form of: ${inflectionBases.join("|")}.`
            : "Ends with an inflection-like suffix; no matching base word found in the master list.",
        );
      }

      if (comparisonBases.length > 0) {
        categories.push("comparative-superlative");
        reasons.push(`Looks like a comparative/superlative form of: ${comparisonBases.join("|")}.`);
      }

      if (pluralBases.length > 0) {
        categories.push("potential-plural");
        reasons.push(`Looks like a plural form of: ${pluralBases.join("|")}.`);
      }

      if (familyByWord.has(entry.word)) {
        categories.push("word-family-candidate");
        reasons.push(`Part of derivational family candidate: ${familyByWord.get(entry.word)}.`);
      }

      if (entry.word.length <= 3) {
        categories.push("very-short");
        reasons.push("3 letters or fewer.");
      }

      if (entry.word.length >= 15) {
        categories.push("very-long");
        reasons.push("15 letters or more.");
      }

      if (entry.level >= 2 && VERY_BASIC_WORDS.has(entry.word)) {
        categories.push("possibly-too-basic");
        reasons.push("Common basic word appears in an advanced level.");
      }

      if (
        entry.word.length >= 12 &&
        entry.sources.some((source) => source.name === "NAWL") &&
        SPECIALIZED_SUFFIXES.some((suffix) => entry.word.endsWith(suffix))
      ) {
        categories.push("possibly-specialized");
        reasons.push("Long academic-looking technical form; review suitability for typing practice.");
      }

      if (entry.word.length <= 2 || entry.word.length >= 18) {
        categories.push("typing-suitability");
        reasons.push("Length may be awkward for the typing-game target experience.");
      }

      return {
        ...entry,
        preferredSource: getPreferredSource(entry),
        categories,
        reasons,
      };
    })
    .filter((entry) => entry.categories.length > 0)
    .sort((a, b) => a.level - b.level || a.word.localeCompare(b.word));
}

function sampleEvenly(entries, count) {
  if (entries.length <= count) {
    return entries;
  }

  return Array.from({ length: count }, (_, index) => entries[Math.floor((index * (entries.length - 1)) / (count - 1))]);
}

function buildLevelSamples(wordMaster) {
  return [1, 2, 3].flatMap((level) => {
    const entries = wordMaster.filter((entry) => entry.level === level).sort(compareByLevelOrder);

    return sampleEvenly(entries, 50).map((entry, index) => ({
      sampleSet: `level-${level}-even-sample`,
      sampleIndex: index + 1,
      word: entry.word,
      level: entry.level,
      sources: sourcesToString(entry.sources),
    }));
  });
}

function buildLevelBoundaries(wordMaster) {
  const level1 = wordMaster.filter((entry) => entry.level === 1).sort(compareByLevelOrder);
  const level2 = wordMaster.filter((entry) => entry.level === 2).sort(compareByLevelOrder);
  const level3 = wordMaster.filter((entry) => entry.level === 3).sort(compareByLevelOrder);
  const boundarySets = [
    ["level-1-last-50", level1.slice(-50)],
    ["level-2-first-50", level2.slice(0, 50)],
    ["level-2-last-50", level2.slice(-50)],
    ["level-3-first-50", level3.slice(0, 50)],
  ];

  return boundarySets.flatMap(([boundary, entries]) =>
    entries.map((entry, index) => ({
      boundary,
      boundaryIndex: index + 1,
      word: entry.word,
      level: entry.level,
      sources: sourcesToString(entry.sources),
    })),
  );
}

function rowsForAllWords(wordMaster, suspiciousWords) {
  const suspiciousByWord = new Map(suspiciousWords.map((entry) => [entry.word, entry]));

  return wordMaster.map((entry) => {
    const suspicious = suspiciousByWord.get(entry.word);

    return {
      word: entry.word,
      level: entry.level,
      sources: sourcesToString(entry.sources),
      suspiciousCategories: suspicious?.categories.join("|") ?? "",
      suspiciousReasons: suspicious?.reasons.join(" / ") ?? "",
    };
  });
}

function categoryCount(suspiciousWords, category) {
  return suspiciousWords.filter((entry) => entry.categories.includes(category)).length;
}

function main() {
  const wordMaster = readWordMaster();
  const basicValidation = validateBasic(wordMaster);
  const familyGroups = buildFamilyGroups(wordMaster);
  const suspiciousWords = detectSuspiciousWords(wordMaster, familyGroups);
  const levelSamples = buildLevelSamples(wordMaster);
  const levelBoundaries = buildLevelBoundaries(wordMaster);
  const summary = {
    totalWords: basicValidation.total,
    levelCounts: basicValidation.levelCounts,
    basicValidation,
    suspiciousCounts: {
      potentialProperNouns: categoryCount(suspiciousWords, "potential-proper-noun"),
      potentialAbbreviations: categoryCount(suspiciousWords, "potential-abbreviation"),
      potentialInflections: categoryCount(suspiciousWords, "potential-inflection"),
      comparativeSuperlatives: categoryCount(suspiciousWords, "comparative-superlative"),
      potentialPlurals: categoryCount(suspiciousWords, "potential-plural"),
      wordFamilyCandidateWords: categoryCount(suspiciousWords, "word-family-candidate"),
      veryShortWords: categoryCount(suspiciousWords, "very-short"),
      veryLongWords: categoryCount(suspiciousWords, "very-long"),
      possiblyTooBasic: categoryCount(suspiciousWords, "possibly-too-basic"),
      possiblySpecialized: categoryCount(suspiciousWords, "possibly-specialized"),
      typingSuitability: categoryCount(suspiciousWords, "typing-suitability"),
    },
    wordFamilyGroups: familyGroups.length,
    outputFiles: [
      `${REPORT_DIR}/word-master-audit.json`,
      `${REPORT_DIR}/word-master-audit.csv`,
      `${REPORT_DIR}/suspicious-words.csv`,
      `${REPORT_DIR}/word-families.csv`,
      `${REPORT_DIR}/level-samples.csv`,
      `${REPORT_DIR}/level-boundaries.csv`,
    ],
    notes: [
      "This audit is heuristic and intended for human review only.",
      "No words are removed or modified by this script.",
      "Japanese WordNet and Japanese translations are not used in this audit.",
    ],
  };

  writeJson(`${REPORT_DIR}/word-master-audit.json`, {
    summary,
    suspiciousWords: suspiciousWords.map((entry) => ({
      word: entry.word,
      level: entry.level,
      sources: entry.sources,
      categories: entry.categories,
      reasons: entry.reasons,
    })),
    wordFamilies: familyGroups,
    levelSamples,
    levelBoundaries,
  });
  writeCsv(`${REPORT_DIR}/word-master-audit.csv`, rowsForAllWords(wordMaster, suspiciousWords), [
    "word",
    "level",
    "sources",
    "suspiciousCategories",
    "suspiciousReasons",
  ]);
  writeCsv(
    `${REPORT_DIR}/suspicious-words.csv`,
    suspiciousWords.map((entry) => ({
      word: entry.word,
      level: entry.level,
      sources: sourcesToString(entry.sources),
      categories: entry.categories.join("|"),
      reasons: entry.reasons.join(" / "),
    })),
    ["word", "level", "sources", "categories", "reasons"],
  );
  writeCsv(
    `${REPORT_DIR}/word-families.csv`,
    familyGroups.map((family) => ({
      base: family.base,
      size: family.size,
      levels: family.levels.join("|"),
      words: family.words.join("|"),
    })),
    ["base", "size", "levels", "words"],
  );
  writeCsv(`${REPORT_DIR}/level-samples.csv`, levelSamples, [
    "sampleSet",
    "sampleIndex",
    "word",
    "level",
    "sources",
  ]);
  writeCsv(`${REPORT_DIR}/level-boundaries.csv`, levelBoundaries, [
    "boundary",
    "boundaryIndex",
    "word",
    "level",
    "sources",
  ]);

  console.log("Word Master Audit");
  console.log("-----------------");
  console.log(`Total words: ${summary.totalWords}`);
  console.log(`Level 1: ${summary.levelCounts[1]}`);
  console.log(`Level 2: ${summary.levelCounts[2]}`);
  console.log(`Level 3: ${summary.levelCounts[3]}`);
  console.log("");
  console.log(`Potential proper nouns: ${summary.suspiciousCounts.potentialProperNouns}`);
  console.log(`Potential abbreviations: ${summary.suspiciousCounts.potentialAbbreviations}`);
  console.log(`Potential inflections: ${summary.suspiciousCounts.potentialInflections}`);
  console.log(`Potential plurals: ${summary.suspiciousCounts.potentialPlurals}`);
  console.log(`Word-family groups: ${summary.wordFamilyGroups}`);
  console.log(`Very short words: ${summary.suspiciousCounts.veryShortWords}`);
  console.log(`Very long words: ${summary.suspiciousCounts.veryLongWords}`);
  console.log("");
  console.log("Audit files generated:");
  for (const file of summary.outputFiles) {
    console.log(`- ${file}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
