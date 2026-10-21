import { Elysia, t } from "elysia";
import { db } from "@/lib/db";
import { tooManyRequests } from "@/lib/errors";
import { pushEnabled, sendPush } from "@/server/push";
import { getSettings } from "@/server/settings";
import { rateLimit } from "@/server/rate-limit";
import { authMacro } from "../plugins/auth";

const tokenBody = t.Object({ token: t.String({ minLength: 10, maxLength: 4096 }) });

/** FCM device registration. PushToken is server-only (not reachable via /api/execute). */
export const pushRoute = new Elysia({ name: "routes.push" })
  .use(authMacro)
  .get(
    "/api/push/config",
    () => {
      const f = getSettings().firebase;
      return {
        data:
          pushEnabled() && f.vapidKey && f.apiKey
            ? {
                enabled: true as const,
                vapidKey: f.vapidKey,
                firebase: {
                  apiKey: f.apiKey,
                  projectId: f.projectId,
                  appId: f.appId,
                  messagingSenderId: f.messagingSenderId,
                },
              }
            : { enabled: false as const },
      };
    },
    { auth: true, detail: { tags: ["Notifications"], summary: "Web push configuration" } },
  )
  .post(
    "/api/push/tokens",
    async ({ user, body, headers }) => {
      // each call can move a token between users and grows the table: bound it per user
      if (!rateLimit(`push-token:${user.id}`, 10, 60_000)) throw tooManyRequests();
      const userAgent = headers["user-agent"]?.slice(0, 500) ?? null;
      // a token identifies a browser: whoever signs in there last receives its pushes
      await db.pushToken.upsert({
        where: { token: body.token },
        create: { token: body.token, userId: user.id, userAgent },
        update: { userId: user.id, userAgent },
      });
      return { data: { ok: true } };
    },
    {
      auth: true,
      body: tokenBody,
      detail: { tags: ["Notifications"], summary: "Register this device for push" },
    },
  )
  .delete(
    "/api/push/tokens",
    async ({ user, body }) => {
      await db.pushToken.deleteMany({ where: { token: body.token, userId: user.id } });
      return { data: { ok: true } };
    },
    {
      auth: true,
      body: tokenBody,
      detail: { tags: ["Notifications"], summary: "Unregister this device" },
    },
  )
  .post(
    "/api/push/test",
    async ({ user }) => {
      if (!rateLimit(`push-test:${user.id}`, 5, 60_000)) throw tooManyRequests();
      await sendPush([user.id], {
        title: "Test notification",
        body: "Push notifications are working on this device.",
        url: "/notifications",
        tag: "test",
      });
      return { data: { ok: true } };
    },
    { auth: true, detail: { tags: ["Notifications"], summary: "Send a test push to yourself" } },
  );
