#!/usr/bin/env node
// Click heading directly (no prior image click) — does CM dispatch selection?

import { openAtom, clickEdit, clickDone } from './lib.mjs';

async function main() {
  const { browser, page } = await openAtom();
  try {
    await clickEdit(page);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const c = document.querySelector('.scrollbar-auto-hide') ||
        document.querySelector('.overflow-y-auto');
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const h = lines.find((l) => (l.textContent || '').includes('Waveform improvements'));
      const r = h.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      c.scrollTop += r.top - cr.top - 100;
    });
    await page.waitForTimeout(500);

    const hBox = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const h = lines.find((l) => (l.textContent || '').includes('Waveform improvements'));
      const r = h.getBoundingClientRect();
      return { x: r.left + 30, y: r.top + r.height / 2 };
    });
    await page.mouse.click(hBox.x, hBox.y);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => {
      const sel = window.getSelection();
      let el = sel?.anchorNode?.nodeType === 1 ? sel.anchorNode : sel?.anchorNode?.parentElement;
      while (el && !el.classList?.contains('cm-line')) el = el.parentElement;
      return el ? (el.textContent || '').slice(0, 50) : null;
    });
    console.log('heading click direct, active line:', after);
    await clickDone(page);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
