import { ORMError } from "@zenstackhq/orm";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { authDb, db } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { createThreadReply } from "@/server/threads";

/**
 * CHANNEL conversations and their threads (real database).
 * alice creates the channel with bob; carol is an outsider.
 */

const run = Math.random().toString(36).slice(2, 8);
const id = (name: string) => `t_${run}_${name}`;
const users = {
  alice: { id: id("alice"), email: `alice_${run}@test.local`, name: "Alice", role: "user" },
  bob: { id: id("bob"), email: `bob_${run}@test.local`, name: "Bob", role: "user" },
  carol: { id: id("carol"), email: `carol_${run}@test.local`, name: "Carol", role: "user" },
};
type Name = keyof typeof users;

async function rejected(p: PromiseLike<unknown>) {
  const err = await Promise.resolve(p).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ORMError);
}

async function httpError(p: PromiseLike<unknown>, status: number) {
  const err = await Promise.resolve(p).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status);
}

const as = (u: Name) =>
  authDb.$setAuth({ id: users[u].id, email: users[u].email, role: users[u].role, permissions: [] });
const reply = (u: Name, conversationId: string, rootId: string, content = "reply") =>
  createThreadReply(as(u), users[u].id, conversationId, rootId, { content });

let channelId: string;
let groupChatId: string;
let rootId: string;

beforeAll(async () => {
  for (const u of Object.values(users)) await db.user.create({ data: u });
  channelId = (
    await as("alice").conversation.create({
      data: {
        type: "CHANNEL",
        title: "announcements",
        members: {
          create: [{ userId: users.alice.id, role: "ADMIN" }, { userId: users.bob.id }],
        },
      },
    })
  ).id;
  groupChatId = (
    await as("alice").conversation.create({
      data: {
        type: "GROUP",
        members: {
          create: [{ userId: users.alice.id, role: "ADMIN" }, { userId: users.bob.id }],
        },
      },
    })
  ).id;
  rootId = (
    await as("alice").message.create({ data: { conversationId: channelId, content: "root" } })
  ).id;
});

afterAll(async () => {
  await db.conversation.deleteMany({ where: { id: { in: [channelId, groupChatId] } } });
  await db.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
});

describe("channel conversations", () => {
  it("are private to their members", async () => {
    expect(await as("bob").conversation.findUnique({ where: { id: channelId } })).not.toBeNull();
    expect(await as("carol").conversation.findUnique({ where: { id: channelId } })).toBeNull();
  });

  it("refuse thread replies and counter writes through the client", async () => {
    await rejected(
      as("bob").message.create({
        data: { conversationId: channelId, content: "sneaky", threadId: rootId },
      }),
    );
    await rejected(as("alice").message.update({ where: { id: rootId }, data: { replyCount: 99 } }));
  });
});

describe("createThreadReply", () => {
  it("adds a reply and bumps the root's counters", async () => {
    const created = await reply("bob", channelId, rootId);
    const row = await db.message.findUnique({ where: { id: created.id } });
    expect(row?.threadId).toBe(rootId);
    expect(row?.senderId).toBe(users.bob.id);
    const root = await db.message.findUnique({ where: { id: rootId } });
    expect(root?.replyCount).toBe(1);
    expect(root?.lastReplyAt?.getTime()).toBe(row?.createdAt.getTime());
  });

  it("keeps threads one level deep", async () => {
    const nested = await db.message.findFirst({ where: { threadId: rootId } });
    await httpError(reply("alice", channelId, nested!.id), 400);
  });

  it("only works in channels", async () => {
    const m = await as("alice").message.create({
      data: { conversationId: groupChatId, content: "x" },
    });
    await httpError(reply("bob", groupChatId, m.id), 409);
  });

  it("hides the root from outsiders", async () => {
    await httpError(reply("carol", channelId, rootId), 404);
  });

  it("rejects an empty reply", async () => {
    await httpError(reply("bob", channelId, rootId, "  "), 400);
  });
});
