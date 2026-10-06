# Japanese Wiktionary source notes

Place the Japanese Wiktionary English machine-readable data here:

```text
data/wiktionary/kaikki-jawiktionary-english.jsonl
```

The expected input is Kaikki/Wiktextract JSONL for the Japanese Wiktionary `英語` dictionary. The script also accepts the same path with `.gz` appended:

```text
data/wiktionary/kaikki-jawiktionary-english.jsonl.gz
```

Run the 50-word comparison sample with:

```text
pnpm word:multi-dictionary-sample
```

This script does not scrape web pages, does not generate Japanese translations, does not update game data, and does not expand to the full 2,500-word master list. It reads the existing `reports/wordnet-sample.json` and uses this local Wiktionary JSONL file only as a second-source signal for the same 50 words.

Current source used for local testing:

```text
https://kaikki.org/jawiktionary/%E8%8B%B1%E8%AA%9E/index.html
```

Raw dictionary files are intentionally ignored by Git because they are large and have separate licensing obligations.
