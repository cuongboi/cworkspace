import { createHmac } from "node:crypto";
import { Elysia } from "elysia";
import { env } from "@/env";
import { authMacro } from "../plugins/auth";

/** short-lived: a leaked credential relays through our TURN for at most an hour */
const TTL_SECONDS = 60 * 60;

const list = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * GET /api/rtc/ice → RTCIceServer[] for WebRTC. STUN always; TURN when configured, with
 * time-limited credentials (coturn `use-auth-secret` / TURN REST API), so no long-lived TURN
 * password ever reaches the browser. Without TURN, peers behind strict NATs can't connect.
 */
export const rtcRoute = new Elysia({ name: "routes.rtc" }).use(authMacro).get(
  "/api/rtc/ice",
  ({ user, set }) => {
    const stun = list(env.STUN_URLS);
    const iceServers: { urls: string[]; username?: string; credential?: string }[] = [
      { urls: stun.length ? stun : ["stun:stun.l.google.com:19302"] },
    ];
    const turn = list(env.TURN_URLS);
    if (turn.length && env.TURN_SECRET) {
      const username = `${Math.floor(Date.now() / 1000) + TTL_SECONDS}:${user.id}`;
      const credential = createHmac("sha1", env.TURN_SECRET).update(username).digest("base64");
      iceServers.push({ urls: turn, username, credential });
    }
    set.headers["cache-control"] = "private, no-store";
    return { data: { iceServers, ttl: TTL_SECONDS } };
  },
  { auth: true, detail: { tags: ["Calls"], summary: "STUN/TURN servers for WebRTC" } },
);
