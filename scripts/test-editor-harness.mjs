#!/usr/bin/env node

/**
 * Playwright-driven probes for the /editor-harness page.
 *
 * Measures what the eye can't easily quantify: cumulative layout shift
 * during idle, cursor movement, typing, and scroll, plus whether a
 * drag-selection still produces the raw markdown on copy.
 *
 * Usage:
 *   node scripts/test-editor-harness.mjs               # auto-start dev server
 *   node scripts/test-editor-harness.mjs --headed      # see the browser
 *   node scripts/test-editor-harness.mjs --skip-dev    # assume :1420 is up
 *   HARNESS_URL=http://foo:1420 node scripts/test-editor-harness.mjs
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const headed = args.has('--headed');
const skipDev = args.has('--skip-dev');
const base = process.env.HARNESS_URL || 'http://localhost:1420';

const SCREENSHOT_DIR = path.join(repoRoot, '.harness-screenshots');
rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ---------- dev server lifecycle ----------

async function isServerUp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await isServerUp(base)) {
    log('info', `using existing dev server at ${base}`);
    return null;
  }
  if (skipDev) {
    throw new Error(`dev server not reachable at ${base} and --skip-dev was set`);
  }
  log('info', 'starting vite dev server…');
  const proc = spawn('npm', ['run', 'dev'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    if (await isServerUp(base)) {
      log('info', `dev server ready (${Math.round((Date.now() - start) / 100) / 10}s)`);
      return proc;
    }
    await sleep(400);
  }
  proc.kill('SIGTERM');
  throw new Error(`dev server did not respond on ${base} within 60s`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- logging ----------

const results = [];
const COLORS = { reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
function color(c, s) {
  return process.stdout.isTTY ? `${COLORS[c]}${s}${COLORS.reset}` : s;
}

function log(level, msg) {
  const tag = level === 'fail' ? color('red', 'FAIL') : level === 'warn' ? color('yellow', 'WARN') : level === 'ok' ? color('green', ' OK ') : color('cyan', 'INFO');
  console.log(`[${tag}] ${msg}`);
}

function record(name, status, detail) {
  results.push({ name, status, detail });
  log(status === 'pass' ? 'ok' : status === 'warn' ? 'warn' : status === 'fail' ? 'fail' : 'info', `${name.padEnd(38)} ${detail}`);
}

// ---------- CLS measurement helpers ----------

const BEGIN_CLS_WINDOW = /* js */ `
  (() => {
    window.__clsEntries = [];
    window.__clsObserver?.disconnect();
    window.__clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__clsEntries.push({
          value: entry.value,
          hadRecentInput: entry.hadRecentInput,
          startTime: entry.startTime,
          sources: (entry.sources || []).map(s => ({
            node: s.node?.nodeName || null,
            className: s.node?.className || null,
            previousRect: { x: s.previousRect.x, y: s.previousRect.y, w: s.previousRect.width, h: s.previousRect.height },
            currentRect: { x: s.currentRect.x, y: s.currentRect.y, w: s.currentRect.width, h: s.currentRect.height },
          })),
        });
      }
    });
    window.__clsObserver.observe({ type: 'layout-shift', buffered: false });
  })();
`;

const END_CLS_WINDOW = /* js */ `
  (() => {
    window.__clsObserver?.disconnect();
    const entries = window.__clsEntries || [];
    window.__clsEntries = [];
    const total = entries.reduce((a, e) => a + e.value, 0);
    return { total, count: entries.length, entries };
  })();
`;

async function measureCLS(page, durationMs, action) {
  await page.evaluate(BEGIN_CLS_WINDOW);
  if (action) await action();
  await page.waitForTimeout(durationMs);
  return page.evaluate(END_CLS_WINDOW);
}

