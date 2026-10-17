import Elysia from "elysia";
import { auth } from "@/lib/auth";
import { dbFor, toSessionUser } from "@/server/session";
import { env } from "@/env";

export class BetterAuthOpenApi {
  static specs: { paths: Record<string, any>; components: Record<string, any> } | undefined;

  private static getSpec = async () => {
    if (BetterAuthOpenApi.specs) return BetterAuthOpenApi.specs;

    if (!("generateOpenAPISchema" in auth.api)) throw new Error("OpenAPI plugin is not enabled");
    const spec = await auth.api.generateOpenAPISchema();
    const paths: typeof spec.paths = Object.create(null);
    for (const path of Object.keys(spec.paths)) {
      const key = env.BETTER_AUTH_BASE_PATH + path;
      paths[key] = spec.paths[path];
      for (const method of Object.keys(spec.paths[path])) {
        const operation = (paths[key] as any)[method];
        operation.tags = ["Auth"];
      }
    }

    BetterAuthOpenApi.specs = {
      paths,
      components: spec.components,
    };

    return BetterAuthOpenApi.specs;
  };

  static paths = async () => {
    return (await BetterAuthOpenApi.getSpec()).paths;
  };

  static components = async () => {
    return (await BetterAuthOpenApi.getSpec()).components;
  };
}

/**
 * `auth: true` on a route: 401 without a session, 403 for banned users. Handlers receive `user`,
 * `session` and `userDb` (the policy-enforcing client scoped to that user).
 */
export const authMacro = () =>
  new Elysia({ name: "auth-macro" }).macro({
    auth: {
      resolve: async ({ status, request: { headers } }) => {
        const session = await auth.api.getSession({ headers });
        if (!session) {
          return status(401, {
            error: { message: "Sign in required", code: "UNAUTHORIZED" },
          });
        }
        if (session.user.banned) {
          return status(403, {
            error: { message: "Account disabled", code: "FORBIDDEN" },
          });
        }
        return {
          user: session.user,
          session: session.session,
          userDb: dbFor(toSessionUser(session.user)),
        };
      },
    },
  });

// Explicit GET/POST routes (not `.mount`) so they take precedence over the static plugin's GET `/*` wildcard.
const authHandler = ({ request }: { request: Request }) => auth.handler(request);

export const betterAuthPlugin = new Elysia({ name: "better-auth" }).group(
  env.BETTER_AUTH_BASE_PATH,
  (app) => {
    return app
      .get(`/*`, authHandler, { detail: { hide: true } })
      .post(`/*`, authHandler, { detail: { hide: true } });
  },
);
