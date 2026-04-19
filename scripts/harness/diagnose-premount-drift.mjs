#!/usr/bin/env node
// Diagnose why pre-mounted (visibility:hidden) CodeMirror produces different
// layout from a freshly-mounted CM. Approach:
//   1. Load atom in view mode.
//   2. Compare view's rendered block positions (by text snippet) with CM's
//      block positions — but first, mount CM two ways:
//        (a) fresh: click Edit, measure, click Done
//        (b) pre-mounted: manually inject a hidden CM via the app and wait for
//            images to load, then unhide and measure
//   3. Print per-line absY differences so we can see where drift comes from.

import { openAtom, setScroll } from './lib.mjs';

async function main() {
  const { browser, page } = await openAtom();
  try {
    // Wait for all view images to load.
    console.log('waiting for view images...');
    await page.evaluate(() => {
      return new Promise((resolve) => {
        const imgs = Array.from(document.querySelectorAll('.markdown-image-wrapper img, article img'));
        if (imgs.length === 0) return resolve();
        let left = imgs.length;
        const done = () => { if (--left === 0) resolve(); };
        for (const i of imgs) {
          if (i.complete) done();
          else {
            i.addEventListener('load', done, { once: true });
            i.addEventListener('error', done, { once: true });
          }
        }
        setTimeout(resolve, 15000); // safety timeout
      });
    });
    await page.waitForTimeout(500);

    // Capture a list of landmarks in view mode with their absY.
    const viewLandmarks = await page.evaluate(() => {
      const c = document.querySelector('.scrollbar-auto-hide') || document.querySelector('.overflow-y-auto');
      const crect = c.getBoundingClientRect();
      const cands = Array.from(document.querySelectorAll('article h1, article h2, article h3, article h4'));
      return cands.slice(0, 20).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          text: (el.textContent || '').trim().slice(0, 50),
          absY: Math.round(r.top - crect.top + c.scrollTop),
          tag: el.tagName,
        };
      });
    });
    console.log(`captured ${viewLandmarks.length} view landmarks`);

    // Click Edit — this is the fresh-mount path.
    console.log('\n=== FRESH MOUNT (Edit button) ===');
    await page.click('button[title="Edit"]');
    await page.waitForSelector('.cm-editor', { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Wait for all images in CM to load.
    console.log('waiting for CM images...');
    await page.evaluate(() => {
      return new Promise((resolve) => {
        const imgs = Array.from(document.querySelectorAll('img.cm-md-img'));
        if (imgs.length === 0) return resolve();
        let left = imgs.length;
        const done = () => { if (--left === 0) resolve(); };
        for (const i of imgs) {
          if (i.complete) done();
          else {
            i.addEventListener('load', done, { once: true });
            i.addEventListener('error', done, { once: true });
          }
        }
        setTimeout(resolve, 15000);
      });
    });
    await page.waitForTimeout(500);

    const freshLandmarks = await page.evaluate((targets) => {
      const c = document.querySelector('.scrollbar-auto-hide') || document.querySelector('.overflow-y-auto');
      const crect = c.getBoundingClientRect();
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      // Normalize away raw-markdown markers (escapes, link syntax, header
      // marks) so the landmark text from view matches what cm-line.textContent
      // gives us — otherwise "25.04.0" misses the "### 25\.04\.0" line and
      // incorrectly matches a distant paragraph.
      const normalize = (s) => (s || '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[\\*_`#~]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return targets.map((t) => {
        const needle = normalize(t.text.slice(0, 30));
        const hit = lines.find((l) => normalize(l.textContent).includes(needle));
        if (!hit) return { text: t.text, absY: null };
        const r = hit.getBoundingClientRect();
        return {
          text: t.text,
          absY: Math.round(r.top - crect.top + c.scrollTop),
        };
      });
    }, viewLandmarks);

    console.log('landmark comparison (view vs fresh CM):');
    let fullDriftSum = 0, fullDriftN = 0;
    for (let i = 0; i < viewLandmarks.length; i++) {
      const v = viewLandmarks[i];
      const f = freshLandmarks[i];
      if (f.absY === null) { console.log(`  [?] ${v.text.padEnd(40)} view=${v.absY} fresh=NOT-FOUND`); continue; }
      const d = f.absY - v.absY;
      fullDriftSum += Math.abs(d); fullDriftN++;
      console.log(`  ${v.text.padEnd(40)} view=${String(v.absY).padStart(5)} fresh=${String(f.absY).padStart(5)} Δ=${d > 0 ? '+' : ''}${d}`);
    }
    console.log(`  avg |Δ| = ${(fullDriftSum / fullDriftN).toFixed(1)}px`);

    // Record total CM height.
    const freshTotalHeight = await page.evaluate(() => {
      const el = document.querySelector('.cm-content');
      return el ? el.getBoundingClientRect().height : 0;
    });
    console.log(`fresh CM content height: ${freshTotalHeight.toFixed(0)}px`);

    // Done — back to view.
    await page.click('button[title^="Done"]');
    await page.waitForSelector('article', { timeout: 30000 });
    await page.waitForTimeout(500);

    const viewTotalHeight = await page.evaluate(() => {
      const el = document.querySelector('article');
      return el ? el.getBoundingClientRect().height : 0;
    });
    console.log(`view article height: ${viewTotalHeight.toFixed(0)}px`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
