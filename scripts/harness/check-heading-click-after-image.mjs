#!/usr/bin/env node
// Reproduce: click image, then click heading above — cursor should move
// to heading.

import { openAtom, clickEdit, clickDone } from './lib.mjs';

async function main() {
  const { browser, page } = await openAtom();
  try {
    await clickEdit(page);
    await page.waitForTimeout(500);

    // Scroll so "Waveform improvements" is in view.
    const scrolled = await page.evaluate(() => {
      const c = document.querySelector('.scrollbar-auto-hide') ||
        document.querySelector('.overflow-y-auto');
      // find the cm-line whose textContent begins with "Waveform improvements"
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const h = lines.find((l) => (l.textContent || '').includes('Waveform improvements'));
      if (!c || !h) return false;
      const r = h.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      c.scrollTop += r.top - cr.top - 100;
      return true;
    });
    if (!scrolled) { console.log('could not find heading'); await browser.close(); return; }
    await page.waitForTimeout(500);

    // Get the image just below the heading.
    const imgBox = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const hIdx = lines.findIndex((l) => (l.textContent || '').includes('Waveform improvements'));
      if (hIdx < 0) return null;
      // The image widget may be inline-replaced in some cm-line a few lines down,
      // or rendered as a block widget. Look for any img.cm-md-img after the heading.
      const hr = lines[hIdx].getBoundingClientRect();
      const imgs = Array.from(document.querySelectorAll('img.cm-md-img'));
      const below = imgs.find((i) => i.getBoundingClientRect().top > hr.bottom);
      if (!below) return null;
      const r = below.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!imgBox) { console.log('no image below heading'); await browser.close(); return; }
    const before = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const h = lines.find((l) => (l.textContent || '').includes('Waveform improvements'));
      const img = document.querySelector('img.cm-md-img');
      const hRect = h?.getBoundingClientRect();
      const imgRect = img?.getBoundingClientRect();
      return { headY: hRect ? Math.round(hRect.top) : null, imgY: imgRect ? Math.round(imgRect.top) : null };
    });
    console.log('BEFORE image click:', JSON.stringify(before), 'imgClickAt:', imgBox);
    await page.mouse.click(imgBox.x, imgBox.y);
    await page.waitForTimeout(400);
    const afterImg = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const h = lines.find((l) => (l.textContent || '').includes('Waveform improvements'));
      const imgs = Array.from(document.querySelectorAll('img.cm-md-img'));
      const hRect = h?.getBoundingClientRect();
      return {
        headY: hRect ? Math.round(hRect.top) : null,
        imgCount: imgs.length,
        imgYs: imgs.slice(0, 3).map(i => Math.round(i.getBoundingClientRect().top)),
      };
    });
    console.log('AFTER image click:', JSON.stringify(afterImg));
    // Dump CM's heightmap view vs DOM for a range of y values
    const heightmapDump = await page.evaluate(() => {
      const view = (window).__cmView;
      if (!view) return null;
      const out = [];
      for (let y = 500; y < 700; y += 30) {
        const block = view.elementAtHeight(y - view.contentDOM.getBoundingClientRect().top);
        const viewportY = y;
        const el = document.elementFromPoint(300, viewportY);
        let line = el;
        while (line && !line.classList?.contains('cm-line')) line = line.parentElement;
        out.push({
          y: viewportY,
          heightmapBlockFrom: block?.from,
          heightmapBlockLine: block?.from != null ? view.state.doc.lineAt(block.from).number : null,
          domLineClass: line?.className,
          domLineText: line ? (line.textContent || '').slice(0, 30) : null,
        });
      }
      return out;
    });
    console.log('heightmap vs DOM at various y:');
    heightmapDump?.forEach((x) => console.log('  ', JSON.stringify(x)));

    const afterImgClick = await page.evaluate(() => {
      const sel = window.getSelection();
      let el = sel?.anchorNode?.nodeType === 1 ? sel.anchorNode : sel?.anchorNode?.parentElement;
      while (el && !el.classList?.contains('cm-line')) el = el.parentElement;
      return {
        selectionLineText: el ? (el.textContent || '').slice(0, 50) : null,
      };
    });
    console.log('after image click, selection on:', JSON.stringify(afterImgClick));

    // Now click the heading.
    const hBox = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const h = lines.find((l) => (l.textContent || '').includes('Waveform improvements'));
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return { x: r.left + 30, y: r.top + r.height / 2, hTop: r.top, hBot: r.bottom, hClass: h.className };
    });
    console.log('heading:', JSON.stringify(hBox));
    // What element is at that point?
    const atPoint = await page.evaluate(({x, y}) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      let line = el;
      while (line && !line.classList?.contains('cm-line')) line = line.parentElement;
      // Inspect the heading line's children
      const lineChildren = line ? Array.from(line.childNodes).map((c) => ({
        type: c.nodeType === 1 ? c.tagName : 'text',
        class: c.nodeType === 1 ? (c.className || '').slice(0, 30) : '',
        text: (c.textContent || '').slice(0, 30),
        visible: c.nodeType === 1 ? getComputedStyle(c).display !== 'none' : true,
      })) : null;
      // Check elementsFromPoint (stack of elements at point)
      const stack = document.elementsFromPoint(x, y).slice(0, 5).map((e) => ({
        tag: e.tagName,
        class: (e.className || '').slice(0, 40),
      }));
      return {
        hitTag: el.tagName,
        hitClass: (el.className || '').slice(0, 80),
        hitText: (el.textContent || '').slice(0, 50),
        ancestorLineText: line ? (line.textContent || '').slice(0, 50) : null,
        ancestorLineClass: line?.className,
        lineChildren,
        stack,
      };
    }, hBox);
    console.log('elementFromPoint:', JSON.stringify(atPoint, null, 2));
    // Ask CM directly what doc position it thinks is under these coords.
    const posInfo = await page.evaluate(({ x, y }) => {
      // Find the CM EditorView
      const root = document.querySelector('.cm-editor');
      if (!root) return null;
      // getBoundingClientRect, cm-line under (x,y), its text
      const el = document.elementFromPoint(x, y);
      let line = el;
      while (line && !line.classList?.contains('cm-line')) line = line.parentElement;
      if (!line) return null;
      const sel = document.createRange();
      return {
        lineRect: (() => { const r = line.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom) }; })(),
        lineText: (line.textContent || '').slice(0, 60),
      };
    }, hBox);
    console.log('target line:', JSON.stringify(posInfo));
    // Use page.mouse.down/up separately to check event flow.
    console.log('--- mousedown ---');
    // Check posAtCoords at the intended click point, pre-click
    const prePosInfo = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      let line = el;
      while (line && !line.classList?.contains('cm-line')) line = line.parentElement;
      const view = (window).__cmView;
      const posAt = view?.posAtCoords({ x, y });
      return {
        elem: el?.tagName,
        cls: (el?.className || '').slice(0, 40),
        lineText: line ? (line.textContent || '').slice(0, 40) : null,
        lineClass: line?.className,
        posAtCoords: posAt,
        posAtLine: posAt != null ? view.state.doc.lineAt(posAt).number : null,
      };
    }, hBox);
    console.log('pre-click at point:', JSON.stringify(prePosInfo));
    await page.mouse.move(hBox.x, hBox.y);
    await page.mouse.down();
    await page.waitForTimeout(150);
    const midDownState = await page.evaluate(({x, y}) => {
      const sel = window.getSelection();
      let el = sel?.anchorNode?.nodeType === 1 ? sel.anchorNode : sel?.anchorNode?.parentElement;
      while (el && !el.classList?.contains('cm-line')) el = el.parentElement;
      const atEl = document.elementFromPoint(x, y);
      let atLine = atEl;
      while (atLine && !atLine.classList?.contains('cm-line')) atLine = atLine.parentElement;
      const view = (window).__cmView;
      const viewState = view?.state ? JSON.stringify({
        sel: view.state.selection.main,
        line: view.state.doc.lineAt(view.state.selection.main.from).number,
        hasFocus: view.hasFocus,
        mouseSel: !!view.inputState.mouseSelection,
      }) : 'unknown hasView=' + String(!!view);
      return {
        selectionLine: el ? (el.textContent || '').slice(0, 50) : null,
        atPointLine: atLine ? (atLine.textContent || '').slice(0, 50) : null,
        atPointTag: atEl?.tagName,
        atPointClass: (atEl?.className || '').slice(0, 50),
        viewState,
      };
    }, hBox);
    console.log('after mousedown:', JSON.stringify(midDownState));
    await page.mouse.up();
    await page.waitForTimeout(200);
    await page.waitForTimeout(400);

    const afterHeadingClick = await page.evaluate(() => {
      const sel = window.getSelection();
      let el = sel?.anchorNode?.nodeType === 1 ? sel.anchorNode : sel?.anchorNode?.parentElement;
      while (el && !el.classList?.contains('cm-line')) el = el.parentElement;
      return {
        selectionLineText: el ? (el.textContent || '').slice(0, 60) : null,
        className: el?.className,
      };
    });
    console.log('after heading click, selection on:', JSON.stringify(afterHeadingClick));

    if (afterHeadingClick.selectionLineText?.includes('Waveform')) {
      console.log('✓ cursor moved to heading');
    } else {
      console.log('✗ cursor did NOT move to heading (still on:', afterHeadingClick.selectionLineText, ')');
    }

    await clickDone(page);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
