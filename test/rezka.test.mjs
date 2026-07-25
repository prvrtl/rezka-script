import test from 'node:test';
import assert from 'node:assert/strict';
import {
  load, settle, cdnPayload, shadow, el, all, text, value,
  options, optionLabels, takenOver
} from './harness.mjs';
import { filmPage, seriesPage, gridPage, streamList, SCRAMBLED } from './fixtures.mjs';

/** Emulate the site's own AJAX call so the script's XHR intercept picks it up. */
function deliver(window, { tid = '57', season = '2', episode = '1', url }) {
  const xhr = new window.XMLHttpRequest();
  xhr.open('POST', '/ajax/get_cdn_series/');
  xhr.send(`id=91371&translator_id=${tid}&action=get_stream&season=${season}&episode=${episode}`);
  xhr.respond(cdnPayload(url));
  return xhr;
}

const CATALOG_URL = 'https://rezka-ua.tv/films/';

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
  const { doc } = load(gridPage(), { url: CATALOG_URL });
  await settle();

  assert.ok(shadow(doc));
  assert.equal(takenOver(doc), true);
});

test('a page that is neither is left completely alone', async () => {
  const { doc } = load('<!doctype html><html><body><h1>О сайте</h1></body></html>', { url: 'https://rezka-ua.tv/about/' });
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

  assert.equal(text(doc, '.head h1'), 'Great Teacher', 'English name leads');
  assert.equal(text(doc, '.head .orig'), 'Класний керівник', 'local name underneath');

  const facts = text(doc, '.facts');
  assert.match(facts, /1998/, 'year');
  assert.match(facts, /Japan/, 'country');
  assert.match(facts, /45 min/, 'runtime');
  assert.match(facts, /9\.60/, 'rating score');
});

test('a film with no episodes renders without season or episode controls', async () => {
  const { doc } = load(filmPage());
  await settle();

  assert.equal(text(doc, '.head h1'), 'The Quiet House');
  assert.equal(el(doc, 'seasonPick'), null, 'no season picker on a film');
  assert.equal(all(doc, '.ep').length, 0, 'no episode grid on a film');
});

test('synopsis and info table are carried over', async () => {
  const { doc } = load(seriesPage());
  await settle();

  assert.match(text(doc, '.synopsis'), /Краткое описание сериала/);
  const meta = text(doc, '.meta dl');
  assert.match(meta, /Country/);
  assert.match(meta, /Japan/);
});

// --------------------------------------------------------- watch: voices ----

test('a Ukrainian voiceover is auto-selected and PRO ones are dropped', async () => {
  const { doc } = load(seriesPage());
  await settle();

  assert.match(value(doc, 'voice'), /Ukrainian/);
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
  assert.match(el(doc, 'note').textContent, /PRO-only/i);
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

  assert.equal(value(doc, 'season'), 'Season 1');
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

  assert.match(el(doc, 'note').textContent, /Unreadable/i);
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
  const { doc } = load(gridPage(), { url: CATALOG_URL });
  await settle();

  const cards = all(doc, '.card');
  assert.equal(cards.length, 3);

  const first = cards[0];
  assert.equal(first.querySelector('.name').textContent.trim(), 'Поколение Икс');
  assert.equal(first.querySelector('.sub').textContent.trim(), '1996, USA, Sci-Fi', 'meta line translated');
  assert.equal(first.querySelector('.kind').textContent.trim(), 'Film');
  assert.match(first.querySelector('img').getAttribute('src'), /91370\.jpg/);
  assert.match(first.getAttribute('href'), /91370-pokolenie-iks/);
});

test('covers are lazy so a long catalog does not fetch everything at once', async () => {
  const { doc } = load(gridPage(), { url: CATALOG_URL });
  await settle();

  assert.equal(all(doc, '.card img').every((i) => i.getAttribute('loading') === 'lazy'), true);
});

test('pagination is carried through', async () => {
  const { doc } = load(gridPage(), { url: CATALOG_URL });
  await settle();

  assert.deepEqual(all(doc, '.pager a').map((a) => a.textContent.trim()), ['1', '2', '3']);
});

test('a search with no results says so instead of showing a bare page', async () => {
  const { doc } = load(gridPage({ items: [], pages: [], heading: 'Результаты поиска' }),
    { url: 'https://rezka-ua.tv/search/?do=search&subaction=search&q=zzz' });
  await settle();

  assert.ok(shadow(doc), 'a search URL is still ours to render');
  assert.match(text(doc, '.empty'), /Nothing found/);
});

