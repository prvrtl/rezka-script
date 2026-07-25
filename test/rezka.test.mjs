import test from 'node:test';
import assert from 'node:assert/strict';
import { load, settle, cdnPayload } from './harness.mjs';
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

const dlButton = (doc) => doc.getElementById('rzk-action-dl');

test('panel mounts on a page that has a post id', async () => {
  const { doc } = load(seriesPage());
  await settle(200);

  assert.ok(doc.getElementById('rzk-wrap'), 'wrapper should be injected');
  assert.ok(doc.getElementById('rzk-pill'), 'pill should be injected');
  assert.ok(dlButton(doc).disabled, 'download starts disabled until streams arrive');
});

test('panel stays out of pages that are not watchable', async () => {
  const { doc } = load('<!doctype html><html><body><h1>Search results</h1></body></html>');
  await settle(200);

  assert.equal(doc.getElementById('rzk-wrap'), null);
});

test('PRO qualities are never offered', async () => {
  const { doc, window } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.withPro });

  const label = dlButton(doc).textContent;
  assert.match(label, /720p/, 'should settle on the best free quality');
  assert.doesNotMatch(label, /1080p|2160p/, 'PRO tiers must not be selected');
  assert.equal(dlButton(doc).disabled, false);
});

test('a PRO-only release disables the buttons instead of offering a dead link', async () => {
  const { doc, window } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.proOnly });

  assert.equal(dlButton(doc).disabled, true);
  assert.match(dlButton(doc).textContent, /No free quality/i);
});

test('HLS manifest suffix is stripped down to the plain file URL', async () => {
  const { doc, window, effects } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.plain });

  dlButton(doc).click();
  const { href } = effects.anchorClicks.at(-1);
  assert.equal(href, 'https://cdn.example.net/a_1080.mp4');
  assert.doesNotMatch(href, /manifest\.m3u8/);
});

test('download filename carries title, year, season/episode and quality', async () => {
  const { doc, window, effects } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.plain });

  dlButton(doc).click();
  assert.equal(effects.anchorClicks.at(-1).download, 'The.Example.Show.2021.S02E05.1080p.mp4');
});

test('copy button puts the direct URL on the clipboard', async () => {
  const { doc, window, effects } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.plain });

  doc.getElementById('rzk-action-copy').click();
  assert.equal(effects.clipboard.at(-1), 'https://cdn.example.net/a_1080.mp4');
});

test('leech handoff rewrites https to the secureleech scheme', async () => {
  const { doc, window, effects } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.plain });

  doc.getElementById('rzk-action-leech').click();
  assert.equal(effects.anchorClicks.at(-1).href, 'secureleech://cdn.example.net/a_1080.mp4');
});

test('a "4K" label outranks 720p', async () => {
  const { doc, window } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.fourK });

  assert.match(dlButton(doc).textContent, /4K/, '4K should win over 720p');
});

test('a Ukrainian-spelled voiceover is auto-selected', async () => {
  const { doc } = load(seriesPage());
  await settle();

  const chosen = doc.querySelector('.rzk-chip.on');
  assert.ok(chosen, 'some voiceover should be marked active');
  assert.match(chosen.textContent, /Українська/);
});

test('premium voiceovers are dropped from the chip list', async () => {
  const { doc } = load(seriesPage());
  await settle(200);

  const chips = [...doc.querySelectorAll('.rzk-chip')].map((c) => c.textContent);
  assert.equal(chips.some((c) => /PRO/.test(c)), false, 'PRO voiceover should not be listed');
  assert.equal(chips.length, 2);
});

test('a film page with no translator tabs still renders and works', async () => {
  const { doc, window, effects } = load(moviePage(), {
    url: 'https://hdrezka.me/films/another-example.html',
  });
  await settle(200);

  assert.ok(doc.getElementById('rzk-wrap'));
  deliverStreams(window, { tid: 'single', url: streamList.plain });

  dlButton(doc).click();
  assert.equal(effects.anchorClicks.at(-1).download, 'Another.Example.1999.1080p.mp4');
});

test('GM_download is preferred so the filename actually survives', async () => {
  const { doc, window, effects } = load(seriesPage(), { gmDownload: true });
  await settle(200);
  deliverStreams(window, { url: streamList.plain });

  dlButton(doc).click();

  assert.equal(effects.anchorClicks.length, 0, 'should not fall back to an anchor');
  assert.deepEqual(
    { url: effects.downloads.at(-1).url, name: effects.downloads.at(-1).name },
    {
      url: 'https://cdn.example.net/a_1080.mp4',
      name: 'The.Example.Show.2021.S02E05.1080p.mp4',
    }
  );
});

test('every free quality is offered, best first', async () => {
  const { doc, window } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.withPro });

  const chips = [...doc.querySelectorAll('#rzk-quals .rzk-chip')].map((c) => c.textContent);
  assert.deepEqual(chips, ['720p', '360p'], 'PRO tiers excluded, sorted high to low');
  assert.equal(doc.querySelector('#rzk-quals .rzk-chip.on').textContent, '720p');
});

test('picking a lower quality changes both the link and the filename', async () => {
  const { doc, window, effects } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.plain });

  [...doc.querySelectorAll('#rzk-quals .rzk-chip')].find((c) => c.textContent === '360p').click();
  dlButton(doc).click();

  assert.deepEqual(effects.anchorClicks.at(-1), {
    href: 'https://cdn.example.net/a_360.mp4',
    download: 'The.Example.Show.2021.S02E05.360p.mp4',
  });
});

test('a chosen quality is kept when switching voiceover', async () => {
  const { doc, window } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.plain });

  [...doc.querySelectorAll('#rzk-quals .rzk-chip')].find((c) => c.textContent === '720p').click();
  doc.querySelector('.rzk-chip[data-tid="57"]').click();
  deliverStreams(window, { tid: '57', url: streamList.plain });

  assert.equal(doc.querySelector('#rzk-quals .rzk-chip.on').textContent, '720p');
  assert.match(dlButton(doc).textContent, /720p/);
});

test('the script fetches on its own when the site never fires the AJAX call', async () => {
  const { effects } = load(seriesPage());
  await settle();

  const req = effects.xhrs.at(-1);
  assert.ok(req, 'expected the script to request the stream list itself');
  assert.match(req.url, /get_cdn_series/);
  assert.match(req.body, /translator_id=57/, 'should ask for the auto-selected voiceover');
});

test('a broken response surfaces instead of hanging on "Waiting"', async () => {
  const { doc, effects } = load(seriesPage());
  await settle();

  effects.xhrs.at(-1).respond('<html>blocked by cloudflare</html>');

  assert.match(dlButton(doc).textContent, /⚠️/, 'user should see something went wrong');
  assert.equal(dlButton(doc).disabled, true);
});

test('a success:false payload is reported rather than silently swallowed', async () => {
  const { doc, effects } = load(seriesPage());
  await settle();

  effects.xhrs.at(-1).respond({ success: false, url: '' });

  assert.match(dlButton(doc).textContent, /⚠️/);
});

test('switching episode clears the previous episode\'s link', async () => {
  const { doc, window, effects } = load(seriesPage());
  await settle(200);
  deliverStreams(window, { url: streamList.plain });
  assert.equal(dlButton(doc).disabled, false);

  doc.querySelector('.b-simple_episode__item[data-episode_id="1"]').click();

  assert.equal(dlButton(doc).disabled, true, 'must not offer the old episode file');
  assert.match(dlButton(doc).textContent, /Waiting/i);
});
