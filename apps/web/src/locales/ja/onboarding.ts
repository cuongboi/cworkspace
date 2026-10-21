import type { DeepStrings } from "./types"
import type { onboarding as en } from "../en/onboarding"

export const onboarding: DeepStrings<typeof en> = {
  pageTitle: "ワークスペースの設定",
  title: "ようこそ！ワークスペースを設定しましょう",
  steps: {
    account: "管理者アカウント",
    workspace: "ワークスペース",
    services: "サービス",
  },
  stepOf: "ステップ {{step}} / {{total}}",
  crossOrigin:
    "セットアップはこのサーバー自身のアドレスから完了してください。セットアップリンクを直接開いてください。",
  next: "次へ",
  back: "戻る",
  skip: "あとで設定する",
  finish: "ワークスペースを作成",
  finishing: "作成中…",
  token: {
    title: "セットアップ用リンクを開いてください",
    body: "安全のため、ユーザーがいない状態でサーバーを起動したときにコンソールに表示されるリンクが必要です。そのリンクを開くか、トークンを貼り付けてください。",
    label: "セットアップトークン",
    submit: "次へ",
    invalid:
      "このセットアップリンクは無効です。サーバーを再起動して新しいリンクを取得するか、ONBOARDING_TOKEN を確認してください。",
  },
  account: {
    body: "あなたが管理者になり、メンバー、設定、すべてのグループを管理します。",
    name: "名前",
    email: "メールアドレス",
    password: "パスワード",
    passwordHint: "8文字以上。長いパスフレーズがおすすめです。",
    confirm: "パスワード（確認）",
    weak: "8文字以上にしてください",
    mismatch: "パスワードが一致しません",
    sameAsEmail: "メールアドレスをパスワードにしないでください",
    strength: { weak: "弱い", fair: "普通", strong: "強い" },
  },
  workspace: {
    body: "全員に表示される会社の情報です。あとで設定から変更できます。",
    name: "会社名またはワークスペース名",
    description: "短い説明",
  },
  services: {
    body: "任意です。今でも、あとで設定からでも追加できます。",
    captions: "通話のライブ字幕",
    provider: "サービス",
    apiKey: "APIキー",
    email: "メール（Resend）",
    emailBody:
      "招待とパスワード再設定に使います。キーがない場合、メールはサーバーのコンソールに表示されるだけです。",
    resendKey: "Resend APIキー",
    from: "送信者",
  },
  done: "ワークスペースの準備ができました",
  alreadySetUp: "このワークスペースは設定済みです。ログインしてください。",
  failed: "設定に失敗しました",
}
