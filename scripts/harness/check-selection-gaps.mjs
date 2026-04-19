#!/usr/bin/env node
// Determine whether selecting across blocks changes the inter-block gaps.
// If gaps are identical before/during selection, the "extra padding"
// complaint is perceptual (selection opacity revealing existing margins).
// If gaps actually differ, there's a layout shift to fix.

import { openAtom, clickEdit, clickDone } from './lib.mjs';

async function main() {
  const { browser, page } = await openAtom();
  try {
    await clickEdit(page);
    await page.waitForTimeout(500);

    const beforeSelect = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('.cm-line')).slice(0, 12);
      return lines.map((l) => ({
        text: (l.textContent || '').trim().slice(0, 25),
        top: Math.round(l.getBoundingClientRect().top),
        bot: Math.round(l.getBoundingClientRect().bottom),
      }));
    });

    // Select from line 2 through line 8 by dragging.
    const sel = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const a = lines[2].getBoundingClientRect();
      const b = lines[8].getBoundingClientRect();
      return {
        sx: a.left + 10, sy: a.top + a.height / 2,
        ex: b.right - 10, ey: b.top + b.height / 2,
      };
    });
    await page.mouse.move(sel.sx, sel.sy);
    await page.mouse.down();
    await page.mouse.move(sel.ex, sel.ey, { steps: 10 });
    await page.waitForTimeout(150);

    const duringSelect = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('.cm-line')).slice(0, 12);
      return lines.map((l) => ({
        text: (l.textContent || '').trim().slice(0, 25),
        top: Math.round(l.getBoundingClientRect().top),
        bot: Math.round(l.getBoundingClientRect().bottom),
      }));
    });

    await page.mouse.up();

    console.log('Per-line top/bot before vs during selection:');
    for (let i = 0; i < beforeSelect.length; i++) {
      const b = beforeSelect[i];
      const d = duringSelect[i];
      const drift = (d.top - b.top);
      const marker = drift !== 0 ? '  <-- SHIFTED' : '';
      console.log(`  [${i}] top ${b.top}→${d.top} bot ${b.bot}→${d.bot}${marker}  "${b.text}"`);
    }

    await clickDone(page);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
