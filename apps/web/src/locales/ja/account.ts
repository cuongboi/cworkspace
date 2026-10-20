import type { DeepStrings } from "./types"
import type { account as en } from "../en/account"

export const account: DeepStrings<typeof en> = {
  menu: "アカウント",
  profile: "プロフィール",
  theme: "テーマ",
  light: "ライト",
  dark: "ダーク",
  system: "システム設定",
  language: "言語",
  installApp: "アプリをインストール",
  installHint: "共有ボタンから「ホーム画面に追加」をタップしてください。",
  signOut: "ログアウト",
  settings: "アカウント設定",
  page: {
    title: "アカウント設定",
    subtitle: "パスワード、ログイン中のデバイス、通知を管理します。",
    tabs: {
      security: "セキュリティ",
      notifications: "通知",
      preferences: "表示設定",
    },
  },
  password: {
    title: "パスワードを変更",
    description:
      "8文字以上で、他のサービスと異なるパスワードを使ってください。",
    current: "現在のパスワード",
    new: "新しいパスワード",
    confirm: "新しいパスワード（確認）",
    show: "パスワードを表示",
    hide: "パスワードを隠す",
    signOutOthers: "他のすべてのデバイスからログアウト",
    signOutOthersHint:
      "パスワードが他人に知られた可能性がある場合におすすめです。",
    submit: "パスワードを更新",
    updated: "パスワードを更新しました",
    tooShort: "8文字以上で入力してください",
    mismatch: "パスワードが一致しません",
    sameAsCurrent: "現在とは異なるパスワードを入力してください",
    wrongCurrent: "現在のパスワードが正しくありません",
    failed: "パスワードを更新できませんでした",
  },
  sessions: {
    title: "ログイン中のデバイス",
    description:
      "あなたのアカウントにログインしているデバイスです。心当たりのないものはログアウトしてください。",
    thisDevice: "このデバイス",
    activeNow: "現在アクティブ",
    lastActive: "{{time}}にアクティブ",
    signedIn: "{{date}}にログイン",
    unknownIp: "不明な IP",
    unknownDevice: "不明なデバイス",
    browserOn: "{{os}} の {{browser}}",
    revoke: "ログアウト",
    revoked: "デバイスをログアウトしました",
    revokeAll: "他のすべてのデバイスからログアウト",
    revokeAllTitle: "他のすべてのデバイスからログアウトしますか？",
    revokeAllBody:
      "このアカウントにログインしている他のブラウザやアプリは1分以内にログアウトされます。このデバイスはログインしたままです。",
    revokedAll: "他のすべてのデバイスからログアウトしました",
    onlyThis: "ログインしているのはこのデバイスだけです。",
    loadFailed: "セッションを読み込めませんでした",
  },
  preferences: {
    languageDescription: "このデバイスでアプリに使う言語です。",
    themeDescription: "このデバイスでのアプリの外観を選びます。",
  },
}
