#!/usr/bin/env node
// Click a regular paragraph, then click the heading above. Does heading
// click move cursor? If no, this is a general CM issue, not related to
// image clicks.

import { openAtom, clickEdit, clickDone } from './lib.mjs';

async function main() {
  const { browser, page } = await openAtom();
  try {
    await clickEdit(page);
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const c = document.querySelector('.scrollbar-auto-hide') || document.querySelector('.overflow-y-auto');
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const h = lines.find((l) => (l.textContent || '').includes('Waveform improvements'));
      const r = h.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      c.scrollTop += r.top - cr.top - 100;
    });
    await page.waitForTimeout(500);

    // Click a paragraph below the heading (not an image)
    const pBox = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const hIdx = lines.findIndex((l) => (l.textContent || '').includes('Waveform improvements'));
      // Find next paragraph line (content but no cm-md-h/cm-md-blank)
      for (let i = hIdx + 1; i < lines.length; i++) {
        const l = lines[i];
        if (l.className.includes('cm-md-h')) break;
        if (l.className.includes('cm-md-blank')) continue;
        if ((l.textContent || '').trim().length < 10) continue;
        const r = l.getBoundingClientRect();
        return { x: r.left + 30, y: r.top + r.height / 2 };
      }
      return null;
    });
    console.log('clicking paragraph at:', JSON.stringify(pBox));
    await page.mouse.click(pBox.x, pBox.y);
    await page.waitForTimeout(300);

    const afterP = await page.evaluate(() => {
      const sel = window.getSelection();
      let el = sel?.anchorNode?.nodeType === 1 ? sel.anchorNode : sel?.anchorNode?.parentElement;
      while (el && !el.classList?.contains('cm-line')) el = el.parentElement;
      return el ? (el.textContent || '').slice(0, 40) : null;
    });
    console.log('after paragraph click:', afterP);

    // Now click heading
    const hBox = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const h = lines.find((l) => (l.textContent || '').includes('Waveform improvements'));
      const r = h.getBoundingClientRect();
      return { x: r.left + 30, y: r.top + r.height / 2 };
    });
    await page.mouse.click(hBox.x, hBox.y);
    await page.waitForTimeout(300);

    const afterH = await page.evaluate(() => {
      const sel = window.getSelection();
      let el = sel?.anchorNode?.nodeType === 1 ? sel.anchorNode : sel?.anchorNode?.parentElement;
      while (el && !el.classList?.contains('cm-line')) el = el.parentElement;
      return el ? (el.textContent || '').slice(0, 40) : null;
    });
    console.log('after heading click:', afterH);
    await clickDone(page);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
