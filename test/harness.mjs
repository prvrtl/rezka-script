import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '..', 'rezka-downloader.user.js');

/**
 * A stand-in for XMLHttpRequest that never touches the network. The userscript
 * patches XMLHttpRequest.prototype.open/send at load time, so this has to be
 * installed on the window before the script is evaluated for the intercept
 * path to be exercised the same way it is in a browser.
 */
function makeXHRClass(sent, auto) {
  return class FakeXHR {
    constructor() {
      this._listeners = { load: [] };
      this._headers = {};
      this.responseText = '';
      this.status = 200;
    }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(k, v) { this._headers[k] = v; }
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    send(body) {
      this.body = body;
      sent.push(this);
      // Optionally answer on its own, so a queue can run without hand-feeding.
      if (auto) queueMicrotask(() => { try { this.respond(auto(body)); } catch (e) {} });
    }
    /** Test-side helper: deliver a response and fire the load handlers. */
    respond(payload) {
      this.responseText = typeof payload === 'string' ? payload : JSON.stringify(payload);
      for (const fn of this._listeners.load) fn.call(this);
      if (typeof this.onload === 'function') this.onload.call(this);
    }
  };
}

/**
 * jsdom has no media stack: play/pause throw "not implemented" and duration is
 * always NaN. Stub just enough that the player's own logic runs, and record
 * what it asked the element to do.
 */
function stubMedia(window, effects) {
  const proto = window.HTMLMediaElement.prototype;
  proto.play = function () { this.paused = false; this.dispatchEvent(new window.Event('play')); return Promise.resolve(); };
  proto.pause = function () { this.paused = true; this.dispatchEvent(new window.Event('pause')); };
  proto.load = function () {};
  Object.defineProperty(proto, 'paused', { writable: true, configurable: true, value: true });
  Object.defineProperty(proto, 'src', {
    configurable: true,
    get() { return this.getAttribute('src') || ''; },
    set(v) { this.setAttribute('src', v); effects.videoSrc.push(v); }
  });
  // Tests drive these directly: how much has arrived, and how long the file is.
  Object.defineProperty(proto, 'buffered', {
    configurable: true,
    get() {
      const end = this.__buffered || 0;
      return { length: end ? 1 : 0, end: () => end };
    }
  });
  Object.defineProperty(proto, 'duration', {
    configurable: true,
    get() { return this.__duration ?? NaN; }
  });
  Object.defineProperty(proto, 'currentTime', {
    configurable: true,
    get() { return this.__currentTime || 0; },
    set(v) { this.__currentTime = v; }
  });
}

export function load(html, {
  url = 'https://rezka-ua.tv/films/drama/1-x.html',
  /** true, or (opts, nth) => 'ok' | 'fail' — omit for no GM_download at all. */
  gmDownload = false,
  /** Byte size the fake GM_xmlhttpRequest reports; omit for no such API. */
  fileSize = null,
  /** true, or (body) => payload — auto-answer /ajax/get_cdn_series/ requests. */
  autoStream = false,
  /** Values seeded into localStorage before the script is evaluated. */
  storage = null,
  /** true, or (text) => translated — installs a fake on-device Translator. */
  translator = false,
} = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;

  const effects = {
    clipboard: [], anchorClicks: [], downloads: [], xhrs: [],
    videoSrc: [], navigated: [], headRequests: [], aborted: [],
    /** Download names in the order they completed. */
    finished: []
  };

  window.HTMLAnchorElement.prototype.click = function () {
    effects.anchorClicks.push({
      href: this.getAttribute('href'),
      download: this.getAttribute('download')
    });
  };
  stubMedia(window, effects);

  // jsdom won't let window.location be replaced, and real navigation throws.
  // Shadow the binding for the script instead — the file itself is untouched.
  window.__rzkLocation = {
    pathname: new URL(url).pathname,
    get href() { return url; },
    set href(v) { effects.navigated.push(v); }
  };

  const streamFor = autoStream === true
    ? (body) => {
        const p = new URLSearchParams(body);
        const s = p.get('season') || '0';
        const e = p.get('episode') || '0';
        return cdnPayload(`[720p]https://cdn.example.net/s${s}e${e}.mp4,[360p]https://cdn.example.net/s${s}e${e}_lo.mp4`);
      }
    : autoStream || null;

  const XHR = makeXHRClass(effects.xhrs, streamFor);
  window.XMLHttpRequest = XHR;
  window.GM_setClipboard = (text) => effects.clipboard.push(text);

  if (gmDownload) {
    const verdict = typeof gmDownload === 'function' ? gmDownload : () => 'ok';
    window.GM_download = (opts) => {
      effects.downloads.push(opts);
      const nth = effects.downloads.length;
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        if (verdict(opts, nth) === 'fail') { opts.onerror?.({ error: 'not_whitelisted' }); return; }
        opts.onprogress?.({ loaded: 512, total: 1024 });
        opts.onprogress?.({ loaded: 1024, total: 1024 });
        effects.finished.push(opts.name);
        opts.onload?.();
      });
      return { abort() { cancelled = true; effects.aborted.push(opts.name); opts.onerror?.({ error: 'aborted' }); } };
    };
  }
  if (fileSize !== null) {
    window.GM_xmlhttpRequest = (o) => {
      effects.headRequests.push(o.url);
      queueMicrotask(() => o.onload({ responseHeaders: `Content-Length: ${fileSize}\r\n` }));
    };
  }

  if (translator) {
    const render = typeof translator === 'function' ? translator : (t) => `[en] ${t}`;
    window.Translator = {
      availability: async () => 'available',
      create: async () => ({ translate: async (t) => render(t) }),
    };
  }

  if (storage) {
    for (const [k, v] of Object.entries(storage)) {
      window.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  }

  // Deterministic clock so buffer-rate maths doesn't depend on wall time.
  let now = 1_000_000;
  window.Date.now = () => now;
  window.__advance = (ms) => { now += ms; };

  const ctx = dom.getInternalVMContext();
  const source = readFileSync(SCRIPT, 'utf8');
  vm.runInContext(
    `(function (location) {\n${source}\n})(globalThis.__rzkLocation);`,
    ctx,
    { filename: 'rezka-downloader.user.js' }
  );

  return { dom, window, doc: window.document, effects, XHR };
}

/** Let the script's timers settle. */
export const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

/** The CDN payload shape the site returns from /ajax/get_cdn_series/. */
export const cdnPayload = (url) => ({ success: true, url, message: '' });

// ---- queries into the app's shadow root ----

export const shadow = (doc) => doc.getElementById('rzk-app')?.shadowRoot ?? null;
export const el = (doc, name) => shadow(doc)?.querySelector(`[data-el="${name}"]`) ?? null;
export const all = (doc, sel) => [...(shadow(doc)?.querySelectorAll(sel) ?? [])];
export const text = (doc, sel) => shadow(doc)?.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim() ?? null;

/** Value shown on a closed picker row ("voice" | "season" | "quality"). */
export const value = (doc, pick) => el(doc, `${pick}Value`)?.textContent.trim() ?? null;

export const options = (doc, menu) => all(doc, `[data-el="${menu}Menu"] .opt`);
export const optionLabels = (doc, menu) => options(doc, menu).map((o) => o.textContent.trim());

/** Whether the original page is currently hidden by the takeover. */
export const takenOver = (doc) => doc.documentElement.getAttribute('data-rzk') === 'on';
