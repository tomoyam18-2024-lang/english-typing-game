import gameWordsData from "@/data/generated/gameWords.json";

export type GameLevel = 1 | 2 | 3;
export type LevelMode = GameLevel | "all";

export type GameWordMeaning = {
  pos: string;
  definitions: string[];
};

export type GameWordEntry = {
  word: string;
  level: GameLevel;
  primaryMeanings: GameWordMeaning[];
};

export type LevelOption = {
  mode: LevelMode;
  title: string;
  label: string;
  description: string;
};

export const LEVEL_OPTIONS: LevelOption[] = [
  {
    mode: 1,
    title: "Business Advanced",
    label: "Level 1",
    description: "ビジネス上級語彙",
  },
  {
    mode: 2,
    title: "Advanced",
    label: "Level 2",
    description: "上級総合語彙",
  },
  {
    mode: 3,
    title: "Academic Advanced",
    label: "Level 3",
    description: "学術・TOEFL上級語彙",
  },
  {
    mode: "all",
    title: "All Levels",
    label: "Mixed",
    description: "全レベル混合",
  },
];

export const gameWords = gameWordsData as GameWordEntry[];

export function getWordsForLevel(mode: LevelMode) {
  return mode === "all" ? gameWords : gameWords.filter((word) => word.level === mode);
}

export function getLevelWordCount(mode: LevelMode) {
  return getWordsForLevel(mode).length;
}

export function getLevelLabel(mode: LevelMode) {
  return LEVEL_OPTIONS.find((option) => option.mode === mode)?.title ?? "All Levels";
}
