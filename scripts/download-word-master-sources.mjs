import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SOURCES = [
  {
    name: "TSL",
    url: "https://www.newgeneralservicelist.com/s/TSL_12_stats.csv",
    out: "data/word-master/raw/TSL_12_stats.csv",
  },
  {
    name: "NAWL",
    url: "https://www.newgeneralservicelist.com/s/NAWL_12_stats.csv",
    out: "data/word-master/raw/NAWL_12_stats.csv",
  },
  {
    name: "BSL",
    url: "https://www.newgeneralservicelist.com/s/BSL_120_stats.csv",
    out: "data/word-master/raw/BSL_120_stats.csv",
  },
  {
    name: "NGSL",
    url: "https://www.newgeneralservicelist.com/s/NGSL_12_stats.csv",
    out: "data/word-master/raw/NGSL_12_stats.csv",
  },
  {
    name: "NGSL-GR",
    url: "https://www.newgeneralservicelist.com/s/NGSL-GR_rank.csv",
    out: "data/word-master/raw/NGSL-GR_rank.csv",
  },
];

async function downloadSource(source) {
  const response = await fetch(source.url);

  if (!response.ok) {
    throw new Error(`Failed to download ${source.name}: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const outPath = path.resolve(process.cwd(), source.out);

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, text.replace(/\r\n/g, "\n"), "utf8");
  console.log(`Downloaded ${source.name}: ${source.out}`);
}

try {
  for (const source of SOURCES) {
    await downloadSource(source);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
