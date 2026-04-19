#!/usr/bin/env node
// The most thorough view↔edit editor harness the user is going to let me
// get away with. Runs every scenario I can think of against the real app and
// reports any layout instability, click mis-mapping, or toggle drift.
//
// Usage: ATOMIC_AUTH_TOKEN=at_... npm run editor-harness
//
// Exit code is the number of failing assertions. CI-friendly.

import { openAtom, clickEdit, clickDone, setScroll, scrollToText,
         scrollThroughView, measureImageBySrc, measureByText, mode, approxEqual, pad } from './lib.mjs';

let failures = 0;
let passes = 0;
const log = (...a) => console.log(...a);
const ok = (label) => { passes++; log(`  ✓ ${label}`); };
const fail = (label, detail) => { failures++; log(`  ✗ ${label}  ${detail ?? ''}`); };

// Known landmarks in the kdenlive atom for the tests below.
const LANDMARKS = [
  { kind: 'heading',  text: 'State of Kdenlive - 2026' },
  { kind: 'heading',  text: 'RELEASE HIGHLIGHTS' },
  { kind: 'heading',  text: '25.04.0' },
  { kind: 'heading',  text: 'Background Removal' },
  { kind: 'heading',  text: 'OpenTimelineIO' },
  { kind: 'heading',  text: 'Waveform improvements' },
  { kind: 'heading',  text: 'AUDIO WAVEFORM' },
  { kind: 'heading',  text: 'THE ROAD AHEAD' },
  { kind: 'heading',  text: 'BERLIN SPRINT' },
  { kind: 'heading',  text: 'AKADEMY 2025' },
  { kind: 'heading',  text: 'SHOWCASE' },
  { kind: 'heading',  text: 'SPREAD THE WORD' },
  { kind: 'text',     text: 'List of contributors' },
  { kind: 'text',     text: 'Jean-Baptiste Mardelle' },
  { kind: 'text',     text: 'indigenous communities' },
];

const IMAGE_SUFFIXES = [
  'state-2026/otiov.png',
  'state-2026/waves.png',
  'state-2026/mixer.png',
  'state-2026/welcome.webp',
  'state-2026/community2.png',
  'state-2026/w1.jpg',
  'state-2026/w2.jpg',
  'state-2026/w3.jpg',
];

// --- Test 1: scroll stability in edit mode ---------------------------------

async function testScrollStability(page) {
  log('\n[1] Scroll stability in edit mode — landmark absY must not drift');
  await clickEdit(page);

  // Pick a landmark well below the initial viewport.
  const landmark = 'OpenTimelineIO';

  await setScroll(page, 0);
  const baseline = await measureByText(page, landmark);
  if (!baseline) {
    fail('scroll-stability: landmark not found', landmark);
    return;
  }
  const baselineAbsY = baseline.absY;

  const steps = [500, 1500, 3000, 5000, 7000, 9000, 0];
  let maxDrift = 0;
  for (const top of steps) {
    await setScroll(page, top);
    const m = await measureByText(page, landmark);
    if (!m) continue;
    const drift = Math.abs(m.absY - baselineAbsY);
    if (drift > maxDrift) maxDrift = drift;
  }
  if (maxDrift <= 2) ok(`landmark stable across scroll (drift ${maxDrift.toFixed(1)}px)`);
  else fail(`landmark drifted`, `${maxDrift.toFixed(1)}px`);

  await clickDone(page);
}

// --- Test 2: click accuracy in wrapped paragraphs -------------------------

