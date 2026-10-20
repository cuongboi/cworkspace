# cworkplace

A self-hosted clone of **Facebook Workplace**: one company per deployment.

- **Feed & groups**: public, closed and secret groups (plus an "All company" group), posts with polls, events, attachments and @mentions, comments with replies, reactions
- **Chat**: 1:1 and group conversations, channels, threads, typing indicators, read receipts and presence
- **Calls**: audio/video calls with screen share (WebRTC mesh, up to 6 people), optional live captions
- **Calendar**: meetings, events, out-of-office, reminders, RSVP, recurrence, video meetings
- **Notifications** stored and pushed live (optional web push), **people directory**, **search**, **admin settings** (roles, deactivation, email invitations)

Access control is enforced on the server by ZenStack access policies. The image contains a single compiled binary (Bun + Elysia API, WebSocket and the React SPA) on a distroless base, running as non-root.

## Quick start

```bash
docker run -d --name cworkplace -p 3000:3000 --env-file .env <user>/cworkplace:latest
```

Open `http://localhost:3000`. Sign-up is open and **the first user becomes admin**.

### docker compose

```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: cworkplace
      POSTGRES_PASSWORD: cworkplace
      POSTGRES_DB: cworkplace
    volumes: [pgdata:/var/lib/postgresql/data]
  app:
    image: <user>/cworkplace:latest
    ports: ["3000:3000"]
    env_file: .env
    environment:
      DATABASE_URL: postgresql://cworkplace:cworkplace@db:5432/cworkplace
    depends_on: [db]
volumes:
  pgdata:
```

**Database schema**: the image does not migrate the database. Push the schema once (and after upgrades) from a checkout of the repository: `DATABASE_URL=... bun --cwd apps/api run db:push`.

Run **one** container: realtime rooms, presence and call state live in-process.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | yes | Auth secret (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | no | Public URL of the app (default `http://localhost:3000`) |
| `BETTER_AUTH_BASE_PATH` | no | Auth route prefix (default `/api/auth`) |
| `WEB_ORIGIN` | no | Allowed origins, comma-separated; set to your public URL |
| `APP_URL` | no | Base URL for links in emails (default: first `WEB_ORIGIN`) |
| `RESEND_API_KEY`, `MAIL_FROM` | no | Send emails via Resend; unset → emails printed to logs |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | for uploads | Any S3-compatible storage (AWS S3, R2, MinIO) |
| `STUN_URLS`, `TURN_URLS`, `TURN_SECRET` | for calls across NATs | STUN/TURN servers (coturn `use-auth-secret`) |
| `GEMINI_API_KEY`, `GEMINI_TRANSCRIBE_MODEL`, `GEMINI_TRANSLATE_MODEL` | for captions | Live call captions; unset → off |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_VAPID_KEY` | for push | Background push notifications; unset → off |
| `TRUST_PROXY` | no | Trust `X-Forwarded-For` behind your reverse proxy (default `false`) |
| `ALLOW_PRIVATE_WEBHOOKS` | no | Let outgoing webhooks reach private hosts (default `false`) |
| `DB_LOG_QUERIES` | no | Log SQL queries (default `false`) |

Source: https://github.com/cuongboi/cworkspace
