import { ORMError, ORMErrorReason } from "@zenstackhq/orm";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { authDb, db } from "@/lib/db";

/**
 * Access-policy tests against the real database (DATABASE_URL from .env).
 * Two orgs: A = { alice (owner), bob }, B = { carol (owner) }. Everything is cleaned up afterwards.
 */

const run = Math.random().toString(36).slice(2, 8);
const id = (name: string) => `t_${run}_${name}`;

const users = {
  alice: { id: id("alice"), email: `alice_${run}@test.local`, name: "Alice" },
  bob: { id: id("bob"), email: `bob_${run}@test.local`, name: "Bob" },
  carol: { id: id("carol"), email: `carol_${run}@test.local`, name: "Carol" },
};
const orgA = id("orgA");
const orgB = id("orgB");

const as = (u: keyof typeof users) =>
  authDb.$setAuth({ id: users[u].id, email: users[u].email, role: null });

async function rejected(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ORMError);
  // updates/deletes the policy filters out surface as not-found (the row's existence isn't leaked)
  expect([ORMErrorReason.REJECTED_BY_POLICY, ORMErrorReason.NOT_FOUND]).toContain(
    (err as ORMError).reason,
  );
}

let publicGroup: string;
let closedGroup: string;
let secretGroup: string;
let postId: string;

beforeAll(async () => {
  for (const u of Object.values(users)) await db.user.create({ data: u });
  const now = new Date();
  await db.organization.create({
    data: { id: orgA, name: "A", slug: id("a"), createdAt: now },
  });
  await db.organization.create({
    data: { id: orgB, name: "B", slug: id("b"), createdAt: now },
  });
  await db.member.createMany({
    data: [
      {
        id: id("m1"),
        organizationId: orgA,
        userId: users.alice.id,
        role: "owner",
        createdAt: now,
      },
      {
        id: id("m2"),
        organizationId: orgA,
        userId: users.bob.id,
        role: "member",
        createdAt: now,
      },
      {
        id: id("m3"),
        organizationId: orgB,
        userId: users.carol.id,
        role: "owner",
        createdAt: now,
      },
    ],
  });

  const mk = (privacy: "PUBLIC" | "CLOSED" | "SECRET") =>
    as("alice").group.create({
      data: {
        organizationId: orgA,
        name: privacy,
        slug: `${privacy.toLowerCase()}-${run}`,
        privacy,
        members: { create: { userId: users.alice.id, role: "ADMIN" } },
      },
    });
  publicGroup = (await mk("PUBLIC")).id;
  closedGroup = (await mk("CLOSED")).id;
  secretGroup = (await mk("SECRET")).id;

  postId = (
    await as("alice").post.create({
      data: { groupId: publicGroup, content: "hello" },
    })
  ).id;
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await db.user.deleteMany({
    where: { id: { in: Object.values(users).map((u) => u.id) } },
  });
});

describe("tenant isolation", () => {
  it("hides other orgs' users, groups and posts", async () => {
    const carol = as("carol");
    expect(await carol.user.findMany({ where: { id: users.alice.id } })).toEqual([]);
    expect(await carol.group.findMany({ where: { organizationId: orgA } })).toEqual([]);
    expect(await carol.post.findMany({ where: { id: postId } })).toEqual([]);
    expect(await carol.organization.findUnique({ where: { id: orgA } })).toBeNull();
  });

  it("rejects writes into another org", async () => {
    await rejected(
      as("carol").group.create({
        data: { organizationId: orgA, name: "x", slug: id("x") },
      }),
    );
    await rejected(
      as("carol").post.create({
        data: { groupId: publicGroup, content: "spam" },
      }),
    );
  });

  it("cannot add a user from another org to a group", async () => {
    await rejected(
      as("alice").groupMember.create({
        data: { groupId: publicGroup, userId: users.carol.id },
      }),
    );
  });

  it("never exposes auth tables", async () => {
    expect(await as("alice").session.findMany()).toEqual([]);
    expect(await as("alice").account.findMany()).toEqual([]);
  });

  it("shares users within an org", async () => {
    const found = await as("bob").user.findMany({
      where: { id: users.alice.id },
    });
    expect(found).toHaveLength(1);
  });
});

