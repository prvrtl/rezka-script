import test from 'node:test';
import assert from 'node:assert/strict';
import { load, settle, cdnPayload, shadow, el, chips, chipLabels } from './harness.mjs';
import { seriesPage, moviePage, streamList } from './fixtures.mjs';

/** Emulate the site's own AJAX call so the script's XHR intercept picks it up. */
function deliverStreams(window, { tid = '56', url, season = '2', episode = '5' }) {
  const xhr = new window.XMLHttpRequest();
  xhr.open('POST', '/ajax/get_cdn_series/');
  xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  xhr.send(`id=12345&translator_id=${tid}&action=get_stream&season=${season}&episode=${episode}`);
  xhr.respond(cdnPayload(url));
  return xhr;
}

const dl = (doc) => el(doc, 'download');
const pick = (doc, group, label) =>
  chips(doc, group).find((c) => c.textContent.trim().includes(label));

test('panel mounts on a page that has a post id', async () => {
  const { doc } = load(seriesPage());
  await settle(200);

  assert.ok(doc.getElementById('rzk-root'), 'host element should be injected');
  assert.ok(shadow(doc), 'UI should live in a shadow root');
  assert.ok(dl(doc).disabled, 'download starts disabled until streams arrive');
});

test('the UI is isolated from the page', async () => {
  const { doc } = load(seriesPage());
  await settle(200);

  assert.equal(doc.querySelector('style'), null, 'no stylesheet injected into the page');
  assert.equal(doc.querySelectorAll('#rzk-root > *').length, 0, 'nothing rendered in light DOM');
});

test('panel stays out of pages that are not watchable', async () => {
  const { doc } = load('<!doctype html><html><body><h1>Search results</h1></body></html>');
  await settle(200);

  assert.equal(doc.getElementById('rzk-root'), null);
});

test('PRO qualities are never offered', async () => {
  const { doc, window } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.withPro });

  assert.deepEqual(chipLabels(doc, 'qualities'), ['720p', '360p'], 'PRO tiers excluded, best first');
  assert.match(dl(doc).textContent, /720p/);
  assert.equal(dl(doc).disabled, false);
});

test('a PRO-only release offers nothing rather than a dead link', async () => {
  const { doc, window } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.proOnly });

  assert.equal(dl(doc).disabled, true);
  assert.match(el(doc, 'qualities').textContent, /No free quality/i);
});

test('HLS manifest suffix is stripped down to the plain file URL', async () => {
  const { doc, window, effects } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.plain });

  dl(doc).click();
  const { href } = effects.anchorClicks.at(-1);
  assert.equal(href, 'https://cdn.example.net/a_1080.mp4');
  assert.doesNotMatch(href, /manifest\.m3u8/);
});

test('download filename carries title, year, season/episode and quality', async () => {
  const { doc, window, effects } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.plain });

  dl(doc).click();
  assert.equal(effects.anchorClicks.at(-1).download, 'The.Example.Show.2021.S02E05.1080p.mp4');
});

test('GM_download is preferred so the filename actually survives', async () => {
  const { doc, window, effects } = load(seriesPage(), { gmDownload: true });
  await settle(200);
  deliverStreams(window, { url: streamList.plain });

  dl(doc).click();

  assert.equal(effects.anchorClicks.length, 0, 'should not fall back to an anchor');
  const { url, name } = effects.downloads.at(-1);
  assert.deepEqual({ url, name }, {
    url: 'https://cdn.example.net/a_1080.mp4',
    name: 'The.Example.Show.2021.S02E05.1080p.mp4',
  });
});

test('copy button puts the direct URL on the clipboard', async () => {
  const { doc, window, effects } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.plain });

  el(doc, 'copy').click();
  assert.equal(effects.clipboard.at(-1), 'https://cdn.example.net/a_1080.mp4');
});

test('leech handoff rewrites https to the secureleech scheme', async () => {
  const { doc, window, effects } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.plain });

  el(doc, 'leech').click();
  assert.equal(effects.anchorClicks.at(-1).href, 'secureleech://cdn.example.net/a_1080.mp4');
});

test('a "4K" label outranks 720p', async () => {
  const { doc, window } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.fourK });

  assert.deepEqual(chipLabels(doc, 'qualities'), ['4K', '720p', '360p']);
  assert.match(dl(doc).textContent, /4K/);
});

