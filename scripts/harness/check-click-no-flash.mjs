#!/usr/bin/env node
// Verify that a single click in a paragraph containing links doesn't
// produce a transient range selection (the "flash" — mousedown dispatches
// caret at position A, hidden link syntax reveals, mouseup at the same
// screen coord resolves to position B, CM extends to A..B as a range,
// our clickCollapseHandler used to collapse it). With the mouse-gesture
// decoration freeze, the range should never form in the first place.

import { openAtom, clickEdit, clickDone } from './lib.mjs';

async function main() {
  const { browser, page } = await openAtom();
  try {
    await clickEdit(page);
    await page.waitForTimeout(500);

    // Scroll to a paragraph that contains links.
    await page.evaluate(() => {
      const c = document.querySelector('.scrollbar-auto-hide') ||
        document.querySelector('.overflow-y-auto');
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      // Look for a paragraph line whose raw source has "](" (indicates a link).
      const p = lines.find((l) => /]\(/.test(l.textContent || '')
        && l.className.includes('cm-md-p-start'));
      if (!p || !c) return false;
      const r = p.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      c.scrollTop += r.top - cr.top - 100;
      return true;
    });
    await page.waitForTimeout(500);

    const target = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const p = lines.find((l) => /]\(/.test(l.textContent || '')
        && l.className.includes('cm-md-p-start'));
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return { x: r.left + 80, y: r.top + r.height / 2 };
    });
    if (!target) { console.log('no link-bearing paragraph found'); await browser.close(); return; }

    // Poll selection state throughout the click gesture.
    const samples = [];
    const sampleNow = async (label) => {
      const s = await page.evaluate(() => {
        const view = (window).__cmView;
        const m = view?.state?.selection?.main;
        return m ? { from: m.from, to: m.to, empty: m.from === m.to } : null;
      });
      samples.push({ label, s });
    };

    await page.mouse.move(target.x, target.y);
    await sampleNow('before');
    await page.mouse.down();
    await sampleNow('after down');
    await page.waitForTimeout(30);
    await sampleNow('+30ms');
    await page.mouse.up();
    await sampleNow('after up');
    await page.waitForTimeout(300);
    await sampleNow('+300ms');

    for (const { label, s } of samples) {
      console.log(`  ${label.padEnd(12)} ${s ? JSON.stringify(s) : 'null'}`);
    }

    // Pass if no sample has a non-empty range
    const anyRange = samples.some((x) => x.s && !x.s.empty);
    if (anyRange) {
      console.log('\n✗ selection became a range during click (flash)');
      process.exitCode = 1;
    } else {
      console.log('\n✓ no range flash during click');
    }

    await clickDone(page);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
