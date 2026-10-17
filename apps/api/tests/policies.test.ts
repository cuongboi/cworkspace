import { ORMError, ORMErrorReason } from "@zenstackhq/orm";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { authDb, db } from "@/lib/db";

/**
 * Access-policy tests against the real database (DATABASE_URL from .env).
 * One company: alice creates the groups, bob and carol are plain users, dave is an instance admin
 * and erin holds an RBAC grant to delete any post. Everything is cleaned up afterwards
 * (deleting the users cascades to what they created).
 */

const run = Math.random().toString(36).slice(2, 8);
const id = (name: string) => `t_${run}_${name}`;

type Permission = { model: string; actions: string[] };
const users = {
  alice: { id: id("alice"), email: `alice_${run}@test.local`, name: "Alice", role: "user" },
  bob: { id: id("bob"), email: `bob_${run}@test.local`, name: "Bob", role: "user" },
  carol: { id: id("carol"), email: `carol_${run}@test.local`, name: "Carol", role: "user" },
  dave: { id: id("dave"), email: `dave_${run}@test.local`, name: "Dave", role: "admin" },
  erin: { id: id("erin"), email: `erin_${run}@test.local`, name: "Erin", role: "user" },
};
const grants: Partial<Record<keyof typeof users, Permission[]>> = {
  erin: [{ model: "Post", actions: ["delete"] }],
};