test('an ordinary page with no cards is left alone', async () => {
  const { doc } = load(gridPage({ items: [], pages: [] }), { url: 'https://rezka-ua.tv/films/' });
  await settle();

  assert.equal(doc.getElementById('rzk-app'), null, 'nothing to show means no takeover');
});

test('the heading comes from the page', async () => {
  const { doc } = load(gridPage({ heading: 'Результаты поиска «matrix»' }), { url: CATALOG_URL });
  await settle();

  assert.equal(text(doc, '.gtitle'), 'Результаты поиска «matrix»');
});

test('search submits to the site\'s own search URL', async () => {
  const { doc, window, effects } = load(gridPage(), { url: CATALOG_URL });
  await settle();

  const input = el(doc, 'q');
  input.value = 'матрица';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  assert.match(effects.navigated.at(-1), /\/search\/\?do=search&subaction=search&q=/);
  assert.match(decodeURIComponent(effects.navigated.at(-1)), /матрица/);
});

// ------------------------------------------ independence from the markup ----
// The site is free to restyle whenever it likes. These run the whole UI against
// a page where every structural class has been renamed, leaving only what the
// script actually claims to depend on: the URL, meta tags and data-* attributes.

const SERIES_URL = 'https://rezka-ua.tv/series/comedy/91371-klasnyi-kerivnyk-1998.html';

test('a full restyle does not stop the watch page rendering', async () => {
  const { doc } = load(seriesPage({ classes: SCRAMBLED }), { url: SERIES_URL });
  await settle();

  assert.ok(shadow(doc), 'still mounts');
  assert.equal(text(doc, '.head h1'), 'Great Teacher', 'English name from alternativeHeadline');
  assert.equal(text(doc, '.head .orig'), 'Класний керівник', 'local name from itemprop=name');
  assert.match(text(doc, '.facts'), /1998/, 'year from og:title');
  assert.match(text(doc, '.facts'), /Comedy/, 'genre from itemprop');
  assert.match(text(doc, '.facts'), /45 min/, 'runtime from og:duration');
  assert.match(text(doc, '.facts'), /9\.60/, 'rating from itemprop=average');
  assert.match(text(doc, '.synopsis'), /Краткое описание/, 'synopsis from og:description');
});

test('a full restyle does not stop voices, seasons or episodes working', async () => {
  const { doc, effects } = load(seriesPage({ classes: SCRAMBLED }), { url: SERIES_URL });
  await settle();

  assert.match(value(doc, 'voice'), /Ukrainian/, 'voices from data-translator_id');
  assert.equal(optionLabels(doc, 'voice').length, 2, 'PRO still filtered out');
  assert.equal(value(doc, 'season'), 'Season 2', 'seasons from data-tab_id');
  assert.equal(all(doc, '.ep').length, 2, 'episodes from data-episode_id');
  assert.match(effects.xhrs.at(-1).body, /translator_id=57&action=get_stream&season=2&episode=1/);
});

test('a full restyle does not stop the catalog rendering', async () => {
  const { doc } = load(gridPage({ classes: SCRAMBLED }), { url: 'https://rezka-ua.tv/films/' });
  await settle();

  const cards = all(doc, '.card');
  assert.equal(cards.length, 3, 'cards found by data-url/data-id');
  assert.equal(cards[0].querySelector('.name').textContent.trim(), 'Поколение Икс');
  assert.equal(cards[0].querySelector('.sub').textContent.trim(), '1996, USA, Sci-Fi');
  assert.match(cards[0].getAttribute('href'), /91370-pokolenie-iks/);
  assert.equal(all(doc, '.pager a').length, 3, 'pagination from /page/ hrefs');
});

test('the content id comes from the URL, not a hidden input', async () => {
  const html = seriesPage().replace(/<input[^>]*id="post_id"[^>]*>/, '');
  const { effects } = load(html, { url: SERIES_URL });
  await settle();

  assert.match(effects.xhrs.at(-1).body, /(^|&)id=91371(&|$)/, 'id parsed out of the path');
});

