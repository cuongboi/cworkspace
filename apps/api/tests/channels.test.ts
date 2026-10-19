import { ORMError } from "@zenstackhq/orm";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { encryptSecret, decryptSecret, signPayload, verifySignature } from "@/lib/crypto";
import { authDb, db } from "@/lib/db";
import { hostAllowed, ipAllowed, isPrivateIp, normalizeCidr } from "@/lib/ip";
import {
  createChannel,
  ensureGroupConversation,
  normalizeChannelName,
  syncGroupConversationMember,
} from "@/server/group-chat";

/**
 * Channels: policies (real database), the member mirror, and the integration helpers.
 * alice owns the group, mia is a moderator, bob a plain member, carol an outsider.
 */

const run = Math.random().toString(36).slice(2, 8);
const id = (name: string) => `t_${run}_${name}`;
const users = {
  alice: { id: id("alice"), email: `alice_${run}@test.local`, name: "Alice", role: "user" },
  mia: { id: id("mia"), email: `mia_${run}@test.local`, name: "Mia", role: "user" },
  bob: { id: id("bob"), email: `bob_${run}@test.local`, name: "Bob", role: "user" },
  carol: { id: id("carol"), email: `carol_${run}@test.local`, name: "Carol", role: "user" },
};
async function rejected(p: PromiseLike<unknown>) {
  const err = await Promise.resolve(p).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ORMError);
}

const as = (u: keyof typeof users) =>
  authDb.$setAuth({ id: users[u].id, email: users[u].email, role: users[u].role, permissions: [] });

let groupId: string;
let channel: { id: string; conversationId: string };
let integrationId: string;

beforeAll(async () => {
  for (const u of Object.values(users)) await db.user.create({ data: u });
  groupId = (
    await db.group.create({
      data: {
        name: "Channels",
        slug: `channels-${run}`,
        privacy: "PUBLIC",
        createdById: users.alice.id,
        members: {
          create: [
            { userId: users.alice.id, role: "ADMIN" },
            { userId: users.mia.id, role: "MODERATOR" },
            { userId: users.bob.id },
          ],
        },
      },
    })
  ).id;
  channel = await createChannel(
    groupId,
    { name: "Design Review", parentId: null, topic: null },
    users.mia.id,
  );
  integrationId = (
    await db.channelIntegration.create({
      data: {
        channelId: channel.id,
        kind: "INCOMING_WEBHOOK",
        name: "CI",
        secretCipher: encryptSecret("whsec_test"),
        secretHint: "test",
        createdById: users.alice.id,
      },
    })
  ).id;
});

afterAll(async () => {
  await db.group.deleteMany({ where: { id: groupId } });
  await db.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
});

describe("channel creation", () => {
  it("normalizes the name and creates #general first", async () => {
    const channels = await db.channel.findMany({
      where: { groupId },
      orderBy: { createdAt: "asc" },
    });
    expect(channels.map((c) => c.name)).toEqual(["general", "design-review"]);
    expect(channels[0]?.isDefault).toBe(true);
    const general = await db.conversation.findUnique({ where: { groupId } });
    expect(general?.channelId).toBe(channels[0]!.id);
  });

  it("mirrors the group's active members into the channel chat", async () => {
    const members = await db.conversationMember.findMany({
      where: { conversationId: channel.conversationId },
    });
    expect(members.map((m) => m.userId).sort()).toEqual(
      [users.alice.id, users.mia.id, users.bob.id].sort(),
    );
    await syncGroupConversationMember(groupId, users.bob.id, false);
    expect(
      await db.conversationMember.count({
        where: { conversationId: channel.conversationId, userId: users.bob.id },
      }),
    ).toBe(0);
    await syncGroupConversationMember(groupId, users.bob.id, true);
    expect(
      await db.conversationMember.count({
        where: { conversationId: channel.conversationId, userId: users.bob.id },
      }),
    ).toBe(1);
  });

  it("nests one level only and keeps sibling names unique", async () => {
    const child = await createChannel(
      groupId,
      { name: "tokens", parentId: channel.id, topic: null },
      users.alice.id,
    );
    await expect(
      createChannel(groupId, { name: "deeper", parentId: child.id, topic: null }, users.alice.id),
    ).rejects.toThrow("one level");
    await expect(
      createChannel(
        groupId,
        { name: "#Design-Review", parentId: null, topic: null },
        users.alice.id,
      ),
    ).rejects.toThrow("already exists");
  });

  it("ensureGroupConversation is idempotent", async () => {
    const a = await ensureGroupConversation(groupId);
    const b = await ensureGroupConversation(groupId);
    expect(a).toBe(b);
    expect(await db.channel.count({ where: { groupId, isDefault: true } })).toBe(1);
  });
});

