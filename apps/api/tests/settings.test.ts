import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { guardExecute } from "@/routes/execute";
import { authDb, db } from "@/lib/db";
import { app } from "../src/app";

/** Instance settings hold encrypted API keys: never readable through policies or /execute. */

const id = `t_${Math.random().toString(36).slice(2, 8)}_settings`;
const asAdmin = () =>
  authDb.$setAuth({ id, email: `${id}@test.local`, role: "admin", permissions: [] });

beforeAll(async () => {
  await db.user.create({ data: { id, email: `${id}@test.local`, name: "Ada" } });
});
afterAll(async () => {
  await db.user.delete({ where: { id } });
});

describe("AppSetting", () => {
  it("is denied to everyone through the policy client, admins included", async () => {
    expect(await asAdmin().appSetting.findMany({})).toEqual([]);
    const err = await asAdmin()
      .appSetting.create({ data: { id: `x_${id}` } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
  });

  it("is not routed by /api/execute", () => {
    expect(() => guardExecute("appSetting", "findMany", {})).toThrow();
  });

  it("answers 401 to anonymous admin-settings requests", async () => {
    const res = await app.handle(new Request("http://localhost/api/admin/settings"));
    expect(res.status).toBe(401);
  });

  it("serves public branding without secrets", async () => {
    const res = await app.handle(new Request("http://localhost/api/settings/public"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"name"');
    expect(text).not.toMatch(/apiKey|clientSecret|secrets/i);
  });
});
