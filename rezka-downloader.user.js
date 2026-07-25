// ==UserScript==
// @name           Rezka Downloader
// @namespace      https://greasyfork.org/en/users/1458606-saarmaat
// @version        2.0
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
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .root { position: fixed; right: 24px; bottom: 24px; z-index: 2147483000; width: 340px;
            display: flex; flex-direction: column; align-items: stretch; gap: 12px;
            font-size: 13px; line-height: 1.4; color: #f0f0f5; -webkit-font-smoothing: antialiased; }
    .panel { background: rgba(20,20,30,0.72); backdrop-filter: blur(24px) saturate(180%);
             -webkit-backdrop-filter: blur(24px) saturate(180%);
             border: 1px solid rgba(255,255,255,0.12); border-radius: 18px; padding: 16px;
             box-shadow: 0 24px 48px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1);
             transform-origin: bottom right; transition: opacity .25s ease, transform .25s cubic-bezier(.16,1,.3,1); }
    .panel[hidden] { display: none; }
    .panel.enter { opacity: 0; transform: translateY(8px) scale(.98); }
    .heading { font-weight: 600; font-size: 13px; color: rgba(255,255,255,.92);
               white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 14px; }
    .group { margin-bottom: 14px; }
    .group h2 { font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
                color: rgba(255,255,255,.5); margin-bottom: 8px; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; max-height: 132px; overflow-y: auto; }
    .chips::-webkit-scrollbar { width: 6px; }
    .chips::-webkit-scrollbar-thumb { background: rgba(255,255,255,.2); border-radius: 10px; }
    .chip { padding: 6px 14px; border-radius: 14px; cursor: pointer; white-space: nowrap;
            font-size: 12px; font-weight: 500; color: rgba(255,255,255,.7);
            background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08);
            transition: background .2s, border-color .2s, color .2s; }
    .chip:hover { background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.2); color: #fff; }
    .chip[aria-pressed="true"] { background: rgba(10,132,255,.85); border-color: rgba(10,132,255,1);
                                 color: #fff; box-shadow: 0 4px 12px rgba(10,132,255,.3); }
    .chip:focus-visible, .btn:focus-visible, .pill:focus-visible { outline: 2px solid #0a84ff; outline-offset: 2px; }
    .empty { font-size: 12px; color: rgba(255,255,255,.4); }
    .status { font-size: 12px; margin-bottom: 12px; color: rgba(255,255,255,.55); }
    .status.error { color: #ff9f9f; }
    .actions { display: flex; gap: 8px; align-items: stretch; }
    .btn { display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer;
           border-radius: 12px; font-size: 13px; font-weight: 600; padding: 10px 4px;
           border: 1px solid transparent; transition: background .2s, border-color .2s, transform .1s; }
    .btn:disabled { opacity: .4; cursor: not-allowed; filter: grayscale(100%); }
    .btn:active:not(:disabled) { transform: scale(.96); }
    .btn-dl { flex: 1.2; background: rgba(10,132,255,.85); color: #fff; border-color: rgba(255,255,255,.1); }
    .btn-dl:hover:not(:disabled) { background: rgba(10,132,255,1); }
    .btn-leech { flex: 1; background: rgba(48,209,88,.15); color: rgb(48,209,88); border-color: rgba(48,209,88,.3); }
    .btn-leech:hover:not(:disabled) { background: rgba(48,209,88,.25); color: #fff; }
    .btn-copy { width: 44px; background: rgba(255,255,255,.08); color: rgba(255,255,255,.8); border-color: rgba(255,255,255,.1); }
    .btn-copy:hover:not(:disabled) { background: rgba(255,255,255,.15); color: #fff; }
    .pill { display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer;
            align-self: flex-end; padding: 12px 20px; border-radius: 24px; font-weight: 600; font-size: 14px;
            letter-spacing: .3px; color: #fff; background: rgba(20,20,30,.75);
            backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%);
            border: 1px solid rgba(255,255,255,.12);
            box-shadow: 0 8px 24px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.1);
            transition: background .2s, transform .1s; }
    .pill:hover { background: rgba(35,35,50,.8); }
    .pill:active { transform: scale(.97); }
    .toast { position: fixed; right: 24px; bottom: 96px; padding: 12px 20px; border-radius: 14px;
             background: rgba(20,20,30,.88); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
             border: 1px solid rgba(255,255,255,.15); color: #fff; font-size: 13px; font-weight: 500;
             box-shadow: 0 12px 32px rgba(0,0,0,.4); pointer-events: none; animation: pop .35s cubic-bezier(.16,1,.3,1); }
    @keyframes pop { from { opacity: 0; transform: translateY(16px) scale(.92); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
  `;

  const LEECH_ICON = `<svg width="14" height="14" viewBox="0 0 100 100" aria-hidden="true" style="display:block;flex-shrink:0"><defs><radialGradient id="lg" cx="42%" cy="32%" r="62%"><stop offset="0%" stop-color="#72e354"/><stop offset="100%" stop-color="#28a016"/></radialGradient></defs><rect width="100" height="100" rx="22" fill="url(#lg)"/><rect x="43" y="16" width="14" height="40" rx="7" fill="white"/><polygon points="50,84 20,53 80,53" fill="white"/></svg>`;
  const DL_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

  const ui = {
    root: null,
    shadow: null,
    el: {},

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
        <section class="panel" part="panel" role="dialog" aria-label="Rezka Downloader" hidden>
          <p class="heading" data-el="heading"></p>
          <div class="group">
            <h2 id="rzk-lbl-voice">Voiceover</h2>
            <div class="chips" data-el="translators" role="group" aria-labelledby="rzk-lbl-voice"></div>
          </div>
          <div class="group">
            <h2 id="rzk-lbl-quality">Quality</h2>
            <div class="chips" data-el="qualities" role="group" aria-labelledby="rzk-lbl-quality"></div>
          </div>
          <p class="status" data-el="status" role="status" aria-live="polite"></p>
          <div class="actions">
            <button class="btn btn-dl" data-el="download" data-act="download" type="button" disabled></button>
            <button class="btn btn-leech" data-el="leech" data-act="leech" type="button" disabled></button>
            <button class="btn btn-copy" data-el="copy" data-act="copy" type="button" disabled title="Copy link" aria-label="Copy link">📋</button>
          </div>
        </section>
        <button class="pill" data-el="pill" type="button" aria-expanded="false" aria-controls="rzk-panel">
          <span>Rezka DL</span>${DL_ICON}
        </button>`;

      shadow.append(style, root);
      document.body.appendChild(host);

      ui.root = host;
      ui.shadow = shadow;
      for (const el of root.querySelectorAll('[data-el]')) ui.el[el.dataset.el] = el;
      ui.el.panel = root.querySelector('.panel');
      ui.el.panel.id = 'rzk-panel';

      ui.bind();
      ui.setOpen(store.open, { silent: true });
      ui.render();
    },

    bind() {
      ui.el.pill.addEventListener('click', () => ui.setOpen(!store.open));

      ui.el.translators.addEventListener('click', e => {
        const chip = e.target.closest('.chip[data-id]');
        if (!chip) return;
        actions.chooseTranslator(chip.dataset.id);
      });

      ui.el.qualities.addEventListener('click', e => {
        const chip = e.target.closest('.chip[data-label]');
        if (!chip) return;
        actions.chooseQuality(chip.dataset.label);
      });

      for (const el of [ui.el.download, ui.el.leech, ui.el.copy]) {
        el.addEventListener('click', () => actions.run(el.dataset.act));
      }

      ui.shadow.addEventListener('keydown', e => {
        if (e.key === 'Escape' && store.open) { ui.setOpen(false); ui.el.pill.focus(); }
      });
    },

    setOpen(open, { silent = false } = {}) {
      store.open = open;
      prefs.set(PREF_OPEN, open);
      ui.el.panel.hidden = !open;
      ui.el.pill.setAttribute('aria-expanded', String(open));
      if (open && !silent) {
        ui.el.panel.classList.add('enter');
        requestAnimationFrame(() => ui.el.panel.classList.remove('enter'));
      }
    },

    chip(attrs, label, pressed) {
      return `<button class="chip" type="button" role="radio" aria-pressed="${pressed}" ${attrs}>${label}</button>`;
    },

    render() {
      if (!ui.root) return;

      ui.el.heading.textContent = site.originalTitle();
      ui.el.heading.title = site.originalTitle();

      const translators = actions.translatorList();
      ui.el.translators.innerHTML = translators.length
        ? translators.map(t => {
            const flag = flagFor(t.name);
            return ui.chip(`data-id="${t.id}"`, `${flag ? flag + ' ' : ''}${escapeHtml(t.name)}`, t.id === store.translator);
          }).join('')
        : '<span class="empty">No voiceovers found</span>';

      const free = store.free();
      const picked = store.selected();
      ui.el.qualities.innerHTML = free.length
        ? free.map(s => ui.chip(`data-label="${escapeHtml(s.label)}"`, escapeHtml(s.label), s === picked)).join('')
        : `<span class="empty">${store.current() ? 'No free quality' : '—'}</span>`;

      const status = store.status;
      ui.el.status.textContent = status ? status.text : '';
      ui.el.status.classList.toggle('error', status?.kind === 'error');

      const ready = Boolean(picked);
      ui.el.download.disabled = !ready;
      ui.el.leech.disabled = !ready;
      ui.el.copy.disabled = !ready;
      ui.el.download.innerHTML = ready
        ? `${DL_ICON} Download <span>(${escapeHtml(picked.label)})</span>`
        : `${DL_ICON} Download`;
      ui.el.leech.innerHTML = `${LEECH_ICON} Leech`;
    },

    toast(message) {
      if (!ui.shadow) return;
      const el = document.createElement('div');
      el.className = 'toast';
      el.textContent = message;
      ui.shadow.querySelector('.root').appendChild(el);
      setTimeout(() => el.remove(), 2500);
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
        ui.toast('Direct link copied');
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
