# Jeopardy
[![CI](https://github.com/kjaisingh/jeopardy/actions/workflows/ci.yml/badge.svg)](https://github.com/kjaisingh/jeopardy/actions/workflows/ci.yml)

Welcome to a highly interactive, custom Jeopardy experience designed to make game nights, parties, and remote hangouts incredibly engaging. Unlike traditional trivia games where the questions are pre-written and static, this game relies entirely on the creativity of its players to build the ultimate challenge.

## Overview
- **Gather and Join**: One person acts as the host, picks the game's settings, and creates a room on a main screen, generating a simple six-character code (and a shareable link + QR code). Everyone else opens the website on their own smartphones, tablets, or laptops, joining by entering the code, scanning the QR, or tapping the link.
- **Build the Board**: Once you are in, the game asks you to come up with the host-configured number of unique trivia questions and answers (1-10 per player, chosen at room creation and editable by the host in the lobby). You will assign each of your questions a difficulty value from 100 points up, and together, everyone's submissions automatically build the custom Jeopardy board for that match.
- **Team Up**: After all the questions are locked in, the host takes over to organize the lobby into custom teams, with an optional one-click shuffle to randomize the split. Round count, Daily Double, and the answer timer were already dialed in at room creation, ensuring the game length and intensity perfectly fit your group's vibe.
- **Play and Score**: As the game kicks off, teams take turns selecting questions from the player-generated categories on the main board. When a team guesses an answer, the game acts as a smart virtual judge: it knows when your answer is close enough to be correct so you don't have to worry about perfect spelling, but the host always has a button to manually override the system if a debate breaks out.
- **Win the Game**: Correct answers boost your team's score, while incorrect ones pass the opportunity to the next team in line. The board updates in real-time across everyone's devices until all the questions are gone, at which point a full-screen results screen crowns the team with the highest score and breaks down the game: standings, toughest question, and every answer nobody got right.

## Gameplay Features
- **Daily Double**: one random question on the board is secretly worth double. It stays hidden (every open cell reports as a normal question to every viewer, including the host) until a team selects it, at which point a gold banner announces it before the answer is revealed.
- **Answer timer**: the host can set a per-question countdown (Off, or 30-180 seconds in 30-second steps) at room creation, editable in the lobby. It's shown only on the host screen, resets for each new team's attempt, and expiry counts as that team being unable to answer (the same as the "Skip Question" button).
- **Team randomizer**: a "Shuffle Teams" button in team setup redistributes the lobby round-robin across the current team count, so no one has to eyeball a fair split by hand.
- **Sound effects + background music**: short synthesized tones for selects, correct/incorrect answers, the Daily Double reveal, time-up, and game-over, plus an optional soft ambient pad that loops during play. Both are host-only (so phones don't create an echo), their on/off state persists across sessions, and the first tap/keypress on the host screen warms up audio playback for Safari/iOS.
- **Emoji reactions**: players can fire off a quick 👍 😂 😮 🎉 😢 🔥 from a reaction bar during play; it floats across every connected screen for a moment and is never stored in game history.
- **Results screen**: a full-screen finish with a winner (or tie) headline, ranked standings with accuracy, and stat highlights including "Nobody got these": the answers to every passed or missed question, revealed at last.
- **Share link + QR join**: the host lobby shows a QR code and a Copy Link button alongside the room code; scanning or opening the link prefills the join code so players can hop in without typing it.
- **Host failover**: if the host's device disconnects mid-game, the server auto-promotes the longest-connected player to host after a short grace period, with a banner announcing the new host, so no one else needs to wait around for the original host to come back.
- **Duplicate-session handling**: opening the same player's session on a second device notifies the first device ("This game is now open on another device.") with a Use Here button to reclaim it, so switching devices mid-game never silently orphans a screen.
- **Host lobby controls**: the host can edit game settings after questions are submitted (players are notified to review and resubmit), and remove a player from the lobby before the game starts.
- **Help modal**: a "?" button on the home screen and in-game explains the game flow, the Submit/Override Previous/Pass/Skip Question buttons, Daily Double, timer/round modes, and host powers.

## Known Limitations
- **Room persistence is best-effort.** If the Supabase env vars are omitted, or Supabase is unreachable/misconfigured, the app still runs on in-memory state only and active games will not survive a server restart. It never blocks gameplay.

## Feature Backlog
- Media inputs (image, audio, etc) to be included with questions.
- LLM-based validator for answer correctness. *(Deferred: requires a paid API key, which conflicts with this project's free-services-only constraint.)*
- LLM-based question generation advisor to help players come up with questions. *(Deferred: same constraint.)*

## Tech Stack
- **Frontend**: React + Vite
- **Backend**: Node.js + Express + Socket.IO
- **Realtime transport**: WebSockets (Socket.IO)
- **Database**: Supabase (PostgreSQL, optional; see [Known Limitations](#known-limitations))
- **Deployment**: Render

## Local Development
1. Install dependencies.
   ```bash
   npm install
   ```
2. Create a local env file.
   ```bash
   cp .env.example .env
   ```
3. In Supabase, run the SQL in `supabase/schema.sql`, then paste your project values into `.env`.
4. Start backend + frontend.
   ```bash
   npm run dev
   ```
5. Open the app.
   ```
   http://localhost:5173
   ```

## Scripts
- `npm run dev`: run the Express/Socket.IO server and the Vite dev server together.
- `npm test`: run the server's in-process Socket.IO test suite (see [Testing & CI](#testing--ci)).
- `npm run test:e2e`: build the app and run the Playwright multi-user smoke test (see [Testing & CI](#testing--ci)).
- `npm run build`: production frontend build, output to `dist/`.
- `npm start`: run the production server, which serves `dist/` and the Socket.IO API from one process.

## Testing & CI
`npm test` runs the server's in-process Socket.IO test suite (`server/server.test.js`) against Node's built-in test runner. No Supabase connection is required; persistence is skipped automatically when the env vars are unset. This suite also runs on every push and pull request via [`.github/workflows/ci.yml`](.github/workflows/ci.yml), alongside a production build.

`npm run test:e2e` drives a real server plus three headless Chromium contexts (host + 2 players) through a full game with Playwright: lobby, question submission, team setup with a shuffle, a full board (a steal, the Daily Double, an emoji reaction, and a timer expiry with no host action), results, and a host restart, asserting every context stays in sync throughout. It's a local/manual check, not part of CI, and needs `npx playwright install chromium` once beforehand.

## Deployment
This app is designed as a single web service, so every player can open one public URL from their phones.

### Blueprint
1. Push this folder to GitHub.
2. In Render, choose **New +** → **Blueprint**.
3. Select your GitHub repo.
4. Render reads `render.yaml` and deploys automatically. The Supabase variables are declared in the blueprint as `sync: false`, meaning Render will prompt for their values on first deploy instead of embedding them in the file; enter the same values described under [Environment Variables](#environment-variables) below.

### Manual Web Service
- Build Command: `npm ci && npm run build`
- Start Command: `npm start`
- Runtime: Node 20+
- Set env var: `CLIENT_URL=https://<your-render-url>`

## Environment Variables
Full defaults and comments are in [`.env.example`](.env.example).

- `PORT`: backend port.
- `CLIENT_URL`: allowed frontend origin for Socket.IO CORS.
- `VITE_SERVER_URL`: client socket server URL in local development.
- `SUPABASE_URL`: Supabase **project** URL (Settings → API → Project URL, e.g. `https://xxxx.supabase.co`), not the `/rest/v1/` REST endpoint. Optional, see [Known Limitations](#known-limitations).
- `SUPABASE_SERVICE_ROLE_KEY`: server-only `service_role` key (Settings → API) used by the Node backend to save and restore room state. Bypasses row-level security by design, so RLS can be left on for the `rooms` table. Optional, see [Known Limitations](#known-limitations).