describe("channel policies", () => {
  it("members read channels and their messages; outsiders don't", async () => {
    expect(await as("bob").channel.count({ where: { groupId } })).toBeGreaterThan(0);
    expect(await as("carol").channel.count({ where: { groupId } })).toBe(0);
    expect(
      await as("bob").conversation.findUnique({ where: { id: channel.conversationId } }),
    ).not.toBeNull();
    expect(
      await as("carol").conversation.findUnique({ where: { id: channel.conversationId } }),
    ).toBeNull();
  });

  it("members post in a channel, outsiders can't", async () => {
    await as("bob").message.create({
      data: { conversationId: channel.conversationId, content: "hi" },
    });
    await rejected(
      as("carol").message.create({
        data: { conversationId: channel.conversationId, content: "hi" },
      }),
    );
  });

  it("nobody writes channels or channel chats through the client", async () => {
    await rejected(as("alice").channel.update({ where: { id: channel.id }, data: { name: "x" } }));
    await rejected(
      as("alice").conversationMember.create({
        data: { conversationId: channel.conversationId, userId: users.carol.id },
      }),
    );
    await rejected(
      as("bob").message.create({
        data: { conversationId: channel.conversationId, content: "fake", type: "BOT" },
      }),
    );
  });

  it("only moderators read integrations, and never their secrets", async () => {
    expect(await as("bob").channelIntegration.count({ where: { channelId: channel.id } })).toBe(0);
    const seen = await as("mia").channelIntegration.findUnique({ where: { id: integrationId } });
    expect(seen?.name).toBe("CI");
    // field-level read denial: the values never leave the server
    expect((seen as { secretCipher?: unknown } | null)?.secretCipher ?? null).toBeNull();
    expect((seen as { tokenHash?: unknown } | null)?.tokenHash ?? null).toBeNull();
  });
});

describe("integration helpers", () => {
  it("normalizes channel names", () => {
    expect(normalizeChannelName("  #Design  System! ")).toBe("design-system");
    expect(normalizeChannelName("###")).toBe("");
  });

  it("round-trips sealed secrets", () => {
    expect(decryptSecret(encryptSecret("cwk_bot_abc"))).toBe("cwk_bot_abc");
  });

  it("verifies signatures within the tolerance only", () => {
    const now = 1_800_000_000_000;
    const ts = String(now / 1000);
    const sig = signPayload("s3cret", ts, '{"text":"hi"}');
    expect(verifySignature("s3cret", ts, '{"text":"hi"}', sig, now)).toBe(true);
    expect(verifySignature("s3cret", ts, '{"text":"hi!"}', sig, now)).toBe(false);
    expect(verifySignature("other", ts, '{"text":"hi"}', sig, now)).toBe(false);
    expect(verifySignature("s3cret", ts, '{"text":"hi"}', sig, now + 6 * 60_000)).toBe(false);
  });

  it("matches IPs against CIDR allowlists", () => {
    expect(normalizeCidr("10.1.2.3")).toBe("10.1.2.3/32");
    expect(normalizeCidr("10.0.0.0/33")).toBeNull();
    expect(normalizeCidr("nope")).toBeNull();
    expect(ipAllowed("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(ipAllowed("::ffff:10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(ipAllowed("11.1.2.3", ["10.0.0.0/8"])).toBe(false);
    expect(ipAllowed("2001:db8::1", ["2001:db8::/32"])).toBe(true);
    expect(ipAllowed(null, [])).toBe(true);
    expect(ipAllowed(null, ["10.0.0.0/8"])).toBe(false);
  });

  it("flags private targets and applies host rules", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "::1", "fd00::1"])
      expect(isPrivateIp(ip)).toBe(true);
    expect(isPrivateIp("93.184.216.34")).toBe(false);
    expect(hostAllowed("api.example.com", ["*.example.com"])).toBe(true);
    expect(hostAllowed("example.com.evil.io", ["*.example.com"])).toBe(false);
    expect(hostAllowed("anything.io", [])).toBe(true);
  });
});
