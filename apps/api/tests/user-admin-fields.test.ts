import { ORMError } from "@zenstackhq/orm";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { authDb, db } from "@/lib/db";

/** The admin plugin's fields live on User, which users may update: they must stay server-only. */

const id = `t_${Math.random().toString(36).slice(2, 8)}_admin`;
const me = () => authDb.$setAuth({ id, email: `${id}@test.local`, role: null });

beforeAll(async () => {
  await db.user.create({ data: { id, email: `${id}@test.local`, name: "Eve" } });
});
afterAll(async () => {
  await db.user.delete({ where: { id } });
});

it("lets users edit their profile", async () => {
  const u = await me().user.update({ where: { id }, data: { title: "Engineer" } });
  expect(u.title).toBe("Engineer");
});

for (const data of [
  { role: "admin" },
  { banned: true },
  { banReason: "x" },
  { email: "other@test.local" },
  { permissions: [{ model: "User", actions: ["delete"] }] },
]) {
  it(`rejects self-update of ${Object.keys(data)[0]}`, async () => {
    const err = await me()
      .user.update({ where: { id }, data })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ORMError);
  });
}
