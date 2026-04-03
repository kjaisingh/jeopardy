# Jeopardy
Welcome to a highly interactive, custom Jeopardy experience designed to make game nights, parties, and remote hangouts incredibly engaging. Unlike traditional trivia games where the questions are pre-written and static, this game relies entirely on the creativity of its players to build the ultimate challenge.


## Overview
- **Gather and Join**: One person acts as the host and creates a game room on a main screen, generating a simple six-character code. Everyone else simply opens the website on their own smartphones, tablets, or laptops and enters the code to join the lobby.
- **Build the Board**: Once you are in, the game asks you to come up with five unique trivia questions and answers. You will assign each of your questions a difficulty value ranging from 100 to 500 points, and together, everyone's submissions automatically build the custom Jeopardy board for that match.
- **Team Up**: After all the questions are locked in, the host takes over to organize the lobby into custom teams. The host also decides how many rounds the game will last, ensuring the game length perfectly fits your group's vibe.
- **Play and Score**: As the game kicks off, teams take turns selecting questions from the player-generated categories on the main board. When a team guesses an answer, the game acts as a smart virtual judge—it knows when your answer is close enough to be correct so you don't have to worry about perfect spelling, but the host always has a button to manually override the system if a debate breaks out.
- **Win the Game**: Correct answers boost your team's score, while incorrect ones pass the opportunity to the next team in line. The board updates in real-time across everyone's devices until all the questions are gone, crowning the team with the highest score as the ultimate trivia champions!


## Feature Backlog
- Optional random name picker wheel to decide teams.
- End-of-game statistics screen highlighting key metrics.
- Sound effects for answers, as well as background music.
- Double points on a random question each round.
- Media inputs (image, audio, etc) to be included with questions.
- Optional timer to limit how long teams have to answer.
- LLM-based validator for answer correctness.
- LLM-based question generation advisor to help players come up with questions.


## Tech Stack
- Frontend: React + Vite.
- Backend: Node.js + Express + Socket.IO.
- Realtime transport: WebSockets (Socket.IO).
- Hosting target: Render.


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

5. Open app.
```bash
http://localhost:5173
```


## Production Build
```bash
npm run build
npm start
```

The server runs on `PORT` (default `3001`) and serves the built frontend from `dist`.


## Deployment
This app is designed as a single web service, so every player can open one public URL from their phones.

### Blueprint
1. Push this folder to GitHub.
2. In Render, choose **New +** → **Blueprint**.
3. Select your GitHub repo.
4. Render reads `render.yaml` and deploys automatically.

### Manual Web Service
- Build Command: `npm install && npm run build`.
- Start Command: `npm start`.
- Runtime: Node 20+.
- Set env var: `CLIENT_URL=https://<your-render-url>`.


## Environment Variables
- `PORT`: backend port.
- `CLIENT_URL`: allowed frontend origin for Socket.IO CORS.
- `VITE_SERVER_URL`: client socket server URL in local development.
- `SUPABASE_URL`: Supabase project URL for durable room persistence.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only key used by the Node backend to save and restore room state.

If the Supabase variables are omitted, the app still runs, but room persistence falls back to in-memory only and active games will not survive a server restart.
