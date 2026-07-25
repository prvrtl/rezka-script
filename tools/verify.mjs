/**
 * Loads the real userscript into real pages and checks it actually works.
 *
 * Same rules as capture.mjs: headed browser, persistent profile, and if the
 * site's bot check appears it waits for you to clear it rather than trying to
 * get around it.
 *
 *   node tools/verify.mjs                     # default page set
 *   node tools/verify.mjs watch=<url> …       # specific pages
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'fixtures', 'raw');
const PROFILE = process.env.RZK_PROFILE || join(process.env.TMPDIR || '/tmp', 'rzk-capture-profile');
const CHALLENGE = /не бот|checking your browser|just a moment|attention required/i;

const DEFAULTS = [
  ['film', 'https://rezka-ua.tv/films/drama/55330-russkaya-lolita-2007.html'],
  ['series', 'https://rezka-ua.tv/series/comedy/91371-krutoy-uchitel-onidzuka-1998.html'],
  ['catalog', 'https://rezka-ua.tv/films/'],
  ['search', 'https://rezka-ua.tv/search/?do=search&subaction=search&q=matrix'],
];

/** The GM_* surface Tampermonkey would provide. */
const SHIMS = `
  window.__rzkDownloads = [];
  window.GM_setClipboard = (t) => { window.__rzkClip = t; };
  window.GM_download = (o) => { window.__rzkDownloads.push(o); };
  window.GM_getValue = (k, d) => { try { const v = localStorage.getItem('gm:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
  window.GM_setValue = (k, v) => { try { localStorage.setItem('gm:' + k, JSON.stringify(v)); } catch (e) {} };
  window.__rzkErrors = [];
  window.addEventListener('error', (e) => {
    window.__rzkErrors.push((e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || ''));
  });
`;

const script = readFileSync(join(ROOT, 'rezka-downloader.user.js'), 'utf8');

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  (ok ? pass++ : fail++);
  console.log(`    ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : detail ? ` (${detail})` : ''}`);
};

async function settled(page) {
  const t = await page.title().catch(() => '');
  if (CHALLENGE.test(t)) return false;
  return page.evaluate(() => Boolean(document.querySelector('#post_id, .b-content__inline_item')));
}

async function waitForHuman(page) {
  console.log('    ⏸  bot check — clear it in the window, I will continue');
  const until = Date.now() + 5 * 60_000;
  while (Date.now() < until) {
    await page.waitForTimeout(2000);
    if (await settled(page)) { console.log('    ✓ through'); return true; }
  }
  return false;
}

/** Read the app's state out of the shadow root. */
const probe = () => {
  const host = document.getElementById('rzk-app');
  if (!host) return { mounted: false };
  const s = host.shadowRoot;
  const q = (sel) => s.querySelector(sel);
  const txt = (sel) => q(sel)?.textContent.replace(/\s+/g, ' ').trim() || '';
  const video = q('[data-el="video"]');
  return {
    mounted: true,
    takenOver: document.documentElement.getAttribute('data-rzk') === 'on',
    title: txt('.head h1'),
    facts: txt('.facts'),
    synopsis: txt('.synopsis').length,
    voice: q('[data-el="voiceValue"]')?.textContent.trim() || '',
    quality: q('[data-el="qualityValue"]')?.textContent.trim() || '',
    qualities: [...s.querySelectorAll('[data-el="qualityMenu"] .opt')].map(o => o.textContent.trim()),
    voices: [...s.querySelectorAll('[data-el="voiceMenu"] .opt')].map(o => o.textContent.trim()),
    seasons: [...s.querySelectorAll('[data-el="seasonMenu"] .opt')].map(o => o.textContent.trim()),
    episodes: s.querySelectorAll('.ep').length,
    note: txt('[data-el="note"]'),
    videoSrc: video?.getAttribute('src') || '',
    downloadEnabled: q('[data-el="download"]') ? !q('[data-el="download"]').disabled : false,
    cards: s.querySelectorAll('.card').length,
    firstCard: txt('.card .name'),
    pager: s.querySelectorAll('.pager a').length,
    heading: txt('.gtitle'),
    veilVisible: q('[data-el="veil"]') ? !q('[data-el="veil"]').hidden : null,
  };
};

const targets = process.argv.slice(2).length
  ? process.argv.slice(2).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; })
  : DEFAULTS;

mkdirSync(SHOTS, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false, viewport: { width: 1440, height: 900 }, locale: 'uk-UA'
});
await context.addInitScript({ content: SHIMS + '\n' + script });

const page = context.pages()[0] || await context.newPage();