describe("groups", () => {
  it("hides SECRET groups from non-members, shows PUBLIC/CLOSED", async () => {
    const ids = (await as("bob").group.findMany({ where: { organizationId: orgA } })).map(
      (g) => g.id,
    );
    expect(ids).toContain(publicGroup);
    expect(ids).toContain(closedGroup);
    expect(ids).not.toContain(secretGroup);
  });

  it("self-join: PUBLIC active, CLOSED only as pending, SECRET never", async () => {
    const bob = as("bob");
    await rejected(
      bob.groupMember.create({
        data: { groupId: closedGroup, userId: users.bob.id },
      }),
    );
    await bob.groupMember.create({
      data: { groupId: closedGroup, userId: users.bob.id, status: "PENDING" },
    });
    await rejected(
      bob.groupMember.create({
        data: { groupId: secretGroup, userId: users.bob.id },
      }),
    );
    await rejected(
      bob.groupMember.create({
        data: { groupId: publicGroup, userId: users.bob.id, role: "ADMIN" },
      }),
    );
  });

  it("pending members cannot post to a CLOSED group", async () => {
    await rejected(as("bob").post.create({ data: { groupId: closedGroup, content: "hi" } }));
    expect(await as("bob").post.findMany({ where: { groupId: closedGroup } })).toEqual([]);
  });

  it("group admins approve requests", async () => {
    await as("alice").groupMember.update({
      where: { groupId_userId: { groupId: closedGroup, userId: users.bob.id } },
      data: { status: "ACTIVE" },
    });
    const post = await as("bob").post.create({
      data: { groupId: closedGroup, content: "now I can" },
    });
    expect(post.authorId).toBe(users.bob.id);
  });

  it("only the author edits a post; cannot move it to another group", async () => {
    await rejected(
      as("bob").post.update({
        where: { id: postId },
        data: { content: "hacked" },
      }),
    );
    await rejected(
      as("alice").post.update({
        where: { id: postId },
        data: { groupId: closedGroup },
      }),
    );
    await rejected(
      as("alice").post.update({
        where: { id: postId },
        data: { type: "POLL" },
      }),
    );
  });
});

describe("polls", () => {
  it("allows one vote on single-choice polls", async () => {
    await as("bob").groupMember.create({
      data: { groupId: publicGroup, userId: users.bob.id },
    });
    const post = await as("alice").post.create({
      data: {
        groupId: publicGroup,
        type: "POLL",
        poll: {
          create: {
            question: "Lunch?",
            options: { create: [{ text: "Pho" }, { text: "Bun" }] },
          },
        },
      },
      include: { poll: { include: { options: true } } },
    });
    const poll = post.poll;
    const [pho, bun] = poll?.options ?? [];
    if (!poll || !pho || !bun) throw new Error("poll was not created");
    await as("bob").pollVote.create({
      data: { pollId: poll.id, optionId: pho.id },
    });
    await rejected(
      as("bob").pollVote.create({
        data: { pollId: poll.id, optionId: bun.id },
      }),
    );
    expect(await as("alice").pollVote.count({ where: { pollId: poll.id } })).toBe(1);
  });
});

describe("chat", () => {
  it("only members read a conversation; members must share the org", async () => {
    const convo = await as("alice").conversation.create({
      data: {
        organizationId: orgA,
        type: "GROUP",
        title: "t",
        members: { create: [{ userId: users.alice.id, role: "ADMIN" }] },
      },
    });
    await as("alice").message.create({
      data: { conversationId: convo.id, content: "secret" },
    });

    expect(await as("bob").message.findMany({ where: { conversationId: convo.id } })).toEqual([]);
    await rejected(
      as("bob").message.create({
        data: { conversationId: convo.id, content: "let me in" },
      }),
    );
    await rejected(
      as("alice").conversationMember.create({
        data: { conversationId: convo.id, userId: users.carol.id },
      }),
    );

    await as("alice").conversationMember.create({
      data: { conversationId: convo.id, userId: users.bob.id },
    });
    expect(await as("bob").message.findMany({ where: { conversationId: convo.id } })).toHaveLength(
      1,
    );
    // a member cannot promote themself
    await rejected(
      as("bob").conversationMember.update({
        where: {
          conversationId_userId: {
            conversationId: convo.id,
            userId: users.bob.id,
          },
        },
        data: { role: "ADMIN" },
      }),
    );
  });
});

describe("notifications", () => {
  it("cannot be created from the client; only the recipient reads them", async () => {
    await rejected(
      as("alice").notification.create({
        data: { organizationId: orgA, userId: users.bob.id, type: "MENTION" },
      }),
    );
    await db.notification.create({
      data: { organizationId: orgA, userId: users.bob.id, type: "MENTION" },
    });
    expect(
      await as("alice").notification.findMany({
        where: { userId: users.bob.id },
      }),
    ).toEqual([]);
    expect(
      await as("bob").notification.findMany({
        where: { userId: users.bob.id, type: "MENTION" },
      }),
    ).toHaveLength(1);
  });

  it("are written by the realtime plugin (join request → admin, approval → requester)", async () => {
    const request = await as("alice").notification.findFirst({
      where: {
        type: "GROUP_JOIN_REQUEST",
        groupId: closedGroup,
        actorId: users.bob.id,
      },
    });
    expect(request).not.toBeNull();
    const approved = await as("bob").notification.findFirst({
      where: { type: "GROUP_JOIN_APPROVED", groupId: closedGroup },
    });
    expect(approved).not.toBeNull();
  });

  it("mentions notify readers of the post", async () => {
    await as("alice").post.create({
      data: {
        groupId: publicGroup,
        content: `hey @[Bob](${users.bob.id}) and @[Carol](${users.carol.id})`,
      },
    });
    expect(
      await as("bob").notification.count({
        where: { type: "MENTION", actorId: users.alice.id },
      }),
    ).toBe(1);
    // carol is in another org: never notified
    expect(await db.notification.count({ where: { userId: users.carol.id } })).toBe(0);
  });
});