function topShiftSources(entries, n) {
  const byNode = new Map();
  for (const e of entries) {
    for (const s of e.sources || []) {
      const key = `${s.node}.${(s.className || '').toString().split(' ').slice(0, 2).join('.')}`;
      byNode.set(key, (byNode.get(key) || 0) + e.value / Math.max(1, e.sources.length));
    }
  }
  return [...byNode.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}(${v.toFixed(3)})`)
    .join(', ');
}

// ---------- probes ----------

async function probeIdle(page) {
  await page.waitForSelector('.cm-editor');
  await page.waitForTimeout(300);
  const cls = await measureCLS(page, 1500);
  const status = cls.total < 0.05 ? 'pass' : cls.total < 0.2 ? 'warn' : 'fail';
  record('idle CLS (1.5s post-mount)', status, `total=${cls.total.toFixed(3)} shifts=${cls.count}`);
  return cls;
}

async function probeCursorPingPong(page) {
  // Bounce the cursor between an H2 and a plain paragraph line a few
  // times. Each cursor move swaps which line is "active" and triggers
  // a decoration rebuild; if the swap changes heights, CLS spikes.
  const h2 = page.locator('.cm-line.cm-atomic-h2').first();
  const para = page.locator('.cm-line:not([class*="cm-atomic"])').nth(4);
  if ((await h2.count()) === 0 || (await para.count()) === 0) {
    record('cursor ping-pong CLS', 'fail', 'missing target lines');
    return null;
  }
  const h2box = await h2.boundingBox();
  const pbox = await para.boundingBox();
  if (!h2box || !pbox) {
    record('cursor ping-pong CLS', 'fail', 'no bbox');
    return null;
  }
  const cls = await measureCLS(page, 2500, async () => {
    for (let i = 0; i < 5; i++) {
      await page.mouse.click(h2box.x + 40, h2box.y + h2box.height / 2);
      await page.waitForTimeout(160);
      await page.mouse.click(pbox.x + 40, pbox.y + pbox.height / 2);
      await page.waitForTimeout(160);
    }
  });
  const status = cls.total < 0.05 ? 'pass' : cls.total < 0.2 ? 'warn' : 'fail';
  const topSrc = topShiftSources(cls.entries, 4);
  record(
    'ping-pong CLS (10 moves)',
    status,
    `total=${cls.total.toFixed(3)} shifts=${cls.count}${topSrc ? ` sources=${topSrc}` : ''}`,
  );
  return cls;
}

async function probeClickFreeze(page) {
  // Behavior under test: when you click a heading line, the `# ` prefix
  // should NOT appear immediately (that's what shifts layout under the
  // cursor and turns clicks into micro-drags). It should appear a beat
  // after the mouse is released, once the freeze tail expires.
  const h2 = page.locator('.cm-line.cm-atomic-h2').first();
  if ((await h2.count()) === 0) {
    record('click freeze: heading stays rendered during click', 'fail', 'no H2 line');
    return;
  }
  const box = await h2.boundingBox();
  if (!box) {
    record('click freeze: heading stays rendered during click', 'fail', 'no bbox');
    return;
  }

  // Measure the line text before the click — we expect `## ` to be
  // hidden, so the text starts with the heading's first non-syntax
  // character.
  const textBefore = (await h2.textContent())?.trim() ?? '';

  await page.mouse.click(box.x + Math.min(box.width / 3, 80), box.y + box.height / 2);

  // Within the freeze window (<160ms), the syntax should still be hidden.
  await page.waitForTimeout(30);
  const textDuringFreeze = (await h2.textContent())?.trim() ?? '';
  const stayedRendered = !/^##\s/.test(textDuringFreeze);

  // After the freeze tail, syntax should be revealed.
  await page.waitForTimeout(250);
  const textAfterFreeze = (await h2.textContent())?.trim() ?? '';
  const revealed = /^##\s/.test(textAfterFreeze);

  record(
    'click freeze: heading stays rendered mid-click',
    stayedRendered ? 'pass' : 'fail',
    `before="${textBefore.slice(0, 40)}" duringFreeze="${textDuringFreeze.slice(0, 40)}"`,
  );
  record(
    'click freeze: syntax revealed after tail',
    revealed ? 'pass' : 'fail',
    `afterFreeze="${textAfterFreeze.slice(0, 40)}"`,
  );

  // Verify the click didn't turn into a micro-drag — selection should
  // be a collapsed cursor, not a range.
  const selLen = await page.evaluate(() => window.getSelection()?.toString().length ?? 0);
  record(
    'click freeze: no accidental selection',
    selLen === 0 ? 'pass' : 'fail',
    `selectionLen=${selLen}`,
  );
}