test('a watch page is recognised from its URL alone', async () => {
  // No #post_id and no cards — only the URL shape and og:type say what this is.
  const html = seriesPage().replace(/<input[^>]*id="post_id"[^>]*>/, '');
  const { doc } = load(html, { url: SERIES_URL });
  await settle();

  assert.ok(shadow(doc)?.querySelector('.head h1'), 'rendered as a watch page');
});

test('og:type alone is enough to treat something as a series', async () => {
  // No season or episode tabs rendered at all — only og:type says it is a show.
  const html = seriesPage({ seasons: [], episodes: {} });
  const { effects } = load(html, { url: SERIES_URL });
  await settle();

  assert.match(effects.xhrs.at(-1)?.body || '', /action=get_stream/,
    'video.tv_series implies episodes even with no tabs rendered');
});

// ----------------------------------------------------- stream throughput ----

/** Drive playback: [[msElapsed, bufferedSeconds, playheadSeconds], …]. */
function feed(doc, window, samples, duration = 3600) {
  const v = el(doc, 'video');
  v.__duration = duration;
  for (const [ms, buffered, at = 0] of samples) {
    window.__advance(ms);
    v.__buffered = buffered;
    v.__currentTime = at;
    v.dispatchEvent(new window.Event('progress'));
  }
}

const speedText = (doc) => el(doc, 'speedText').textContent;
const speedLevel = (doc) => el(doc, 'speedDot').className.replace('pulse ', '');

test('the speed readout stays hidden until playback produces data', async () => {
  const { doc, window } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.plain });

  assert.equal(el(doc, 'speed').hidden, true);
});

test('one sample is not enough to claim a rate', async () => {
  const { doc, window } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.plain });
  el(doc, 'bigplay').click();

  feed(doc, window, [[0, 3]]);

  assert.equal(el(doc, 'speed').hidden, false);
  assert.match(speedText(doc), /measuring/);
  assert.equal(speedLevel(doc), 'idle');
});

test('downloading faster than playback reports headroom', async () => {
  const { doc, window } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.plain });
  el(doc, 'bigplay').click();

  // 12s of video arrived over 4s of wall clock.
  feed(doc, window, [[0, 10, 0], [4000, 22, 4]]);

  assert.match(speedText(doc), /3\.0× headroom/);
  assert.match(speedText(doc), /18s buffered/);
  assert.equal(speedLevel(doc), 'good');
});

test('downloading slower than playback warns about stalling', async () => {
  const { doc, window } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.plain });
  el(doc, 'bigplay').click();

  // Only 2s of video in 4s of wall clock, and the playhead has eaten the buffer.
  feed(doc, window, [[0, 10, 4], [4000, 12, 8]]);

  assert.match(speedText(doc), /may stall/);
  assert.equal(speedLevel(doc), 'poor');
});

test('a CDN pacing at real time is not reported as failing', async () => {
  const { doc, window } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.plain });
  el(doc, 'bigplay').click();

  // Exactly 1x fill, but a healthy cushion ahead of the playhead.
  feed(doc, window, [[0, 44, 4], [4000, 48, 8]]);

  assert.equal(speedLevel(doc), 'good', '40s buffered is comfortable at any fill rate');
  assert.doesNotMatch(speedText(doc), /may stall/);
});

test('a fully buffered file reports that rather than a rate', async () => {
  const { doc, window } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.plain });
  el(doc, 'bigplay').click();

  feed(doc, window, [[0, 200, 0], [4000, 600, 4]], 600);

  assert.match(speedText(doc), /fully downloaded/);
  assert.equal(speedLevel(doc), 'good');
});

test('seeking backwards restarts the measurement instead of reporting a drop', async () => {
  const { doc, window } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.plain });
  el(doc, 'bigplay').click();

  feed(doc, window, [[0, 100, 0], [4000, 130, 4]]);
  assert.match(speedText(doc), /headroom/);

  feed(doc, window, [[1000, 6, 3]]); // seek rewound the buffer
  assert.match(speedText(doc), /measuring/, 'window restarted, not a negative rate');
});

test('with a reachable file size the readout gives absolute figures', async () => {
  const { doc, window } = load(seriesPage(), { fileSize: 2_000_000_000 });
  await settle();
  deliver(window, { url: streamList.plain });
  await settle(0); // HEAD resolves in a microtask
  el(doc, 'bigplay').click();

  feed(doc, window, [[0, 10, 0], [4000, 22, 4]]);

  assert.match(speedText(doc), /Mbps/, 'throughput shown');
  assert.match(speedText(doc), /2\.00 GB/, 'file size shown');
});

