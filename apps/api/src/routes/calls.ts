import { Elysia, t } from "elysia";
import { authMacro } from "../plugins/auth";
import { declineCall } from "../websocket/calls";

/** Call actions without a socket: the push notification's Decline button (service worker). */
export const callsRoute = new Elysia({ name: "routes.calls" }).use(authMacro).post(
  "/api/calls/:callId/decline",
  async ({ user, userDb, params }) => {
    await declineCall(user, userDb, params.callId);
    return { data: { ok: true } };
  },
  {
    auth: true,
    params: t.Object({ callId: t.String({ minLength: 1, maxLength: 64 }) }),
    detail: { tags: ["Calls"], summary: "Decline a ringing call" },
  },
);