async function testClickAccuracy(page) {
  log('\n[2] Click accuracy — clicks on paragraph text must land on that paragraph');
  await clickEdit(page);
  await setScroll(page, 0);

  // Grab every paragraph cm-line in the viewport.
  const paras = await page.evaluate(() => {
    const out = [];
    const lines = Array.from(document.querySelectorAll('.cm-line'));
    for (const l of lines) {
      const t = (l.textContent || '').trim();
      if (t.length < 30) continue;
      if (l.classList.contains('cm-md-h1') || l.classList.contains('cm-md-h2') ||
          l.classList.contains('cm-md-h3') || l.classList.contains('cm-md-h4') ||
          l.classList.contains('cm-md-h5') || l.classList.contains('cm-md-h6')) continue;
      const r = l.getBoundingClientRect();
      if (r.height < 20) continue;
      out.push({ text: t.slice(0, 40), top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height });
      if (out.length >= 8) break;
    }
    return out;
  });

  let paraPasses = 0;
  const paraFails = [];
  for (const p of paras) {
    const xs = [p.left + 100];
    const ys = [
      { label: 'top+4', y: p.top + 4 },
      { label: 'mid', y: (p.top + p.bottom) / 2 },
      { label: 'bot-4', y: p.bottom - 4 },
    ];
    for (const x of xs) {
      for (const { label, y } of ys) {
        await page.mouse.click(x, y);
        await page.waitForTimeout(30);
        const landed = await page.evaluate(() => {
          const sel = window.getSelection();
          if (!sel || !sel.anchorNode) return null;
          let el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
          while (el && !el.classList?.contains('cm-line')) el = el.parentElement;
          return el ? (el.textContent || '').slice(0, 40) : null;
        });
        if (landed === p.text) paraPasses++;
        else paraFails.push({ expected: p.text, got: landed, label, y });
      }
    }
  }
  if (paraFails.length === 0) ok(`all ${paraPasses} click points landed correctly across ${paras.length} paragraphs`);
  else {
    fail(`click mismatches`, `${paraFails.length}/${paraPasses + paraFails.length} clicks mis-routed`);
    for (const f of paraFails.slice(0, 5)) {
      log(`    [${f.label}] expected "${f.expected.slice(0, 25)}" got "${f.got?.slice(0, 25) ?? 'null'}"`);
    }
  }

  await clickDone(page);
}

// --- Test 3: toggle roundtrip preservation at many positions --------------

async function testToggleRoundtrip(page) {
  log('\n[3] Toggle roundtrip — content position must preserve across view↔edit');

  const results = [];
  for (const lm of LANDMARKS) {
    // Navigate to the landmark in view, with a ~100px cutoff so part is off-screen
    await setScroll(page, 0);
    await page.waitForTimeout(100);
    const scroll = await scrollToText(page, lm.text, 100);
    if (!scroll) continue;
    await page.waitForTimeout(200);

    const before = await measureByText(page, lm.text);
    if (!before) continue;

    await clickEdit(page);
    const afterEdit = await measureByText(page, lm.text);
    await clickDone(page);
    const afterView = await measureByText(page, lm.text);

    const drift1 = afterEdit ? Math.abs(afterEdit.top - before.top) : null;
    const drift2 = afterView ? Math.abs(afterView.top - before.top) : null;
    results.push({ lm, drift1, drift2 });
  }

  const TOL = 20;
  const toleranced = results.filter((r) =>
    (r.drift1 != null && r.drift1 <= TOL) &&
    (r.drift2 != null && r.drift2 <= TOL)
  );
  const maxDrift = Math.max(
    ...results.flatMap((r) => [r.drift1 ?? 0, r.drift2 ?? 0])
  );
  if (toleranced.length === results.length) {
    ok(`${results.length} landmarks toggle cleanly (max drift ${maxDrift.toFixed(1)}px)`);
  } else {
    fail(`toggle drift at some landmarks`, `${results.length - toleranced.length}/${results.length} failed, worst ${maxDrift.toFixed(1)}px`);
    for (const r of results) {
      const bad = (r.drift1 != null && r.drift1 > TOL) || (r.drift2 != null && r.drift2 > TOL);
      if (bad) {
        log(`    ${pad(r.lm.text.slice(0, 30), 32)} view→edit Δ${r.drift1?.toFixed(1) ?? 'n/a'}  →view Δ${r.drift2?.toFixed(1) ?? 'n/a'}`);
      }
    }
  }
}

// --- Test 4: image partial-cutoff at the top preserves across toggle -----

