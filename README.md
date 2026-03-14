# Jeopardy Online

A realtime Jeopardy-style web app where every player joins by code, submits 5 Q/A prompts, and the host runs the board from one screen.

## Features

- Create game room and share a 6-character join code
- Join game with player name from any phone/laptop
- Each player submits 5 question/answer pairs mapped to 100/200/300/400/500
- Host-only team setup before game starts
- Configurable answer rounds (`finite` with custom count or `infinite`)
- Jeopardy board with one player column per question author
- Team turn tracking and score tracking
- Automatic answer checking with case-insensitive + fuzzy matching
- Host override for last incorrect attempt
- Pass question with no points (especially useful in infinite mode)
- End-game winner display + restart with a new room code

## Tech Stack

- Frontend: React + Vite
- Backend: Node.js + Express + Socket.IO
- Realtime transport: WebSockets (Socket.IO)
- Hosting target: Render (free tier supported)

## Local Development

1. Install dependencies

```bash
npm install
```

2. Start backend + frontend

```bash
npm run dev
```

3. Open app

- `http://localhost:5173`

## Production Build

```bash
npm run build
npm start
```

The server runs on `PORT` (default `3001`) and serves the built frontend from `dist`.

## Environment Variables

Copy `.env.example` to `.env` when needed.

- `PORT`: backend port
- `CLIENT_URL`: allowed frontend origin for Socket.IO CORS
- `VITE_SERVER_URL`: client socket server URL in local development

## Deploy to Render (Low Cost)

This app is designed as a single web service, so every player can open one public URL from their phones.

### Option A: Blueprint deploy (`render.yaml`)

1. Push this folder to GitHub (e.g. `kjaisingh/jeopardy-online`)
2. In Render, choose **New +** → **Blueprint**
3. Select your GitHub repo
4. Render reads `render.yaml` and deploys automatically

### Option B: Manual Web Service

- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Runtime: Node 20+
- Set env var: `CLIENT_URL=https://<your-render-url>`

## Recommended Always-On Setup (for friends)

If you want the game available at any time without waking up, use a paid always-on web service plan.

1. Deploy on Render using the same settings above
2. Upgrade service plan from Free to Starter
3. Keep `CLIENT_URL` set to your public app URL
4. Share your Render URL (or custom domain) with friends

Notes:

- Free plan works for testing, but can sleep when idle and take time to wake up
- Starter plan is low-cost and avoids sleep, which is better for live game sessions
- No mobile app install is needed; everyone joins from browser by room code

## Publish to GitHub

From the `jeopardy` folder:

```bash
git init
git add .
git commit -m "Initial Jeopardy Online app"
git branch -M main
git remote add origin https://github.com/kjaisingh/jeopardy-online.git
git push -u origin main
```

## Gameplay Summary

1. Host creates room and shares code
2. Players join and submit their 5 Q/A pairs
3. When all submit, host configures teams + rounds mode
4. Host runs board, accepts answer attempts by team order
5. Wrong attempts can be overridden by host
6. Game ends when all cells are closed
7. Host can restart and get a new room code