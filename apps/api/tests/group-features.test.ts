import { ORMError, ORMErrorReason } from "@zenstackhq/orm";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { authDb, db } from "@/lib/db";
import { ensureGroupConversation } from "@/server/group-chat";

/**
 * Access policies of the group chat, group calls, Knowledge (wiki) and group events, against the
 * real database (DATABASE_URL from .env).
 * Users: alice, bob, dave, carol. Groups (admin: alice): PUBLIC `pub` and CLOSED `closed`.
 * bob is an ACTIVE member of both; dave is in neither, except a PENDING request to `closed`;
 * carol is in no group at all.
 */

const run = Math.random().toString(36).slice(2, 8);
const id = (name: string) => `t_${run}_${name}`;

const users = {
  alice: { id: id("alice"), email: `alice_${run}@test.local`, name: "Alice" },
  bob: { id: id("bob"), email: `bob_${run}@test.local`, name: "Bob" },
  dave: { id: id("dave"), email: `dave_${run}@test.local`, name: "Dave" },
  carol: { id: id("carol"), email: `carol_${run}@test.local`, name: "Carol" },
};

const as = (u: keyof typeof users) =>
  authDb.$setAuth({ id: users[u].id, email: users[u].email, role: "user", permissions: [] });

async function rejected(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ORMError);
  expect([ORMErrorReason.REJECTED_BY_POLICY, ORMErrorReason.NOT_FOUND]).toContain(
    (err as ORMError).reason,
  );
}

let pub: string;
let closed: string;
let pubChat: string;

beforeAll(async () => {
  for (const u of Object.values(users)) await db.user.create({ data: u });

  const mk = (privacy: "PUBLIC" | "CLOSED") =>
    as("alice").group.create({
      data: {
        name: privacy,
        slug: `gf-${privacy.toLowerCase()}-${run}`,
        privacy,
        members: {
          create: [{ userId: users.alice.id, role: "ADMIN" }, { userId: users.bob.id }],
        },
      },
    });
  pub = (await mk("PUBLIC")).id;
  closed = (await mk("CLOSED")).id;
  await as("dave").groupMember.create({
    data: { groupId: closed, userId: users.dave.id, status: "PENDING" },
  });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
});

