import path from "node:path";
import { cors } from "@elysia/cors";
import { openapi } from "@elysia/openapi";
import { staticPlugin } from "@elysia/static";
import { Elysia } from "elysia";
import { env } from "@/env";
import * as pkg from "../package.json";
import { notFound, toErrorResponse } from "./lib/errors";
import { BetterAuthOpenApi, betterAuthPlugin } from "./plugins/auth";
import { callsRoute } from "./routes/calls";
import { captionsRoute } from "./routes/captions";
import { channelsRoute } from "./routes/channels";
import { conversationsRoute } from "./routes/conversations";
import { executeRoute } from "./routes/execute";
import { filesRoute } from "./routes/files";
import { groupsRoute } from "./routes/groups";
import { hooksRoute } from "./routes/hooks";
import { invitationsRoute } from "./routes/invitations";
import { linkPreviewRoute } from "./routes/link-preview";
import { pushRoute } from "./routes/push";
import { rtcRoute } from "./routes/rtc";
import { uploadsRoute } from "./routes/uploads";
import { serveIndex, serveManifest } from "./server/spa";
import { webSocketPlugin } from "./websocket";

const ASSET_PATH = path.join(import.meta.dir, "public");

/** The whole server (API, auth, `/ws`, SPA) without `listen`, so tests can call `app.handle()`. */
export const app = new Elysia()
  .use(
    cors({
      origin: env.WEB_ORIGIN.split(","),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      exposeHeaders: ["set-auth-jwt", "set-auth-token"],
    }),
  )
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: { message: error.message, code: "INVALID_INPUT" } };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: { message: "Not found", code: "NOT_FOUND" } };
    }

    const { status, body } = toErrorResponse(error);
    set.status = status;
    return body;
  })
  .use(
    openapi({
      documentation: {
        info: { title: pkg.name, description: pkg.description, version: pkg.version },
        paths: (await BetterAuthOpenApi.paths()) as never,
        components: (await BetterAuthOpenApi.components()) as never,
      },
      scalar: { hideModels: true },
    }),
  )
  .get("/health", () => ({ ok: true }))
  .use(betterAuthPlugin)
  .use(executeRoute)
  .use(uploadsRoute)
  .use(filesRoute)
  .use(conversationsRoute)
  .use(groupsRoute)
  .use(channelsRoute)
  .use(hooksRoute)
  .use(invitationsRoute)
  .use(linkPreviewRoute)
  .use(rtcRoute)
  .use(callsRoute)
  .use(pushRoute)
  .use(captionsRoute)
  .use(webSocketPlugin())
  // unknown API paths answer with the JSON envelope, not the SPA's index.html
  .get("/api/*", () => {
    throw notFound();
  })
  // generated from APP_NAME / APP_INFO, so the static file must never shadow it
  .get("/manifest.webmanifest", serveManifest)
  // last: its `/*` wildcard would shadow every route registered after it
  .use(
    staticPlugin({
      assets: ASSET_PATH,
      prefix: "/",
      alwaysStatic: true,
      // the raw template has no branding; `*` below serves the rendered shell
      indexHTML: false,
      // regexes: the plugin tests string patterns backwards (`pattern.includes(path)`), so
      // strings, its default dotfile list included, never match
      ignorePatterns: [/^\/(index\.html|manifest\.webmanifest)$/, /(^|\/)\.(env|git|DS_Store)/],
    }),
  )
  .get("*", (ctx) => serveIndex(ASSET_PATH, ctx));

export type App = typeof app;
