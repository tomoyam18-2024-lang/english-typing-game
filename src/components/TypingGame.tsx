"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LEVEL_OPTIONS,
  getLevelLabel,
  getLevelWordCount,
  getWordsForLevel,
  type GameWordEntry,
  type LevelMode,
} from "@/data/gameWords";

const DEFAULT_GAME_DURATION_SECONDS = 60;
const GAME_DURATION_OPTIONS = [
  { seconds: 60, label: "1 Minute" },
  { seconds: 120, label: "2 Minutes" },
] as const;
const PERFECT_BONUS_INTERVAL = 8;
const PERFECT_BONUS_SECONDS = 2;
const BONUS_MESSAGE_DURATION_MS = 1000;
const COUNTDOWN_STEPS = ["3", "2", "1", "GO"] as const;
const COUNTDOWN_STEP_MS = 750;

type GameStatus = "ready" | "countdown" | "playing" | "finished";
type GameDurationSeconds = (typeof GAME_DURATION_OPTIONS)[number]["seconds"];

const POS_LABELS: Record<string, string> = {
  noun: "名詞",
  verb: "動詞",
  adjective: "形容詞",
  adverb: "副詞",
  preposition: "前置詞",
  conjunction: "接続詞",
  interjection: "間投詞",
  pronoun: "代名詞",
  abbreviation: "略語",
};

function formatPos(pos: string) {
  return pos
    .split("/")
    .map((part) => POS_LABELS[part.trim()] ?? part.trim())
    .join("/");
}

function createWordOrder(sourceWords: GameWordEntry[], avoidFirstWord?: string) {
  const shuffledWords = [...sourceWords];

  for (let index = shuffledWords.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffledWords[index], shuffledWords[randomIndex]] = [shuffledWords[randomIndex], shuffledWords[index]];
  }

  if (avoidFirstWord && shuffledWords.length > 1 && shuffledWords[0]?.word === avoidFirstWord) {
    const swapIndex = shuffledWords.findIndex((word, index) => index > 0 && word.word !== avoidFirstWord);

    if (swapIndex > 0) {
      [shuffledWords[0], shuffledWords[swapIndex]] = [shuffledWords[swapIndex], shuffledWords[0]];
    }
  }

  return shuffledWords;
}

function parseLevelMode(value: string | undefined): LevelMode | null {
  if (value === "all") {
    return "all";
  }

  const numericLevel = Number(value);

  return numericLevel === 1 || numericLevel === 2 || numericLevel === 3 ? numericLevel : null;
}

function parseDuration(value: string | undefined): GameDurationSeconds | null {
  const numericDuration = Number(value);

  return numericDuration === 60 || numericDuration === 120 ? numericDuration : null;
}

function formatDuration(seconds: GameDurationSeconds) {
  return GAME_DURATION_OPTIONS.find((option) => option.seconds === seconds)?.label ?? "1 Minute";
}