describe("group chat", () => {
  it("is created once per group with the ACTIVE members mirrored", async () => {
    pubChat = (await ensureGroupConversation(pub))!;
    expect(await ensureGroupConversation(pub)).toBe(pubChat);
    const members = await db.conversationMember.findMany({
      where: { conversationId: pubChat },
      select: { userId: true },
    });
    expect(members.map((m) => m.userId).sort()).toEqual([users.alice.id, users.bob.id].sort());
  });

  it("is readable and writable by active group members only", async () => {
    expect(await as("bob").conversation.findUnique({ where: { id: pubChat } })).not.toBeNull();
    await as("bob").message.create({ data: { conversationId: pubChat, content: "hi" } });

    // users outside the (public) group see nothing
    expect(await as("dave").conversation.findUnique({ where: { id: pubChat } })).toBeNull();
    expect(await as("dave").message.findMany({ where: { conversationId: pubChat } })).toEqual([]);
    await rejected(
      as("dave").message.create({ data: { conversationId: pubChat, content: "let me in" } }),
    );
    expect(await as("carol").conversation.findUnique({ where: { id: pubChat } })).toBeNull();
  });

  it("is hidden from a pending member", async () => {
    const closedChat = (await ensureGroupConversation(closed))!;
    expect(await as("dave").conversation.findUnique({ where: { id: closedChat } })).toBeNull();
  });

  it("cannot be created, renamed, deleted or re-membered by clients", async () => {
    const other = await as("alice").group.create({
      data: {
        name: "other",
        slug: `gf-other-${run}`,
        members: { create: { userId: users.alice.id, role: "ADMIN" } },
      },
    });
    await rejected(
      as("alice").conversation.create({
        data: { groupId: other.id, type: "GROUP" },
      }),
    );
    await rejected(
      as("alice").conversation.update({ where: { id: pubChat }, data: { title: "renamed" } }),
    );
    await rejected(as("alice").conversation.delete({ where: { id: pubChat } }));
    await rejected(
      as("alice").conversationMember.create({
        data: { conversationId: pubChat, userId: users.dave.id },
      }),
    );
    await rejected(
      as("bob").conversationMember.delete({
        where: { conversationId_userId: { conversationId: pubChat, userId: users.bob.id } },
      }),
    );
    await rejected(
      as("alice").conversationMember.update({
        where: { conversationId_userId: { conversationId: pubChat, userId: users.bob.id } },
        data: { role: "ADMIN" },
      }),
    );
    // own read state is fine
    await as("bob").conversationMember.update({
      where: { conversationId_userId: { conversationId: pubChat, userId: users.bob.id } },
      data: { lastReadAt: new Date() },
    });
  });

  it("follows the group membership, not the mirrored rows", async () => {
    const throwaway = await as("alice").group.create({
      data: {
        name: "throwaway",
        slug: `gf-throwaway-${run}`,
        members: {
          create: [{ userId: users.alice.id, role: "ADMIN" }, { userId: users.dave.id }],
        },
      },
    });
    const chat = (await ensureGroupConversation(throwaway.id))!;
    expect(await as("dave").conversation.findUnique({ where: { id: chat } })).not.toBeNull();

    await as("alice").groupMember.delete({
      where: { groupId_userId: { groupId: throwaway.id, userId: users.dave.id } },
    });
    // a stale mirror row (e.g. the sync lagging) must not keep access
    await db.conversationMember.upsert({
      where: { conversationId_userId: { conversationId: chat, userId: users.dave.id } },
      create: { conversationId: chat, userId: users.dave.id },
      update: {},
    });
    expect(await as("dave").conversation.findUnique({ where: { id: chat } })).toBeNull();
  });

  it("drops the mirrored membership when someone leaves the group", async () => {
    const g = await as("alice").group.create({
      data: {
        name: "sync",
        slug: `gf-sync-${run}`,
        members: {
          create: [{ userId: users.alice.id, role: "ADMIN" }, { userId: users.bob.id }],
        },
      },
    });
    const chat = (await ensureGroupConversation(g.id))!;
    await as("bob").groupMember.delete({
      where: { groupId_userId: { groupId: g.id, userId: users.bob.id } },
    });
    // the realtime plugin syncs after commit; give it a moment
    await Bun.sleep(100);
    expect(
      await db.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId: chat, userId: users.bob.id } },
      }),
    ).toBeNull();
  });

  it("group calls are visible to active members only", async () => {
    const call = await db.call.create({
      data: { conversationId: pubChat, startedById: users.alice.id },
    });
    expect(await as("bob").call.findUnique({ where: { id: call.id } })).not.toBeNull();
    expect(await as("dave").call.findUnique({ where: { id: call.id } })).toBeNull();
    expect(await as("carol").call.findUnique({ where: { id: call.id } })).toBeNull();
  });
});

