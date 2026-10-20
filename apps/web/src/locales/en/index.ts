/** English UI strings, one module per feature area. Japanese mirrors this shape (`ja/*` is type-checked against it). */
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
import { errors } from "./errors"

export const en = {
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
  errors,
}

export type Messages = typeof en
