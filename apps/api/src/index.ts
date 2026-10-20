import { ArgumentParser } from "argparse";
import { app } from "./app";
import { startReminderWorker } from "./server/jobs/reminders";
import { localHttps } from "elysia-local-https";

const parser = new ArgumentParser({ description: "cworkplace API server" });
parser.add_argument("-p", "--port", { help: "Port to listen on", default: 3000 });
parser.add_argument("-H", "--host", { help: "Host to listen on", default: "0.0.0.0" });
parser.add_argument("-s", "--ssl", { help: "Enable SSL", action: "store_true" });
parser.add_argument("--cert", {
  help: "TLS certificate PEM path (with --ssl)",
  default: "certs/local/localhost.pem",
});
parser.add_argument("--key", {
  help: "TLS private key PEM path (with --ssl)",
  default: "certs/local/localhost-key.pem",
});
parser.add_argument("--domain", {
  help: "Certificate domain(s), comma-separated (with --ssl)",
  default: "localhost,127.0.0.1,::1",
});
const args = parser.parse_args();

if (args.ssl) {
  app.listen(
    localHttps(
      { port: 443, hostname: args.host },
      {
        enabled: true,
        certPath: args.cert,
        keyPath: args.key,
        domains: String(args.domain)
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean),
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
