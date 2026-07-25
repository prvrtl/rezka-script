// ==UserScript==
// @name           Rezka Downloader
// @namespace      https://greasyfork.org/en/users/1458606-saarmaat
// @version        3.0
// @description    Replaces the HDrezka interface with a clean one: native player on direct links, plus downloads, copied links and Leech integration.
// @author         Roman (saarmaat) <gargle_sower_4w@icloud.com>
// @supportURL     mailto:gargle_sower_4w@icloud.com
// @license        MIT
// @match          https://rezka-ua.tv/*
// @match          https://hdrezka.me/*
// @match          https://hdrezka.co/*
// @match          https://rezka.ag/*
// @match          https://hello-rezka.tv/*
// @include        http*://*rezka*/*
// @include        http*://hdrezka*/*
// @grant          GM_setClipboard
// @grant          GM_download
// @grant          GM_getValue
// @grant          GM_setValue
// @run-at         document-start
// @homepageURL    https://github.com/prvrtl/rezka-script
// @downloadURL    https://raw.githubusercontent.com/prvrtl/rezka-script/main/rezka-downloader.user.js
// @updateURL      https://raw.githubusercontent.com/prvrtl/rezka-script/main/rezka-downloader.user.js
// ==/UserScript==

(function () {
  'use strict';

  const PREF = { quality: 'rzk.quality', skin: 'rzk.skin', pos: 'rzk.pos' };

  const prefs = {
    get(key, fallback) {
      try {
        if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try {
        if (typeof GM_setValue === 'function') GM_setValue(key, value);
        else localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {}
    }
  };

  // ---------------------------------------------------------------- site ----
  // Every selector that knows HDrezka's markup. Derived from real pages saved
  // by tools/capture.mjs; run tools/inspect.mjs when something here stops
  // matching. The original DOM is hidden, never removed — it stays the data
  // source, and the site's own scripts keep working underneath.

  const site = {
    kind() {
      if (document.getElementById('post_id')) return 'watch';
      if (document.querySelector('.b-content__inline_item')) return 'grid';
      return null;
    },

    id() {
      return document.getElementById('post_id')?.value
        || document.querySelector('[data-id]')?.dataset?.id
        || null;
    },

    title() {
      return document.querySelector('.b-post__title h1, h1')?.textContent?.trim() || '';
    },

    // "Локализованное / Original" on some pages, absent entirely on others.
    original() {
      const raw = document.querySelector('.b-post__origtitle')?.textContent?.trim();
      if (!raw) return '';
      return raw.includes('/') ? raw.split('/').pop().trim() : raw;
    },

    poster() {
      return document.querySelector('.b-post__infotable_left img')?.getAttribute('src') || '';
    },

    description() {
      return document.querySelector('.b-post__description_text')?.textContent?.trim() || '';
    },

    rating() {
      const el = document.querySelector('.b-post__rating');
      if (!el) return null;
      const score = el.querySelector('.num')?.textContent?.trim()
        || el.textContent.match(/(\d+[.,]\d+)/)?.[1];
      const votes = el.querySelector('.votes')?.textContent?.replace(/[()\s]/g, '')
        || el.textContent.match(/\((\d[\d\s]*)\)/)?.[1]?.replace(/\s/g, '');
      return score ? { score: String(score).replace(',', '.'), votes: votes || '' } : null;
    },

    // The info table is a plain key/value list; keys vary by content type.
    info() {
      const out = {};
      for (const tr of document.querySelectorAll('.b-post__info tr')) {
        const k = tr.querySelector('td.l')?.textContent?.trim().replace(/:$/, '');
        if (!k) continue;
        const v = tr.querySelector('td:not(.l)')?.textContent?.replace(/\s+/g, ' ').trim();
        if (v) out[k] = v;
      }
      return out;
    },

    year() {
      const meta = document.querySelector('meta[property="og:title"]')?.content;
      const fromMeta = meta?.match(/\((\d{4})\)/)?.[1];
      if (fromMeta) return fromMeta;
      const info = site.info();
      return (info['Год'] || info['Дата выхода'] || '').match(/\d{4}/)?.[0] || '';
    },

    isSeries() {
      return Boolean(document.querySelector('.b-simple_episode__item'));
    },

    translators() {
      return [...document.querySelectorAll('.b-translator__item')].map(el => ({
        id: el.dataset.translator_id,
        name: el.textContent.trim(),
        premium: el.classList.contains('b-prem_translator'),
        active: el.classList.contains('active')
      }));
    },

    // Films, and some series, carry no tabs at all.
    soleTranslator() {
      const row = [...document.querySelectorAll('.b-post__info tr')]
        .find(tr => tr.querySelector('td.l')?.textContent.includes('В переводе'));
      return {
        id: site.scrapeTranslatorId() || 'single',
        name: row?.querySelector('td:not(.l)')?.textContent.trim() || 'Оригинал',
        premium: false,
        active: true
      };
    },

    scrapeTranslatorId() {
      for (const s of document.scripts) {
        const m = s.textContent.match(/(?:translator_id|"translator_id"\s*:|initCDNMoviesEvents\(\s*\d+\s*,\s*)["']?(\d+)["']?/);
        if (m) return m[1];
      }
      return null;
    },

    seasons() {
      return [...document.querySelectorAll('.b-simple_season__item')].map(el => ({
        id: el.dataset.tab_id,
        label: el.textContent.trim(),
        active: el.classList.contains('active')
      }));
    },

    // Episodes carry their own season id, so the whole map is readable without
    // clicking through the site's tabs.
    episodes() {
      const out = {};
      for (const el of document.querySelectorAll('.b-simple_episode__item')) {
        const s = el.dataset.season_id || site.seasons().find(x => x.active)?.id || '1';
        (out[s] ||= []).push({
          id: el.dataset.episode_id,
          label: el.textContent.trim(),
          active: el.classList.contains('active')
        });
      }
      return out;
    },

    // The first-paint stream list for the default voiceover.
    inlineStreams() {
      for (const s of document.scripts) {
        if (s.src) continue;
        const m = s.textContent.match(/(?:["'])(\[(?:1080|720|480|360|2160)p[^\]]*\][^"']+)(?:["'])/);
        if (!m) continue;
        return {
          id: site.scrapeTranslatorId() || 'single',
          raw: m[1].replace(/\\u003e/g, '>').replace(/\\u003c/g, '<').replace(/\\/g, '')
        };
      }
      return null;
    },

    heading() {
      return document.querySelector('.b-content__htitle')?.textContent?.trim() || '';
    },

    cards() {
      return [...document.querySelectorAll('.b-content__inline_item')].map(el => {
        const link = el.querySelector('.b-content__inline_item-link');
        return {
          id: el.dataset.id,
          url: el.dataset.url || link?.querySelector('a')?.href || '',
          cover: el.querySelector('.b-content__inline_item-cover img')?.getAttribute('src') || '',
          kind: [...(el.querySelector('.cat')?.classList || [])].find(c => c !== 'cat') || '',
          entity: el.querySelector('.cat .entity')?.textContent?.trim() || '',
          title: link?.querySelector('a')?.textContent?.trim() || '',
          meta: link?.querySelector('div')?.textContent?.replace(/\s+/g, ' ').trim() || ''
        };
      }).filter(c => c.title && c.url);
    },

    pages() {
      return [...document.querySelectorAll('.b-navigation a')]
        .map(a => ({ label: a.textContent.trim(), url: a.href }))
        .filter(p => p.label);
    }
  };

  // ----------------------------------------------------------------- api ----

  const api = {
    ENDPOINT: '/ajax/get_cdn_series/',

    request({ id, translatorId, season, episode, series }) {
      return new Promise((resolve, reject) => {
        const body = new URLSearchParams({
          id,
          translator_id: translatorId,
          action: series ? 'get_stream' : 'get_movie',
          season: season || 1,
          episode: episode || 1
        });
        const xhr = new XMLHttpRequest();
        xhr.open('POST', api.ENDPOINT);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.onload = () => {
          let data;
          try { data = JSON.parse(xhr.responseText); }
          catch (e) { reject(new Error('Ответ не читается')); return; }
          if (!data.success || !data.url) { reject(new Error(data.message || 'Поток не найден')); return; }
          resolve(api.parse(data.url));
        };
        xhr.onerror = () => reject(new Error('Запрос не прошёл'));
        xhr.send(body.toString());
      });
    },

    // "[360p]a.mp4 or b.mp4,[<span class=pjs-prem-quality>1080p</span>]c.mp4"
    parse(raw) {
      const out = [];
      for (const part of String(raw).split(/,(?=\[)/)) {
        const m = part.match(/^\[([^\]]+)\](.+)$/s);
        if (!m) continue;
        const label = m[1].replace(/<[^>]+>/g, '').trim();
        const target = m[2].split(' or ')[0].trim();
        const url = target.replace(/:hls:manifest\.m3u8$/, '').trim();
        if (!url) continue;
        out.push({
          label,
          url,
          hls: /\.m3u8(\?|$)/i.test(url),
          premium: m[1].includes('prem-quality') || label.includes('PRO'),
          rank: api.rank(label)
        });
      }
      return out.sort((a, b) => b.rank - a.rank);
    },

    // Labels are free text: "4K" has no resolution in it, "1080p Ultra" has two
    // numbers. Map what they mean rather than trusting the first digits.
    rank(label) {
      const l = label.toLowerCase();
      if (/4k|uhd|2160/.test(l)) return 2160;
      if (/2k|1440/.test(l)) return 1440;
      if (/1080|full\s*hd|fhd/.test(l)) return 1080;
      if (/720|\bhd\b/.test(l)) return 720;
      if (/480|\bsd\b/.test(l)) return 480;
      if (/360/.test(l)) return 360;
      if (/240/.test(l)) return 240;
      const n = l.match(/\d{3,4}/);
      return n ? parseInt(n[0], 10) : 0;
    }
  };

  // --------------------------------------------------------------- naming ----

  const FLAGS = [
    [/україн|украин|\bukr|ukraine|нло\s*tv|нлотв|1\+1|пряміст|ictv|інтер|новий\s*канал|так\s*треба|цікава\s*ідея|постмодерн|дніпрофільм|колодій|парамаунт\s*ua/, '🇺🇦'],
    [/оригинал|оригінал|original|english\b|en\s+sub/, '🌐'],
    [/польск|польськ|polish/, '🇵🇱'],
    [/немецк|німецьк|deutsch|german/, '🇩🇪'],
    [/french|французск|французьк/, '🇫🇷']
  ];

  function flagFor(name) {
    if (/\p{Regional_Indicator}/u.test(name)) return '';
    const n = name.toLowerCase();
    for (const [re, flag] of FLAGS) if (re.test(n)) return flag;
    return '';
  }

  function filename(quality) {
    const base = (site.original() || site.title())
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '.')
      .replace(/\.+/g, '.');
    const se = store.season && store.episode
      ? `S${String(store.season).padStart(2, '0')}E${String(store.episode).padStart(2, '0')}`
      : '';
    return [base, site.year(), se, quality].filter(Boolean).join('.') + '.mp4';
  }

  // ---------------------------------------------------------------- store ----

  const store = {
    streams: {},            // "translator:season:episode" -> parsed list
    translator: null,
    season: null,
    episode: null,
    quality: prefs.get(PREF.quality, null),
    status: null,           // { kind: 'wait'|'error', text }
    listeners: [],

    subscribe(fn) { store.listeners.push(fn); },
    emit() { for (const fn of store.listeners) fn(); },
    patch(next) { Object.assign(store, next); store.emit(); },

    key(t = store.translator, s = store.season, e = store.episode) {
      return `${t}:${s || ''}:${e || ''}`;
    },

    current() { return store.streams[store.key()] || null; },
    free() { return (store.current() || []).filter(s => !s.premium); },

    selected() {
      const free = store.free();
      if (!free.length) return null;
      return free.find(s => s.label === store.quality) || free[0];
    }
  };

  // ------------------------------------------------------------------ css ----

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; font: inherit; color: inherit; }
    :where(button, input, a) { font-family: inherit; }

    .app {
      --bg: #0b0b0e; --surface: #15151a; --raised: #1e1e25;
      --line: rgba(255,255,255,.08); --line-strong: rgba(255,255,255,.14);
      --ink: #f3f3f6; --dim: #9a9aa7; --faint: #63636f;
      --accent: #0a84ff; --bad: #ff8f8f;
      min-height: 100vh; background: var(--bg); color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: 1160px; margin: 0 auto; padding: 0 20px; }

    /* ---- top bar ---- */
    .bar { position: sticky; top: 0; z-index: 40; background: rgba(11,11,14,.86);
           -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
           border-bottom: 1px solid var(--line); }
    .bar .wrap { display: flex; align-items: center; gap: 14px; height: 56px; }
    .brand { display: flex; align-items: center; gap: 8px; font-weight: 650; letter-spacing: -.01em;
             cursor: pointer; background: none; border: 0; flex: none; }
    .brand .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
    .search { flex: 1; max-width: 420px; display: flex; align-items: center; gap: 8px;
              padding: 7px 12px; border-radius: 9px; background: var(--surface);
              border: 1px solid var(--line); }
    .search:focus-within { border-color: var(--line-strong); }
    .search input { flex: 1; background: none; border: 0; outline: none; color: var(--ink); font-size: 13px; }
    .search input::placeholder { color: var(--faint); }
    .bar .spacer { flex: 1; }
    .ghost { padding: 7px 11px; border: 1px solid var(--line); border-radius: 9px;
             background: transparent; color: var(--dim); font-size: 12px; cursor: pointer; flex: none; }
    .ghost:hover { color: var(--ink); border-color: var(--line-strong); }

    /* ---- watch ---- */
    .head { padding: 26px 0 16px; display: flex; flex-direction: column; gap: 5px; }
    .head h1 { font-size: 27px; font-weight: 660; letter-spacing: -.02em; line-height: 1.2; text-wrap: balance; }
    .head .orig { color: var(--dim); font-size: 14px; }
    .facts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--dim); font-size: 13px; margin-top: 4px; }
    .facts .sep { width: 3px; height: 3px; border-radius: 50%; background: var(--faint); }
    .score { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 6px;
             background: var(--raised); color: var(--ink); font-weight: 600; font-size: 12.5px;
             font-variant-numeric: tabular-nums; }
    .score .star { color: #f5c451; }

    .screen { position: relative; aspect-ratio: 16/9; width: 100%; background: #000;
              border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
    .screen video { width: 100%; height: 100%; display: block; background: #000; }
    .screen .veil { position: absolute; inset: 0; display: grid; place-items: center; gap: 10px;
                    background: #000; text-align: center; padding: 24px; }
    .screen .veil[hidden] { display: none; }
    .screen .veil .msg { color: var(--dim); font-size: 13px; max-width: 46ch; }
    .poster-blur { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
                   filter: blur(28px) brightness(.35); transform: scale(1.1); }

    .bigplay { width: 62px; height: 62px; border-radius: 50%; border: 0; cursor: pointer;
               background: rgba(255,255,255,.94); color: #000; display: grid; place-items: center;
               position: relative; transition: transform .12s ease; }
    .bigplay:hover { transform: scale(1.06); }

    /* player chrome */
    .chrome { position: absolute; left: 0; right: 0; bottom: 0; padding: 28px 12px 10px;
              background: linear-gradient(to top, rgba(0,0,0,.82), transparent);
              opacity: 0; transition: opacity .18s ease; }
    .screen:hover .chrome, .screen.paused .chrome, .chrome:focus-within { opacity: 1; }
    .scrub { position: relative; height: 16px; display: flex; align-items: center; cursor: pointer; }
    .scrub .track { position: relative; height: 3px; width: 100%; border-radius: 3px; background: rgba(255,255,255,.26); }
    .scrub .buf { position: absolute; inset: 0 auto 0 0; height: 100%; border-radius: 3px; background: rgba(255,255,255,.34); }
    .scrub .fill { position: absolute; inset: 0 auto 0 0; height: 100%; border-radius: 3px; background: var(--accent); }
    .scrub .knob { position: absolute; top: 50%; width: 11px; height: 11px; border-radius: 50%;
                   background: #fff; transform: translate(-50%,-50%); opacity: 0; transition: opacity .12s; }
    .scrub:hover .knob { opacity: 1; }
    .ctrls { display: flex; align-items: center; gap: 6px; padding-top: 4px; color: #fff; }
    .ctrls button { width: 34px; height: 34px; display: grid; place-items: center; border: 0;
                    border-radius: 8px; background: transparent; color: #fff; cursor: pointer; }
    .ctrls button:hover { background: rgba(255,255,255,.14); }
    .ctrls .time { font-size: 12px; font-variant-numeric: tabular-nums; color: rgba(255,255,255,.86);
                   padding: 0 6px; white-space: nowrap; }
    .ctrls .gap { flex: 1; }
    .vol { width: 74px; height: 3px; border-radius: 3px; background: rgba(255,255,255,.26); position: relative; cursor: pointer; }
    .vol .fill { position: absolute; inset: 0 auto 0 0; height: 100%; border-radius: 3px; background: #fff; }

    /* ---- control strip under the player ---- */
    .strip { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 14px 0 4px; }
    .strip .grow { flex: 1; }
    .row { position: relative; }
    .pick { display: flex; align-items: center; gap: 9px; padding: 8px 11px; cursor: pointer;
            background: var(--surface); border: 1px solid var(--line); border-radius: 10px;
            max-width: 260px; transition: border-color .12s ease; }
    .pick:hover:not(:disabled) { border-color: var(--line-strong); }
    .pick .k { font-size: 11px; color: var(--faint); flex: none; }
    .pick .v { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pick .chev { flex: none; opacity: .4; transition: transform .16s ease; }
    .pick[aria-expanded="true"] .chev { transform: rotate(180deg); }
    .pick:disabled { opacity: .45; cursor: default; }

    .menu { position: absolute; left: 0; top: calc(100% + 5px); z-index: 30; min-width: 100%;
            max-width: 320px; max-height: 300px; overflow-y: auto; padding: 5px;
            background: var(--raised); border: 1px solid var(--line-strong); border-radius: 11px;
            box-shadow: 0 16px 40px rgba(0,0,0,.55); }
    .menu[hidden] { display: none; }
    .menu::-webkit-scrollbar { width: 7px; }
    .menu::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 8px; }
    .opt { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; border: 0;
           border-radius: 7px; background: transparent; cursor: pointer; text-align: left; font-size: 13px; }
    .opt:hover { background: rgba(255,255,255,.07); }
    .opt .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .opt .tick { margin-left: auto; flex: none; opacity: 0; }
    .opt[aria-selected="true"] { color: #4da3ff; }
    .opt[aria-selected="true"] .tick { opacity: 1; }

    .dl { display: flex; align-items: center; gap: 7px; padding: 9px 15px; border: 0; border-radius: 10px;
          background: var(--accent); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
    .dl:hover:not(:disabled) { background: #2b95ff; }
    .dl:disabled { opacity: .35; cursor: default; }
    .quiet { padding: 9px 11px; border: 1px solid var(--line); border-radius: 10px; background: transparent;
             color: var(--dim); font-size: 12.5px; cursor: pointer; }
    .quiet:hover:not(:disabled) { color: var(--ink); border-color: var(--line-strong); }
    .quiet:disabled { opacity: .35; cursor: default; }

    .note { font-size: 12.5px; color: var(--dim); padding: 6px 0 0; }
    .note.error { color: var(--bad); }
    .note[hidden] { display: none; }

    /* ---- episodes ---- */
    .eps { display: grid; grid-template-columns: repeat(auto-fill, minmax(58px, 1fr)); gap: 7px; padding: 16px 0 0; }
    .ep { padding: 9px 6px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface);
          color: var(--dim); font-size: 13px; cursor: pointer; font-variant-numeric: tabular-nums; }
    .ep:hover { color: var(--ink); border-color: var(--line-strong); }
    .ep[aria-current="true"] { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }

    /* ---- meta ---- */
    .meta { display: grid; grid-template-columns: 168px 1fr; gap: 24px; padding: 30px 0 60px;
            border-top: 1px solid var(--line); margin-top: 26px; }
    .meta .poster { width: 100%; border-radius: 11px; border: 1px solid var(--line); display: block; }
    .meta .synopsis { color: var(--dim); font-size: 14px; max-width: 68ch; }
    .meta dl { display: grid; grid-template-columns: auto 1fr; gap: 7px 16px; margin-top: 18px; font-size: 13px; }
    .meta dt { color: var(--faint); }
    .meta dd { color: var(--ink); }

    /* ---- grid ---- */
    .gtitle { font-size: 20px; font-weight: 640; letter-spacing: -.015em; padding: 26px 0 16px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(158px, 1fr)); gap: 18px 16px; padding-bottom: 20px; }
    .card { display: flex; flex-direction: column; gap: 8px; text-decoration: none; color: inherit; }
    .card .shot { position: relative; aspect-ratio: 2/3; border-radius: 11px; overflow: hidden;
                  background: var(--surface); border: 1px solid var(--line); }
    .card img { width: 100%; height: 100%; object-fit: cover; display: block;
                transition: transform .25s ease; }
    .card:hover img { transform: scale(1.04); }
    .card .kind { position: absolute; left: 7px; top: 7px; padding: 3px 7px; border-radius: 6px;
                  background: rgba(0,0,0,.72); font-size: 10.5px; letter-spacing: .03em; color: #fff; }
    .card .name { font-size: 13.5px; font-weight: 550; line-height: 1.35; }
    .card .sub { font-size: 12px; color: var(--faint); }
    .card:hover .name { color: #fff; }

    .pager { display: flex; flex-wrap: wrap; gap: 7px; padding: 8px 0 60px; }
    .pager a { padding: 7px 12px; border-radius: 8px; border: 1px solid var(--line);
               background: var(--surface); color: var(--dim); text-decoration: none; font-size: 13px; }
    .pager a:hover { color: var(--ink); border-color: var(--line-strong); }

    .empty { padding: 60px 0; color: var(--faint); text-align: center; }

    .toast { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 90;
             padding: 9px 16px; border-radius: 10px; background: var(--raised);
             border: 1px solid var(--line-strong); font-size: 12.5px; color: var(--ink);
             box-shadow: 0 12px 32px rgba(0,0,0,.5); pointer-events: none; }

    button:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    @media (max-width: 720px) {
      .meta { grid-template-columns: 1fr; }
      .meta .poster { max-width: 168px; }
      .head h1 { font-size: 22px; }
    }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
  `;

  const I = {
    play: '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.2v13.6L19 12z"/></svg>',
    pause: '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="3.6" height="14" rx="1.1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.1"/></svg>',
    bigplay: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.2v13.6L19 12z"/></svg>',
    down: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13"/><path d="m6 11 6 6 6-6"/><path d="M4 21h16"/></svg>',
    chev: '<svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    tick: '<svg class="tick" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>',
    full: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/></svg>',
    vol: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/></svg>',
    mute: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l4 6M21 9l-4 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
    search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
  };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clock = s => {
    if (!isFinite(s) || s < 0) return '0:00';
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = Math.floor(s % 60);
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  };

  // ------------------------------------------------------------------ ui ----

  const ui = {
    host: null, shadow: null, root: null, menu: null, el: {},

    mount(view) {
      const host = document.createElement('div');
      host.id = 'rzk-app';
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = CSS;
      const root = document.createElement('div');
      root.className = 'app';
      shadow.append(style, root);
      document.body.appendChild(host);

      ui.host = host; ui.shadow = shadow; ui.root = root;
      root.innerHTML = ui.bar() + view;
      ui.cache();
      ui.bindBar();

      // Only hide the original once ours is actually standing.
      document.documentElement.setAttribute('data-rzk', 'on');
    },

    cache() {
      ui.el = {};
      for (const el of ui.root.querySelectorAll('[data-el]')) ui.el[el.dataset.el] = el;
    },

    bar() {
      return `
      <header class="bar">
        <div class="wrap">
          <button class="brand" data-el="brand" type="button"><span class="dot"></span> Rezka</button>
          <label class="search">${I.search}
            <input data-el="q" type="search" placeholder="Поиск фильмов и сериалов" aria-label="Поиск">
          </label>
          <span class="spacer"></span>
          <button class="ghost" data-el="restore" type="button">Оригинальный сайт</button>
        </div>
      </header>`;
    },

    bindBar() {
      ui.el.brand?.addEventListener('click', () => { location.href = '/'; });
      ui.el.restore?.addEventListener('click', () => {
        document.documentElement.removeAttribute('data-rzk');
        ui.host.remove();
      });
      ui.el.q?.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        const q = e.target.value.trim();
        if (q) location.href = `/search/?do=search&subaction=search&q=${encodeURIComponent(q)}`;
      });
      // A click outside any menu dismisses it.
      document.addEventListener('click', e => {
        if (ui.menu && !e.composedPath().includes(ui.host)) ui.closeMenus();
      }, true);
    },

    menuFor(name) {
      ui.menu = name;
      for (const box of ui.root.querySelectorAll('[data-menu]')) {
        const open = box.dataset.menu === name;
        box.hidden = !open;
        ui.root.querySelector(`[data-opens="${box.dataset.menu}"]`)?.setAttribute('aria-expanded', String(open));
      }
    },

    closeMenus() { ui.menuFor(null); },

    picker(name, label, value, disabled) {
      return `
      <div class="row">
        <button class="pick" type="button" data-opens="${name}" data-el="${name}Pick"
                aria-haspopup="listbox" aria-expanded="false" ${disabled ? 'disabled' : ''}>
          <span class="k">${esc(label)}</span>
          <span class="v" data-el="${name}Value">${esc(value)}</span>
          ${I.chev}
        </button>
        <div class="menu" data-menu="${name}" data-el="${name}Menu" role="listbox" aria-label="${esc(label)}" hidden></div>
      </div>`;
    },

    options(items, isOn) {
      if (!items.length) return '<div class="opt" aria-disabled="true"><span class="name">Нет вариантов</span></div>';
      return items.map(i => `
        <button class="opt" type="button" role="option" data-value="${esc(i.value)}"
                aria-selected="${isOn(i)}"><span class="name">${esc(i.label)}</span>${I.tick}</button>`).join('');
    },

    toast(text) {
      if (!ui.root) return;
      const el = document.createElement('div');
      el.className = 'toast';
      el.textContent = text;
      ui.root.appendChild(el);
      setTimeout(() => el.remove(), 2200);
    }
  };

  // -------------------------------------------------------------- player ----
  // A real <video> on the direct file. HLS-only releases can't play here
  // without an MSE layer, so those fall back to the site's own player rather
  // than showing a dead frame.

  const player = {
    video: null, screen: null, ready: false,

    markup(poster) {
      return `
      <div class="screen paused" data-el="screen">
        <video data-el="video" preload="metadata" playsinline ${poster ? `poster="${esc(poster)}"` : ''}></video>
        <div class="veil" data-el="veil">
          ${poster ? `<img class="poster-blur" src="${esc(poster)}" alt="">` : ''}
          <button class="bigplay" data-el="bigplay" type="button" aria-label="Смотреть">${I.bigplay}</button>
          <p class="msg" data-el="veilMsg"></p>
        </div>
        <div class="chrome" data-el="chrome">
          <div class="scrub" data-el="scrub" role="slider" tabindex="0"
               aria-label="Позиция" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <div class="track"><div class="buf" data-el="buf"></div><div class="fill" data-el="fill"></div>
              <div class="knob" data-el="knob"></div></div>
          </div>
          <div class="ctrls">
            <button data-el="toggle" type="button" aria-label="Смотреть">${I.play}</button>
            <span class="time" data-el="time">0:00 / 0:00</span>
            <button data-el="muteBtn" type="button" aria-label="Звук">${I.vol}</button>
            <div class="vol" data-el="vol"><div class="fill" data-el="volFill"></div></div>
            <span class="gap"></span>
            <button data-el="fs" type="button" aria-label="Во весь экран">${I.full}</button>
          </div>
        </div>
      </div>`;
    },

    bind() {
      const v = ui.el.video, screen = ui.el.screen;
      if (!v) return;
      player.video = v; player.screen = screen;

      const toggle = () => { if (v.paused) v.play?.().catch(() => {}); else v.pause?.(); };
      ui.el.toggle?.addEventListener('click', toggle);
      ui.el.bigplay?.addEventListener('click', toggle);
      v.addEventListener('click', toggle);

      v.addEventListener('play', () => {
        screen.classList.remove('paused');
        ui.el.veil.hidden = true;
        ui.el.toggle.innerHTML = I.pause;
      });
      v.addEventListener('pause', () => {
        screen.classList.add('paused');
        ui.el.toggle.innerHTML = I.play;
      });
      v.addEventListener('timeupdate', player.tick);
      v.addEventListener('durationchange', player.tick);
      v.addEventListener('progress', player.tick);
      // Checkpoint on pause rather than on a timer, so nothing keeps running
      // once the page is idle.
      v.addEventListener('pause', player.remember);
      v.addEventListener('ended', () => actions.nextEpisode());
      v.addEventListener('error', () => player.fallback('Файл не открылся. Попробуйте другое качество.'));

      const seek = e => {
        const r = ui.el.scrub.getBoundingClientRect();
        if (!r.width || !isFinite(v.duration)) return;
        v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * v.duration;
      };
      ui.el.scrub?.addEventListener('click', seek);
      ui.el.scrub?.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight') v.currentTime += 10;
        else if (e.key === 'ArrowLeft') v.currentTime -= 10;
      });

      ui.el.vol?.addEventListener('click', e => {
        const r = ui.el.vol.getBoundingClientRect();
        if (!r.width) return;
        v.volume = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        v.muted = v.volume === 0;
        player.tick();
      });
      ui.el.muteBtn?.addEventListener('click', () => { v.muted = !v.muted; player.tick(); });
      ui.el.fs?.addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen?.();
        else screen.requestFullscreen?.();
      });

      document.addEventListener('keydown', e => {
        if (!player.video || /input|textarea/i.test(e.target?.tagName || '')) return;
        if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
        else if (e.key === 'ArrowRight') v.currentTime += 5;
        else if (e.key === 'ArrowLeft') v.currentTime -= 5;
        else if (e.key === 'f') ui.el.fs?.click();
        else if (e.key === 'm') ui.el.muteBtn?.click();
      });
    },

    tick() {
      const v = player.video;
      if (!v || !ui.el.fill) return;
      const d = isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      const pct = d ? (v.currentTime / d) * 100 : 0;
      ui.el.fill.style.width = pct + '%';
      ui.el.knob.style.left = pct + '%';
      ui.el.time.textContent = `${clock(v.currentTime)} / ${clock(d)}`;
      ui.el.scrub?.setAttribute('aria-valuenow', String(Math.round(pct)));
      if (v.buffered?.length && d) {
        ui.el.buf.style.width = (v.buffered.end(v.buffered.length - 1) / d) * 100 + '%';
      }
      ui.el.volFill.style.width = (v.muted ? 0 : v.volume) * 100 + '%';
      ui.el.muteBtn.innerHTML = v.muted || v.volume === 0 ? I.mute : I.vol;
    },

    load(stream) {
      const v = player.video;
      if (!v || !stream) return;
      if (stream.hls) { player.fallback('Этот перевод отдаётся только потоком HLS — открыт плеер сайта.'); return; }
      ui.el.veilMsg.textContent = '';
      ui.el.bigplay.hidden = false;
      const at = prefs.get(PREF.pos, {})[actions.posKey()] || 0;
      v.src = stream.url;
      if (at > 30) v.currentTime = at;
      player.ready = true;
    },

    // Hand playback back to the site rather than pretending.
    fallback(message) {
      player.ready = false;
      if (!ui.el.veil) return;
      ui.el.veil.hidden = false;
      ui.el.bigplay.hidden = true;
      ui.el.veilMsg.textContent = message;
      const original = document.getElementById('player');
      if (original) {
        document.documentElement.removeAttribute('data-rzk');
        original.scrollIntoView?.({ block: 'center' });
      }
    },

    remember() {
      const v = player.video;
      if (!v || !isFinite(v.currentTime) || v.currentTime < 30) return;
      const all = prefs.get(PREF.pos, {});
      all[actions.posKey()] = Math.floor(v.currentTime);
      prefs.set(PREF.pos, all);
    }
  };

  // --------------------------------------------------------------- views ----

  const watchView = {
    render() {
      const info = site.info();
      const rating = site.rating();
      const facts = [site.year(), info['Страна'], info['Жанр'], info['Время']].filter(Boolean);

      return `
      <main class="wrap">
        <div class="head">
          <h1>${esc(site.title())}</h1>
          ${site.original() ? `<div class="orig">${esc(site.original())}</div>` : ''}
          <div class="facts">
            ${rating ? `<span class="score"><span class="star">★</span>${esc(rating.score)}</span>` : ''}
            ${facts.map(f => `<span>${esc(f)}</span>`).join('<span class="sep"></span>')}
          </div>
        </div>

        ${player.markup(site.poster())}

        <div class="strip" data-el="strip"></div>
        <p class="note" data-el="note" role="status" aria-live="polite" hidden></p>
        <div class="eps" data-el="eps"></div>

        <section class="meta">
          <div>${site.poster() ? `<img class="poster" src="${esc(site.poster())}" alt="">` : ''}</div>
          <div>
            <p class="synopsis">${esc(site.description())}</p>
            <dl>${Object.entries(info).slice(0, 8)
              .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
          </div>
        </section>
      </main>`;
    },

    // The strip is re-rendered on every state change; the menus live inside it.
    strip() {
      const voices = actions.voices();
      const voice = voices.find(v => v.id === store.translator) || voices[0];
      const seasons = site.seasons();
      const eps = site.episodes()[store.season] || [];
      const free = store.free();
      const picked = store.selected();

      let html = ui.picker('voice', 'Озвучка',
        voice ? `${flagFor(voice.name) ? flagFor(voice.name) + ' ' : ''}${voice.name}` : '—',
        voices.length < 2);

      if (seasons.length) {
        html += ui.picker('season', 'Сезон',
          seasons.find(s => s.id === store.season)?.label || '—', seasons.length < 2);
      }
      html += ui.picker('quality', 'Качество', picked ? picked.label : '—', free.length < 2);
      html += '<span class="grow"></span>';
      html += `<button class="dl" data-el="download" type="button" ${picked ? '' : 'disabled'}>${I.down} Скачать</button>`;
      html += `<button class="quiet" data-el="copy" type="button" ${picked ? '' : 'disabled'}>Ссылка</button>`;
      html += `<button class="quiet" data-el="leech" type="button" ${picked ? '' : 'disabled'}>Leech</button>`;
      return html;
    },

    episodes() {
      const eps = site.episodes()[store.season] || [];
      if (eps.length < 2) return '';
      return eps.map(e => `<button class="ep" type="button" data-ep="${esc(e.id)}"
        aria-current="${e.id === store.episode}">${esc(e.id)}</button>`).join('');
    },

    update() {
      if (!ui.el.strip) return;
      ui.el.strip.innerHTML = watchView.strip();
      ui.el.eps.innerHTML = watchView.episodes();
      ui.cache();
      watchView.fillMenus();
      watchView.bindStrip();

      const note = store.status
        || (store.current() && !store.free().length ? { kind: 'error', text: 'Все качества только для PRO' } : null);
      ui.el.note.hidden = !note;
      ui.el.note.textContent = note ? note.text : '';
      ui.el.note.classList.toggle('error', note?.kind === 'error');
    },

    fillMenus() {
      const voices = actions.voices();
      ui.el.voiceMenu.innerHTML = ui.options(
        voices.map(v => ({ value: v.id, label: `${flagFor(v.name) ? flagFor(v.name) + ' ' : ''}${v.name}` })),
        i => i.value === store.translator);

      if (ui.el.seasonMenu) {
        ui.el.seasonMenu.innerHTML = ui.options(
          site.seasons().map(s => ({ value: s.id, label: s.label })),
          i => i.value === store.season);
      }
      ui.el.qualityMenu.innerHTML = ui.options(
        store.free().map(s => ({ value: s.label, label: s.label })),
        i => i.value === store.selected()?.label);
    },

    bindStrip() {
      for (const btn of ui.root.querySelectorAll('[data-opens]')) {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          ui.menuFor(ui.menu === btn.dataset.opens ? null : btn.dataset.opens);
        });
      }
      const on = (menu, fn) => ui.el[menu]?.addEventListener('click', e => {
        const opt = e.target.closest('.opt[data-value]');
        if (!opt) return;
        ui.closeMenus();
        fn(opt.dataset.value);
      });
      on('voiceMenu', v => actions.setTranslator(v));
      on('seasonMenu', v => actions.setSeason(v));
      on('qualityMenu', v => actions.setQuality(v));

      ui.el.eps?.addEventListener('click', e => {
        const b = e.target.closest('[data-ep]');
        if (b) actions.setEpisode(b.dataset.ep);
      });
      ui.el.download?.addEventListener('click', () => actions.run('download'));
      ui.el.copy?.addEventListener('click', () => actions.run('copy'));
      ui.el.leech?.addEventListener('click', () => actions.run('leech'));
    }
  };

  const gridView = {
    render() {
      const cards = site.cards();
      const pages = site.pages();
      return `
      <main class="wrap">
        <h1 class="gtitle">${esc(site.heading() || 'Каталог')}</h1>
        ${cards.length ? `<div class="cards">${cards.map(gridView.card).join('')}</div>` : '<p class="empty">Ничего не найдено</p>'}
        ${pages.length ? `<nav class="pager">${pages.map(p =>
          `<a href="${esc(p.url)}">${esc(p.label)}</a>`).join('')}</nav>` : ''}
      </main>`;
    },

    card(c) {
      return `
      <a class="card" href="${esc(c.url)}">
        <div class="shot">
          ${c.cover ? `<img src="${esc(c.cover)}" alt="" loading="lazy">` : ''}
          ${c.entity ? `<span class="kind">${esc(c.entity)}</span>` : ''}
        </div>
        <span class="name">${esc(c.title)}</span>
        <span class="sub">${esc(c.meta)}</span>
      </a>`;
    }
  };

  // -------------------------------------------------------------- actions ----

  let watchdog = null;

  const actions = {
    voices() {
      const tabs = site.translators().filter(t => !t.premium);
      return tabs.length ? tabs : [site.soleTranslator()];
    },

    posKey() { return `${site.id()}:${store.season || ''}:${store.episode || ''}`; },

    ingest(key, list) {
      clearTimeout(watchdog);
      store.patch({ streams: { ...store.streams, [key]: list }, status: null });
      const pick = store.selected();
      if (pick && key === store.key()) player.load(pick);
    },

    fail(text) {
      clearTimeout(watchdog);
      store.patch({ status: { kind: 'error', text } });
    },

    need() {
      if (store.current()) { const p = store.selected(); if (p) player.load(p); return; }
      store.patch({ status: { kind: 'wait', text: 'Загружается…' } });
      actions.fetch();
      actions.arm();
    },

    fetch() {
      const id = site.id();
      const t = store.translator;
      if (!id || !t || t === 'single') return;
      const key = store.key();
      api.request({
        id, translatorId: t, season: store.season, episode: store.episode, series: site.isSeries()
      }).then(list => actions.ingest(key, list), err => actions.fail(err.message));
    },

    arm() {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (!store.current()) actions.fail('Сайт не ответил — обновите страницу');
      }, 9000);
    },

    setTranslator(id) {
      if (id === store.translator) return;
      player.remember();
      store.patch({ translator: id });
      actions.need();
    },

    setSeason(id) {
      if (id === store.season) return;
      player.remember();
      const first = (site.episodes()[id] || [])[0];
      store.patch({ season: id, episode: first ? first.id : null });
      actions.need();
    },

    setEpisode(id) {
      if (id === store.episode) return;
      player.remember();
      store.patch({ episode: id });
      actions.need();
    },

    nextEpisode() {
      const eps = site.episodes()[store.season] || [];
      const i = eps.findIndex(e => e.id === store.episode);
      if (i >= 0 && i + 1 < eps.length) actions.setEpisode(eps[i + 1].id);
    },

    setQuality(label) {
      store.quality = label;
      prefs.set(PREF.quality, label);
      store.emit();
      const pick = store.selected();
      if (pick && player.video) {
        const at = player.video.currentTime;
        player.load(pick);
        if (at > 1) player.video.currentTime = at;
      }
    },

    run(kind) {
      const pick = store.selected();
      if (!pick) return;
      const name = filename(pick.label);

      if (kind === 'copy') { GM_setClipboard(pick.url); ui.toast('Ссылка скопирована'); return; }
      if (kind === 'leech') {
        GM_setClipboard(name);
        ui.toast('Отправлено в Leech');
        const target = pick.url.replace(/^https?:\/\//, m => (m.includes('https') ? 'secureleech://' : 'leech://'));
        const a = document.createElement('a');
        a.href = target;
        a.click();
        return;
      }
      // Browsers ignore <a download> cross-origin, so only the manager's
      // downloader keeps the filename we generated.
      if (typeof GM_download === 'function') {
        GM_download({ url: pick.url, name, saveAs: false, onerror: () => anchorDownload(pick.url, name) });
      } else {
        anchorDownload(pick.url, name);
      }
      ui.toast(`Скачивается ${pick.label}`);
    }
  };

  function anchorDownload(url, name) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------------------------------------------------------- interception ----

  // The site's own request for a stream is free data; take it rather than
  // issuing a second identical one.
  function interceptXHR() {
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this._rzkUrl = String(url);
      return open.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
      if (this._rzkUrl && this._rzkUrl.includes('get_cdn_series')) {
        this.addEventListener('load', () => {
          let data;
          try { data = JSON.parse(this.responseText); } catch (e) { return; }
          if (!data.success || !data.url) return;
          const p = typeof body === 'string' ? new URLSearchParams(body) : null;
          const tid = p?.get('translator_id') || store.translator;
          if (!tid) return;
          actions.ingest(store.key(tid, p?.get('season') || store.season, p?.get('episode') || store.episode),
            api.parse(data.url));
        });
      }
      return send.apply(this, arguments);
    };
  }

  // ----------------------------------------------------------------- boot ----

  function pickVoice() {
    const free = site.translators().filter(t => !t.premium);
    if (!free.length) return site.soleTranslator().id;
    const active = site.translators().find(t => t.active);
    const ua = free.find(t => flagFor(t.name) === '🇺🇦');
    if (active && active.premium) return (ua || free[0]).id;
    if (ua && active && active.id !== ua.id) return ua.id;
    return active ? active.id : free[0].id;
  }

  function initWatch() {
    const seasons = site.seasons();
    const activeSeason = seasons.find(s => s.active)?.id || seasons[0]?.id || null;
    const epsAll = site.episodes();
    const eps = epsAll[activeSeason] || [];
    const activeEp = eps.find(e => e.active)?.id || eps[0]?.id || null;

    store.translator = pickVoice();
    store.season = activeSeason;
    store.episode = activeEp;

    ui.mount(watchView.render());
    player.bind();
    store.subscribe(watchView.update);

    const inline = site.inlineStreams();
    if (inline) actions.ingest(store.key(inline.id, activeSeason, activeEp), api.parse(inline.raw));

    watchView.update();
    actions.need();

    addEventListener('beforeunload', player.remember);
  }

  function init() {
    const kind = site.kind();
    if (!kind) return;
    if (kind === 'watch') initWatch();
    else { ui.mount(gridView.render()); }
  }

  // One global rule, and it only bites once our own UI is up.
  function armTakeover() {
    const style = document.createElement('style');
    style.id = 'rzk-takeover';
    style.textContent = `html[data-rzk="on"] body > *:not(#rzk-app) { display: none !important; }
                         html[data-rzk="on"] { background: #0b0b0e; }
                         html[data-rzk="on"] body { overflow: auto !important; }`;
    (document.head || document.documentElement).appendChild(style);
  }

  interceptXHR();
  armTakeover();
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
