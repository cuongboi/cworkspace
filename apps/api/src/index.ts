import { ArgumentParser } from "argparse";
import { app } from "./app";
import { startReminderWorker } from "./server/jobs/reminders";
import { localHttps } from "elysia-local-https";

const parser = new ArgumentParser({ description: "cworkplace API server" });
parser.add_argument("-p", "--port", { help: "Port to listen on", default: 3000 });
parser.add_argument("-H", "--host", { help: "Host to listen on", default: "0.0.0.0" });
parser.add_argument("-s", "--ssl", { help: "Enable SSL", action: "store_true" });
const args = parser.parse_args();

if (args.ssl) {
  app.listen(
    localHttps(
      { port: 443, hostname: args.host },
      {
        enabled: true,
        certPath: "certs/local/localhost.pem",
        keyPath: "certs/local/localhost-key.pem",
        domains: ["localhost", "127.0.0.1", "::1"],
      },
    ),
  );
} else {
  app.listen(args.port);
}

startReminderWorker();

console.log(
  `🦊 Elysia is running at ${args.ssl ? "https" : "http"}://${app.server?.hostname}:${app.server?.port}`,
);
