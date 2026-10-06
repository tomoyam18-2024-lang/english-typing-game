export type WordMeaning = {
  pos: string;
  definitions: string[];
};

export type PrimaryMeaning = {
  pos: string;
  definition: string;
};

export type WordEntry = {
  word: string;
  level: number;
  primaryMeanings: PrimaryMeaning[];
  meanings: WordMeaning[];
};

export const words: WordEntry[] = [
  {
    word: "apple",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "りんご" }],
    meanings: [{ pos: "名詞", definitions: ["りんご"] }],
  },
  {
    word: "banana",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "バナナ" }],
    meanings: [{ pos: "名詞", definitions: ["バナナ"] }],
  },
  {
    word: "orange",
    level: 1,
    primaryMeanings: [
      { pos: "名詞", definition: "オレンジ" },
      { pos: "形容詞", definition: "オレンジ色の" },
    ],
    meanings: [
      { pos: "名詞", definitions: ["オレンジ", "オレンジ色"] },
      { pos: "形容詞", definitions: ["オレンジ色の"] },
    ],
  },
  {
    word: "grape",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "ぶどう" }],
    meanings: [{ pos: "名詞", definitions: ["ぶどう"] }],
  },
  {
    word: "lemon",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "レモン" }],
    meanings: [{ pos: "名詞", definitions: ["レモン"] }],
  },
  {
    word: "water",
    level: 1,
    primaryMeanings: [
      { pos: "名詞", definition: "水" },
      { pos: "動詞", definition: "水をやる" },
    ],
    meanings: [
      { pos: "名詞", definitions: ["水"] },
      { pos: "動詞", definitions: ["水をやる"] },
    ],
  },
  {
    word: "coffee",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "コーヒー" }],
    meanings: [{ pos: "名詞", definitions: ["コーヒー"] }],
  },
  {
    word: "school",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "学校" }],
    meanings: [{ pos: "名詞", definitions: ["学校"] }],
  },
  {
    word: "teacher",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "先生・教師" }],
    meanings: [{ pos: "名詞", definitions: ["先生", "教師"] }],
  },
  {
    word: "student",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "生徒・学生" }],
    meanings: [{ pos: "名詞", definitions: ["生徒", "学生"] }],
  },
  {
    word: "friend",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "友達" }],
    meanings: [{ pos: "名詞", definitions: ["友達"] }],
  },
  {
    word: "family",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "家族" }],
    meanings: [{ pos: "名詞", definitions: ["家族", "家庭"] }],
  },
  {
    word: "mother",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "母・母親" }],
    meanings: [{ pos: "名詞", definitions: ["母", "母親"] }],
  },
  {
    word: "father",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "父・父親" }],
    meanings: [{ pos: "名詞", definitions: ["父", "父親"] }],
  },
  {
    word: "sister",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "姉・妹" }],
    meanings: [{ pos: "名詞", definitions: ["姉", "妹", "姉妹"] }],
  },
  {
    word: "brother",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "兄・弟" }],
    meanings: [{ pos: "名詞", definitions: ["兄", "弟", "兄弟"] }],
  },
  {
    word: "morning",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "朝" }],
    meanings: [{ pos: "名詞", definitions: ["朝", "午前"] }],
  },
  {
    word: "night",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "夜" }],
    meanings: [{ pos: "名詞", definitions: ["夜", "晩"] }],
  },
  {
    word: "window",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "窓" }],
    meanings: [{ pos: "名詞", definitions: ["窓"] }],
  },
  {
    word: "garden",
    level: 1,
    primaryMeanings: [
      { pos: "名詞", definition: "庭" },
      { pos: "動詞", definition: "庭仕事をする" },
    ],
    meanings: [
      { pos: "名詞", definitions: ["庭", "庭園"] },
      { pos: "動詞", definitions: ["庭仕事をする"] },
    ],
  },
  {
    word: "market",
    level: 2,
    primaryMeanings: [
      { pos: "名詞", definition: "市場" },
      { pos: "動詞", definition: "販売する" },
    ],
    meanings: [
      { pos: "名詞", definitions: ["市場", "マーケット"] },
      { pos: "動詞", definitions: ["販売する", "売り込む"] },
    ],
  },
  {
    word: "station",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "駅" }],
    meanings: [{ pos: "名詞", definitions: ["駅", "署", "放送局"] }],
  },
  {
    word: "library",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "図書館" }],
    meanings: [{ pos: "名詞", definitions: ["図書館", "蔵書"] }],
  },
  {
    word: "hospital",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "病院" }],
    meanings: [{ pos: "名詞", definitions: ["病院"] }],
  },
  {
    word: "airport",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "空港" }],
    meanings: [{ pos: "名詞", definitions: ["空港"] }],
  },
  {
    word: "music",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "音楽" }],
    meanings: [{ pos: "名詞", definitions: ["音楽"] }],
  },
  {
    word: "movie",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "映画" }],
    meanings: [{ pos: "名詞", definitions: ["映画"] }],
  },
  {
    word: "picture",
    level: 1,
    primaryMeanings: [
      { pos: "名詞", definition: "写真・絵" },
      { pos: "動詞", definition: "想像する" },
    ],
    meanings: [
      { pos: "名詞", definitions: ["写真", "絵", "画像"] },
      { pos: "動詞", definitions: ["想像する", "心に描く"] },
    ],
  },
  {
    word: "letter",
    level: 1,
    primaryMeanings: [
      { pos: "名詞", definition: "手紙" },
      { pos: "名詞", definition: "文字" },
    ],
    meanings: [{ pos: "名詞", definitions: ["手紙", "文字"] }],
  },
  {
    word: "question",
    level: 1,
    primaryMeanings: [
      { pos: "名詞", definition: "質問" },
      { pos: "動詞", definition: "質問する" },
    ],
    meanings: [
      { pos: "名詞", definitions: ["質問", "問題"] },
      { pos: "動詞", definitions: ["質問する", "疑う"] },
    ],
  },
  {
    word: "answer",
    level: 1,
    primaryMeanings: [
      { pos: "名詞", definition: "答え" },
      { pos: "動詞", definition: "答える" },
    ],
    meanings: [
      { pos: "名詞", definitions: ["答え", "回答"] },
      { pos: "動詞", definitions: ["答える", "返事をする"] },
    ],
  },
  {
    word: "travel",
    level: 1,
    primaryMeanings: [
      { pos: "名詞", definition: "旅行" },
      { pos: "動詞", definition: "旅行する" },
    ],
    meanings: [
      { pos: "名詞", definitions: ["旅行"] },
      { pos: "動詞", definitions: ["旅行する", "移動する"] },
    ],
  },
  {
    word: "listen",
    level: 1,
    primaryMeanings: [{ pos: "動詞", definition: "聞く" }],
    meanings: [{ pos: "動詞", definitions: ["聞く", "耳を傾ける"] }],
  },
  {
    word: "speak",
    level: 1,
    primaryMeanings: [{ pos: "動詞", definition: "話す" }],
    meanings: [{ pos: "動詞", definitions: ["話す", "発言する"] }],
  },
  {
    word: "write",
    level: 1,
    primaryMeanings: [{ pos: "動詞", definition: "書く" }],
    meanings: [{ pos: "動詞", definitions: ["書く", "手紙を書く"] }],
  },
  {
    word: "read",
    level: 1,
    primaryMeanings: [{ pos: "動詞", definition: "読む" }],
    meanings: [{ pos: "動詞", definitions: ["読む", "読書する"] }],
  },
  {
    word: "learn",
    level: 1,
    primaryMeanings: [{ pos: "動詞", definition: "学ぶ" }],
    meanings: [{ pos: "動詞", definitions: ["学ぶ", "習得する"] }],
  },
  {
    word: "practice",
    level: 2,
    primaryMeanings: [
      { pos: "名詞", definition: "練習" },
      { pos: "動詞", definition: "練習する" },
    ],
    meanings: [
      { pos: "名詞", definitions: ["練習", "実践"] },
      { pos: "動詞", definitions: ["練習する", "実践する"] },
    ],
  },
  {
    word: "remember",
    level: 2,
    primaryMeanings: [
      { pos: "動詞", definition: "覚えている" },
      { pos: "動詞", definition: "思い出す" },
    ],
    meanings: [{ pos: "動詞", definitions: ["覚えている", "思い出す"] }],
  },
  {
    word: "forget",
    level: 2,
    primaryMeanings: [{ pos: "動詞", definition: "忘れる" }],
    meanings: [{ pos: "動詞", definitions: ["忘れる"] }],
  },
  {
    word: "beautiful",
    level: 2,
    primaryMeanings: [{ pos: "形容詞", definition: "美しい・きれいな" }],
    meanings: [{ pos: "形容詞", definitions: ["美しい", "きれいな"] }],
  },
  {
    word: "important",
    level: 2,
    primaryMeanings: [{ pos: "形容詞", definition: "重要な・大切な" }],
    meanings: [{ pos: "形容詞", definitions: ["重要な", "大切な"] }],
  },
  {
    word: "different",
    level: 2,
    primaryMeanings: [{ pos: "形容詞", definition: "違った・異なる" }],
    meanings: [{ pos: "形容詞", definitions: ["違った", "異なる"] }],
  },
  {
    word: "favorite",
    level: 2,
    primaryMeanings: [
      { pos: "形容詞", definition: "お気に入りの" },
      { pos: "名詞", definition: "お気に入り" },
    ],
    meanings: [
      { pos: "形容詞", definitions: ["お気に入りの", "大好きな"] },
      { pos: "名詞", definitions: ["お気に入り"] },
    ],
  },
  {
    word: "delicious",
    level: 2,
    primaryMeanings: [{ pos: "形容詞", definition: "おいしい" }],
    meanings: [{ pos: "形容詞", definitions: ["おいしい"] }],
  },
  {
    word: "weather",
    level: 1,
    primaryMeanings: [
      { pos: "名詞", definition: "天気" },
      { pos: "動詞", definition: "切り抜ける" },
    ],
    meanings: [
      { pos: "名詞", definitions: ["天気", "天候"] },
      { pos: "動詞", definitions: ["切り抜ける", "風雨にさらす"] },
    ],
  },
  {
    word: "season",
    level: 1,
    primaryMeanings: [
      { pos: "名詞", definition: "季節" },
      { pos: "動詞", definition: "味付けする" },
    ],
    meanings: [
      { pos: "名詞", definitions: ["季節", "時期"] },
      { pos: "動詞", definitions: ["味付けする"] },
    ],
  },
  {
    word: "country",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "国" }],
    meanings: [{ pos: "名詞", definitions: ["国", "田舎"] }],
  },
  {
    word: "language",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "言語・言葉" }],
    meanings: [{ pos: "名詞", definitions: ["言語", "言葉"] }],
  },
  {
    word: "computer",
    level: 1,
    primaryMeanings: [{ pos: "名詞", definition: "コンピューター" }],
    meanings: [{ pos: "名詞", definitions: ["コンピューター", "計算機"] }],
  },
];
