#!/usr/bin/env node
// Compare per-paragraph rendered heights between view and edit to pinpoint
// where drift comes from.

import { openAtom } from './lib.mjs';

async function main() {
  const { browser, page } = await openAtom();
  try {
    // Wait for view images.
    await page.evaluate(() => new Promise((r) => {
      const imgs = Array.from(document.querySelectorAll('article img'));
      if (!imgs.length) return r();
      let n = imgs.length;
      const done = () => (--n === 0 ? r() : null);
      imgs.forEach((i) => i.complete ? done() : i.addEventListener('load', done, { once: true }));
      setTimeout(r, 10000);
    }));

    // Capture prose paragraph heights + line-heights.
    const viewParas = await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll('article p')).slice(0, 20);
      return ps.map((p) => ({
        text: (p.textContent || '').trim().slice(0, 40),
        height: Math.round(p.getBoundingClientRect().height),
        lineHeight: parseFloat(getComputedStyle(p).lineHeight),
        fontSize: parseFloat(getComputedStyle(p).fontSize),
        marginTop: parseFloat(getComputedStyle(p).marginTop),
        marginBottom: parseFloat(getComputedStyle(p).marginBottom),
      }));
    });
    console.log('VIEW paragraphs:');
    viewParas.forEach((p) => console.log(`  h=${p.height} lh=${p.lineHeight} fs=${p.fontSize} m=${p.marginTop}/${p.marginBottom}  "${p.text}"`));

    await page.click('button[title="Edit"]');
    await page.waitForSelector('.cm-editor');
    await page.waitForTimeout(1500);
    await page.evaluate(() => new Promise((r) => {
      const imgs = Array.from(document.querySelectorAll('img.cm-md-img'));
      if (!imgs.length) return r();
      let n = imgs.length;
      const done = () => (--n === 0 ? r() : null);
      imgs.forEach((i) => i.complete ? done() : i.addEventListener('load', done, { once: true }));
      setTimeout(r, 10000);
    }));

    const editParas = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('.cm-line'))
        .filter((l) => l.className.includes('cm-md-p-start') && l.className.includes('cm-md-p-end'))
        .slice(0, 20);
      return lines.map((l) => ({
        text: (l.textContent || '').trim().slice(0, 40),
        height: Math.round(l.getBoundingClientRect().height),
        lineHeight: parseFloat(getComputedStyle(l).lineHeight),
        fontSize: parseFloat(getComputedStyle(l).fontSize),
        marginTop: parseFloat(getComputedStyle(l).marginTop),
        marginBottom: parseFloat(getComputedStyle(l).marginBottom),
      }));
    });
    console.log('\nEDIT paragraph lines:');
    editParas.forEach((p) => console.log(`  h=${p.height} lh=${p.lineHeight} fs=${p.fontSize} m=${p.marginTop}/${p.marginBottom}  "${p.text}"`));

    // Side-by-side diff for matching paragraphs.
    console.log('\nPer-paragraph diff (by text prefix match):');
    for (const v of viewParas) {
      const e = editParas.find((p) => p.text.slice(0, 20) === v.text.slice(0, 20));
      if (!e) continue;
      const dh = e.height - v.height;
      console.log(`  Δh=${dh > 0 ? '+' : ''}${dh}  view=${v.height} edit=${e.height}  "${v.text}"`);
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
