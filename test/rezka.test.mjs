import test from 'node:test';
import assert from 'node:assert/strict';
import {
  load, settle, cdnPayload, shadow, el, all, text, value,
  options, optionLabels, takenOver
} from './harness.mjs';
import { filmPage, seriesPage, gridPage, streamList } from './fixtures.mjs';

/** Emulate the site's own AJAX call so the script's XHR intercept picks it up. */
function deliver(window, { tid = '57', season = '2', episode = '1', url }) {
  const xhr = new window.XMLHttpRequest();
  xhr.open('POST', '/ajax/get_cdn_series/');
  xhr.send(`id=91371&translator_id=${tid}&action=get_stream&season=${season}&episode=${episode}`);
  xhr.respond(cdnPayload(url));
  return xhr;
}

const pick = (doc, menu, label) =>
  options(doc, menu).find((o) => o.textContent.trim().includes(label));

// ------------------------------------------------------------- takeover ----

test('a watch page is taken over', async () => {
  const { doc } = load(seriesPage());
  await settle();

  assert.ok(doc.getElementById('rzk-app'), 'app host mounted');
  assert.ok(shadow(doc), 'UI lives in a shadow root');
  assert.equal(takenOver(doc), true, 'original markup hidden');
});

test('a catalog page is taken over', async () => {
  const { doc } = load(gridPage());
  await settle();

  assert.ok(shadow(doc));
  assert.equal(takenOver(doc), true);
});

test('a page that is neither is left completely alone', async () => {
  const { doc } = load('<!doctype html><html><body><h1>О сайте</h1></body></html>');
  await settle();

  assert.equal(doc.getElementById('rzk-app'), null);
  assert.equal(takenOver(doc), false, 'must not blank a page we cannot render');
});

test('the escape hatch gives the original site back', async () => {
  const { doc } = load(seriesPage());
  await settle();

  el(doc, 'restore').click();

  assert.equal(takenOver(doc), false);
  assert.equal(doc.getElementById('rzk-app'), null);
});

// ---------------------------------------------------------- watch: shell ----

test('the header carries title, original title and the facts line', async () => {
  const { doc } = load(seriesPage());
  await settle();

  assert.equal(text(doc, '.head h1'), 'Класний керівник');
  assert.equal(text(doc, '.head .orig'), 'Great Teacher');

  const facts = text(doc, '.facts');
  assert.match(facts, /1998/, 'year');
  assert.match(facts, /Япония/, 'country');
  assert.match(facts, /45 мин\./, 'runtime');
  assert.match(facts, /9\.60/, 'rating score');
});

test('a film with no episodes renders without season or episode controls', async () => {
  const { doc } = load(filmPage());
  await settle();

  assert.equal(text(doc, '.head h1'), 'Тихий Дом');
  assert.equal(el(doc, 'seasonPick'), null, 'no season picker on a film');
  assert.equal(all(doc, '.ep').length, 0, 'no episode grid on a film');
});

test('synopsis and info table are carried over', async () => {
  const { doc } = load(seriesPage());
  await settle();

  assert.match(text(doc, '.synopsis'), /Stand-in synopsis/);
  const meta = text(doc, '.meta dl');
  assert.match(meta, /Страна/);
  assert.match(meta, /Япония/);
});

// --------------------------------------------------------- watch: voices ----

test('a Ukrainian voiceover is auto-selected and PRO ones are dropped', async () => {
  const { doc } = load(seriesPage());
  await settle();

  assert.match(value(doc, 'voice'), /Українська/);
  const labels = optionLabels(doc, 'voice');
  assert.equal(labels.length, 2, 'PRO track excluded');
  assert.equal(labels.some((l) => /PRO/.test(l)), false);
});

test('the script asks for the auto-selected voice, season and episode', async () => {
  const { effects } = load(seriesPage());
  await settle();

  const req = effects.xhrs.at(-1);
  assert.match(req.url, /get_cdn_series/);
  assert.match(req.body, /translator_id=57/);
  assert.match(req.body, /season=2/);
  assert.match(req.body, /episode=1/);
  assert.match(req.body, /action=get_stream/);
});

test('a film asks with get_movie, not get_stream', async () => {
  const { doc, window, effects } = load(filmPage());
  await settle();
  deliver(window, { tid: 'single', season: '', episode: '', url: streamList.plain });

  assert.equal(value(doc, 'quality'), '1080p', 'film streams still arrive');
});

// -------------------------------------------------------- watch: quality ----

test('PRO qualities are never offered', async () => {
  const { doc, window } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.withPro });

  assert.deepEqual(optionLabels(doc, 'quality'), ['720p', '360p']);
  assert.equal(value(doc, 'quality'), '720p');
});

