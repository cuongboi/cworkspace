import type { DeepStrings } from "./types"
import type { shell as en } from "../en/shell"

export const shell: DeepStrings<typeof en> = {
  back: "戻る",
  forward: "進む",
  contacts: "連絡先",
  inviteTeam: "チームを招待して始めましょう。",
  search: {
    trigger: "検索",
    description: "{{company}} 内を検索",
    placeholder: "{{company}} 内を検索…",
    tabs: {
      all: "すべての結果",
      user: "メンバー",
      group: "グループ",
      post: "投稿",
      message: "メッセージ",
      file: "ファイル",
    },
    minChars: "{{count}}文字以上入力して検索してください。",
    recent: "最近の検索",
    today: "今日",
    yesterday: "昨日",
    noResultsFor: "「{{q}}」に一致する結果はありません。",
    searchAll: "「{{q}}」をすべて検索",
  },
  searchPage: {
    resultsFor: "「{{q}}」の検索結果",
    emptyTitle: "ワークプレイスを検索",
    emptyDescription: "社内のメンバー、グループ、投稿を検索できます。",
    placeholder: "メンバー、グループ、投稿を検索",
    noPeople: "メンバーが見つかりません。",
    noGroups: "グループが見つかりません。",
    noPosts: "投稿が見つかりません。",
  },
}
