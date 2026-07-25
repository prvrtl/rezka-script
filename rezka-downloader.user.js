// ==UserScript==
// @name           Rezka Downloader
// @namespace      https://greasyfork.org/en/users/1458606-saarmaat
// @version        2.1
// @description    Extracts the highest non-PRO video quality from HDrezka. Supports direct downloads, copied links, and Leech integration.
// @author         Roman (saarmaat) <gargle_sower_4w@icloud.com>
// @supportURL     mailto:gargle_sower_4w@icloud.com
// @license        MIT
// @match          https://rezka-ua.tv/*/*
// @match          https://hdrezka.me/*/*
// @match          https://hdrezka.co/*/*
// @match          https://rezka.ag/*/*
// @match          https://hello-rezka.tv/*/*
// @include        http*://*rezka*/*/*
// @include        http*://hdrezka*/*/*
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

  const PREF_QUALITY = 'rzk.quality';
  const PREF_OPEN = 'rzk.open';

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
  // Everything that knows what HDrezka's markup looks like lives here, so a
  // layout change on their side is a one-file-section problem.

  const site = {
    contentId() {
      return document.getElementById('post_id')?.value
        || document.querySelector('[data-id]')?.dataset?.id
        || null;
    },

    watchable() {
      return Boolean(site.contentId());
    },

    isSeries() {
      return Boolean(document.querySelector('.b-simple_episode__item'));
    },

    originalTitle() {
      const orig = document.querySelector('.b-post__origtitle')?.textContent?.trim();
      if (orig) return orig.split('/').pop().trim();
      return document.querySelector('h1')?.textContent?.trim() || '';
    },

    year() {
      return document.querySelector('meta[property="og:title"]')?.content?.match(/\((\d{4})\)/)?.[1] || '';
    },

    season() {
      return document.querySelector('.b-simple_season__item.active')?.dataset?.tab_id || null;
    },

    episode() {
      return document.querySelector('.b-simple_episode__item.active')?.dataset?.episode_id || null;
    },

    translators() {
      return [...document.querySelectorAll('.b-translator__item')].map(el => ({
        id: el.dataset.translator_id,
        name: el.textContent.trim(),
        premium: el.classList.contains('b-prem_translator'),
        active: el.classList.contains('active')
      }));
    },

    // Films carry no tabs at all: the translation is named in the info table and
    // the id is only ever mentioned inside an inline script.
    soleTranslator() {
      const row = [...document.querySelectorAll('.b-post__info tr')]
        .find(tr => tr.querySelector('td.l')?.textContent.includes('В переводе'));
      return {
        id: site.scrapeTranslatorId() || 'single',
        name: row?.querySelector('td:not(.l)')?.textContent.trim() || 'Original',
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

    // The default voiceover's list is already in the page on first paint.
    inlineStreams() {
      for (const s of document.scripts) {
        if (s.src) continue;
        const m = s.textContent.match(/(?:["'])(\[(?:1080|720|480|360|2160)p[^\]]*\][^"']+)(?:["'])/);
        if (!m) continue;
        const raw = m[1].replace(/\\u003e/g, '>').replace(/\\u003c/g, '<').replace(/\\/g, '');
        return { id: site.scrapeTranslatorId() || 'single', raw };
      }
      return null;
    },

    selectTranslator(id) {
      const tab = document.querySelector(`.b-translator__item[data-translator_id="${id}"]`);
      if (tab) tab.click();
      return Boolean(tab);
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
          try {
            data = JSON.parse(xhr.responseText);
          } catch (e) {
            reject(new Error('Unreadable response')); return;
          }
          if (!data.success || !data.url) {
            reject(new Error(data.message || 'No stream returned')); return;
          }
          resolve(api.parse(data.url));
        };
        xhr.onerror = () => reject(new Error('Request failed'));
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
        const url = m[2].split(' or ')[0].replace(/:hls:manifest\.m3u8$/, '').trim();
        if (!url) continue;
        out.push({
          label,
          url,
          premium: m[1].includes('prem-quality') || label.includes('PRO'),
          rank: api.rank(label)
        });
      }
      return out.sort((a, b) => b.rank - a.rank);
    },

    // Labels are free text, so map what they mean rather than trusting digits:
    // "4K" has no resolution in it and "1080p Ultra" has two numbers.
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
    [/english\b|original\b|оригинал|оригінал|en\s+sub/, '🌐'],
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
    const title = site.originalTitle()
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '.')
      .replace(/\.+/g, '.');
    const s = site.season();
    const e = site.episode();
    const se = s && e ? `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}` : '';
    return [title, site.year(), se, quality].filter(Boolean).join('.') + '.mp4';
  }

  // ---------------------------------------------------------------- store ----

  const store = {
    streams: {},                              // translatorId -> parsed list
    translator: null,
    quality: prefs.get(PREF_QUALITY, null),
    status: null,                             // { kind: 'wait'|'error', text }
    open: prefs.get(PREF_OPEN, false),
    listeners: [],

    subscribe(fn) { store.listeners.push(fn); },
    emit() { for (const fn of store.listeners) fn(); },

    patch(next) {
      Object.assign(store, next);
      store.emit();
    },

    current() {
      return store.streams[store.translator] || null;
    },

    free() {
      return (store.current() || []).filter(s => !s.premium);
    },

    // The remembered quality wins when this release has it, otherwise best available.
    selected() {
      const free = store.free();
      if (!free.length) return null;
      return free.find(s => s.label === store.quality) || free[0];
    }
  };

  // ------------------------------------------------------------------- ui ----

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; font: inherit; color: inherit; }
    .root {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
      display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px; line-height: 1.45; color: #f2f2f4;
      -webkit-font-smoothing: antialiased;
    }

    .card {
      width: 272px; padding: 8px;
      background: rgba(24,24,27,0.96);
      -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.09);
      border-radius: 16px;
      box-shadow: 0 16px 40px rgba(0,0,0,0.45);
      transition: opacity .16s ease, transform .16s ease;
    }
    .card[hidden] { display: none; }
    .card.enter { opacity: 0; transform: translateY(6px); }

    .row { position: relative; }

    .field {
      display: flex; align-items: center; gap: 10px; width: 100%;
      padding: 9px 10px; border: 0; border-radius: 10px; cursor: pointer;
      background: transparent; text-align: left;
      transition: background .12s ease;
    }
    .field:hover { background: rgba(255,255,255,0.05); }
    .field .k { font-size: 11px; color: rgba(255,255,255,0.4); flex: none; }
    .field .v { margin-left: auto; font-size: 13px; font-weight: 500;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .field .chev { flex: none; opacity: .35; transition: transform .16s ease; }
    .field[aria-expanded="true"] .chev { transform: rotate(180deg); }
    .field:disabled { cursor: default; opacity: .45; }
    .field:disabled:hover { background: transparent; }

    .menu {
      position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 2;
      max-height: 216px; overflow-y: auto; padding: 4px;
      background: rgba(38,38,42,0.99);
      border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.5);
    }
    .menu[hidden] { display: none; }
    .menu::-webkit-scrollbar { width: 6px; }
    .menu::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 8px; }

    .opt {
      display: flex; align-items: center; gap: 8px; width: 100%;
      padding: 8px 10px; border: 0; border-radius: 8px; cursor: pointer;
      background: transparent; text-align: left; font-size: 13px;
    }
    .opt:hover { background: rgba(255,255,255,0.07); }
    .opt .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .opt .tick { margin-left: auto; flex: none; opacity: 0; }
    .opt[aria-selected="true"] .tick { opacity: 1; }
    .opt[aria-selected="true"] { color: #4da3ff; }

    .sep { height: 1px; margin: 6px 4px; background: rgba(255,255,255,0.07); }

    .status { padding: 2px 10px 8px; font-size: 12px; color: rgba(255,255,255,0.4); }
    .status[hidden] { display: none; }
    .status.error { color: #ff8f8f; }

    .primary {
      display: flex; align-items: center; justify-content: center; gap: 7px; width: 100%;
      padding: 11px; border: 0; border-radius: 10px; cursor: pointer;
      background: #0a84ff; color: #fff; font-size: 13px; font-weight: 600;
      transition: background .12s ease, opacity .12s ease;
    }
    .primary:hover:not(:disabled) { background: #2b95ff; }
    .primary:active:not(:disabled) { background: #0070e0; }
    .primary:disabled { cursor: default; opacity: .35; }

    .minor { display: flex; align-items: center; justify-content: center; gap: 2px; padding-top: 4px; }
    .minor button {
      padding: 7px 10px; border: 0; border-radius: 8px; cursor: pointer;
      background: transparent; color: rgba(255,255,255,0.5); font-size: 12px;
      transition: color .12s ease, background .12s ease;
    }
    .minor button:hover:not(:disabled) { color: #fff; background: rgba(255,255,255,0.06); }
    .minor button:disabled { cursor: default; opacity: .35; }
    .minor .dot { width: 3px; height: 3px; border-radius: 50%; background: rgba(255,255,255,0.2); }

    .trigger {
      display: grid; place-items: center; width: 42px; height: 42px; flex: none;
      border-radius: 50%; cursor: pointer; color: #f2f2f4;
      background: rgba(24,24,27,0.96);
      -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 8px 20px rgba(0,0,0,0.35);
      transition: background .12s ease, transform .1s ease;
    }
    .trigger:hover { background: rgba(42,42,48,0.98); }
    .trigger:active { transform: scale(.94); }
    .trigger .badge {
      position: absolute; top: -2px; right: -2px; width: 8px; height: 8px;
      border-radius: 50%; background: #0a84ff; border: 2px solid rgba(24,24,27,1);
    }
    .trigger .badge[hidden] { display: none; }

    .toast {
      position: fixed; right: 20px; bottom: 74px;
      padding: 8px 14px; border-radius: 10px;
      background: rgba(38,38,42,0.98); border: 1px solid rgba(255,255,255,0.1);
      font-size: 12px; color: #f2f2f4; pointer-events: none;
      box-shadow: 0 10px 28px rgba(0,0,0,0.45);
      animation: rise .18s ease;
    }
    @keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

    button:focus-visible { outline: 2px solid #0a84ff; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
  `;

  const ICON = {
    down: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13"/><path d="m6 11 6 6 6-6"/><path d="M4 21h16"/></svg>',
    chev: '<svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    tick: '<svg class="tick" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>'
  };

  const ui = {
    root: null,
    shadow: null,
    el: {},
    menu: null,          // which menu is open: 'qualities' | 'translators' | null

    mount() {
      if (document.getElementById('rzk-root')) return;

      const host = document.createElement('div');
      host.id = 'rzk-root';
      // Shadow DOM both ways: the site's stylesheet can't reach the panel, and
      // the panel's rules can't restyle the site.
      const shadow = host.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = CSS;

      const root = document.createElement('div');
      root.className = 'root';
      root.innerHTML = `
        <section class="card" id="rzk-card" role="dialog" aria-label="Rezka Downloader" hidden>
          <div class="row">
            <button class="field" type="button" data-el="qualityField" data-menu="qualities"
                    aria-haspopup="listbox" aria-expanded="false" aria-controls="rzk-menu-q" disabled>
              <span class="k">Quality</span>
              <span class="v" data-el="qualityValue">—</span>
              ${ICON.chev}
            </button>
            <div class="menu" id="rzk-menu-q" data-el="qualities" role="listbox" aria-label="Quality" hidden></div>
          </div>
          <div class="row">
            <button class="field" type="button" data-el="voiceField" data-menu="translators"
                    aria-haspopup="listbox" aria-expanded="false" aria-controls="rzk-menu-v">
              <span class="k">Voice</span>
              <span class="v" data-el="voiceValue">—</span>
              ${ICON.chev}
            </button>
            <div class="menu" id="rzk-menu-v" data-el="translators" role="listbox" aria-label="Voiceover" hidden></div>
          </div>

          <div class="sep"></div>
          <p class="status" data-el="status" role="status" aria-live="polite" hidden></p>

          <button class="primary" type="button" data-el="download" data-act="download" disabled>
            ${ICON.down}<span>Download</span>
          </button>
          <div class="minor">
            <button type="button" data-el="copy" data-act="copy" disabled>Copy link</button>
            <span class="dot"></span>
            <button type="button" data-el="leech" data-act="leech" disabled>Leech</button>
          </div>
        </section>

        <button class="trigger" type="button" data-el="pill" aria-expanded="false"
                aria-controls="rzk-card" aria-label="Rezka Downloader" title="Rezka Downloader">
          ${ICON.down}<span class="badge" data-el="badge" hidden></span>
        </button>`;

      shadow.append(style, root);
      document.body.appendChild(host);

      ui.root = host;
      ui.shadow = shadow;
      for (const el of root.querySelectorAll('[data-el]')) ui.el[el.dataset.el] = el;
      ui.el.card = root.querySelector('.card');

      ui.bind();
      ui.setOpen(store.open, { silent: true });
      ui.render();
    },

    bind() {
      ui.el.pill.addEventListener('click', () => ui.setOpen(!store.open));

      for (const field of [ui.el.qualityField, ui.el.voiceField]) {
        field.addEventListener('click', () => ui.openMenu(ui.menu === field.dataset.menu ? null : field.dataset.menu));
      }

      ui.el.qualities.addEventListener('click', e => {
        const opt = e.target.closest('.opt[data-label]');
        if (!opt) return;
        actions.chooseQuality(opt.dataset.label);
        ui.openMenu(null);
      });

      ui.el.translators.addEventListener('click', e => {
        const opt = e.target.closest('.opt[data-id]');
        if (!opt) return;
        actions.chooseTranslator(opt.dataset.id);
        ui.openMenu(null);
      });

      for (const el of [ui.el.download, ui.el.copy, ui.el.leech]) {
        el.addEventListener('click', () => actions.run(el.dataset.act));
      }

      ui.shadow.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (ui.menu) ui.openMenu(null);
        else if (store.open) { ui.setOpen(false); ui.el.pill.focus(); }
      });

      // A click anywhere else dismisses an open menu.
      document.addEventListener('click', e => {
        if (ui.menu && !e.composedPath().includes(ui.root)) ui.openMenu(null);
      }, true);
    },

    openMenu(name) {
      ui.menu = name;
      for (const [key, field] of [['qualities', ui.el.qualityField], ['translators', ui.el.voiceField]]) {
        const open = key === name;
        ui.el[key].hidden = !open;
        field.setAttribute('aria-expanded', String(open));
      }
    },

    setOpen(open, { silent = false } = {}) {
      store.open = open;
      prefs.set(PREF_OPEN, open);
      ui.el.card.hidden = !open;
      ui.el.pill.setAttribute('aria-expanded', String(open));
      if (!open) ui.openMenu(null);
      if (open && !silent) {
        ui.el.card.classList.add('enter');
        requestAnimationFrame(() => ui.el.card.classList.remove('enter'));
      }
      ui.render();
    },

    render() {
      if (!ui.root) return;

      const free = store.free();
      const picked = store.selected();
      const voices = actions.translatorList();
      const voice = voices.find(t => t.id === store.translator) || voices[0] || null;

      ui.el.qualityValue.textContent = picked ? picked.label : '—';
      ui.el.qualityField.disabled = free.length < 2;
      ui.el.qualities.innerHTML = free.map(s => `
        <button class="opt" type="button" role="option" data-label="${escapeHtml(s.label)}"
                aria-selected="${s === picked}">
          <span class="name">${escapeHtml(s.label)}</span>${ICON.tick}
        </button>`).join('');

      const voiceLabel = voice ? `${flagFor(voice.name) ? flagFor(voice.name) + ' ' : ''}${voice.name}` : '—';
      ui.el.voiceValue.textContent = voiceLabel;
      ui.el.voiceValue.title = voiceLabel;
      ui.el.voiceField.disabled = voices.length < 2;
      ui.el.translators.innerHTML = voices.map(t => {
        const flag = flagFor(t.name);
        return `
        <button class="opt" type="button" role="option" data-id="${escapeHtml(t.id)}"
                aria-selected="${t.id === store.translator}">
          <span class="name">${flag ? flag + ' ' : ''}${escapeHtml(t.name)}</span>${ICON.tick}
        </button>`;
      }).join('');

      // Only ever say something when there is something to say.
      const note = store.status
        || (store.current() && !free.length ? { kind: 'error', text: 'No free quality' } : null);
      ui.el.status.hidden = !note;
      ui.el.status.textContent = note ? note.text : '';
      ui.el.status.classList.toggle('error', note?.kind === 'error');

      const ready = Boolean(picked);
      ui.el.download.disabled = !ready;
      ui.el.copy.disabled = !ready;
      ui.el.leech.disabled = !ready;
      ui.el.badge.hidden = !ready || store.open;
    },

    toast(message) {
      if (!ui.shadow) return;
      const el = document.createElement('div');
      el.className = 'toast';
      el.textContent = message;
      ui.shadow.querySelector('.root').appendChild(el);
      setTimeout(() => el.remove(), 2200);
    }
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // -------------------------------------------------------------- actions ----

  let watchdog = null;

  const actions = {
    translatorList() {
      const tabs = site.translators().filter(t => !t.premium);
      return tabs.length ? tabs : [site.soleTranslator()];
    },

    ingest(translatorId, list) {
      clearTimeout(watchdog);
      store.patch({
        streams: { ...store.streams, [translatorId]: list },
        translator: translatorId,
        status: null
      });
    },

    fail(message) {
      clearTimeout(watchdog);
      store.patch({ status: { kind: 'error', text: message } });
    },

    chooseTranslator(id) {
      if (id === store.translator) return;
      site.selectTranslator(id);
      store.patch({ translator: id, status: store.streams[id] ? null : { kind: 'wait', text: 'Loading…' } });
      if (!store.streams[id]) actions.fetch(id);
    },

    chooseQuality(label) {
      store.quality = label;
      prefs.set(PREF_QUALITY, label);
      store.emit();
    },

    // A season/episode switch invalidates whatever we hold: the cached URL is
    // the previous episode's file, and handing that out is worse than waiting.
    invalidate() {
      const next = { ...store.streams };
      delete next[store.translator];
      store.patch({ streams: next, status: { kind: 'wait', text: 'Loading…' } });
      actions.arm();
    },

    fetch(translatorId) {
      const id = site.contentId();
      if (!id || !translatorId || translatorId === 'single') return;
      api.request({
        id,
        translatorId,
        season: site.season(),
        episode: site.episode(),
        series: site.isSeries()
      }).then(list => actions.ingest(translatorId, list), err => actions.fail(err.message));
    },

    // The site normally fires its own request and the hook picks it up. When it
    // doesn't, ask once, then say so rather than spinning forever.
    arm() {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (store.current()) return;
        actions.fetch(store.translator);
        watchdog = setTimeout(() => {
          if (!store.current()) actions.fail('No response — reload the page');
        }, 8000);
      }, 1500);
    },

    run(kind) {
      const picked = store.selected();
      if (!picked) return;
      const name = filename(picked.label);

      if (kind === 'copy') {
        GM_setClipboard(picked.url);
        ui.toast('Link copied');
        return;
      }
      if (kind === 'leech') {
        GM_setClipboard(name);
        ui.toast('Sent to Leech');
        const target = picked.url.replace(/^https?:\/\//, m => (m.includes('https') ? 'secureleech://' : 'leech://'));
        const a = document.createElement('a');
        a.href = target;
        a.click();
        return;
      }
      // Browsers ignore <a download> cross-origin, so the manager's downloader is
      // the only way the generated filename actually survives.
      if (typeof GM_download === 'function') {
        GM_download({ url: picked.url, name, saveAs: false, onerror: () => anchorDownload(picked.url, name) });
      } else {
        anchorDownload(picked.url, name);
      }
      ui.toast(`Downloading ${picked.label}`);
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

  // Reuse the site's own stream responses instead of duplicating the request.
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
          const params = typeof body === 'string' ? new URLSearchParams(body) : null;
          const tid = params?.get('translator_id')
            || document.querySelector('.b-translator__item.active')?.dataset?.translator_id;
          if (tid) actions.ingest(tid, api.parse(data.url));
        });
      }
      return send.apply(this, arguments);
    };
  }

  // ----------------------------------------------------------------- boot ----

  // Prefer a free Ukrainian track, and never leave a premium one selected.
  function pickInitialTranslator() {
    const free = site.translators().filter(t => !t.premium);
    if (!free.length) return site.soleTranslator().id;

    const active = site.translators().find(t => t.active);
    const ukrainian = free.find(t => flagFor(t.name) === '🇺🇦');

    if (active && active.premium) return (ukrainian || free[0]).id;
    if (ukrainian && active && active.id !== ukrainian.id) return ukrainian.id;
    return active ? active.id : free[0].id;
  }

  function init() {
    if (!site.watchable()) return;

    const inline = site.inlineStreams();
    const target = pickInitialTranslator();

    store.subscribe(ui.render);
    ui.mount();

    if (inline) actions.ingest(inline.id, api.parse(inline.raw));

    if (target && target !== store.translator) {
      store.patch({ translator: target });
      if (!store.streams[target]) {
        if (site.selectTranslator(target)) store.patch({ status: { kind: 'wait', text: 'Loading…' } });
        actions.arm();
      }
    }

    document.addEventListener('click', e => {
      if (e.target.closest('.b-simple_season__item') || e.target.closest('.b-simple_episode__item')) {
        actions.invalidate();
      }
    }, true);
  }

  interceptXHR();
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