test('a Ukrainian-spelled voiceover is auto-selected', async () => {
  const { doc } = load(seriesPage());
  await settle(200);

  const on = chips(doc, 'translators').find((c) => c.getAttribute('aria-pressed') === 'true');
  assert.ok(on, 'some voiceover should be marked active');
  assert.match(on.textContent, /Українська/);
});

test('premium voiceovers are dropped from the chip list', async () => {
  const { doc } = load(seriesPage());
  await settle(200);

  const labels = chipLabels(doc, 'translators');
  assert.equal(labels.some((l) => /PRO/.test(l)), false, 'PRO voiceover should not be listed');
  assert.equal(labels.length, 2);
});

test('picking a lower quality changes both the link and the filename', async () => {
  const { doc, window, effects } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.plain });

  pick(doc, 'qualities', '360p').click();
  dl(doc).click();

  assert.deepEqual(effects.anchorClicks.at(-1), {
    href: 'https://cdn.example.net/a_360.mp4',
    download: 'The.Example.Show.2021.S02E05.360p.mp4',
  });
});

test('a chosen quality is kept when switching voiceover', async () => {
  const { doc, window } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { tid: '56', url: streamList.plain });

  pick(doc, 'qualities', '720p').click();
  pick(doc, 'translators', 'Українська').click();
  deliverStreams(window, { tid: '57', url: streamList.plain });

  assert.match(dl(doc).textContent, /720p/, 'preference should carry across tracks');
});

test('a film page with no translator tabs still renders and works', async () => {
  const { doc, window, effects } = load(moviePage(), {
    url: 'https://hdrezka.me/films/another-example.html',
  });
  await settle(200);

  assert.ok(doc.getElementById('rzk-root'));
  deliverStreams(window, { tid: 'single', url: streamList.plain });

  dl(doc).click();
  assert.equal(effects.anchorClicks.at(-1).download, 'Another.Example.1999.1080p.mp4');
});

test('the script fetches on its own when the site never fires the AJAX call', async () => {
  const { effects } = load(seriesPage());
  await settle();

  const req = effects.xhrs.at(-1);
  assert.ok(req, 'expected the script to request the stream list itself');
  assert.match(req.url, /get_cdn_series/);
  assert.match(req.body, /translator_id=57/, 'should ask for the auto-selected voiceover');
  assert.match(req.body, /action=get_stream/, 'series pages use get_stream');
});

test('a broken response surfaces instead of hanging silently', async () => {
  const { doc, effects } = load(seriesPage());
  await settle();

  effects.xhrs.at(-1).respond('<html>blocked by cloudflare</html>');
  await settle(0); // the request rejects into a microtask

  assert.match(el(doc, 'status').textContent, /Unreadable/i);
  assert.ok(el(doc, 'status').classList.contains('error'));
  assert.equal(dl(doc).disabled, true);
});

test('a success:false payload reports the site\'s reason', async () => {
  const { doc, effects } = load(seriesPage());
  await settle();

  effects.xhrs.at(-1).respond({ success: false, url: '', message: 'Nothing here' });
  await settle(0); // the request rejects into a microtask

  assert.match(el(doc, 'status').textContent, /Nothing here/);
  assert.ok(el(doc, 'status').classList.contains('error'));
});

test('switching episode drops the previous episode\'s link', async () => {
  const { doc, window } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.plain });
  assert.equal(dl(doc).disabled, false);

  doc.querySelector('.b-simple_episode__item[data-episode_id="1"]').click();

  assert.equal(dl(doc).disabled, true, 'must not offer the old episode file');
  assert.equal(chips(doc, 'qualities').length, 0);
});

test('the panel opens and closes, and remembers being open', async () => {
  const { doc, window } = load(seriesPage());
  await settle(200);

  const panel = shadow(doc).querySelector('.panel');
  const pill = el(doc, 'pill');
  assert.equal(panel.hidden, true, 'starts closed');

  pill.click();
  assert.equal(panel.hidden, false);
  assert.equal(pill.getAttribute('aria-expanded'), 'true');
  assert.equal(window.localStorage.getItem('rzk.open'), 'true', 'state persisted');

  pill.click();
  assert.equal(panel.hidden, true);
});