// The site pulls in ad and tracker hosts that frequently fail to resolve. That
// is their problem, not the script's — only real exceptions count.
const NOISE = /ERR_NAME_NOT_RESOLVED|ERR_BLOCKED|ERR_CONNECTION|Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR/i;
const errors = [];
page.on('pageerror', e => errors.push('exception: ' + String(e.message || e)));
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (!NOISE.test(t)) errors.push(t.slice(0, 160));
});

for (const [name, url] of targets) {
  console.log(`\n▸ ${name}  ${url}`);
  errors.length = 0;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  } catch (e) {
    check(false, 'page loaded', e.message.split('\n')[0]);
    continue;
  }
  if (!(await settled(page)) && !(await waitForHuman(page))) { check(false, 'page loaded'); continue; }

  // Give the script's own fetch and the site's AJAX time to land.
  await page.waitForTimeout(6000);
  const r = await page.evaluate(probe);

  check(r.mounted, 'UI mounted');
  if (!r.mounted) {
    const d = await page.evaluate(() => ({
      readyState: document.readyState,
      postId: Boolean(document.getElementById('post_id')),
      cards: document.querySelectorAll('.b-content__inline_item').length,
      takeoverStyle: Boolean(document.getElementById('rzk-takeover')),
      dataRzk: document.documentElement.getAttribute('data-rzk'),
      bodyKids: document.body ? document.body.children.length : -1,
      inPage: (window.__rzkErrors || []).slice(0, 4),
    }));
    console.log('      diagnostics:', JSON.stringify(d));
    for (const e of errors.slice(0, 6)) console.log(`      error: ${e}`);
    if (!errors.length) console.log('      (no page errors captured)');
    continue;
  }
  check(r.takenOver, 'original page hidden');

  if (name === 'catalog' || name === 'search') {
    check(r.cards > 0, 'cards rendered', String(r.cards));
    check(Boolean(r.firstCard), 'card has a title', r.firstCard);
    check(Boolean(r.heading), 'heading', r.heading.slice(0, 40));
    if (name === 'catalog') check(r.pager > 0, 'pagination', String(r.pager));
  } else {
    check(Boolean(r.title), 'title', r.title.slice(0, 40));
    check(Boolean(r.facts), 'facts line', r.facts.slice(0, 60));
    check(r.synopsis > 0, 'synopsis', `${r.synopsis} chars`);
    check(Boolean(r.voice) && r.voice !== '—', 'voice resolved', r.voice.slice(0, 30));
    check(r.qualities.length > 0, 'qualities offered', r.qualities.join(' '));
    check(r.quality !== '—', 'a quality is selected', r.quality);
    check(r.downloadEnabled, 'download enabled');
    // Real stream URLs carry no file extension, so the test is only that it is
    // an ordinary http(s) target and not a manifest.
    check(/^https?:\/\//.test(r.videoSrc) && !/\.m3u8/.test(r.videoSrc),
      'player got a direct file', r.videoSrc.slice(0, 62) || `note: ${r.note}`);
    if (name === 'series') {
      check(r.episodes > 0, 'episodes listed', String(r.episodes));
    }
    if (r.note) console.log(`      note: ${r.note}`);

    // Actually play it: metadata, then buffered bytes, then the readout.
    if (r.videoSrc) {
      const play = await page.evaluate(async () => {
        const s = document.getElementById('rzk-app').shadowRoot;
        const v = s.querySelector('[data-el="video"]');
        try { await v.play(); } catch (e) { /* autoplay policy */ }
        await new Promise(r => setTimeout(r, 8000));
        return {
          readyState: v.readyState,
          duration: isFinite(v.duration) ? Math.round(v.duration) : null,
          buffered: v.buffered.length ? Math.round(v.buffered.end(v.buffered.length - 1)) : 0,
          playedTo: Math.round(v.currentTime),
          err: v.error ? v.error.code : null,
          speed: s.querySelector('[data-el="speedText"]')?.textContent || '',
          level: (s.querySelector('[data-el="speedDot"]')?.className || '').replace('pulse ', ''),
        };
      });
      check(play.readyState >= 1, 'stream metadata loaded', `readyState ${play.readyState}`);
      check(play.duration > 0, 'duration known', `${play.duration}s`);
      check(play.buffered > 0, 'data buffering', `${play.buffered}s buffered`);
      check(!play.err, 'no media error', play.err ? `code ${play.err}` : '');
      check(Boolean(play.speed), 'throughput readout', `${play.speed} [${play.level}]`);
    }
  }

  check(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' | '));
  await page.screenshot({ path: join(SHOTS, `verify-${name}.png`) });
}

await context.close();
console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
