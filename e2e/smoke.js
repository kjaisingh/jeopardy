import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

// Multi-user smoke test: drives a real server + real Chromium contexts (host
// + 2 players) through a full game — lobby, questions, teams, a full board
// (daily double, a steal, a timer expiry, an emoji reaction), results, and
// restart — asserting state stays in sync across every context.
//
// Runs the production server (dist + Socket.IO) on port 3001, matching the
// VITE_SERVER_URL baked into the build by the local .env, with CLIENT_URL
// set to the same origin so the server's CORS allowlist admits it.
// Usage: npm run build && node e2e/smoke.js

const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;
const TIMER_SECONDS = 30;

const log = (msg) => console.log(`[e2e] ${msg}`);

async function waitForHealth(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok && (await res.json()).ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`server never became healthy at ${url}`);
}

async function main() {
  log('starting server on :5173');
  const server = spawn('node', ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), CLIENT_URL: BASE_URL },
    stdio: 'inherit'
  });
  server.on('error', (error) => {
    throw error;
  });

  let browser;
  try {
    await waitForHealth(BASE_URL);
    log('server healthy');

    browser = await chromium.launch();
    const hostCtx = await browser.newContext();
    const p2Ctx = await browser.newContext();
    const p3Ctx = await browser.newContext();
    const host = await hostCtx.newPage();
    const p2 = await p2Ctx.newPage();
    const p3 = await p3Ctx.newPage();
    const players = [host, p2, p3];

    await Promise.all(players.map((page) => page.goto(BASE_URL)));

    // --- create room (host) ---
    log('host creating room');
    const createCard = host.locator('.home-card').filter({ hasText: 'Create a Game' });
    await createCard.getByLabel('Your name').fill('Host');
    await createCard.getByLabel('Questions per player').fill('2');
    await createCard.getByLabel('Answer timer').selectOption(String(TIMER_SECONDS));
    // finite mode (1 round) so a skipped/expired attempt truly exhausts and
    // rotates the turn, rather than infinite mode's endless re-loop
    await createCard.getByLabel('Round mode').selectOption('finite');
    await createCard.getByLabel('Rounds per team').fill('1');
    const dailyDoubleBox = createCard.getByLabel('Enable Daily Double');
    if (!(await dailyDoubleBox.isChecked())) await dailyDoubleBox.check();
    await createCard.getByRole('button', { name: 'Create Game' }).click();
    await host.locator('.room-code').waitFor();
    const roomCode = (await host.locator('.room-code').textContent()).trim();
    assert.match(roomCode, /^[A-Z0-9]{4,8}$/, `room code looks wrong: "${roomCode}"`);
    log(`room created: ${roomCode}`);

    // --- join (2 players) ---
    for (const [page, name] of [[p2, 'Player Two'], [p3, 'Player Three']]) {
      const joinCard = page.locator('.home-card').filter({ hasText: 'Join a Game' });
      await joinCard.getByLabel('Room code').fill(roomCode);
      await joinCard.getByLabel('Your name').fill(name);
      await joinCard.getByRole('button', { name: 'Join Game' }).click();
    }
    await Promise.all(players.map((page) => page.locator('.room-code').waitFor()));
    log('both players joined, room state in sync');

    // --- submit questions (all three write their own board column) ---
    const answers = {}; // playerName -> { [value]: correctAnswerText }
    const submitQuestions = async (page, name) => {
      answers[name] = {};
      const cards = page.locator('.question-card');
      const count = await cards.count();
      for (let i = 0; i < count; i += 1) {
        const card = cards.nth(i);
        const value = await card.locator('select').inputValue();
        const answerText = `${name}-answer-${value}`;
        await card.locator('textarea').fill(`${name}'s clue for $${value}`);
        await card.locator('input').fill(answerText);
        answers[name][value] = answerText;
      }
      await page.getByRole('button', { name: 'Submit My Questions' }).click();
    };
    await submitQuestions(host, 'Host');
    await submitQuestions(p2, 'Player Two');
    await submitQuestions(p3, 'Player Three');
    log('all questions submitted');

    // --- advance to team setup (host) ---
    const continueBtn = host.getByRole('button', { name: 'Continue to Team Setup' });
    await continueBtn.waitFor({ state: 'visible' });
    assert.equal(await continueBtn.isDisabled(), false, 'continue-to-team-setup should be enabled once everyone submitted');
    await continueBtn.click();
    await Promise.all(players.map((page) => page.getByRole('heading', { name: 'Team Setup' }).waitFor()));
    log('advanced to team setup, in sync across contexts');

    // --- shuffle teams (randomizer feature) + start ---
    await host.getByRole('button', { name: 'Shuffle Teams' }).click();
    const startBtn = host.getByRole('button', { name: 'Start Game' });
    await startBtn.waitFor();
    await startBtn.click();
    await Promise.all(players.map((page) => page.locator('.board-grid').waitFor()));
    log('game started, board visible in all contexts');

    const teamNames = await host.locator('.score-card .label').allTextContents();
    log(`teams: ${teamNames.join(', ')}`);

    const scoreOf = async (page, teamName) =>
      Number(
        (await page.locator('.score-card').filter({ hasText: teamName }).locator('.score-value').textContent()).replace('$', '')
      );

    const answeringTeam = async (page) => {
      const text = await page.locator('.active-meta').locator('span').nth(1).textContent();
      return text.replace('Answering team:', '').trim();
    };

    // a flash banner appears after every attempt outcome and overlays the
    // board, blocking the next cell click — dismiss it explicitly rather
    // than guess at its auto-fade timing
    const dismissFlash = async (page) => {
      // the app shows one banner at a time and only promotes the next queued
      // event once the current one is dismissed, so a single dismiss can
      // immediately reveal another (e.g. the steal cell's incorrect-then-
      // correct pair) — keep dismissing until none appear.
      const flash = page.locator('.result-flash').first();
      while (await flash.waitFor({ timeout: 1000 }).then(() => true).catch(() => false)) {
        await page.getByRole('button', { name: 'Dismiss' }).click();
        await flash.waitFor({ state: 'hidden' }).catch(() => {});
      }
    };

    // --- play every cell on the board ---
    const columns = host.locator('.board-column');
    const columnCount = await columns.count();
    let cellIndex = 0;
    let dailyDoubleSeen = false;

    for (let c = 0; c < columnCount; c += 1) {
      const column = columns.nth(c);
      const ownerName = (await column.locator('.board-header').textContent()).trim();
      const cellCount = await column.locator('.board-cell').count();

      for (let v = 0; v < cellCount; v += 1) {
        const cell = column.locator('.board-cell').nth(v);
        const value = (await cell.textContent()).replace('$', '').trim();
        const isLastCellOverall = c === columnCount - 1 && v === cellCount - 1;
        const isFirstCellOverall = cellIndex === 0;
        const isSecondCellOverall = cellIndex === 1;

        if (isSecondCellOverall) {
          // --- emoji reaction: fired on the open board (a question overlay would
          // block the reaction bar), must sync to host + player 3 ---
          await p2.locator('.reaction-button').first().click();
          await Promise.all([
            host.locator('.reaction-float').first().waitFor({ timeout: 3000 }),
            p3.locator('.reaction-float').first().waitFor({ timeout: 3000 })
          ]);
          log('emoji reaction synced to host + player 3');
        }

        await cell.click();
        await Promise.all(players.map((page) => page.locator('.question-overlay').waitFor()));

        const isDailyDouble = await host.locator('.daily-double-pill').isVisible();
        if (isDailyDouble) dailyDoubleSeen = true;
        const multiplier = isDailyDouble ? 2 : 1;
        const correctAnswer = answers[ownerName][value];
        assert.ok(correctAnswer, `no tracked answer for ${ownerName}/$${value}`);

        if (isFirstCellOverall) {
          // --- steal: first team misses on purpose, next team gets it right ---
          const firstResponder = await answeringTeam(host);
          const scoreBefore = await scoreOf(host, firstResponder);
          await host.getByLabel('Team answer').fill('deliberately wrong');
          await host.getByRole('button', { name: 'Submit' }).click();
          await host.locator('.active-meta').getByText(firstResponder).waitFor({ state: 'hidden' }).catch(() => {});
          const secondResponder = await answeringTeam(host);
          assert.notEqual(secondResponder, firstResponder, 'steal did not pass to the next team after a miss');
          log(`steal confirmed: ${firstResponder} missed, ${secondResponder} got the steal chance`);

          await host.getByLabel('Team answer').fill(correctAnswer);
          await host.getByRole('button', { name: 'Submit' }).click();
          await host.locator('.question-overlay').waitFor({ state: 'hidden' });
          const scoreAfter = await scoreOf(host, secondResponder);
          assert.equal(scoreAfter - (secondResponder === firstResponder ? scoreBefore : 0), Number(value) * multiplier, 'steal winner did not receive the expected points');
        } else if (isLastCellOverall) {
          // --- timer expiry: host does nothing, the client-side deadline must
          // auto-skip and pass the turn (finite mode: exhaustion still needs
          // the new responder to actually answer to close the board) ---
          log(`waiting out the ${TIMER_SECONDS}s timer on the final cell to confirm auto-skip`);
          const firstResponder = await answeringTeam(host);
          const deadline = Date.now() + (TIMER_SECONDS + 10) * 1000;
          let nextResponder = firstResponder;
          while (nextResponder === firstResponder && Date.now() < deadline) {
            await host.waitForTimeout(500);
            nextResponder = await answeringTeam(host);
          }
          assert.notEqual(nextResponder, firstResponder, 'timer expiry did not auto-skip the turn');
          log(`timer expiry auto-skipped with no host action: ${firstResponder} -> ${nextResponder}`);

          await host.getByLabel('Team answer').fill(correctAnswer);
          await host.getByRole('button', { name: 'Submit' }).click();
          await host.locator('.question-overlay').waitFor({ state: 'hidden' });
        } else {
          await host.getByLabel('Team answer').fill(correctAnswer);
          await host.getByRole('button', { name: 'Submit' }).click();
          await host.locator('.question-overlay').waitFor({ state: 'hidden' });
        }

        await dismissFlash(host);
        cellIndex += 1;
      }
    }

    log(dailyDoubleSeen ? 'daily double was landed on and played' : 'daily double was not landed on this run (random placement)');

    // --- results, in sync across contexts ---
    await Promise.all(players.map((page) => page.locator('.results-screen').waitFor()));
    const heroTexts = await Promise.all(players.map((page) => page.locator('.results-hero h1').textContent()));
    assert.equal(heroTexts[0], heroTexts[1], 'results hero text differs between host and player 2');
    assert.equal(heroTexts[0], heroTexts[2], 'results hero text differs between host and player 3');
    log(`game over: ${heroTexts[0]}`);

    // --- restart (host, two-click confirm) ---
    await host.getByRole('button', { name: 'Play Again' }).click();
    await host.getByRole('button', { name: 'Confirm New Game' }).click();
    await Promise.all(players.map((page) => page.getByRole('heading', { name: 'Question Submission' }).waitFor()));
    const newRoomCode = (await host.locator('.room-code').textContent()).trim();
    assert.notEqual(newRoomCode, roomCode, 'restart should issue a new room code');
    log(`restart confirmed: new room ${newRoomCode}, all contexts back at lobby`);

    log('SMOKE TEST PASSED');
  } finally {
    await browser?.close();
    server.kill();
  }
}

main().catch((error) => {
  console.error('[e2e] SMOKE TEST FAILED');
  console.error(error);
  process.exitCode = 1;
});
