#!/usr/bin/env node
// Measure vertical gaps around images in view vs edit mode.
// We need this to calibrate the CSS so heights match.

import { openAtom } from './lib.mjs';

async function main() {
  const { browser, page } = await openAtom();
  try {
    await page.evaluate(() => new Promise((r) => {
      const imgs = Array.from(document.querySelectorAll('article img'));
      if (!imgs.length) return r();
      let n = imgs.length;
      const done = () => (--n === 0 ? r() : null);
      imgs.forEach((i) => i.complete ? done() : i.addEventListener('load', done, { once: true }));
      setTimeout(r, 10000);
    }));

    const viewGaps = await page.evaluate(() => {
      // For each image, measure distance from prev block bottom and next block top.
      const imgs = Array.from(document.querySelectorAll('article .markdown-image-wrapper'));
      const gaps = [];
      for (const wrap of imgs.slice(0, 5)) {
        const r = wrap.getBoundingClientRect();
        const p = wrap.closest('p');
        const pBox = p ? p.getBoundingClientRect() : r;
        const prev = p ? p.previousElementSibling : wrap.previousElementSibling;
        const next = p ? p.nextElementSibling : wrap.nextElementSibling;
        const prevR = prev ? prev.getBoundingClientRect() : null;
        const nextR = next ? next.getBoundingClientRect() : null;
        const img = wrap.querySelector('img');
        const imgH = img ? img.getBoundingClientRect().height : null;
        gaps.push({
          src: img?.src?.slice(-30) ?? '?',
          prevBottom: prevR ? Math.round(pBox.top - prevR.bottom) : null,
          nextTop: nextR ? Math.round(nextR.top - pBox.bottom) : null,
          wrapperHeight: Math.round(r.height),
          imgHeight: imgH ? Math.round(imgH) : null,
          pMarginTop: p ? parseFloat(getComputedStyle(p).marginTop) : null,
          pMarginBottom: p ? parseFloat(getComputedStyle(p).marginBottom) : null,
          wrapMarginTop: parseFloat(getComputedStyle(wrap).marginTop),
          wrapMarginBottom: parseFloat(getComputedStyle(wrap).marginBottom),
        });
      }
      return gaps;
    });
    console.log('VIEW gaps around images:');
    viewGaps.forEach((g) => console.log('  ', JSON.stringify(g)));

    // click Edit
    await page.click('button[title="Edit"]');
    await page.waitForSelector('.cm-editor', { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => new Promise((r) => {
      const imgs = Array.from(document.querySelectorAll('img.cm-md-img'));
      if (!imgs.length) return r();
      let n = imgs.length;
      const done = () => (--n === 0 ? r() : null);
      imgs.forEach((i) => i.complete ? done() : i.addEventListener('load', done, { once: true }));
      setTimeout(r, 10000);
    }));

    const editGaps = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img.cm-md-img'));
      const gaps = [];
      for (const img of imgs.slice(0, 5)) {
        const line = img.closest('.cm-line');
        if (!line) continue;
        const r = line.getBoundingClientRect();
        const imgR = img.getBoundingClientRect();
        const prev = line.previousElementSibling;
        const next = line.nextElementSibling;
        const prevR = prev ? prev.getBoundingClientRect() : null;
        const nextR = next ? next.getBoundingClientRect() : null;
        gaps.push({
          src: img.src.slice(-30),
          prevBottom: prevR ? Math.round(r.top - prevR.bottom) : null,
          nextTop: nextR ? Math.round(nextR.top - r.bottom) : null,
          lineHeight: Math.round(r.height),
          imgHeight: Math.round(imgR.height),
          lineMarginTop: parseFloat(getComputedStyle(line).marginTop),
          lineMarginBottom: parseFloat(getComputedStyle(line).marginBottom),
          imgMarginTop: parseFloat(getComputedStyle(img).marginTop),
          imgMarginBottom: parseFloat(getComputedStyle(img).marginBottom),
          lineClasses: line.className,
        });
      }
      return gaps;
    });
    console.log('\nEDIT gaps around images:');
    editGaps.forEach((g) => console.log('  ', JSON.stringify(g)));

    // Also measure consecutive-paragraph spacing so we can see the baseline
    // prose vs cm-line margins.
    const paragraphGaps = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('.cm-line')).slice(0, 20);
      return lines.map((l) => ({
        text: (l.textContent || '').trim().slice(0, 30),
        classes: l.className.split(' ').filter((c) => c !== 'cm-line').join(' '),
        marginTop: parseFloat(getComputedStyle(l).marginTop),
        marginBottom: parseFloat(getComputedStyle(l).marginBottom),
        height: Math.round(l.getBoundingClientRect().height),
      }));
    });
    console.log('\nEDIT first 20 cm-lines:');
    paragraphGaps.forEach((g) => console.log('  ', JSON.stringify(g)));
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