async function probeFenceVisibility(page) {
  // When any line inside a fenced code block is active, the ``` fences
  // (and language info) should stay visible so the user keeps context
  // while editing code. Without the FencedCode expansion the fence
  // lines would be considered inactive and their CodeMark/CodeInfo
  // tokens would be hidden.

  const codeLines = page.locator('.cm-line.cm-atomic-fenced-code');
  const count = await codeLines.count();
  if (count < 3) {
    record('fence stays visible while editing code', 'fail', `only ${count} fenced-code lines`);
    return;
  }

  // Opening fence is the first such line. Interior code is somewhere
  // between the open and close — pick the second line which is
  // immediately after the opening fence.
  const openFence = codeLines.nth(0);
  const interior = codeLines.nth(1);
  const interiorBox = await interior.boundingBox();
  if (!interiorBox) {
    record('fence stays visible while editing code', 'fail', 'no interior bbox');
    return;
  }

  // Click inside the interior code line to make it active.
  await page.mouse.click(interiorBox.x + 30, interiorBox.y + interiorBox.height / 2);
  // Past the freeze tail so the decoration rebuild has applied.
  await page.waitForTimeout(200);

  const fenceText = (await openFence.textContent())?.trim() ?? '';
  const visible = /^```/.test(fenceText);
  record(
    'fence stays visible while editing code',
    visible ? 'pass' : 'fail',
    `fenceLine="${fenceText.slice(0, 40)}"`,
  );
}

async function runNewBulletListScenario(page, label, setup, screenshotName) {
  const uniq = `ITEM_${Date.now().toString(36).slice(-4)}`;
  await setup(page, uniq);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, screenshotName), fullPage: false });

  const itemA = page.locator('.cm-line', { hasText: `${uniq}A` }).first();
  const itemB = page.locator('.cm-line', { hasText: `${uniq}B` }).first();
  if ((await itemA.count()) === 0 || (await itemB.count()) === 0) {
    record(`list gap [${label}]`, 'fail', 'items not found');
    return;
  }
  const aBox = await itemA.boundingBox();
  const bBox = await itemB.boundingBox();
  if (!aBox || !bBox) {
    record(`list gap [${label}]`, 'fail', 'no bbox');
    return;
  }
  const gap = bBox.y - (aBox.y + aBox.height);
  const status = gap < 8 ? 'pass' : gap < 40 ? 'warn' : 'fail';

  // Collect every .cm-line that sits between itemA and itemB vertically
  // and dump their text so we can see whether an extra blank line
  // exists in the DOM (and whether it's in the doc or only in the
  // rendered layout).
  const between = await page.evaluate(
    ({ yA, yB }) => {
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      return lines
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            mid: r.top + r.height / 2,
            text: el.textContent ?? '',
            cls: el.className,
          };
        })
        .filter((info) => info.mid > yA && info.mid < yB)
        .slice(0, 5);
    },
    { yA: aBox.y + aBox.height / 2, yB: bBox.y + bBox.height / 2 },
  );
  const betweenStr = between.map((b) => `"${b.text.slice(0, 30)}"[${b.cls.replace(/cm-/g, '')}]`).join(' | ');

  // Dump a wide window of .cm-line divs around the typed items so we
  // can see the full line structure the editor produced.
  const docExcerpt = await page.evaluate((marker) => {
    const lines = Array.from(document.querySelectorAll('.cm-line'));
    const idx = lines.findIndex((el) => (el.textContent || '').includes(marker + 'A'));
    if (idx < 0) return null;
    const slice = lines.slice(Math.max(0, idx - 5), idx + 5);
    return slice
      .map((el) => `[${(el.textContent || '').slice(0, 30)}]`)
      .join(' / ');
  }, uniq);

  record(
    `list gap [${label}]`,
    status,
    `gap=${gap.toFixed(1)}px between=${betweenStr || '(none)'} doc="${docExcerpt}"`,
  );
}

async function probeNewBulletList(page) {
  // Scenario A: after a plain paragraph, two blank lines, then list.
  await runNewBulletListScenario(
    page,
    'after para +2 blanks',
    async (p, uniq) => {
      const para = p.locator('.cm-line:not([class*="cm-atomic"])').nth(3);
      const box = await para.boundingBox();
      await p.mouse.click(box.x + 40, box.y + box.height / 2);
      await p.waitForTimeout(180);
      await p.keyboard.press('End');
      await p.keyboard.press('Enter');
      await p.keyboard.press('Enter');
      await p.keyboard.type(`- ${uniq}A`);
      await p.keyboard.press('Enter');
      await p.keyboard.type(`${uniq}B`);
    },
    '20-list-after-para.png',
  );

  // Scenario B: immediately after a heading, single Enter, then list.
  // (Obsidian and GFM behave differently about tight/loose lists here.)
  await runNewBulletListScenario(
    page,
    'after h2 +1 blank',
    async (p, uniq) => {
      const h2 = p.locator('.cm-line.cm-atomic-h2').nth(1); // second h2 to avoid the first
      const box = await h2.boundingBox();
      await p.mouse.click(box.x + 40, box.y + box.height / 2);
      await p.waitForTimeout(180);
      await p.keyboard.press('End');
      await p.keyboard.press('Enter');
      await p.keyboard.press('Enter');
      await p.keyboard.type(`- ${uniq}A`);
      await p.keyboard.press('Enter');
      await p.keyboard.type(`${uniq}B`);
    },
    '21-list-after-h2.png',
  );

}

async function probeTaskList(page) {
  // Focus the editor, jump cursor to doc end (stable target regardless of
  // what earlier probes typed), add a blank line, then write a task item.
  const content = page.locator('.cm-content').first();
  await content.click();
  await page.waitForTimeout(180);
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  const uniq = `TASK_${Date.now().toString(36).slice(-4)}`;
  await page.keyboard.type(`- [ ] ${uniq}`);
  await page.waitForTimeout(300);

  const checkboxCount = await page
    .locator(`.cm-line:has-text("${uniq}") input.cm-atomic-task-checkbox`)
    .count();
  record(
    'task list: checkbox appears',
    checkboxCount > 0 ? 'pass' : 'fail',
    `checkbox count on task line = ${checkboxCount}`,
  );
  if (checkboxCount === 0) return;

  const checkbox = page
    .locator(`.cm-line:has-text("${uniq}") input.cm-atomic-task-checkbox`)
    .first();

  // Click to toggle. Use force: true because the input is a widget and
  // Playwright's normal actionability checks (not-covered, stable) can
  // trip over decoration rebuilds.
  await checkbox.click({ force: true });
  await page.waitForTimeout(150);

  const checkedNow = await checkbox.evaluate((el) => el.checked);
  record(
    'task list: click toggles checked',
    checkedNow ? 'pass' : 'fail',
    `checkbox.checked = ${checkedNow}`,
  );

  // Enter on a task line should create another task (not a plain
  // bullet). Place cursor at end of the current task, press Enter,
  // type a marker for the new item, and assert a second checkbox
  // appears.
  const nextMarker = `NEXT_${Date.now().toString(36).slice(-4)}`;
  await page.locator(`.cm-line:has-text("${uniq}")`).first().click({ force: true });
  await page.waitForTimeout(180);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(nextMarker);
  await page.waitForTimeout(200);

  const nextHasCheckbox = await page
    .locator(`.cm-line:has-text("${nextMarker}") input.cm-atomic-task-checkbox`)
    .count();
  record(
    'task list: Enter continues as task',
    nextHasCheckbox > 0 ? 'pass' : 'fail',
    `new line checkbox count = ${nextHasCheckbox}`,
  );

  const lineClasses = await page
    .locator(`.cm-line:has-text("${uniq}")`)
    .first()
    .evaluate((el) => el.className);
  const hasDoneClass = /cm-atomic-task-done/.test(lineClasses);
  record(
    'task list: completed line strikes through',
    hasDoneClass ? 'pass' : 'fail',
    `classes="${lineClasses}"`,
  );

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '24-task-list.png'), fullPage: false });
}

async function probeTyping(page) {
  // Cursor should already be somewhere in the doc. Type a burst of
  // characters and watch CLS.
  const cls = await measureCLS(page, 1200, async () => {
    for (const ch of 'hello world') {
      await page.keyboard.press(ch === ' ' ? 'Space' : `Key${ch.toUpperCase()}`);
      await page.waitForTimeout(25);
    }
  });
  const status = cls.total < 0.05 ? 'pass' : cls.total < 0.2 ? 'warn' : 'fail';
  record('type inside line (CLS)', status, `total=${cls.total.toFixed(3)} shifts=${cls.count}`);
  return cls;
}

async function probeDeepScrollRenders(page) {
  // Regression guard for "content past the initial parse window appears
  // as raw markdown until a click nudges the parser forward." We scroll
  // to the bottom half of the doc and check that the headings in the
  // fresh viewport actually picked up their `cm-atomic-h*` classes
  // (i.e., the decoration plugin rebuilt with a tree that reaches here).
  const editor = page.locator('.cm-scroller');
  await editor.evaluate((el) => {
    el.scrollTop = el.scrollHeight * 0.75;
  });
  // Let CM6 re-measure + our plugin rebuild decorations.
  await page.waitForTimeout(350);

  const headingsInViewport = await page.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller');
    if (!scroller) return null;
    const vRect = scroller.getBoundingClientRect();
    const lines = Array.from(document.querySelectorAll('.cm-line'));
    let decorated = 0;
    let rawHeadings = 0;
    for (const el of lines) {
      const r = el.getBoundingClientRect();
      if (r.bottom < vRect.top || r.top > vRect.bottom) continue;
      const text = el.textContent || '';
      const looksLikeHeading = /^#{1,6}\s/.test(text);
      const hasHeadingClass = /\bcm-atomic-h[1-6]\b/.test(el.className);
      if (hasHeadingClass) decorated++;
      // Raw heading = doc-side `## foo` with NO `cm-atomic-h*` class →
      // the decoration failed to apply. That's the bug.
      if (looksLikeHeading && !hasHeadingClass) rawHeadings++;
    }
    return { decorated, rawHeadings };
  });

  const status =
    headingsInViewport && headingsInViewport.rawHeadings === 0 ? 'pass' : 'fail';
  record(
    'deep-scroll headings decorate',
    status,
    `decorated=${headingsInViewport?.decorated ?? '?'} raw=${headingsInViewport?.rawHeadings ?? '?'}`,
  );
}

