# Word data generation

Use the generator when you want to create game-ready word data from an external dictionary source without rewriting game code.

```text
pnpm generate:words
```

The default test setup reads:

- `scripts/test-words.json`: 20-30 English words plus their level.
- `scripts/test-dictionary.json`: a local dictionary fixture that imitates external dictionary records.

It writes:

```text
src/data/generatedWords.ts
```

The output shape is:

```ts
{
  word: string;
  level: number;
  primaryMeanings: {
    pos: string;
    definition: string;
  }[];
  meanings: {
    pos: string;
    definitions: string[];
  }[];
}
```

Multiple dictionary records with the same `word` and `pos` are merged into a single meaning, and every Japanese definition is kept in `meanings[].definitions`.

`primaryMeanings` is the short game-display subset. It keeps at most 3 entries, one concise definition per prioritized part of speech. For future Japanese WordNet imports, feed sense rank or usage frequency into dictionary entry order or the optional `rank` field so common senses come first. Rare, archaic, overly technical, or near-duplicate meanings should stay in `meanings` but rank lower for `primaryMeanings`.

For a larger source, keep the same boundary: add a dictionary importer that normalizes records to `{ word, pos, definitions }`, then let `scripts/generate-word-data.mjs` build the game data. Do not write generated data directly into `src/data/words.ts` or the game component.
