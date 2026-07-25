# HDrezka player API

What the script depends on. Everything here is derived from the working 1.x script and
the request/response shapes it handles — it is not a published or stable API, and the
site changes it without notice.

## Stream endpoint

```
POST /ajax/get_cdn_series/
Content-Type: application/x-www-form-urlencoded
```

| field | value |
| --- | --- |
| `id` | content id — the `#post_id` input, or the first `[data-id]` on the page |
| `translator_id` | voiceover id, from `data-translator_id` on a translator tab |
| `action` | `get_stream` when the page has episode tabs, otherwise `get_movie` |
| `season` | active season's `data-tab_id`, `1` on films |
| `episode` | active episode's `data-episode_id`, `1` on films |

Response is JSON:

```json
{ "success": true, "url": "[360p]https://…mp4,[720p]https://…mp4", "message": "" }
```

`success: false` comes back with an empty `url` and a reason in `message`. The request is
same-origin and relies on the page's own cookies, so it only works from a real session on
the site.

## Quality list format

`url` is a single string holding every quality, comma-separated, each entry `[label]target`:

- The comma separator only counts when followed by `[` — labels and URLs may contain commas.
- A label can carry markup. PRO tiers arrive wrapped in `<span class="pjs-prem-quality">`,
  which is the only reliable premium marker; the visible text sometimes also says `PRO`.
- A target may list alternates separated by ` or ` — the first is the one to use.
- A target may carry a `:hls:manifest.m3u8` suffix; stripping it yields the plain MP4.
- Labels are not normalised: `1080p`, `1080p Ultra` and `4K` all occur, so ranking on the
  first number in the string is wrong (`4K` parses as `4`).

## First paint

The stream list for the default voiceover is inlined in a `<script>` on the initial HTML,
so it can be read without a request. The same script carries the translator id, in one of
`translator_id`, `"translator_id":`, or `initCDNMoviesEvents(<id>, <translator_id>, …)`.
Values there are escaped (`>`, backslashes), so they need unescaping before parsing.

Anything after first paint — switching voiceover, season or episode — goes through the
endpoint above. Hooking `XMLHttpRequest` means those responses can be reused instead of
issuing a second identical request.

## DOM contracts

| selector | used for |
| --- | --- |
| `#post_id` / `[data-id]` | content id; absence means the page isn't watchable |
| `.b-post__origtitle` | original-language title, `Локализованное / Original` |
| `meta[property="og:title"]` | release year, as `(YYYY)` |
| `.b-translator__item[data-translator_id]` | voiceover tabs; `.active` is current |
| `.b-prem_translator` | marks a voiceover as premium-only |
| `.b-simple_season__item[data-tab_id]` | season tabs; `.active` is current |
| `.b-simple_episode__item[data-episode_id]` | episode tabs; `.active` is current |
| `.b-post__info tr` with `td.l` = `В переводе` | film pages carry no tabs — the single translation is named here |

Films have no translator or episode tabs at all; the script falls back to the info table
for a display name and scrapes the translator id out of the inline script.

## Unverified

The live site currently sits behind a bot check, so the following could not be confirmed
first-hand and are deliberately not relied on:

- whether `url` is ever returned obfuscated (historically it has been, base64 chunks joined
  by `//_//` with junk padding, requiring a decode pass before parsing)
- subtitle fields (`subtitle`, `subtitle_lns`, `subtitle_def`) on the same response
- `/ajax/get_episodes/` for building a full season/episode map without clicking tabs

If any of these matter, confirm them against a real session before coding to them.
