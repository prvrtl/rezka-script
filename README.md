# Rezka Downloader

A userscript that pulls the direct video URL out of HDrezka player pages and gives you a small panel to download it, copy the link, or hand it off to Leech.

The site's player only ever exposes the stream list in an AJAX response, so grabbing a file normally means digging through devtools. This does that part for you and picks the highest quality that isn't locked behind PRO.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open [`rezka-downloader.user.js`](https://raw.githubusercontent.com/prvrtl/rezka-script/main/rezka-downloader.user.js) — the extension will offer to install it.

Updates come from this repo, so the extension will pick up new versions on its own.

## Usage

Open any movie or episode page. A round button sits in the bottom-right corner, with a blue
dot on it once a file is ready to pull. Click it for the panel:

```
┌──────────────────────────────┐
│  Quality              1080p ⌄│
│  Voice          🇺🇦 Українська ⌄│
│  ────────────────────────────│
│  [  ↓  Download            ] │
│      Copy link  ·  Leech     │
└──────────────────────────────┘
```

That's the whole interface. The two rows open a menu only when there's more than one thing
to choose between, otherwise they sit inert — no lists of chips to read past, no title
repeated back at you, and no status line unless something actually needs saying.

- **Quality** — every free quality, best first. Your pick is remembered and reused on later releases that offer it.
- **Voice** — switching clicks the site's own tab, so the player follows along and the stream list refreshes.
- **Download** — saves as `Title.Year.S01E02.1080p.mp4`, built from the original-language title and the active season/episode tabs.
- **Copy link** — puts the raw stream URL on the clipboard.
- **Leech** — rewrites the URL to a `secureleech://` handler and copies the filename, since Leech can't take a name over the URL scheme.

`Esc` closes an open menu, then the panel.

On load the script prefers a Ukrainian voiceover when one exists, and moves off a PRO-only track to a free one if the page defaults to premium.

## Supported sites

`rezka-ua.tv`, `hdrezka.me`, `hdrezka.co`, `rezka.ag`, `hello-rezka.tv`, plus a wildcard `@include` for other mirrors that keep `rezka` in the hostname.

## How it's put together

Four layers, in one file:

| layer | job |
| --- | --- |
| `site` | every selector that knows HDrezka's markup — the only part a site redesign touches |
| `api` | the `/ajax/get_cdn_series/` call, parsing the quality list, ranking labels |
| `store` | what's loaded and what's selected, with subscribers re-rendering on change |
| `ui` | the panel, rendered into a shadow root |

[`API.md`](API.md) documents the endpoint, the quality-list format and the DOM contracts the
`site` layer depends on, including what's assumed but unverified.

The UI renders into an open shadow root, so the site's stylesheet can't reach the panel and
the panel's rules can't restyle the site — the previous version styled every `<hr>` on the
page, not just its own.

## Notes

- PRO qualities are skipped deliberately — those URLs 403 without a subscription, so offering them would just produce broken downloads.
- Streams are read two ways: an inline `<script>` on first paint, and an `XMLHttpRequest` hook on `/ajax/get_cdn_series/` for anything loaded later. If neither lands within ~1.5s the script requests the list itself, and says so if that fails too rather than sitting on "Waiting".
- Downloads go through `GM_download` when the manager grants it. The plain `<a download>` fallback still works, but browsers ignore the `download` attribute on cross-origin URLs, so under the fallback the file lands with whatever name the CDN gave it.
- Quality labels are ranked by what they mean, not by the first number in them — `4K` sorts above `720p` instead of below `360p`.
- HLS manifests are stripped down to the plain MP4 URL (`:hls:manifest.m3u8` suffix removed).
- If the site changes its class names (`b-translator__item`, `b-simple_episode__item`, etc.) the panel will show up but stay empty.

Previously published on [Greasy Fork](https://greasyfork.org/en/scripts/580540-rezka-downloader).

## Development

The tests run the real `.user.js` inside a jsdom document shaped like an HDrezka page, with the `GM_*` API and `XMLHttpRequest` stubbed, so they exercise the shipped file rather than a copy of its logic. Assertions go through the shadow root, the same way a user sees it.

```
npm install
npm test
```

`test/fixtures.mjs` holds the page markup and the CDN payload formats; add a case there when the site changes shape.

## License

MIT — see [LICENSE](LICENSE).
