#!/usr/bin/env node
// Measure how long it takes from clicking Edit to CodeMirror being fully
// rendered (first cm-line painted). Run several iterations to get variance.

import { openAtom } from './lib.mjs';

async function main() {
  const { browser, page } = await openAtom();
  try {
    const iterations = 6;
    const samples = [];
    for (let i = 0; i < iterations; i++) {
      // Make sure we're in view mode first.
      const inEdit = await page.locator('.cm-editor').count();
      if (inEdit > 0) {
        // press Escape to exit edit
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      }

      // Click Edit and measure time-to-first-cm-line and time-to-all-lines-rendered.
      const ms = await page.evaluate(async () => {
        const start = performance.now();
        // Trigger the edit button programmatically via the bridge action.
        // Simpler: click the pencil button.
        const btn = document.querySelector('[data-testid="edit-button"], [aria-label="Edit"], button[title*="Edit" i]');
        if (!btn) {
          // Fallback: use the keyboard shortcut if the app supports it, else find a button labelled "Edit"
          const edit = Array.from(document.querySelectorAll('button')).find(
            (b) => /edit/i.test(b.textContent || '') || /edit/i.test(b.getAttribute('aria-label') || '')
          );
          edit?.click();
        } else {
          (btn).click();
        }

        // Wait for .cm-editor to appear.
        const t0 = performance.now();
        const editorAppeared = await new Promise((resolve) => {
          const deadline = performance.now() + 5000;
          const tick = () => {
            if (document.querySelector('.cm-editor .cm-content')) return resolve(performance.now() - t0);
            if (performance.now() > deadline) return resolve(-1);
            requestAnimationFrame(tick);
          };
          tick();
        });
        // Wait until the document has its expected number of lines rendered (roughly)
        const t1 = performance.now();
        const fullyRendered = await new Promise((resolve) => {
          const deadline = performance.now() + 5000;
          const tick = () => {
            const lines = document.querySelectorAll('.cm-line').length;
            if (lines > 50) return resolve(performance.now() - t1);
            if (performance.now() > deadline) return resolve(-1);
            requestAnimationFrame(tick);
          };
          tick();
        });
        return {
          total: performance.now() - start,
          editorAppeared,
          fullyRendered,
        };
      });
      samples.push(ms);
      console.log(`[${i + 1}] mount=${ms.editorAppeared.toFixed(1)}ms render=${ms.fullyRendered.toFixed(1)}ms total=${ms.total.toFixed(1)}ms`);
      await page.waitForTimeout(500);
    }

    const avg = (key) => (samples.reduce((s, x) => s + x[key], 0) / samples.length).toFixed(1);
    console.log(`\naverages: editorAppeared=${avg('editorAppeared')}ms fullyRendered=${avg('fullyRendered')}ms total=${avg('total')}ms`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
