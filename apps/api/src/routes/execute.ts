import { Elysia, t } from "elysia";
import { badRequest, tooManyRequests } from "@/lib/errors";
import { rateLimit } from "@/server/rate-limit";
import { schema } from "../../zenstack/schema";
import { authMacro } from "../plugins/auth";

type OperationFn = (args: Record<string, unknown>) => Promise<unknown>;

/** better-auth internals: denied by policy anyway, but never even routed. */
const INTERNAL_MODELS = new Set(["session", "account", "verification", "jwks"]);

/** Delegate names (`db.groupMember`) of every model in the schema. */
export const MODELS = new Set(
  Object.keys(schema.models)
    .map((m) => m.charAt(0).toLowerCase() + m.slice(1))
    .filter((m) => !INTERNAL_MODELS.has(m)),
);

/** CRUD operators only: `$`-methods (`$queryRaw`, `$transaction`, …) are never reachable. */
export const OPERATORS = new Set([
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "exists",
  "count",
  "aggregate",
  "groupBy",
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

export const MAX_TAKE = 100;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Validates the call and bounds its cost. Throws `HttpError` (400) on anything off-list. */
export function guardExecute(model: string, operator: string, args: unknown) {
  if (!MODELS.has(model)) throw badRequest(`Unknown model "${model}"`);
  if (!OPERATORS.has(operator)) throw badRequest(`Operator "${operator}" is not allowed`);
  if (!isPlainObject(args)) throw badRequest("args must be an object");
  const bounded = { ...args };
  if (operator === "findMany") {
    const take = typeof bounded.take === "number" ? bounded.take : MAX_TAKE;
    // keeps the sign: a negative take pages backwards
    bounded.take = Math.sign(take || 1) * Math.min(Math.abs(take), MAX_TAKE);
  }
  return bounded;
}

/**
 * Generic Prisma-style query endpoint. Safe only because of the three layers, in order:
 *   1. `auth: true`   → authenticated, non-banned user
 *   2. guardExecute() → model/operator allowlist + query cost bounds + per-user rate limit
 *   3. userDb         → ZenStack policies scoped to that user via `$setAuth`
 */
export const executeRoute = new Elysia({ name: "routes.execute" }).use(authMacro).post(
  "/api/execute",
  async ({ body, user, userDb }) => {
    if (!rateLimit(`execute:${user.id}`, 300, 60_000)) throw tooManyRequests();
    const { model, operator } = body;
    const args = guardExecute(model, operator, body.args ?? {});
    // Indexing is safe: `model` and `operator` passed the explicit allowlists above.
    const delegate = (userDb as unknown as Record<string, Record<string, OperationFn>>)[model]!;
    const data = await delegate[operator]!(args);
    return { data: data ?? null };
  },
  {
    auth: true,
    body: t.Object({
      model: t.String({ minLength: 1, maxLength: 64 }),
      operator: t.String({ minLength: 1, maxLength: 32 }),
      args: t.Optional(t.Unknown()),
    }),
    detail: {
      tags: ["Data"],
      summary: "Run an allowlisted ORM operation under the caller's access policies",
    },
  },
);
