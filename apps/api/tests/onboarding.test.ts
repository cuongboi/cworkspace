import { describe, expect, it } from "bun:test";
import { env } from "@/env";
import { checkSetupToken, onboardingRequired, signUpAllowed } from "@/server/onboarding";
import { app } from "../src/app";

/**
 * First-run setup must not let a stranger become admin. These run against an instance that
 * already has users (the test database); the empty-instance path needs its own database.
 */

const origin = new URL(env.WEB_ORIGIN.split(",")[0]!).origin;
const body = {
  name: "Mallory",
  email: "mallory@test.local",
  password: "correct horse battery",
  settings: {},
};

const post = (headers: Record<string, string>, payload: unknown = body) =>
  app.handle(
    new Request("http://localhost/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(payload),
    }),
  );

describe("onboarding", () => {
  it("reports only whether it is required", async () => {
    const res = await app.handle(new Request("http://localhost/api/onboarding"));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ data: { required: false } });
  });

  it("refuses cross-site requests", async () => {
    const res = await post({ origin: "https://evil.test", "x-setup-token": "x" });
    expect(res.status).toBe(403);
  });

  it("answers 409 once the workspace is set up, whatever the token", async () => {
    const res = await post({ origin, "x-setup-token": "guess" });
    expect(res.status).toBe(409);
  });

  it("rejects unknown fields and weak passwords", async () => {
    expect((await post({ origin }, { ...body, role: "admin" })).status).toBe(400);
    expect((await post({ origin }, { ...body, password: "short" })).status).toBe(400);
  });

  it("has no valid token and leaves sign-up open on a set-up instance", () => {
    expect(onboardingRequired()).toBe(false);
    expect(checkSetupToken("anything")).toBe(false);
    expect(checkSetupToken(undefined)).toBe(false);
    expect(signUpAllowed()).toBe(true);
  });
});
