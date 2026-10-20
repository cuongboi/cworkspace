import type { DeepStrings } from "./types"
import type { errors as en } from "../en/errors"

export const errors: DeepStrings<typeof en> = {
  UNAUTHORIZED: "もう一度ログインしてください。",
  FORBIDDEN: "この操作を行う権限がありません。",
  PASSWORD_CHANGE_REQUIRED: "続けるにはパスワードを変更してください。",
  INVALID_INPUT: "入力内容を確認してください。",
  NOT_FOUND: "すでに存在しません。",
  CONFLICT: "すでに存在します。",
  INVALID_STATE: "現在この操作はできません。",
  UPSTREAM_ERROR:
    "外部サービスが応答していません。しばらくしてから再試行してください。",
  INTERNAL: "エラーが発生しました。もう一度お試しください。",
  NETWORK: "サーバーに接続できません。通信環境を確認してください。",
}
