import { ZenStackClient, type TransactionClientContract } from "@zenstackhq/orm";
import { PostgresDialect } from "@zenstackhq/orm/dialects/postgres";
import { PolicyPlugin } from "@zenstackhq/plugin-policy";
import { zenstackAdapter } from "@zenstackhq/better-auth";
import { Pool } from "pg";
import { env } from "../env";
import { realtimePlugin } from "../server/plugins/realtime-plugin";
import { schema, type SchemaType } from "../../zenstack/schema";

/**
 * Unscoped client: bypasses access policies. Use only for trusted server code
 * (better-auth adapter, workflow routes, socket handlers, jobs, seed). Never hand it to `/execute`.
 * The realtime plugin sits on the root client so every write (including better-auth's) emits.
 */
export const db = new ZenStackClient(schema, {
  log: env.DB_LOG_QUERIES ? ["query", "error"] : ["error"],
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: env.DATABASE_URL }),
  }),
}).$use(realtimePlugin);

/** Policy-enforcing client. Always narrow it with `.$setAuth(ctx)` per request (see `dbFor`). */
export const authDb = db.$use(new PolicyPlugin());

export const dbAdapter = zenstackAdapter(db, {
  provider: "postgresql",
});

export type Database = typeof db;
/** Client handed to `$transaction` callbacks. */
export type DatabaseTransaction = TransactionClientContract<
  SchemaType,
  Database["$options"],
  {},
  {}
>;
/** Either the root client or a transaction client — for helpers usable in both. */
export type DbExecutor = Database | DatabaseTransaction;
export type AuthDatabase = typeof authDb;

/** Shape bound to `auth()` in schema.zmodel policies (`email` is used by the Invitation rule). */
export type AuthContext = {
  id: string;
  email: string;
  role: string | null;
  permissions: { model: string; actions: string[] }[];
};
