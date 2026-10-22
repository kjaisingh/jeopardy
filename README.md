# Jeopardy

[![CI](https://github.com/kjaisingh/jeopardy/actions/workflows/ci.yml/badge.svg)](https://github.com/kjaisingh/jeopardy/actions/workflows/ci.yml)

Jeopardy is a private, real-time game where players write the questions and play from their own devices. A host runs each room and judges answers. [Play Jeopardy](https://jeopardy-ss6k.onrender.com).

## Features

- Create a room and invite players with a code, link, or QR code.
- Write questions for each point value, then assign teams manually or shuffle them.
- Play with optional Daily Double, answer timer, and finite or unlimited team attempts.
- Let the host judge or override answers, manage turns, and view standings and completed-question recaps.
- Save question drafts and edits locally, then resume in the same browser.
- Restart a game with the same group.

## Architecture

- React and Vite provide the client; Express and Socket.IO handle live play.
- The server owns room state, identity, scoring, and timers. Rooms run in one Node process.
- Optional Supabase Postgres snapshots restore rooms after normal restarts; without them, a restart loses rooms.
- One Render web service serves the built client and Socket.IO endpoint.

## Setup

1. Install Node.js 24 or newer. Copy [`.env.example`](.env.example) to `.env`; the template runs without Supabase.

   ```bash
   cp .env.example .env
   ```

2. Install dependencies and start the local client at <http://localhost:5173>.

   ```bash
   npm ci
   ```

   ```bash
   npm run dev
   ```

3. For durable rooms, create a Supabase project, run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor, and set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`.
4. Deploy a single instance with the [Render Blueprint](render.yaml). Set `CLIENT_URL` to its public HTTPS origin and add the Supabase values if using persistence. `/health` reports the deployed commit and persistence status.

## Checks

Run `npm run lint`, `npm test`, and `npm run build`. For the multiplayer browser test, install Chromium with `npx playwright install chromium`, stop any local server on port 3001, then run `npm run test:e2e`. Tests use in-memory rooms and never connect to Supabase.

## Feature backlog

- Add shared room state and a Socket.IO adapter for multiple server instances.
- Record game events and automate database backups for stronger recovery.
- Add a spectator view and reusable or imported question packs.
- Support image and audio questions with upload controls.
- Alert hosts when room persistence fails.
