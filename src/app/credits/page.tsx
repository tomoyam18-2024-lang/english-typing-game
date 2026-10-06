import type { Metadata } from "next";
import Link from "next/link";
import gameWordsSummary from "@/data/generated/gameWordsSummary.json";

export const metadata: Metadata = {
  title: "Credits",
  description: "English Typingで使用している語彙データと辞書データのクレジットです。",
};

const dataSources = [
  {
    name: "TSL 1.2 / NAWL 1.2 / BSL 1.2 / NGSL 1.2",
    provider: "The NGSL Project",
    license: "Creative Commons Attribution-ShareAlike 4.0 International",
    url: "https://www.newgeneralservicelist.com/",
  },
  {
    name: "Japanese WordNet v1.1",
    provider: "NICT / Francis Bond / contributors",
    license: "Japanese WordNet license; English WordNet notices apply to included English data",
    url: "https://bond-lab.github.io/wnja/index.en.html",
  },
  {
    name: "Japanese Wiktionary data via Kaikki / Wiktextract",
    provider: "Japanese Wiktionary contributors, Wikimedia Foundation, Kaikki.org, Wiktextract",
    license: "CC BY-SA / GFDL, following Wiktionary source data",
    url: "https://kaikki.org/jawiktionary/",
  },
];

export default function CreditsPage() {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#18231f] text-[#18231f]">
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/images/study-workspace-bg.jpg')" }}
      />
      <div aria-hidden="true" className="fixed inset-0 bg-[#f8faf7]/86 backdrop-blur-[1.5px]" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-6 sm:px-8">
        <header className="mb-6 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="border border-[#cfd8cf]/80 bg-white/76 px-4 py-2 text-sm font-black text-[#18231f] shadow-[4px_4px_0_rgba(24,35,31,0.08)] transition hover:-translate-y-0.5 hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f0a202]/45"
          >
            Back to Game
          </Link>
        </header>

        <section className="border border-white/65 bg-white/72 px-5 py-7 shadow-[10px_10px_0_rgba(24,35,31,0.08)] backdrop-blur-md sm:px-8">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-[#40706a]">Credits</p>
          <h1 className="mt-3 text-4xl font-black text-[#18231f] sm:text-6xl">Data Sources</h1>
          <p className="mt-4 max-w-2xl text-sm font-bold leading-7 text-[#4f5d56] sm:text-base">
            English Typingは、公開語彙リストと辞書データをもとにした英単語タイピングゲームです。
            レベル表記はアプリ独自の分類であり、各試験や団体の公式レベルを示すものではありません。
          </p>

          <div className="mt-8 grid gap-4">
            {dataSources.map((source) => (
              <article key={source.name} className="border border-[#d7dfd6] bg-white/88 p-4 shadow-[4px_4px_0_rgba(24,35,31,0.07)]">
                <h2 className="text-xl font-black text-[#18231f]">{source.name}</h2>
                <dl className="mt-3 grid gap-2 text-sm font-bold leading-6 text-[#4f5d56]">
                  <div>
                    <dt className="inline text-[#40706a]">Provider: </dt>
                    <dd className="inline">{source.provider}</dd>
                  </div>
                  <div>
                    <dt className="inline text-[#40706a]">License: </dt>
                    <dd className="inline">{source.license}</dd>
                  </div>
                  <div>
                    <dt className="inline text-[#40706a]">URL: </dt>
                    <dd className="inline">
                      <a
                        href={source.url}
                        className="underline decoration-[#f0a202] decoration-2 underline-offset-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f0a202]/45"
                        rel="noreferrer"
                        target="_blank"
                      >
                        {source.url}
                      </a>
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          <section className="mt-8 border border-[#d7dfd6] bg-[#f8faf7]/88 p-4">
            <h2 className="text-xl font-black text-[#18231f]">Playable Dictionary</h2>
            <dl className="mt-3 grid gap-2 text-sm font-bold leading-6 text-[#4f5d56] sm:grid-cols-2">
              <div>
                <dt className="text-[#40706a]">Playable words</dt>
                <dd className="text-2xl font-black text-[#18231f]">{gameWordsSummary.playableWords.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-[#40706a]">Level 1</dt>
                <dd>{gameWordsSummary.levelCounts["1"].toLocaleString()} words</dd>
              </div>
              <div>
                <dt className="text-[#40706a]">Level 2</dt>
                <dd>{gameWordsSummary.levelCounts["2"].toLocaleString()} words</dd>
              </div>
              <div>
                <dt className="text-[#40706a]">Level 3</dt>
                <dd>{gameWordsSummary.levelCounts["3"].toLocaleString()} words</dd>
              </div>
            </dl>
          </section>
        </section>
      </div>
    </main>
  );
}