describe("calendar", () => {
  it("events are visible to creator and attendees; OOO to the whole org", async () => {
    const start = new Date(Date.now() + 86_400_000);
    const end = new Date(start.getTime() + 3_600_000);
    const meeting = await as("alice").event.create({
      data: {
        organizationId: orgA,
        title: "1:1",
        type: "MEETING",
        startAt: start,
        endAt: end,
        attendees: { create: [{ userId: users.alice.id, rsvp: "GOING" }] },
      },
    });
    expect(await as("bob").event.findUnique({ where: { id: meeting.id } })).toBeNull();
    await as("alice").eventAttendee.create({
      data: { eventId: meeting.id, userId: users.bob.id },
    });
    expect(await as("bob").event.findUnique({ where: { id: meeting.id } })).not.toBeNull();
    // invite → EVENT_INVITE notification by the plugin
    expect(
      await as("bob").notification.count({
        where: { type: "EVENT_INVITE", eventId: meeting.id },
      }),
    ).toBe(1);
    // bob can RSVP but not edit the event; carol (other org) can't be invited
    await as("bob").eventAttendee.update({
      where: { eventId_userId: { eventId: meeting.id, userId: users.bob.id } },
      data: { rsvp: "GOING" },
    });
    await rejected(
      as("bob").event.update({
        where: { id: meeting.id },
        data: { title: "hijack" },
      }),
    );
    await rejected(
      as("alice").eventAttendee.create({
        data: { eventId: meeting.id, userId: users.carol.id },
      }),
    );

    const ooo = await as("bob").event.create({
      data: {
        organizationId: orgA,
        title: "Vacation",
        type: "OUT_OF_OFFICE",
        startAt: start,
        endAt: end,
      },
    });
    expect(await as("alice").event.findUnique({ where: { id: ooo.id } })).not.toBeNull();
    expect(await as("carol").event.findUnique({ where: { id: ooo.id } })).toBeNull();
  });

  it("rejects events that end before they start", async () => {
    const start = new Date();
    await rejected(
      as("alice").event.create({
        data: {
          organizationId: orgA,
          title: "bad",
          startAt: start,
          endAt: new Date(start.getTime() - 1000),
        },
      }),
    );
  });
});

describe("attachments", () => {
  it("are private until attached, unless org-visible; never cross-tenant", async () => {
    const mk = (name: string, orgVisible = false) =>
      as("alice").attachment.create({
        data: {
          organizationId: orgA,
          key: `test/${run}/${name}`,
          name,
          mimeType: "image/png",
          size: 1,
          orgVisible,
        },
      });
    const draft = await mk("draft.png");
    const avatar = await mk("avatar.png", true);
    expect(await as("bob").attachment.findUnique({ where: { id: draft.id } })).toBeNull();
    expect(await as("bob").attachment.findUnique({ where: { id: avatar.id } })).not.toBeNull();
    expect(await as("carol").attachment.findUnique({ where: { id: avatar.id } })).toBeNull();

    // attaching it to a post in a public group makes it readable to readers of the post
    await as("alice").post.create({
      data: {
        groupId: publicGroup,
        content: "pic",
        attachments: { connect: [{ id: draft.id }] },
      },
    });
    expect(await as("bob").attachment.findUnique({ where: { id: draft.id } })).not.toBeNull();
    // bob can't steal it into his own post, nor create one in another org
    await rejected(
      as("bob").attachment.update({
        where: { id: draft.id },
        data: { postId: null },
      }),
    );
    await rejected(
      as("carol").attachment.create({
        data: {
          organizationId: orgA,
          key: `test/${run}/x`,
          name: "x",
          mimeType: "image/png",
          size: 1,
        },
      }),
    );
  });
});

describe("calls", () => {
  it("are readable by conversation members only and never writable from the client", async () => {
    const convo = await as("alice").conversation.create({
      data: {
        organizationId: orgA,
        type: "GROUP",
        members: { create: [{ userId: users.alice.id, role: "ADMIN" }] },
      },
    });
    const call = await db.call.create({
      data: {
        organizationId: orgA,
        conversationId: convo.id,
        startedById: users.alice.id,
      },
    });
    expect(await as("alice").call.findUnique({ where: { id: call.id } })).not.toBeNull();
    expect(await as("bob").call.findUnique({ where: { id: call.id } })).toBeNull();
    await rejected(
      as("alice").call.update({
        where: { id: call.id },
        data: { status: "ENDED" },
      }),
    );
    await rejected(
      as("alice").call.create({
        data: {
          organizationId: orgA,
          conversationId: convo.id,
          startedById: users.alice.id,
        },
      }),
    );
  });
});