async function probeScroll(page) {
  const editor = page.locator('.cm-scroller');
  await editor.evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(200);
  const cls = await measureCLS(page, 2000, async () => {
    await editor.evaluate(async (el) => {
      const step = Math.max(el.clientHeight * 0.8, 400);
      for (let i = 0; i < 10; i++) {
        el.scrollTop += step;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
    });
  });
  const status = cls.total < 0.15 ? 'pass' : cls.total < 0.6 ? 'warn' : 'fail';
  const topSrc = topShiftSources(cls.entries, 3);
  record('scroll CLS (2s)', status, `total=${cls.total.toFixed(3)} shifts=${cls.count}${topSrc ? ` sources=${topSrc}` : ''}`);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-after-scroll.png'), fullPage: false });
  return cls;
}

async function probeSelection(page) {
  const editor = page.locator('.cm-scroller');
  await editor.evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(200);

  // Drag across multiple visible lines.
  const lines = page.locator('.cm-line:not(:empty)');
  const count = await lines.count();
  if (count < 3) {
    record('drag-select across lines', 'fail', `only ${count} lines visible`);
    return null;
  }
  const firstBox = await lines.nth(1).boundingBox();
  const lastBox = await lines.nth(Math.min(count - 1, 5)).boundingBox();
  if (!firstBox || !lastBox) {
    record('drag-select across lines', 'fail', 'no bbox');
    return null;
  }

  const startX = firstBox.x + 20;
  const startY = firstBox.y + firstBox.height / 2;
  const endX = lastBox.x + Math.min(200, lastBox.width - 20);
  const endY = lastBox.y + lastBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const steps = 18;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(startX + (endX - startX) * t, startY + (endY - startY) * t);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);

  const selection = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return { empty: true };
    const s = sel.toString();
    return { empty: s.length === 0, length: s.length };
  });

  if (selection.empty) {
    record('drag-select across lines', 'fail', 'window.getSelection() empty');
  } else {
    record('drag-select across lines', 'pass', `len=${selection.length}B`);
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-selection.png'), fullPage: false });
  return selection;
}