async function testImageCutoffToggle(page) {
  log('\n[4] Partial-cutoff image preserves offset through view→edit→view→edit');

  // Pre-load all images by scrolling through.
  await scrollThroughView(page);

  let successCount = 0;
  let total = 0;
  for (const suffix of IMAGE_SUFFIXES) {
    await setScroll(page, 0);
    await page.waitForTimeout(100);

    // Scroll so the image is partially cut off at the top.
    const found = await page.evaluate((suf) => {
      const c = document.querySelector('.scrollbar-auto-hide') ||
        document.querySelector('.overflow-y-auto');
      if (!c) return null;
      const img = Array.from(document.querySelectorAll('article img')).find(
        (i) => i.src.endsWith(suf)
      );
      if (!img) return null;
      const r = img.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      c.scrollTop += r.top - cr.top + 150; // partial cutoff
      return { src: img.src };
    }, suffix);
    if (!found) continue;
    total++;
    await page.waitForTimeout(200);

    const before = await measureImageBySrc(page, suffix);
    if (!before) continue;

    await clickEdit(page);
    const edit1 = await measureImageBySrc(page, suffix);
    await clickDone(page);
    const view1 = await measureImageBySrc(page, suffix);
    await clickEdit(page);
    const edit2 = await measureImageBySrc(page, suffix);
    await clickDone(page);

    const states = [before, edit1, view1, edit2].filter(Boolean);
    const tops = states.map((s) => s.top);
    const drift = Math.max(...tops) - Math.min(...tops);
    if (drift <= 5) successCount++;
    else {
      log(`    ${pad(suffix.slice(-30), 34)} drift ${drift.toFixed(1)}px across ${states.length} states`);
    }
  }
  if (successCount === total) ok(`all ${total} partial-cutoff images preserve position`);
  else fail(`image cutoff drift`, `${total - successCount}/${total} images drifted`);
}

// --- Test 5: multiple rapid toggles don't accumulate drift ---------------

async function testRapidToggles(page) {
  log('\n[5] 10× rapid toggles must not accumulate drift');
  await setScroll(page, 0);
  await scrollToText(page, 'BERLIN SPRINT', 50);
  await page.waitForTimeout(200);

  const base = await measureByText(page, 'BERLIN SPRINT');
  if (!base) { fail('rapid toggles: landmark not found'); return; }

  let maxDrift = 0;
  for (let i = 0; i < 10; i++) {
    await clickEdit(page);
    const m = await measureByText(page, 'BERLIN SPRINT');
    if (m) maxDrift = Math.max(maxDrift, Math.abs(m.top - base.top));
    await clickDone(page);
    const n = await measureByText(page, 'BERLIN SPRINT');
    if (n) maxDrift = Math.max(maxDrift, Math.abs(n.top - base.top));
  }
  if (maxDrift <= 10) ok(`10× toggles stayed within ${maxDrift.toFixed(1)}px`);
  else fail(`toggles accumulated drift`, `${maxDrift.toFixed(1)}px`);
}

// --- Test 6: clicking on an image in edit reveals its markdown ----------

async function testImageClickReveal(page) {
  log('\n[6] Clicking an image in edit reveals its markdown text');
  await setScroll(page, 0);
  await clickEdit(page);
  await page.waitForTimeout(300);

  // Find any image widget.
  const box = await page.evaluate(() => {
    const img = document.querySelector('img.cm-md-img');
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!box) {
    // Scroll so an image is in view
    await page.evaluate(() => {
      const c = document.querySelector('.scrollbar-auto-hide') ||
        document.querySelector('.overflow-y-auto');
      if (c) c.scrollTop = 800;
    });
    await page.waitForTimeout(300);
  }
  const box2 = await page.evaluate(() => {
    const img = document.querySelector('img.cm-md-img');
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!box2) {
    fail('image click reveal: no image visible in edit mode');
    await clickDone(page);
    return;
  }

  await page.mouse.click(box2.x, box2.y);
  await page.waitForTimeout(200);
  // After click, the line should show raw markdown `![alt](src)` text.
  const revealed = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return null;
    let el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    while (el && !el.classList?.contains('cm-line')) el = el.parentElement;
    return el ? (el.textContent || '') : null;
  });
  if (revealed && revealed.includes('![') && revealed.includes('](')) {
    ok(`image click revealed markdown: "${revealed.slice(0, 50)}..."`);
  } else {
    fail(`image click did not reveal markdown`, `saw "${revealed?.slice(0, 50) ?? 'n/a'}"`);
  }
  await clickDone(page);
}

