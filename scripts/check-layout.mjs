#!/usr/bin/env node
// Layout parity checker: spins up the vite dev server, opens the `?layout-debug=1`
// harness in headless Chromium, and prints per-landmark Y-offset deltas between
// the view-mode rendering (ReactMarkdown) and the edit-mode rendering (CodeMirror).
//
// Exit code: 0 if no block drifts more than the threshold, 1 otherwise.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = Number(process.env.LAYOUT_CHECK_PORT || 1420);
const URL_BASE = `http://localhost:${PORT}`;
const FIXTURES = ['headings', 'images', 'lists', 'mixed', 'kdenlive'];
const THRESHOLD_PX = Number(process.env.LAYOUT_CHECK_THRESHOLD || 2);

async function waitForServer(url, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server at ${url} not ready after ${timeoutMs}ms`);
}

async function isServerUp(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

function startVite() {
  const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, VITE_BUILD_TARGET: 'web' },
  });
  let err = '';
  proc.stderr.on('data', (d) => {
    err += d.toString();
  });
  return { proc, getErr: () => err };
}

function fmt(n, width = 7) {
  return n.toFixed(1).padStart(width);
}

async function main() {
  const alreadyRunning = await isServerUp(URL_BASE);
  let vite = null;
  let getErr = () => '';
  if (!alreadyRunning) {
    console.log(`Starting vite on :${PORT}...`);
    const started = startVite();
    vite = started.proc;
    getErr = started.getErr;
  } else {
    console.log(`Reusing existing server on :${PORT}`);
  }
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (vite) {
      try {
        vite.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  try {
    await waitForServer(URL_BASE);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1700, height: 1400 } });
    page.on('pageerror', (e) => console.error('page error:', e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('console.error:', msg.text());
    });

    await page.goto(`${URL_BASE}/?layout-debug=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="fixture-select"]');

    console.log(`Layout parity report (editTop − viewTop, px; threshold ±${THRESHOLD_PX}px)\n`);
    let over = 0;

    for (const fix of FIXTURES) {
      await page.selectOption('[data-testid="fixture-select"]', fix);
      await page.waitForFunction(
        (f) => window.__layoutDiff && window.__layoutDiff.fixture === f,
        fix,
        { timeout: 10000 }
      );
      // Give images + CodeMirror one more beat to settle.
      await new Promise((r) => setTimeout(r, 300));
      const diff = await page.evaluate(() => window.__layoutDiff);
      if (process.env.LAYOUT_CHECK_SHOT) {
        // Crop to just the comparison columns so the image is readable.
        const handle = await page.$('.flex.gap-8.mb-6');
        const shotPath = `/tmp/layout-${fix}.png`;
        if (handle) {
          await handle.screenshot({ path: shotPath });
        } else {
          await page.screenshot({ path: shotPath, fullPage: true });
        }
        console.log(`  shot → ${shotPath}`);
      }
      if (process.env.LAYOUT_CHECK_TRACE) {
        await page.evaluate(() => {
          (window).__snapTrace = null;
        });
        await page.click('[data-testid="snap-trace"]');
        await page.waitForFunction(
          () => Array.isArray(window.__snapTrace) && window.__snapTrace.length >= 6,
          { timeout: 10000 }
        );
        const trace = await page.evaluate(() => window.__snapTrace);
        const first = trace[0];
        const last = trace[trace.length - 1];
        const dL = last.landmark - first.landmark;
        const dT = last.total - first.total;
        console.log(`  snap trace (${fix}):`);
        for (const s of trace) {
          const flag = Math.abs(s.landmark - first.landmark) > 2 ? '⚠' : ' ';
          console.log(
            `    ${flag} t=${String(s.t).padStart(5)}ms  landmark=${s.landmark.toFixed(1).padStart(7)}  total=${s.total.toFixed(1).padStart(7)}`
          );
        }
        console.log(`    → landmark drifted ${dL.toFixed(1)}px, total drifted ${dT.toFixed(1)}px between t=0 and t=${last.t}`);
      }
      if (process.env.LAYOUT_CHECK_DEBUG) {
        const dbg = await page.evaluate(() => {
          const probe = (selector) =>
            Array.from(document.querySelectorAll(selector)).map((el) => {
              const s = getComputedStyle(el);
              const r = el.getBoundingClientRect();
              return {
                tag: el.tagName,
                cls: el.className,
                width: r.width.toFixed(1),
                height: r.height.toFixed(1),
                natW: el.naturalWidth || null,
                natH: el.naturalHeight || null,
                marginTop: s.marginTop,
                marginBottom: s.marginBottom,
                display: s.display,
              };
            });
          return {
            viewImgs: probe('[data-testid="view-column"] img'),
            editImgs: probe('[data-testid="edit-column"] img.cm-md-img'),
          };
        });
        console.log('DEBUG:', JSON.stringify(dbg, null, 2));
      }

      console.log(`── ${fix} ──`);
      console.log(
        `  totalHeight  view=${fmt(diff.totalView)}  edit=${fmt(diff.totalEdit)}  Δ=${fmt(
          diff.totalDelta,
          6
        )}`
      );
      for (const d of diff.deltas) {
        const flag = Math.abs(d.delta) > THRESHOLD_PX ? '⚠ ' : '  ';
        if (Math.abs(d.delta) > THRESHOLD_PX) over++;
        console.log(
          `  ${flag}${d.label.padEnd(10)} view=${fmt(d.viewTop)}  edit=${fmt(d.editTop)}  Δ=${fmt(d.delta, 6)}`
        );
      }
      if (Math.abs(diff.totalDelta) > THRESHOLD_PX) over++;
      console.log();
    }

    await browser.close();
    console.log(`Summary: ${over} landmark${over === 1 ? '' : 's'} exceed ±${THRESHOLD_PX}px`);
    process.exitCode = over > 0 ? 1 : 0;
  } catch (e) {
    console.error(e);
    const errOut = getErr();
    if (errOut) console.error('--- vite stderr ---\n' + errOut.slice(0, 2000));
    process.exitCode = 2;
  } finally {
    cleanup();
  }
}

main();
