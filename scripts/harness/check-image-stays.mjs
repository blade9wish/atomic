#!/usr/bin/env node
// Check that clicking an image in edit mode keeps the image visible (as a
// block widget below the now-revealed raw markdown), not replaces it.

import { openAtom, clickEdit, clickDone } from './lib.mjs';

async function main() {
  const { browser, page } = await openAtom();
  try {
    await clickEdit(page);
    await page.waitForTimeout(300);

    // Scroll the first visible image into view (middle of viewport).
    await page.evaluate(() => {
      const c = document.querySelector('.scrollbar-auto-hide') ||
        document.querySelector('.overflow-y-auto');
      const img = document.querySelector('img.cm-md-img');
      if (!c || !img) return;
      const r = img.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      c.scrollTop += r.top - cr.top - 200;
    });
    await page.waitForTimeout(600);

    const before = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img.cm-md-img'));
      const first = imgs[0];
      if (!first) return null;
      const r = first.getBoundingClientRect();
      return {
        count: imgs.length,
        firstSrc: first.src,
        firstTop: Math.round(r.top),
        firstHeight: Math.round(r.height),
      };
    });
    console.log('BEFORE click:', JSON.stringify(before));
    if (!before) { console.log('no image'); await browser.close(); return; }

    // Click center of the first visible image.
    const box = await page.evaluate(() => {
      const first = document.querySelector('img.cm-md-img');
      const r = first.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    console.log('clicking image at:', JSON.stringify(box));
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.waitForTimeout(50);
    const midDown = await page.evaluate(() => {
      const view = (window).__cmView;
      return view?.state?.selection?.main
        ? { anchor: view.state.selection.main.anchor, line: view.state.doc.lineAt(view.state.selection.main.anchor).number, text: view.state.doc.lineAt(view.state.selection.main.anchor).text.slice(0, 40) }
        : null;
    });
    console.log('mid-mousedown selection:', JSON.stringify(midDown));
    await page.mouse.up();
    await page.waitForTimeout(400);

    const after = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img.cm-md-img'));
      const matchIdx = imgs.findIndex((i) => true); // first image
      const first = imgs[0];
      // Find the active line to check raw markdown is shown.
      const sel = window.getSelection();
      let activeLine = null;
      if (sel && sel.anchorNode) {
        let el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
        while (el && !el.classList?.contains('cm-line')) el = el.parentElement;
        activeLine = el;
      }
      return {
        count: imgs.length,
        imgs: imgs.slice(0, 3).map((i) => ({ src: i.src.slice(-30), h: Math.round(i.getBoundingClientRect().height) })),
        activeLineText: activeLine ? (activeLine.textContent || '').slice(0, 80) : null,
        activeLineRect: activeLine ? { top: Math.round(activeLine.getBoundingClientRect().top), h: Math.round(activeLine.getBoundingClientRect().height) } : null,
        firstImageRect: first ? { top: Math.round(first.getBoundingClientRect().top), h: Math.round(first.getBoundingClientRect().height) } : null,
      };
    });
    console.log('AFTER click:', JSON.stringify(after, null, 2));

    // Verdict
    if (after.count === 0) console.log('\n❌ image DISAPPEARED after click');
    else if (after.activeLineText?.includes('![') && after.firstImageRect && after.activeLineRect && after.firstImageRect.top > after.activeLineRect.top) {
      console.log('\n✓ markdown revealed ABOVE image (active line top=' + after.activeLineRect.top + ' < img top=' + after.firstImageRect.top + ')');
    } else {
      console.log('\n❓ unexpected state');
    }

    await clickDone(page);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