test('a PRO-only release says so instead of offering a dead link', async () => {
  const { doc, window } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.proOnly });

  assert.equal(value(doc, 'quality'), '—');
  assert.match(el(doc, 'note').textContent, /только для PRO/i);
  assert.equal(el(doc, 'download').disabled, true);
});

test('a "4K" label outranks 720p', async () => {
  const { doc, window } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.fourK });

  assert.deepEqual(optionLabels(doc, 'quality'), ['4K', '720p', '360p']);
  assert.equal(value(doc, 'quality'), '4K');
});

test('choosing a quality swaps the file and is remembered', async () => {
  const { doc, window, effects } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.plain });

  pick(doc, 'quality', '360p').click();

  assert.equal(value(doc, 'quality'), '360p');
  assert.equal(effects.videoSrc.at(-1), 'https://cdn.example.net/a_360.mp4');
  assert.equal(window.localStorage.getItem('rzk.quality'), '"360p"');
});

// --------------------------------------------------------- watch: player ----

test('the player loads the direct file, not the HLS manifest', async () => {
  const { window, effects } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.plain });

  assert.equal(effects.videoSrc.at(-1), 'https://cdn.example.net/a_1080.mp4');
  assert.equal(effects.videoSrc.some((s) => /m3u8/.test(s)), false);
});

test('an HLS-only release hands playback back to the site', async () => {
  const { doc, window, effects } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.hlsOnly });

  assert.equal(effects.videoSrc.length, 0, 'must not feed a manifest to <video>');
  assert.equal(el(doc, 'veil').hidden, false);
  assert.match(el(doc, 'veilMsg').textContent, /HLS/);
  assert.equal(takenOver(doc), false, 'original player restored so it still plays');
});

test('play and pause drive the video element', async () => {
  const { doc, window } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.plain });

  el(doc, 'bigplay').click();
  assert.equal(el(doc, 'video').paused, false);
  assert.equal(el(doc, 'veil').hidden, true, 'poster overlay clears on play');

  el(doc, 'toggle').click();
  assert.equal(el(doc, 'video').paused, true);
});

// ------------------------------------------------------- watch: episodes ----

test('episodes for the active season are listed, with the current one marked', async () => {
  const { doc } = load(seriesPage());
  await settle();

  const eps = all(doc, '.ep');
  assert.deepEqual(eps.map((e) => e.textContent.trim()), ['1', '2'], 'season 2 has two episodes');
  assert.equal(eps[0].getAttribute('aria-current'), 'true');
});

test('picking an episode refetches for that episode', async () => {
  const { doc, effects } = load(seriesPage());
  await settle();

  all(doc, '.ep')[1].click();
  await settle();

  assert.match(effects.xhrs.at(-1).body, /episode=2/);
  assert.equal(all(doc, '.ep')[1].getAttribute('aria-current'), 'true');
});

test('switching season moves to that season\'s first episode', async () => {
  const { doc, effects } = load(seriesPage());
  await settle();

  pick(doc, 'season', '1').click();
  await settle();

  assert.equal(value(doc, 'season'), '1 сезон');
  assert.deepEqual(all(doc, '.ep').map((e) => e.textContent.trim()), ['1', '2', '3']);
  assert.match(effects.xhrs.at(-1).body, /season=1&episode=1/);
});

test('a stream is not reused across episodes', async () => {
  const { doc, window } = load(seriesPage());
  await settle();
  deliver(window, { episode: '1', url: streamList.plain });
  assert.equal(el(doc, 'download').disabled, false);

  all(doc, '.ep')[1].click();
  await settle();

  assert.equal(el(doc, 'download').disabled, true, 'must not offer episode 1 while on episode 2');
});

// -------------------------------------------------------- watch: actions ----

test('download filename carries title, year, season/episode and quality', async () => {
  const { doc, window, effects } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.plain });

  el(doc, 'download').click();
  assert.equal(effects.anchorClicks.at(-1).download, 'Great.Teacher.1998.S02E01.1080p.mp4');
});

test('GM_download is preferred so the filename survives', async () => {
  const { doc, window, effects } = load(seriesPage(), { gmDownload: true });
  await settle();
  deliver(window, { url: streamList.plain });

  el(doc, 'download').click();

  assert.equal(effects.anchorClicks.length, 0);
  assert.deepEqual(
    { url: effects.downloads.at(-1).url, name: effects.downloads.at(-1).name },
    { url: 'https://cdn.example.net/a_1080.mp4', name: 'Great.Teacher.1998.S02E01.1080p.mp4' }
  );
});