describe("knowledge (wiki)", () => {
  let pubPage: string;
  let closedPage: string;

  it("members create pages with their first revision", async () => {
    const page = await as("bob").wikiPage.create({
      data: {
        groupId: pub,
        title: "Onboarding",
        content: "# Hello",
        revisions: { create: { title: "Onboarding", content: "# Hello" } },
      },
      include: { revisions: true },
    });
    pubPage = page.id;
    expect(page.revisions).toHaveLength(1);
    expect(page.revisions[0]!.authorId).toBe(users.bob.id);

    closedPage = (
      await as("alice").wikiPage.create({ data: { groupId: closed, title: "Secret plans" } })
    ).id;
  });

  it("follows group privacy for reads", async () => {
    // PUBLIC: everyone reads
    expect(await as("dave").wikiPage.findUnique({ where: { id: pubPage } })).not.toBeNull();
    expect(await as("dave").wikiRevision.findMany({ where: { pageId: pubPage } })).toHaveLength(1);
    // CLOSED: members only (a pending request is not membership)
    expect(await as("bob").wikiPage.findUnique({ where: { id: closedPage } })).not.toBeNull();
    expect(await as("dave").wikiPage.findUnique({ where: { id: closedPage } })).toBeNull();
    // anonymous never
    expect(await authDb.wikiPage.findUnique({ where: { id: pubPage } })).toBeNull();
  });

  it("only members write, as themselves", async () => {
    await rejected(as("dave").wikiPage.create({ data: { groupId: pub, title: "Drive-by" } }));
    await rejected(
      as("dave").wikiPage.update({ where: { id: pubPage }, data: { title: "Vandalized" } }),
    );
    await rejected(
      as("bob").wikiPage.create({
        data: { groupId: pub, title: "Forged", createdById: users.alice.id },
      }),
    );
    await rejected(
      as("bob").wikiRevision.create({
        data: { pageId: pubPage, title: "x", content: "x", authorId: users.alice.id },
      }),
    );
  });

  it("guards saves with the version (no lost updates)", async () => {
    const saved = await as("bob").wikiPage.update({
      where: { id: pubPage, version: 0 },
      data: {
        content: "v1",
        version: { increment: 1 },
        revisions: { create: { title: "Onboarding", content: "v1" } },
      },
    });
    expect(saved.version).toBe(1);
    // a second editor who opened version 0 can't overwrite it
    await rejected(
      as("alice").wikiPage.update({
        where: { id: pubPage, version: 0 },
        data: { content: "stale", version: { increment: 1 } },
      }),
    );
  });

  it("keeps the tree inside one group", async () => {
    await rejected(
      as("alice").wikiPage.create({
        data: { groupId: pub, parentId: closedPage, title: "Cross-group child" },
      }),
    );
    await rejected(
      as("alice").wikiPage.update({ where: { id: pubPage }, data: { parentId: closedPage } }),
    );
  });

  it("revisions are append-only", async () => {
    const [rev] = await as("bob").wikiRevision.findMany({ where: { pageId: pubPage } });
    await rejected(
      as("bob").wikiRevision.update({ where: { id: rev!.id }, data: { content: "rewritten" } }),
    );
    await rejected(as("bob").wikiRevision.delete({ where: { id: rev!.id } }));
  });

  it("the ADMINS edit policy limits writes to admins and moderators", async () => {
    await as("alice").group.update({ where: { id: pub }, data: { wikiEditPolicy: "ADMINS" } });
    await rejected(
      as("bob").wikiPage.update({ where: { id: pubPage }, data: { title: "Member edit" } }),
    );
    await rejected(as("bob").wikiPage.create({ data: { groupId: pub, title: "Member page" } }));
    // nor can a plain member delete their own page any more
    await rejected(as("bob").wikiPage.delete({ where: { id: pubPage } }));

    await as("alice").groupMember.update({
      where: { groupId_userId: { groupId: pub, userId: users.bob.id } },
      data: { role: "MODERATOR" },
    });
    await as("bob").wikiPage.update({ where: { id: pubPage }, data: { title: "Moderated" } });
  });
});

describe("group events", () => {
  let eventId: string;

  it("CLOSED group events are hidden from non-members", async () => {
    const start = new Date();
    eventId = (
      await as("alice").event.create({
        data: {
          groupId: closed,
          title: "Planning",
          type: "EVENT",
          startAt: start,
          endAt: new Date(start.getTime() + 3_600_000),
        },
      })
    ).id;
    expect(await as("bob").event.findUnique({ where: { id: eventId } })).not.toBeNull();
    expect(await as("dave").event.findUnique({ where: { id: eventId } })).toBeNull();
  });

  it("an event never moves to another group", async () => {
    await rejected(as("alice").event.update({ where: { id: eventId }, data: { groupId: pub } }));
  });

  it("group moderators can remove group events", async () => {
    await as("alice").groupMember.update({
      where: { groupId_userId: { groupId: closed, userId: users.bob.id } },
      data: { role: "MODERATOR" },
    });
    await as("bob").event.delete({ where: { id: eventId } });
    expect(await db.event.findUnique({ where: { id: eventId } })).toBeNull();
  });
});
