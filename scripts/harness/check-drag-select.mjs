#!/usr/bin/env node
// Verify click-and-drag produces a range selection in edit mode.

import { openAtom, clickEdit, clickDone } from './lib.mjs';

async function main() {
  const { browser, page } = await openAtom();
  try {
    await clickEdit(page);
    await page.waitForTimeout(500);

    // Find a paragraph with long enough text to drag across.
    const box = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const p = lines.find((l) =>
        l.className.includes('cm-md-p-start') &&
        (l.textContent || '').length > 50,
      );
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return {
        sx: r.left + 20,
        sy: r.top + r.height / 2,
        ex: r.left + 200,
        ey: r.top + r.height / 2,
        text: (p.textContent || '').slice(0, 40),
      };
    });
    if (!box) { console.log('no paragraph'); await browser.close(); return; }
    console.log('dragging from', { x: box.sx, y: box.sy }, 'to', { x: box.ex, y: box.ey });
    console.log('  in paragraph:', JSON.stringify(box.text));

    await page.mouse.move(box.sx, box.sy);
    await page.mouse.down();
    await page.mouse.move(box.ex, box.ey, { steps: 12 });
    await page.waitForTimeout(120);

    const mid = await page.evaluate(() => {
      const view = (window).__cmView;
      const m = view?.state?.selection?.main;
      return m ? { from: m.from, to: m.to, length: Math.abs(m.to - m.from) } : null;
    });
    console.log('during drag:', JSON.stringify(mid));

    await page.mouse.up();
    await page.waitForTimeout(200);

    const final = await page.evaluate(() => {
      const view = (window).__cmView;
      const m = view?.state?.selection?.main;
      return m ? { from: m.from, to: m.to, length: Math.abs(m.to - m.from) } : null;
    });
    console.log('after mouseup:', JSON.stringify(final));

    if (final && final.length > 3) {
      console.log('\n✓ drag produced a range selection of', final.length, 'chars');
    } else {
      console.log('\n✗ drag did not produce a range selection — got', JSON.stringify(final));
      process.exitCode = 1;
    }
    await clickDone(page);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
