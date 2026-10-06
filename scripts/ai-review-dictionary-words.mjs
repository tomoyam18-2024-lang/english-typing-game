import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_OPTIONS = {
  dictionary: "src/data/generated/wordDictionary.json",
  autoAcceptCsv: "reports/review-auto-accept.csv",
  needsReviewCsv: "reports/review-needs-human.csv",
  missingDataCsv: "reports/review-missing-data.csv",
  outReviewInput: "reports/ai-review-input.json",
  outReviewedJson: "reports/ai-reviewed-words.json",
  outReviewedCsv: "reports/ai-reviewed-words.csv",
  outHumanReviewCsv: "reports/human-review-final.csv",
  outStatusDictionary: "src/data/generated/wordDictionaryReviewStatus.json",
};

const REVIEW_DECISIONS = ["KEEP_CURRENT", "RESELECT_FROM_EXISTING", "NEEDS_HUMAN"];
const CONFIDENCES = ["high", "medium", "low"];

function printHelp() {
  console.log(`Usage:
  node scripts/ai-review-dictionary-words.mjs [options]

Options:
  --dictionary <path>             Generated word dictionary JSON.
                                  Default: ${DEFAULT_OPTIONS.dictionary}
  --auto-accept-csv <path>        AUTO_ACCEPT triage CSV path.
                                  Default: ${DEFAULT_OPTIONS.autoAcceptCsv}
  --needs-review-csv <path>       NEEDS_REVIEW triage CSV path.
                                  Default: ${DEFAULT_OPTIONS.needsReviewCsv}
  --missing-data-csv <path>       MISSING_DATA triage CSV path.
                                  Default: ${DEFAULT_OPTIONS.missingDataCsv}
  --out-review-input <path>       AI-assisted review input JSON path.
                                  Default: ${DEFAULT_OPTIONS.outReviewInput}
  --out-reviewed-json <path>      AI-assisted review output JSON path.
                                  Default: ${DEFAULT_OPTIONS.outReviewedJson}
  --out-reviewed-csv <path>       AI-assisted review output CSV path.
                                  Default: ${DEFAULT_OPTIONS.outReviewedCsv}
  --out-human-review-csv <path>   Remaining human-review CSV path.
                                  Default: ${DEFAULT_OPTIONS.outHumanReviewCsv}
  --out-status-dictionary <path>  Review-status dictionary JSON path.
                                  Default: ${DEFAULT_OPTIONS.outStatusDictionary}
  --help                          Show this help.
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

    const optionKey = {
      "--dictionary": "dictionary",
      "--auto-accept-csv": "autoAcceptCsv",
      "--needs-review-csv": "needsReviewCsv",
      "--missing-data-csv": "missingDataCsv",
      "--out-review-input": "outReviewInput",
      "--out-reviewed-json": "outReviewedJson",
      "--out-reviewed-csv": "outReviewedCsv",
      "--out-human-review-csv": "outHumanReviewCsv",
      "--out-status-dictionary": "outStatusDictionary",
    }[arg];

    if (!optionKey) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options[optionKey] = value;
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

function readWordColumn(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const lines = readFileSync(absolutePath, "utf8").split(/\r?\n/).filter(Boolean);
  const [, ...rows] = lines;

  return new Set(rows.map((line) => line.split(",", 1)[0]).filter(Boolean));
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

function isSentenceLikeJapanese(text) {
  return /[。．.]/.test(text) || /こと$|ため$|もの$|場合$|よう$/.test(normalizeJapaneseText(text));
}

function isUnsafeDisplayText(text) {
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

function isMinorSignal(value) {
  return /obsolete|archaic|dated|rare|slang|vulgar|offensive|dialect|historical|poetic|figuratively|古語|廃語|旧式|俗語|卑語|方言|詩的|まれ|稀|歴史|性行為|植物|数学|文法|法律|医学|化学|生物|単位|記号|文字|略語/i.test(
    String(value ?? ""),
  );
}

function meaningText(meaning) {
  return `${meaning.pos}: ${meaning.definitions.join("・")}`;
}

function formatPrimaryMeanings(meanings) {
  return meanings.map(meaningText).join(" / ");
}

function primaryMeaningsEqual(left, right) {
  return JSON.stringify(
    left.map((meaning) => ({
      pos: meaning.pos,
      definitions: meaning.definitions.map(normalizeJapaneseText),
    })),
  ) ===
    JSON.stringify(
      right.map((meaning) => ({
        pos: meaning.pos,
        definitions: meaning.definitions.map(normalizeJapaneseText),
      })),
    );
}

function hasDuplicatePrimaryMeanings(meanings) {
  const keys = new Set();
  const firstKeys = new Set();

  for (const meaning of meanings) {
    const key = `${meaning.pos}:${meaning.definitions.map(normalizeJapaneseText).sort().join("|")}`;
    const firstKey = `${meaning.pos}:${normalizeJapaneseText(meaning.definitions[0] ?? "")}`;

    if (keys.has(key) || (meaning.definitions.length > 1 && firstKeys.has(firstKey))) {
      return true;
    }

    keys.add(key);
    firstKeys.add(firstKey);
  }

  return false;
}

function isSafePrimarySet(meanings) {
  return (
    meanings.length >= 1 &&
    meanings.length <= 3 &&
    meanings.every(
      (meaning) =>
        meaning.confidence !== "low" &&
        meaning.definitions.length > 0 &&
        meaning.definitions.every((definition) => !isUnsafeDisplayText(definition)),
    ) &&
    !hasDuplicatePrimaryMeanings(meanings)
  );
}

function overlapStrength(definitions, texts) {
  const definitionTerms = definitions.map(normalizeJapaneseText).filter(Boolean);
  const textTerms = texts.map(normalizeJapaneseText).filter(Boolean);

  for (const definition of definitionTerms) {
    for (const text of textTerms) {
      if (definition.length >= 2 && text.includes(definition)) {
        return "strong";
      }
      if (text.length >= 2 && definition.includes(text)) {
        return "strong";
      }
    }
  }

  const definitionChars = new Set(definitionTerms.join("").replace(/[ぁ-んァ-ンーをがにへとでのはもや]|する/g, ""));
  const textChars = new Set(textTerms.join("").replace(/[ぁ-んァ-ンーをがにへとでのはもや]|する/g, ""));
  const shared = [...definitionChars].filter((character) => textChars.has(character));

  return shared.length >= 2 ? "weak" : "none";
}

function findWiktionarySense(entry, senseId) {
  if (!senseId) {
    return null;
  }

  return entry.wiktionary.senses.find((sense) => sense.id === senseId) ?? null;
}

function currentHasTopDictionarySupport(entry) {
  const firstPrimary = entry.primaryMeanings[0];

  if (!firstPrimary) {
    return false;
  }

  const sourceSense = findWiktionarySense(entry, firstPrimary.sourceRefs?.wiktionarySenseId);

  if (sourceSense?.senseOrder <= 2) {
    return true;
  }

  const topWiktionary = entry.wiktionary.senses.find((sense) => sense.displayDefinitions?.length > 0);

  if (!topWiktionary) {
    return firstPrimary.sources.includes("japanese-wordnet");
  }

  return (
    firstPrimary.pos === topWiktionary.pos &&
    overlapStrength(firstPrimary.definitions, [...topWiktionary.displayDefinitions, ...topWiktionary.glosses]) !== "none"
  );
}

function currentOverlapsTopWiktionary(entry, maxSenseOrder = 3) {
  const topSenses = entry.wiktionary.senses.filter(
    (sense) => sense.senseOrder <= maxSenseOrder && sense.displayDefinitions?.length > 0,
  );

  return entry.primaryMeanings.some((meaning) =>
    topSenses.some(
      (sense) =>
        meaning.pos === sense.pos &&
        overlapStrength(meaning.definitions, [...sense.displayDefinitions, ...sense.glosses]) !== "none",
    ),
  );
}

function definitionQualityScore(definition) {
  const normalized = normalizeJapaneseText(definition);
  let score = 0;

  if (isUnsafeDisplayText(definition)) {
    score += 100;
  }

  const length = [...normalized].length;

  if (length <= 1) {
    score += 30;
  } else if (length > 8) {
    score += (length - 8) * 5;
  }

  if (/^[御お]/.test(normalized)) {
    score += 8;
  }

  if (/[をにへがの]/.test(normalized)) {
    score += 4;
  }

  if (/^[ァ-ヶー]+$/.test(normalized) && length >= 4) {
    score += 4;
  }

  if (/[\u3400-\u9fff]/.test(normalized)) {
    score -= 4;
  }

  return score;
}

function selectDefinitions(definitions, maxCount = 2) {
  return uniqueNormalized(definitions)
    .filter((definition) => !isUnsafeDisplayText(definition))
    .sort(
      (a, b) =>
        definitionQualityScore(a) - definitionQualityScore(b) ||
        [...a].length - [...b].length ||
        a.localeCompare(b),
    )
    .slice(0, maxCount);
}

function candidateKey(candidate) {
  return `${candidate.pos}:${candidate.definitions.map(normalizeJapaneseText).sort().join("|")}`;
}

function currentPrimaryCandidates(entry) {
  return entry.primaryMeanings.map((meaning, index) => ({
    pos: meaning.pos,
    definitions: meaning.definitions,
    sources: meaning.sources,
    confidence: meaning.confidence,
    score:
      (meaning.confidence === "high" ? 20 : 45) +
      index * 5 +
      (meaning.sources.includes("japanese-wordnet") && meaning.sources.includes("ja-wiktionary") ? -10 : 0),
    reason: "Current primary meaning retained because it is already dictionary-grounded.",
    sourceRefs: meaning.sourceRefs,
  }));
}

function wiktionaryCandidates(entry) {
  return entry.wiktionary.senses
    .filter((sense) => sense.displayDefinitions?.length > 0)
    .map((sense) => {
      const minorPenalty = [...(sense.tags ?? []), ...(sense.topics ?? [])].some(isMinorSignal) ? 35 : 0;
      const definitions = selectDefinitions(sense.displayDefinitions);

      return {
        pos: sense.pos,
        definitions,
        sources: ["ja-wiktionary"],
        confidence: "medium",
        score: sense.senseOrder * 12 + minorPenalty + definitions.reduce((total, definition) => total + definitionQualityScore(definition), 0),
        reason: `Selected from Japanese Wiktionary sense order ${sense.senseOrder}; no new translation was generated.`,
        sourceRefs: {
          synset: null,
          wiktionarySenseId: sense.id ?? null,
        },
      };
    })
    .filter((candidate) => candidate.definitions.length > 0);
}

function wordnetCandidates(entry) {
  return entry.japaneseWordNet.senses
    .filter((sense) => sense.japaneseLemmas?.length > 0)
    .map((sense) => {
      const definitions = selectDefinitions(sense.japaneseLemmas);

      return {
        pos: sense.pos,
        definitions,
        sources: ["japanese-wordnet"],
        confidence: "medium",
        score:
          65 +
          (Number.isFinite(sense.rank) ? sense.rank * 8 : 20) -
          (Number.isFinite(sense.freq) ? Math.min(sense.freq, 20) * 2 : 0) +
          definitions.reduce((total, definition) => total + definitionQualityScore(definition), 0),
        reason: `Selected from Japanese WordNet synset ${sense.synset}; Japanese lemma exists in the raw dictionary data.`,
        sourceRefs: {
          synset: sense.synset,
          wiktionarySenseId: null,
        },
      };
    })
    .filter((candidate) => candidate.definitions.length > 0);
}

function combinedCandidates(entry) {
  const candidates = [];

  for (const wnSense of entry.japaneseWordNet.senses.filter((sense) => sense.japaneseLemmas?.length > 0)) {
    for (const wiktSense of entry.wiktionary.senses.filter((sense) => sense.displayDefinitions?.length > 0)) {
      if (wnSense.pos !== wiktSense.pos) {
        continue;
      }

      const overlap = overlapStrength(wnSense.japaneseLemmas, [...wiktSense.displayDefinitions, ...wiktSense.glosses]);

      if (overlap === "none") {
        continue;
      }

      const definitions = selectDefinitions([...wiktSense.displayDefinitions, ...wnSense.japaneseLemmas]);

      if (definitions.length === 0) {
        continue;
      }

      const minorPenalty = [...(wiktSense.tags ?? []), ...(wiktSense.topics ?? [])].some(isMinorSignal) ? 30 : 0;

      candidates.push({
        pos: wnSense.pos,
        definitions,
        sources: ["japanese-wordnet", "ja-wiktionary"],
        confidence: overlap === "strong" ? "high" : "medium",
        score:
          (overlap === "strong" ? 0 : 25) +
          wiktSense.senseOrder * 8 -
          (Number.isFinite(wnSense.freq) ? Math.min(wnSense.freq, 20) * 2 : 0) +
          minorPenalty +
          definitions.reduce((total, definition) => total + definitionQualityScore(definition), 0),
        reason: `Selected because Japanese WordNet synset ${wnSense.synset} and Wiktionary sense order ${wiktSense.senseOrder} share POS and Japanese wording.`,
        sourceRefs: {
          synset: wnSense.synset,
          wiktionarySenseId: wiktSense.id ?? null,
        },
      });
    }
  }

  return candidates;
}

function selectCandidateSet(candidates) {
  const deduped = [];
  const seen = new Set();
  const firstDefinitionSeen = new Set();

  for (const candidate of candidates.sort((a, b) => a.score - b.score || candidateKey(a).localeCompare(candidateKey(b)))) {
    const key = candidateKey(candidate);
    const firstKey = `${candidate.pos}:${normalizeJapaneseText(candidate.definitions[0] ?? "")}`;

    if (seen.has(key) || firstDefinitionSeen.has(firstKey)) {
      continue;
    }

    seen.add(key);
    firstDefinitionSeen.add(firstKey);
    deduped.push(candidate);
  }

  const selected = [];

  if (deduped[0]) {
    selected.push(deduped[0]);
  }

  for (const candidate of deduped) {
    if (selected.length >= 3) {
      break;
    }

    if (selected.some((selectedCandidate) => selectedCandidate.pos === candidate.pos)) {
      continue;
    }

    selected.push(candidate);
  }

  for (const candidate of deduped) {
    if (selected.length >= 3) {
      break;
    }

    if (!selected.includes(candidate)) {
      selected.push(candidate);
    }
  }

  return selected.map((candidate) => ({
    pos: candidate.pos,
    definitions: candidate.definitions,
    sources: candidate.sources,
    confidence: candidate.confidence,
    reason: candidate.reason,
    sourceRefs: candidate.sourceRefs,
  }));
}

function buildSuggestedPrimaryMeanings(entry) {
  return selectCandidateSet([...wiktionaryCandidates(entry), ...currentPrimaryCandidates(entry)]);
}

function exactWiktionaryDefinitionsForMeaning(entry, meaning, maxSenseOrder = 2) {
  const currentDefinitionKeys = new Set(meaning.definitions.map(normalizeJapaneseText));
  const exactDefinitions = entry.wiktionary.senses
    .filter((sense) => sense.pos === meaning.pos && sense.senseOrder <= maxSenseOrder)
    .flatMap((sense) => sense.displayDefinitions ?? [])
    .filter((definition) => currentDefinitionKeys.has(normalizeJapaneseText(definition)));

  return uniqueNormalized(exactDefinitions);
}

function cleanCurrentPrimaryMeanings(entry) {
  let changed = false;

  const cleaned = entry.primaryMeanings.map((meaning) => {
    const exactWiktionaryDefinitions = exactWiktionaryDefinitionsForMeaning(entry, meaning);

    if (exactWiktionaryDefinitions.length === 0 || exactWiktionaryDefinitions.length >= meaning.definitions.length) {
      return {
        pos: meaning.pos,
        definitions: meaning.definitions,
        sources: meaning.sources,
        confidence: meaning.confidence,
        reason: "Current primary meaning retained.",
        sourceRefs: meaning.sourceRefs,
      };
    }

    changed = true;

    return {
      pos: meaning.pos,
      definitions: exactWiktionaryDefinitions,
      sources: meaning.sources.includes("ja-wiktionary") ? meaning.sources : [...meaning.sources, "ja-wiktionary"],
      confidence: meaning.confidence,
      reason:
        "Removed lower-priority current synonym(s) and kept only Japanese expression(s) explicitly present in Japanese Wiktionary.",
      sourceRefs: meaning.sourceRefs,
    };
  });

  return { cleaned, changed };
}

function aiReview(entry) {
  if (entry.primaryMeanings.length === 0 || entry.reviewReasons.includes("MISSING_JAPANESE")) {
    return {
      aiDecision: "NEEDS_HUMAN",
      reviewConfidence: "low",
      decisionReason: "No usable primary meaning exists in the current dictionary data.",
      beforePrimaryMeanings: entry.primaryMeanings,
      afterPrimaryMeanings: [],
    };
  }

  if (
    entry.wordConfidence === "low" ||
    entry.reviewReasons.includes("LOW_CONFIDENCE") ||
    entry.reviewReasons.includes("UNNATURAL_JAPANESE") ||
    entry.reviewReasons.includes("DICTIONARY_DISAGREEMENT") ||
    entry.reviewReasons.includes("POS_MISMATCH") ||
    entry.reviewReasons.includes("DUPLICATE_MEANINGS")
  ) {
    return {
      aiDecision: "NEEDS_HUMAN",
      reviewConfidence: "low",
      decisionReason:
        "Existing data has low confidence, unnatural Japanese, dictionary disagreement, POS mismatch, or duplicate meanings; human review is safer.",
      beforePrimaryMeanings: entry.primaryMeanings,
      afterPrimaryMeanings: [],
    };
  }

  if (
    isSafePrimarySet(entry.primaryMeanings) &&
    (currentHasTopDictionarySupport(entry) ||
      currentOverlapsTopWiktionary(entry) ||
      entry.primaryMeanings.some(
        (meaning) => meaning.sources.includes("japanese-wordnet") && meaning.sources.includes("ja-wiktionary"),
      ))
  ) {
    return {
      aiDecision: "KEEP_CURRENT",
      reviewConfidence: entry.primaryMeanings.every((meaning) => meaning.confidence === "high") ? "high" : "medium",
      decisionReason:
        "Current primary meanings are dictionary-grounded, medium-or-better confidence, non-empty, non-duplicate, and aligned with top available dictionary evidence.",
      beforePrimaryMeanings: entry.primaryMeanings,
      afterPrimaryMeanings: entry.primaryMeanings.map((meaning) => ({
        pos: meaning.pos,
        definitions: meaning.definitions,
        sources: meaning.sources,
        confidence: meaning.confidence,
        reason: "Kept current primary meaning.",
        sourceRefs: meaning.sourceRefs,
      })),
    };
  }

  const cleanedCurrent = cleanCurrentPrimaryMeanings(entry);

  if (cleanedCurrent.changed && isSafePrimarySet(cleanedCurrent.cleaned)) {
    return {
      aiDecision: "RESELECT_FROM_EXISTING",
      reviewConfidence: "medium",
      decisionReason:
        "Current primary meanings were narrowed to Japanese expressions that are explicitly present in the existing Wiktionary/WordNet-backed data.",
      beforePrimaryMeanings: entry.primaryMeanings,
      afterPrimaryMeanings: cleanedCurrent.cleaned,
    };
  }

  const suggested = buildSuggestedPrimaryMeanings(entry);

  if (
    suggested.length > 0 &&
    isSafePrimarySet(suggested) &&
    !primaryMeaningsEqual(entry.primaryMeanings, suggested) &&
    suggested.some((meaning) => meaning.sources.includes("ja-wiktionary"))
  ) {
    return {
      aiDecision: "RESELECT_FROM_EXISTING",
      reviewConfidence: suggested.some((meaning) => meaning.confidence === "high") ? "medium" : "medium",
      decisionReason:
        "A safer primaryMeaning set can be selected from existing WordNet/Wiktionary entries without generating new Japanese translations.",
      beforePrimaryMeanings: entry.primaryMeanings,
      afterPrimaryMeanings: suggested,
    };
  }

  if (isSafePrimarySet(entry.primaryMeanings)) {
    return {
      aiDecision: "KEEP_CURRENT",
      reviewConfidence: "medium",
      decisionReason:
        "Current primary meanings are usable, but the evidence remains somewhat ambiguous; keep as AI-reviewed medium confidence.",
      beforePrimaryMeanings: entry.primaryMeanings,
      afterPrimaryMeanings: entry.primaryMeanings.map((meaning) => ({
        pos: meaning.pos,
        definitions: meaning.definitions,
        sources: meaning.sources,
        confidence: meaning.confidence,
        reason: "Kept current primary meaning after existing-data review.",
        sourceRefs: meaning.sourceRefs,
      })),
    };
  }

  return {
    aiDecision: "NEEDS_HUMAN",
    reviewConfidence: "low",
    decisionReason: "Existing dictionary data does not support a safe automatic primaryMeaning decision.",
    beforePrimaryMeanings: entry.primaryMeanings,
    afterPrimaryMeanings: [],
  };
}

function reviewInputFor(entry) {
  return {
    word: entry.word,
    level: entry.level,
    currentPrimaryMeanings: entry.primaryMeanings,
    wordConfidence: entry.wordConfidence,
    reviewReasons: entry.reviewReasons,
    japaneseWordNet: {
      synsets: entry.japaneseWordNet.senses.map((sense) => ({
        synset: sense.synset,
        pos: sense.pos,
        japaneseLemmas: sense.japaneseLemmas,
        japaneseGloss: sense.japaneseGloss,
        japaneseGlosses: sense.japaneseGlosses,
        senseRank: sense.rank,
        tagCount: sense.freq,
      })),
    },
    wiktionary: {
      senses: entry.wiktionary.senses.map((sense) => ({
        pos: sense.pos,
        glosses: sense.glosses,
        displayDefinitions: sense.displayDefinitions,
        senseOrder: sense.senseOrder,
        tags: sense.tags,
        topics: sense.topics,
      })),
    },
  };
}

function rowFor(result) {
  return {
    word: result.word,
    level: result.level,
    aiDecision: result.aiDecision,
    reviewConfidence: result.reviewConfidence,
    wordConfidence: result.wordConfidence,
    reviewReasons: result.reviewReasons.join("|"),
    beforePrimaryMeanings: formatPrimaryMeanings(result.beforePrimaryMeanings),
    afterPrimaryMeanings: formatPrimaryMeanings(result.afterPrimaryMeanings),
    decisionReason: result.decisionReason,
  };
}

function confidenceCounts(results) {
  return results.reduce(
    (counts, result) => {
      counts[result.reviewConfidence.toUpperCase()] += 1;
      return counts;
    },
    { HIGH: 0, MEDIUM: 0, LOW: 0 },
  );
}

function decisionCounts(results) {
  return results.reduce(
    (counts, result) => {
      counts[result.aiDecision] += 1;
      return counts;
    },
    Object.fromEntries(REVIEW_DECISIONS.map((decision) => [decision, 0])),
  );
}

function statusForWord(entry, sets, aiResultByWord) {
  if (!entry.reviewRequired) {
    return { reviewStatus: "accepted", reviewStatusSource: "good_without_review" };
  }

  if (sets.autoAccept.has(entry.word)) {
    return { reviewStatus: "accepted", reviewStatusSource: "triage_auto_accept" };
  }

  if (sets.missingData.has(entry.word)) {
    return { reviewStatus: "missing_data", reviewStatusSource: "triage_missing_data" };
  }

  const aiResult = aiResultByWord.get(entry.word);

  if (aiResult?.aiDecision === "KEEP_CURRENT") {
    return {
      reviewStatus: "accepted",
      reviewStatusSource: "ai_keep_current",
      aiReview: aiResult,
    };
  }

  if (aiResult?.aiDecision === "RESELECT_FROM_EXISTING") {
    return {
      reviewStatus: "accepted",
      reviewStatusSource: "ai_reselect_from_existing",
      aiReview: aiResult,
    };
  }

  return {
    reviewStatus: "needs_human_review",
    reviewStatusSource: "ai_needs_human",
    aiReview: aiResult ?? null,
  };
}

function printSummary(summary) {
  console.log("AI-assisted review");
  console.log("------------------");
  console.log("");
  console.log(`Input NEEDS_REVIEW: ${summary.inputNeedsReview}`);
  console.log("");
  console.log(`KEEP_CURRENT: ${summary.decisions.KEEP_CURRENT}`);
  console.log(`RESELECT_FROM_EXISTING: ${summary.decisions.RESELECT_FROM_EXISTING}`);
  console.log(`NEEDS_HUMAN: ${summary.decisions.NEEDS_HUMAN}`);
  console.log("");
  console.log("Review confidence:");
  console.log(`HIGH: ${summary.reviewConfidence.HIGH}`);
  console.log(`MEDIUM: ${summary.reviewConfidence.MEDIUM}`);
  console.log(`LOW: ${summary.reviewConfidence.LOW}`);
  console.log("");
  console.log(`Final accepted words: ${summary.finalAcceptedWords}`);
  console.log(`Remaining human review: ${summary.remainingHumanReview}`);
  console.log(`Missing data: ${summary.missingData}`);
  console.log("");
  console.log(`Projected usable total: ${summary.projectedUsableTotal}`);
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
  const sets = {
    autoAccept: readWordColumn(options.autoAcceptCsv),
    needsReview: readWordColumn(options.needsReviewCsv),
    missingData: readWordColumn(options.missingDataCsv),
  };
  const wordsByWord = new Map(dictionary.words.map((entry) => [entry.word, entry]));
  const needsReviewEntries = [...sets.needsReview].map((word) => wordsByWord.get(word)).filter(Boolean);

  if (needsReviewEntries.length !== sets.needsReview.size) {
    throw new Error("Could not resolve every NEEDS_REVIEW word against wordDictionary.json.");
  }

  const reviewInput = needsReviewEntries.map(reviewInputFor);
  const reviewedWords = needsReviewEntries.map((entry) => ({
    word: entry.word,
    level: entry.level,
    wordConfidence: entry.wordConfidence,
    reviewReasons: entry.reviewReasons,
    ...aiReview(entry),
  }));
  const aiResultByWord = new Map(reviewedWords.map((entry) => [entry.word, entry]));
  const acceptedBeforeAi = dictionary.words.filter((entry) => !entry.reviewRequired).length + sets.autoAccept.size;
  const aiAccepted = reviewedWords.filter((entry) => entry.aiDecision !== "NEEDS_HUMAN").length;
  const remainingHuman = reviewedWords.filter((entry) => entry.aiDecision === "NEEDS_HUMAN").length;
  const summary = {
    inputNeedsReview: needsReviewEntries.length,
    acceptedBeforeAi,
    decisions: decisionCounts(reviewedWords),
    reviewConfidence: confidenceCounts(reviewedWords),
    finalAcceptedWords: acceptedBeforeAi + aiAccepted,
    remainingHumanReview: remainingHuman,
    missingData: sets.missingData.size,
    projectedUsableTotal: acceptedBeforeAi + aiAccepted,
    files: [
      options.outReviewInput,
      options.outReviewedCsv,
      options.outReviewedJson,
      options.outHumanReviewCsv,
      options.outStatusDictionary,
    ],
  };
  const statusDictionary = {
    metadata: {
      sourceDictionary: options.dictionary,
      note:
        "Derived review-status dictionary. Raw Japanese WordNet and Wiktionary data from wordDictionary.json is preserved; this file does not connect data to the game runtime.",
    },
    summary,
    words: dictionary.words.map((entry) => ({
      ...entry,
      ...statusForWord(entry, sets, aiResultByWord),
    })),
  };

  writeFile(
    options.outReviewInput,
    `${JSON.stringify(
      {
        note:
          "AI-assisted review input. The review must only choose, group, remove, or reorder meanings already present in Japanese WordNet or Japanese Wiktionary data.",
        words: reviewInput,
      },
      null,
      2,
    )}\n`,
  );
  writeFile(
    options.outReviewedJson,
    `${JSON.stringify(
      {
        summary,
        words: reviewedWords,
      },
      null,
      2,
    )}\n`,
  );
  writeCsv(options.outReviewedCsv, reviewedWords.map(rowFor), [
    "word",
    "level",
    "aiDecision",
    "reviewConfidence",
    "wordConfidence",
    "reviewReasons",
    "beforePrimaryMeanings",
    "afterPrimaryMeanings",
    "decisionReason",
  ]);
  writeCsv(
    options.outHumanReviewCsv,
    reviewedWords.filter((entry) => entry.aiDecision === "NEEDS_HUMAN").map(rowFor),
    [
      "word",
      "level",
      "aiDecision",
      "reviewConfidence",
      "wordConfidence",
      "reviewReasons",
      "beforePrimaryMeanings",
      "afterPrimaryMeanings",
      "decisionReason",
    ],
  );
  writeFile(options.outStatusDictionary, `${JSON.stringify(statusDictionary, null, 2)}\n`);

  printSummary(summary);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
