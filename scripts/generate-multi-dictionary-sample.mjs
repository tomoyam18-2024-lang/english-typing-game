import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";

const DEFAULT_OPTIONS = {
  wordnetSample: "reports/wordnet-sample.json",
  wiktionary: "data/wiktionary/kaikki-jawiktionary-english.jsonl",
  outJson: "reports/multi-dictionary-sample.json",
  outReviewCsv: "reports/multi-dictionary-review.csv",
  outComparisonCsv: "reports/multi-dictionary-comparison.csv",
};

const MAX_PRIMARY_MEANINGS = 3;

const REVIEW_CATEGORIES = [
  "AMBIGUOUS_PRIMARY_SENSE",
  "UNNATURAL_JAPANESE",
  "MISSING_JAPANESE",
  "DICTIONARY_DISAGREEMENT",
  "LOW_CONFIDENCE",
  "TOO_MANY_SENSES",
  "OTHER",
];

const POS_MAP = {
  n: "noun",
  noun: "noun",
  "名詞": "noun",
  v: "verb",
  verb: "verb",
  "動詞": "verb",
  a: "adjective",
  s: "adjective",
  adj: "adjective",
  adjective: "adjective",
  "形容詞": "adjective",
  r: "adverb",
  adv: "adverb",
  adverb: "adverb",
  "副詞": "adverb",
  abbreviation: "abbreviation",
  abbrev: "abbreviation",
  "略語": "abbreviation",
  name: "proper noun",
  "固有名詞": "proper noun",
  phrase: "phrase",
  "成句": "phrase",
  preposition: "preposition",
  "前置詞": "preposition",
  conjunction: "conjunction",
  "接続詞": "conjunction",
  pronoun: "pronoun",
  "代名詞": "pronoun",
  interjection: "interjection",
  "間投詞": "interjection",
};

const MINOR_SIGNAL_PATTERN =
  /obsolete|archaic|dated|rare|slang|vulgar|offensive|euphemistic|dialect|historical|poetic|古語|廃語|旧式|俗語|卑語|方言|詩的|まれ|稀|歴史|性行為|専門|法律|医学|化学|数学|生物|文法/i;

function printHelp() {
  console.log(`Usage:
  node scripts/generate-multi-dictionary-sample.mjs [options]

Options:
  --wordnet-sample <path>  Existing Japanese WordNet 50-word sample JSON.
                           Default: ${DEFAULT_OPTIONS.wordnetSample}
  --wiktionary <path>      Japanese Wiktionary English JSONL or JSONL.GZ file.
                           Default: ${DEFAULT_OPTIONS.wiktionary}
  --out-json <path>        Detailed JSON report path.
                           Default: ${DEFAULT_OPTIONS.outJson}
  --out-review-csv <path>  Multi-dictionary review CSV path.
                           Default: ${DEFAULT_OPTIONS.outReviewCsv}
  --out-comparison-csv <path>
                           WordNet-only vs multi-dictionary comparison CSV path.
                           Default: ${DEFAULT_OPTIONS.outComparisonCsv}
  --help                   Show this help.
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

    if (key === "wordnet-sample") {
      options.wordnetSample = value;
    } else if (key === "out-json") {
      options.outJson = value;
    } else if (key === "out-review-csv") {
      options.outReviewCsv = value;
    } else if (key === "out-comparison-csv") {
      options.outComparisonCsv = value;
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

function normalizeEnglishWord(word) {
  return String(word ?? "").trim().toLowerCase();
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

function normalizePos(pos, posTitle) {
  const raw = String(pos ?? "").trim();
  const title = String(posTitle ?? "").trim();
  return POS_MAP[raw] ?? POS_MAP[raw.toLowerCase()] ?? POS_MAP[title] ?? (raw || title || "unknown");
}

function isSentenceLikeJapanese(text) {
  return /[。．.]/.test(text) || /こと$|ため$|もの$|場合$|よう$/.test(normalizeJapaneseText(text));
}

function isUnnaturalDisplayDefinition(text) {
  const normalized = normalizeJapaneseText(text);

  return (
    !normalized ||
    /^[-ーｰ〜～]/.test(normalized) ||
    /[()（）{}[\]<>_=+*\\/@#%$^~`|]/.test(normalized) ||
    /[A-Za-z0-9]/.test(normalized) ||
    [...normalized].length >= 18 ||
    isSentenceLikeJapanese(normalized)
  );
}

