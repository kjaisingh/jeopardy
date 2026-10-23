import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

// Local multiplayer coverage with isolated, in-memory rooms. Run npm run test:e2e.
const TIMER_SECONDS = 3;

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
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, resolve));
  const PORT = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const BASE_URL = `http://localhost:${PORT}`;
  log(`starting server on :${PORT}`);
  const testEnv = { ...process.env };
  delete testEnv.SUPABASE_URL;
  delete testEnv.SUPABASE_SERVICE_ROLE_KEY;
  const server = spawn('node', ['server/index.js'], {
    env: { ...testEnv, PORT: String(PORT), CLIENT_URL: BASE_URL },
    stdio: ['ignore', 'pipe', 'inherit']
  });

  let browser;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Test server did not start')), 15000);
      let output = '';
      server.stdout.on('data', (chunk) => {
        process.stdout.write(chunk);
        output += chunk.toString();
        if (output.includes(`Jeopardy server listening on port ${PORT}`)) {
          clearTimeout(timeout);
          resolve();
        }
      });
      server.once('error', (error) => { clearTimeout(timeout); reject(error); });
      server.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Test server exited: ${code}`)); });
    });
    await waitForHealth(BASE_URL);
    log('server healthy');

    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const hostCtx = await browser.newContext();
    const p2Ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p3Ctx = await browser.newContext();
    const host = await hostCtx.newPage();
    const p2 = await p2Ctx.newPage();
    const p3 = await p3Ctx.newPage();
    const players = [host, p2, p3];
    const browserErrors = [];
    for (const page of players) {
      page.on('pageerror', (error) => browserErrors.push(error.message));
    }
    await Promise.all(players.map((page) => page.goto(BASE_URL)));

    const blockedStorage = await browser.newContext();
    await blockedStorage.addInitScript(() => {
      Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('Storage blocked'); } });
    });
    const blockedPage = await blockedStorage.newPage();
    blockedPage.on('pageerror', (error) => browserErrors.push(error.message));
    await blockedPage.goto(BASE_URL);
    const blockedCreate = blockedPage.locator('.create-card');
    await blockedCreate.getByLabel('Your name').fill('No Storage');
    await blockedCreate.getByRole('button', { name: 'Create Game' }).click();
    await blockedPage.locator('.room-code').waitFor();
    await blockedPage.getByText('Browser storage unavailable.', { exact: false }).waitFor();
    await blockedStorage.close();
    log('blocked browser storage does not crash creation or gameplay');

    // --- create room (host) ---
    log('host creating room');
    const createCard = host.locator('.home-card').filter({ hasText: 'Create a Game' });
    await createCard.getByLabel('Your name').fill('Host');
    await createCard.getByLabel('Questions per player').fill('2');
    await createCard.getByLabel('Answer timer').selectOption(String(TIMER_SECONDS));
    // finite mode (1 round) so a skipped/expired attempt truly exhausts and
    // rotates the turn, rather than infinite mode's endless re-loop
    await createCard.getByLabel('Attempt mode').selectOption('finite');
    await createCard.getByLabel('Attempts per team, per question').fill('1');
    const dailyDoubleBox = createCard.getByLabel('Enable Daily Double');
    if (!(await dailyDoubleBox.isChecked())) await dailyDoubleBox.check();
    await createCard.getByRole('button', { name: 'Create Game' }).click();
    await host.locator('.room-code').waitFor();
    const roomCode = (await host.locator('.room-code').textContent()).trim();
    assert.match(roomCode, /^[A-Z0-9]{4,8}$/, `room code looks wrong: "${roomCode}"`);
    log(`room created: ${roomCode}`);

    // --- join (2 players) ---
    for (const [page, name] of [[p2, 'Player Two'], [p3, 'Player Three']]) {
      if (page === p2) {
        await page.goto(`${BASE_URL}/?join=${roomCode}`);
        await page.getByLabel('Your name', { exact: true }).last().waitFor();
        assert.equal(await page.locator('#join-name').evaluate((input) => input === globalThis.document.activeElement), true);
        const joinBox = await page.locator('.join-card').boundingBox();
        const createBox = await page.locator('.create-card').boundingBox();
        assert.ok(joinBox.y < createBox.y, 'invite link should put joining first on mobile');
        assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
      }
      const joinCard = page.locator('.home-card').filter({ hasText: 'Join a Game' });
      await joinCard.getByLabel('Room code').fill(roomCode);
      await joinCard.getByLabel('Your name').fill(name);
      await joinCard.getByRole('button', { name: 'Join Game' }).click();
    }
    await Promise.all(players.map((page) => page.locator('.room-code').waitFor()));
    log('both players joined, room state in sync');

    await p2.getByRole('button', { name: 'Go Home' }).click();
    await p2.getByRole('button', { name: 'Forget Saved Session' }).click();
    await host.locator('.players-list .pill').filter({ hasText: 'Player Two' }).waitFor({ state: 'detached' });
    const rejoinCard = p2.locator('.home-card').filter({ hasText: 'Join a Game' });
    await rejoinCard.getByLabel('Room code').fill(roomCode);
    await rejoinCard.getByLabel('Your name').fill('Player Two');
    await rejoinCard.getByRole('button', { name: 'Join Game' }).click();
    await p2.locator('.room-code').waitFor();
    log('permanent leave removes lobby slot and allows same-name rejoin');

    // --- detach/resume and local draft recovery ---
    await host.getByRole('button', { name: 'Go Home' }).click();
    await host.getByRole('button', { name: 'Resume Previous Game' }).click();
    await host.locator('.room-code').waitFor();
    assert.equal((await host.locator('.room-code').textContent()).trim(), roomCode);

    const firstHostCard = host.locator('.question-card').first();
    await firstHostCard.locator('textarea').fill('Draft survives reload');
    await firstHostCard.locator('input').fill('Draft answer');
    await host.waitForTimeout(100);
    await host.reload();
    await host.locator('.room-code').waitFor();
    assert.equal(await host.locator('.question-card').first().locator('textarea').inputValue(), 'Draft survives reload');
    log('go-home resume and local draft recovery confirmed');

    // --- submit questions (all three write their own board column) ---
    const answers = {}; // playerName -> { [value]: correctAnswerText }
    const submitQuestions = async (page, name) => {
      answers[name] = {};
      const cards = page.locator('.question-card');
      const count = await cards.count();
      for (let i = 0; i < count; i += 1) {
        const card = cards.nth(i);
        const value = (await card.locator('.question-head strong').textContent()).replace('$', '').trim();
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

    await host.getByRole('button', { name: 'Edit My Questions' }).click();
    await host.locator('.question-card').first().locator('textarea').fill('Revised clue survives reload');
    await host.reload();
    await host.locator('.question-card').first().waitFor();
    assert.equal(await host.locator('.question-card').first().locator('textarea').inputValue(), 'Revised clue survives reload');
    await host.getByRole('button', { name: 'Submit My Questions' }).click();
    log('edits to submitted questions survive reload');

    // --- advance to team setup (host) ---
    const continueBtn = host.getByRole('button', { name: 'Continue to Team Setup' });
    await host.locator('button:enabled').filter({ hasText: 'Continue to Team Setup' }).waitFor();
    assert.equal(await continueBtn.isDisabled(), false, 'continue-to-team-setup should be enabled once everyone submitted');
    await continueBtn.click();
    await Promise.all(players.map((page) => page.getByRole('heading', { name: 'Team Setup' }).waitFor()));
    log('advanced to team setup, in sync across contexts');

    // --- duplicate-name guard, shuffle teams, and start ---
    const teamNameInputs = host.locator('.team-card input');
    await teamNameInputs.nth(0).fill('Duplicate');
    await teamNameInputs.nth(1).fill('Duplicate');
    assert.equal(
      await host.getByRole('button', { name: 'Start Game' }).isDisabled(),
      true,
      'duplicate team names should block Start Game'
    );
    await teamNameInputs.nth(0).fill('Team 1');
    await teamNameInputs.nth(1).fill('Team 2');
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
          // --- timer expiry: host does nothing, the server-side deadline must
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
        const recapAnswers = await Promise.all(players.map((page) => page.locator('.question-recap > p strong').textContent()));
        assert.deepEqual(recapAnswers, [correctAnswer, correctAnswer, correctAnswer]);
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
    for (const page of players) {
      assert.equal(await page.locator('.question-card').first().locator('textarea').inputValue(), '', 'a new round starts with fresh questions');
    }
    log(`restart confirmed: new room ${newRoomCode}, all contexts back at lobby`);

    await submitQuestions(p2, 'Player Two');
    await host.getByText('Player Two · Ready').waitFor();
    log('non-host session remained authorized after restart');

    assert.deepEqual(browserErrors, [], 'browser should not report uncaught errors');
    log('SMOKE TEST PASSED');
  } finally {
    await browser?.close();
    if (server.exitCode === null) {
      const exited = new Promise((resolve) => server.once('exit', resolve));
      server.kill();
      await exited;
    }
  }
}

main().catch((error) => {
  console.error('[e2e] SMOKE TEST FAILED');
  console.error(error);
  process.exitCode = 1;
});
