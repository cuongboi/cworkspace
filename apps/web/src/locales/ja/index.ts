/** 日本語 UI 文言: です・ます調で短く、丁寧に。 */
import type { Messages } from "../en"
import type { DeepStrings } from "./types"
import { common } from "./common"
import { nav } from "./nav"
import { account } from "./account"
import { auth } from "./auth"
import { shell } from "./shell"
import { feed } from "./feed"
import { groups } from "./groups"
import { wiki } from "./wiki"
import { chat } from "./chat"
import { call } from "./call"
import { calendar } from "./calendar"
import { people } from "./people"
import { notifications } from "./notifications"
import { settings } from "./settings"
import { onboarding } from "./onboarding"
import { errors } from "./errors"

export const ja: DeepStrings<Messages> = {
  common,
  nav,
  account,
  auth,
  shell,
  feed,
  groups,
  wiki,
  chat,
  call,
  calendar,
  people,
  notifications,
  settings,
  onboarding,
  errors,
}
