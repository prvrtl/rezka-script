// ==UserScript==
// @name           Rezka Downloader
// @namespace      https://greasyfork.org/en/users/1458606-saarmaat
// @version        3.8
// @description    Replaces the HDrezka interface with a clean one: an info page, a distraction-free watch mode with a right-click menu, plus downloads, copied links and Leech integration.
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
// @grant          GM_xmlhttpRequest
// @grant          unsafeWindow
// @connect        *
// @run-at         document-start
// @homepageURL    https://github.com/prvrtl/rezka-script
// @downloadURL    https://raw.githubusercontent.com/prvrtl/rezka-script/main/rezka-downloader.user.js
// @updateURL      https://raw.githubusercontent.com/prvrtl/rezka-script/main/rezka-downloader.user.js
// ==/UserScript==

(function () {
  'use strict';

  const PREF = { quality: 'rzk.quality', pos: 'rzk.pos', batch: 'rzk.batch', native: 'rzk.native' };

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
  // Everything that reads the page. Ordered by how long each source is likely
  // to outlive a redesign:
  //
  //   1. the URL            — changing it breaks their own links
  //   2. og:* / itemprop    — changing it breaks their search ranking
  //   3. data-* attributes  — the site's own scripts depend on these
  //   4. CSS class names    — free to change at any time
  //
  // Each accessor walks that order and takes the first answer, so a restyle
  // costs nothing and only a genuine data change hurts. Run tools/inspect.mjs
  // against a fresh capture to see which sources still answer.

  const first = (...sources) => {
    for (const s of sources) {
      let v = null;
      try { v = typeof s === 'function' ? s() : s; } catch (e) { v = null; }
      if (v) return v;
    }
    return '';
  };

  const meta = name =>
    document.querySelector(`meta[property="${name}"], meta[itemprop="${name}"], meta[name="${name}"]`)
      ?.getAttribute('content')?.trim() || '';

  const microText = name => {
    const el = document.querySelector(`[itemprop="${name}"]`);
    if (!el) return '';
    return (el.getAttribute('content') || el.getAttribute('src') || el.textContent || '')
      .replace(/\s+/g, ' ').trim();
  };

  const microAll = name => [...document.querySelectorAll(`[itemprop="${name}"]`)]
    .map(el => (el.getAttribute('content') || el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const path = () => { try { return location.pathname || ''; } catch (e) { return ''; } };

  /** "/films/drama/55330-russkaya-lolita-2007.html" -> "55330" */
  const ID_IN_PATH = /\/(\d+)-[^/]*\.html?$/;

  const site = {
    kind() {
      // Watch pages also carry "related" cards, so card presence can never win
      // over a watch signal — and a watch signal still has to be backed by
      // actual content, or we would blank a page we cannot fill.
      const looksWatch = /^video\./.test(meta('og:type'))
        || ID_IN_PATH.test(path())
        || Boolean(document.getElementById('post_id'));
      if (looksWatch && site.id() && site.title()) return 'watch';
      if (/^\/(search|page)\b/.test(path())) return 'grid';
      if (document.querySelector('[data-url][data-id]')) return 'grid';
      return null;
    },

    id() {
      return first(
        () => path().match(ID_IN_PATH)?.[1],
        () => meta('og:url').match(ID_IN_PATH)?.[1],
        () => document.getElementById('post_id')?.value,
        () => document.querySelector('[data-id]')?.dataset?.id
      ) || null;
    },

    title() {
      return first(
        () => microText('name'),
        () => meta('og:title').replace(/\s*\(\d{4}\)\s*$/, ''),
        () => document.querySelector('h1')?.textContent?.trim()
      );
    },

    original() {
      const raw = first(
        () => microText('alternativeHeadline'),
        () => document.querySelector('.b-post__origtitle')?.textContent?.trim()
      );
      if (!raw) return '';
      return raw.includes('/') ? raw.split('/').pop().trim() : raw;
    },

    poster() {
      return first(
        () => microText('image'),
        () => meta('og:image'),
        () => document.querySelector('.b-post__infotable_left img')?.getAttribute('src')
      );
    },

    description() {
      return first(
        () => meta('og:description'),
        () => microText('description'),
        () => document.querySelector('.b-post__description_text')?.textContent?.trim()
      );
    },

    year() {
      return first(
        () => meta('og:title').match(/\((\d{4})\)/)?.[1],
        () => path().match(/-(\d{4})[^/]*\.html?$/)?.[1],
        () => microText('datePublished').match(/\d{4}/)?.[0],
        () => (site.info()['Год'] || site.info()['Дата выхода'] || '').match(/\d{4}/)?.[0]
      );
    },

    duration() {
      const secs = parseInt(meta('og:duration'), 10);
      if (secs > 0) return `${Math.round(secs / 60)} min`;
      return first(() => microText('duration'), () => site.info()['Время']);
    },

    genre() {
      const g = microAll('genre');
      return g.length ? g.join(', ') : site.info()['Жанр'] || '';
    },

    country() { return site.info()['Страна'] || ''; },

    rating() {
      const score = first(() => microText('average'),
        () => document.querySelector('.b-post__rating .num')?.textContent?.trim());
      if (!score) return null;
      const votes = first(() => microText('votes'),
        () => document.querySelector('.b-post__rating .votes')?.textContent?.replace(/[()\s]/g, ''));
      return { score: String(score).replace(',', '.'), votes: votes || '' };
    },

    /** Only used for the leftovers no structured source covers. */
    info() {
      const out = {};
      for (const tr of document.querySelectorAll('table tr')) {
        const cells = tr.querySelectorAll('td');
        if (cells.length < 2) continue;
        const k = cells[0].textContent?.trim().replace(/:$/, '');
        const v = cells[cells.length - 1].textContent?.replace(/\s+/g, ' ').trim();
        if (k && v && k.length < 30 && !out[k]) out[k] = v;
      }
      return out;
    },

    /**
     * The people, with the pages they lead to.
     *
     * schema.org itemprops, so this reads the same markup search engines do —
     * the site cannot drop it without losing its own rich results. The cast row
     * is a colspan cell and never reaches info() above, which is why the names
     * are read here rather than pulled back out of that table.
     */
    people(role) {
      const seen = new Set();
      return [...document.querySelectorAll(`[itemprop="${role}"]`)].map(el => ({
        name: (el.querySelector('[itemprop="name"]') || el).textContent.replace(/\s+/g, ' ').trim(),
        url: el.querySelector('a[href]')?.getAttribute('href') || '',
        photo: el.getAttribute('data-photo') || ''
      })).filter(p => p.name && !seen.has(p.name) && seen.add(p.name));
    },

    isSeries() {
      if (document.querySelector('[data-episode_id]')) return true;
      return meta('og:type') === 'video.tv_series';
    },

    // data-* attributes, not class names: the site's own scripts read these,
    // so they survive a restyle.
    translators() {
      return [...document.querySelectorAll('[data-translator_id]')].map(el => ({
        id: el.dataset.translator_id,
        name: el.textContent.trim(),
        premium: /prem/i.test(el.className || ''),
        active: /\bactive\b/.test(el.className || '')
      })).filter(t => t.id && t.name);
    },

    soleTranslator() {
      return {
        id: site.scrapeTranslatorId() || 'single',
        name: site.info()['В переводе'] || 'Оригинал',
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
      return [...document.querySelectorAll('[data-tab_id]')].map(el => ({
        id: el.dataset.tab_id,
        label: el.textContent.trim(),
        active: /\bactive\b/.test(el.className || '')
      })).filter(s => s.id);
    },

    // Episodes carry their own season id, so the whole map is readable without
    // clicking through the site's tabs.
    episodes() {
      const out = {};
      const fallbackSeason = site.seasons().find(x => x.active)?.id || '1';
      for (const el of document.querySelectorAll('[data-episode_id]')) {
        const s = el.dataset.season_id || fallbackSeason;
        (out[s] ||= []).push({
          id: el.dataset.episode_id,
          label: el.textContent.trim(),
          active: /\bactive\b/.test(el.className || '')
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
      return first(
        () => document.querySelector('.b-content__htitle')?.textContent?.trim(),
        () => meta('og:title'),
        () => document.title.split('|')[0].trim()
      );
    },

    // Cards are found by the attributes the site's own code uses, and read
    // structurally — no class names involved.
    cards() {
      return [...document.querySelectorAll('[data-url][data-id]')].map(el => {
        const named = [...el.querySelectorAll('a')]
          .find(a => !a.querySelector('img') && a.textContent.trim());
        const img = el.querySelector('img');
        // The year/country/genre line: the innermost text that carries a year.
        // Skipping anything wrapping a link or image keeps the title out of it.
        const blurb = [...el.querySelectorAll('div, span, p')]
          .filter(n => !n.querySelector('a, img'))
          .map(n => n.textContent.replace(/\s+/g, ' ').trim())
          .find(t => t && t.length < 90 && /\b(19|20)\d{2}\b/.test(t));
        return {
          id: el.dataset.id,
          url: el.dataset.url,
          cover: img?.getAttribute('src') || '',
          entity: i18n.term(el.querySelector('.entity')?.textContent?.trim() || ''),
          title: named?.textContent.trim() || img?.getAttribute('alt')?.trim() || '',
          meta: i18n.term(blurb || '')
        };
      }).filter(c => c.title && c.url);
    },

    pages() {
      const links = document.querySelectorAll('.b-navigation a, a[href*="/page/"]');
      const seen = new Set();
      return [...links].map(a => ({ label: a.textContent.trim(), url: a.href }))
        .filter(p => p.label && !seen.has(p.url) && seen.add(p.url));
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
          catch (e) { reject(new Error('Unreadable response')); return; }
          if (!data.success || !data.url) { reject(new Error(data.message || 'No stream returned')); return; }
          resolve(api.read(data));
        };
        xhr.onerror = () => reject(new Error('Request failed'));
        xhr.send(body.toString());
      });
    },

    SUGGEST: '/engine/ajax/search.php',

    /**
     * The site's own type-ahead. Same origin, so a plain request reaches it,
     * and it answers with the markup its own dropdown renders — five results
     * and nothing else. Failures resolve empty: a suggestion list is a
     * convenience and must never turn into an error on screen.
     */
    suggest(q) {
      return new Promise(resolve => {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', api.SUGGEST);
          xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
          xhr.onload = () => { try { resolve(api.readSuggest(xhr.responseText)); } catch (e) { resolve([]); } };
          xhr.onerror = () => resolve([]);
          xhr.ontimeout = () => resolve([]);
          xhr.send('q=' + encodeURIComponent(q));
        } catch (e) { resolve([]); }
      });
    },

    // "<li><a href=…><span class=enty>Матрица</span> (The Matrix, 1999)
    //  <span class=rating><i>8.50</i></span></a></li>"
    readSuggest(html) {
      const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      return [...doc.querySelectorAll('li a[href]')].map(a => {
        const title = a.querySelector('.enty')?.textContent.replace(/\s+/g, ' ').trim() || '';
        const rating = a.querySelector('.rating')?.textContent.replace(/\s+/g, ' ').trim() || '';
        // Whatever is left once the title and the score are taken out is the
        // original name, year and kind — already parenthesised by the site.
        const rest = a.cloneNode(true);
        for (const drop of rest.querySelectorAll('.enty, .rating')) drop.remove();
        const note = rest.textContent.replace(/\s+/g, ' ').replace(/^[\s(]+|[\s)]+$/g, '').trim();
        return { title, note, rating, url: a.getAttribute('href') || '' };
      }).filter(s => s.title && s.url);
    },

    /** Everything the endpoint returns, not just the qualities. */
    read(data) {
      return { list: api.parse(data.url), subs: api.subtitles(data) };
    },

    /**
     * Subtitles use the same bracketed grammar as the quality list:
     *   subtitle:     "[Русский]https://…/x.vtt,[English]https://…/y.vtt"
     *   subtitle_lns: { "откл.": "", "Русский": "ru" }   label -> language code
     *   subtitle_def: "ru"                               which one starts on
     * They are WebVTT, so <track> plays them with no help from us.
     */
    subtitles(data) {
      const raw = data && data.subtitle;
      if (!raw || typeof raw !== 'string') return [];
      const codes = (data.subtitle_lns && typeof data.subtitle_lns === 'object') ? data.subtitle_lns : {};
      const preferred = data.subtitle_def || '';
      const out = [];
      for (const part of raw.split(/,(?=\[)/)) {
        const m = part.match(/^\[([^\]]+)\](.+)$/s);
        if (!m) continue;
        const label = m[1].replace(/<[^>]+>/g, '').trim();
        const url = m[2].trim();
        if (!url || !label) continue;
        const lang = codes[label] || '';
        out.push({ label, url, lang, on: Boolean(lang) && lang === preferred });
      }
      return out;
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

  function voiceLabel(v) {
    const flag = flagFor(v.name);
    return `${flag ? flag + ' ' : ''}${i18n.voice(v.name)}`;
  }

  function flagFor(name) {
    if (/\p{Regional_Indicator}/u.test(name)) return '';
    const n = name.toLowerCase();
    for (const [re, flag] of FLAGS) if (re.test(n)) return flag;
    return '';
  }

  // ---------------------------------------------------------------- i18n ----
  // Getting this page into English has three tiers, best first:
  //
  //   1. the site already knows.  Titles carry an original-language name in
  //      itemprop=alternativeHeadline — real English, not a guess at it.
  //   2. a glossary.  Genres, countries, table headings and voiceover types are
  //      a closed vocabulary that repeats on every page: instant and exact.
  //   3. on-device translation.  Chrome's Translator API for the free prose
  //      that is left, which is really just the synopsis.
  //
  // Nothing leaves the machine, and every tier falls through to the original
  // text rather than showing a gap.

  const GLOSSARY = {
    // genres
    'драмы': 'Drama', 'драма': 'Drama', 'мелодрамы': 'Romance', 'комедии': 'Comedy',
    'боевики': 'Action', 'фантастика': 'Sci-Fi', 'ужасы': 'Horror', 'триллеры': 'Thriller',
    'детективы': 'Mystery', 'приключения': 'Adventure', 'аниме': 'Anime',
    'документальные': 'Documentary', 'криминал': 'Crime', 'военные': 'War',
    'вестерны': 'Western', 'исторические': 'History', 'семейные': 'Family',
    'спорт': 'Sport', 'эротика': 'Erotica', 'фэнтези': 'Fantasy', 'биография': 'Biography',
    'музыкальные': 'Music', 'мюзиклы': 'Musical', 'короткометражные': 'Short',
    'мультфильмы': 'Animation', 'русские': 'Russian', 'зарубежные': 'Foreign',
    'наши': 'Domestic', 'фильм': 'Film', 'сериал': 'Series',
    'мультфильм': 'Cartoon', 'мультсериал': 'Cartoon series', 'аниме-сериал': 'Anime series', 'реальное тв': 'Reality TV', 'телепередачи': 'TV Shows',
    // countries
    'россия': 'Russia', 'сша': 'USA', 'япония': 'Japan', 'украина': 'Ukraine',
    'великобритания': 'UK', 'франция': 'France', 'германия': 'Germany', 'италия': 'Italy',
    'испания': 'Spain', 'южная корея': 'South Korea', 'корея южная': 'South Korea',
    'китай': 'China', 'канада': 'Canada', 'индия': 'India', 'польша': 'Poland',
    'турция': 'Turkey', 'швеция': 'Sweden', 'австралия': 'Australia', 'бразилия': 'Brazil',
    'мексика': 'Mexico', 'дания': 'Denmark', 'норвегия': 'Norway', 'ирландия': 'Ireland',
    'бельгия': 'Belgium', 'нидерланды': 'Netherlands', 'ссср': 'USSR', 'гонконг': 'Hong Kong',
    'аргентина': 'Argentina', 'новая зеландия': 'New Zealand', 'финляндия': 'Finland',
    // info-table headings
    'рейтинги': 'Ratings', 'год': 'Year', 'дата выхода': 'Released', 'страна': 'Country',
    'режиссер': 'Director', 'режиссёр': 'Director', 'жанр': 'Genre', 'в качестве': 'Quality',
    'возраст': 'Age rating', 'время': 'Runtime', 'из серии': 'Collections',
    'в переводе': 'Translation', 'входит в списки': 'Featured in', 'актеры': 'Cast',
    'актёры': 'Cast', 'слоган': 'Tagline', 'премьера': 'Premiere', 'сборы': 'Box office',
    // voiceover vocabulary
    'дубляж': 'Dubbed', 'оригинал': 'Original', 'многоголосый закадровый': 'Multi-voice VO',
    'двухголосый закадровый': 'Two-voice VO', 'одноголосый закадровый': 'Single-voice VO',
    'закадровый': 'Voice-over', 'субтитры': 'subtitles', 'авторский': 'Auteur',
    'профессиональный': 'Professional', 'любительский': 'Amateur', 'украинский': 'Ukrainian',
    'українська': 'Ukrainian', 'російська': 'Russian', 'русский': 'Russian'
  };

  const i18n = {
    cache: new Map(),
    translator: null,
    state: 'idle',        // idle | loading | ready | gesture | unavailable
    pending: null,

    /** Tampermonkey's sandbox can hide page globals; reach past it when it does. */
    host() {
      try { if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow; } catch (e) {}
      return self;
    },

    cyrillic(s) { return /[Ѐ-ӿ]/.test(s || ''); },

    /** Tier 2: closed vocabulary, exact and instant. */
    term(text) {
      const raw = (text || '').trim();
      if (!raw || !i18n.cyrillic(raw)) return raw;

      const whole = GLOSSARY[raw.toLowerCase().replace(/:$/, '')];
      if (whole) return whole;

      // Genre and country fields arrive as comma-separated lists.
      if (raw.includes(',')) {
        const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
        const mapped = parts.map(p => GLOSSARY[p.toLowerCase()] || p);
        if (mapped.some((m, i) => m !== parts[i])) return mapped.join(', ');
      }

      // "16+ только для взрослых" carries nothing past the number.
      const age = raw.match(/^(\d{1,2}\+)/);
      if (age) return age[1];

      // "93 мин." and "2 сезона" are numbers plus one known word.
      const mins = raw.match(/^(\d+)\s*мин\.?$/);
      if (mins) return `${mins[1]} min`;

      return raw;
    },

    /** Tier 3: on-device model, created lazily and never blocking a render. */
    ensure() {
      if (i18n.pending) return i18n.pending;
      if (i18n.state === 'ready' || i18n.state === 'unavailable') {
        return Promise.resolve(i18n.translator);
      }
      i18n.pending = (async () => {
        const w = i18n.host();
        const API = w.Translator;
        if (!API || typeof API.create !== 'function') { i18n.state = 'unavailable'; return null; }
        try {
          if (typeof API.availability === 'function') {
            const a = await API.availability({ sourceLanguage: 'ru', targetLanguage: 'en' });
            if (a === 'unavailable') { i18n.state = 'unavailable'; return null; }
          }
          i18n.state = 'loading';
          i18n.translator = await API.create({ sourceLanguage: 'ru', targetLanguage: 'en' });
          i18n.state = 'ready';
          return i18n.translator;
        } catch (e) {
          // Downloading the model usually needs a user gesture; wait for one.
          i18n.state = /activation|gesture|NotAllowed/i.test(String(e)) ? 'gesture' : 'unavailable';
          i18n.pending = null;
          if (i18n.state === 'gesture') i18n.onGesture();
          return null;
        }
      })();
      return i18n.pending;
    },

    onGesture() {
      if (i18n.armed) return;
      i18n.armed = true;
      const go = () => { i18n.state = 'idle'; i18n.ensure().then(() => i18n.replay()); };
      addEventListener('pointerdown', go, { once: true, capture: true });
      addEventListener('keydown', go, { once: true, capture: true });
    },

    waiting: new Map(),   // text -> [apply, …]

    /** Translate in the background; the original stays on screen until it lands. */
    live(text, apply) {
      const raw = (text || '').trim();
      if (!raw || !i18n.cyrillic(raw)) return;
      const hit = i18n.cache.get(raw);
      if (hit) { apply(hit); return; }

      if (!i18n.waiting.has(raw)) i18n.waiting.set(raw, []);
      i18n.waiting.get(raw).push(apply);

      i18n.ensure().then(async tr => {
        if (!tr) return;
        try {
          const out = await tr.translate(raw);
          if (!out) return;
          i18n.cache.set(raw, out);
          for (const fn of i18n.waiting.get(raw) || []) fn(out);
          i18n.waiting.delete(raw);
        } catch (e) {}
      });
    },

    /**
     * Voiceover names mix a known vocabulary with studio names that must be
     * left alone ("Дубляж HDrezka Studio"), so substitute phrases in place
     * rather than trying to match the whole string.
     */
    voice(name) {
      const whole = i18n.term(name);
      if (whole !== name) return whole;
      let out = name;
      for (const [re, en] of [
        [/многоголосый\s+закадровый/gi, 'Multi-voice VO'],
        [/двухголосый\s+закадровый/gi, 'Two-voice VO'],
        [/одноголосый\s+закадровый/gi, 'Single-voice VO'],
        [/закадровый/gi, 'Voice-over'],
        [/дубляж/gi, 'Dubbed'],
        [/оригинал/gi, 'Original'],
        [/суб\s*титры|субтитры/gi, 'subtitles'],
        [/украинский|українськ\w*/gi, 'Ukrainian'],
        [/русский|російськ\w*/gi, 'Russian'],
        [/профессиональный/gi, 'Professional'],
        [/любительский/gi, 'Amateur'],
        [/авторский/gi, 'Auteur']
      ]) out = out.replace(re, en);
      return out;
    },

    /** After a late model download, retry whatever was queued. */
    replay() {
      for (const [raw, fns] of [...i18n.waiting]) {
        i18n.live(raw, out => { for (const fn of fns) fn(out); });
      }
    }
  };

  function filename(quality, season = store.season, episode = store.episode) {
    const base = (site.original() || site.title())
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '.')
      .replace(/\.+/g, '.');
    const se = season && episode
      ? `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
      : '';
    return [base, site.year(), se, quality].filter(Boolean).join('.') + '.mp4';
  }

  // ---------------------------------------------------------------- store ----

  const store = {
    streams: {},            // "translator:season:episode" -> parsed list
    subs: {},               // same key -> subtitle tracks
    native: prefs.get(PREF.native, false),
    watching: false,        // the stage is up and the page is out of the way
    scrolled: 0,            // where the info page was when the stage went up
    translator: null,
    season: null,
    episode: null,
    quality: prefs.get(PREF.quality, null),
    caption: null,          // null = whatever the response marked default, 'off', or a track label
    rate: 1,
    status: null,           // { kind: 'wait'|'error', text }
    listeners: [],

    subscribe(fn) { store.listeners.push(fn); },
    emit() { for (const fn of store.listeners) fn(); },
    patch(next) { Object.assign(store, next); store.emit(); },

    key(t = store.translator, s = store.season, e = store.episode) {
      return `${t}:${s || ''}:${e || ''}`;
    },

    current() { return store.streams[store.key()] || null; },
    captions() { return store.subs[store.key()] || []; },
    free() { return (store.current() || []).filter(s => !s.premium); },

    selected() {
      const free = store.free();
      if (!free.length) return null;
      return free.find(s => s.label === store.quality) || free[0];
    }
  };

  // ----------------------------------------------------------- throughput ----
  // How fast the file is actually arriving, and whether that is enough.
  //
  // The reliable signal costs nothing: <video>.buffered tells us how many
  // seconds of video have arrived, so seconds-buffered per second-of-wall-clock
  // is the headroom. Above 1 the download outpaces playback and it will not
  // stall. Turning that into Mbit/s needs the file size, which is cross-origin
  // and therefore only reachable through GM_xmlhttpRequest — so absolute
  // figures are a bonus, never the thing correctness rests on.

  const speed = {
    samples: [],
    size: null,
    duration: null,
    sizes: new Map(),        // url -> bytes | null (null = asked, unavailable)

    reset() { speed.samples = []; speed.size = null; speed.duration = null; },

    push(buffered, t) {
      const s = speed.samples;
      const last = s[s.length - 1];
      // A seek rewinds buffered; start a fresh window rather than report a dip.
      if (last && buffered < last.b) { speed.samples = [{ b: buffered, t }]; return; }
      s.push({ b: buffered, t });
      while (s.length > 2 && t - s[0].t > 20000) s.shift();
    },

    /** Seconds of video arriving per second of wall clock. */
    rate() {
      const s = speed.samples;
      if (s.length < 2) return null;
      const dt = (s[s.length - 1].t - s[0].t) / 1000;
      if (dt < 2) return null;
      return Math.max(0, (s[s.length - 1].b - s[0].b) / dt);
    },

    bitrate() {
      if (!speed.size || !speed.duration) return null;
      return (speed.size * 8) / speed.duration;
    },

    throughput() {
      const r = speed.rate(), b = speed.bitrate();
      return r === null || b === null ? null : r * b;
    },

    /**
     * How much of a cushion there is, from two independent angles.
     *
     * Fill rate alone is misleading: CDNs commonly pace delivery to roughly
     * real time once the player is comfortable, so a perfectly healthy stream
     * sits at 1.0x forever. What actually predicts a stall is how many seconds
     * are buffered ahead of the playhead — so a deep buffer is enough on its
     * own, and so is a fast fill.
     */
    verdict(rate, done, ahead) {
      if (done) return 'good';
      if (ahead >= 30 || (rate !== null && rate >= 2)) return 'good';
      if (ahead >= 10 || (rate !== null && rate >= 1.15)) return 'ok';
      if (rate === null) return 'idle';
      return 'poor';
    },

    /** Cross-origin HEAD; only Tampermonkey-style managers can do this. */
    probe(url) {
      if (speed.sizes.has(url)) return Promise.resolve(speed.sizes.get(url));
      if (typeof GM_xmlhttpRequest !== 'function') return Promise.resolve(null);
      return new Promise(resolve => {
        const done = bytes => { speed.sizes.set(url, bytes); resolve(bytes); };
        try {
          GM_xmlhttpRequest({
            method: 'HEAD', url, timeout: 9000,
            onload: r => {
              const m = /content-length:\s*(\d+)/i.exec(r.responseHeaders || '');
              done(m ? parseInt(m[1], 10) : null);
            },
            onerror: () => done(null),
            ontimeout: () => done(null)
          });
        } catch (e) { done(null); }
      });
    },

    tick() {
      const v = player.video;
      if (!v || !ui.el.speedText) return;
      const d = isFinite(v.duration) && v.duration > 0 ? v.duration : null;
      if (d) speed.duration = d;
      const end = v.buffered?.length ? v.buffered.end(v.buffered.length - 1) : 0;
      if (!v.paused) speed.push(end, Date.now());

      const done = d ? end >= d - 0.5 : false;
      const ahead = Math.max(0, end - (v.currentTime || 0));
      const rate = speed.rate();
      const level = speed.verdict(rate, done, ahead);
      const bits = speed.throughput();

      const parts = [];
      if (bits) parts.push(fmtRate(bits));
      if (done) {
        parts.push('fully downloaded');
      } else {
        if (ahead > 0) parts.push(`${Math.round(ahead)}s buffered`);
        if (rate !== null) parts.push(`${rate.toFixed(1)}× headroom`);
        if (level === 'idle') parts.push('measuring…');
        if (level === 'poor') parts.push('may stall');
      }
      if (speed.size) parts.push(fmtSize(speed.size));

      ui.el.speed.hidden = false;
      ui.el.speedText.textContent = parts.join(' · ');
      ui.el.speedDot.className = 'pulse ' + level;
      // The same line, where it can be read without leaving the film.
      if (ui.el.cmStat && !ui.el.cmenu?.hidden) ui.el.cmStat.textContent = ui.el.speedText.textContent;
    }
  };

  // ---------------------------------------------------------------- batch ----
  // Download a whole show from a chosen point, one episode at a time.
  //
  // Two things make this reliable rather than a for-loop:
  //
  //   * stream URLs are per-episode and carry an expiry stamp, so each one is
  //     resolved immediately before its own download, never queued up front;
  //   * one download at a time, with retries, and a failure never stops the
  //     queue — it is recorded and the run moves on.
  //
  // Progress is written to storage after every episode, so closing the tab
  // mid-run loses at most the episode that was in flight.

  const wait = ms => new Promise(r => setTimeout(r, ms));

  const batch = {
    items: [],
    index: 0,
    state: 'idle',        // idle | running | paused | done
    progress: null,       // { loaded, total } for the episode in flight
    handle: null,         // whatever GM_download handed back, if anything
    cancelled: false,

    // Sequencing needs a completion signal, and only GM_download gives one.
    available() { return typeof GM_download === 'function'; },

    /** Every episode at or after (season, episode), in broadcast order. */
    plan(season, episode) {
      const map = site.episodes();
      const order = site.seasons().map(s => s.id);
      const seasons = order.length ? order : Object.keys(map).sort((a, b) => a - b);
      const out = [];
      let started = false;
      for (const s of seasons) {
        for (const ep of (map[s] || [])) {
          if (!started) {
            if (String(s) === String(season) && String(ep.id) === String(episode)) started = true;
            else continue;
          }
          out.push({ season: String(s), episode: String(ep.id), status: 'pending', error: '' });
        }
      }
      return out;
    },

    counts() {
      const c = { done: 0, failed: 0, pending: 0, total: batch.items.length };
      for (const i of batch.items) {
        if (i.status === 'done') c.done++;
        else if (i.status === 'failed') c.failed++;
        else c.pending++;
      }
      return c;
    },

    start(season, episode) {
      batch.items = batch.plan(season, episode);
      batch.index = 0;
      if (!batch.items.length) return;
      batch.resume();
    },

    resume() {
      if (batch.state === 'running') return;
      batch.cancelled = false;
      batch.state = 'running';
      batchView.update();
      batch.step();
    },

    pause() {
      // Let the episode in flight finish; just stop taking new ones.
      if (batch.state === 'running') batch.state = 'paused';
      batchView.update();
    },

    stop() {
      batch.cancelled = true;
      batch.state = 'idle';
      batch.abort();
      batch.items = [];
      batch.index = 0;
      batch.progress = null;
      prefs.set(PREF.batch, null);
      batchView.update();
    },

    skip() {
      batch.cancelled = true;      // makes the in-flight download reject
      batch.abort();
    },

    abort() {
      try { batch.handle?.abort?.(); } catch (e) {}
      batch.handle = null;
    },

    async step() {
      if (batch.state !== 'running') return;
      const item = batch.items[batch.index];
      if (!item) { batch.finish(); return; }

      item.status = 'active';
      item.error = '';
      batch.progress = null;
      batchView.update();

      try {
        const res = await batch.resolve(item);
        const stream = batch.choose(res.list);
        if (!stream) throw new Error('no free quality');
        await batch.fetchFile(item, stream);
        item.status = 'done';
      } catch (e) {
        item.status = batch.cancelled && !e.__real ? 'skipped' : 'failed';
        item.error = e.message || 'failed';
      }

      batch.cancelled = false;
      batch.progress = null;
      batch.index++;
      batch.save();
      batchView.update();

      if (batch.state === 'running') {
        await wait(700);            // don't hammer their endpoint
        batch.step();
      }
    },

    /** Fresh URL per episode — they expire, so this cannot be done in advance. */
    async resolve(item, attempts = 3) {
      let last;
      for (let i = 0; i < attempts; i++) {
        if (batch.cancelled) throw new Error('skipped');
        try {
          return await api.request({
            id: site.id(),
            translatorId: store.translator,
            season: item.season,
            episode: item.episode,
            series: true
          });
        } catch (e) {
          last = e;
          await wait(700 * (i + 1));
        }
      }
      throw last;
    },

    /** Honour the chosen quality, falling back to the best free one. */
    choose(list) {
      const free = (list || []).filter(s => !s.premium);
      if (!free.length) return null;
      return free.find(s => s.label === store.quality) || free[0];
    },

    async fetchFile(item, stream, attempts = 2) {
      let last;
      for (let i = 0; i < attempts; i++) {
        if (batch.cancelled) throw new Error('skipped');
        try { return await batch.once(item, stream); }
        catch (e) { last = e; if (batch.cancelled) throw e; await wait(900); }
      }
      throw last;
    },

    once(item, stream) {
      return new Promise((resolve, reject) => {
        const name = filename(stream.label, item.season, item.episode);
        let settled = false;
        const finish = fn => (arg) => { if (settled) return; settled = true; batch.handle = null; fn(arg); };
        const fail = finish(err => {
          const e = new Error(err?.error || err?.message || 'download failed');
          e.__real = true;
          reject(e);
        });
        try {
          batch.handle = GM_download({
            url: stream.url,
            name,
            saveAs: false,
            onprogress: p => { batch.progress = p; batchView.tickProgress(); },
            onload: finish(() => resolve()),
            onerror: fail,
            ontimeout: fail
          });
        } catch (e) { fail(e); }
      });
    },

    finish() {
      batch.state = 'done';
      batch.progress = null;
      batch.save();
      batchView.update();
    },

    retryFailed() {
      for (const i of batch.items) if (i.status === 'failed' || i.status === 'skipped') i.status = 'pending';
      batch.index = batch.items.findIndex(i => i.status === 'pending');
      if (batch.index < 0) return;
      batch.resume();
    },

    save() {
      prefs.set(PREF.batch, {
        id: site.id(),
        translator: store.translator,
        index: batch.index,
        state: batch.state === 'running' ? 'paused' : batch.state,
        items: batch.items.map(i => ({ ...i, status: i.status === 'active' ? 'pending' : i.status }))
      });
    },

    /** Pick a run back up after a reload, but never resume without a click. */
    restore() {
      const saved = prefs.get(PREF.batch, null);
      if (!saved || saved.id !== site.id() || !Array.isArray(saved.items)) return false;
      if (!saved.items.some(i => i.status === 'pending')) return false;
      batch.items = saved.items;
      batch.index = Math.max(0, saved.index || 0);
      batch.state = 'paused';
      return true;
    }
  };

  const fmtSize = b => !b ? '' : b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`;
  const fmtRate = bps => bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} Mbps` : `${Math.round(bps / 1e3)} kbps`;

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
      /* The hero backdrop is a 100vw band inside a page that has a scrollbar,
         so it is always a little wider than the room available. Clipping keeps
         that from becoming a horizontal scrollbar, and clip rather than hidden
         so this never becomes a scroll container of its own. */
      min-height: 100vh; overflow-x: hidden; overflow-x: clip;
      background: var(--bg); color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: 1160px; margin: 0 auto; padding: 0 20px; }

    /* ---- top bar ---- */
    .bar { position: sticky; top: 0; z-index: 40; background: rgba(11,11,14,.86);
           -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
           border-bottom: 1px solid var(--line); }
    .bar .wrap { display: flex; align-items: center; gap: 14px; height: 60px; }
    .nav { display: flex; align-items: center; gap: 2px; flex: none; }
    .nav a { padding: 7px 11px; border-radius: 8px; color: var(--dim); text-decoration: none;
             font-size: 13px; white-space: nowrap; transition: color .12s ease, background .12s ease; }
    .nav a:hover { color: var(--ink); background: rgba(255,255,255,.05); }
    .nav a[aria-current="page"] { color: var(--ink); background: rgba(255,255,255,.09); }
    @media (max-width: 1000px) { .nav a.wide { display: none; } }
    @media (max-width: 760px) { .nav { display: none; } }
    .brand { display: flex; align-items: center; gap: 9px; cursor: pointer;
             background: none; border: 0; padding: 0; flex: none; }
    .brand .mark { width: 27px; height: 27px; border-radius: 8px; display: block; flex: none;
                   box-shadow: 0 2px 8px rgba(10,132,255,.35); transition: transform .14s ease; }
    .brand:hover .mark { transform: translateY(-1px); }
    .brand .word { font-size: 15.5px; font-weight: 680; letter-spacing: -.025em; color: var(--ink); }
    .brand:hover .word { color: #fff; }
    /* min-width: 0 on both, or the input's intrinsic width holds the box open
       and pushes the escape hatch off the end of a narrow header. */
    .search { position: relative; flex: 1; min-width: 0; max-width: 420px;
              display: flex; align-items: center; gap: 8px;
              padding: 7px 12px; border-radius: 9px; background: var(--surface);
              border: 1px solid var(--line); }
    .search input { min-width: 0; }
    .sugg { position: absolute; left: 0; right: 0; top: calc(100% + 7px); z-index: 50;
            max-height: 380px; overflow-y: auto; padding: 6px;
            background: var(--raised); border: 1px solid var(--line-strong); border-radius: 12px;
            box-shadow: 0 18px 44px rgba(0,0,0,.55); }
    .sugg[hidden] { display: none; }
    .sugg::-webkit-scrollbar { width: 7px; }
    .sugg::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 8px; }
    .sg { display: flex; align-items: baseline; gap: 9px; width: 100%; padding: 8px 10px; border: 0;
          border-radius: 8px; background: transparent; color: inherit; text-decoration: none;
          cursor: pointer; text-align: left; font-size: 13px; }
    .sg:hover, .sg[aria-selected="true"] { background: rgba(255,255,255,.09); }
    .sg .name { flex: none; max-width: 58%; font-weight: 550;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sg .note { flex: 1; min-width: 0; color: var(--faint); font-size: 12px;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sg .rate { flex: none; color: var(--dim); font-size: 12px; font-variant-numeric: tabular-nums; }
    .sg.all { margin-top: 5px; padding-top: 11px; border-top: 1px solid var(--line); border-radius: 0; }
    .sg.all .name { max-width: 100%; color: var(--dim); font-weight: 500; }
    .search:focus-within { border-color: var(--line-strong); }
    .search input { flex: 1; background: none; border: 0; outline: none; color: var(--ink); font-size: 13px; }
    .search input::placeholder { color: var(--faint); }
    .bar .spacer { flex: 1; }
    .ghost { padding: 7px 11px; border: 1px solid var(--line); border-radius: 9px;
             background: transparent; color: var(--dim); font-size: 12px; cursor: pointer; flex: none; }
    .ghost:hover { color: var(--ink); border-color: var(--line-strong); }

    /* ---- info page ---- */
    /* The page a title opens on: everything you need to decide, and one button
       that clears it all away. The player itself lives in .stage and is only
       ever shown in watch mode. */
    .hero { position: relative; padding: 32px 0 10px; }
    /* The backdrop is absolutely positioned and therefore paints above the
       ordinary flow that follows it. Everything after the hero has to be
       positioned too, or the details table ends up behind the blur. */
    .sect, .batch, .meta { position: relative; }
    .drop { position: absolute; left: 50%; top: -100px; width: 100vw; max-width: 1700px; height: 480px;
            transform: translateX(-50%); overflow: hidden; pointer-events: none; }
    .drop img { width: 100%; height: 100%; object-fit: cover; transform: scale(1.2);
                filter: blur(64px) saturate(1.5) brightness(.5); opacity: .6; }
    .drop::after { content: ''; position: absolute; inset: 0; background:
      linear-gradient(180deg, rgba(11,11,14,.5) 0%, rgba(11,11,14,.8) 52%, var(--bg) 100%); }

    .hero-in { position: relative; display: grid; grid-template-columns: 222px 1fr; gap: 30px; align-items: start; }
    .art .poster { width: 100%; display: block; border-radius: 14px; border: 1px solid var(--line);
                   box-shadow: 0 24px 58px rgba(0,0,0,.6); }
    /* No poster, or one that failed to load: an empty frame, never a broken image. */
    .art.blank { width: 100%; aspect-ratio: 2/3; border-radius: 14px;
                 background: var(--surface); border: 1px solid var(--line); }
    .drop.blank { display: none; }
    .lede { display: flex; flex-direction: column; gap: 15px; min-width: 0; }

    .head { display: flex; flex-direction: column; gap: 5px; }
    .head h1 { font-size: 33px; font-weight: 680; letter-spacing: -.026em; line-height: 1.13; text-wrap: balance; }
    .head .orig { color: var(--dim); font-size: 14.5px; }
    .facts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--dim); font-size: 13px; margin-top: 5px; }
    .facts .sep { width: 3px; height: 3px; border-radius: 50%; background: var(--faint); }
    .score { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 6px;
             background: var(--raised); color: var(--ink); font-weight: 600; font-size: 12.5px;
             font-variant-numeric: tabular-nums; }
    .score .star { color: #f5c451; }

    /* ---- watch mode: the stage ---- */
    /* A fixed sheet over everything, holding one frame and the light it throws.
       Nothing else is on screen — no header, no controls, no page. */
    .stage { display: none; --pad: clamp(14px, 3.4vh, 46px); }
    .app.watching main.wrap > *:not(.stage) { display: none; }
    .app.watching .bar { display: none; }
    .app.watching .stage {
      display: grid; place-items: center; position: fixed; inset: 0; z-index: 80; padding: var(--pad);
      background: radial-gradient(130% 100% at 50% 42%, #0a0a11 0%, #060609 62%, #030304 100%);
    }
    .app.watching .stage.idle { cursor: none; }

    /* Fullscreen means the screen. The padding that gives the stage its margin
       goes to zero, and with it the rounded corners, the border and the drop
       shadow — all of which only make sense against something. The frame keeps
       the film's shape, so a 2.35:1 release still fills the width edge to edge
       and the glow gets the bars above and below to itself.
       The class is set from fullscreenchange as well: :fullscreen on an element
       inside a shadow root has been unreliable. */
    .stage.full, .stage:fullscreen { --pad: 0px; background: #000; }
    .stage.full .screen, .stage:fullscreen .screen {
      border-radius: 0; border-color: transparent; box-shadow: none;
    }
    .stage.full .topbar, .stage:fullscreen .topbar { border-radius: 0; }

    /* The frame takes the film's own shape once metadata lands, so there are no
       black bars for the glow to spill out of. */
    .frame { position: relative; aspect-ratio: var(--ar, 16 / 9);
             width: min(calc(100vw - var(--pad) * 2), calc((100vh - var(--pad) * 2) * var(--arn, 1.7778))); }
    /* The halo has to die out on its own. Left to end at the element's own
       edge it reads as a coloured bar down the side of the screen — worst in
       fullscreen, where the pillarbox gives it room to be seen. The mask fades
       it to nothing well before then, and the blur scales with the window so a
       phone does not get a desktop's worth of it. */
    .glow, .ambient {
      position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0;
      pointer-events: none; transform: scale(1.14);
      -webkit-mask-image: radial-gradient(closest-side, #000 48%, transparent 100%);
      mask-image: radial-gradient(closest-side, #000 48%, transparent 100%);
    }
    .glow { filter: blur(clamp(30px, 6vmin, 90px)) saturate(1.25); opacity: .5;
            transition: opacity .6s ease; }
    .ambient { background-size: cover; background-position: center;
               filter: blur(clamp(30px, 6vmin, 90px)) saturate(1.2) brightness(.9);
               opacity: .4; transition: opacity .8s ease; }
    /* Once real frames are arriving the poster's glow steps aside. */
    .frame.live .ambient { opacity: 0; }

    .screen { position: absolute; inset: 0; z-index: 1; background: #000;
              border: 1px solid rgba(255,255,255,.07); border-radius: 16px; overflow: hidden;
              box-shadow: 0 40px 90px rgba(0,0,0,.6); }
    .screen video { width: 100%; height: 100%; display: block; background: #000; }
    /* align-content matters as much as align-items here: without it the two
       implicit rows stretch to fill the veil and each child centres inside its
       own track rather than in the frame. An empty message must not hold a row
       open either, or the button sits half a gap high. */
    .screen .veil { position: absolute; inset: 0; display: grid; place-items: center;
                    align-content: center; gap: 10px;
                    background: #000; text-align: center; padding: 24px; }
    .screen .veil[hidden] { display: none; }
    .screen.native .chrome, .screen.native .veil { display: none !important; }
    .screen .veil .msg:empty { display: none; }
    .screen .veil .msg { color: var(--dim); font-size: 13px; max-width: 46ch; }
    .poster-blur { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
                   filter: blur(28px) brightness(.35); transform: scale(1.1); }

    /* Stalled, not broken. Shown only once playback has actually started, so
       the first buffer sits under the poster rather than on top of it. */
    .spin { position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px;
            z-index: 2; pointer-events: none; border-radius: 50%;
            border: 3px solid rgba(255,255,255,.22); border-top-color: #fff;
            animation: rzk-spin .8s linear infinite; }
    .spin[hidden] { display: none; }
    @keyframes rzk-spin { to { transform: rotate(360deg); } }

    .bigplay { width: 68px; height: 68px; border-radius: 50%; border: 0; cursor: pointer;
               background: rgba(255,255,255,.94); color: #000; display: grid; place-items: center;
               position: relative; transition: transform .12s ease; }
    .bigplay:hover { transform: scale(1.06); }

    /* The only furniture over the film, and it goes away with the cursor. */
    .topbar { position: absolute; left: 0; right: 0; top: 0; z-index: 3; display: flex; align-items: center;
              gap: 14px; padding: 14px 16px 38px; color: #fff; opacity: 0; pointer-events: none;
              border-radius: 16px 16px 0 0;
              background: linear-gradient(to bottom, rgba(0,0,0,.62), transparent);
              transition: opacity .22s ease; }
    .stage:not(.idle) .topbar { opacity: 1; pointer-events: auto; }
    .stage.idle .topbar, .stage.idle .chrome { pointer-events: none; }
    .topbar .back { display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px 8px 10px;
                    border-radius: 10px; border: 1px solid rgba(255,255,255,.14);
                    background: rgba(22,22,28,.6); color: #fff; font-size: 13px; cursor: pointer;
                    -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
    .topbar .back:hover { background: rgba(44,44,54,.78); }
    .topbar .now { font-size: 13.5px; color: rgba(255,255,255,.7); overflow: hidden;
                   text-overflow: ellipsis; white-space: nowrap; }

    /* ---- player chrome ---- */
    .chrome { position: absolute; left: 0; right: 0; bottom: 0; padding: 44px 16px 12px; z-index: 2;
              background: linear-gradient(to top, rgba(0,0,0,.85), rgba(0,0,0,.3) 55%, transparent);
              opacity: 0; transition: opacity .2s ease; }
    .stage:not(.idle) .chrome { opacity: 1; }
    /* Keyboard focus holds the controls open; a mouse click must not, or the
       button you just pressed pins them to the screen for the rest of the film.
       Kept as its own rule so a browser without :has() loses only this. */
    .chrome:has(:focus-visible), .topbar:has(:focus-visible) { opacity: 1; pointer-events: auto; }
    .scrub { position: relative; height: 18px; display: flex; align-items: center; cursor: pointer; }
    .scrub .track { position: relative; height: 4px; width: 100%; border-radius: 4px; background: rgba(255,255,255,.24);
                    transition: height .12s ease; }
    .scrub:hover .track { height: 6px; }
    .scrub .buf { position: absolute; inset: 0 auto 0 0; height: 100%; border-radius: 4px; background: rgba(255,255,255,.32); }
    .scrub .fill { position: absolute; inset: 0 auto 0 0; height: 100%; border-radius: 4px; background: var(--accent); }
    .scrub .knob { position: absolute; top: 50%; width: 13px; height: 13px; border-radius: 50%;
                   background: #fff; transform: translate(-50%,-50%); opacity: 0; transition: opacity .12s;
                   box-shadow: 0 2px 8px rgba(0,0,0,.5); }
    .scrub:hover .knob, .scrub[data-dragging] .knob { opacity: 1; }
    .scrub[data-dragging] .track { height: 6px; }
    .scrub .bubble { position: absolute; bottom: 22px; transform: translateX(-50%);
                     padding: 3px 8px; border-radius: 7px; background: rgba(0,0,0,.82);
                     border: 1px solid rgba(255,255,255,.1); color: #fff; font-size: 11.5px;
                     font-variant-numeric: tabular-nums; white-space: nowrap; pointer-events: none;
                     opacity: 0; transition: opacity .12s ease; }
    .scrub:hover .bubble, .scrub[data-dragging] .bubble { opacity: 1; }
    .scrub .bubble:empty { display: none; }
    .ctrls { display: flex; align-items: center; gap: 6px; padding-top: 6px; color: #fff; }
    .ctrls button { width: 38px; height: 38px; display: grid; place-items: center; border: 0;
                    border-radius: 9px; background: transparent; color: #fff; cursor: pointer;
                    transition: background .12s ease; }
    .ctrls button:hover { background: rgba(255,255,255,.15); }
    .ctrls .time { font-size: 12.5px; font-variant-numeric: tabular-nums; color: rgba(255,255,255,.86);
                   padding: 0 8px; white-space: nowrap; }
    .ctrls .gap { flex: 1; }
    .vol { width: 82px; height: 4px; border-radius: 4px; background: rgba(255,255,255,.24); position: relative; cursor: pointer; }
    .vol .fill { position: absolute; inset: 0 auto 0 0; height: 100%; border-radius: 4px; background: #fff; }

    /* A wide film on a narrow window leaves a picture too short to hold the
       controls. Rather than cover it, they step off onto the black around it —
       the stage fills the viewport, so fixed here means the stage's own edges. */
    .stage.tight .topbar, .stage.tight .chrome { position: fixed; background: none; }
    .stage.tight .topbar { top: 0; left: 0; right: 0; padding: 12px 14px; }
    .stage.tight .chrome { top: auto; bottom: 0; left: 0; right: 0; padding: 8px 14px 12px; }
    .stage.tight .bigplay { width: 52px; height: 52px; }

    /* ---- right-click menu ---- */
    .cmenu { position: absolute; z-index: 10; min-width: 236px; padding: 6px; color: #fff;
             font-size: 13px; -webkit-user-select: none; user-select: none;
             background: rgba(24,24,30,.9); border: 1px solid rgba(255,255,255,.13); border-radius: 13px;
             -webkit-backdrop-filter: blur(24px) saturate(1.7); backdrop-filter: blur(24px) saturate(1.7);
             box-shadow: 0 24px 60px rgba(0,0,0,.62), inset 0 1px 0 rgba(255,255,255,.07);
             animation: cm-in .12s ease both; }
    .cmenu[hidden] { display: none; }
    @keyframes cm-in { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
    .cm { position: relative; display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 10px;
          border: 0; border-radius: 8px; background: transparent; color: inherit; font-size: 13px;
          text-align: left; cursor: pointer; }
    .cm[hidden] { display: none; }
    .cm:hover:not([aria-disabled="true"]):not(:disabled), .cm.open,
    .cm:focus-visible { background: rgba(255,255,255,.12); }
    .cm:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .cm .ic { width: 16px; height: 16px; flex: none; display: grid; place-items: center; opacity: .75; }
    .cm .lbl { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cm .val { flex: none; max-width: 116px; color: var(--dim); font-size: 12px;
               white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cm kbd { flex: none; font: inherit; font-size: 11px; color: var(--faint); }
    .cm .arrow { flex: none; opacity: .4; }
    .cm:disabled, .cm[aria-disabled="true"] { opacity: .35; cursor: default; }
    .cmsep { height: 1px; margin: 5px 9px; background: rgba(255,255,255,.09); }
    .cmstat { padding: 6px 10px 3px; font-size: 11.5px; color: var(--faint);
              font-variant-numeric: tabular-nums; white-space: nowrap; }
    .cmstat:empty { display: none; }
    .flyout { position: absolute; left: calc(100% + 5px); top: -6px; display: none; z-index: 2;
              min-width: 158px; max-height: 264px; overflow-y: auto; padding: 6px;
              background: rgba(28,28,35,.96); border: 1px solid rgba(255,255,255,.13); border-radius: 12px;
              box-shadow: 0 20px 46px rgba(0,0,0,.6); }
    .flyout::-webkit-scrollbar { width: 7px; }
    .flyout::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 8px; }
    .cm.open .flyout { display: block; }
    .cm.flip .flyout { left: auto; right: calc(100% + 5px); }
    .cm.up .flyout { top: auto; bottom: -6px; }
    .flyout .opt { font-size: 12.5px; }

    /* ---- control strip on the info page ---- */
    .strip { display: flex; flex-direction: column; align-items: stretch; gap: 10px; padding: 6px 0 0; }
    .trow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .strip .grow { flex: 1; }
    .row { position: relative; }

    .watch { display: inline-flex; align-items: center; gap: 9px; padding: 12px 22px 12px 17px; flex: none;
             border: 0; border-radius: 12px; cursor: pointer; color: #fff; font-size: 15px; font-weight: 620;
             background: linear-gradient(180deg, #2f97ff, #0a6cf0);
             box-shadow: 0 10px 26px rgba(10,132,255,.34), inset 0 1px 0 rgba(255,255,255,.22);
             transition: transform .12s ease, box-shadow .16s ease, filter .16s ease; }
    .watch:hover:not(:disabled) { transform: translateY(-1px);
             box-shadow: 0 14px 34px rgba(10,132,255,.45), inset 0 1px 0 rgba(255,255,255,.26); }
    .watch:active:not(:disabled) { transform: translateY(0); }
    .watch:disabled { filter: grayscale(.75); opacity: .4; cursor: default; box-shadow: none; }
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

    .speed { display: flex; align-items: center; gap: 8px; padding: 8px 0 0;
             font-size: 12.5px; color: var(--dim); font-variant-numeric: tabular-nums; }
    .speed[hidden] { display: none; }
    .pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); flex: none; }
    .pulse.good { background: #35c759; }
    .pulse.ok { background: #f5c451; }
    .pulse.poor { background: #ff6b6b; }
    .pulse.idle { background: var(--faint); }

    /* ---- batch download ---- */
    .batch { margin-top: 16px; padding: 14px; border: 1px solid var(--line);
             border-radius: 12px; background: var(--surface); }
    .batch[hidden] { display: none; }
    .batch h2 { font-size: 13px; font-weight: 600; margin-bottom: 10px; }
    .batch .line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .batch select { padding: 7px 9px; border-radius: 8px; background: var(--raised);
                    color: var(--ink); border: 1px solid var(--line); font-size: 13px; cursor: pointer; }
    .batch .hint { font-size: 12.5px; color: var(--dim); padding-top: 8px; }
    .batch .hint.warn { color: var(--bad); }
    /* Named for what it is: ".bar" collided with the page header. */
    .batch .progress { position: relative; height: 4px; border-radius: 4px;
                       background: rgba(255,255,255,.1); margin: 10px 0 8px; overflow: hidden; }
    .batch .progress i { position: absolute; inset: 0 auto 0 0; background: var(--accent);
                         border-radius: 4px; transition: width .2s ease; }
    .batch .now { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
    .batch .now b { font-weight: 600; font-variant-numeric: tabular-nums; }
    .batch .now span { color: var(--dim); font-size: 12.5px; font-variant-numeric: tabular-nums; }
    .batch .tally { display: flex; gap: 12px; font-size: 12.5px; color: var(--dim);
                    padding-top: 2px; font-variant-numeric: tabular-nums; }
    .batch .tally .bad { color: var(--bad); }

    /* ---- episodes ---- */
    .season[hidden] { display: none; }
    .eps { display: grid; grid-template-columns: repeat(auto-fill, minmax(58px, 1fr)); gap: 7px; }
    .ep { padding: 9px 6px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface);
          color: var(--dim); font-size: 13px; cursor: pointer; font-variant-numeric: tabular-nums; }
    .ep:hover { color: var(--ink); border-color: var(--line-strong); }
    .ep[aria-current="true"] { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }

    /* ---- details ---- */
    .lede .synopsis { color: var(--dim); font-size: 14.5px; line-height: 1.6; max-width: 70ch; }
    .sect { padding: 26px 0 0; }
    .sect > h2 { font-size: 11.5px; font-weight: 620; letter-spacing: .08em; text-transform: uppercase;
                 color: var(--faint); padding-bottom: 12px; }
    .meta { padding: 26px 0 64px; border-top: 1px solid var(--line); margin-top: 28px; }
    .meta dl { display: grid; grid-template-columns: 168px 1fr; gap: 9px 20px; font-size: 13px; max-width: 780px; }
    .meta dt { color: var(--faint); }
    .meta dd { color: var(--ink); }
    .meta dd a, .who { color: #6cb4ff; text-decoration: none; }
    .meta dd a:hover, .who:hover { text-decoration: underline; }

    /* ---- cast ---- */
    .faces { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 14px 12px; }
    .face { display: flex; align-items: center; gap: 10px; text-decoration: none; color: inherit;
            padding: 6px; border-radius: 11px; transition: background .12s ease; min-width: 0; }
    .face:hover { background: rgba(255,255,255,.05); }
    .face .shot { width: 42px; height: 42px; flex: none; border-radius: 50%; overflow: hidden;
                  background: var(--raised); display: grid; place-items: center;
                  color: var(--faint); font-size: 14px; font-weight: 600; }
    /* These are 2:3 headshots going into a circle, so a third of the height is
       cropped away. Taken from the middle it lands on the mouth: hair off the
       top, chin off the bottom. The face sits a little above centre in almost
       every portrait ever taken, so the crop follows it up. */
    .face .shot img { width: 100%; height: 100%; object-fit: cover;
                      object-position: 50% 28%; display: block; }
    .face .who { min-width: 0; font-size: 13px; line-height: 1.3; color: var(--ink); }
    .face:hover .who { color: #fff; text-decoration: none; }

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
    @media (max-width: 860px) {
      .hero-in { grid-template-columns: 148px 1fr; gap: 20px; }
      .head h1 { font-size: 25px; }
    }
    @media (max-width: 620px) {
      /* A search box squeezed between the logo and the escape hatch is too
         narrow to type into. Give it the whole of a second row instead. */
      .bar .wrap { flex-wrap: wrap; height: auto; padding-top: 10px; padding-bottom: 10px; gap: 10px; }
      .search { order: 3; flex-basis: 100%; max-width: none; }
      .hero-in { grid-template-columns: 1fr; }
      .art { max-width: 148px; }
      .meta dl { grid-template-columns: 1fr; gap: 2px 0; }
      .meta dd { padding-bottom: 8px; }
      .watch { width: 100%; justify-content: center; }
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
    // Right-click menu furniture. One stroke weight, one 24-grid, so the column
    // of icons reads as a column and not as a collection.
    arrow: '<svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
    back: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>',
    pip: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><rect x="12" y="11.5" width="7" height="6" rx="1.5" fill="currentColor" stroke="none"/></svg>',
    gauge: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 17a8 8 0 1 1 16 0"/><path d="m12 14 4-4"/></svg>',
    cc: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 10.5a2 2 0 1 0 0 3M16.5 10.5a2 2 0 1 0 0 3"/></svg>',
    hd: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M8 9.5v5M11 9.5v5M8 12h3M14 14.5v-5h1.5a2.5 2.5 0 0 1 0 5z"/></svg>',
    voice: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.4 3.3 5.3 3.3 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.3-5.3-3.3-8.5S9.8 5.9 12 3.5z"/></svg>',
    list: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/></svg>',
    link: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M10.5 13.5a3.6 3.6 0 0 0 5.2.2l2.6-2.6a3.6 3.6 0 1 0-5.1-5.1L11.7 7.5"/><path d="M13.5 10.5a3.6 3.6 0 0 0-5.2-.2l-2.6 2.6a3.6 3.6 0 1 0 5.1 5.1l1.5-1.5"/></svg>',
    send: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8.5 7H17v8.5"/></svg>',
    dots: '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>',
    screen: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.8" y="4.5" width="18.4" height="12.5" rx="2.5"/><path d="M9 20.5h6"/></svg>',
    next: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5.5v13l9-6.5z"/><rect x="16.4" y="5.5" width="2.4" height="13" rx="1.1"/></svg>',
    logo: `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs><linearGradient id="rzk-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#4aa8ff"/><stop offset="1" stop-color="#0a5cff"/>
      </linearGradient></defs>
      <rect width="32" height="32" rx="9" fill="url(#rzk-g)"/>
      <text x="16" y="23" text-anchor="middle" fill="#fff" font-size="20" font-weight="700"
            font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif">R</text>
    </svg>`,
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
      if (!document.body || document.getElementById('rzk-app')) return;
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
      ui.mend();
      ui.bindBar();

      // The cover becomes the real thing: swap boot -> on and let it fade.
      clearTimeout(bootTimer);
      document.documentElement.setAttribute('data-rzk', 'on');
      holdBody();
    },

    cache() {
      ui.el = {};
      for (const el of ui.root.querySelectorAll('[data-el]')) ui.el[el.dataset.el] = el;
    },

    /**
     * Posters and cast photos come from a CDN that is not always willing. A
     * broken image reads worse than none at all, so each one carries what to
     * fall back to: an initial for a face, an empty frame for anything else.
     */
    mend() {
      for (const img of ui.root.querySelectorAll('img[data-mend]')) {
        img.addEventListener('error', () => {
          const box = img.parentElement;
          const text = img.dataset.mend;
          img.remove();
          if (text) box.textContent = text;
          else box?.classList.add('blank');
        }, { once: true });
      }
    },

    // Two catalogues and the site's own two "best" listings — the whole of it.
    NAV: [
      { label: 'Films', path: '/films/' },
      { label: 'Series', path: '/series/' },
      { label: 'Top films', path: '/films/best/', wide: true },
      { label: 'Top shows', path: '/series/best/', wide: true }
    ],

    nav() {
      let here = '';
      try { here = location.pathname || ''; } catch (e) {}
      // Longest match wins, so /films/best/ is "Top films" and not "Films".
      const active = [...ui.NAV].sort((a, b) => b.path.length - a.path.length)
        .find(n => here.startsWith(n.path))?.path;
      return ui.NAV.map(n =>
        `<a href="${n.path}"${n.wide ? ' class="wide"' : ''}${
          n.path === active ? ' aria-current="page"' : ''}>${esc(n.label)}</a>`).join('');
    },

    bar() {
      return `
      <header class="bar">
        <div class="wrap">
          <button class="brand" data-el="brand" type="button" aria-label="Rezka — home">
            ${I.logo}<span class="word">Rezka</span>
          </button>
          <nav class="nav" data-el="nav">${ui.nav()}</nav>
          <!-- A div, not a label: the suggestion list holds links, and a label
               swallows clicks on anything inside it to focus its own field. -->
          <div class="search">${I.search}
            <input data-el="q" type="search" placeholder="Search films and shows" aria-label="Search"
                   autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list">
            <div class="sugg" data-el="sugg" role="listbox" aria-label="Suggestions" hidden></div>
          </div>
          <span class="spacer"></span>
          <button class="ghost" data-el="restore" type="button">Original site</button>
        </div>
      </header>`;
    },

    bindBar() {
      ui.el.brand?.addEventListener('click', () => { location.href = '/'; });
      ui.el.restore?.addEventListener('click', () => {
        // Stand the stage down first: it is what pinned the page, and removing
        // our UI without unpinning would leave the site unable to scroll.
        actions.setWatching(false);
        document.documentElement.removeAttribute('data-rzk');
        releaseBody();
        ui.host.remove();
      });
      suggest.bind();
      // A click outside any menu dismisses it.
      document.addEventListener('click', e => {
        if (!e.composedPath().includes(ui.host)) {
          if (ui.menu) ui.closeMenus();
          suggest.close();
        }
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
      if (!items.length) return '<div class="opt" aria-disabled="true"><span class="name">No options</span></div>';
      return items.map(i => `
        <button class="opt" type="button" role="option" data-value="${esc(i.value)}"
                aria-selected="${isOn(i)}"><span class="name">${esc(i.label)}</span>${I.tick}</button>`).join('');
    },

    toast(text) {
      if (!ui.root) return;
      const el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      el.textContent = text;
      ui.root.appendChild(el);
      setTimeout(() => el.remove(), 2200);
    }
  };

  // ---------------------------------------------------------- suggestions ----
  // Type-ahead under the search box, answered by the site's own endpoint.
  //
  // Two rules keep it out of the way: nothing is asked for until typing pauses,
  // and a reply that arrives after the box has moved on is dropped rather than
  // shown. Whatever happens, Enter still runs the plain search.

  const searchUrl = q => `/search/?do=search&subaction=search&q=${encodeURIComponent(q)}`;

  const suggest = {
    items: [], active: -1, gen: 0, timer: null,

    bind() {
      const input = ui.el.q, box = ui.el.sugg;
      if (!input || !box) return;
      input.addEventListener('input', () => suggest.ask(input.value));
      input.addEventListener('keydown', suggest.key);
      input.addEventListener('focus', () => { if (suggest.items.length) suggest.show(); });
      // mousedown rather than click: the input loses focus first, and a list
      // that closed on blur would never see the click at all.
      box.addEventListener('mousedown', e => {
        const row = e.target.closest('[data-url]');
        if (!row) return;
        e.preventDefault();
        location.href = row.dataset.url;
      });
      input.addEventListener('blur', () => setTimeout(suggest.close, 150));
    },

    ask(raw) {
      const q = String(raw || '').trim();
      clearTimeout(suggest.timer);
      if (q.length < 2) { suggest.items = []; suggest.close(); return; }
      suggest.timer = setTimeout(() => {
        const ticket = ++suggest.gen;
        api.suggest(q).then(list => {
          if (ticket !== suggest.gen || ui.el.q?.value.trim() !== q) return;
          suggest.items = list;
          suggest.active = -1;
          suggest.render(q);
        });
      }, 180);
    },

    render(q) {
      const box = ui.el.sugg;
      if (!box) return;
      if (!suggest.items.length) { suggest.close(); return; }
      box.innerHTML = suggest.items.map((s, i) => `
        <a class="sg" role="option" aria-selected="false" data-i="${i}"
           href="${esc(s.url)}" data-url="${esc(s.url)}">
          <span class="name">${esc(s.title)}</span>
          ${s.note ? `<span class="note">${esc(s.note)}</span>` : '<span class="note"></span>'}
          ${s.rating ? `<span class="rate">${esc(s.rating)}</span>` : ''}
        </a>`).join('') + `
        <a class="sg all" role="option" aria-selected="false" data-i="${suggest.items.length}"
           href="${esc(searchUrl(q))}" data-url="${esc(searchUrl(q))}">
          <span class="name">All results for “${esc(q)}”</span></a>`;
      suggest.show();
      suggest.mark();
    },

    mark() {
      const box = ui.el.sugg;
      if (!box) return;
      for (const row of box.querySelectorAll('.sg')) {
        const on = Number(row.dataset.i) === suggest.active;
        row.setAttribute('aria-selected', String(on));
        if (on) row.scrollIntoView?.({ block: 'nearest' });
      }
    },

    move(by) {
      const last = suggest.items.length;      // the "all results" row sits at the end
      if (last < 0) return;
      suggest.active = suggest.active + by;
      if (suggest.active > last) suggest.active = -1;
      if (suggest.active < -1) suggest.active = last;
      suggest.mark();
    },

    key(e) {
      const open = ui.el.sugg && !ui.el.sugg.hidden;
      if (e.key === 'ArrowDown' && open) { e.preventDefault(); suggest.move(1); return; }
      if (e.key === 'ArrowUp' && open) { e.preventDefault(); suggest.move(-1); return; }
      if (e.key === 'Escape' && open) { e.stopPropagation(); suggest.close(); return; }
      if (e.key !== 'Enter') return;
      const row = open && suggest.active >= 0
        ? ui.el.sugg.querySelector(`.sg[data-i="${suggest.active}"]`) : null;
      const q = e.target.value.trim();
      if (row) location.href = row.dataset.url;
      else if (q) location.href = searchUrl(q);
    },

    show() {
      if (!ui.el.sugg) return;
      ui.el.sugg.hidden = false;
      ui.el.q?.setAttribute('aria-expanded', 'true');
    },

    close() {
      if (!ui.el.sugg) return;
      ui.el.sugg.hidden = true;
      suggest.active = -1;
      ui.el.q?.setAttribute('aria-expanded', 'false');
    }
  };

  // -------------------------------------------------------------- player ----
  // A real <video> on the direct file. HLS-only releases can't play here
  // without an MSE layer, so those fall back to the site's own player rather
  // than showing a dead frame.

  const vttCache = new Map();

  /**
   * <track> obeys CORS and these .vtt files are on another origin, so a direct
   * src often loads nothing at all. Pulling the text through GM_xmlhttpRequest
   * and handing the element a blob avoids the whole problem; without that API
   * we still try the plain URL, which works when the CDN happens to allow it.
   */
  function subtitleSrc(url) {
    if (vttCache.has(url)) return Promise.resolve(vttCache.get(url));
    if (typeof GM_xmlhttpRequest !== 'function') return Promise.resolve(url);
    return new Promise(resolve => {
      let settled = false;
      const done = value => { if (settled) return; settled = true; vttCache.set(url, value); resolve(value); };
      try {
        GM_xmlhttpRequest({
          method: 'GET', url, timeout: 12000,
          onload: r => {
            const text = r.responseText || '';
            if (!/-->/.test(text)) { done(url); return; }
            try { done(URL.createObjectURL(new Blob([text], { type: 'text/vtt' }))); }
            catch (e) { done(url); }
          },
          onerror: () => done(url),
          ontimeout: () => done(url)
        });
      } catch (e) { done(url); }
    });
  }

  /** How far along a bar a pointer is, 0..1. */
  function fractionAlong(el, e) {
    const r = el.getBoundingClientRect();
    return r.width ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0;
  }

  /**
   * Press, drag, release on a horizontal bar.
   *
   * Pointer capture is the whole point: a 4px-tall bar loses the cursor almost
   * immediately, and without capture the drag would die on the first slip.
   * The callback is told which phase it is in, so a handler can preview during
   * the drag and commit only at the ends.
   */
  function dragBar(el, onMove) {
    if (!el) return;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      el.dataset.dragging = '1';
      onMove(fractionAlong(el, e), 'down');
    });
    el.addEventListener('pointermove', e => {
      if (el.dataset.dragging) onMove(fractionAlong(el, e), 'move');
    });
    const end = e => {
      if (!el.dataset.dragging) return;
      delete el.dataset.dragging;
      try { el.releasePointerCapture(e.pointerId); } catch (err) {}
      onMove(fractionAlong(el, e), 'up');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  const player = {
    video: null, screen: null, ready: false, capGen: 0,
    scrubbing: false,        // a drag owns the bar; tick() must keep its hands off
    seekTo: 0,               // where the next file has to pick up
    resume: false,           // …and whether it has to keep playing when it does


    markup(poster) {
      return `
      <div class="stage" data-el="stage">
        <div class="frame" data-el="frame">
          <canvas class="glow" data-el="glow" width="48" height="27" aria-hidden="true"></canvas>
          <div class="ambient" data-el="ambient"${
            poster ? ` style="background-image:url(${esc(poster).replace(/[()]/g, encodeURIComponent)})"` : ''}></div>
          <div class="screen paused" data-el="screen">
            <video data-el="video" preload="metadata" playsinline ${poster ? `poster="${esc(poster)}"` : ''}></video>
            <div class="veil" data-el="veil">
              ${poster ? `<img class="poster-blur" src="${esc(poster)}" alt="">` : ''}
              <button class="bigplay" data-el="bigplay" type="button" aria-label="Play">${I.bigplay}</button>
              <p class="msg" data-el="veilMsg"></p>
            </div>
            <div class="spin" data-el="spin" aria-hidden="true" hidden></div>
            <div class="chrome" data-el="chrome">
              <div class="scrub" data-el="scrub" role="slider" tabindex="0"
                   aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                <div class="track"><div class="buf" data-el="buf"></div><div class="fill" data-el="fill"></div>
                  <div class="knob" data-el="knob"></div></div>
                <span class="bubble" data-el="bubble" aria-hidden="true"></span>
              </div>
              <div class="ctrls">
                <button data-el="toggle" type="button" aria-label="Play">${I.play}</button>
                <span class="time" data-el="time">0:00 / 0:00</span>
                <button data-el="muteBtn" type="button" aria-label="Volume">${I.vol}</button>
                <div class="vol" data-el="vol"><div class="fill" data-el="volFill"></div></div>
                <span class="gap"></span>
                <button data-el="more" type="button" aria-label="More" aria-haspopup="menu">${I.dots}</button>
                <button data-el="fs" type="button" aria-label="Fullscreen">${I.full}</button>
              </div>
            </div>
          </div>
          <div class="topbar">
            <button class="back" data-el="leave" type="button">${I.back}<span>Details</span></button>
            <span class="now" data-el="stageTitle"></span>
          </div>
        </div>
        ${cmenu.markup()}
      </div>`;
    },

    bind() {
      const v = ui.el.video, screen = ui.el.screen;
      if (!v) return;
      player.video = v; player.screen = screen;
      player.setMode(store.native);

      const toggle = () => { if (v.paused) v.play?.().catch(() => {}); else v.pause?.(); };
      player.toggle = toggle;
      ui.el.toggle?.addEventListener('click', toggle);
      ui.el.bigplay?.addEventListener('click', toggle);
      // A click that only dismissed the context menu must not also start or
      // stop the film — that reads as the menu having done something.
      v.addEventListener('click', () => {
        if (cmenu.swallow) { cmenu.swallow = false; return; }
        if (!store.native) toggle();
      });
      v.addEventListener('dblclick', () => { if (!store.native) ui.el.fs?.click(); });

      v.addEventListener('play', () => {
        ui.el.veil.hidden = true;
        ui.el.toggle.innerHTML = I.pause;
        glow.start();
      });
      v.addEventListener('pause', () => { ui.el.toggle.innerHTML = I.play; });
      // Say when the film is waiting on the network rather than on the reader.
      const stalled = on => { if (ui.el.spin) ui.el.spin.hidden = !on || ui.el.veil?.hidden === false; };
      v.addEventListener('waiting', () => stalled(true));
      for (const done of ['playing', 'canplay', 'seeked', 'pause', 'error']) {
        v.addEventListener(done, () => stalled(false));
      }
      // The frame takes the film's own shape, so nothing is letterboxed and the
      // glow reads as light coming off the picture rather than off a black bar.
      v.addEventListener('loadedmetadata', () => { player.shape(); player.restore(); });
      v.textTracks?.addEventListener?.('change', player.applyCaptions);
      v.addEventListener('timeupdate', () => { player.tick(); speed.tick(); });
      v.addEventListener('durationchange', player.tick);
      v.addEventListener('progress', () => { player.tick(); speed.tick(); });
      // Checkpoint on pause rather than on a timer, so nothing keeps running
      // once the page is idle.
      v.addEventListener('pause', player.remember);
      v.addEventListener('ended', () => actions.nextEpisode());
      v.addEventListener('error', () => player.fallback('That file would not open — try another quality.'));

      // Seeking commits on press and on release, and only previews in between:
      // every intermediate position would otherwise be a range request into a
      // file that is still arriving.
      dragBar(ui.el.scrub, (frac, phase) => {
        const d = isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
        if (!d) return;
        player.scrubbing = phase === 'move';
        player.preview(frac, d);
        if (phase !== 'move') v.currentTime = frac * d;
      });
      ui.el.scrub?.addEventListener('pointermove', e => {
        const d = isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
        if (d && !player.scrubbing) player.preview(fractionAlong(ui.el.scrub, e), d, true);
      });
      ui.el.scrub?.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight') v.currentTime += 10;
        else if (e.key === 'ArrowLeft') v.currentTime -= 10;
      });

      dragBar(ui.el.vol, frac => {
        v.volume = frac;
        v.muted = frac === 0;
        player.tick();
      });
      ui.el.muteBtn?.addEventListener('click', () => { v.muted = !v.muted; player.tick(); });
      // Fullscreen takes the whole stage, not just the frame: the glow and the
      // menu are part of the picture and would be cropped away otherwise.
      ui.el.fs?.addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen?.();
        else ui.el.stage?.requestFullscreen?.();
      });
      ui.el.leave?.addEventListener('click', () => actions.setWatching(false));
      document.addEventListener('fullscreenchange', () => {
        // document.fullscreenElement is retargeted to the shadow host, so the
        // stage is only ever itself when asked through its own root.
        ui.el.stage?.classList.toggle('full', ui.shadow?.fullscreenElement === ui.el.stage);
        idle.poke();
      });

      // A 2.4:1 film in a narrow window leaves a picture shorter than the
      // controls that would sit on it. Watch the frame rather than the window:
      // the aspect ratio is as much of the cause as the viewport is.
      if (typeof ResizeObserver === 'function' && ui.el.frame) {
        new ResizeObserver(entries => {
          const h = entries[0]?.contentRect?.height || 0;
          ui.el.stage?.classList.toggle('tight', h > 0 && h < 340);
        }).observe(ui.el.frame);
      }

      idle.bind();
      cmenu.bind();

      document.addEventListener('keydown', e => {
        // Our own UI is in a shadow root, so by the time the event reaches the
        // document its target has been retargeted to the host element. Reading
        // e.target here would say DIV for every keystroke typed into the search
        // box — and a space would stop the film instead of typing a space.
        const from = e.composedPath?.()[0] || e.target;
        const typing = /input|textarea|select/i.test(from?.tagName || '') || from?.isContentEditable;
        if (!player.video || typing) return;
        if (e.key === 'Escape') {
          if (!ui.el.cmenu?.hidden) cmenu.close();
          else if (store.watching) actions.setWatching(false);
          return;
        }
        if (!store.watching) return;
        idle.poke();
        if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
        else if (e.key === 'ArrowRight') v.currentTime += 5;
        else if (e.key === 'ArrowLeft') v.currentTime -= 5;
        else if (e.key === 'ArrowUp') { e.preventDefault(); actions.nudgeVolume(.05); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); actions.nudgeVolume(-.05); }
        else if (e.key === 'f') ui.el.fs?.click();
        else if (e.key === 'm') ui.el.muteBtn?.click();
        else if (e.key === 'n') actions.nextEpisode();
      });
    },

    /** What the new file owes the old one: a position, and possibly playing. */
    restore() {
      const v = player.video;
      if (!v) return;
      if (player.seekTo) { v.currentTime = player.seekTo; player.seekTo = 0; }
      if (player.resume) { player.resume = false; v.play?.().catch(() => {}); }
    },

    /** Hand the frame the film's real aspect ratio, in both the forms CSS needs. */
    shape() {
      const v = player.video, frame = ui.el.frame;
      if (!v || !frame || !v.videoWidth || !v.videoHeight) return;
      frame.style.setProperty('--ar', `${v.videoWidth} / ${v.videoHeight}`);
      frame.style.setProperty('--arn', String(v.videoWidth / v.videoHeight));
      // The glow samples into a fixed bitmap that is then stretched back over
      // the frame. Unless that bitmap has the film's shape too, every colour in
      // it is smeared sideways on the way out.
      const c = ui.el.glow;
      if (!c) return;
      const w = 40, h = Math.max(1, Math.round((w * v.videoHeight) / v.videoWidth));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    },

    /**
      * Native mode hands the frame to the browser's own controls, which bring
      * subtitles, playback speed, picture-in-picture, download and casting —
      * a far richer menu than is worth rebuilding by hand.
      */
    setMode(native) {
      const v = player.video, sc = player.screen;
      if (!v || !sc) return;
      v.controls = Boolean(native);
      sc.classList.toggle('native', Boolean(native));
      if (!ui.el.veil) return;
      // Coming back from native mode has to restore the poster overlay, but
      // only when it was earned: before playback starts, or to carry a message.
      const message = ui.el.veilMsg?.textContent || '';
      ui.el.veil.hidden = native ? true : !(message || (v.paused && !v.currentTime));
    },

    /**
     * Rebuild the <track> list for whatever the current stream offers.
     *
     * Clearing is synchronous but attaching is not, so two calls that overlap
     * would both append and the same language would appear twice. Each run
     * takes a ticket and stale ones drop their result.
     */
    captions(subs) {
      const v = player.video;
      if (!v) return;
      const ticket = ++player.capGen;
      for (const old of [...v.querySelectorAll('track')]) old.remove();
      for (const sub of subs || []) {
        subtitleSrc(sub.url).then(src => {
          if (player.video !== v || player.capGen !== ticket) return;
          const track = document.createElement('track');
          track.kind = 'subtitles';
          track.label = sub.label;
          if (sub.lang) track.srclang = sub.lang;
          // `default` is honoured by the browser whenever the track finishes
          // loading, which can be after applyCaptions has already run. Once a
          // choice exists it is the only thing that may switch a track on.
          if (sub.on && store.caption === null) track.default = true;
          // A track's mode can still be moved by the browser once its cues have
          // loaded, which happens after this call returns.
          track.addEventListener('load', player.applyCaptions);
          track.src = src;
          v.appendChild(track);
          player.applyCaptions();
        });
      }
    },

    /**
     * A choice made in the menu has to outlive the track list, which is rebuilt
     * on every quality, voice and episode change. With no choice made yet the
     * response's own default is left exactly as it came.
     */
    applyCaptions() {
      const v = player.video;
      const want = store.caption;
      if (!v || !v.textTracks || want === null) return;
      for (const t of v.textTracks) {
        const mode = want !== 'off' && t.label === want ? 'showing' : 'disabled';
        // Only ever write a change. The browser makes its own selection when a
        // track finishes loading — matching the reader's Accept-Language, say —
        // and this runs off that same event, so a needless write would loop.
        if (t.mode !== mode) t.mode = mode;
      }
    },

    /** The label the menu should show as current, chosen or inherited. */
    caption() {
      if (store.caption) return store.caption;
      const on = (store.captions() || []).find(s => s.on);
      return on ? on.label : 'off';
    },

    /**
     * Where the bar says you are, which is not always where the film is: while
     * a drag is in flight the bar leads and the film follows on release. The
     * bubble is clamped so it cannot hang off the edge of the frame.
     */
    preview(frac, duration, hoverOnly) {
      const pct = frac * 100;
      if (!hoverOnly) {
        ui.el.fill.style.width = pct + '%';
        ui.el.knob.style.left = pct + '%';
        ui.el.time.textContent = `${clock(frac * duration)} / ${clock(duration)}`;
      }
      if (!ui.el.bubble) return;
      ui.el.bubble.textContent = clock(frac * duration);
      const width = ui.el.scrub?.getBoundingClientRect().width || 0;
      const edge = width ? Math.min(96, (34 / width) * 100) : 0;
      ui.el.bubble.style.left = Math.max(edge, Math.min(100 - edge, pct)) + '%';
    },

    tick() {
      const v = player.video;
      if (!v || !ui.el.fill) return;
      const d = isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      const pct = d ? (v.currentTime / d) * 100 : 0;
      if (!player.scrubbing) {
        ui.el.fill.style.width = pct + '%';
        ui.el.knob.style.left = pct + '%';
        ui.el.time.textContent = `${clock(v.currentTime)} / ${clock(d)}`;
      }
      ui.el.scrub?.setAttribute('aria-valuenow', String(Math.round(pct)));
      if (v.buffered?.length && d) {
        ui.el.buf.style.width = (v.buffered.end(v.buffered.length - 1) / d) * 100 + '%';
      }
      ui.el.volFill.style.width = (v.muted ? 0 : v.volume) * 100 + '%';
      ui.el.muteBtn.innerHTML = v.muted || v.volume === 0 ? I.mute : I.vol;
    },

    /**
     * Point the element at a file.
     *
     * Swapping src empties the element: the position goes to zero and playback
     * stops. Both are restored, but only once metadata has arrived \u2014 a seek
     * against an empty element is silently thrown away. Anything loaded while
     * the stage is up carries on playing, so changing quality, voice or episode
     * mid-film is a change of file and nothing else.
     */
    load(stream, opts = {}) {
      const v = player.video;
      if (!v || !stream) return;
      if (stream.hls) { player.fallback('This track is served as HLS only, so the site\u2019s own player has been restored.'); return; }
      ui.el.veilMsg.textContent = '';
      ui.el.bigplay.hidden = false;
      const saved = prefs.get(PREF.pos, {})[actions.posKey()] || 0;
      const at = opts.at != null ? opts.at : (saved > 30 ? saved : 0);
      player.seekTo = at > 1 ? at : 0;
      player.resume = opts.play != null ? Boolean(opts.play) : store.watching;
      v.src = stream.url;
      if (player.seekTo) v.currentTime = player.seekTo;
      v.playbackRate = store.rate;
      player.ready = true;

      player.captions(store.captions());
      player.setMode(store.native);

      speed.reset();
      speed.probe(stream.url).then(bytes => {
        if (store.selected()?.url !== stream.url) return;
        speed.size = bytes;
        speed.tick();
      });
    },

    // Hand playback back to the site rather than pretending.
    fallback(message) {
      player.ready = false;
      actions.setWatching(false);
      store.patch({ status: { kind: 'error', text: message } });
      if (!ui.el.veil) return;
      ui.el.veil.hidden = false;
      ui.el.bigplay.hidden = true;
      ui.el.veilMsg.textContent = message;
      const original = document.getElementById('player');
      if (original) {
        document.documentElement.removeAttribute('data-rzk');
        releaseBody();
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

  // ---------------------------------------------------------------- glow ----
  // The light around the frame is the film itself: a 48×27 copy of the current
  // frame, blown up and blurred past recognition. Nothing is ever read back out
  // of the canvas, so a cross-origin file tainting it costs us nothing.
  //
  // Before playback the poster does the same job in CSS, and hands over the
  // moment real frames start arriving.

  const glow = {
    ctx: null, timer: null,

    /** Light that follows the cut is still motion; the poster's glow is not. */
    unwanted() {
      try { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
      catch (e) { return false; }
    },

    start() {
      if (glow.timer || !store.watching || glow.unwanted()) return;
      const c = ui.el.glow;
      if (!c) return;
      if (!glow.ctx) { try { glow.ctx = c.getContext('2d'); } catch (e) { glow.ctx = null; } }
      if (!glow.ctx) return;
      glow.timer = setInterval(glow.draw, 140);
      glow.draw();
    },

    draw() {
      const v = player.video, c = ui.el.glow;
      if (!glow.ctx || !v || !c || v.paused || v.readyState < 2) return;
      try {
        glow.ctx.drawImage(v, 0, 0, c.width, c.height);
        ui.el.frame?.classList.add('live');
      } catch (e) { glow.stop(); }
    },

    stop() {
      clearInterval(glow.timer);
      glow.timer = null;
    }
  };

  // ---------------------------------------------------------------- idle ----
  // Everything drawn over the film — chrome, top bar, cursor — leaves together
  // after a few still seconds, and only while something is actually playing.

  const idle = {
    timer: null,

    at: null,                // where the pointer last was, in viewport coordinates

    /**
     * Whether the pointer is resting on the controls rather than the film.
     *
     * Asked of the geometry rather than :hover, because the controls are not
     * hit-testable while hidden: the move that reveals them cannot also put
     * the browser's hover state on them, and a second move is exactly what a
     * reader aiming at the scrub bar is not doing.
     */
    over() {
      const r = ui.el.chrome?.getBoundingClientRect();
      const at = idle.at;
      if (!r || !at || !r.width) return false;
      return at.x >= r.left && at.x <= r.right && at.y >= r.top && at.y <= r.bottom;
    },

    /**
     * Something happened; show the controls and start counting again.
     *
     * They go whether or not the film is playing — a paused frame is still a
     * frame, and the only thing that should be on screen. What does hold them
     * open is a menu, or the pointer sitting on them: aiming at the scrub bar
     * must not make it disappear from under the cursor.
     */
    poke(e) {
      if (e && typeof e.clientX === 'number') idle.at = { x: e.clientX, y: e.clientY };
      ui.el.stage?.classList.remove('idle');
      clearTimeout(idle.timer);
      if (!store.watching) return;
      idle.timer = setTimeout(() => {
        if (!store.watching) return;
        // Giving up rather than trying again: the two things that hold the
        // controls open both end in another poke — closing the menu calls one,
        // and a cursor that leaves them has to move to do it. Polling for
        // either would leave a timer running for as long as the film does.
        if (!ui.el.cmenu?.hidden || idle.over()) return;
        ui.el.stage?.classList.add('idle');
      }, 2600);
    },

    /** Straight to nothing on screen, without waiting to be left alone. */
    hide() {
      clearTimeout(idle.timer);
      ui.el.stage?.classList.add('idle');
    },

    bind() {
      const stage = ui.el.stage;
      if (!stage) return;
      for (const type of ['mousemove', 'mousedown', 'wheel', 'touchstart']) {
        stage.addEventListener(type, idle.poke, { passive: true });
      }
    }
  };

  // ------------------------------------------------------- context menu ----
  // Right-click on the film. Everything the strip on the info page offers, plus
  // the things only a playing film has — speed, subtitles, picture-in-picture —
  // without putting any of it on screen while you watch.

  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  const cmenu = {
    swallow: false,          // the click that dismissed the menu is not a play click

    markup() {
      const row = (act, icon, label, extra = '') =>
        `<button class="cm" type="button" role="menuitem" data-act="${act}">
           <span class="ic">${icon}</span>
           <span class="lbl" data-el="cm${act[0].toUpperCase()}${act.slice(1)}">${label}</span>${extra}</button>`;
      const sub = (name, icon, label) =>
        `<div class="cm" role="menuitem" tabindex="0" data-sub="${name}" aria-haspopup="menu" aria-expanded="false">
           <span class="ic">${icon}</span><span class="lbl">${label}</span>
           <span class="val" data-el="cm${name}Val"></span>${I.arrow}
           <div class="flyout" data-el="cm${name}Menu" role="menu" aria-label="${label}"></div>
         </div>`;

      return `
      <div class="cmenu" data-el="cmenu" role="menu" aria-label="Player" hidden>
        ${row('toggle', I.play, 'Play', '<kbd>Space</kbd>')}
        ${row('next', I.next, 'Next episode')}
        ${row('pip', I.pip, 'Picture in picture')}
        ${row('fs', I.full, 'Fullscreen', '<kbd>F</kbd>')}
        <div class="cmsep"></div>
        ${sub('quality', I.hd, 'Quality')}
        ${sub('voice', I.voice, 'Voice')}
        ${sub('caption', I.cc, 'Subtitles')}
        ${sub('rate', I.gauge, 'Speed')}
        ${sub('episode', I.list, 'Episode')}
        <div class="cmsep"></div>
        ${row('download', I.down, 'Download')}
        ${row('copy', I.link, 'Copy link')}
        ${row('leech', I.send, 'Send to Leech')}
        <div class="cmsep"></div>
        ${row('mode', I.screen, 'Native player')}
        ${row('exit', I.back, 'Back to details', '<kbd>Esc</kbd>')}
        <p class="cmstat" data-el="cmStat"></p>
      </div>`;
    },

    bind() {
      const menu = ui.el.cmenu, stage = ui.el.stage;
      if (!menu || !stage) return;

      stage.addEventListener('contextmenu', e => {
        e.preventDefault();
        cmenu.open(e.clientX, e.clientY);
      });
      ui.el.more?.addEventListener('click', e => {
        e.stopPropagation();
        // The mousedown that reached the stage has already dismissed an open
        // menu, so the gear only ever has to open one.
        if (cmenu.swallow) { cmenu.swallow = false; return; }
        const r = e.currentTarget.getBoundingClientRect();
        cmenu.open(r.right, r.top - 8, 'up');
        // Opened from a button, so whoever pressed it may be on the keyboard.
        // :focus-visible keeps this invisible to a mouse.
        menu.querySelector('.cm')?.focus?.();
      });

      // A left click anywhere else on the stage dismisses it. Right-click is
      // excluded so that opening the menu somewhere new is one gesture.
      stage.addEventListener('mousedown', e => {
        if (menu.hidden || e.button !== 0 || e.composedPath().includes(menu)) return;
        cmenu.close(true);
      }, true);

      menu.addEventListener('click', e => {
        const opt = e.target.closest('.opt[data-value]');
        if (opt) { cmenu.pick(opt.closest('[data-sub]')?.dataset.sub, opt.dataset.value); return; }
        const btn = e.target.closest('[data-act]');
        if (btn && !btn.disabled) { cmenu.act(btn.dataset.act); return; }
        // The row itself: a tap opens its submenu, for anything without hover.
        const row = e.target.closest('[data-sub]');
        if (row) cmenu.expand(row.classList.contains('open') ? null : row);
      });
      menu.addEventListener('mouseover', e => cmenu.expand(e.target.closest('[data-sub]')));
      // Tabbing through the menu opens submenus the same way hovering does.
      menu.addEventListener('focusin', e => cmenu.expand(e.target.closest('[data-sub]')));
      // A resized window leaves the menu pinned to coordinates that no longer
      // mean anything, and fullscreen resizes the window.
      addEventListener('resize', () => { if (!menu.hidden) cmenu.close(); });
    },

    /** Open one submenu, closing whatever else was open. */
    expand(row) {
      const menu = ui.el.cmenu;
      if (!menu) return;
      for (const r of menu.querySelectorAll('[data-sub]')) {
        if (r === row) continue;
        r.classList.remove('open', 'flip', 'up');
        r.setAttribute('aria-expanded', 'false');
      }
      if (!row || row.classList.contains('open')) return;
      row.classList.add('open');
      row.setAttribute('aria-expanded', 'true');
      const fly = row.querySelector('.flyout');
      const r = row.getBoundingClientRect();
      if (!fly || !r.width) return;
      // Flip rather than let a submenu run off the edge of the window.
      if (r.right + fly.offsetWidth + 12 > innerWidth) row.classList.add('flip');
      if (r.top + fly.offsetHeight + 12 > innerHeight) row.classList.add('up');
    },

    open(x, y, anchor) {
      const menu = ui.el.cmenu;
      if (!menu) return;
      cmenu.expand(null);
      cmenu.refresh();
      menu.hidden = false;
      menu.style.left = menu.style.top = '0px';
      const w = menu.offsetWidth || 236, h = menu.offsetHeight || 0;
      const top = anchor === 'up' ? y - h : y;
      menu.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
      menu.style.top = Math.max(8, Math.min(top, innerHeight - h - 8)) + 'px';
      idle.poke();
    },

    close(swallowNextClick) {
      const menu = ui.el.cmenu;
      if (!menu) return;
      menu.hidden = true;
      cmenu.expand(null);
      cmenu.swallow = Boolean(swallowNextClick);
      idle.poke();
    },

    /** Labels, ticks and lists, all read fresh at the moment of opening. */
    refresh() {
      const v = player.video;
      const eps = site.episodes()[store.season] || [];
      const voices = actions.voices();
      const subs = store.captions() || [];
      const picked = store.selected();
      const set = (name, text) => { if (ui.el[name]) ui.el[name].textContent = text; };
      const show = (act, on) => { const b = ui.el.cmenu.querySelector(`[data-act="${act}"]`); if (b) b.hidden = !on; };
      const showSub = (name, on) => { const r = ui.el.cmenu.querySelector(`[data-sub="${name}"]`); if (r) r.hidden = !on; };

      const playing = Boolean(v && !v.paused);
      set('cmToggle', playing ? 'Pause' : 'Play');
      const icon = ui.el.cmenu.querySelector('[data-act="toggle"] .ic');
      if (icon) icon.innerHTML = playing ? I.pause : I.play;
      set('cmFs', document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen');
      set('cmMode', store.native ? 'Custom player' : 'Native player');
      show('pip', typeof document.pictureInPictureEnabled === 'boolean' ? document.pictureInPictureEnabled : false);
      show('next', actions.after(store.episode) !== null);

      const caption = player.caption();
      set('cmqualityVal', picked ? picked.label : '—');
      set('cmvoiceVal', voiceLabel(voices.find(x => x.id === store.translator) || voices[0] || {}));
      set('cmcaptionVal', caption === 'off' ? 'Off' : caption);
      set('cmrateVal', store.rate === 1 ? 'Normal' : `${store.rate}×`);
      set('cmepisodeVal', store.episode ? `Episode ${store.episode}` : '—');

      showSub('caption', subs.length > 0);
      showSub('episode', eps.length > 1);
      showSub('voice', voices.length > 1);
      showSub('quality', store.free().length > 0);

      ui.el.cmqualityMenu.innerHTML = ui.options(
        store.free().map(s => ({ value: s.label, label: s.label })), i => i.value === picked?.label);
      ui.el.cmvoiceMenu.innerHTML = ui.options(
        voices.map(x => ({ value: x.id, label: voiceLabel(x) })), i => i.value === store.translator);
      ui.el.cmcaptionMenu.innerHTML = ui.options(
        [{ value: 'off', label: 'Off' }, ...subs.map(s => ({ value: s.label, label: s.label }))],
        i => i.value === caption);
      ui.el.cmrateMenu.innerHTML = ui.options(
        RATES.map(r => ({ value: String(r), label: r === 1 ? 'Normal' : `${r}×` })),
        i => Number(i.value) === store.rate);
      ui.el.cmepisodeMenu.innerHTML = ui.options(
        eps.map(e => ({ value: e.id, label: `Episode ${e.id}` })), i => i.value === store.episode);

      set('cmStat', ui.el.speedText?.textContent || '');
    },

    pick(kind, value) {
      cmenu.close();
      if (kind === 'quality') actions.setQuality(value);
      else if (kind === 'voice') actions.setTranslator(value);
      else if (kind === 'episode') actions.setEpisode(value);
      else if (kind === 'caption') actions.setCaption(value);
      else if (kind === 'rate') actions.setRate(Number(value));
    },

    act(name) {
      if (name === 'toggle') { player.toggle?.(); cmenu.close(); return; }
      if (name === 'next') { actions.nextEpisode(); cmenu.close(); return; }
      if (name === 'fs') { cmenu.close(); ui.el.fs?.click(); return; }
      if (name === 'pip') { cmenu.close(); actions.pip(); return; }
      if (name === 'mode') { actions.setMode(!store.native); cmenu.close(); return; }
      if (name === 'exit') { cmenu.close(); actions.setWatching(false); return; }
      cmenu.close();
      actions.run(name);
    }
  };

  // --------------------------------------------------------------- views ----

  const watchView = {
    render() {
      const info = site.info();
      const rating = site.rating();
      const facts = [site.year(), site.country(), site.genre(), site.duration()]
        .filter(Boolean).map(i18n.term);

      // The site's own original-language title beats anything a model would
      // produce, so lead with it and keep the local name underneath.
      const local = site.title();
      const english = site.original();
      const heading = english || local;
      const under = english && english !== local ? local : '';

      const poster = site.poster();
      const cast = site.people('actor');
      const crew = site.people('director');

      return `
      <main class="wrap">
        <section class="hero">
          ${poster ? `<div class="drop" aria-hidden="true"><img src="${esc(poster)}" alt="" data-mend></div>` : ''}
          <div class="hero-in">
            <div class="art${poster ? '' : ' blank'}">${poster
              ? `<img class="poster" src="${esc(poster)}" alt="" data-mend>` : ''}</div>
            <div class="lede">
              <div class="head">
                <h1>${esc(heading)}</h1>
                ${under ? `<div class="orig">${esc(under)}</div>` : ''}
                <div class="facts">
                  ${rating ? `<span class="score"><span class="star">★</span>${esc(rating.score)}</span>` : ''}
                  ${facts.map(f => `<span>${esc(f)}</span>`).join('<span class="sep"></span>')}
                </div>
              </div>
              <p class="synopsis" data-el="synopsis">${esc(site.description())}</p>
              <div class="strip" data-el="strip"></div>
              <p class="note" data-el="note" role="status" aria-live="polite" hidden></p>
              <div class="speed" data-el="speed" hidden>
                <span class="pulse idle" data-el="speedDot"></span>
                <span data-el="speedText"></span>
              </div>
            </div>
          </div>
        </section>

        <section class="sect season" data-el="epsBox" hidden>
          <h2>Episodes</h2>
          <div class="eps" data-el="eps"></div>
        </section>

        <section class="batch" data-el="batch" hidden></section>

        ${cast.length ? `<section class="sect">
          <h2>Cast</h2>
          <div class="faces">${cast.slice(0, 12).map(watchView.face).join('')}</div>
        </section>` : ''}

        <section class="meta">
          <dl>${Object.entries(info).slice(0, 8)
            .map(([k, v]) => `<dt>${esc(i18n.term(k))}</dt><dd>${watchView.detail(k, v, crew)}</dd>`).join('')}</dl>
        </section>

        ${player.markup(poster)}
      </main>`;
    },

    /** One member of the cast: their face, their name, and their page. */
    face(p) {
      const initial = esc(p.name.trim().charAt(0).toUpperCase());
      const shot = p.photo
        ? `<img src="${esc(p.photo)}" alt="" loading="lazy" data-mend="${initial}">`
        : initial;
      const inner = `<span class="shot">${shot}</span><span class="who">${esc(p.name)}</span>`;
      return p.url
        ? `<a class="face" href="${esc(p.url)}">${inner}</a>`
        : `<span class="face">${inner}</span>`;
    },

    /**
     * A details value. Names are the one thing in this table worth following,
     * so where the page gave us people for a row, the row becomes their links
     * rather than the flat text the site printed.
     */
    detail(key, value, people) {
      if (people.length && /режисс|director/i.test(key)) {
        return people.map(p => p.url
          ? `<a class="who" href="${esc(p.url)}">${esc(p.name)}</a>`
          : esc(p.name)).join(', ');
      }
      return esc(i18n.term(value));
    },

    /**
     * The strip is re-rendered on every state change; the menus live inside it.
     *
     * Everything here is about choosing — which voice, which episode, which
     * file. Watching is one button, and it takes the whole page away.
     */
    strip() {
      const voices = actions.voices();
      const voice = voices.find(v => v.id === store.translator) || voices[0];
      const seasons = site.seasons();
      const free = store.free();
      const picked = store.selected();
      const at = actions.resumeAt();

      let picks = ui.picker('voice', 'Voice', voice ? voiceLabel(voice) : '—', voices.length < 2);
      if (seasons.length) {
        picks += ui.picker('season', 'Season',
          store.season ? `Season ${store.season}` : '—', seasons.length < 2);
      }
      picks += ui.picker('quality', 'Quality', picked ? picked.label : '—', free.length < 2);

      let html = `
        <div class="trow">
          <button class="watch" data-el="watch" type="button" ${picked ? '' : 'disabled'}>
            ${I.bigplay}<span>${at ? `Resume · ${esc(clock(at))}` : 'Watch'}</span>
          </button>
          ${picks}
        </div>
        <div class="trow">`;
      html += `<button class="dl" data-el="download" type="button" ${picked ? '' : 'disabled'}>${I.down} Download</button>`;
      html += `<button class="quiet" data-el="copy" type="button" ${picked ? '' : 'disabled'}>Copy link</button>`;
      html += `<button class="quiet" data-el="leech" type="button" ${picked ? '' : 'disabled'}>Leech</button>`;
      html += `<button class="quiet" data-el="mode" type="button" title="${
        store.native ? 'Back to the built-in controls' : 'Use the browser\u2019s own player: subtitles, speed, picture-in-picture'
      }">${store.native ? 'Custom player' : 'Native player'}</button>`;
      return html + '</div>';
    },

    episodes() {
      const eps = site.episodes()[store.season] || [];
      if (eps.length < 2) return '';
      return eps.map(e => `<button class="ep" type="button" data-ep="${esc(e.id)}"
        aria-current="${e.id === store.episode}">${esc(e.id)}</button>`).join('');
    },

    /** What is on the stage, for the one line of text allowed over the film. */
    now() {
      const name = site.original() || site.title();
      if (!site.isSeries() || !store.season || !store.episode) return name;
      return `${name} · S${store.season}E${store.episode}`;
    },

    update() {
      if (!ui.el.strip) return;
      ui.el.strip.innerHTML = watchView.strip();
      ui.el.eps.innerHTML = watchView.episodes();
      ui.el.epsBox.hidden = !ui.el.eps.children.length;
      ui.el.stageTitle.textContent = watchView.now();
      ui.cache();
      watchView.fillMenus();
      watchView.bindStrip();

      const note = store.status
        || (store.current() && !store.free().length ? { kind: 'error', text: 'Every quality is PRO-only' } : null);
      ui.el.note.hidden = !note;
      ui.el.note.textContent = note ? note.text : '';
      ui.el.note.classList.toggle('error', note?.kind === 'error');

      batchView.update();

      // The synopsis is the only free prose here. It stays in Russian until the
      // on-device model answers, and stays in Russian for good if it cannot.
      const synopsis = ui.el.synopsis;
      if (synopsis && !synopsis.dataset.done) {
        const original = site.description();
        i18n.live(original, out => {
          if (!ui.el.synopsis) return;
          ui.el.synopsis.textContent = out;
          ui.el.synopsis.dataset.done = '1';
          ui.el.synopsis.title = original;
        });
      }
    },

    fillMenus() {
      const voices = actions.voices();
      ui.el.voiceMenu.innerHTML = ui.options(
        voices.map(v => ({ value: v.id, label: voiceLabel(v) })),
        i => i.value === store.translator);

      if (ui.el.seasonMenu) {
        ui.el.seasonMenu.innerHTML = ui.options(
          site.seasons().map(s => ({ value: s.id, label: `Season ${s.id}` })),
          i => i.value === store.season);
      }
      ui.el.qualityMenu.innerHTML = ui.options(
        store.free().map(s => {
          const bytes = speed.sizes.get(s.url);
          return { value: s.label, label: bytes ? `${s.label} · ${fmtSize(bytes)}` : s.label };
        }),
        i => i.value === store.selected()?.label);
    },

    bindStrip() {
      for (const btn of ui.root.querySelectorAll('[data-opens]')) {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const name = btn.dataset.opens;
          ui.menuFor(ui.menu === name ? null : name);
          // Sizes make the choice concrete, but cost a request each — only ask
          // when the list is actually on screen, and only once per URL.
          if (ui.menu === 'quality') {
            const unknown = store.free().filter(s => !speed.sizes.has(s.url));
            if (unknown.length) {
              Promise.all(unknown.map(s => speed.probe(s.url)))
                .then(() => { if (ui.el.qualityMenu) watchView.fillMenus(); });
            }
          }
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
      ui.el.watch?.addEventListener('click', () => actions.setWatching(true));
      ui.el.mode?.addEventListener('click', () => actions.setMode(!store.native));
      ui.el.download?.addEventListener('click', () => actions.run('download'));
      ui.el.copy?.addEventListener('click', () => actions.run('copy'));
      ui.el.leech?.addEventListener('click', () => actions.run('leech'));
    }
  };

  const tag = i => `S${String(i.season).padStart(2, '0')}E${String(i.episode).padStart(2, '0')}`;

  const batchView = {
    from: { season: null, episode: null },

    start() {
      const seasons = site.seasons();
      const season = batchView.from.season || store.season || seasons[0]?.id;
      const eps = site.episodes()[season] || [];
      const episode = eps.some(e => e.id === batchView.from.episode)
        ? batchView.from.episode
        : (season === store.season ? store.episode : eps[0]?.id);
      return { season, episode: episode || eps[0]?.id };
    },

    update() {
      const box = ui.el.batch;
      if (!box) return;
      if (!site.isSeries()) { box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = batchView.markup();
      ui.cache();
      batchView.bind();
    },

    markup() {
      if (!batch.available()) {
        return `<h2>Download in order</h2>
          <p class="hint warn">Unavailable: your script manager does not provide GM_download.
          Without it there is no way to tell when an episode finished, so episodes
          cannot be queued. Works in Tampermonkey.</p>`;
      }

      if (batch.state === 'idle') {
        const seasons = site.seasons();
        const sel = batchView.start();
        const eps = site.episodes()[sel.season] || [];
        const n = batch.plan(sel.season, sel.episode).length;
        return `
          <h2>Download in order</h2>
          <div class="line">
            <select data-el="bSeason" aria-label="From season">${seasons.map(s =>
              `<option value="${esc(s.id)}"${s.id === sel.season ? ' selected' : ''}>Season ${esc(s.id)}</option>`).join('')}</select>
            <select data-el="bEpisode" aria-label="From episode">${eps.map(e =>
              `<option value="${esc(e.id)}"${e.id === sel.episode ? ' selected' : ''}>Episode ${esc(e.id)}</option>`).join('')}</select>
            <button class="dl" data-el="bStart" type="button">${I.down} Start</button>
          </div>
          <p class="hint">${n} ${n === 1 ? 'episode' : 'episodes'} · to the end of the show · ${esc(store.selected()?.label || 'best available')}</p>`;
      }

      const c = batch.counts();
      if (batch.state === 'done') {
        const bad = c.failed;
        return `
          <h2>Queue finished</h2>
          <p class="hint">${c.done} из ${c.total}${bad ? ` · ${bad} failed` : ''}</p>
          <div class="line">
            ${bad ? `<button class="dl" data-el="bRetry" type="button">Retry failed</button>` : ''}
            <button class="quiet" data-el="bStop" type="button">Close</button>
          </div>`;
      }

      const item = batch.items[batch.index];
      const pct = batch.progress?.total
        ? Math.round((batch.progress.loaded / batch.progress.total) * 100) : null;
      const paused = batch.state === 'paused';

      return `
        <h2>${paused ? 'Paused' : 'Downloading'}</h2>
        <div class="now">
          <b>${item ? tag(item) : '—'}</b>
          <span data-el="bPct">${pct === null ? (paused ? 'stopped' : 'preparing…') : pct + '%'}</span>
        </div>
        <div class="progress"><i data-el="bBar" style="width:${pct || 0}%"></i></div>
        <div class="tally">
          <span>${c.done} / ${c.total}</span>
          ${c.failed ? `<span class="bad">${c.failed} failed</span>` : ''}
        </div>
        <div class="line" style="padding-top:10px">
          ${paused
            ? `<button class="dl" data-el="bResume" type="button">Resume</button>`
            : `<button class="quiet" data-el="bPause" type="button">Pause</button>
               <button class="quiet" data-el="bSkip" type="button">Skip</button>`}
          <button class="quiet" data-el="bStop" type="button">Stop</button>
        </div>`;
    },

    bind() {
      ui.el.bSeason?.addEventListener('change', e => {
        batchView.from = { season: e.target.value, episode: null };
        batchView.update();
      });
      ui.el.bEpisode?.addEventListener('change', e => {
        batchView.from = { season: ui.el.bSeason?.value || store.season, episode: e.target.value };
        batchView.update();
      });
      ui.el.bStart?.addEventListener('click', () => {
        const sel = batchView.start();
        batch.start(sel.season, sel.episode);
      });
      ui.el.bPause?.addEventListener('click', () => batch.pause());
      ui.el.bResume?.addEventListener('click', () => batch.resume());
      ui.el.bSkip?.addEventListener('click', () => batch.skip());
      ui.el.bStop?.addEventListener('click', () => batch.stop());
      ui.el.bRetry?.addEventListener('click', () => batch.retryFailed());
    },

    /** Cheap path: move the bar without rebuilding the panel. */
    tickProgress() {
      if (!batch.progress?.total) return;
      const pct = Math.round((batch.progress.loaded / batch.progress.total) * 100);
      if (ui.el.bBar) ui.el.bBar.style.width = pct + '%';
      if (ui.el.bPct) ui.el.bPct.textContent = pct + '%';
    }
  };

  const gridView = {
    render() {
      const cards = site.cards();
      const pages = site.pages();
      return `
      <main class="wrap">
        <h1 class="gtitle">${esc(site.heading() || 'Catalog')}</h1>
        ${cards.length ? `<div class="cards">${cards.map(gridView.card).join('')}</div>` : '<p class="empty">Nothing found</p>'}
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

    ingest(key, list, subs = []) {
      clearTimeout(watchdog);
      store.patch({
        streams: { ...store.streams, [key]: list },
        subs: { ...store.subs, [key]: subs },
        status: null
      });
      const pick = store.selected();
      if (pick && key === store.key()) player.load(pick);
    },

    fail(text) {
      clearTimeout(watchdog);
      store.patch({ status: { kind: 'error', text } });
    },

    need() {
      if (store.current()) { const p = store.selected(); if (p) player.load(p); return; }
      store.patch({ status: { kind: 'wait', text: 'Loading…' } });
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
      }).then(res => actions.ingest(key, res.list, res.subs), err => actions.fail(err.message));
    },

    arm() {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (!store.current()) actions.fail('No response — reload the page');
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

    /** The episode after this one within the same season, or null. */
    after(id) {
      const eps = site.episodes()[store.season] || [];
      const i = eps.findIndex(e => e.id === id);
      return i >= 0 && i + 1 < eps.length ? eps[i + 1].id : null;
    },

    nextEpisode() {
      const next = actions.after(store.episode);
      if (next !== null) actions.setEpisode(next);
    },

    /** Seconds worth going back to, from this session or a previous one. */
    resumeAt() {
      const saved = prefs.get(PREF.pos, {})[actions.posKey()] || 0;
      const live = player.video?.currentTime || 0;
      const at = Math.max(saved, live);
      return at > 30 ? Math.floor(at) : 0;
    },

    /**
     * Watch mode is the whole point of the split: the page steps aside and the
     * film is the only thing on screen. Leaving stops playback rather than
     * leaving audio running behind a page with no picture on it.
     */
    setWatching(on) {
      const want = Boolean(on);
      if (want === store.watching) return;
      // Pinning the page collapses its scroll to zero. Where the reader was —
      // halfway down the episode grid, say — is theirs to get back.
      if (want) store.scrolled = window.scrollY || document.documentElement.scrollTop || 0;
      store.watching = want;
      ui.root?.classList.toggle('watching', want);
      document.documentElement.toggleAttribute('data-rzk-watch', want);
      cmenu.close();
      if (want) {
        player.shape();
        player.video?.play?.().catch(() => {});
        glow.start();
        idle.hide();
      } else {
        player.video?.pause?.();
        glow.stop();
        clearTimeout(idle.timer);
        ui.el.stage?.classList.remove('idle');
        if (document.fullscreenElement) document.exitFullscreen?.();
        try { window.scrollTo(0, store.scrolled); } catch (e) {}
      }
      store.emit();
      // emit() rebuilds the strip, so the button to hand focus back to only
      // exists after it. Keyboard readers land where they left off.
      if (!want) ui.el.watch?.focus?.({ preventScroll: true });
    },

    setCaption(label) {
      store.caption = label;
      player.applyCaptions();
    },

    setRate(rate) {
      store.rate = rate;
      if (player.video) player.video.playbackRate = rate;
    },

    nudgeVolume(by) {
      const v = player.video;
      if (!v) return;
      v.volume = Math.max(0, Math.min(1, v.volume + by));
      v.muted = v.volume === 0;
      player.tick();
    },

    pip() {
      const v = player.video;
      if (!v) return;
      if (document.pictureInPictureElement) document.exitPictureInPicture?.();
      else v.requestPictureInPicture?.().catch(() => ui.toast('Picture in picture was refused'));
    },

    setMode(native) {
      store.native = Boolean(native);
      prefs.set(PREF.native, store.native);
      player.setMode(store.native);
      store.emit();
    },

    setQuality(label) {
      store.quality = label;
      prefs.set(PREF.quality, label);
      store.emit();
      const pick = store.selected();
      if (pick && player.video) {
        // A quality swap is the same moment of the same film in another file.
        player.load(pick, { at: player.video.currentTime, play: !player.video.paused });
      }
    },

    run(kind) {
      const pick = store.selected();
      if (!pick) return;
      const name = filename(pick.label);

      if (kind === 'copy') { GM_setClipboard(pick.url); ui.toast('Link copied'); return; }
      if (kind === 'leech') {
        GM_setClipboard(name);
        ui.toast('Sent to Leech');
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
      ui.toast(`Downloading ${pick.label}`);
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
          const read = api.read(data);
          actions.ingest(
            store.key(tid, p?.get('season') || store.season, p?.get('episode') || store.episode),
            read.list, read.subs);
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

    // An interrupted run comes back paused, never mid-download: resuming is
    // always a deliberate click.
    if (batch.restore()) batchView.update();

    addEventListener('beforeunload', e => {
      player.remember();
      if (batch.state !== 'running') return;
      batch.save();
      e.preventDefault();
      e.returnValue = '';
      return '';
    });
  }

  // The site ships `body.active-brand.pp { padding-top: 250px !important }`,
  // which outranks any selector a stylesheet of ours could use — higher
  // specificity and important both. An inline declaration with priority is the
  // one thing that beats an author !important rule, so the body box is held
  // directly and handed back untouched when the UI steps aside.
  let heldBodyStyle;                       // undefined while we are not holding it

  function holdBody() {
    const b = document.body;
    if (!b || heldBodyStyle !== undefined) return;
    heldBodyStyle = b.getAttribute('style');
    b.style.setProperty('padding', '0', 'important');
    b.style.setProperty('margin', '0', 'important');
  }

  function releaseBody() {
    const b = document.body;
    if (!b || heldBodyStyle === undefined) return;
    if (heldBodyStyle === null) b.removeAttribute('style');
    else b.setAttribute('style', heldBodyStyle);
    heldBodyStyle = undefined;
  }

  // One global rule, and it only bites once our own UI is up.
  //
  // At document-start the document can still be completely empty — no head and
  // no documentElement — so this has to survive being called too early and be
  // safe to call again later.
  function armTakeover() {
    if (document.getElementById('rzk-takeover')) return true;
    const parent = document.head || document.documentElement;
    if (!parent) return false;
    const style = document.createElement('style');
    style.id = 'rzk-takeover';
    // Both states hide the original. "boot" additionally paints a cover over
    // the whole viewport, drawn with pseudo-elements on <html> because at
    // document-start there is no <body> to append anything to yet.
    style.textContent = `
      html[data-rzk] body > *:not(#rzk-app) { display: none !important; }
      html[data-rzk] { background: #0b0b0e; }
      html[data-rzk] body {
        overflow: auto !important;
        padding: 0 !important;
        margin: 0 !important;
        background: #0b0b0e !important;
      }
      /* Watch mode is a sheet over the page; nothing behind it should scroll. */
      html[data-rzk-watch] body { overflow: hidden !important; }

      html[data-rzk]::before, html[data-rzk]::after {
        content: ''; position: fixed; z-index: 2147483646; pointer-events: none;
      }
      html[data-rzk]::before {
        inset: 0; background: #0b0b0e; opacity: 1; transition: opacity .3s ease;
      }
      html[data-rzk]::after {
        left: 50%; top: 50%; width: 34px; height: 34px; margin: -17px 0 0 -17px;
        border-radius: 10px; background: linear-gradient(135deg, #4aa8ff, #0a5cff);
        box-shadow: 0 8px 24px rgba(10, 92, 255, .35);
        animation: rzk-breathe 1.15s ease-in-out infinite;
      }
      html[data-rzk="on"]::before, html[data-rzk="on"]::after {
        animation: none; opacity: 0; visibility: hidden;
        transition: opacity .3s ease, visibility 0s linear .3s;
      }
      html[data-rzk="on"] #rzk-app { animation: rzk-arrive .3s ease both; }

      @keyframes rzk-breathe {
        0%, 100% { transform: scale(.86); opacity: .45; }
        50% { transform: scale(1); opacity: 1; }
      }
      @keyframes rzk-arrive { from { opacity: 0; } to { opacity: 1; } }
      @media (prefers-reduced-motion: reduce) {
        html[data-rzk]::after { animation: none; }
        html[data-rzk="on"] #rzk-app { animation: none; }
      }`;
    parent.appendChild(style);
    return true;
  }

  // Sections whose pages this script renders. Checked against the URL alone so
  // the cover can go up before the first paint, long before any markup exists.
  const OWNED = ['/films', '/series', '/cartoons', '/animation', '/search', '/page', '/best'];

  function likelyOurs(p) {
    if (p === '' || p === '/') return true;
    if (ID_IN_PATH.test(p)) return true;
    return OWNED.some(root => p === root || p.startsWith(root + '/'));
  }

  let bootTimer = null;

  /**
   * Cover the page before it paints. The rule is that this can only ever be
   * temporary: whatever happens next — a page we do not render, a thrown error,
   * or simply taking too long — the cover comes off and the site is returned.
   */
  function beginBoot() {
    let here = '';
    try { here = location.pathname || ''; } catch (e) {}
    if (!likelyOurs(here)) return;

    // At document-start the document can be genuinely empty — no <html> yet.
    // Waiting for it is the difference between covering the page and letting
    // it flash.
    if (!document.documentElement) {
      new MutationObserver((_, obs) => {
        if (!document.documentElement) return;
        obs.disconnect();
        beginBoot();
      }).observe(document, { childList: true, subtree: true });
      return;
    }

    if (!armTakeover()) return;
    document.documentElement.setAttribute('data-rzk', 'boot');
    bootTimer = setTimeout(reveal, 8000);
  }

  /** Take the cover off, unless our own UI is already up behind it. */
  function reveal() {
    clearTimeout(bootTimer);
    if (document.documentElement.getAttribute('data-rzk') === 'boot') {
      document.documentElement.removeAttribute('data-rzk');
    }
  }

  // Nothing here may throw its way out: a failure in one step must not stop the
  // others from running, and a half-built UI must never leave a blank page.
  function guard(label, fn) {
    try { return fn(); }
    catch (e) { console.error(`[rezka] ${label}:`, e); return null; }
  }

  function boot() {
    guard('takeover', armTakeover);
    const kind = guard('detect', () => site.kind());
    if (!kind) { reveal(); return; }
    guard('render', () => {
      try {
        if (kind === 'watch') initWatch();
        else ui.mount(gridView.render());
      } catch (e) {
        // Give the real site back rather than stranding the reader.
        clearTimeout(bootTimer);
        document.documentElement.removeAttribute('data-rzk');
        releaseBody();
        document.getElementById('rzk-app')?.remove();
        throw e;
      }
    });
  }

  guard('intercept', interceptXHR);
  guard('boot-cover', beginBoot);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
