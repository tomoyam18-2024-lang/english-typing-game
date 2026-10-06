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
    <main className="relative min-h-screen overflow-x-hidden bg-[#17201c] text-[#17201c]">
      <div
        aria-hidden="true"
        className="fixed inset-0 scale-[1.02] bg-cover bg-center opacity-70 blur-[0.5px]"
        style={{ backgroundImage: "url('/images/study-workspace-bg.jpg')" }}
      />
      <div aria-hidden="true" className="fixed inset-0 bg-[#f3f0e9]/80 backdrop-blur-[2px]" />
      <div
        aria-hidden="true"
        className="fixed inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 36%, rgba(255,255,255,0.48), rgba(255,255,255,0.16) 44%, rgba(20,31,28,0.18) 100%)",
        }}
      />
      <section
        ref={gameRef}
        tabIndex={-1}
        className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-4 outline-none sm:px-8 sm:py-6"
      >
        <header className="mb-3 flex justify-end">
          <a
            href="/credits"
            className="rounded-full border border-white/60 bg-white/55 px-3.5 py-2 text-xs font-semibold uppercase text-[#3d625b] shadow-[0_8px_24px_rgba(20,31,28,0.08)] backdrop-blur-xl transition duration-200 hover:-translate-y-0.5 hover:bg-white/75 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d9b85f]/40"
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
            <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-white/60 bg-white/60 p-1.5 text-center shadow-[0_18px_55px_rgba(20,31,28,0.1)] backdrop-blur-xl sm:grid-cols-4">
              <Stat label="残り時間" value={`${timeLeft}s`} tone="teal" />
              <Stat label="スコア" value={score.toLocaleString()} tone="ink" />
              <Stat label="ミス" value={misses.toLocaleString()} tone="red" />
              <Stat label="Streak" value={perfectStreak.toLocaleString()} tone="gold" />
            </div>
            {status === "countdown" || status === "playing" ? (
              <p className="mt-3 text-right text-xs font-medium uppercase text-[#69736e]">
                Esc : Exit
              </p>
            ) : null}
            <div className="mt-2 flex min-h-12 items-center justify-center">
              {isPlaying && showPerfectBonus ? (
                <div className="pointer-events-none rounded-full border border-[#dec26e]/70 bg-[#fff8e8]/85 px-5 py-2 text-center text-sm font-semibold text-[#78601b] shadow-[0_12px_32px_rgba(120,96,27,0.16)] backdrop-blur-xl sm:text-base">
                  PERFECT! +2 sec
                </div>
              ) : null}
            </div>

            <div className="flex flex-1 flex-col items-center justify-center gap-5 py-4 text-center">
              <div className="w-full">
                <p className="mb-3 text-sm font-semibold uppercase text-[#446962]">
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
                  className="min-h-12 rounded-full border border-[#17201c] bg-[#17201c] px-7 text-base font-semibold text-white shadow-[0_14px_30px_rgba(20,31,28,0.22)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#24322d] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d9b85f]/40"
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
      <div className="mx-auto w-full max-w-4xl rounded-[28px] border border-white/60 bg-white/62 px-4 py-6 shadow-[0_30px_90px_rgba(20,31,28,0.13)] backdrop-blur-2xl sm:px-8 sm:py-8">
        <div className="mb-6 text-center sm:mb-8">
          <p className="text-sm font-semibold uppercase text-[#446962]">English Typing</p>
          <h1 className="mt-3 text-4xl font-semibold text-[#17201c] sm:text-6xl md:text-7xl">English Typing</h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm font-medium leading-7 text-[#53615a] sm:text-base">
            意味を確認しながら英単語をタイプ。60秒間でハイスコアを目指そう。
          </p>
          <p className="mx-auto mt-3 max-w-xl rounded-2xl border border-white/65 bg-white/62 px-3 py-2 text-xs font-medium text-[#66716b] shadow-[0_8px_24px_rgba(20,31,28,0.06)] sm:hidden">
            キーボードを使用できるPCでのプレイを推奨します。
          </p>
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase text-[#446962]">Choose Time</h2>
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
                  className={`min-h-16 rounded-2xl border px-4 py-3 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d9b85f]/40 ${
                    selected
                      ? "border-[#2d554e]/65 bg-white/82 shadow-[0_14px_34px_rgba(20,31,28,0.11)] ring-1 ring-[#d9b85f]/45"
                      : "border-white/60 bg-white/48 shadow-[0_10px_28px_rgba(20,31,28,0.07)] hover:-translate-y-0.5 hover:border-[#b9c8c0]/85 hover:bg-white/68"
                  }`}
                >
                  <span className="block text-xl font-semibold text-[#17201c]">{option.label}</span>
                  <span className="mt-1 block text-sm font-medium text-[#66716b]">{option.seconds} sec</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-7">
          <h2 className="text-sm font-semibold uppercase text-[#446962]">Choose Level</h2>
          <p className="mt-2 text-xs font-medium text-[#66716b]">カードをクリックするとすぐにカウントダウンが始まります。</p>
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
                className={`group min-h-28 rounded-2xl border px-4 py-4 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d9b85f]/40 sm:min-h-32 sm:px-5 ${
                  selected
                    ? "border-[#2d554e]/65 bg-white/82 shadow-[0_18px_42px_rgba(20,31,28,0.12)] ring-1 ring-[#d9b85f]/45"
                    : "border-white/60 bg-white/48 shadow-[0_12px_34px_rgba(20,31,28,0.07)] hover:-translate-y-0.5 hover:border-[#b9c8c0]/85 hover:bg-white/68 hover:shadow-[0_18px_42px_rgba(20,31,28,0.1)]"
                }`}
              >
                <span className="text-xs font-semibold uppercase text-[#446962]">{option.label}</span>
                <span className="mt-2 block text-2xl font-semibold text-[#17201c]">{option.title}</span>
                <span className="mt-2 block text-sm font-medium text-[#66716b]">{option.description}</span>
                <span className="mt-4 block text-lg font-semibold text-[#1f675c]">
                  {getLevelWordCount(option.mode).toLocaleString()} words
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-8 text-center">
          <div className="flex flex-wrap justify-center gap-2 text-xs font-medium uppercase text-[#66716b]">
            <span className="rounded-full border border-white/60 bg-white/58 px-3 py-2 shadow-[0_8px_22px_rgba(20,31,28,0.06)]">
              Enter : Start
            </span>
            <span className="rounded-full border border-white/60 bg-white/58 px-3 py-2 shadow-[0_8px_22px_rgba(20,31,28,0.06)]">
              Esc : Exit
            </span>
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
    <div className="mx-auto flex min-h-[22rem] w-full max-w-2xl flex-col items-center justify-center rounded-[28px] border border-white/60 bg-white/62 px-6 py-10 shadow-[0_24px_72px_rgba(20,31,28,0.12)] backdrop-blur-2xl">
      <p className="text-sm font-semibold uppercase text-[#446962]">Ready</p>
      <p key={value} className="countdown-pop mt-5 text-8xl font-semibold leading-none text-[#17201c] sm:text-9xl">
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
    <div className="mx-auto flex min-h-20 max-w-full flex-wrap justify-center text-4xl font-semibold leading-none text-[#17201c] drop-shadow-[0_1px_0_rgba(255,255,255,0.55)] sm:min-h-24 sm:text-6xl md:text-7xl lg:text-8xl">
      {word.word.split("").map((character, index) => {
        const state = index < typedLength ? "typed" : index === typedLength ? "current" : "waiting";

        return (
          <span
            key={`${word.word}-${index}`}
            className={
              state === "typed"
                ? "text-[#1f675c]"
                : state === "current"
                  ? "border-b-4 border-[#d4af52] text-[#17201c]"
                  : "text-[#66736d]"
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
    <div className="mx-auto mt-4 flex min-h-12 w-full max-w-2xl flex-wrap items-center justify-center rounded-2xl border border-white/60 bg-white/52 px-4 text-lg font-semibold shadow-[0_12px_34px_rgba(20,31,28,0.08)] backdrop-blur-xl sm:text-2xl md:text-3xl">
      <span className="text-[#1f675c]">{typedText}</span>
      <span className="text-[#9aa49f]">{remainingText}</span>
    </div>
  );
}

type MeaningListProps = {
  word: GameWordEntry;
};

function MeaningList({ word }: MeaningListProps) {
  const meanings = word.primaryMeanings.slice(0, 3);

  return (
    <div className="mx-auto mt-3 grid min-h-36 w-full max-w-2xl content-start gap-2.5 text-left sm:min-h-40">
      {meanings.map((meaning) => (
        <div
          key={`${word.word}-${meaning.pos}-${meaning.definitions.join("-")}`}
          className="grid grid-cols-[4.75rem_1fr] items-center rounded-2xl border border-white/65 bg-white/68 px-3 py-2.5 shadow-[0_12px_32px_rgba(20,31,28,0.08)] backdrop-blur-xl sm:grid-cols-[5.5rem_1fr] sm:px-4"
        >
          <div className="mr-3 inline-flex justify-center rounded-full border border-[#cbd7d0]/80 bg-[#f6f4ee]/82 px-2 py-1 text-xs font-semibold text-[#446962]">
            {formatPos(meaning.pos)}
          </div>
          <p className="break-words text-base font-semibold text-[#263a34] sm:text-xl md:text-2xl">
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
    <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-[28px] border border-white/60 bg-white/68 text-left shadow-[0_30px_90px_rgba(20,31,28,0.13)] backdrop-blur-2xl">
      <div className="px-5 py-6 text-center sm:px-8">
        <p className="text-base font-semibold text-[#446962]">{levelLabel}</p>
        <p className="mt-1 text-sm font-medium text-[#66716b]">{durationLabel}</p>
        <p className="mt-2 text-base font-semibold text-[#446962]">最終スコア</p>
        <p className="mt-3 text-6xl font-semibold text-[#17201c] sm:text-7xl">{score.toLocaleString()}</p>
      </div>

      <div className="grid border-t border-white/60 bg-white/24 sm:grid-cols-2">
        <ResultMetric label="入力した単語数" value={completedWordCount.toLocaleString()} />
        <ResultMetric label="正しく入力した単語数" value={perfectWordCount.toLocaleString()} />
        <ResultMetric label="タイプミス数" value={misses.toLocaleString()} tone="red" />
        <ResultMetric label="最高コンボ" value={maxPerfectStreak.toLocaleString()} tone="gold" />
        <ResultMetric label="平均WPM" value={averageWpm.toFixed(1)} tone="teal" wide />
      </div>

      <div className="border-t border-white/60 px-5 py-5 sm:px-8">
        <p className="text-sm font-semibold uppercase text-[#66716b]">間違えた単語一覧</p>
        {missedWords.length === 0 ? (
          <p className="mt-3 text-lg font-semibold text-[#1f675c]">なし</p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {missedWords.map((word) => (
              <li
                key={word.word}
                className="rounded-full border border-white/65 bg-[#f6f4ee]/72 px-3 py-2 text-sm font-medium text-[#17201c] shadow-[0_8px_22px_rgba(20,31,28,0.05)]"
              >
                <span className="font-semibold">{word.word}</span>
                <span className="ml-2 text-[#66716b]">{formatMeaningSummary(word)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-white/60 px-5 py-6 text-center sm:flex-row sm:justify-center sm:px-8">
        <button
          type="button"
          onClick={() => onRetry()}
          className="min-h-12 rounded-full border border-[#17201c] bg-[#17201c] px-8 text-base font-semibold text-white shadow-[0_14px_30px_rgba(20,31,28,0.22)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#24322d] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d9b85f]/40"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={onChangeLevel}
          className="min-h-12 rounded-full border border-[#cbd7d0]/85 bg-white/58 px-8 text-base font-semibold text-[#17201c] shadow-[0_12px_28px_rgba(20,31,28,0.08)] transition duration-200 hover:-translate-y-0.5 hover:bg-white/78 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d9b85f]/40"
        >
          Change Level
        </button>
      </div>
      <p className="border-t border-white/60 px-5 py-4 text-center text-xs font-medium uppercase text-[#66716b] sm:px-8">
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
    teal: "text-[#1f675c]",
    red: "text-[#b04a3f]",
    ink: "text-[#17201c]",
    gold: "text-[#8f6f1d]",
  }[tone];

  return (
    <div className={`border-b border-white/55 px-5 py-4 sm:px-8 ${wide ? "sm:col-span-2" : ""}`}>
      <p className="text-sm font-medium text-[#66716b]">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${toneClass}`}>{value}</p>
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
    teal: "text-[#1f675c]",
    red: "text-[#b04a3f]",
    ink: "text-[#17201c]",
    gold: "text-[#8f6f1d]",
  }[tone];

  return (
    <div className="min-w-0 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3">
      <p className="text-xs font-medium uppercase text-[#66716b] sm:text-sm">{label}</p>
      <p className={`mt-1 truncate text-2xl font-semibold sm:text-4xl ${toneClass}`}>{value}</p>
    </div>
  );
}