const as = (u: keyof typeof users) =>
  authDb.$setAuth({
    id: users[u].id,
    email: users[u].email,
    role: users[u].role,
    permissions: grants[u] ?? [],
  });

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
  for (const [name, u] of Object.entries(users))
    await db.user.create({
      data: { ...u, permissions: grants[name as keyof typeof users] ?? [] },
    });

  const mk = (privacy: "PUBLIC" | "CLOSED" | "SECRET") =>
    as("alice").group.create({
      data: {
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
  await db.user.deleteMany({
    where: { id: { in: Object.values(users).map((u) => u.id) } },
  });
});

describe("access basics", () => {
  it("denies anonymous reads", async () => {
    expect(await authDb.group.findMany({ where: { id: publicGroup } })).toEqual([]);
    expect(await authDb.post.findMany({ where: { id: postId } })).toEqual([]);
    expect(await authDb.user.findMany({ where: { id: users.alice.id } })).toEqual([]);
  });

  it("never exposes auth tables", async () => {
    expect(await as("alice").session.findMany()).toEqual([]);
    expect(await as("alice").account.findMany()).toEqual([]);
  });

  it("shares the user directory with every signed-in user", async () => {
    const found = await as("carol").user.findMany({
      where: { id: users.alice.id },
    });
    expect(found).toHaveLength(1);
  });

  it("users cannot grant themselves a role or permissions", async () => {
    await rejected(as("bob").user.update({ where: { id: users.bob.id }, data: { role: "admin" } }));
    await rejected(
      as("bob").user.update({
        where: { id: users.bob.id },
        data: { permissions: [{ model: "Post", actions: ["delete"] }] },
      }),
    );
  });
});

describe("groups", () => {
  it("hides SECRET groups from non-members, shows PUBLIC/CLOSED", async () => {
    const ids = (
      await as("bob").group.findMany({
        where: { name: { in: ["PUBLIC", "CLOSED", "SECRET"] }, slug: { endsWith: run } },
      })
    ).map((g) => g.id);
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
  it("only members read a conversation", async () => {
    const convo = await as("alice").conversation.create({
      data: {
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
    // only the creator or a conversation admin adds people
    await rejected(
      as("carol").conversationMember.create({
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
        data: { userId: users.bob.id, type: "MENTION" },
      }),
    );
    await db.notification.create({
      data: { userId: users.bob.id, type: "MENTION" },
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
    // PUBLIC group: everyone can read it, so both are notified
    for (const u of ["bob", "carol"] as const)
      expect(
        await as(u).notification.count({
          where: { type: "MENTION", actorId: users.alice.id },
        }),
      ).toBe(1);

    await as("alice").post.create({
      data: { groupId: secretGroup, content: `psst @[Carol](${users.carol.id})` },
    });
    // carol can't read the SECRET group: no new notification
    expect(
      await db.notification.count({ where: { userId: users.carol.id, type: "MENTION" } }),
    ).toBe(1);
  });
});

describe("calendar", () => {
  it("events are visible to creator and attendees; OOO to everyone", async () => {
    const start = new Date(Date.now() + 86_400_000);
    const end = new Date(start.getTime() + 3_600_000);
    const meeting = await as("alice").event.create({
      data: {
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
    // bob can RSVP but not edit the event, nor invite people
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
      as("bob").eventAttendee.create({
        data: { eventId: meeting.id, userId: users.carol.id },
      }),
    );

    const ooo = await as("bob").event.create({
      data: {
        title: "Vacation",
        type: "OUT_OF_OFFICE",
        startAt: start,
        endAt: end,
      },
    });
    expect(await as("alice").event.findUnique({ where: { id: ooo.id } })).not.toBeNull();
    expect(await as("carol").event.findUnique({ where: { id: ooo.id } })).not.toBeNull();
  });

  it("rejects events that end before they start", async () => {
    const start = new Date();
    await rejected(
      as("alice").event.create({
        data: {
          title: "bad",
          startAt: start,
          endAt: new Date(start.getTime() - 1000),
        },
      }),
    );
  });
});

describe("attachments", () => {
  it("are private until attached, unless public", async () => {
    const mk = (name: string, isPublic = false) =>
      as("alice").attachment.create({
        data: {
          key: `test/${run}/${name}`,
          name,
          mimeType: "image/png",
          size: 1,
          isPublic,
        },
      });
    const draft = await mk("draft.png");
    const avatar = await mk("avatar.png", true);
    expect(await as("bob").attachment.findUnique({ where: { id: draft.id } })).toBeNull();
    expect(await as("bob").attachment.findUnique({ where: { id: avatar.id } })).not.toBeNull();
    expect(await as("carol").attachment.findUnique({ where: { id: avatar.id } })).not.toBeNull();

    // attaching it to a post in a public group makes it readable to readers of the post
    await as("alice").post.create({
      data: {
        groupId: publicGroup,
        content: "pic",
        attachments: { connect: [{ id: draft.id }] },
      },
    });
    expect(await as("bob").attachment.findUnique({ where: { id: draft.id } })).not.toBeNull();
    // bob can't steal it into his own post, nor upload in someone else's name
    await rejected(
      as("bob").attachment.update({
        where: { id: draft.id },
        data: { postId: null },
      }),
    );
    await rejected(
      as("carol").attachment.create({
        data: {
          uploaderId: users.alice.id,
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
        type: "GROUP",
        members: { create: [{ userId: users.alice.id, role: "ADMIN" }] },
      },
    });
    const call = await db.call.create({
      data: {
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
          conversationId: convo.id,
          startedById: users.alice.id,
        },
      }),
    );
  });
});

describe("instance admins and RBAC", () => {
  it("plain users cannot moderate groups they don't run", async () => {
    await rejected(as("bob").group.update({ where: { id: publicGroup }, data: { name: "mine" } }));
    await rejected(as("bob").group.delete({ where: { id: secretGroup } }));
  });

  it("an instance admin updates any group, removes members and deletes posts", async () => {
    const renamed = await as("dave").group.update({
      where: { id: publicGroup },
      data: { description: "moderated" },
    });
    expect(renamed.description).toBe("moderated");
    await as("dave").groupMember.delete({
      where: { groupId_userId: { groupId: publicGroup, userId: users.bob.id } },
    });
    const post = await as("alice").post.create({
      data: { groupId: publicGroup, content: "spam?" },
    });
    await as("dave").post.delete({ where: { id: post.id } });
    expect(await db.post.findUnique({ where: { id: post.id } })).toBeNull();
  });

  it("an instance admin edits the wiki of any group", async () => {
    const page = await as("dave").wikiPage.create({
      data: { groupId: publicGroup, title: "Handbook" },
    });
    await as("dave").wikiPage.delete({ where: { id: page.id } });
  });

  it("a Post delete grant deletes any post, but grants nothing else", async () => {
    const post = await as("alice").post.create({
      data: { groupId: publicGroup, content: "remove me" },
    });
    await rejected(as("erin").post.update({ where: { id: post.id }, data: { content: "edited" } }));
    await as("erin").post.delete({ where: { id: post.id } });
    await rejected(as("bob").post.delete({ where: { id: postId } }));
  });
});

describe("invitations", () => {
  it("are read by admins and the invitee only, and never written from the client", async () => {
    await rejected(
      as("dave").invitation.create({
        data: {
          email: `new_${run}@test.local`,
          invitedById: users.dave.id,
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    );
    const invitation = await db.invitation.create({
      data: {
        email: users.carol.email,
        invitedById: users.dave.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(await as("dave").invitation.findUnique({ where: { id: invitation.id } })).not.toBeNull();
    expect(
      await as("carol").invitation.findUnique({ where: { id: invitation.id } }),
    ).not.toBeNull();
    expect(await as("bob").invitation.findUnique({ where: { id: invitation.id } })).toBeNull();
  });
});
