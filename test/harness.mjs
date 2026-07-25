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
function makeXHRClass(sent) {
  return class FakeXHR {
    constructor() {
      this._listeners = { load: [] };
      this._headers = {};
      this.responseText = '';
      this.status = 200;
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(k, v) {
      this._headers[k] = v;
    }
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    }
    send(body) {
      this.body = body;
      sent.push(this);
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
 * Boot the userscript against a fixture document.
 * Returns the window plus the side effects the script produces, since almost
 * everything it does is either a DOM mutation or a GM_* call.
 */
export function load(html, { url = 'https://hdrezka.me/films/example.html', gmDownload = false } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;

  const effects = {
    clipboard: [],
    styles: [],
    anchorClicks: [],
    downloads: [],
    xhrs: [],
    errors: [],
  };

  // Anchors are how the script triggers both downloads and the leech handoff.
  // Recording clicks keeps jsdom from trying to navigate and lets us assert on
  // the href/download pair, which is the actual contract with the browser.
  window.HTMLAnchorElement.prototype.click = function () {
    effects.anchorClicks.push({
      href: this.getAttribute('href'),
      download: this.getAttribute('download'),
    });
  };

  const XHR = makeXHRClass(effects.xhrs);
  window.XMLHttpRequest = XHR;
  window.GM_addStyle = (css) => effects.styles.push(css);
  window.GM_setClipboard = (text) => effects.clipboard.push(text);
  // Not every manager grants GM_download, so the script has to cope either way.
  if (gmDownload) window.GM_download = (opts) => effects.downloads.push(opts);
  window.addEventListener('error', (e) => effects.errors.push(e.error || e.message));

  const ctx = dom.getInternalVMContext();
  vm.runInContext(readFileSync(SCRIPT, 'utf8'), ctx, { filename: 'rezka-downloader.user.js' });

  return { dom, window, doc: window.document, effects, XHR };
}

/** Let the script's setTimeout chains (100ms / 1000ms / 1500ms) settle. */
export const settle = (ms = 1600) => new Promise((r) => setTimeout(r, ms));

/** The CDN payload shape the site returns from /ajax/get_cdn_series/. */
export const cdnPayload = (url) => ({ success: true, url, message: '' });

/** The UI lives in an open shadow root; everything is queried through it. */
export const shadow = (doc) => doc.getElementById('rzk-root')?.shadowRoot ?? null;

export const el = (doc, name) => shadow(doc)?.querySelector(`[data-el="${name}"]`) ?? null;

/** Options inside one of the two dropdown menus ("qualities" | "translators"). */
export const opts = (doc, menu) =>
  [...(shadow(doc)?.querySelectorAll(`[data-el="${menu}"] .opt`) ?? [])];

export const optLabels = (doc, menu) => opts(doc, menu).map((o) => o.textContent.trim());

export const chosen = (doc, menu) =>
  opts(doc, menu).find((o) => o.getAttribute('aria-selected') === 'true') ?? null;

/** The value shown on a closed field row. */
export const value = (doc, field) => el(doc, `${field}Value`)?.textContent.trim() ?? null;
