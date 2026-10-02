/**
 * Atrium realtime E2E: two real browser sessions (Cate + Uma) prove that
 * board moves, chat messages and announcements sync live across users.
 *
 * Prereqs: server on :4600, web dev server on :5100.
 * Run: npm test
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = CHROME_PATHS.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome/Edge found');
  process.exit(1);
}

// Point at any deployment with ATRIUM_URL, e.g. https://host/atrium
const BASE = process.env.ATRIUM_URL || 'http://localhost:5100';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function report(name, pass, extra = '') {
  results.push({ name, pass });
  console.log(`${pass ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`);
}

async function login(browser, email) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await page.click('input[type=email]', { clickCount: 3 });
  await page.type('input[type=email]', email, { delay: 5 });
  await page.click('input[type=password]', { clickCount: 3 });
  await page.type('input[type=password]', 'atrium123', { delay: 5 });
  await Promise.all([
    page.click('button[type=submit]'),
    page.waitForFunction(() => document.body.innerText.includes('Good'), { timeout: 10000 }),
  ]);
  return page;
}

async function currentDroppable(page, taskId) {
  return page.evaluate((id) => {
    const t = document.querySelector(`[data-task-id="${id}"]`);
    const col = t ? t.closest('[data-col-id]') : null;
    return col ? col.getAttribute('data-col-id') : null;
  }, taskId);
}

const browser = await puppeteer.launch({ executablePath, headless: 'shell' === 'never' ? false : true });

try {
  // ---- Sign both users in (isolated contexts = separate sessions) ----
  const cate = await login(browser, 'cate@asmtech.international');
  const uma = await login(browser, 'uma@asmtech.international');
  report('both users signed in', true);

  // ---- Both open the shared Project Alpha board ----
  await cate.goto(`${BASE}/groups/5`, { waitUntil: 'networkidle2' });
  await uma.goto(`${BASE}/groups/5`, { waitUntil: 'networkidle2' });
  await cate.waitForSelector('[data-task-id="12"]', { timeout: 10000 });
  await uma.waitForSelector('[data-task-id="12"]', { timeout: 10000 });

  const startCol = await currentDroppable(cate, 12);
  const targetCol = startCol === '19' ? '18' : '19'; // In Progress <-> Review
  const sameStart = (await currentDroppable(uma, 12)) === startCol;
  report('both users see the same task in the same column', sameStart, `column ${startCol}`);

  // ---- Cate drags the card to the target column with the mouse ----
  const rects = await cate.evaluate(
    ({ taskId, colId }) => {
      const card = document.querySelector(`[data-task-id="${taskId}"]`);
      const col = document.querySelector(`[data-col-id="${colId}"]`);
      const c = card.getBoundingClientRect();
      const k = col.getBoundingClientRect();
      return {
        from: { x: c.x + c.width / 2, y: c.y + 20 },
        to: { x: k.x + k.width / 2, y: k.y + 60 },
      };
    },
    { taskId: 12, colId: targetCol }
  );
  await cate.mouse.move(rects.from.x, rects.from.y);
  await cate.mouse.down();
  await sleep(120);
  await cate.mouse.move(rects.to.x, rects.to.y, { steps: 20 });
  await sleep(120);
  await cate.mouse.up();
  let cateMoved = false;
  try {
    await cate.waitForFunction(
      ({ taskId, colId }) => {
        const t = document.querySelector(`[data-task-id="${taskId}"]`);
        const col = t ? t.closest('[data-col-id]') : null;
        return col && col.getAttribute('data-col-id') === colId;
      },
      { timeout: 4000, polling: 200 },
      { taskId: 12, colId: targetCol }
    );
    cateMoved = true;
  } catch {}
  report('Cate drag-and-dropped the task', cateMoved);

  // ---- Uma sees the move WITHOUT any refresh ----
  let umaSees = false;
  try {
    await uma.waitForFunction(
      ({ taskId, colId }) => {
        const t = document.querySelector(`[data-task-id="${taskId}"]`);
        const col = t ? t.closest('[data-col-id]') : null;
        return col && col.getAttribute('data-col-id') === colId;
      },
      { timeout: 5000, polling: 200 },
      { taskId: 12, colId: targetCol }
    );
    umaSees = true;
  } catch {}
  report('REALTIME BOARD: Uma saw the move live (no refresh)', umaSees);

  // ---- Realtime chat ----
  await cate.goto(`${BASE}/groups/5?tab=chat`, { waitUntil: 'networkidle2' });
  await uma.goto(`${BASE}/groups/5?tab=chat`, { waitUntil: 'networkidle2' });
  await uma.waitForSelector('textarea[placeholder^="Message"]', { timeout: 10000 });
  const ping = `E2E ping ${Date.now()}`;
  await uma.type('textarea[placeholder^="Message"]', ping, { delay: 5 });

  // While Uma types, Cate should see the typing indicator
  let sawTyping = false;
  try {
    await cate.waitForFunction(() => document.body.innerText.includes('is typing'), {
      timeout: 4000,
      polling: 150,
    });
    sawTyping = true;
  } catch {}
  report('REALTIME CHAT: typing indicator shown to Cate', sawTyping);

  await uma.keyboard.press('Enter');
  let cateGotMessage = false;
  try {
    await cate.waitForFunction((txt) => document.body.innerText.includes(txt), { timeout: 5000, polling: 200 }, ping);
    cateGotMessage = true;
  } catch {}
  report('REALTIME CHAT: Cate received the message live', cateGotMessage);

  // ---- Realtime announcements ----
  await cate.goto(`${BASE}/groups/5?tab=announcements`, { waitUntil: 'networkidle2' });
  await uma.goto(`${BASE}/groups/5?tab=announcements`, { waitUntil: 'networkidle2' });
  const notice = `E2E notice ${Date.now()}`;
  await cate.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.innerText.includes('New announcement')), { timeout: 8000, polling: 200 });
  await cate.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.innerText.includes('New announcement')).click()
  );
  await cate.waitForSelector('input[placeholder="Title"]', { timeout: 5000 });
  await cate.type('input[placeholder="Title"]', notice, { delay: 5 });
  await cate.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.type === 'submit' && b.innerText.trim() === 'Post').click()
  );
  let umaGotAnnouncement = false;
  try {
    await uma.waitForFunction((txt) => document.body.innerText.includes(txt), { timeout: 5000, polling: 200 }, notice);
    umaGotAnnouncement = true;
  } catch {}
  report('REALTIME ANNOUNCEMENTS: Uma saw the new announcement live', umaGotAnnouncement);

  // ---- Uma also received a notification for it (personal lane) ----
  let umaNotified = false;
  try {
    await uma.waitForFunction(
      (txt) => document.body.innerText.includes(txt),
      { timeout: 5000, polling: 200 },
      'New announcement in your group'
    );
    umaNotified = true;
  } catch {
    // check the notifications page as fallback
    await uma.goto(`${BASE}/notifications`, { waitUntil: 'networkidle2' });
    umaNotified = await uma.evaluate(
      () => document.body.innerText.includes('New announcement in your group')
    );
  }
  report('NOTIFICATIONS: Uma received the announcement notification', umaNotified);

  // ---- Permission spot-check in the UI: Uma (not in Technical) cannot open it ----
  await uma.goto(`${BASE}/groups/3`, { waitUntil: 'networkidle2' });
  await sleep(600);
  const denied = await uma.evaluate(() => document.body.innerText.includes('not a member'));
  report('PERMISSIONS: Uma is blocked from the Technical workspace', denied);
} catch (err) {
  console.error('E2E run failed:', err);
  results.push({ name: 'run completed', pass: false });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} realtime E2E checks passed`);
process.exit(failed.length ? 1 : 0);
