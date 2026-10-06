import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const INPUT_PATH = "reports/wordnet-sample.json";
const HUMAN_REVIEW_PATH = "reports/wordnet-human-review.csv";
const PROBLEM_REVIEW_PATH = "reports/wordnet-problem-review.csv";
const TRUNCATED_REVIEW_CSV_PATH = "reports/wordnet-truncated-review.csv";
const TRUNCATED_REVIEW_JSON_PATH = "reports/wordnet-truncated-review.json";

const REVIEW_CATEGORIES = [
  "TOO_MANY_SENSES",
  "TOO_MANY_JAPANESE_LEMMAS",
  "DUPLICATE_MEANINGS",
  "AMBIGUOUS_PRIMARY_SENSE",
  "UNNATURAL_JAPANESE",
  "MISSING_JAPANESE",
  "POS_BALANCE",
  "OTHER",
];

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

function selectedMeaning(candidate) {
  return candidate?.definitions?.join("・") ?? "";
}

function allJapaneseLemmas(wordEntry) {
  return [
    ...new Set(
      wordEntry.senses.flatMap((sense) => sense.japaneseLemmas ?? []).filter((lemma) => String(lemma).trim().length > 0),
    ),
  ];
}

function synsetSummary(sense) {
  return {
    synset: sense.synset,
    pos: sense.pos,
    senseRank: sense.rank,
    tagCount: sense.freq,
    japaneseLemmas: sense.japaneseLemmas,
    japaneseGloss: sense.japaneseGloss,
  };
}

function isSentenceLikeJapanese(text) {
  return /[。、，,.]/.test(text) || /こと$|ため$|よう$|もの$/.test(text);
}

