# Jeopardy

[![CI](https://github.com/kjaisingh/jeopardy/actions/workflows/ci.yml/badge.svg)](https://github.com/kjaisingh/jeopardy/actions/workflows/ci.yml)

A private, realtime Jeopardy-style game where players write the questions and play from their own phones or computers.

## How it works

1. A host creates a room and shares its six-character code, link, or QR code.
2. Each player joins and writes one question and answer for every point value.
3. The host groups players into teams manually or with the shuffle control.
4. Teams select questions in turn. The host submits each spoken answer, overrides close-call judging when needed, or passes to the next team.
5. The final screen shows standings, accuracy, notable questions, and missed answers.

Optional rules include one hidden Daily Double worth exactly twice its displayed value, a server-controlled answer timer, and two attempt modes:

- **Finite:** each team gets a fixed number of attempts per question.
- **Unlimited:** teams keep cycling until someone answers or the host skips the question.

Unsubmitted question drafts are saved in the browser. A player can move their saved session to another device with the private resume token; the old device is immediately superseded.

## Architecture

- **Client:** React 19 and Vite.
- **Server:** Node.js, Express, and Socket.IO.
- **Live state:** one in-memory room store in the Node process.
- **Durability:** optional Supabase PostgreSQL JSON snapshots.
- **Hosting:** one web service serves both the built client and Socket.IO endpoint.

The server is authoritative for identity, room mutations, scoring, and timer expiry. Public player IDs are display identifiers only. Create and join operations issue an opaque resume token; only its SHA-256 hash is persisted.

Supabase writes are coalesced in the background and bounded by a timeout, so a sleeping or unavailable database does not pause live gameplay. This creates a small durability window if the process dies before its latest queued write completes. Graceful shutdown flushes pending writes.

## Requirements

- Node.js 24 or newer.
- npm.
- Chromium only when running the browser smoke test.
- Supabase is optional for local development.

## Local development

```bash
npm ci
cp .env.example .env
npm run dev
```

Open <http://localhost:5173>. The copied template starts in memory-only mode, so no cloud account is needed for local development.

To enable persistence:

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in its SQL editor.
3. Uncomment and set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`.
4. Re-run the schema after pulling changes; it is idempotent and enables RLS.

Never expose the service-role key to the browser or prefix it with `VITE_`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the watched server and Vite client together. |
| `npm run lint` | Run ESLint across client, server, tests, and configuration. |
| `npm test` | Run unit and Socket.IO integration tests. |
| `npm run build` | Build the production client into `dist/`. |
| `npm run test:e2e` | Build and drive a full three-browser game in Chromium. |
| `npm start` | Serve the production app and Socket.IO endpoint. |

Install the browser once before the smoke test:

```bash
npx playwright install chromium
```

Tests explicitly run without Supabase. The smoke test covers create, join, question submission, team setup, a steal, server-side timer expiry, results, restart, and a post-restart guest mutation. CI runs audit, lint, unit/integration tests, build, and the browser smoke test.

## Environment variables

See [`.env.example`](.env.example) for a copyable template.

| Variable | Required | Meaning |
| --- | --- | --- |
| `PORT` | No | Production server port. Defaults to `3001`. |
| `CLIENT_URL` | Production | Browser origin allowed by CORS. |
| `VITE_SERVER_URL` | Local only | Socket server used by the Vite client. |
| `SUPABASE_URL` | No | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Server-only key used for room snapshots. |
| `KEEPALIVE_TOKEN` | Production keepalive | Server-only secret protecting the persistence health probe. |
| `PERSISTENCE_TIMEOUT_MS` | No | Supabase operation timeout. Defaults to `3000`. |
| `PERSISTENCE_RETRY_BASE_MS` | No | Initial failed-write retry delay. Defaults to `1000`. |
| `PERSISTENCE_RETRY_MAX_MS` | No | Maximum failed-write retry delay. Defaults to `30000`. |
| `ROOM_RETENTION_HOURS` | No | Inactive room retention. Defaults to `24`. |
| `HOST_GRACE_MS` | No | Delay before host failover. Defaults to `30000`. |

## Security and data

Room snapshots contain player-written questions, answers, and hashed resume tokens. The supplied schema enables RLS and grants no `anon` or `authenticated` access. The backend service-role client is the only intended database reader.

Socket mutations use the identity bound to the authenticated connection. Client-supplied `playerId` or room-code fields cannot change the actor. Each socket can own only one room session. Requests also have strict payload limits, room-code validation, per-socket rate limiting, and safe acknowledgement handling. Production responses include a restrictive content security policy, frame denial, MIME sniffing protection, and a no-referrer policy.

Browser sessions and question drafts live in `localStorage`. “Leave” removes both. “Go Home” detaches from live updates but keeps the resume token and drafts.

## Deployment

[`render.yaml`](render.yaml) defines a single Render web service using Node 24 and shallow `/health` checks. For a new deployment, create a Render Blueprint from this repository. For the existing `Jeopardy` service, keep that service and update its environment variables; creating a second service is unnecessary.

### One-time production rollout

1. Commit and push this repository so Render can deploy the current code.
2. Unpause the existing Supabase project once if it is currently paused.
3. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor. It is idempotent and preserves existing rows.
4. In Render, confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set. The service-role key must never enter browser variables or source control.
5. Generate a secret with `openssl rand -base64 32` and add it to Render as `KEEPALIVE_TOKEN`.
6. Confirm `CLIENT_URL` matches the public Render URL, then redeploy the existing service.
7. Configure and test the external keepalive job described below.

Authentication changed from public player IDs to private resume tokens. Browsers holding sessions from the old deployment must rejoin once; newly saved sessions resume normally afterward.

The public `/health` response reports whether persistence is enabled and whether recent background writes failed. It never includes credentials or room data, and it does not query Supabase.

### Prevent Supabase inactivity pausing

`GET /health/persistence` performs one bounded, read-only Supabase query. It is disabled unless `KEEPALIVE_TOKEN` is configured and requires the exact header `Authorization: Bearer <KEEPALIVE_TOKEN>`. It never returns room data, database errors, or credentials.

After deployment, schedule this endpoint every six hours with a free external scheduler such as [cron-job.org](https://cron-job.org/). Use a timeout of at least 60 seconds for Render cold starts, enable retries and failure notifications, and put the token in the authorization header—not the URL. These brief requests wake Render only long enough to probe Supabase; Render can sleep normally between requests.

[Supabase currently says](https://supabase.com/docs/guides/platform/free-project-pausing) a few user database requests per day are typically enough to avoid free-project inactivity pausing. This is best-effort, not an uptime guarantee; a scheduler outage or policy change can still allow pausing. Supabase Pro is the only formal no-pause option. A GitHub scheduled workflow is intentionally not used because GitHub can disable schedules after 60 days without repository activity on public repositories.

## Operational limits

- Run exactly one app instance. Rooms live in process memory; horizontal scaling requires a shared Socket.IO adapter and coordinated room/timer ownership.
- Without Supabase, a restart loses every room.
- With Supabase, rooms survive normal restarts. Writes are coalesced, timeout-bounded, and retried with exponential backoff; an abrupt process kill can still lose the latest in-memory mutation.
- Inactive rooms expire after the configured retention period. Rooms with connected players are not pruned.
- A free Render service may sleep and cold-start. The keepalive request wakes it briefly without keeping it continuously active.
- Media questions and AI-assisted question generation are intentionally out of scope because they require storage, moderation, or paid model decisions.
