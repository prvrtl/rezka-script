# Rezka Downloader

A userscript that pulls the direct video URL out of HDrezka player pages and gives you a small panel to download it, copy the link, or hand it off to Leech.

The site's player only ever exposes the stream list in an AJAX response, so grabbing a file normally means digging through devtools. This does that part for you and picks the highest quality that isn't locked behind PRO.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open [`rezka-downloader.user.js`](https://raw.githubusercontent.com/prvrtl/rezka-script/main/rezka-downloader.user.js) — the extension will offer to install it.

Updates come from this repo, so the extension will pick up new versions on its own.

## Usage

Open any movie or episode page. A "Rezka DL" pill appears in the bottom-right corner; click it to expand the panel.

- **Voiceover chips** — switch translation. Selecting one clicks the site's own tab, so the player follows along and the stream list refreshes.
- **Quality chips** — every free quality, best first. The top one is preselected; pick a smaller file if you'd rather. Your choice carries over when you switch voiceover, as long as that track offers it.
- **Download** — saves the file with a sensible name: `Title.Year.S01E02.1080p.mp4`, built from the original-language title and the active season/episode tabs.
- **Leech** — rewrites the URL to a `secureleech://` handler and copies the filename to your clipboard, since Leech doesn't accept a name over the URL scheme.
- **Copy** — puts the raw stream URL on the clipboard.

On load the script prefers a Ukrainian voiceover when one exists, and moves off a PRO-only track to a free one if the page defaults to premium.

## Supported sites

`rezka-ua.tv`, `hdrezka.me`, `hdrezka.co`, `rezka.ag`, `hello-rezka.tv`, plus a wildcard `@include` for other mirrors that keep `rezka` in the hostname.

## Notes

- PRO qualities are skipped deliberately — those URLs 403 without a subscription, so offering them would just produce broken downloads.
- Streams are read two ways: an inline `<script>` on first paint, and an `XMLHttpRequest` hook on `/ajax/get_cdn_series/` for anything loaded later. If neither lands within ~1.5s the script requests the list itself, and says so if that fails too rather than sitting on "Waiting".
- Downloads go through `GM_download` when the manager grants it. The plain `<a download>` fallback still works, but browsers ignore the `download` attribute on cross-origin URLs, so under the fallback the file lands with whatever name the CDN gave it.
- Quality labels are ranked by what they mean, not by the first number in them — `4K` sorts above `720p` instead of below `360p`.
- HLS manifests are stripped down to the plain MP4 URL (`:hls:manifest.m3u8` suffix removed).
- If the site changes its class names (`b-translator__item`, `b-simple_episode__item`, etc.) the panel will show up but stay empty.

Previously published on [Greasy Fork](https://greasyfork.org/en/scripts/580540-rezka-downloader).

## Development

The tests run the real `.user.js` inside a jsdom document shaped like an HDrezka page, with the `GM_*` API and `XMLHttpRequest` stubbed, so they exercise the shipped file rather than a copy of its logic.

```
npm install
npm test
```

`test/fixtures.mjs` holds the page markup and the CDN payload formats; add a case there when the site changes shape.

## License

MIT — see [LICENSE](LICENSE).