function cleanGlossPart(part) {
  let text = String(part ?? "").normalize("NFKC").trim();

  text = text
    .replace(/^\([^)]+\)/, "")
    .replace(/^[("「『【［〔（]+/, "")
    .replace(/[)"」』】］〕）]+$/, "")
    .replace(/^[〜～]+[をがにへとでの]?/, "")
    .replace(/^[をがにへとでの]+/, "")
    .replace(/^[-ーｰ]+/, "")
    .replace(/[。．.]+$/g, "")
    .trim();

  text = text
    .replace(/すること$/u, "する")
    .replace(/であること$/u, "")
    .replace(/のこと$/u, "")
    .trim();

  return text;
}

function extractDisplayDefinitionsFromGlosses(glosses) {
  const terms = [];

  for (const gloss of glosses) {
    const normalized = String(gloss ?? "").normalize("NFKC").trim();
    const withoutExamples = normalized.split(/[。．.]/)[0] ?? normalized;
    const parentheticalPrefix = withoutExamples.match(/^[（(][^）)]+[）)](.+)$/u);
    const splitSource = parentheticalPrefix ? parentheticalPrefix[1].trim() : withoutExamples;
    const parts = splitSource.split(/、|，|,|;|；|／|\/|・|または|又は|あるいは/u);

    for (const part of parts) {
      const term = cleanGlossPart(part);

      if (!term || isUnnaturalDisplayDefinition(term)) {
        continue;
      }

      terms.push(term);
    }

    if (terms.length === 0) {
      const fallback = cleanGlossPart(withoutExamples);

      if (fallback && !isUnnaturalDisplayDefinition(fallback)) {
        terms.push(fallback);
      }
    }

    if (terms.length >= 2) {
      break;
    }
  }

  return uniqueNormalized(terms).slice(0, 2);
}

function hasMinorSignals(sense) {
  const signals = [
    ...(sense.tags ?? []),
    ...(sense.rawTags ?? []),
    ...(sense.topics ?? []),
    ...(sense.categories ?? []),
    ...(sense.glosses ?? []),
  ].join("|");

  return MINOR_SIGNAL_PATTERN.test(signals);
}

function openMaybeCompressed(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);

  if (existsSync(absolutePath)) {
    const stream = createReadStream(absolutePath);
    return filePath.endsWith(".gz") ? stream.pipe(zlib.createGunzip()) : stream;
  }

  const gzPath = `${absolutePath}.gz`;

  if (existsSync(gzPath)) {
    return createReadStream(gzPath).pipe(zlib.createGunzip());
  }

  throw new Error(
    `Japanese Wiktionary JSONL file not found. Place Kaikki/Wiktextract data at ${filePath} or ${filePath}.gz.`,
  );
}

async function loadWiktionaryEntries(filePath, targetWords) {
  const entriesByWord = new Map([...targetWords].map((word) => [word, []]));
  let lineCount = 0;
  let parseErrors = 0;
  let matchedEntries = 0;

  const input = readline.createInterface({
    input: openMaybeCompressed(filePath),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  for await (const line of input) {
    if (!line.trim()) {
      continue;
    }

    lineCount += 1;

    let entry;

    try {
      entry = JSON.parse(line);
    } catch {
      parseErrors += 1;
      continue;
    }

    const word = normalizeEnglishWord(entry.word);

    if (!targetWords.has(word)) {
      continue;
    }

    if (entry.lang_code && entry.lang_code !== "en") {
      continue;
    }

    if (entry.lang && entry.lang !== "英語" && entry.lang !== "English") {
      continue;
    }

    entriesByWord.get(word).push(entry);
    matchedEntries += 1;
  }

  return { entriesByWord, lineCount, parseErrors, matchedEntries };
}

function flattenWiktionarySenses(entries) {
  const senses = [];
  let senseOrder = 1;

  for (const entry of entries) {
    const pos = normalizePos(entry.pos, entry.pos_title);
    const entrySenses = Array.isArray(entry.senses) ? entry.senses : [];

    for (let index = 0; index < entrySenses.length; index += 1) {
      const sense = entrySenses[index];
      const glosses = uniqueNormalized([...(sense.glosses ?? []), ...(sense.raw_glosses ?? [])]);
      const rawTags = Array.isArray(sense.raw_tags) ? sense.raw_tags : [];
      const tags = Array.isArray(sense.tags) ? sense.tags : [];
      const topics = Array.isArray(sense.topics) ? sense.topics : [];
      const categories = Array.isArray(sense.categories) ? sense.categories.map((category) => category.name).filter(Boolean) : [];
      const displayDefinitions = extractDisplayDefinitionsFromGlosses(glosses);

      senses.push({
        id: sense.id ?? `${entry.word}-${entry.pos}-${index + 1}`,
        pos,
        rawPos: entry.pos ?? "",
        posTitle: entry.pos_title ?? "",
        senseOrder,
        entrySenseOrder: index + 1,
        glosses,
        displayDefinitions,
        tags,
        rawTags,
        topics,
        categories,
        minorSignal: hasMinorSignals({ tags, rawTags, topics, categories, glosses }),
      });
      senseOrder += 1;
    }
  }

  return senses;
}

function meaningLine(pos, definitions) {
  return `${pos}: ${definitions.join("・")}`;
}

function wordnetDisplayCandidates(wordEntry) {
  return (wordEntry.primaryMeaningCandidates ?? []).map((candidate) =>
    meaningLine(candidate.pos, candidate.definitions ?? []),
  );
}

function finalDisplayCandidates(candidates) {
  return candidates.map((candidate) => meaningLine(candidate.pos, candidate.definitions));
}

function textAtoms(text) {
  return normalizeJapaneseText(text)
    .replace(/[。、，,.・／/;；:：()（）「」『』【】\[\]{}"']/g, "|")
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && !["する", "いる", "ある", "こと", "もの"].includes(part));
}

function overlapStrength(wordnetDefinitions, wiktionarySense) {
  const wordnetTerms = wordnetDefinitions.map(normalizeJapaneseText).filter(Boolean);
  const wiktionaryTexts = [...(wiktionarySense.glosses ?? []), ...(wiktionarySense.displayDefinitions ?? [])]
    .map(normalizeJapaneseText)
    .filter(Boolean);

  for (const wordnetTerm of wordnetTerms) {
    for (const wiktionaryText of wiktionaryTexts) {
      if (wordnetTerm.length >= 2 && wiktionaryText.includes(wordnetTerm)) {
        return "strong";
      }
      if (wiktionaryText.length >= 2 && wordnetTerm.includes(wiktionaryText)) {
        return "strong";
      }
    }
  }

  const wordnetAtoms = new Set(wordnetTerms.flatMap(textAtoms));
  const wiktionaryAtoms = new Set(wiktionaryTexts.flatMap(textAtoms));
  const sharedAtoms = [...wordnetAtoms].filter((atom) => wiktionaryAtoms.has(atom));

  if (sharedAtoms.length > 0) {
    return "weak";
  }

  const wordnetChars = new Set(
    wordnetTerms.join("").replace(/[ぁ-んァ-ンーをがにへとでのはもや]|する|いる|ある|こと/g, "").split(""),
  );
  const wiktionaryChars = new Set(
    wiktionaryTexts.join("").replace(/[ぁ-んァ-ンーをがにへとでのはもや]|する|いる|ある|こと/g, "").split(""),
  );
  const sharedChars = [...wordnetChars].filter((char) => wiktionaryChars.has(char));

  return sharedChars.length >= 2 ? "weak" : "none";
}

function alignmentScore(wordnetCandidate, wiktionarySense) {
  const samePos = wordnetCandidate.pos === wiktionarySense.pos;
  const overlap = overlapStrength(wordnetCandidate.definitions ?? [], wiktionarySense);
  let score = 0;

  if (samePos) {
    score += 5;
  }

  if (overlap === "strong") {
    score += 6;
  } else if (overlap === "weak") {
    score += 2;
  }

  if (wiktionarySense.senseOrder === 1) {
    score += 2;
  } else if (wiktionarySense.senseOrder <= 3) {
    score += 1;
  }

  if (wiktionarySense.minorSignal) {
    score -= 2;
  }

  return {
    score,
    samePos,
    overlap,
    wiktionarySense,
  };
}

function findBestWiktionaryAlignment(wordnetCandidate, wiktionarySenses) {
  if (wiktionarySenses.length === 0) {
    return null;
  }

  return wiktionarySenses
    .map((sense) => alignmentScore(wordnetCandidate, sense))
    .sort((a, b) => b.score - a.score || a.wiktionarySense.senseOrder - b.wiktionarySense.senseOrder)[0];
}

function confidenceForAlignment(alignment, hasWiktionary, definitions) {
  if (alignment?.samePos && alignment.overlap === "strong" && alignment.score >= 10) {
    return {
      confidence: "high",
      reason: `WordNet and Wiktionary share POS and Japanese wording overlap; Wiktionary sense order ${alignment.wiktionarySense.senseOrder}.`,
    };
  }

  if (alignment?.samePos && (alignment.overlap === "weak" || alignment.wiktionarySense.senseOrder <= 3)) {
    return {
      confidence: "medium",
      reason: `WordNet and Wiktionary share POS; alignment is heuristic using sense order ${alignment.wiktionarySense.senseOrder}.`,
    };
  }

  if (!hasWiktionary && definitions.some((definition) => !isUnnaturalDisplayDefinition(definition))) {
    return {
      confidence: "medium",
      reason: "Only Japanese WordNet is available, but the selected lemma is concise enough for review.",
    };
  }

  return {
    confidence: "low",
    reason: hasWiktionary
      ? "Wiktionary is available, but this WordNet sense was not confidently aligned."
      : "Only Japanese WordNet is available and the display quality is uncertain.",
  };
}

function confidenceWeight(confidence) {
  return confidence === "high" ? 0 : confidence === "medium" ? 1 : 2;
}

function combineDefinitions(wordnetDefinitions, wiktionarySense, confidence) {
  const terms = [];
  const useWiktionaryFirst = wiktionarySense && confidence !== "low" && wiktionarySense.displayDefinitions.length > 0;

  if (useWiktionaryFirst) {
    terms.push(...wiktionarySense.displayDefinitions);
  }

  terms.push(...wordnetDefinitions.filter((definition) => !isUnnaturalDisplayDefinition(definition)));

  if (!useWiktionaryFirst && wiktionarySense?.displayDefinitions?.length > 0) {
    terms.push(...wiktionarySense.displayDefinitions);
  }

  return uniqueNormalized(terms).slice(0, 2);
}

function buildWordnetCandidatePool(wordEntry, wiktionarySenses) {
  const wordnetCandidates = wordEntry.primaryCandidateSenses?.length
    ? wordEntry.primaryCandidateSenses
    : wordEntry.primaryMeaningCandidates ?? [];
  const hasWiktionary = wiktionarySenses.some((sense) => sense.glosses.length > 0);

  return wordnetCandidates.map((candidate, index) => {
    const alignment = findBestWiktionaryAlignment(candidate, wiktionarySenses);
    const baseDefinitions = candidate.definitions ?? [];
    const { confidence, reason } = confidenceForAlignment(alignment, hasWiktionary, baseDefinitions);
    const wiktionarySense = confidence === "low" ? null : alignment?.wiktionarySense ?? null;
    const definitions = combineDefinitions(baseDefinitions, wiktionarySense, confidence);
    const sources = wiktionarySense ? ["japanese-wordnet", "ja-wiktionary"] : ["japanese-wordnet"];

    return {
      pos: candidate.pos,
      definitions: definitions.length > 0 ? definitions : baseDefinitions.slice(0, 2),
      sources,
      confidence,
      confidenceReason: reason,
      sourceType: "wordnet",
      synset: candidate.synset,
      wordnetSenseRank: candidate.senseRank ?? candidate.rank ?? Number.MAX_SAFE_INTEGER,
      wordnetScore: candidate.score ?? index + 1,
      wiktionarySenseOrder: wiktionarySense?.senseOrder ?? Number.MAX_SAFE_INTEGER,
      wiktionarySenseId: wiktionarySense?.id ?? "",
      alignment: alignment
        ? {
            samePos: alignment.samePos,
            overlap: alignment.overlap,
            score: alignment.score,
            wiktionarySenseOrder: alignment.wiktionarySense.senseOrder,
          }
        : null,
      rankReason: candidate.rankReason ?? "",
    };
  });
}

function buildWiktionaryOnlyCandidatePool(wordEntry, wiktionarySenses, alignedSenseIds) {
  const hasWordnetMeanings = (wordEntry.japaneseLemmaCount ?? 0) > 0;

  return wiktionarySenses
    .filter((sense) => !alignedSenseIds.has(sense.id))
    .filter((sense) => sense.displayDefinitions.length > 0)
    .slice(0, 6)
    .map((sense) => ({
      pos: sense.pos,
      definitions: sense.displayDefinitions.slice(0, 2),
      sources: ["ja-wiktionary"],
      confidence: hasWordnetMeanings ? "low" : "medium",
      confidenceReason: hasWordnetMeanings
        ? `Wiktionary sense order ${sense.senseOrder} was not confidently aligned to a Japanese WordNet synset.`
        : `Japanese WordNet had no Japanese lemma; Wiktionary sense order ${sense.senseOrder} provides the clearest local source.`,
      sourceType: "wiktionary",
      synset: "",
      wordnetSenseRank: Number.MAX_SAFE_INTEGER,
      wordnetScore: Number.MAX_SAFE_INTEGER,
      wiktionarySenseOrder: sense.senseOrder,
      wiktionarySenseId: sense.id,
      alignment: null,
      rankReason: "Wiktionary-only fallback; this remains a lower-confidence candidate.",
    }));
}

function candidateSortKey(candidate) {
  const sourceRank = candidate.sources.length > 1 ? 0 : candidate.sourceType === "wordnet" ? 1 : 2;
  return [
    confidenceWeight(candidate.confidence),
    sourceRank,
    candidate.wiktionarySenseOrder,
    candidate.wordnetSenseRank,
    candidate.wordnetScore,
    candidate.definitions.join("・"),
  ];
}

function compareCandidates(a, b) {
  const aKey = candidateSortKey(a);
  const bKey = candidateSortKey(b);

  for (let index = 0; index < aKey.length; index += 1) {
    const left = aKey[index];
    const right = bKey[index];

    if (typeof left === "number" && typeof right === "number") {
      if (left !== right) {
        return left - right;
      }
    } else {
      const result = String(left).localeCompare(String(right));

      if (result !== 0) {
        return result;
      }
    }
  }

  return 0;
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const seenFirstDefinitionByPos = new Set();
  const result = [];

  for (const candidate of candidates) {
    const key = `${candidate.pos}:${candidate.definitions.map(normalizeJapaneseText).sort().join("|")}`;
    const firstDefinitionKey = `${candidate.pos}:${normalizeJapaneseText(candidate.definitions[0] ?? "")}`;

    if (!candidate.definitions.length || seen.has(key)) {
      continue;
    }

    if (candidate.definitions.length > 1 && seenFirstDefinitionByPos.has(firstDefinitionKey)) {
      continue;
    }

    seen.add(key);
    seenFirstDefinitionByPos.add(firstDefinitionKey);
    result.push(candidate);
  }

  return result;
}

function selectFinalCandidates(pool) {
  const sorted = dedupeCandidates([...pool].sort(compareCandidates));
  const preferred = sorted.filter((candidate) => candidate.confidence !== "low");
  const selectionPool = preferred.length > 0 ? preferred : sorted.slice(0, 1);
  const selected = selectionPool.slice(0, MAX_PRIMARY_MEANINGS);

  if (selected.length >= MAX_PRIMARY_MEANINGS && new Set(selected.map((candidate) => candidate.pos)).size === 1) {
    const selectedKeys = new Set(selected.map((candidate) => candidate.wiktionarySenseId || candidate.synset));
    const selectedPos = selected[0].pos;
    const otherPosCandidate = selectionPool.find(
      (candidate) =>
        candidate.pos !== selectedPos &&
        confidenceWeight(candidate.confidence) <= 1 &&
        !selectedKeys.has(candidate.wiktionarySenseId || candidate.synset),
    );

    if (otherPosCandidate) {
      selected[MAX_PRIMARY_MEANINGS - 1] = otherPosCandidate;
      selected.sort(compareCandidates);
    }
  }

  return {
    finalCandidates: selected,
    viableCandidateCount: sorted.length,
    truncatedCandidateCount: Math.max(0, sorted.length - MAX_PRIMARY_MEANINGS),
  };
}

function evaluateWord(wordEntry, wiktionarySenses) {
  const wordnetPool = buildWordnetCandidatePool(wordEntry, wiktionarySenses);
  const alignedSenseIds = new Set(
    wordnetPool
      .filter((candidate) => candidate.sources.includes("ja-wiktionary") && candidate.wiktionarySenseId)
      .map((candidate) => candidate.wiktionarySenseId),
  );
  const wiktionaryPool = buildWiktionaryOnlyCandidatePool(wordEntry, wiktionarySenses, alignedSenseIds);
  const candidatePool = [...wordnetPool, ...wiktionaryPool];
  const { finalCandidates, viableCandidateCount, truncatedCandidateCount } = selectFinalCandidates(candidatePool);
  const reviewCategories = new Set();
  const reviewReasons = [];
  const wordnetCoverage = (wordEntry.japaneseLemmaCount ?? 0) > 0;
  const wiktionaryCoverage = wiktionarySenses.some((sense) => sense.glosses.length > 0);
  const bothSources = wordnetCoverage && wiktionaryCoverage;
  const bothSourceSelected = finalCandidates.some((candidate) => candidate.sources.length > 1);
  const lowConfidence = finalCandidates.some((candidate) => candidate.confidence === "low");
  const unnaturalMeanings = finalCandidates
    .flatMap((candidate) => candidate.definitions)
    .filter((definition) => isUnnaturalDisplayDefinition(definition));

  if (finalCandidates.length === 0 || (!wordnetCoverage && !wiktionaryCoverage)) {
    reviewCategories.add("MISSING_JAPANESE");
    reviewReasons.push("Neither dictionary provided a usable Japanese meaning for this sample word.");
  }

  if (lowConfidence) {
    reviewCategories.add("LOW_CONFIDENCE");
    reviewReasons.push("At least one selected primary meaning has low confidence.");
  }

  if (unnaturalMeanings.length > 0) {
    reviewCategories.add("UNNATURAL_JAPANESE");
    reviewReasons.push(`Selected display text may be unnatural: ${unnaturalMeanings.join(" / ")}.`);
  }

  if (bothSources && !bothSourceSelected) {
    reviewCategories.add("DICTIONARY_DISAGREEMENT");
    reviewReasons.push("Both dictionaries had data, but no selected candidate was supported by both sources.");
  }

  if (
    truncatedCandidateCount > 0 &&
    (finalCandidates.some((candidate) => candidate.confidence !== "high") || !bothSourceSelected)
  ) {
    reviewCategories.add("AMBIGUOUS_PRIMARY_SENSE");
    reviewReasons.push(
      `${viableCandidateCount} candidate meanings remained after dictionary merge, so top-3 selection is heuristic.`,
    );
  }

  if ((wordEntry.numberOfSynsets ?? 0) >= 10 || wiktionarySenses.length >= 10) {
    if (reviewCategories.size > 0 || truncatedCandidateCount > 0) {
      reviewCategories.add("TOO_MANY_SENSES");
      reviewReasons.push(
        `High sense count: WordNet synsets ${wordEntry.numberOfSynsets ?? 0}, Wiktionary senses ${wiktionarySenses.length}.`,
      );
    }
  }

  if (candidatePool.length === 0 && finalCandidates.length === 0 && reviewCategories.size === 0) {
    reviewCategories.add("OTHER");
    reviewReasons.push("No candidate pool was generated despite input data being present.");
  }

  return {
    candidatePool,
    finalCandidates,
    viableCandidateCount,
    truncatedCandidateCount,
    reviewRequired: reviewCategories.size > 0,
    reviewCategories: [...reviewCategories],
    reviewReasons,
  };
}

function summarizeWiktionaryMeanings(senses) {
  return senses.map((sense) => ({
    pos: sense.pos,
    senseOrder: sense.senseOrder,
    glosses: sense.glosses,
    displayDefinitions: sense.displayDefinitions,
    tags: [...sense.tags, ...sense.rawTags],
    topics: sense.topics,
  }));
}

function sourceList(candidates) {
  return [...new Set(candidates.flatMap((candidate) => candidate.sources))].sort();
}

function confidenceList(candidates) {
  return candidates.map((candidate) => candidate.confidence);
}

function comparisonReason(wordEntry, evaluation, wordnetOnly, finalMeanings) {
  const changed = JSON.stringify(wordnetOnly) !== JSON.stringify(finalMeanings);
  const hasWiktionarySupport = evaluation.finalCandidates.some((candidate) => candidate.sources.includes("ja-wiktionary"));

  if (!changed && hasWiktionarySupport) {
    return "Display text is unchanged, but Wiktionary supports at least one selected meaning.";
  }

  if (!changed) {
    return "No display change; Wiktionary did not provide a stronger aligned display candidate.";
  }

  if (hasWiktionarySupport) {
    return "Wiktionary POS/sense-order/gloss data changed or supported the final primary selection.";
  }

  if ((wordEntry.japaneseLemmaCount ?? 0) === 0) {
    return "Japanese WordNet had no Japanese lemma; fallback behavior changed the candidate set.";
  }

  return "Candidate order changed after multi-dictionary confidence scoring.";
}

function countConfidenceRows(words, confidence) {
  return words.reduce(
    (total, word) => total + word.finalPrimaryMeanings.filter((candidate) => candidate.confidence === confidence).length,
    0,
  );
}

function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}

function printSummary(summary) {
  console.log("Multi-dictionary sample evaluation");
  console.log("----------------------------------");
  console.log("");
  console.log(`Sample words: ${summary.sampleWords}`);
  console.log("");
  console.log(`Japanese WordNet coverage: ${summary.japaneseWordNetCoverage}`);
  console.log(`Wiktionary coverage: ${summary.wiktionaryCoverage}`);
  console.log(`Both sources available: ${summary.bothSourcesAvailable}`);
  console.log(`Neither source available: ${summary.neitherSourceAvailable}`);
  console.log("");
  console.log(`Good without review: ${summary.goodWithoutReview}`);
  console.log(`Review required: ${summary.reviewRequired}`);
  console.log(`Auto-usable candidate ratio: ${formatPercent(summary.autoUsableCandidateRatio)}`);
  console.log("");
  console.log(`HIGH confidence: ${summary.highConfidence}`);
  console.log(`MEDIUM confidence: ${summary.mediumConfidence}`);
  console.log(`LOW confidence: ${summary.lowConfidence}`);
  console.log("");
  console.log("Review breakdown:");

  for (const category of REVIEW_CATEGORIES) {
    console.log(`${category}: ${summary.reviewBreakdown[category]}`);
  }
  console.log("");
  console.log("Audit files generated:");
  console.log(`- ${summary.outputJson}`);
  console.log(`- ${summary.outputReviewCsv}`);
  console.log(`- ${summary.outputComparisonCsv}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const wordnetSample = readJson(options.wordnetSample);
  const wordEntries = wordnetSample.words ?? [];

  if (wordEntries.length === 0) {
    throw new Error(`No words found in ${options.wordnetSample}. Run pnpm word:wordnet-sample first.`);
  }

  const targetWords = new Set(wordEntries.map((entry) => normalizeEnglishWord(entry.word)));
  const wiktionaryLoad = await loadWiktionaryEntries(options.wiktionary, targetWords);
  const reportWords = [];
  const reviewRows = [];
  const comparisonRows = [];
  const reviewBreakdown = Object.fromEntries(REVIEW_CATEGORIES.map((category) => [category, 0]));

  for (const wordEntry of wordEntries) {
    const normalizedWord = normalizeEnglishWord(wordEntry.word);
    const wiktionaryEntries = wiktionaryLoad.entriesByWord.get(normalizedWord) ?? [];
    const wiktionarySenses = flattenWiktionarySenses(wiktionaryEntries);
    const evaluation = evaluateWord(wordEntry, wiktionarySenses);
    const wordnetOnlyPrimary = wordnetDisplayCandidates(wordEntry);
    const finalPrimary = finalDisplayCandidates(evaluation.finalCandidates);

    for (const category of evaluation.reviewCategories) {
      reviewBreakdown[category] += 1;
    }

    const reportWord = {
      word: wordEntry.word,
      level: wordEntry.level,
      wordnetCoverage: (wordEntry.japaneseLemmaCount ?? 0) > 0,
      wiktionaryCoverage: wiktionarySenses.some((sense) => sense.glosses.length > 0),
      wordnetPrimaryMeanings: wordnetOnlyPrimary,
      wiktionaryEntries: wiktionaryEntries.map((entry) => ({
        word: entry.word,
        lang: entry.lang,
        lang_code: entry.lang_code,
        pos: normalizePos(entry.pos, entry.pos_title),
        rawPos: entry.pos,
        posTitle: entry.pos_title,
        senseCount: Array.isArray(entry.senses) ? entry.senses.length : 0,
      })),
      wiktionaryMeanings: summarizeWiktionaryMeanings(wiktionarySenses),
      finalPrimaryMeanings: evaluation.finalCandidates.map((candidate, index) => ({
        pos: candidate.pos,
        definitions: candidate.definitions,
        sources: candidate.sources,
        confidence: candidate.confidence,
        confidenceReason: candidate.confidenceReason,
        primaryRank: index + 1,
        synset: candidate.synset,
        wiktionarySenseId: candidate.wiktionarySenseId,
      })),
      candidatePool: evaluation.candidatePool.map((candidate) => ({
        pos: candidate.pos,
        definitions: candidate.definitions,
        sources: candidate.sources,
        confidence: candidate.confidence,
        confidenceReason: candidate.confidenceReason,
        sourceType: candidate.sourceType,
        synset: candidate.synset,
        wiktionarySenseOrder: candidate.wiktionarySenseOrder,
        wiktionarySenseId: candidate.wiktionarySenseId,
        alignment: candidate.alignment,
        rankReason: candidate.rankReason,
      })),
      viableCandidateCount: evaluation.viableCandidateCount,
      truncatedCandidateCount: evaluation.truncatedCandidateCount,
      reviewRequired: evaluation.reviewRequired,
      reviewCategories: evaluation.reviewCategories,
      reviewReasons: evaluation.reviewReasons,
    };

    reportWords.push(reportWord);

    reviewRows.push({
      word: wordEntry.word,
      level: wordEntry.level,
      wordnetPrimary: wordnetOnlyPrimary,
      wiktionaryMeanings: summarizeWiktionaryMeanings(wiktionarySenses),
      finalPrimaryMeanings: reportWord.finalPrimaryMeanings,
      sources: sourceList(evaluation.finalCandidates),
      confidence: confidenceList(evaluation.finalCandidates),
      reviewRequired: evaluation.reviewRequired,
      reviewReasons: evaluation.reviewCategories,
    });

    comparisonRows.push({
      word: wordEntry.word,
      "WordNet-only primary meanings": wordnetOnlyPrimary,
      "WordNet + Wiktionary primary meanings": finalPrimary,
      changed: JSON.stringify(wordnetOnlyPrimary) !== JSON.stringify(finalPrimary),
      reason: comparisonReason(wordEntry, evaluation, wordnetOnlyPrimary, finalPrimary),
    });
  }

  const summary = {
    sampleWords: reportWords.length,
    japaneseWordNetCoverage: reportWords.filter((word) => word.wordnetCoverage).length,
    wiktionaryCoverage: reportWords.filter((word) => word.wiktionaryCoverage).length,
    bothSourcesAvailable: reportWords.filter((word) => word.wordnetCoverage && word.wiktionaryCoverage).length,
    neitherSourceAvailable: reportWords.filter((word) => !word.wordnetCoverage && !word.wiktionaryCoverage).length,
    goodWithoutReview: reportWords.filter((word) => !word.reviewRequired).length,
    reviewRequired: reportWords.filter((word) => word.reviewRequired).length,
    autoUsableCandidateRatio:
      reportWords.length === 0
        ? 0
        : (reportWords.filter((word) => !word.reviewRequired).length / reportWords.length) * 100,
    highConfidence: countConfidenceRows(reportWords, "high"),
    mediumConfidence: countConfidenceRows(reportWords, "medium"),
    lowConfidence: countConfidenceRows(reportWords, "low"),
    reviewBreakdown,
    wiktionaryInput: {
      path: options.wiktionary,
      lineCount: wiktionaryLoad.lineCount,
      parseErrors: wiktionaryLoad.parseErrors,
      matchedEntries: wiktionaryLoad.matchedEntries,
    },
    previousBaseline: {
      goodWithoutReview: 16,
      reviewRequired: 34,
      autoUsableCandidateRatio: 32.0,
    },
  };

  writeFile(
    options.outJson,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        wordnetSamplePath: options.wordnetSample,
        wiktionaryPath: options.wiktionary,
        note:
          "This report keeps Japanese WordNet raw synsets/lemmas intact and uses Japanese Wiktionary/Kaikki glosses only as a second-source ranking signal for the same 50-word sample. It does not write game data.",
        primaryMeaningPolicy:
          "Primary meanings are selected as at most three sense-level display rows. Confidence is heuristic: high requires clear POS and Japanese wording support from both sources; medium means one source is clear or cross-source alignment is plausible; low means one-source or weak alignment requiring review.",
        summary,
        words: reportWords,
      },
      null,
      2,
    ),
  );

  writeCsv(options.outReviewCsv, reviewRows, [
    "word",
    "level",
    "wordnetPrimary",
    "wiktionaryMeanings",
    "finalPrimaryMeanings",
    "sources",
    "confidence",
    "reviewRequired",
    "reviewReasons",
  ]);

  writeCsv(options.outComparisonCsv, comparisonRows, [
    "word",
    "WordNet-only primary meanings",
    "WordNet + Wiktionary primary meanings",
    "changed",
    "reason",
  ]);

  printSummary({
    ...summary,
    outputJson: options.outJson,
    outputReviewCsv: options.outReviewCsv,
    outputComparisonCsv: options.outComparisonCsv,
  });
}

export {
  REVIEW_CATEGORIES,
  evaluateWord,
  finalDisplayCandidates,
  flattenWiktionarySenses,
  loadWiktionaryEntries,
  normalizeEnglishWord,
  summarizeWiktionaryMeanings,
  wordnetDisplayCandidates,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
