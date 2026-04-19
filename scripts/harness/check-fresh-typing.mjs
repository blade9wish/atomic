#!/usr/bin/env node
// Mimic the user's exact complaint: open an atom in edit mode, type a
// simple sentence, then click earlier in the sentence to move the cursor.

import { openAtom, clickEdit, clickDone } from './lib.mjs';

async function main() {
  const { browser, page } = await openAtom();
  page.on('console', (m) => console.log('page>', m.text()));
  try {
    await clickEdit(page);
    await page.waitForTimeout(500);

    // Go to end of doc, add two newlines, type a simple sentence.
    await page.keyboard.press('Meta+End');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    const sentence = 'The quick brown fox jumps over the lazy dog';
    await page.keyboard.type(sentence, { delay: 20 });
    await page.waitForTimeout(300);

    const before = await page.evaluate(() => {
      const view = (window).__cmView;
      return {
        sel: view.state.selection.main,
        docLen: view.state.doc.length,
      };
    });
    console.log('after typing:', JSON.stringify(before));

    // Now click on the LAST cm-line containing the sentence (the one we
    // just typed) — scroll it into view first.
    await page.evaluate((sentence) => {
      const c = document.querySelector('.scrollbar-auto-hide') ||
        document.querySelector('.overflow-y-auto');
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const line = lines.slice().reverse().find((l) => (l.textContent || '').includes('quick brown fox'));
      if (!c || !line) return;
      line.scrollIntoView({ block: 'center' });
    }, sentence);
    await page.waitForTimeout(300);

    const target = await page.evaluate((sentence) => {
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const line = lines.slice().reverse().find((l) => (l.textContent || '').includes('quick brown fox'));
      if (!line) return null;
      // Recurse into descendant text nodes
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let textNode = null;
      let n;
      while ((n = walker.nextNode())) {
        if ((n.textContent || '').includes('quick')) { textNode = n; break; }
      }
      if (!textNode) return null;
      const idx = (textNode.textContent || '').indexOf('quick');
      const range = document.createRange();
      range.setStart(textNode, idx);
      range.setEnd(textNode, idx + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, sentence);
    if (!target) {
      const debug = await page.evaluate(() => {
        const lines = Array.from(document.querySelectorAll('.cm-line'));
        return {
          total: lines.length,
          last3: lines.slice(-3).map((l) => (l.textContent || '').slice(-60)),
        };
      });
      console.log('could not find — debug:', JSON.stringify(debug));
      await browser.close();
      return;
    }
    console.log('clicking at:', JSON.stringify(target));

    // Inspect the target line's decoration classes
    const sentenceLineInfo = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const line = lines.slice().reverse().find((l) => (l.textContent || '').includes('quick brown fox'));
      if (!line) return null;
      return {
        class: line.className,
        paddingLeft: getComputedStyle(line).paddingLeft,
        lineY: Math.round(line.getBoundingClientRect().top),
      };
    });
    console.log('sentence line:', JSON.stringify(sentenceLineInfo));

    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.waitForTimeout(40);
    await page.mouse.up();
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => {
      const view = (window).__cmView;
      const m = view.state.selection.main;
      const line = view.state.doc.lineAt(m.from);
      return {
        anchor: m.anchor,
        head: m.head,
        lineText: line.text,
        charAtCursor: view.state.sliceDoc(m.from, Math.min(m.from + 10, view.state.doc.length)),
      };
    });
    console.log('after click:', JSON.stringify(after));

    // Did the cursor actually move into the sentence near "quick"?
    const moved = after.anchor !== before.sel.anchor;
    const nearQuick = after.charAtCursor.startsWith('quick') || after.charAtCursor.startsWith('uick');
    if (moved && nearQuick) {
      console.log('\n✓ cursor moved to "quick"');
    } else {
      console.log(`\n✗ cursor did not move correctly — anchor ${before.sel.anchor} → ${after.anchor}, chars="${after.charAtCursor}"`);
      process.exitCode = 1;
    }

    // Undo everything
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Meta+z');
      await page.waitForTimeout(5);
    }
    await clickDone(page);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
