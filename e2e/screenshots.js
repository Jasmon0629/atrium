/**
 * Capture product figures headlessly. Prereqs: server :4600 + web :5100 running.
 * Output: e2e/shots/*.png
 */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = CHROME_PATHS.find((p) => existsSync(p));
const BASE = 'http://localhost:5100';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots') + path.sep;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--hide-scrollbars'] });

async function login(email, viewport = { width: 1440, height: 900 }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(viewport);
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.click('input[type=email]', { clickCount: 3 });
  await page.type('input[type=email]', email);
  await page.click('input[type=password]', { clickCount: 3 });
  await page.type('input[type=password]', 'atrium123');
  await Promise.all([
    page.click('button[type=submit]'),
    page.waitForFunction(() => document.body.innerText.includes('Good'), { timeout: 10000 }),
  ]);
  return page;
}

async function shot(page, name, extraWait = 400) {
  await sleep(extraWait);
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log('captured', name);
}

// 1. Login page
{
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await shot(page, '01-login', 800);
  await context.close();
}

// Jason: dashboard, board, task modal, chat
{
  const page = await login('cate@asmtech.international');
  await shot(page, '02-dashboard', 900);

  await page.goto(`${BASE}/groups/3`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-task-id]');
  await shot(page, '03-kanban-board', 700);

  await page.goto(`${BASE}/groups/3?task=1`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.toLowerCase().includes('discussion'), { timeout: 8000 });
  await shot(page, '04-task-detail', 700);

  await page.goto(`${BASE}/chat/3`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('backup'), { timeout: 8000 });
  await shot(page, '05-chat', 700);
  await page.browserContext().close();
}

// Sarah: announcements
{
  const page = await login('uma@asmtech.international');
  await page.goto(`${BASE}/announcements`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('Client meeting'), { timeout: 8000 });
  await shot(page, '06-announcements', 700);
  await page.browserContext().close();
}

// Kiosk display 1920x1080 (Technical) + company overview
{
  const page = await login('cate@asmtech.international', { width: 1920, height: 1080 });
  await page.goto(`${BASE}/kiosk/3`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('Live team board'), { timeout: 8000 });
  await shot(page, '07-kiosk-display', 1200);
  await page.goto(`${BASE}/kiosk`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('Live overview'), { timeout: 8000 });
  await shot(page, '09-kiosk-overview', 1200);
  await page.browserContext().close();
}

// Mobile dashboard 390x844
{
  const page = await login('uma@asmtech.international', { width: 390, height: 844 });
  await shot(page, '08-mobile-dashboard', 800);
  await page.browserContext().close();
}

await browser.close();
console.log('done ->', OUT);