export function TypingGame() {
  const [status, setStatus] = useState<GameStatus>("ready");
  const [selectedLevel, setSelectedLevel] = useState<LevelMode>(1);
  const [selectedDuration, setSelectedDuration] = useState<GameDurationSeconds>(DEFAULT_GAME_DURATION_SECONDS);
  const [timeLeft, setTimeLeft] = useState(DEFAULT_GAME_DURATION_SECONDS);
  const [score, setScore] = useState(0);
  const [misses, setMisses] = useState(0);
  const [perfectStreak, setPerfectStreak] = useState(0);
  const [maxPerfectStreak, setMaxPerfectStreak] = useState(0);
  const [completedWordCount, setCompletedWordCount] = useState(0);
  const [perfectWordCount, setPerfectWordCount] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [missedWords, setMissedWords] = useState<GameWordEntry[]>([]);
  const [showPerfectBonus, setShowPerfectBonus] = useState(false);
  const [countdownIndex, setCountdownIndex] = useState(0);
  const [wordIndex, setWordIndex] = useState(0);
  const [typedLength, setTypedLength] = useState(0);
  const [wordOrder, setWordOrder] = useState<GameWordEntry[]>([]);
  const gameRef = useRef<HTMLDivElement>(null);
  const currentWordHadMissRef = useRef(false);
  const bonusMessageTimeoutRef = useRef<number | null>(null);
  const countdownTimeoutRef = useRef<number | null>(null);

  const playableWords = useMemo(() => getWordsForLevel(selectedLevel), [selectedLevel]);
  const currentWord = wordOrder[wordIndex];
  const isPlaying = status === "playing";
  const countdownValue = COUNTDOWN_STEPS[countdownIndex] ?? COUNTDOWN_STEPS[0];
  const averageWpm = useMemo(() => {
    if (elapsedSeconds === 0) {
      return 0;
    }

    return completedWordCount / (elapsedSeconds / 60);
  }, [completedWordCount, elapsedSeconds]);

  const clearBonusMessage = useCallback(() => {
    if (bonusMessageTimeoutRef.current !== null) {
      window.clearTimeout(bonusMessageTimeoutRef.current);
      bonusMessageTimeoutRef.current = null;
    }
  }, []);

  const clearCountdown = useCallback(() => {
    if (countdownTimeoutRef.current !== null) {
      window.clearTimeout(countdownTimeoutRef.current);
      countdownTimeoutRef.current = null;
    }
  }, []);

  const startGame = useCallback((levelOverride?: LevelMode) => {
    const nextPlayableWords = levelOverride ? getWordsForLevel(levelOverride) : playableWords;

    if (nextPlayableWords.length === 0) {
      return;
    }

    clearBonusMessage();
    clearCountdown();
    if (levelOverride !== undefined) {
      setSelectedLevel(levelOverride);
    }
    setStatus("countdown");
    setTimeLeft(selectedDuration);
    setScore(0);
    setMisses(0);
    setPerfectStreak(0);
    setMaxPerfectStreak(0);
    setCompletedWordCount(0);
    setPerfectWordCount(0);
    setElapsedSeconds(0);
    setMissedWords([]);
    currentWordHadMissRef.current = false;
    setShowPerfectBonus(false);
    setCountdownIndex(0);
    setWordIndex(0);
    setTypedLength(0);
    setWordOrder(createWordOrder(nextPlayableWords));
  }, [clearBonusMessage, clearCountdown, playableWords, selectedDuration]);

  const changeLevel = useCallback(() => {
    clearBonusMessage();
    clearCountdown();
    setStatus("ready");
    setTimeLeft(selectedDuration);
    setScore(0);
    setMisses(0);
    setPerfectStreak(0);
    setMaxPerfectStreak(0);
    setCompletedWordCount(0);
    setPerfectWordCount(0);
    setElapsedSeconds(0);
    setMissedWords([]);
    setShowPerfectBonus(false);
    setCountdownIndex(0);
    setWordIndex(0);
    setTypedLength(0);
    setWordOrder([]);
    currentWordHadMissRef.current = false;
  }, [clearBonusMessage, clearCountdown, selectedDuration]);

  const selectDuration = useCallback((duration: GameDurationSeconds) => {
    setSelectedDuration(duration);
    setTimeLeft(duration);
  }, []);

  const moveToNextWord = useCallback(() => {
    if (!currentWord) {
      return;
    }

    setTypedLength(0);
    currentWordHadMissRef.current = false;

    if (wordIndex + 1 < wordOrder.length) {
      setWordIndex((index) => index + 1);
      return;
    }

    setWordOrder(createWordOrder(playableWords, currentWord.word));
    setWordIndex(0);
  }, [currentWord, playableWords, wordIndex, wordOrder.length]);

  const showBonusMessage = useCallback(() => {
    clearBonusMessage();
    setShowPerfectBonus(true);
    bonusMessageTimeoutRef.current = window.setTimeout(() => {
      setShowPerfectBonus(false);
      bonusMessageTimeoutRef.current = null;
    }, BONUS_MESSAGE_DURATION_MS);
  }, [clearBonusMessage]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        if (event.repeat) {
          return;
        }

        if (status === "ready") {
          const target = event.target instanceof HTMLElement ? event.target : null;
          const targetButton = target?.closest("button");
          const targetDuration = parseDuration(targetButton?.dataset.durationSeconds);
          const targetLevel = parseLevelMode(targetButton?.dataset.levelMode);

          event.preventDefault();
          if (targetDuration !== null) {
            selectDuration(targetDuration);
            return;
          }

          startGame(targetLevel ?? undefined);
        }

        return;
      }

      if (event.key === "Escape") {
        if (event.repeat) {
          return;
        }

        if (status === "countdown" || status === "playing" || status === "finished") {
          event.preventDefault();
          changeLevel();
        }

        return;
      }

      if (!isPlaying || !currentWord || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (event.key.length !== 1 || !/^[a-zA-Z]$/.test(event.key)) {
        return;
      }

      event.preventDefault();

      const expectedCharacter = currentWord.word[typedLength];
      const typedCharacter = event.key.toLowerCase();

      if (typedCharacter !== expectedCharacter) {
        setMisses((currentMisses) => currentMisses + 1);
        setPerfectStreak(0);

        if (!currentWordHadMissRef.current) {
          setMissedWords((currentMissedWords) => {
            const alreadyRecorded = currentMissedWords.some((missedWord) => missedWord.word === currentWord.word);

            return alreadyRecorded ? currentMissedWords : [...currentMissedWords, currentWord];
          });
        }

        currentWordHadMissRef.current = true;
        return;
      }

      const nextTypedLength = typedLength + 1;

      if (nextTypedLength === currentWord.word.length) {
        setScore((currentScore) => currentScore + currentWord.word.length * 10);
        setCompletedWordCount((currentCount) => currentCount + 1);

        if (!currentWordHadMissRef.current) {
          const nextStreak = perfectStreak + 1;

          setPerfectStreak(nextStreak);
          setPerfectWordCount((currentCount) => currentCount + 1);
          setMaxPerfectStreak((currentMaxStreak) => Math.max(currentMaxStreak, nextStreak));

          if (nextStreak % PERFECT_BONUS_INTERVAL === 0) {
            setTimeLeft((currentTimeLeft) => currentTimeLeft + PERFECT_BONUS_SECONDS);
            showBonusMessage();
          }
        }

        moveToNextWord();
        return;
      }

      setTypedLength(nextTypedLength);
    },
    [
      changeLevel,
      currentWord,
      isPlaying,
      moveToNextWord,
      perfectStreak,
      selectDuration,
      showBonusMessage,
      startGame,
      status,
      typedLength,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  useEffect(() => {
    if (status !== "countdown") {
      return;
    }

    gameRef.current?.focus();
    countdownTimeoutRef.current = window.setTimeout(() => {
      countdownTimeoutRef.current = null;

      if (countdownIndex >= COUNTDOWN_STEPS.length - 1) {
        setStatus("playing");
        return;
      }

      setCountdownIndex((currentIndex) => currentIndex + 1);
    }, COUNTDOWN_STEP_MS);

    return () => {
      clearCountdown();
    };
  }, [clearCountdown, countdownIndex, status]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    gameRef.current?.focus();
    const timerId = window.setInterval(() => {
      setElapsedSeconds((currentElapsedSeconds) => currentElapsedSeconds + 1);
      setTimeLeft((currentTimeLeft) => {
        if (currentTimeLeft <= 1) {
          setStatus("finished");
          return 0;
        }

        return currentTimeLeft - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      clearBonusMessage();
      clearCountdown();
    };
  }, [clearBonusMessage, clearCountdown]);

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#18231f] text-[#18231f]">
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/images/study-workspace-bg.jpg')" }}
      />
      <div aria-hidden="true" className="fixed inset-0 bg-[#f8faf7]/82 backdrop-blur-[1.5px]" />
      <section
        ref={gameRef}
        tabIndex={-1}
        className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-4 outline-none sm:px-8 sm:py-6"
      >
        <header className="mb-3 flex justify-end">
          <a
            href="/credits"
            className="border border-[#cfd8cf]/80 bg-white/72 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-[#40706a] shadow-[3px_3px_0_rgba(24,35,31,0.06)] backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f0a202]/45"
          >
            Credits
          </a>
        </header>

        {status === "ready" ? (
          <StartScreen
            onSelectDuration={selectDuration}
            onStartLevel={startGame}
            selectedDuration={selectedDuration}
            selectedLevel={selectedLevel}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 border border-[#cfd8cf]/85 bg-white/82 p-4 text-center shadow-[6px_6px_0_rgba(24,35,31,0.08)] backdrop-blur-md sm:grid-cols-4 sm:gap-4">
              <Stat label="残り時間" value={`${timeLeft}s`} tone="teal" />
              <Stat label="スコア" value={score.toLocaleString()} tone="ink" />
              <Stat label="ミス" value={misses.toLocaleString()} tone="red" />
              <Stat label="Streak" value={perfectStreak.toLocaleString()} tone="gold" />
            </div>
            {status === "countdown" || status === "playing" ? (
              <p className="mt-3 text-right text-xs font-bold uppercase tracking-[0.14em] text-[#6b756f]">
                Esc : Exit
              </p>
            ) : null}
            <div className="mt-2 flex min-h-14 items-center justify-center">
              {isPlaying && showPerfectBonus ? (
                <div className="pointer-events-none border border-[#f0a202] bg-white px-5 py-3 text-center text-xl font-black text-[#0f766e] shadow-[5px_5px_0_#f0a202] sm:text-2xl">
                  PERFECT! +2 sec
                </div>
              ) : null}
            </div>

            <div className="flex flex-1 flex-col items-center justify-center gap-5 py-4 text-center">
              <div className="w-full">
                <p className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-[#40706a]">
                  {status === "finished" ? "Result" : getLevelLabel(selectedLevel)}
                </p>

                {status === "finished" ? (
                  <ResultScreen
                    averageWpm={averageWpm}
                    completedWordCount={completedWordCount}
                    durationLabel={formatDuration(selectedDuration)}
                    levelLabel={getLevelLabel(selectedLevel)}
                    maxPerfectStreak={maxPerfectStreak}
                    missedWords={missedWords}
                    misses={misses}
                    onChangeLevel={changeLevel}
                    onRetry={startGame}
                    perfectWordCount={perfectWordCount}
                    score={score}
                  />
                ) : status === "countdown" ? (
                  <CountdownScreen value={countdownValue} />
                ) : currentWord ? (
                  <>
                    <WordDisplay typedLength={typedLength} word={currentWord} />
                    <MeaningList word={currentWord} />
                    <TypedInputLine typedLength={typedLength} word={currentWord} />
                  </>
                ) : null}
              </div>

              {status === "playing" ? (
                <button
                  type="button"
                  onClick={() => startGame()}
                  aria-label="現在のレベルでゲームをリスタート"
                  className="min-h-12 border border-[#18231f] bg-[#18231f] px-7 text-base font-bold text-white shadow-[5px_5px_0_#f0a202] transition hover:-translate-y-0.5 hover:shadow-[7px_7px_0_#f0a202] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f0a202]/45"
                >
                  リスタート
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

type StartScreenProps = {
  onSelectDuration: (duration: GameDurationSeconds) => void;
  onStartLevel: (level: LevelMode) => void;
  selectedDuration: GameDurationSeconds;
  selectedLevel: LevelMode;
};

function StartScreen({ onSelectDuration, onStartLevel, selectedDuration, selectedLevel }: StartScreenProps) {
  return (
    <div className="flex flex-1 flex-col justify-center py-4 sm:py-8">
      <div className="mx-auto w-full max-w-4xl border border-white/65 bg-white/68 px-4 py-6 shadow-[10px_10px_0_rgba(24,35,31,0.08)] backdrop-blur-md sm:px-7 sm:py-7">
        <div className="mb-6 text-center sm:mb-8">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#40706a]">English Typing</p>
          <h1 className="mt-3 text-4xl font-black text-[#18231f] sm:text-6xl md:text-7xl">English Typing</h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm font-bold leading-7 text-[#4f5d56] sm:text-base">
            意味を確認しながら英単語をタイプ。60秒間でハイスコアを目指そう。
          </p>
          <p className="mx-auto mt-3 max-w-xl border border-[#d7dfd6] bg-white/76 px-3 py-2 text-xs font-bold text-[#6b756f] sm:hidden">
            キーボードを使用できるPCでのプレイを推奨します。
          </p>
        </div>

        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-[#40706a]">Choose Time</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {GAME_DURATION_OPTIONS.map((option) => {
              const selected = option.seconds === selectedDuration;

              return (
                <button
                  key={option.seconds}
                  type="button"
                  data-duration-seconds={String(option.seconds)}
                  onClick={() => onSelectDuration(option.seconds)}
                  aria-pressed={selected}
                  aria-label={`${option.label}を選択`}
                  className={`min-h-16 border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f0a202]/45 ${
                    selected
                      ? "border-[#18231f] bg-white shadow-[5px_5px_0_#f0a202]"
                      : "border-[#cfd8cf] bg-white shadow-[4px_4px_0_#dce6dc] hover:-translate-y-0.5"
                  }`}
                >
                  <span className="block text-xl font-black text-[#18231f]">{option.label}</span>
                  <span className="mt-1 block text-sm font-bold text-[#6b756f]">{option.seconds} sec</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-7">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-[#40706a]">Choose Level</h2>
          <p className="mt-2 text-xs font-bold text-[#6b756f]">カードをクリックするとすぐにカウントダウンが始まります。</p>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {LEVEL_OPTIONS.map((option) => {
            const selected = option.mode === selectedLevel;

            return (
              <button
                key={String(option.mode)}
                type="button"
                data-level-mode={String(option.mode)}
                onClick={() => onStartLevel(option.mode)}
                aria-pressed={selected}
                aria-label={`${option.label} ${option.title}でゲームを開始`}
                className={`min-h-28 border px-4 py-4 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f0a202]/45 sm:min-h-32 sm:px-5 ${
                  selected
                    ? "border-[#18231f] bg-white shadow-[6px_6px_0_#f0a202]"
                    : "border-[#cfd8cf] bg-white shadow-[4px_4px_0_#dce6dc] hover:-translate-y-0.5"
                }`}
              >
                <span className="text-xs font-black uppercase tracking-[0.16em] text-[#40706a]">{option.label}</span>
                <span className="mt-2 block text-2xl font-black text-[#18231f]">{option.title}</span>
                <span className="mt-2 block text-sm font-bold text-[#6b756f]">{option.description}</span>
                <span className="mt-4 block text-lg font-black text-[#0f766e]">
                  {getLevelWordCount(option.mode).toLocaleString()} words
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-8 text-center">
          <div className="flex flex-wrap justify-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[#6b756f]">
            <span className="border border-[#d7dfd6] bg-white/80 px-3 py-2">Enter : Start</span>
            <span className="border border-[#d7dfd6] bg-white/80 px-3 py-2">Esc : Exit</span>
          </div>
        </div>
      </div>
    </div>
  );
}

type CountdownScreenProps = {
  value: string;
};

function CountdownScreen({ value }: CountdownScreenProps) {
  return (
    <div className="mx-auto flex min-h-[22rem] w-full max-w-2xl flex-col items-center justify-center border border-[#cfd8cf]/85 bg-white/78 px-6 py-10 shadow-[8px_8px_0_rgba(240,162,2,0.28)] backdrop-blur-md">
      <p className="text-sm font-black uppercase tracking-[0.22em] text-[#40706a]">Ready</p>
      <p key={value} className="countdown-pop mt-5 font-mono text-8xl font-black leading-none text-[#18231f] sm:text-9xl">
        {value}
      </p>
    </div>
  );
}

type WordDisplayProps = {
  typedLength: number;
  word: GameWordEntry;
};

function WordDisplay({ typedLength, word }: WordDisplayProps) {
  return (
    <div className="mx-auto flex min-h-20 max-w-full flex-wrap justify-center font-mono text-4xl font-black leading-none drop-shadow-[0_2px_0_rgba(255,255,255,0.85)] sm:min-h-24 sm:text-6xl md:text-7xl lg:text-8xl">
      {word.word.split("").map((character, index) => {
        const state = index < typedLength ? "typed" : index === typedLength ? "current" : "waiting";

        return (
          <span
            key={`${word.word}-${index}`}
            className={
              state === "typed"
                ? "text-[#0f766e]"
                : state === "current"
                  ? "border-b-4 border-[#f0a202] text-[#18231f]"
                  : "text-[#a7b1ab]"
            }
          >
            {character}
          </span>
        );
      })}
    </div>
  );
}

function TypedInputLine({ typedLength, word }: WordDisplayProps) {
  const typedText = word.word.slice(0, typedLength);
  const remainingText = word.word.slice(typedLength);

  return (
    <div className="mx-auto mt-4 flex min-h-12 w-full max-w-2xl flex-wrap items-center justify-center border-y border-[#d7dfd6] bg-white/82 px-4 font-mono text-lg font-black shadow-[4px_4px_0_rgba(24,35,31,0.06)] backdrop-blur-sm sm:text-2xl md:text-3xl">
      <span className="text-[#0f766e]">{typedText}</span>
      <span className="text-[#c1cac4]">{remainingText}</span>
    </div>
  );
}

type MeaningListProps = {
  word: GameWordEntry;
};

function MeaningList({ word }: MeaningListProps) {
  const meanings = word.primaryMeanings.slice(0, 3);

  return (
    <div className="mx-auto mt-3 grid min-h-36 w-full max-w-2xl content-start gap-2 text-left sm:min-h-40">
      {meanings.map((meaning) => (
        <div
          key={`${word.word}-${meaning.pos}-${meaning.definitions.join("-")}`}
          className="grid grid-cols-[4.75rem_1fr] items-center border border-[#d7dfd6] bg-white/90 px-3 py-2.5 shadow-[4px_4px_0_rgba(24,35,31,0.07)] backdrop-blur-sm sm:grid-cols-[5.5rem_1fr] sm:px-4"
        >
          <div className="mr-3 inline-flex justify-center border border-[#cfd8cf] bg-[#f8faf7] px-2 py-1 text-xs font-black text-[#40706a]">
            {formatPos(meaning.pos)}
          </div>
          <p className="break-words text-base font-bold text-[#d94c3f] sm:text-xl md:text-2xl">
            {meaning.definitions.join("・")}
          </p>
        </div>
      ))}
    </div>
  );
}

function formatMeaningSummary(word: GameWordEntry) {
  return word.primaryMeanings.map((meaning) => `${formatPos(meaning.pos)}: ${meaning.definitions.join("・")}`).join(" / ");
}

type ResultScreenProps = {
  averageWpm: number;
  completedWordCount: number;
  durationLabel: string;
  levelLabel: string;
  maxPerfectStreak: number;
  missedWords: GameWordEntry[];
  misses: number;
  onChangeLevel: () => void;
  onRetry: () => void;
  perfectWordCount: number;
  score: number;
};

function ResultScreen({
  averageWpm,
  completedWordCount,
  durationLabel,
  levelLabel,
  maxPerfectStreak,
  missedWords,
  misses,
  onChangeLevel,
  onRetry,
  perfectWordCount,
  score,
}: ResultScreenProps) {
  return (
    <div className="mx-auto w-full max-w-3xl border border-[#cfd8cf] bg-white text-left shadow-[8px_8px_0_#dce6dc]">
      <div className="px-5 py-6 text-center sm:px-8">
        <p className="text-base font-bold text-[#40706a]">{levelLabel}</p>
        <p className="mt-1 text-sm font-bold text-[#6b756f]">{durationLabel}</p>
        <p className="mt-2 text-base font-bold text-[#40706a]">最終スコア</p>
        <p className="mt-3 text-6xl font-black text-[#18231f] sm:text-7xl">{score.toLocaleString()}</p>
      </div>

      <div className="grid border-t border-[#d7dfd6] sm:grid-cols-2">
        <ResultMetric label="入力した単語数" value={completedWordCount.toLocaleString()} />
        <ResultMetric label="正しく入力した単語数" value={perfectWordCount.toLocaleString()} />
        <ResultMetric label="タイプミス数" value={misses.toLocaleString()} tone="red" />
        <ResultMetric label="最高コンボ" value={maxPerfectStreak.toLocaleString()} tone="gold" />
        <ResultMetric label="平均WPM" value={averageWpm.toFixed(1)} tone="teal" wide />
      </div>

      <div className="border-t border-[#d7dfd6] px-5 py-5 sm:px-8">
        <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#6b756f]">間違えた単語一覧</p>
        {missedWords.length === 0 ? (
          <p className="mt-3 text-lg font-bold text-[#0f766e]">なし</p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {missedWords.map((word) => (
              <li
                key={word.word}
                className="border border-[#d7dfd6] bg-[#f8faf7] px-3 py-2 text-sm font-bold text-[#18231f]"
              >
                <span className="font-mono">{word.word}</span>
                <span className="ml-2 text-[#6b756f]">{formatMeaningSummary(word)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-[#d7dfd6] px-5 py-6 text-center sm:flex-row sm:justify-center sm:px-8">
        <button
          type="button"
          onClick={() => onRetry()}
          className="min-h-12 border border-[#18231f] bg-[#18231f] px-8 text-base font-bold text-white shadow-[5px_5px_0_#f0a202] transition hover:-translate-y-0.5 hover:shadow-[7px_7px_0_#f0a202] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f0a202]/45"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={onChangeLevel}
          className="min-h-12 border border-[#18231f] bg-white px-8 text-base font-bold text-[#18231f] shadow-[5px_5px_0_#dce6dc] transition hover:-translate-y-0.5 hover:shadow-[7px_7px_0_#dce6dc] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f0a202]/45"
        >
          Change Level
        </button>
      </div>
      <p className="border-t border-[#d7dfd6] px-5 py-4 text-center text-xs font-bold uppercase tracking-[0.14em] text-[#6b756f] sm:px-8">
        Esc : Change Level
      </p>
    </div>
  );
}

type ResultMetricProps = {
  label: string;
  value: string;
  tone?: "teal" | "red" | "ink" | "gold";
  wide?: boolean;
};

function ResultMetric({ label, value, tone = "ink", wide = false }: ResultMetricProps) {
  const toneClass = {
    teal: "text-[#0f766e]",
    red: "text-[#d94c3f]",
    ink: "text-[#18231f]",
    gold: "text-[#b77900]",
  }[tone];

  return (
    <div className={`border-b border-[#d7dfd6] px-5 py-4 sm:px-8 ${wide ? "sm:col-span-2" : ""}`}>
      <p className="text-sm font-bold text-[#6b756f]">{label}</p>
      <p className={`mt-1 text-3xl font-black ${toneClass}`}>{value}</p>
    </div>
  );
}

type StatProps = {
  label: string;
  value: string;
  tone: "teal" | "red" | "ink" | "gold";
};

function Stat({ label, value, tone }: StatProps) {
  const toneClass = {
    teal: "text-[#0f766e]",
    red: "text-[#d94c3f]",
    ink: "text-[#18231f]",
    gold: "text-[#b77900]",
  }[tone];

  return (
    <div className="min-w-0">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#6b756f] sm:text-sm">{label}</p>
      <p className={`mt-2 truncate text-2xl font-black sm:text-4xl ${toneClass}`}>{value}</p>
    </div>
  );
}