// --- Test 7: cursor on heading line shows `#`, off hides it --------------

async function testHeadingMarkFade(page) {
  log('\n[7] Heading marks fade when cursor off-line, appear when on-line');
  await setScroll(page, 0);
  await clickEdit(page);
  await page.waitForTimeout(300);

  const heading = await page.evaluate(() => {
    const h = document.querySelector('.cm-md-h2, .cm-md-h3');
    if (!h) return null;
    const r = h.getBoundingClientRect();
    return {
      text: (h.textContent || '').slice(0, 30),
      x: r.left + 100,
      y: r.top + r.height / 2,
    };
  });
  if (!heading) { fail('heading fade: no heading in viewport'); await clickDone(page); return; }

  // Click somewhere else first to put cursor off-line
  await page.evaluate(() => {
    const p = document.querySelector('.cm-md-p-start, .cm-line:not(.cm-md-blank):not([class*="cm-md-h"])');
    if (p) {
      const r = p.getBoundingClientRect();
      // place cursor at end of that line
      const sel = window.getSelection();
      if (sel && p.firstChild) {
        const range = document.createRange();
        range.setStart(p, p.childNodes.length);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return r.top;
    }
    return null;
  });
  await page.waitForTimeout(100);

  // Heading with cursor off-line should NOT show `#`
  const offlineText = await page.evaluate((t) => {
    const h = Array.from(document.querySelectorAll('.cm-md-h2, .cm-md-h3')).find(
      (el) => (el.textContent || '').slice(0, 30) === t
    );
    if (!h) return null;
    // Check if `#` is visible (not inside cm-md-hidden).
    const hashMark = h.querySelector('.cm-md-hidden');
    const hashVisible = !hashMark;
    return { hashVisible, text: (h.textContent || '').trim() };
  }, heading.text);

  await page.mouse.click(heading.x, heading.y);
  await page.waitForTimeout(100);

  const onlineText = await page.evaluate((t) => {
    const h = Array.from(document.querySelectorAll('.cm-md-h2, .cm-md-h3')).find(
      (el) => (el.textContent || '').slice(0, 30) === t
    );
    if (!h) return null;
    const hashMark = h.querySelector('.cm-md-hidden');
    const hashVisible = !hashMark;
    return { hashVisible };
  }, heading.text);

  if (offlineText && !offlineText.hashVisible && onlineText?.hashVisible) {
    ok('heading marks fade off-line, appear on-line');
  } else {
    fail('heading mark fade broken',
      `off: ${JSON.stringify(offlineText)}, on: ${JSON.stringify(onlineText)}`);
  }
  await clickDone(page);
}

// --- Test 8: total doc height stays within view/edit parity budget -------

async function testHeightParity(page) {
  log('\n[8] View and edit total heights should be within 20% of each other');
  await scrollThroughView(page);
  await setScroll(page, 0);

  const viewH = await page.evaluate(() => {
    const c = document.querySelector('.scrollbar-auto-hide') ||
      document.querySelector('.overflow-y-auto');
    return c ? c.scrollHeight : null;
  });

  await clickEdit(page);
  await page.waitForTimeout(500);
  const editH = await page.evaluate(() => {
    const c = document.querySelector('.scrollbar-auto-hide') ||
      document.querySelector('.overflow-y-auto');
    return c ? c.scrollHeight : null;
  });
  await clickDone(page);

  if (!viewH || !editH) { fail('height parity: couldnt measure'); return; }
  const ratio = editH / viewH;
  if (ratio > 0.8 && ratio < 1.2) {
    ok(`view=${viewH} edit=${editH} ratio=${ratio.toFixed(3)}`);
  } else {
    fail(`view and edit heights diverge`, `view=${viewH} edit=${editH} ratio=${ratio.toFixed(3)}`);
  }
}

// --- Test 9: scroll doesn't cause in-viewport content to shift ----------

async function testScrollNoShift(page) {
  log('\n[9] During continuous scroll, already-rendered content must not shift');
  await clickEdit(page);
  await setScroll(page, 0);

  // Pick a landmark near the top, then scroll small amounts and check it
  // doesn't move in the document (abs-y stable).
  const m0 = await measureByText(page, 'RELEASE HIGHLIGHTS');
  if (!m0) { fail('scroll-no-shift: landmark not found'); await clickDone(page); return; }
  const baseline = m0.absY;

  let maxDrift = 0;
  for (const step of [100, 250, 500, 1000, 2000, 3500, 5500, 8500, 0]) {
    await setScroll(page, step);
    const m = await measureByText(page, 'RELEASE HIGHLIGHTS');
    if (!m) continue;
    maxDrift = Math.max(maxDrift, Math.abs(m.absY - baseline));
  }
  if (maxDrift <= 2) ok(`RELEASE HIGHLIGHTS stable through scroll (drift ${maxDrift.toFixed(1)}px)`);
  else fail(`RELEASE HIGHLIGHTS drifted during scroll`, `${maxDrift.toFixed(1)}px`);
  await clickDone(page);
}

// --- Test 10: edge clicks at line boundaries ---------------------------

async function testLineBoundaryClicks(page) {
  log('\n[10] Clicks at heading↔paragraph boundary must land on whichever is clicked');
  await clickEdit(page);
  await setScroll(page, 0);

  // Find a heading line and the paragraph that follows it.
  const pair = await page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('.cm-line'));
    for (let i = 0; i < lines.length - 2; i++) {
      const h = lines[i];
      if (!/cm-md-h/.test(h.className)) continue;
      // Walk forward past blanks.
      let j = i + 1;
      while (j < lines.length && (lines[j].textContent || '').length === 0) j++;
      const p = lines[j];
      if (!p || !/cm-md-p/.test(p.className)) continue;
      const hr = h.getBoundingClientRect();
      const pr = p.getBoundingClientRect();
      return {
        hText: (h.textContent || '').slice(0, 30),
        pText: (p.textContent || '').slice(0, 30),
        hr: { top: hr.top, bottom: hr.bottom, left: hr.left },
        pr: { top: pr.top, bottom: pr.bottom, left: pr.left },
      };
    }
    return null;
  });
  if (!pair) { fail('line boundary: no heading/paragraph pair'); await clickDone(page); return; }

  // Click in the heading (top of its line)
  await page.mouse.click(pair.hr.left + 80, pair.hr.top + 5);
  await page.waitForTimeout(50);
  let landed = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel?.anchorNode) return null;
    let el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    while (el && !el.classList?.contains('cm-line')) el = el.parentElement;
    return el ? (el.textContent || '').slice(0, 30) : null;
  });
  const headingOk = landed === pair.hText;

  // Click in the paragraph (top of its line)
  await page.mouse.click(pair.pr.left + 80, pair.pr.top + 5);
  await page.waitForTimeout(50);
  landed = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel?.anchorNode) return null;
    let el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    while (el && !el.classList?.contains('cm-line')) el = el.parentElement;
    return el ? (el.textContent || '').slice(0, 30) : null;
  });
  const paraOk = landed === pair.pText;

  if (headingOk && paraOk) ok('boundary clicks route correctly to both sides');
  else fail('boundary clicks mis-routed', `heading: ${headingOk}, paragraph: ${paraOk}`);
  await clickDone(page);
}

// ---------------------------------------------------------------------------

async function main() {
  log('╔═══════════════════════════════════════════════════════════════╗');
  log('║  Atomic editor harness — view ↔ edit stability & correctness  ║');
  log('╚═══════════════════════════════════════════════════════════════╝');
  const { browser, page } = await openAtom();

  try {
    await testScrollStability(page);
    await testClickAccuracy(page);
    await testToggleRoundtrip(page);
    await testImageCutoffToggle(page);
    await testRapidToggles(page);
    await testImageClickReveal(page);
    await testHeadingMarkFade(page);
    await testHeightParity(page);
    await testScrollNoShift(page);
    await testLineBoundaryClicks(page);
  } catch (e) {
    log(`\n  unhandled error: ${e.message}`);
    failures++;
  } finally {
    await browser.close();
  }

  log('\n═══════════════════════════════════════════════════════════════');
  log(`Summary: ${passes} passed, ${failures} failed`);
  process.exitCode = failures > 0 ? 1 : 0;
}

main();
