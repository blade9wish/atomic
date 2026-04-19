// Shared helpers for the editor harness.

import { chromium } from 'playwright';

const APP = process.env.ATOMIC_URL || 'http://localhost:1420';
const AUTH = process.env.ATOMIC_AUTH_TOKEN;
const SERVER = process.env.ATOMIC_SERVER_URL || 'http://localhost:8080';
const ATOM_ID = process.env.ATOM_ID || '71545095-8070-41c3-9e62-81b22fe11c3b';
const DATABASE_ID = process.env.DATABASE_ID || null;

export async function openAtom() {
  if (!AUTH) throw new Error('ATOMIC_AUTH_TOKEN required');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (e) => console.error('  page error:', e.message));

  if (DATABASE_ID) {
    await fetch(`${SERVER}/api/databases/${DATABASE_ID}/activate`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${AUTH}` },
    }).catch(() => {});
  }

  await page.goto(APP);
  await page.evaluate(
    ({ url, token }) => {
      localStorage.setItem(
        'atomic-server-config',
        JSON.stringify({ baseUrl: url, authToken: token })
      );
    },
    { url: SERVER, token: AUTH }
  );
  await page.goto(`${APP}/atoms/${ATOM_ID}`);
  await page.waitForSelector('article', { timeout: 60000 });
  return { browser, page };
}

// View mode scrollable container.
export function scrollContainerSelector() {
  return '.scrollbar-auto-hide, .overflow-y-auto';
}

export async function scrollThroughView(page) {
  await page.evaluate(async () => {
    const c = document.querySelector('.scrollbar-auto-hide') ||
      document.querySelector('.overflow-y-auto');
    if (!c) return;
    while (c.scrollTop + c.clientHeight < c.scrollHeight - 1) {
      c.scrollBy(0, 600);
      await new Promise((r) => setTimeout(r, 100));
    }
    c.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 300));
  });
}

export async function setScroll(page, scrollTop) {
  await page.evaluate((t) => {
    const c = document.querySelector('.scrollbar-auto-hide') ||
      document.querySelector('.overflow-y-auto');
    if (c) c.scrollTop = t;
  }, scrollTop);
  await page.waitForTimeout(150);
}

export async function scrollToText(page, text, extraCutoff = 0) {
  return page.evaluate(
    ({ target, cutoff }) => {
      const c = document.querySelector('.scrollbar-auto-hide') ||
        document.querySelector('.overflow-y-auto');
      if (!c) return null;
      const nodes = Array.from(document.querySelectorAll('article *'));
      const hit = nodes.find((n) => (n.textContent || '').toLowerCase().includes(target.toLowerCase()));
      if (!hit) return null;
      const rect = hit.getBoundingClientRect();
      const scRect = c.getBoundingClientRect();
      c.scrollTop += rect.top - scRect.top + cutoff;
      return { scrollTop: c.scrollTop };
    },
    { target: text, cutoff: extraCutoff }
  );
}

export async function clickEdit(page) {
  await page.click('button[title="Edit"]');
  await page.waitForSelector('.cm-editor', { timeout: 5000 });
  await page.waitForTimeout(400);
}

export async function clickDone(page) {
  await page.click('button[title^="Done"]');
  await page.waitForSelector('article', { timeout: 5000 });
  await page.waitForTimeout(400);
}

export async function mode(page) {
  return page.evaluate(() =>
    document.querySelector('.cm-editor') ? 'edit' : 'view'
  );
}

// Measure the vertical offset (relative to scroll container top) of the
// *tightest* element whose own text content begins with the target.
//
// "Tightest" means we prefer leaves over ancestors. The old version of this
// helper returned the first candidate in document order whose textContent
// included the target, which would resolve to e.g. <article> or a wrapping
// div — those start at y=0 regardless of where the target is. The
// leaf-first search returns the actual heading/paragraph/cm-line so the
// offset we report is meaningful.
export async function measureByText(page, text) {
  return page.evaluate((t) => {
    const c = document.querySelector('.scrollbar-auto-hide') ||
      document.querySelector('.overflow-y-auto');
    if (!c) return null;
    const crect = c.getBoundingClientRect();
    // Candidate leaves — specific block-level elements we care about.
    const candidates = Array.from(document.querySelectorAll(
      'article h1, article h2, article h3, article h4, article h5, article h6, ' +
      'article p, article li, ' +
      '.cm-line'
    ));
    // Normalize text so edit-mode raw markdown (e.g. "25\.04\.0") matches
    // view-mode rendered text ("25.04.0"). Strip escape backslashes, link
    // markdown, and emphasis markers.
    const normalize = (s) => (s || '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[\\*_`#~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const nt = normalize(t);
    let best = null;
    for (const el of candidates) {
      const txt = normalize(el.textContent);
      if (!txt.includes(nt)) continue;
      const score = nt.length / Math.max(1, txt.length);
      if (!best || score > best.score) best = { el, score, txt };
    }
    if (!best) return null;
    const r = best.el.getBoundingClientRect();
    return {
      top: r.top - crect.top,
      absY: (r.top - crect.top) + c.scrollTop,
      scrollTop: c.scrollTop,
      tag: best.el.tagName,
      cls: (best.el.className || '').slice(0, 40),
      elText: best.txt.slice(0, 40),
    };
  }, text);
}

export async function measureImageBySrc(page, srcSuffix) {
  return page.evaluate((suffix) => {
    const c = document.querySelector('.scrollbar-auto-hide') ||
      document.querySelector('.overflow-y-auto');
    if (!c) return null;
    const crect = c.getBoundingClientRect();
    const imgs = Array.from(document.querySelectorAll('img')).filter(
      (i) => !i.classList.contains('cm-widgetBuffer') && i.src.endsWith(suffix)
    );
    if (!imgs.length) return null;
    const img = imgs[0];
    const r = img.getBoundingClientRect();
    return {
      top: r.top - crect.top,
      absY: (r.top - crect.top) + c.scrollTop,
      scrollTop: c.scrollTop,
      src: img.src,
    };
  }, srcSuffix);
}

export function pad(s, n = 30) {
  return String(s).padEnd(n);
}

export function approxEqual(a, b, tol = 2) {
  return Math.abs(a - b) <= tol;
}
