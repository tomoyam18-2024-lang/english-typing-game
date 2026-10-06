import { DatabaseSync } from "node:sqlite";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";

const DEFAULT_OPTIONS = {
  db: "data/wordnet/wnjpn.db",
  wordMaster: "src/data/wordMaster.json",
  outJson: "reports/wordnet-sample.json",
  outCsv: "reports/wordnet-sample.csv",
  outPrimaryReview: "reports/wordnet-primary-review.csv",
  outComparison: "reports/wordnet-primary-comparison.csv",
  sampleSize: 50,
};

const POS_LABELS = {
  n: "noun",
  v: "verb",
  a: "adjective",
  s: "adjective",
  r: "adverb",
};

const SOURCE_PRIORITY_BY_LEVEL = {
  1: ["TSL", "NAWL", "NGSL-GR"],
  2: ["TSL", "NAWL", "NGSL-GR"],
  3: ["NAWL", "NGSL-GR", "TSL"],
};

const MAX_PRIMARY_MEANINGS = 3;

function printHelp() {
  console.log(`Usage:
  node scripts/generate-wordnet-sample.mjs [options]

Options:
  --db <path>            Japanese WordNet SQLite DB path.
                         Default: ${DEFAULT_OPTIONS.db}
  --word-master <path>   wordMaster JSON path.
                         Default: ${DEFAULT_OPTIONS.wordMaster}
  --out-json <path>      JSON report path.
                         Default: ${DEFAULT_OPTIONS.outJson}
  --out-csv <path>       CSV report path.
                         Default: ${DEFAULT_OPTIONS.outCsv}
  --out-primary-review <path>
                         Primary meaning candidate review CSV path.
                         Default: ${DEFAULT_OPTIONS.outPrimaryReview}
  --out-comparison <path>
                         Before/after comparison CSV path.
                         Default: ${DEFAULT_OPTIONS.outComparison}
  --sample-size <count>  Sample size.
                         Default: ${DEFAULT_OPTIONS.sampleSize}
  --help                 Show this help.
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

    if (key === "sample-size") {
      options.sampleSize = Number(value);
    } else if (key === "word-master") {
      options.wordMaster = value;
    } else if (key === "out-json") {
      options.outJson = value;
    } else if (key === "out-csv") {
      options.outCsv = value;
    } else if (key === "out-primary-review") {
      options.outPrimaryReview = value;
    } else if (key === "out-comparison") {
      options.outComparison = value;
    } else if (key in options) {
      options[key] = value;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }

    index += 1;
  }

  if (!Number.isInteger(options.sampleSize) || options.sampleSize <= 0) {
    throw new Error("--sample-size must be a positive integer.");
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
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");

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
  return `"${identifier.replaceAll('"', '""')}"`;
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

function sampleEvenly(entries, count) {
  if (entries.length <= count) {
    return entries;
  }

  return Array.from({ length: count }, (_, index) => entries[Math.floor((index * (entries.length - 1)) / (count - 1))]);
}

function sampleWordMaster(wordMaster, sampleSize) {
  const levels = [1, 2, 3];
  const baseCount = Math.floor(sampleSize / levels.length);
  let remainder = sampleSize % levels.length;
  const quotas = Object.fromEntries(
    levels.map((level) => {
      const quota = baseCount + (remainder > 0 ? 1 : 0);
      remainder -= 1;
      return [level, quota];
    }),
  );

  return levels.flatMap((level) => {
    const entries = wordMaster.filter((entry) => entry.level === level).sort(compareByLevelOrder);
    return sampleEvenly(entries, quotas[level]);
  });
}

async function ensureDatabase(dbPath) {
  const absoluteDbPath = path.resolve(process.cwd(), dbPath);

  if (existsSync(absoluteDbPath)) {
    return absoluteDbPath;
  }

  const gzPath = `${absoluteDbPath}.gz`;

  if (!existsSync(gzPath)) {
    throw new Error(
      `Japanese WordNet DB not found. Place wnjpn.db at ${dbPath} or place wnjpn.db.gz next to it and rerun this command.`,
    );
  }

  mkdirSync(path.dirname(absoluteDbPath), { recursive: true });
  await pipeline(createReadStream(gzPath), zlib.createGunzip(), createWriteStream(absoluteDbPath, { flags: "wx" }));
  return absoluteDbPath;
}

function getTables(database) {
  const tables = database
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((table) => ({
      name: table.name,
      sql: table.sql,
      columns: database.prepare(`PRAGMA table_info(${quoteIdentifier(table.name)})`).all().map((column) => ({
        name: column.name,
        type: column.type,
      })),
    }));

  return tables;
}

function columnMap(table) {
  return new Map(table.columns.map((column) => [column.name.toLowerCase(), column.name]));
}

function findTable(tables, requiredColumns, preferredNamePattern) {
  const candidates = tables
    .map((table) => ({
      table,
      columns: columnMap(table),
    }))
    .filter((candidate) => requiredColumns.every((column) => candidate.columns.has(column)));

  if (candidates.length === 0) {
    return null;
  }

  const preferred = preferredNamePattern
    ? candidates.find((candidate) => preferredNamePattern.test(candidate.table.name.toLowerCase()))
    : null;
  const selected = preferred ?? candidates[0];

  return {
    name: selected.table.name,
    columns: Object.fromEntries(requiredColumns.map((column) => [column, selected.columns.get(column)])),
    allColumns: selected.table.columns,
  };
}

function inspectSchema(database) {
  const tables = getTables(database);
  const word = findTable(tables, ["wordid", "lang", "lemma", "pos"], /^word$/);
  const sense = findTable(tables, ["synset", "wordid", "lang"], /^sense$/);
  const synset = findTable(tables, ["synset", "pos"], /^synset$/);
  const gloss = findTable(tables, ["synset", "lang", "def"], /def/);

  if (!word || !sense || !gloss) {
    throw new Error("Could not detect required Japanese WordNet tables/columns from the SQLite schema.");
  }

  return {
    tables: tables.map((table) => ({
      name: table.name,
      columns: table.columns,
    })),
    mapping: {
      word,
      sense: {
        ...sense,
        optionalColumns: {
          rank: columnMap(tables.find((table) => table.name === sense.name)).get("rank") ?? null,
          freq: columnMap(tables.find((table) => table.name === sense.name)).get("freq") ?? null,
          lexid: columnMap(tables.find((table) => table.name === sense.name)).get("lexid") ?? null,
        },
      },
      synset,
      gloss: {
        ...gloss,
        optionalColumns: {
          sid: columnMap(tables.find((table) => table.name === gloss.name)).get("sid") ?? null,
        },
      },
    },
  };
}

function posLabel(pos) {
  return POS_LABELS[pos] ?? `other:${pos || "unknown"}`;
}

function numericExpression(alias, columnName) {
  return columnName ? `CAST(NULLIF(${alias}.${quoteIdentifier(columnName)}, '') AS INTEGER)` : "NULL";
}

function placeholderList(values) {
  return values.map(() => "?").join(", ");
}

function findEnglishSensesForWords(database, schema, entries) {
  const word = schema.mapping.word;
  const sense = schema.mapping.sense;
  const synset = schema.mapping.synset;
  const w = "w";
  const s = "s";
  const ss = "ss";
  const senseRank = sense.optionalColumns.rank;
  const senseFreq = sense.optionalColumns.freq;
  const senseLexid = sense.optionalColumns.lexid;
  const lookupToWord = new Map();

  for (const entry of entries) {
    const normalizedWord = entry.word.toLowerCase();
    lookupToWord.set(normalizedWord, normalizedWord);
    lookupToWord.set(normalizedWord.replaceAll(" ", "_"), normalizedWord);
  }

  const lookupValues = [...lookupToWord.keys()];
  const senseSelect = [
    `lower(${w}.${quoteIdentifier(word.columns.lemma)}) AS lookupLemma`,
    `${s}.${quoteIdentifier(sense.columns.synset)} AS synset`,
    synset
      ? `${ss}.${quoteIdentifier(synset.columns.pos)} AS pos`
      : `${w}.${quoteIdentifier(word.columns.pos)} AS pos`,
    senseRank ? `${s}.${quoteIdentifier(senseRank)} AS rank` : "NULL AS rank",
    senseFreq ? `${s}.${quoteIdentifier(senseFreq)} AS freq` : "NULL AS freq",
    senseLexid ? `${s}.${quoteIdentifier(senseLexid)} AS lexid` : "NULL AS lexid",
  ];
  const synsetJoin = synset
    ? `LEFT JOIN ${quoteIdentifier(synset.name)} ${ss}
         ON ${ss}.${quoteIdentifier(synset.columns.synset)} = ${s}.${quoteIdentifier(sense.columns.synset)}`
    : "";
  const rows = database
    .prepare(
      `
        SELECT DISTINCT
          ${senseSelect.join(",\n          ")}
        FROM ${quoteIdentifier(word.name)} ${w}
        INNER JOIN ${quoteIdentifier(sense.name)} ${s}
          ON ${s}.${quoteIdentifier(sense.columns.wordid)} = ${w}.${quoteIdentifier(word.columns.wordid)}
        ${synsetJoin}
        WHERE ${w}.${quoteIdentifier(word.columns.lang)} = 'eng'
          AND ${s}.${quoteIdentifier(sense.columns.lang)} = 'eng'
          AND lower(${w}.${quoteIdentifier(word.columns.lemma)}) IN (${placeholderList(lookupValues)})
        ORDER BY lower(${w}.${quoteIdentifier(word.columns.lemma)}),
          ${numericExpression(s, senseRank)},
          ${s}.${quoteIdentifier(sense.columns.synset)}
      `,
    )
    .all(...lookupValues);
  const rowsByWord = new Map();

  for (const row of rows) {
    const sampleWord = lookupToWord.get(row.lookupLemma) ?? row.lookupLemma;

    if (!rowsByWord.has(sampleWord)) {
      rowsByWord.set(sampleWord, []);
    }

    rowsByWord.get(sampleWord).push(row);
  }

  return rowsByWord;
}

function findJapaneseLemmasForSynsets(database, schema, synsets) {
  if (synsets.length === 0) {
    return new Map();
  }

  const word = schema.mapping.word;
  const sense = schema.mapping.sense;
  const jw = "jw";
  const js = "js";
  const senseRank = sense.optionalColumns.rank;
  const senseFreq = sense.optionalColumns.freq;
  const rows = database
    .prepare(
      `
        SELECT
          ${js}.${quoteIdentifier(sense.columns.synset)} AS synset,
          ${jw}.${quoteIdentifier(word.columns.lemma)} AS lemma,
          ${numericExpression(js, senseRank)} AS rank,
          ${numericExpression(js, senseFreq)} AS freq
        FROM ${quoteIdentifier(sense.name)} ${js}
        INNER JOIN ${quoteIdentifier(word.name)} ${jw}
          ON ${jw}.${quoteIdentifier(word.columns.wordid)} = ${js}.${quoteIdentifier(sense.columns.wordid)}
        WHERE ${js}.${quoteIdentifier(sense.columns.synset)} IN (${placeholderList(synsets)})
          AND ${js}.${quoteIdentifier(sense.columns.lang)} = 'jpn'
          AND ${jw}.${quoteIdentifier(word.columns.lang)} = 'jpn'
        ORDER BY ${js}.${quoteIdentifier(sense.columns.synset)},
          ${numericExpression(js, senseRank)},
          ${jw}.${quoteIdentifier(word.columns.lemma)}
      `,
    )
    .all(...synsets);
  const rowsBySynset = new Map();

  for (const row of rows) {
    if (!rowsBySynset.has(row.synset)) {
      rowsBySynset.set(row.synset, []);
    }

    rowsBySynset.get(row.synset).push(row);
  }

  return rowsBySynset;
}

function findJapaneseGlossesForSynsets(database, schema, synsets) {
  if (synsets.length === 0) {
    return new Map();
  }

  const gloss = schema.mapping.gloss;
  const sd = "sd";
  const glossSid = gloss.optionalColumns.sid;
  const rows = database
    .prepare(
      `
        SELECT DISTINCT
          ${sd}.${quoteIdentifier(gloss.columns.synset)} AS synset,
          ${sd}.${quoteIdentifier(gloss.columns.def)} AS gloss
        FROM ${quoteIdentifier(gloss.name)} ${sd}
        WHERE ${sd}.${quoteIdentifier(gloss.columns.synset)} IN (${placeholderList(synsets)})
          AND ${sd}.${quoteIdentifier(gloss.columns.lang)} = 'jpn'
        ORDER BY ${sd}.${quoteIdentifier(gloss.columns.synset)},
          ${numericExpression(sd, glossSid)},
          ${sd}.${quoteIdentifier(gloss.columns.def)}
      `,
    )
    .all(...synsets);
  const rowsBySynset = new Map();

  for (const row of rows) {
    if (!rowsBySynset.has(row.synset)) {
      rowsBySynset.set(row.synset, []);
    }

    rowsBySynset.get(row.synset).push(row.gloss);
  }

  return rowsBySynset;
}

function uniqueOrdered(values) {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const trimmed = String(value ?? "").trim();

    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    output.push(trimmed);
  }

  return output;
}

function hasUnnaturalJapaneseCharacters(value) {
  return /[\u0000-\u001f{}[\]<>_=+*\\/@#%$^~`|]/.test(value);
}

function isVeryLongJapaneseLemma(value) {
  return [...value].length >= 16;
}

function normalizeJapaneseLemma(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFKC")
    .replace(/\s+/g, " ");
}

function isKanaOnly(value) {
  return /^[\u3040-\u309f\u30a0-\u30ffーｰ]+$/.test(value);
}

function isKatakanaOnly(value) {
  return /^[\u30a0-\u30ffーｰ]+$/.test(value);
}

function hasKanji(value) {
  return /[\u3400-\u9fff]/.test(value);
}

function kanaFold(value) {
  return [...normalizeJapaneseLemma(value)]
    .map((character) => {
      const codePoint = character.codePointAt(0);

      if (codePoint >= 0x30a1 && codePoint <= 0x30f6) {
        return String.fromCodePoint(codePoint - 0x60);
      }

      if (character === "ｰ") {
        return "ー";
      }

      return character;
    })
    .join("");
}

function detectLemmaVariantFlags(lemmas) {
  const flags = new Set();
  const kanaGroups = new Map();

  for (const lemma of lemmas) {
    if (!isKanaOnly(lemma)) {
      continue;
    }

    const folded = kanaFold(lemma);

    if (!kanaGroups.has(folded)) {
      kanaGroups.set(folded, new Set());
    }

    kanaGroups.get(folded).add(lemma);
  }

  if ([...kanaGroups.values()].some((group) => group.size > 1)) {
    flags.add("possible-kana-orthographic-variant");
  }

  return [...flags];
}

function normalizeLemmaRows(lemmaRows) {
  const seen = new Set();
  const entries = [];
  let duplicateCount = 0;

  for (const [index, row] of lemmaRows.entries()) {
    const lemma = normalizeJapaneseLemma(row.lemma);

    if (!lemma) {
      continue;
    }

    const key = lemma.normalize("NFKC");

    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }

    seen.add(key);
    entries.push({
      lemma,
      originalLemma: String(row.lemma ?? ""),
      rank: normalizeRank(row.rank),
      freq: normalizeRank(row.freq),
      sourceIndex: index,
    });
  }

  return {
    entries,
    duplicateCount,
    variantFlags: detectLemmaVariantFlags(entries.map((entry) => entry.lemma)),
  };
}

const COMMON_LEMMA_HINTS = new Set([
  "割り当てる",
  "配分する",
  "充当する",
  "正しく",
  "正確",
  "キーボード",
  "検査",
  "点検",
  "監査",
  "審査",
  "顧問",
  "相談役",
  "認可",
  "許可",
  "承認",
  "編集",
  "収集",
  "辞める",
  "止める",
  "諦める",
  "去る",
  "離れる",
  "うろつく",
  "ぶらつく",
  "徘徊",
  "待合室",
  "ラウンジ",
  "ソファ",
  "ソファー",
  "財布",
  "ハンドバッグ",
  "広い",
  "丈夫",
  "長持ちする",
  "助ける",
  "役立つ",
  "互換の",
  "互換性のある",
  "互換的",
  "修正",
  "訂正",
]);

const LOW_PRIORITY_LEMMA_HINTS = new Set([
  "低回",
  "低徊",
  "宏闊",
  "弘い",
  "財嚢",
  "蟇口",
  "蝦蟇口",
  "オールボアール",
]);

function lemmaQualityScore(lemma, pos) {
  const length = [...lemma].length;
  let score = 0;

  if (COMMON_LEMMA_HINTS.has(lemma)) {
    score -= 12;
  }

  if (LOW_PRIORITY_LEMMA_HINTS.has(lemma)) {
    score += 18;
  }

  if (length <= 1) {
    score += 20;
  }

  if (length > 8) {
    score += (length - 8) * 5;
  }

  if (isVeryLongJapaneseLemma(lemma)) {
    score += 80;
  }

  if (hasUnnaturalJapaneseCharacters(lemma)) {
    score += 80;
  }

  if (/^[\-ー]/.test(lemma)) {
    score += 20;
  }

  if (/^(非|不|無|未)/.test(lemma)) {
    score += 18;
  }

  if (/[。、，,.]/.test(lemma)) {
    score += 50;
  }

  if (/^[御お]/.test(lemma)) {
    score += 8;
  }

  if (/[罷抛纒撰誅輔弼斧匡鑑]/.test(lemma)) {
    score += 12;
  }

  if (isKatakanaOnly(lemma) && length >= 4) {
    score += 7;
  } else if (isKanaOnly(lemma) && length >= 4) {
    score += 5;
  }

  if (hasKanji(lemma)) {
    score -= 6;
  }

  if (/[をにへがの]/.test(lemma)) {
    score += 6;
  }

  if (pos === "verb") {
    if (/する$/.test(lemma)) {
      score -= 4;
    } else if (/[うくぐすつぬぶむる]$/.test(lemma)) {
      score -= 7;
    } else {
      score += 12;
    }
  }

  if (pos === "adjective" && /[いな]$/.test(lemma)) {
    score -= 5;
  }

  if (pos === "adverb" && /く$/.test(lemma)) {
    score -= 6;
  }

  return score;
}

function selectRepresentativeLemmas(sense, maxCount = 2) {
  return sense.japaneseLemmaEntries
    .map((entry) => ({
      ...entry,
      qualityScore: lemmaQualityScore(entry.lemma, sense.pos),
    }))
    .filter((entry) => !isVeryLongJapaneseLemma(entry.lemma) && !hasUnnaturalJapaneseCharacters(entry.lemma))
    .sort(
      (a, b) =>
        a.qualityScore - b.qualityScore ||
        [...a.lemma].length - [...b.lemma].length ||
        a.sourceIndex - b.sourceIndex ||
        a.lemma.localeCompare(b.lemma),
    )
    .slice(0, maxCount)
    .map((entry) => entry.lemma);
}

function legacyCompactLemmaLine(lemmas) {
  return lemmas
    .filter((lemma) => !isVeryLongJapaneseLemma(lemma) && !hasUnnaturalJapaneseCharacters(lemma))
    .slice(0, 3)
    .join("・");
}

function scoreLegacySenseForPrimary(sense) {
  const rankScore = Number.isFinite(sense.rank) ? sense.rank : 9999;
  const naturalLemmaCount = sense.japaneseLemmas.filter(
    (lemma) => !isVeryLongJapaneseLemma(lemma) && !hasUnnaturalJapaneseCharacters(lemma),
  ).length;
  const posScore =
    {
      noun: 0,
      verb: 1,
      adjective: 2,
      adverb: 3,
    }[sense.pos] ?? 4;

  return rankScore + posScore * 100 + Math.max(0, 3 - naturalLemmaCount) * 10;
}

function selectLegacyPrimaryMeaningCandidates(senses) {
  return senses
    .filter((sense) => sense.japaneseLemmas.length > 0)
    .map((sense) => ({
      pos: sense.pos,
      definition: legacyCompactLemmaLine(sense.japaneseLemmas),
      sourceSynsets: [sense.synset],
      score: scoreLegacySenseForPrimary(sense),
    }))
    .filter((candidate) => candidate.definition.length > 0)
    .sort((a, b) => a.score - b.score || a.pos.localeCompare(b.pos))
    .slice(0, MAX_PRIMARY_MEANINGS)
    .map(({ score, ...candidate }) => candidate);
}

function buildSensePrimaryCandidate(sense) {
  const selectedJapaneseLemmas = selectRepresentativeLemmas(sense);
  const lemmaPenalty =
    selectedJapaneseLemmas.length > 0
      ? Math.min(...selectedJapaneseLemmas.map((lemma) => lemmaQualityScore(lemma, sense.pos)))
      : 100;
  const senseRankScore = Number.isFinite(sense.rank) ? sense.rank * 1000 : 9999;
  const tagCountScore = Number.isFinite(sense.freq) ? -Math.min(sense.freq, 100) * 5 : 0;
  const posScore =
    {
      noun: 0,
      verb: 40,
      adjective: 80,
      adverb: 100,
    }[sense.pos] ?? 140;
  const score = senseRankScore + tagCountScore + posScore + lemmaPenalty;
  const reviewFlags = [...sense.lemmaReviewFlags];

  if (sense.japaneseLemmas.length >= 10) {
    reviewFlags.push("many-lemmas-in-synset");
  }

  if (selectedJapaneseLemmas.length === 0 && sense.japaneseLemmas.length > 0) {
    reviewFlags.push("no-displayable-lemma-for-primary");
  }

  return {
    pos: sense.pos,
    synset: sense.synset,
    definitions: selectedJapaneseLemmas,
    allJapaneseLemmas: sense.japaneseLemmas,
    senseRank: sense.rank,
    tagCount: sense.freq,
    score,
    rankReason: [
      Number.isFinite(sense.rank)
        ? `sense rank ${sense.rank} used as a weak lower-is-better signal`
        : "no sense rank available",
      Number.isFinite(sense.freq)
        ? `tag count/freq ${sense.freq} used as a weak higher-is-better signal`
        : "no tag count/freq available",
      `selected ${selectedJapaneseLemmas.length} representative lemma(s) from ${sense.japaneseLemmas.length} lemma(s) in this synset`,
      "lemma choice is heuristic; raw Japanese WordNet lemmas are preserved",
    ].join("; "),
    reviewFlags: [...new Set(reviewFlags)],
  };
}

function selectPrimaryMeaningCandidates(senses) {
  const candidates = senses
    .filter((sense) => sense.japaneseLemmas.length > 0)
    .map(buildSensePrimaryCandidate)
    .filter((candidate) => candidate.definitions.length > 0)
    .sort((a, b) => a.score - b.score || a.pos.localeCompare(b.pos) || a.synset.localeCompare(b.synset));
  const selected = [];
  const usedSynsets = new Set();
  const usedDefinitions = new Set();
  const bestScore = candidates[0]?.score ?? 0;

  function addCandidate(candidate) {
    const key = `${candidate.pos}:${candidate.definitions.join("|")}`;

    if (selected.length >= MAX_PRIMARY_MEANINGS || usedSynsets.has(candidate.synset) || usedDefinitions.has(key)) {
      return false;
    }

    selected.push(candidate);
    usedSynsets.add(candidate.synset);
    usedDefinitions.add(key);
    return true;
  }

  if (candidates[0]) {
    addCandidate(candidates[0]);
  }

  for (const candidate of candidates) {
    if (selected.length >= MAX_PRIMARY_MEANINGS) {
      break;
    }

    if (selected.some((selectedCandidate) => selectedCandidate.pos === candidate.pos)) {
      continue;
    }

    if (candidate.score <= bestScore + 1500) {
      addCandidate(candidate);
    }
  }

  for (const candidate of candidates) {
    if (selected.length >= MAX_PRIMARY_MEANINGS) {
      break;
    }

    addCandidate(candidate);
  }

  return {
    selected: selected.map((candidate, index) => ({
      pos: candidate.pos,
      definitions: candidate.definitions,
      synset: candidate.synset,
      rankReason: candidate.rankReason,
      primaryRank: index + 1,
    })),
    candidates,
    viableCandidateCount: candidates.length,
  };
}

function buildMeanings(senses) {
  const grouped = new Map();

  for (const sense of senses) {
    if (!grouped.has(sense.pos)) {
      grouped.set(sense.pos, []);
    }

    grouped.get(sense.pos).push(...sense.japaneseLemmas);
  }

  return [...grouped.entries()]
    .map(([pos, definitions]) => ({
      pos,
      definitions: uniqueOrdered(definitions),
    }))
    .filter((meaning) => meaning.definitions.length > 0);
}

function buildReviewFlags({
  senses,
  uniqueJapaneseLemmas,
  rawJapaneseLemmas,
  normalizedDuplicateCount,
  primaryCandidateInfo,
}) {
  const flags = [];

  if (uniqueJapaneseLemmas.length === 0) {
    flags.push("no-japanese-lemmas");
  }

  if (uniqueJapaneseLemmas.length >= 10) {
    flags.push("many-japanese-lemmas");
  }

  if (senses.length >= 10) {
    flags.push("many-synsets");
  }

  if (
    normalizedDuplicateCount >= 10 ||
    (rawJapaneseLemmas.length >= 10 && normalizedDuplicateCount / rawJapaneseLemmas.length >= 0.5)
  ) {
    flags.push("heavy-duplicate-japanese-lemmas");
  }

  if (uniqueJapaneseLemmas.some(isVeryLongJapaneseLemma)) {
    flags.push("very-long-japanese-lemma");
  }

  if (uniqueJapaneseLemmas.some(hasUnnaturalJapaneseCharacters)) {
    flags.push("unnatural-japanese-characters");
  }

  if (primaryCandidateInfo.viableCandidateCount > MAX_PRIMARY_MEANINGS) {
    flags.push("primary-candidates-truncated");
  }

  if (primaryCandidateInfo.candidates.some((candidate) => candidate.reviewFlags.length > 0)) {
    flags.push("sense-level-review-flags");
  }

  return flags;
}

function normalizeRank(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractWords(database, schema, entries) {
  const englishSensesByWord = findEnglishSensesForWords(database, schema, entries);
  const synsets = uniqueOrdered([...englishSensesByWord.values()].flat().map((sense) => sense.synset));
  const japaneseLemmasBySynset = findJapaneseLemmasForSynsets(database, schema, synsets);
  const japaneseGlossesBySynset = findJapaneseGlossesForSynsets(database, schema, synsets);

  return entries.map((entry) => {
    const englishSenses = englishSensesByWord.get(entry.word.toLowerCase()) ?? [];
    const senses = englishSenses.map((sense) => {
      const lemmaRows = japaneseLemmasBySynset.get(sense.synset) ?? [];
      const normalizedLemmaInfo = normalizeLemmaRows(lemmaRows);
      const japaneseGlosses = uniqueOrdered(japaneseGlossesBySynset.get(sense.synset) ?? []);

      return {
        synset: sense.synset,
        pos: posLabel(sense.pos),
        rawPos: sense.pos,
        rank: normalizeRank(sense.rank),
        freq: normalizeRank(sense.freq),
        lexid: normalizeRank(sense.lexid),
        rawJapaneseLemmas: lemmaRows.map((row) => String(row.lemma ?? "")),
        japaneseLemmas: normalizedLemmaInfo.entries.map((lemmaEntry) => lemmaEntry.lemma),
        japaneseLemmaEntries: normalizedLemmaInfo.entries,
        lemmaDuplicateCount: normalizedLemmaInfo.duplicateCount,
        lemmaReviewFlags: normalizedLemmaInfo.variantFlags,
        japaneseGloss: japaneseGlosses[0] ?? "",
        japaneseGlosses,
      };
    });
    const rawJapaneseLemmas = senses.flatMap((sense) => sense.rawJapaneseLemmas);
    const normalizedJapaneseLemmas = rawJapaneseLemmas.map(normalizeJapaneseLemma).filter((lemma) => lemma.length > 0);
    const uniqueJapaneseLemmas = uniqueOrdered(normalizedJapaneseLemmas);
    const normalizedDuplicateCount = normalizedJapaneseLemmas.length - uniqueJapaneseLemmas.length;
    const meanings = buildMeanings(senses);
    const legacyPrimaryMeaningCandidates = selectLegacyPrimaryMeaningCandidates(senses);
    const primaryCandidateInfo = selectPrimaryMeaningCandidates(senses);
    const reviewFlags = buildReviewFlags({
      senses,
      uniqueJapaneseLemmas,
      rawJapaneseLemmas,
      normalizedDuplicateCount,
      primaryCandidateInfo,
    });

    return {
      word: entry.word,
      level: entry.level,
      found: senses.length > 0,
      numberOfSynsets: senses.length,
      japaneseLemmaCount: uniqueJapaneseLemmas.length,
      meanings,
      primaryMeaningCandidates: primaryCandidateInfo.selected,
      legacyPrimaryMeaningCandidates,
      primaryCandidateSenses: primaryCandidateInfo.candidates,
      reviewFlags,
      senses,
    };
  });
}

function summarize(results) {
  const reviewFlagCounts = results.reduce((counts, entry) => {
    for (const flag of entry.reviewFlags) {
      counts[flag] = (counts[flag] ?? 0) + 1;
    }

    return counts;
  }, {});

  return {
    sampleWords: results.length,
    englishEntriesFound: results.filter((entry) => entry.found).length,
    japaneseMeaningsFound: results.filter((entry) => entry.japaneseLemmaCount > 0).length,
    noJapaneseMeanings: results.filter((entry) => entry.japaneseLemmaCount === 0).length,
    multipleSynsets: results.filter((entry) => entry.numberOfSynsets > 1).length,
    multipleSenses: results.filter((entry) => entry.numberOfSynsets > 1).length,
    manyJapaneseLemmas: reviewFlagCounts["many-japanese-lemmas"] ?? 0,
    primaryCandidatesTruncated: reviewFlagCounts["primary-candidates-truncated"] ?? 0,
    heavyDuplicateJapaneseLemmas: reviewFlagCounts["heavy-duplicate-japanese-lemmas"] ?? 0,
    reviewRequired: results.filter((entry) => entry.reviewFlags.length > 0).length,
    reviewFlagCounts,
  };
}

function buildPrimaryReviewRows(words) {
  return words.flatMap((wordEntry) => {
    const primaryRankBySynset = new Map(
      wordEntry.primaryMeaningCandidates.map((candidate) => [candidate.synset, candidate.primaryRank]),
    );

    return wordEntry.primaryCandidateSenses.map((candidate) => ({
      word: wordEntry.word,
      level: wordEntry.level,
      pos: candidate.pos,
      synset: candidate.synset,
      allJapaneseLemmas: candidate.allJapaneseLemmas.join("|"),
      selectedJapaneseLemmas: candidate.definitions.join("|"),
      senseRank: candidate.senseRank ?? "",
      tagCount: candidate.tagCount ?? "",
      primaryRank: primaryRankBySynset.get(candidate.synset) ?? "",
      rankReason: candidate.rankReason,
      reviewFlags: candidate.reviewFlags.join("|"),
    }));
  });
}

function buildPrimaryComparisonRows(words, limit = 20) {
  return words.slice(0, limit).map((entry) => ({
    word: entry.word,
    beforePrimaryCandidates: entry.legacyPrimaryMeaningCandidates,
    afterPrimaryCandidates: entry.primaryMeaningCandidates,
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const dbPath = await ensureDatabase(options.db);
  const wordMaster = readJson(options.wordMaster);
  const sampleWords = sampleWordMaster(wordMaster, options.sampleSize);
  const database = new DatabaseSync(dbPath, { readOnly: true });

  try {
    const schema = inspectSchema(database);
    const words = extractWords(database, schema, sampleWords);
    const summary = summarize(words);

    writeFile(
      options.outJson,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          dbPath: options.db,
          wordMasterPath: options.wordMaster,
          sampleStrategy:
            "Deterministic even sampling by app level: 17 words from Level 1, 17 from Level 2, and 16 from Level 3 for a 50-word sample.",
          primaryMeaningCandidateNote:
            "Primary candidates are selected per synset, not per flattened lemma. Japanese WordNet v1.1 sense rank and freq/tag-count fields are used as weak heuristic signals when present, but they are not treated as modern usage frequency. Representative Japanese lemmas are chosen heuristically for concision and display naturalness. All synsets and raw lemmas remain in senses.",
          schema,
          summary,
          words,
        },
        null,
        2,
      )}\n`,
    );
    writeCsv(
      options.outCsv,
      words.map((entry) => ({
        word: entry.word,
        level: entry.level,
        found: entry.found,
        numberOfSynsets: entry.numberOfSynsets,
        japaneseLemmaCount: entry.japaneseLemmaCount,
        meanings: entry.meanings,
        primaryMeaningCandidates: entry.primaryMeaningCandidates,
        legacyPrimaryMeaningCandidates: entry.legacyPrimaryMeaningCandidates,
        reviewFlags: entry.reviewFlags.join("|"),
      })),
      [
        "word",
        "level",
        "found",
        "numberOfSynsets",
        "japaneseLemmaCount",
        "meanings",
        "primaryMeaningCandidates",
        "legacyPrimaryMeaningCandidates",
        "reviewFlags",
      ],
    );
    writeCsv(options.outPrimaryReview, buildPrimaryReviewRows(words), [
      "word",
      "level",
      "pos",
      "synset",
      "allJapaneseLemmas",
      "selectedJapaneseLemmas",
      "senseRank",
      "tagCount",
      "primaryRank",
      "rankReason",
      "reviewFlags",
    ]);
    writeCsv(options.outComparison, buildPrimaryComparisonRows(words), [
      "word",
      "beforePrimaryCandidates",
      "afterPrimaryCandidates",
    ]);

    console.log("Japanese WordNet sample extraction");
    console.log("----------------------------------");
    console.log(`Sample words: ${summary.sampleWords}`);
    console.log(`English entries found: ${summary.englishEntriesFound}`);
    console.log(`Japanese meanings found: ${summary.japaneseMeaningsFound}`);
    console.log(`No Japanese meanings: ${summary.noJapaneseMeanings}`);
    console.log(`Multiple synsets: ${summary.multipleSynsets}`);
    console.log(`Many Japanese lemmas: ${summary.manyJapaneseLemmas}`);
    console.log(`Primary candidates truncated: ${summary.primaryCandidatesTruncated}`);
    console.log(`Heavy duplicate Japanese lemmas: ${summary.heavyDuplicateJapaneseLemmas}`);
    console.log(`Review required: ${summary.reviewRequired}`);
    console.log("");
    console.log("Review flags:");
    for (const [flag, count] of Object.entries(summary.reviewFlagCounts)) {
      console.log(`- ${flag}: ${count}`);
    }
    console.log("");
    console.log("Schema mapping:");
    console.log(`- English/Japanese words: ${schema.mapping.word.name}`);
    console.log(`- Senses/synsets: ${schema.mapping.sense.name}`);
    console.log(`- Japanese glosses: ${schema.mapping.gloss.name}`);
    console.log("");
    console.log("Sample files generated:");
    console.log(`- ${options.outJson}`);
    console.log(`- ${options.outCsv}`);
    console.log(`- ${options.outPrimaryReview}`);
    console.log(`- ${options.outComparison}`);
  } finally {
    database.close();
  }
}

export {
  ensureDatabase,
  extractWords,
  inspectSchema,
  readJson,
  summarize,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
