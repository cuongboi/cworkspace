import { describe, expect, it } from "bun:test";
import { guardExecute, MAX_TAKE, MODELS } from "@/routes/execute";
import { app } from "../src/app";

/** Contract of POST /api/execute: auth, allowlists and cost bounds (policies: policies.test.ts). */

const post = (body: unknown, headers: Record<string, string> = {}) =>
  app.handle(
    new Request("http://localhost/api/execute", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/execute", () => {
  it("requires a session", async () => {
    const res = await post({ model: "user", operator: "findMany" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a malformed body before auth matters", async () => {
    const res = await post({ model: 1 });
    expect([400, 401]).toContain(res.status);
  });
});

describe("guardExecute", () => {
  it("never routes better-auth internals", () => {
    for (const m of ["session", "account", "verification", "jwks"])
      expect(MODELS.has(m)).toBe(false);
    expect(() => guardExecute("session", "findMany", {})).toThrow();
  });

  it("has no organization models (single-company instance)", () => {
    for (const m of ["organization", "member", "memberPermission"]) {
      expect(MODELS.has(m)).toBe(false);
      expect(() => guardExecute(m, "findMany", {})).toThrow();
    }
  });

  it("allows only CRUD operators", () => {
    for (const op of ["$queryRaw", "$transaction", "$executeRaw", "constructor", "__proto__"])
      expect(() => guardExecute("user", op, {})).toThrow();
    expect(() => guardExecute("$transaction", "findMany", {})).toThrow();
  });

  it("requires object args", () => {
    expect(() => guardExecute("user", "findMany", [])).toThrow();
    expect(() => guardExecute("user", "findMany", null)).toThrow();
  });

  it("caps findMany.take and keeps its sign", () => {
    expect(guardExecute("post", "findMany", {}).take).toBe(MAX_TAKE);
    expect(guardExecute("post", "findMany", { take: 10_000 }).take).toBe(MAX_TAKE);
    expect(guardExecute("post", "findMany", { take: -10_000 }).take).toBe(-MAX_TAKE);
    expect(guardExecute("post", "findMany", { take: 5 }).take).toBe(5);
  });
});