async function probeCopyIsRawMarkdown(page) {
  // Synthesize a copy event and capture what CM6 puts on the clipboard.
  const payload = await page.evaluate(() => {
    const target = document.querySelector('.cm-content');
    if (!target) return { error: 'no .cm-content' };
    const dt = new DataTransfer();
    const ev = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt });
    target.dispatchEvent(ev);
    return { text: dt.getData('text/plain') };
  });
  if (!payload || payload.error) {
    record('copy yields raw markdown', 'fail', payload?.error || 'unknown');
    return null;
  }
  const text = payload.text || '';
  const looksLikeMarkdown =
    /(^|\n)#{1,6}\s|\*\*|`{1,3}|(^|\n)[-*]\s|\[[^\]]+\]\(/.test(text) || text.length > 40;
  const status = text && looksLikeMarkdown ? 'pass' : 'warn';
  const preview = text.slice(0, 60).replace(/\n/g, '\\n');
  record('copy yields raw markdown', status, `len=${text.length}B preview="${preview}"`);
  return payload;
}

// ---------- driver ----------

async function run() {
  const devProc = await ensureServer();
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.on('weberror', (err) => log('warn', `page weberror: ${err.error().message}`));
  const page = await context.newPage();
  page.on('pageerror', (err) => log('warn', `pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') log('warn', `console.error: ${msg.text()}`);
  });

  try {
    log('info', `navigating to ${base}/editor-harness`);
    await page.goto(`${base}/editor-harness`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.cm-editor');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-initial.png'), fullPage: false });

    await probeIdle(page);
    await probeClickFreeze(page);
    await probeFenceVisibility(page);
    await probeNewBulletList(page);
    await probeTaskList(page);
    await probeCursorPingPong(page);
    await probeTyping(page);
    await probeSelection(page);
    await probeCopyIsRawMarkdown(page);
    await probeDeepScrollRenders(page);
    await probeScroll(page);

    const failCount = results.filter((r) => r.status === 'fail').length;
    const warnCount = results.filter((r) => r.status === 'warn').length;
    console.log('');
    log('info', `${results.length} probes: ${failCount} fail, ${warnCount} warn`);
    log('info', `screenshots: ${SCREENSHOT_DIR}`);
    process.exitCode = failCount > 0 ? 1 : 0;
  } finally {
    await browser.close();
    if (devProc && !devProc.killed) {
      devProc.kill('SIGTERM');
      await Promise.race([once(devProc, 'exit'), sleep(2000)]);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
