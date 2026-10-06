# Japanese WordNet source notes

Place the official Japanese WordNet v1.1 SQLite database file at:

```text
data/wordnet/wnjpn.db
```

If you only have the official gzip archive, place it at:

```text
data/wordnet/wnjpn.db.gz
```

Then run:

```text
pnpm word:wordnet-sample
```

The sample command will stream-decompress `wnjpn.db.gz` to `wnjpn.db` if the DB file is missing. The database files are ignored by Git.

The sample command does not modify `src/data/wordMaster.json`, `src/data/words.ts`, or the game UI. It writes review output to:

```text
reports/wordnet-sample.json
reports/wordnet-sample.csv
reports/wordnet-primary-review.csv
reports/wordnet-primary-comparison.csv
```

It extracts English lemma to synset mappings, Japanese lemmas from the same synsets, Japanese glosses for review context, grouped full meanings, synset-level heuristic primary meaning candidates, and before/after primary-candidate comparison rows.

The older game-data importer remains available for small fixtures:

```text
node scripts/generate-wordnet-words.mjs --db data/wordnet/wnjpn.db --words data/wordnet/words.json --out work/generatedWords.json
```