test('without GM_xmlhttpRequest it still reports headroom', async () => {
  const { doc, window, effects } = load(seriesPage());
  await settle();
  deliver(window, { url: streamList.plain });
  el(doc, 'bigplay').click();

  feed(doc, window, [[0, 10, 0], [4000, 22, 4]]);

  assert.equal(effects.headRequests.length, 0, 'no probing without the API');
  assert.match(speedText(doc), /3\.0× headroom/);
  assert.doesNotMatch(speedText(doc), /Mbps/, 'no bitrate without a size');
});

test('opening the quality menu annotates each option with its size', async () => {
  const { doc, window, effects } = load(seriesPage(), { fileSize: 1_500_000_000 });
  await settle();
  deliver(window, { url: streamList.plain });

  el(doc, 'qualityPick').click();
  await settle(5);

  assert.equal(effects.headRequests.length >= 3, true, 'each free quality probed once');
  assert.equal(optionLabels(doc, 'quality').every((l) => /GB/.test(l)), true, l => l);
});

test('sizes are probed once per URL, not on every menu open', async () => {
  const { doc, window, effects } = load(seriesPage(), { fileSize: 1_000_000_000 });
  await settle();
  deliver(window, { url: streamList.plain });

  el(doc, 'qualityPick').click();
  await settle(5);
  const first = effects.headRequests.length;

  el(doc, 'qualityPick').click();
  el(doc, 'qualityPick').click();
  await settle(5);

  assert.equal(effects.headRequests.length, first, 'cached');
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

// -------------------------------------------------- batch: whole-show run ----
// Two seasons, so a run has to roll over from the end of one into the next.

const SHOW = () => seriesPage({
  seasons: ['1', '2'],
  episodes: { 1: ['1', '2'], 2: ['1', '2'] },
  activeSeason: '1',
  activeEpisode: '1',
});

const batchBox = (doc) => el(doc, 'batch');

/** Poll until a condition holds; batch work is spread over real timers. */
async function until(fn, timeout = 9000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (fn()) return true;
    await settle(25);
  }
  return false;
}

const startFrom = (doc, season, episode) => {
  el(doc, 'bSeason').value = season;
  el(doc, 'bSeason').dispatchEvent(new doc.defaultView.Event('change'));
  el(doc, 'bEpisode').value = episode;
  el(doc, 'bEpisode').dispatchEvent(new doc.defaultView.Event('change'));
  el(doc, 'bStart').click();
};

test('the batch panel is offered on a show and withheld from a film', async () => {
  const show = load(SHOW(), { url: SERIES_URL, gmDownload: true, autoStream: true });
  await settle();
  assert.equal(batchBox(show.doc).hidden, false);

  const film = load(filmPage(), { gmDownload: true });
  await settle();
  assert.equal(batchBox(film.doc).hidden, true, 'no queue panel on a film');
});

test('the queue runs to the end of the show, crossing into the next season', async () => {
  const { doc, effects } = load(SHOW(), { url: SERIES_URL, gmDownload: true, autoStream: true });
  await settle();

  startFrom(doc, '1', '2');
  await until(() => /finished/i.test(batchBox(doc).textContent));

  assert.deepEqual(effects.finished, [
    'Great.Teacher.1998.S01E02.720p.mp4',
    'Great.Teacher.1998.S02E01.720p.mp4',
    'Great.Teacher.1998.S02E02.720p.mp4',
  ], 'from the chosen episode onward, in broadcast order');
});

test('the starting point is respected', async () => {
  const { doc, effects } = load(SHOW(), { url: SERIES_URL, gmDownload: true, autoStream: true });
  await settle();

  startFrom(doc, '2', '2');
  await until(() => /finished/i.test(batchBox(doc).textContent));

  assert.deepEqual(effects.finished, ['Great.Teacher.1998.S02E02.720p.mp4'], 'only the last one');
});

test('each episode gets its own freshly resolved URL', async () => {
  const { doc, effects } = load(SHOW(), { url: SERIES_URL, gmDownload: true, autoStream: true });
  await settle();
  const before = effects.xhrs.length;

  startFrom(doc, '2', '1');
  await until(() => /finished/i.test(batchBox(doc).textContent));

  const asked = effects.xhrs.slice(before).map((x) => x.body);
  assert.equal(asked.length, 2, 'one request per episode, none batched up front');
  assert.match(asked[0], /season=2&episode=1/);
  assert.match(asked[1], /season=2&episode=2/);
  assert.deepEqual(effects.downloads.map((d) => d.url), [
    'https://cdn.example.net/s2e1.mp4',
    'https://cdn.example.net/s2e2.mp4',
  ], 'each download uses that episode’s own URL');
});

test('only one download is ever in flight', async () => {
  let peak = 0, live = 0;
  const { doc } = load(SHOW(), {
    url: SERIES_URL,
    autoStream: true,
    gmDownload: (opts) => {
      live++; peak = Math.max(peak, live);
      queueMicrotask(() => { live--; });
      return 'ok';
    },
  });
  await settle();

  startFrom(doc, '1', '1');
  await until(() => /finished/i.test(batchBox(doc).textContent));

  assert.equal(peak, 1, 'strictly sequential');
});

test('a failing episode is retried, recorded, and does not stop the rest', async () => {
  const { doc, effects } = load(SHOW(), {
    url: SERIES_URL,
    autoStream: true,
    gmDownload: (opts) => (/S02E01/.test(opts.name) ? 'fail' : 'ok'),
  });
  await settle();

  startFrom(doc, '1', '2');
  await until(() => /finished/i.test(batchBox(doc).textContent));

  const attempts = effects.downloads.filter((d) => /S02E01/.test(d.name)).length;
  assert.equal(attempts, 2, 'retried once before giving up');
  assert.deepEqual(effects.finished, [
    'Great.Teacher.1998.S01E02.720p.mp4',
    'Great.Teacher.1998.S02E02.720p.mp4',
  ], 'the queue carried on past the failure');
  assert.match(batchBox(doc).textContent, /1 failed/);
});

test('failed episodes can be retried afterwards', async () => {
  let failing = true;
  const { doc, effects } = load(SHOW(), {
    url: SERIES_URL,
    autoStream: true,
    gmDownload: (opts) => (failing && /S01E01/.test(opts.name) ? 'fail' : 'ok'),
  });
  await settle();

  startFrom(doc, '1', '1');
  await until(() => /finished/i.test(batchBox(doc).textContent));
  assert.match(batchBox(doc).textContent, /failed/);

  failing = false;
  el(doc, 'bRetry').click();
  await until(() => /finished/i.test(batchBox(doc).textContent) && !/failed/.test(batchBox(doc).textContent));

  assert.equal(effects.finished.includes('Great.Teacher.1998.S01E01.720p.mp4'), true);
});

test('pausing stops the queue and resuming carries on', async () => {
  const { doc, effects } = load(SHOW(), { url: SERIES_URL, gmDownload: true, autoStream: true });
  await settle();

  startFrom(doc, '1', '1');
  await until(() => effects.finished.length >= 1);
  el(doc, 'bPause').click();

  await until(() => /Paused/.test(batchBox(doc).textContent));
  const atPause = effects.finished.length;
  await settle(400);
  assert.equal(effects.finished.length, atPause, 'nothing new starts while paused');

  el(doc, 'bResume').click();
  await until(() => /finished/i.test(batchBox(doc).textContent));
  assert.equal(effects.finished.length, 4, 'all four eventually');
});

test('stopping clears the queue and the saved progress', async () => {
  const { doc, window, effects } = load(SHOW(), { url: SERIES_URL, gmDownload: true, autoStream: true });
  await settle();

  startFrom(doc, '1', '1');
  await until(() => effects.finished.length >= 1);
  el(doc, 'bStop').click();

  const done = effects.finished.length;
  await settle(400);
  assert.equal(effects.finished.length, done, 'no further downloads');
  assert.match(batchBox(doc).textContent, /Download in order/, 'back to the start screen');
  assert.equal(window.localStorage.getItem('rzk.batch'), 'null', 'saved run cleared');
});

test('an interrupted run comes back paused and never restarts by itself', async () => {
  const saved = {
    id: '91371',
    translator: '57',
    index: 1,
    state: 'paused',
    items: [
      { season: '1', episode: '1', status: 'done', error: '' },
      { season: '1', episode: '2', status: 'pending', error: '' },
      { season: '2', episode: '1', status: 'pending', error: '' },
    ],
  };
  const { doc, effects } = load(SHOW(), {
    url: SERIES_URL, gmDownload: true, autoStream: true, storage: { 'rzk.batch': saved },
  });
  await settle(300);

  assert.equal(effects.downloads.length, 0, 'nothing downloads without a click');
  assert.match(batchBox(doc).textContent, /Paused/, 'restored in the paused state');
  assert.match(batchBox(doc).textContent, /1 \/ 3/, 'the finished episode is remembered');

  el(doc, 'bResume').click();
  await until(() => /finished/i.test(batchBox(doc).textContent));
  assert.deepEqual(effects.finished, [
    'Great.Teacher.1998.S01E02.720p.mp4',
    'Great.Teacher.1998.S02E01.720p.mp4',
  ], 'picks up exactly where it stopped');
});

test('without GM_download the queue is refused with a reason', async () => {
  const { doc } = load(SHOW(), { url: SERIES_URL, autoStream: true });
  await settle();

  assert.match(batchBox(doc).textContent, /Unavailable/);
  assert.match(batchBox(doc).textContent, /GM_download/);
  assert.equal(el(doc, 'bStart'), null, 'no start button to press');
});

test('the queue honours the chosen quality', async () => {
  const { doc, effects } = load(SHOW(), { url: SERIES_URL, gmDownload: true, autoStream: true });
  await settle();

  pick(doc, 'quality', '360p')?.click();
  startFrom(doc, '2', '2');
  await until(() => /finished/i.test(batchBox(doc).textContent));

  assert.equal(effects.downloads.at(-1).url, 'https://cdn.example.net/s2e2_lo.mp4');
  assert.match(effects.downloads.at(-1).name, /360p\.mp4$/);
});

// ---------------------------------------------------------------- english ----

test('the interface itself is in English', async () => {
  const { doc } = load(seriesPage(), { url: SERIES_URL });
  await settle();

  const chrome = shadow(doc).textContent;
  assert.equal(/[А-Яа-яЇїІіЄєҐґ]/.test(text(doc, '.bar')), false, 'no Cyrillic in the top bar');
  assert.match(chrome, /Voice/);
  assert.match(chrome, /Quality/);
  assert.match(chrome, /Download/);
  assert.match(chrome, /Copy link/);
});

test('the glossary turns the closed vocabulary into English', async () => {
  const { doc } = load(seriesPage(), { url: SERIES_URL });
  await settle();

  const facts = text(doc, '.facts');
  assert.match(facts, /Japan/, 'country');
  assert.match(facts, /Comedy, Drama/, 'genre list, each term mapped');

  const table = text(doc, '.meta dl');
  assert.match(table, /Country/, 'table heading');
  assert.match(table, /Genre/);
});

test('an age rating keeps only the part that means anything', async () => {
  const { doc } = load(filmPage(), { url: 'https://rezka-ua.tv/films/drama/55330-x-2007.html' });
  await settle();

  const table = text(doc, '.meta dl');
  assert.match(table, /Age rating/);
  assert.doesNotMatch(table, /только для взрослых/, 'the prose after the number is dropped');
});

test('voiceover names translate their vocabulary and leave studio names alone', async () => {
  const { doc } = load(seriesPage({
    translators: [
      { id: '1', name: 'Многоголосый закадровый', active: true },
      { id: '2', name: 'Оригинал (+субтитры)' },
      { id: '3', name: 'Дубляж HDrezka Studio' },
    ],
  }), { url: SERIES_URL });
  await settle();

  const labels = optionLabels(doc, 'voice');
  const has = (s) => labels.some((l) => l.includes(s));
  assert.equal(has('Multi-voice VO'), true, labels.join(' | '));
  assert.equal(has('Original (+subtitles)'), true, 'flag prefix aside, the words translate');
  assert.equal(has('Dubbed HDrezka Studio'), true, 'the studio name survives');
  assert.equal(labels.some((l) => /[А-Яа-я]/.test(l)), false, 'no Russian left in the list');
});

test('seasons and episodes are labelled in English without reading the page text', async () => {
  const { doc } = load(seriesPage(), { url: SERIES_URL });
  await settle();

  assert.equal(value(doc, 'season'), 'Season 2');
  assert.deepEqual(optionLabels(doc, 'season'), ['Season 1', 'Season 2']);
});

test('the synopsis is translated on device when the browser can', async () => {
  const { doc } = load(seriesPage(), { url: SERIES_URL, translator: true });
  await settle(80);

  assert.equal(text(doc, '.synopsis'), '[en] Краткое описание сериала.');
  assert.equal(el(doc, 'synopsis').title, 'Краткое описание сериала.', 'original kept for reference');
});

test('the synopsis stays as-is when no translator exists', async () => {
  const { doc } = load(seriesPage(), { url: SERIES_URL });
  await settle(80);

  assert.match(text(doc, '.synopsis'), /Краткое описание сериала/, 'original rather than a gap');
});

test('nothing is sent anywhere to translate', async () => {
  const { doc, effects } = load(seriesPage(), { url: SERIES_URL, translator: true });
  await settle(80);

  const offsite = effects.xhrs.filter((x) => /^https?:/.test(x.url || ''));
  assert.equal(offsite.length, 0, 'translation is on-device only');
  assert.equal(effects.headRequests.length, 0);
});

// -------------------------------------------------------------- navigation ----

test('the header carries a logo and the catalogue links', async () => {
  const { doc } = load(gridPage(), { url: CATALOG_URL });
  await settle();

  assert.ok(shadow(doc).querySelector('.brand .mark'), 'logo mark rendered');
  assert.equal(text(doc, '.brand .word'), 'Rezka');

  assert.deepEqual(
    all(doc, '.nav a').map((a) => [a.textContent.trim(), a.getAttribute('href')]),
    [
      ['Films', '/films/'],
      ['Series', '/series/'],
      ['Top films', '/films/best/'],
      ['Top shows', '/series/best/'],
    ]
  );
});

test('the current section is marked, longest match winning', async () => {
  const top = load(gridPage(), { url: 'https://rezka-ua.tv/films/best/' });
  await settle();
  assert.equal(
    all(top.doc, '.nav a[aria-current="page"]').map((a) => a.textContent.trim()).join(),
    'Top films',
    '/films/best/ is Top films, not Films'
  );

  const plain = load(gridPage(), { url: 'https://rezka-ua.tv/films/' });
  await settle();
  assert.equal(
    all(plain.doc, '.nav a[aria-current="page"]').map((a) => a.textContent.trim()).join(),
    'Films'
  );
});

test('navigation is present on a watch page too', async () => {
  const { doc } = load(seriesPage(), { url: SERIES_URL });
  await settle();

  assert.equal(all(doc, '.nav a').length, 4);
  assert.equal(all(doc, '.nav a[aria-current="page"]').length, 1, 'series section marked');
});

test('the takeover beats the site\'s own !important body padding', async () => {
  // The real stylesheet has body.active-brand.pp{padding-top:250px!important},
  // which no selector of ours can outrank — only an inline declaration can.
  const { doc } = load(seriesPage(), { url: SERIES_URL });
  await settle();

  const body = doc.body;
  assert.match(body.style.getPropertyValue('padding'), /^0(px)?$/);
  assert.equal(body.style.getPropertyPriority('padding'), 'important', 'priority is the whole point');
  assert.equal(body.style.getPropertyPriority('margin'), 'important');
});

test('stepping aside hands the body back exactly as it was', async () => {
  const html = seriesPage().replace('<body>', '<body style="padding-top: 250px; color: red">');
  const { doc } = load(html, { url: SERIES_URL });
  await settle();
  assert.equal(doc.body.style.getPropertyPriority('padding'), 'important', 'held while ours is up');

  el(doc, 'restore').click();

  assert.equal(doc.body.getAttribute('style'), 'padding-top: 250px; color: red', 'restored verbatim');
});

test('the batch progress bar does not reuse the header\'s class', async () => {
  const { doc, window } = load(seriesPage(), {
    url: SERIES_URL, gmDownload: true, autoStream: true,
  });
  await settle();

  el(doc, 'bStart').click();
  await settle(60);

  assert.ok(shadow(doc).querySelector('.batch .progress'), 'scoped progress bar');
  assert.equal(shadow(doc).querySelectorAll('.batch .bar').length, 0, 'no collision with .bar');
  const header = shadow(doc).querySelector('.bar');
  assert.ok(header && header.classList.contains('bar'), 'header keeps .bar to itself');
});
