# Rezka Downloader

A userscript that replaces the HDrezka interface. It keeps their backend and throws away
their front end: a native `<video>` player on the direct file, a clean catalog, and the
original download/copy/Leech actions the script started life as.

The site already hands the browser plain MP4 URLs — everything here is built on data the
page exposes to you anyway.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open [`rezka-downloader.user.js`](https://raw.githubusercontent.com/prvrtl/rezka-script/main/rezka-downloader.user.js) — the extension will offer to install it.

Updates come from this repo, so the extension picks up new versions on its own.

## What it replaces

**Watch pages.** Title, original title, and a facts line (rating, year, country, genre,
runtime) above a real video element playing the direct file — no Premium banner, no player
chrome you didn't ask for. Under it: voice, season and quality pickers, an episode grid,
and Download / Ссылка / Leech. Synopsis and the info table sit below.

**Navigation.** The header carries the logo, four links — Films, Series, Top films,
Top shows — and the search box. The top lists are the site's own `/films/best/` and
`/series/best/`, not an invented sort parameter. The current section is marked, with the
longest match winning so `/films/best/` reads as *Top films* rather than *Films*.

**Catalog and search.** The same card everywhere: cover, kind badge, title, and the
`1996, США, Фантастика` line. Covers load lazily, pagination is carried through, and the
search box in the header submits to the site's own search.

Anything else — a profile page, a collection, the forum — is left completely alone. The
takeover only fires on pages it can actually render, and never blanks a page it can't.

**Escape hatch:** *Original site* in the header removes the new UI and restores theirs.
The original DOM is only ever hidden, never deleted, so the site's own scripts keep running
underneath and nothing is lost. The `<body>` box is a special case: the site ships
`body.active-brand.pp { padding-top: 250px !important }`, which no stylesheet selector of
ours can outrank, so the padding and margin are held with an inline `!important`
declaration and handed back verbatim when the UI steps aside.

## Language

The interface is in English, and the site's own text is brought across in three tiers,
best first — nothing leaves your machine at any of them:

1. **The site already knows.** Titles carry an original-language name in
   `itemprop=alternativeHeadline`, so shows lead with their real English title
   (*Great Teacher Onizuka*, not a machine's guess at it) with the local name underneath.
   Films that genuinely have no English title keep their own.
2. **A glossary.** Genres, countries, table headings, age ratings, runtimes and voiceover
   types are a closed vocabulary that repeats on every page, so they are mapped exactly
   and instantly — `Комедии, Драмы` → `Comedy, Drama`, `93 мин.` → `93 min`. Voiceover
   names substitute known phrases while leaving studio names alone, so
   `Дубляж HDrezka Studio` becomes `Dubbed HDrezka Studio`. Seasons and episodes are
   labelled from their ids and never read as text at all.
3. **On-device translation.** Chrome's `Translator` API handles the only free prose left,
   the synopsis. This is best-effort: the browser has to have downloaded the ru→en model,
   which needs Chrome 138+ and a user gesture. Until then — or for good, if the API is
   absent — the original Russian stays on screen rather than leaving a gap, with the
   source text on the element's `title`.

Catalog cards get tier 2 as well, so `1996, США, Фантастика` reads `1996, USA, Sci-Fi`.
Item titles themselves are left as the site wrote them.

## Reading the page

The site is free to restyle whenever it likes, so the script reads whatever will
outlive a redesign, in this order:

| source | why it lasts |
| --- | --- |
| the URL | changing it breaks the site's own links |
| `og:*` and `itemprop` | changing it breaks their search ranking |
| `data-*` attributes | the site's own scripts depend on them |
| CSS class names | free to change at any time — used only as a last resort |

Every field walks that chain and takes the first answer. The content id comes out of
the URL, the title and poster from microdata, the runtime from `og:duration`, and
voiceovers, seasons and episodes from `data-translator_id` / `data-tab_id` /
`data-episode_id`. A test renders the entire UI against a page with **every structural
class renamed** and asserts it still works.

Two class-name dependencies genuinely remain, because no attribute equivalent exists:
`active` to mark the current tab, and a class containing `prem` to mark a PRO-only
voiceover. If those change, the PRO filter is what degrades.

## Downloading a whole show

On a series page, a panel under the episodes queues everything from a chosen point to
the end of the show:

```
Скачать по порядку
С сезона [2 ⌄]  серии [5 ⌄]        [ ↓ Начать ]
34 серии · до конца сериала · 1080p
```

It runs one episode at a time, rolls into the next season automatically, and shows the
current episode with a progress bar, a `12 / 34` tally and a failure count. **Пауза**
stops after the episode in flight, **Пропустить** abandons the current one and moves on,
**Стоп** clears the queue.

What makes it reliable rather than a for-loop:

- **URLs are resolved per episode, immediately before its own download.** Stream links
  carry an expiry stamp, so resolving the whole show up front would hand you a queue of
  links that die halfway through.
- **A failure never stops the run.** The stream request is retried three times and the
  download twice; if it still fails, the episode is recorded and the queue moves on. A
  **Повторить неудачные** button re-queues just those at the end.
- **Progress is saved after every episode.** Closing the tab loses at most the episode in
  flight, and the run comes back *paused* — it never resumes without a click.
- **Strictly one at a time**, with a short gap between episodes.

This needs `GM_download`, because sequencing requires knowing when a file finished.
Without it the panel says so rather than misbehaving quietly.

## Stream speed

While something is playing, a readout under the player shows how much cushion there
is: seconds buffered ahead of the playhead, the fill rate, and — where the file size
is reachable — throughput in Мбит/с and the total size.

Buffer depth is what predicts a stall, not fill rate. CDNs commonly pace delivery to
roughly real time once the player is comfortable, so a healthy stream sits at 1.0×
indefinitely; judging on rate alone reports a false failure. A deep buffer is treated
as sufficient on its own, and so is a fast fill.

Opening the quality menu labels each option with its file size, so picking 720p over
1080p is an informed choice. That costs one `HEAD` per quality, asked once and cached,
and only when the menu is actually open. Sizes need `GM_xmlhttpRequest`; without it the
cushion readout still works, just without absolute figures.

## The player

Plays the direct MP4 with keyboard control (`space`/`k`, `←`/`→`, `f`, `m`), a buffer bar,
volume, fullscreen, and resume-where-you-left-off per episode. Finishing an episode rolls
into the next one.

Some releases are only served as HLS. A plain `<video>` can't play those without an MSE
layer, so instead of showing a dead frame the script says so and hands playback back to
the site's own player.

- **Quality** — free tiers only, best first, and your pick is remembered across releases.
- **Download** — saves as `Title.Year.S01E02.1080p.mp4`, via `GM_download` so the name survives.
- **Ссылка** — the raw stream URL on the clipboard.
- **Leech** — rewrites to `secureleech://` and copies the filename, which Leech can't take over the URL scheme.

On load it prefers a Ukrainian voiceover when one exists, and moves off a PRO-only track.

## Supported sites

`rezka-ua.tv`, `hdrezka.me`, `hdrezka.co`, `rezka.ag`, `hello-rezka.tv`, plus a wildcard
`@include` for other mirrors that keep `rezka` in the hostname.

## How it's put together

| layer | job |
| --- | --- |
| `site` | reads the page — URL, meta, microdata, `data-*`, then classes |
| `api` | `/ajax/get_cdn_series/`, parsing the quality list, ranking labels |
| `store` | what's loaded and selected, keyed by voice + season + episode |
| `player` | the `<video>` element and its chrome |
| `i18n` | glossary and on-device translation |
| `speed` | buffer cushion, throughput and file sizes |
| `batch` | the whole-show download queue |
| `views` | watch and grid, rendered into a shadow root |

[`API.md`](API.md) documents the endpoint, the quality-list grammar and the DOM contracts,
including what's assumed but unverified.

The UI renders into an open shadow root, so the site's stylesheet can't reach it and its
own rules can't leak out. Exactly one global rule exists — the one hiding the original
page — and it only applies after the new UI has successfully mounted.

## Development

```
npm install
npm test
```

The tests run the real `.user.js` inside a jsdom document shaped like an HDrezka page, with
the `GM_*` API, `XMLHttpRequest` and the media element stubbed, so they exercise the
shipped file rather than a copy of its logic.

Fixtures in `test/fixtures.mjs` mirror the structure of real pages — the selectors,
attributes and nesting are the site's; the text is invented, so none of their catalogue is
checked in here.

Verify against the live site — this loads the real `.user.js` into real pages and
checks the UI mounts, streams resolve, and video actually plays:

```
node tools/verify.mjs
```

When the site changes shape, re-derive the contracts:

```
node tools/capture.mjs watch=<url> catalog=<url> search=<url>
node tools/inspect.mjs
```

`capture.mjs` drives a headed browser on a persistent profile and saves pages to
`fixtures/raw/` (gitignored). If the site's bot check appears it stops and waits for you to
clear it in the window — it does not try to solve or evade it, and neither does
`verify.mjs`. `inspect.mjs` then prints which sources still answer.

## Notes

- PRO qualities are skipped deliberately — those URLs 403 without a subscription.
- Streams are read three ways: an inline `<script>` on first paint, an `XMLHttpRequest` hook on `/ajax/get_cdn_series/` that reuses the site's own request, and a direct call when neither lands.
- Quality labels are ranked by meaning, not by the first number in them — `4K` sorts above `720p` rather than below `360p`.
- Switching episode drops the cached stream; the previous episode's URL is never offered for the new one.

Previously published on [Greasy Fork](https://greasyfork.org/en/scripts/580540-rezka-downloader).

## License

MIT — see [LICENSE](LICENSE).
