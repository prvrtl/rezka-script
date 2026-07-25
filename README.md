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

**Catalog and search.** The same card everywhere: cover, kind badge, title, and the
`1996, США, Фантастика` line. Covers load lazily, pagination is carried through, and the
search box in the header submits to the site's own search.

Anything else — a profile page, a collection, the forum — is left completely alone. The
takeover only fires on pages it can actually render, and never blanks a page it can't.

**Escape hatch:** *Оригинальный сайт* in the header removes the new UI and restores theirs.
The original DOM is only ever hidden, never deleted, so the site's own scripts keep running
underneath and nothing is lost.

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
| `site` | every selector that knows HDrezka's markup — the only part a redesign touches |
| `api` | `/ajax/get_cdn_series/`, parsing the quality list, ranking labels |
| `store` | what's loaded and selected, keyed by voice + season + episode |
| `player` | the `<video>` element and its chrome |
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

When the site changes shape, re-derive the contracts:

```
node tools/capture.mjs watch=<url> catalog=<url> search=<url>
node tools/inspect.mjs
```

`capture.mjs` drives a headed browser on a persistent profile and saves pages to
`fixtures/raw/` (gitignored). If the site's bot check appears it stops and waits for you to
clear it in the window — it does not try to solve or evade it. `inspect.mjs` then prints
which selectors still match.

## Notes

- PRO qualities are skipped deliberately — those URLs 403 without a subscription.
- Streams are read three ways: an inline `<script>` on first paint, an `XMLHttpRequest` hook on `/ajax/get_cdn_series/` that reuses the site's own request, and a direct call when neither lands.
- Quality labels are ranked by meaning, not by the first number in them — `4K` sorts above `720p` rather than below `360p`.
- Switching episode drops the cached stream; the previous episode's URL is never offered for the new one.

Previously published on [Greasy Fork](https://greasyfork.org/en/scripts/580540-rezka-downloader).

## License

MIT — see [LICENSE](LICENSE).
