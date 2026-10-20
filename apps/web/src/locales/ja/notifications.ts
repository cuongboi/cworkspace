import type { DeepStrings } from "./types"
import type { notifications as en } from "../en/notifications"

export const notifications: DeepStrings<typeof en> = {
  title: "お知らせ",
  bellLabel_one: "お知らせ (未読 {{count}}件)",
  bellLabel_other: "お知らせ (未読 {{count}}件)",
  view: "表示",
  markAllRead: "すべて既読にする",
  markAllFailed: "お知らせを既読にできませんでした",
  caughtUp: "新しいお知らせはありません",
  caughtUpBody:
    "メンション、コメント、招待、リマインダーがここに表示されます。",
  filterLabel: "お知らせを絞り込む",
  all: "すべて",
  unread: "未読",
  loadFailed: "お知らせを読み込めませんでした",
  noUnread: "未読のお知らせはありません",
  none: "お知らせはまだありません",
  noneBody:
    "メンションや投稿へのコメント、イベントへの招待、通話があると、ここに表示されます。",
  end: "すべて表示しました。",
  unreadDot: "未読",
  options: "お知らせのオプション",
  markRead: "既読にする",
  markUnread: "未読にする",
  remove: "お知らせを削除",
  someone: "誰か",
  aGroup: "グループ",
  anEvent: "イベント",
  text: {
    mentionChat: "<b>{{actor}}</b>さんがチャットであなたをメンションしました",
    mentionComment:
      "<b>{{actor}}</b>さんがコメントであなたをメンションしました",
    mentionPost: "<b>{{actor}}</b>さんが投稿であなたをメンションしました",
    postComment: "<b>{{actor}}</b>さんがあなたの投稿にコメントしました",
    commentReply: "<b>{{actor}}</b>さんがあなたのコメントに返信しました",
    postReaction:
      "<b>{{actor}}</b>さんがあなたの投稿に{{emoji}}でリアクションしました",
    groupPost: "<b>{{actor}}</b>さんが<b>{{group}}</b>に投稿しました",
    joinRequest:
      "<b>{{actor}}</b>さんが<b>{{group}}</b>への参加をリクエストしました",
    joinApproved: "<b>{{group}}</b>への参加リクエストが承認されました",
    eventInvite: "<b>{{actor}}</b>さんが<b>{{event}}</b>にあなたを招待しました",
    eventReminder: "まもなくイベントが始まります: <b>{{event}}</b>",
    missedCall: "<b>{{actor}}</b>さんからの不在着信",
    threadReply: "<b>{{actor}}</b>さんがスレッドで返信しました",
    other: "<b>{{actor}}</b>さんの新しいアクティビティ",
  },
  pwa: {
    update: "新しいバージョンがあります",
    reload: "再読み込み",
  },
}
