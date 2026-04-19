#!/usr/bin/env node
import { openAtom, clickEdit, clickDone } from './lib.mjs';

async function main() {
  const { browser, page } = await openAtom();
  page.on('console', (msg) => { if (msg.text().startsWith('[')) console.log('PAGE:', msg.text()); });
  try {
    await clickEdit(page);
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const c = document.querySelector('.scrollbar-auto-hide') ||
        document.querySelector('.overflow-y-auto');
      const img = document.querySelector('img.cm-md-img');
      if (!c || !img) return;
      const r = img.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      c.scrollTop += r.top - cr.top - 100;
    });
    await page.waitForTimeout(500);

    const info = await page.evaluate(() => {
      const img = document.querySelector('img.cm-md-img');
      if (!img) return null;
      // Find the EditorView via the cm-editor root
      const root = document.querySelector('.cm-editor');
      if (!root) return null;
      const cm = root.cmView || root.__view;
      // Fallback: walk up from img to cm-content → editorView
      // We can access via DOM: cm-editor has a `.cmView` on some builds
      // Let's just log everything we know.
      const r = img.getBoundingClientRect();
      // Find the cm-line ancestor
      let line = img;
      while (line && !line.classList?.contains('cm-line')) line = line.parentElement;
      // Find which line (in DOM order) this is
      const allLines = Array.from(document.querySelectorAll('.cm-line'));
      const idx = allLines.indexOf(line);
      return {
        imgSrc: img.src.slice(-30),
        lineIndex: idx,
        lineText: line ? (line.textContent || '').slice(0, 80) : null,
        lineClass: line?.className,
        prevLineText: (allLines[idx - 1]?.textContent || '').slice(0, 40),
        prevLineClass: allLines[idx - 1]?.className,
        nextLineText: (allLines[idx + 1]?.textContent || '').slice(0, 40),
        nextLineClass: allLines[idx + 1]?.className,
      };
    });
    console.log('image context:', JSON.stringify(info, null, 2));

    const imgPos = await page.evaluate(() => {
      const img = document.querySelector('img.cm-md-img');
      const r = img.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(imgPos.x, imgPos.y);
    await page.waitForTimeout(400);

    const afterInfo = await page.evaluate(() => {
      const sel = window.getSelection();
      let el = sel?.anchorNode?.nodeType === 1 ? sel.anchorNode : sel?.anchorNode?.parentElement;
      while (el && !el.classList?.contains('cm-line')) el = el.parentElement;
      const allLines = Array.from(document.querySelectorAll('.cm-line'));
      const idx = allLines.indexOf(el);
      return {
        selectionLineIndex: idx,
        selectionLineText: el ? (el.textContent || '').slice(0, 80) : null,
        selectionLineClass: el?.className,
      };
    });
    console.log('after click selection:', JSON.stringify(afterInfo, null, 2));

    await clickDone(page);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