test('copy puts the direct URL on the clipboard', async () => {
  const { doc, window, effects } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.plain });

  el(doc, 'copy').click();
  assert.equal(effects.clipboard.at(-1), 'https://cdn.example.net/a_1080.mp4');
});

test('leech rewrites https to the secureleech scheme', async () => {
  const { doc, window, effects } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.plain });

  el(doc, 'leech').click();
  assert.equal(effects.anchorClicks.at(-1).href, 'secureleech://cdn.example.net/a_1080.mp4');
});

// ----------------------------------------------------------- watch: errors ----

test('an unreadable response is reported, not swallowed', async () => {
  const { doc, effects } = load(seriesPage());
  await settle();

  effects.xhrs.at(-1).respond('<html>bot check</html>');
  await settle(0);

  assert.match(el(doc, 'note').textContent, /не читается/i);
  assert.ok(el(doc, 'note').classList.contains('error'));
});

test('a success:false payload reports the site\'s own reason', async () => {
  const { doc, effects } = load(seriesPage());
  await settle();

  effects.xhrs.at(-1).respond({ success: false, url: '', message: 'Нет данных' });
  await settle(0);

  assert.match(el(doc, 'note').textContent, /Нет данных/);
});

// ------------------------------------------------------------------ grid ----

test('catalog cards are rebuilt with cover, title and meta', async () => {
  const { doc } = load(gridPage());
  await settle();

  const cards = all(doc, '.card');
  assert.equal(cards.length, 3);

  const first = cards[0];
  assert.equal(first.querySelector('.name').textContent.trim(), 'Поколение Икс');
  assert.equal(first.querySelector('.sub').textContent.trim(), '1996, США, Фантастика');
  assert.equal(first.querySelector('.kind').textContent.trim(), 'Фильм');
  assert.match(first.querySelector('img').getAttribute('src'), /91370\.jpg/);
  assert.match(first.getAttribute('href'), /91370-pokolenie-iks/);
});

test('covers are lazy so a long catalog does not fetch everything at once', async () => {
  const { doc } = load(gridPage());
  await settle();

  assert.equal(all(doc, '.card img').every((i) => i.getAttribute('loading') === 'lazy'), true);
});

test('pagination is carried through', async () => {
  const { doc } = load(gridPage());
  await settle();

  assert.deepEqual(all(doc, '.pager a').map((a) => a.textContent.trim()), ['1', '2', '3']);
});

test('an empty result set says so rather than rendering a bare grid', async () => {
  const { doc } = load(gridPage({ items: [], pages: [] }));
  await settle();

  assert.equal(doc.getElementById('rzk-app'), null, 'no cards means no grid page to take over');
});

test('the heading comes from the page', async () => {
  const { doc } = load(gridPage({ heading: 'Результаты поиска «matrix»' }));
  await settle();

  assert.equal(text(doc, '.gtitle'), 'Результаты поиска «matrix»');
});

test('search submits to the site\'s own search URL', async () => {
  const { doc, window, effects } = load(gridPage());
  await settle();

  const input = el(doc, 'q');
  input.value = 'матрица';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  assert.match(effects.navigated.at(-1), /\/search\/\?do=search&subaction=search&q=/);
  assert.match(decodeURIComponent(effects.navigated.at(-1)), /матрица/);
});

// ----------------------------------------------------------------- menus ----

test('menus open on click and close on choose', async () => {
  const { doc, window } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.plain });

  assert.equal(el(doc, 'qualityMenu').hidden, true);
  el(doc, 'qualityPick').click();
  assert.equal(el(doc, 'qualityMenu').hidden, false);

  pick(doc, 'quality', '720p').click();
  assert.equal(el(doc, 'qualityMenu').hidden, true);
});

test('opening one menu closes another', async () => {
  const { doc, window } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.plain });

  el(doc, 'qualityPick').click();
  el(doc, 'voicePick').click();

  assert.equal(el(doc, 'qualityMenu').hidden, true);
  assert.equal(el(doc, 'voiceMenu').hidden, false);
});

test('a picker with one option is inert', async () => {
  const { doc, window } = load(
    seriesPage({ translators: [{ id: '59', name: 'Дубляж', active: true }], seasons: ['1'],
                 episodes: { 1: ['1'] }, activeSeason: '1', activeEpisode: '1' })
  );
  await settle();
  deliver(window, { tid: '59', season: '1', episode: '1', url: '[720p]https://cdn.example.net/only.mp4' });

  assert.equal(el(doc, 'voicePick').disabled, true);
  assert.equal(el(doc, 'qualityPick').disabled, true);
  assert.equal(el(doc, 'download').disabled, false, 'still downloadable');
});