function isUnnaturalSelectedMeaning(text) {
  return (
    /^[-ー]/.test(text) ||
    /[{}[\]<>_=+*\\/@#%$^~`|]/.test(text) ||
    [...text].length >= 16 ||
    isSentenceLikeJapanese(text)
  );
}

function normalizedMeaningText(candidate) {
  return (candidate?.definitions ?? [])
    .map((definition) => String(definition).trim().normalize("NFKC"))
    .sort()
    .join("|");
}

function hasDuplicateSelectedMeanings(wordEntry) {
  const seen = new Set();

  for (const candidate of wordEntry.primaryMeaningCandidates) {
    const key = normalizedMeaningText(candidate);

    if (!key) {
      continue;
    }

    if (seen.has(key)) {
      return true;
    }

    seen.add(key);
  }

  return false;
}

function hasSamePosOnlyButOtherMajorPos(wordEntry) {
  const selectedPos = new Set(wordEntry.primaryMeaningCandidates.map((candidate) => candidate.pos));
  const candidatePos = new Set(wordEntry.primaryCandidateSenses.map((candidate) => candidate.pos));

  return (
    wordEntry.primaryMeaningCandidates.length >= 3 &&
    selectedPos.size === 1 &&
    [...candidatePos].some((pos) => !selectedPos.has(pos))
  );
}

function hasHigherScoringUnselectedSense(wordEntry) {
  const selectedSynsets = new Set(wordEntry.primaryMeaningCandidates.map((candidate) => candidate.synset));
  const selectedScores = wordEntry.primaryCandidateSenses
    .filter((candidate) => selectedSynsets.has(candidate.synset))
    .map((candidate) => candidate.score);
  const worstSelectedScore = selectedScores.length > 0 ? Math.max(...selectedScores) : Number.POSITIVE_INFINITY;

  return wordEntry.primaryCandidateSenses.some(
    (candidate) => !selectedSynsets.has(candidate.synset) && candidate.score < worstSelectedScore,
  );
}

function categorizeWord(wordEntry) {
  const categories = new Set();
  const reasons = [];
  const senseLevelFlags = [
    ...new Set(wordEntry.primaryCandidateSenses.flatMap((candidate) => candidate.reviewFlags ?? [])),
  ];

  if (wordEntry.japaneseLemmaCount === 0 || wordEntry.reviewFlags.includes("no-japanese-lemmas")) {
    categories.add("MISSING_JAPANESE");
    reasons.push("Japanese lemma was not found for this word.");
  }

  if (wordEntry.reviewFlags.includes("many-synsets") || wordEntry.numberOfSynsets >= 10) {
    categories.add("TOO_MANY_SENSES");
    reasons.push(`This word has ${wordEntry.numberOfSynsets} synsets, so top-3 selection is likely ambiguous.`);
  }

  if (wordEntry.reviewFlags.includes("many-japanese-lemmas") || wordEntry.japaneseLemmaCount >= 10) {
    categories.add("TOO_MANY_JAPANESE_LEMMAS");
    reasons.push(`This word has ${wordEntry.japaneseLemmaCount} unique Japanese lemmas.`);
  }

  if (wordEntry.reviewFlags.includes("heavy-duplicate-japanese-lemmas")) {
    categories.add("DUPLICATE_MEANINGS");
    reasons.push("Many Japanese lemmas repeat across synsets or normalize to the same form.");
  }

  if (wordEntry.reviewFlags.includes("primary-candidates-truncated")) {
    categories.add("AMBIGUOUS_PRIMARY_SENSE");
    reasons.push(
      `${wordEntry.primaryCandidateSenses.length} viable synset-level primary candidates existed, but only 3 display rows are allowed.`,
    );
  }

  if (senseLevelFlags.includes("many-lemmas-in-synset")) {
    categories.add("TOO_MANY_JAPANESE_LEMMAS");
    reasons.push("At least one synset has many Japanese lemmas, so representative lemma choice needs review.");
  }

  if (senseLevelFlags.includes("possible-kana-orthographic-variant")) {
    categories.add("DUPLICATE_MEANINGS");
    reasons.push("Kana-only orthographic variants were detected and should be checked by a human.");
  }

  if (senseLevelFlags.includes("no-displayable-lemma-for-primary")) {
    categories.add("UNNATURAL_JAPANESE");
    reasons.push("A candidate synset had Japanese lemmas but none passed the display heuristic.");
  }

  const knownSenseFlags = new Set([
    "many-lemmas-in-synset",
    "possible-kana-orthographic-variant",
    "no-displayable-lemma-for-primary",
  ]);
  const unknownSenseFlags = senseLevelFlags.filter((flag) => !knownSenseFlags.has(flag));

  if (unknownSenseFlags.length > 0) {
    categories.add("OTHER");
    reasons.push(`Unclassified sense-level flags: ${unknownSenseFlags.join("|")}.`);
  }

  if (hasDuplicateSelectedMeanings(wordEntry)) {
    categories.add("DUPLICATE_MEANINGS");
    reasons.push("Two or more selected display rows are effectively identical after safe normalization.");
  }

  const unnaturalMeanings = wordEntry.primaryMeaningCandidates
    .map(selectedMeaning)
    .filter((meaning) => meaning && isUnnaturalSelectedMeaning(meaning));

  if (unnaturalMeanings.length > 0) {
    categories.add("UNNATURAL_JAPANESE");
    reasons.push(`Selected display text may be unnatural for game display: ${unnaturalMeanings.join(" / ")}.`);
  }

  if (hasSamePosOnlyButOtherMajorPos(wordEntry)) {
    categories.add("POS_BALANCE");
    reasons.push("All 3 selected rows use one POS while other POS candidates exist.");
  }

  if (hasHigherScoringUnselectedSense(wordEntry)) {
    categories.add("AMBIGUOUS_PRIMARY_SENSE");
    reasons.push("A lower-scored unselected candidate exists, indicating selection order should be checked.");
  }

  return {
    categories: [...categories],
    reasons,
  };
}

function selectionReason(wordEntry, review) {
  if (wordEntry.primaryMeaningCandidates.length === 0) {
    return "No game-display candidate was selected because no Japanese lemma was available.";
  }

  const selected = wordEntry.primaryMeaningCandidates
    .map(
      (candidate) =>
        `${candidate.primaryRank}. ${candidate.pos} ${candidate.synset}: ${selectedMeaning(candidate)} (${candidate.rankReason})`,
    )
    .join(" / ");
  const reviewNote =
    review.categories.length > 0
      ? ` Review categories: ${review.categories.join("|")}; ${review.reasons.join(" ")}`
      : " No machine review flags; still requires human semantic spot-check before production.";

  return `${selected}${reviewNote}`;
}

function buildHumanReviewRows(words, reviewsByWord) {
  return words.map((wordEntry) => {
    const [first, second, third] = wordEntry.primaryMeaningCandidates;
    const review = reviewsByWord.get(wordEntry.word);

    return {
      word: wordEntry.word,
      level: wordEntry.level,
      selectedMeaning1: selectedMeaning(first),
      selectedMeaning2: selectedMeaning(second),
      selectedMeaning3: selectedMeaning(third),
      selectedPOS1: first?.pos ?? "",
      selectedPOS2: second?.pos ?? "",
      selectedPOS3: third?.pos ?? "",
      totalSynsets: wordEntry.numberOfSynsets,
      totalJapaneseLemmas: wordEntry.japaneseLemmaCount,
      reviewFlags: review.categories.join("|"),
      selectionReason: selectionReason(wordEntry, review),
    };
  });
}

function buildProblemReviewRows(words, reviewsByWord) {
  return words
    .filter((wordEntry) => reviewsByWord.get(wordEntry.word).categories.length > 0)
    .map((wordEntry) => {
      const review = reviewsByWord.get(wordEntry.word);

      return {
        word: wordEntry.word,
        selectedPrimaryMeanings: wordEntry.primaryMeaningCandidates.map((candidate) => ({
          pos: candidate.pos,
          synset: candidate.synset,
          display: selectedMeaning(candidate),
          primaryRank: candidate.primaryRank,
          rankReason: candidate.rankReason,
        })),
        allSynsets: wordEntry.senses.map(synsetSummary),
        allJapaneseLemmas: allJapaneseLemmas(wordEntry),
        reviewFlags: review.categories.join("|"),
        whyReviewRequired: review.reasons.join(" "),
      };
    });
}

function buildTruncatedReview(words) {
  return words
    .filter((wordEntry) => wordEntry.reviewFlags.includes("primary-candidates-truncated"))
    .map((wordEntry) => {
      const selectedBySynset = new Map(
        wordEntry.primaryMeaningCandidates.map((candidate) => [candidate.synset, candidate.primaryRank]),
      );
      const selectedDefinitionKeys = new Set(wordEntry.primaryMeaningCandidates.map(normalizedMeaningText));

      return {
        word: wordEntry.word,
        candidates: wordEntry.primaryCandidateSenses.map((candidate, index) => {
          const primaryRank = selectedBySynset.get(candidate.synset) ?? null;
          const definitionKey = normalizedMeaningText({ definitions: candidate.definitions });
          const selected = primaryRank !== null;
          let exclusionReason = "";

          if (!selected) {
            exclusionReason = selectedDefinitionKeys.has(definitionKey)
              ? "not selected because a selected synset already has the same display lemmas"
              : "not selected because max 3 display rows were already filled by higher-priority candidates";
          }

          return {
            priority: index + 1,
            pos: candidate.pos,
            synset: candidate.synset,
            japanese: candidate.definitions.join("・"),
            allJapaneseLemmas: candidate.allJapaneseLemmas,
            senseRank: candidate.senseRank,
            tagCount: candidate.tagCount,
            selected: selected ? "YES" : "NO",
            primaryRank: primaryRank ?? "",
            reason: selected ? candidate.rankReason : `${candidate.rankReason}; ${exclusionReason}`,
          };
        }),
      };
    });
}

function buildTruncatedCsvRows(truncatedReview) {
  return truncatedReview.flatMap((wordEntry) =>
    wordEntry.candidates.map((candidate) => ({
      word: wordEntry.word,
      priority: candidate.priority,
      pos: candidate.pos,
      synset: candidate.synset,
      japanese: candidate.japanese,
      allJapaneseLemmas: candidate.allJapaneseLemmas.join("|"),
      senseRank: candidate.senseRank ?? "",
      tagCount: candidate.tagCount ?? "",
      selected: candidate.selected,
      primaryRank: candidate.primaryRank,
      reason: candidate.reason,
    })),
  );
}

function summarize(words, reviewsByWord) {
  const reviewRows = words.filter((wordEntry) => reviewsByWord.get(wordEntry.word).categories.length > 0);
  const goodWithoutReview = words.length - reviewRows.length;
  const breakdown = Object.fromEntries(REVIEW_CATEGORIES.map((category) => [category, 0]));

  for (const wordEntry of reviewRows) {
    for (const category of reviewsByWord.get(wordEntry.word).categories) {
      breakdown[category] += 1;
    }
  }

  return {
    totalSample: words.length,
    goodWithoutReview,
    reviewRequired: reviewRows.length,
    breakdown,
    autoUsableCandidateRatio: words.length > 0 ? goodWithoutReview / words.length : 0,
  };
}

function main() {
  const report = readJson(INPUT_PATH);
  const words = report.words;
  const reviewsByWord = new Map(words.map((wordEntry) => [wordEntry.word, categorizeWord(wordEntry)]));
  const humanReviewRows = buildHumanReviewRows(words, reviewsByWord);
  const problemReviewRows = buildProblemReviewRows(words, reviewsByWord);
  const truncatedReview = buildTruncatedReview(words);
  const summary = summarize(words, reviewsByWord);

  writeCsv(HUMAN_REVIEW_PATH, humanReviewRows, [
    "word",
    "level",
    "selectedMeaning1",
    "selectedMeaning2",
    "selectedMeaning3",
    "selectedPOS1",
    "selectedPOS2",
    "selectedPOS3",
    "totalSynsets",
    "totalJapaneseLemmas",
    "reviewFlags",
    "selectionReason",
  ]);
  writeCsv(PROBLEM_REVIEW_PATH, problemReviewRows, [
    "word",
    "selectedPrimaryMeanings",
    "allSynsets",
    "allJapaneseLemmas",
    "reviewFlags",
    "whyReviewRequired",
  ]);
  writeCsv(TRUNCATED_REVIEW_CSV_PATH, buildTruncatedCsvRows(truncatedReview), [
    "word",
    "priority",
    "pos",
    "synset",
    "japanese",
    "allJapaneseLemmas",
    "senseRank",
    "tagCount",
    "selected",
    "primaryRank",
    "reason",
  ]);
  writeFile(TRUNCATED_REVIEW_JSON_PATH, `${JSON.stringify(truncatedReview, null, 2)}\n`);

  console.log("Japanese WordNet Primary Human Review");
  console.log("------------------------------------");
  console.log(`Total sample: ${summary.totalSample}`);
  console.log(`Good without review: ${summary.goodWithoutReview}`);
  console.log(`Review required: ${summary.reviewRequired}`);
  console.log("");
  console.log("Review breakdown:");
  for (const category of REVIEW_CATEGORIES) {
    console.log(`${category}: ${summary.breakdown[category]}`);
  }
  console.log("");
  console.log(
    `Auto-usable candidate ratio: ${(summary.autoUsableCandidateRatio * 100).toFixed(1)}% (${summary.goodWithoutReview}/${summary.totalSample})`,
  );
  console.log("");
  console.log("Review files generated:");
  console.log(`- ${HUMAN_REVIEW_PATH}`);
  console.log(`- ${PROBLEM_REVIEW_PATH}`);
  console.log(`- ${TRUNCATED_REVIEW_CSV_PATH}`);
  console.log(`- ${TRUNCATED_REVIEW_JSON_PATH}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
