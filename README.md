# Jeopardy
A realtime Jeopardy-style web app where every player joins by code, submits 5 Q/A prompts, and the host runs the board from one screen.


## Features
- Create game room and share a 6-character join code.
- Join game with player name from any phone/laptop.
- Each player submits 5 question/answer pairs mapped to 100/200/300/400/500.
- Host-only team setup before game starts.
- Configurable answer rounds (`finite` or `infinite`).
- Jeopardy board with question columns per player.
- Turn and score tracking.
- Automatic answer checking with case-insensitive + fuzzy matching.
- Host override for last incorrect attempt.
- Pass question with no points (especially useful in infinite mode).
- End-game winner display.
- Restart with a new room code.


## Stack
- Frontend: React + Vite.
- Backend: Node.js + Express + Socket.IO.
- Realtime transport: WebSockets (Socket.IO).
- Hosting target: Render.


## Local Development
1. Install dependencies.
```bash
npm install
```

2. Start backend + frontend.
```bash
npm run dev
```

3. Open app.
```bash
http://localhost:5173
```


## Production Build
```bash
npm run build
npm start
```

The server runs on `PORT` (default `3001`) and serves the built frontend from `dist`.


## Environment Variables
Copy `.env.example` to `.env` when needed.
- `PORT`: backend port.
- `CLIENT_URL`: allowed frontend origin for Socket.IO CORS.
- `VITE_SERVER_URL`: client socket server URL in local development.


## Deploy to Render
This app is designed as a single web service, so every player can open one public URL from their phones.

### Option A: Blueprint deploy (`render.yaml`)
1. Push this folder to GitHub.
2. In Render, choose **New +** → **Blueprint**.
3. Select your GitHub repo.
4. Render reads `render.yaml` and deploys automatically.

### Option B: Manual Web Service
- Build Command: `npm install && npm run build`.
- Start Command: `npm start`.
- Runtime: Node 20+.
- Set env var: `CLIENT_URL=https://<your-render-url>`.
