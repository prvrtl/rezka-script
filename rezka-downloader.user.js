// ==UserScript==
// @name           Rezka Downloader
// @namespace      https://greasyfork.org/en/users/1458606-saarmaat
// @version        1.0
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
// @grant          GM_addStyle
// @run-at         document-start
// @homepageURL    https://github.com/prvrtl/rezka-script
// @downloadURL    https://raw.githubusercontent.com/prvrtl/rezka-script/main/rezka-downloader.user.js
// @updateURL      https://raw.githubusercontent.com/prvrtl/rezka-script/main/rezka-downloader.user.js
// ==/UserScript==

(function () {
  'use strict';

  let streams = {};
  let activeTranslator = null;
  let isOpen = false;

  const LEECH_ICON = `<svg width="14" height="14" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="display:block;flex-shrink:0"><defs><radialGradient id="rzk-lg" cx="42%" cy="32%" r="62%"><stop offset="0%" stop-color="#72e354"/><stop offset="100%" stop-color="#28a016"/></radialGradient></defs><rect width="100" height="100" rx="22" fill="url(#rzk-lg)"/><rect x="43" y="16" width="14" height="40" rx="7" fill="white"/><polygon points="50,84 20,53 80,53" fill="white"/></svg>`;
  const DL_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;

  GM_addStyle(`
    #rzk-wrap { position: fixed; bottom: 24px; right: 24px; z-index: 999999; width: 340px; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #f0f0f5; -webkit-font-smoothing: antialiased; }
    #rzk-panel { background: rgba(20, 20, 30, 0.65); -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 18px; margin-bottom: 12px; padding: 16px; box-shadow: 0 24px 48px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1); overflow: hidden; max-height: 0; opacity: 0; transform: translateY(10px) scale(0.98); transition: max-height 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), padding 0.3s ease; pointer-events: none; }
    #rzk-panel.open { max-height: 600px; opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
    #rzk-pill { display: flex; align-items: center; justify-content: space-between; background: rgba(20, 20, 30, 0.7); -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 24px; padding: 12px 20px; cursor: pointer; user-select: none; box-shadow: 0 8px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1); transition: background 0.2s, transform 0.1s; }
    #rzk-pill:hover { background: rgba(35, 35, 50, 0.75); }
    #rzk-pill:active { transform: scale(0.97); }
    #rzk-pill .rzk-pill-label { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; letter-spacing: 0.3px; color: #fff; }
    .rzk-title { font-size: 13px; color: rgba(255,255,255,0.9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; margin-bottom: 16px; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
    .rzk-lbl { font-size: 10px; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; font-weight: 700; }
    .rzk-scroll-area { max-height: 220px; overflow-y: auto; overflow-x: hidden; margin-right: -8px; padding-right: 8px; margin-bottom: 16px; }
    .rzk-scroll-area::-webkit-scrollbar { width: 6px; }
    .rzk-scroll-area::-webkit-scrollbar-track { background: transparent; }
    .rzk-scroll-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 10px; }
    .rzk-scroll-area::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }
    .rzk-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .rzk-chip { padding: 6px 14px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.7); cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.2s ease; white-space: nowrap; }
    .rzk-chip:hover { border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.1); color: #fff; }
    .rzk-chip.on { background: rgba(10, 132, 255, 0.85); border-color: rgba(10, 132, 255, 1); color: #fff; box-shadow: 0 4px 12px rgba(10,132,255,0.3); }
    hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 0 0 16px 0; }
    #rzk-actions { display: flex; gap: 8px; width: 100%; align-items: stretch; }
    .rzk-btn { display: flex; align-items: center; justify-content: center; gap: 6px; border-radius: 12px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; border: 1px solid transparent; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
    .rzk-btn:disabled { opacity: 0.4; cursor: not-allowed; filter: grayscale(100%); }
    .rzk-btn:active:not(:disabled) { transform: scale(0.96); }
    .rzk-btn-dl { flex: 1.2; background: rgba(10, 132, 255, 0.85); color: #fff; border-color: rgba(255,255,255,0.1); box-shadow: 0 4px 12px rgba(10,132,255,0.2); padding: 10px 4px; }
    .rzk-btn-dl:hover:not(:disabled) { background: rgba(10, 132, 255, 1); box-shadow: 0 6px 16px rgba(10,132,255,0.4); }
    .rzk-btn-leech { flex: 1; background: rgba(48, 209, 88, 0.15); color: rgb(48, 209, 88); border-color: rgba(48, 209, 88, 0.3); padding: 10px 4px; }
    .rzk-btn-leech:hover:not(:disabled) { background: rgba(48, 209, 88, 0.25); border-color: rgba(48, 209, 88, 0.5); color: #fff; }
    .rzk-btn-copy { width: 44px; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.8); border-color: rgba(255,255,255,0.1); font-size: 15px; }
    .rzk-btn-copy:hover:not(:disabled) { background: rgba(255,255,255,0.15); color: #fff; }
    .rzk-toast { position: fixed; bottom: 90px; right: 24px; z-index: 9999999; background: rgba(20,20,30,0.85); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 12px 20px; border-radius: 14px; font-size: 13px; font-weight: 500; animation: rzk-pop 0.4s cubic-bezier(0.16, 1, 0.3, 1); pointer-events: none; box-shadow: 0 12px 32px rgba(0,0,0,0.4); display: flex; align-items: center; gap: 8px; }
    @keyframes rzk-pop { from { opacity:0; transform:translateY(16px) scale(0.9) } to { opacity:1; transform:none } }
  `);

  function getEnglishTitle() {
    const orig = document.querySelector('.b-post__origtitle')?.textContent?.trim();
    return orig ? orig.split('/').pop().trim() : (document.querySelector('h1')?.textContent?.trim() || '');
  }

  function getYear() {
    return document.querySelector('meta[property="og:title"]')?.content?.match(/\((\d{4})\)/)?.[1] || '';
  }

  function getFlag(name) {
    const n = name.toLowerCase();
    if (/\p{Regional_Indicator}/u.test(name)) return '';
    if (/украин|нло\s*tv|нлотв|1\+1|пряміст|ictv|інтер|новий\s*канал|ukraine|ukr\b|трейлер|колодій|парамаунт ua/.test(n)) return '🇺🇦';
    if (/english\b|original\b|оригинал|en\s+sub/.test(n)) return '🌐';
    if (/польск|polish/.test(n)) return '🇵🇱';
    if (/немецк|deutsch|german/.test(n)) return '🇩🇪';
    if (/french|французск/.test(n)) return '🇫🇷';
    return '';
  }

  function makeFilename(quality) {
    const title = getEnglishTitle().replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '.').replace(/\.+/g, '.');
    const sTab = document.querySelector('.b-simple_season__item.active');
    const eTab = document.querySelector('.b-simple_episode__item.active');
    let se = '';
    if (sTab && eTab) {
      se = `S${String(sTab.dataset.tab_id).padStart(2, '0')}E${String(eTab.dataset.episode_id).padStart(2, '0')}`;
    }
    return [title, getYear(), se, quality].filter(Boolean).join('.') + '.mp4';
  }

  function parseStreams(raw) {
    const res = {};
    for (const part of raw.split(/,(?=\[)/)) {
      const m = part.match(/^\[([^\]]+)\](.+)$/s);
      if (!m) continue;
      const qualityLabel = m[1].replace(/<[^>]+>/g, '').trim();
      const isPro = m[1].includes('pjs-prem-quality') || m[1].includes('prem-quality') || qualityLabel.includes('PRO');
      const url = m[2].split(' or ')[0].replace(/:hls:manifest\.m3u8$/, '').trim();
      if (url) res[qualityLabel] = { url, isPro };
    }
    return res;
  }

  function getBestNonProStream(streamsObj) {
    let bestQ = null, bestUrl = null, maxRes = -1;
    for (const [q, data] of Object.entries(streamsObj || {})) {
      if (data.isPro) continue;
      const resMatch = q.match(/\d+/);
      const res = resMatch ? parseInt(resMatch[0]) : 0;
      if (res > maxRes) { maxRes = res; bestQ = q; bestUrl = data.url; }
    }
    return { quality: bestQ, url: bestUrl };
  }

  function fetchStreamsFor(tid) {
    const contentId = document.getElementById('post_id')?.value || document.querySelector('[data-id]')?.dataset?.id;
    if (!contentId || tid === 'single') return;
    const season = document.querySelector('.b-simple_season__item.active')?.dataset?.tab_id || 1;
    const episode = document.querySelector('.b-simple_episode__item.active')?.dataset?.episode_id || 1;
    const action = document.querySelector('.b-simple_episode__item') ? 'get_stream' : 'get_movie';
    const params = new URLSearchParams({ id: contentId, translator_id: tid, action, season, episode });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/ajax/get_cdn_series/');
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (data.success && data.url) {
          streams[tid] = parseStreams(data.url);
          activeTranslator = tid;
          updateUI();
        }
      } catch(e) {}
    };
    xhr.send(params.toString());
  }

  function autoSelectBestTranslator() {
    const nativeActive = document.querySelector('.b-translator__item.active');
    const isActivePremium = nativeActive && nativeActive.classList.contains('b-prem_translator');
    const tabs = Array.from(document.querySelectorAll('.b-translator__item'));
    if (tabs.length === 0) return;

    const freeTrs = tabs.filter(t => !t.classList.contains('b-prem_translator'));
    if (freeTrs.length === 0) return;

    let targetTid = null;
    const uaTr = freeTrs.find(t => getFlag(t.textContent.trim()) === '🇺🇦');

    if (isActivePremium) {
      targetTid = uaTr ? uaTr.dataset.translator_id : freeTrs[0].dataset.translator_id;
    } else if (uaTr && nativeActive && nativeActive.dataset.translator_id !== uaTr.dataset.translator_id) {
      targetTid = uaTr.dataset.translator_id;
    }

    if (targetTid) {
      activeTranslator = targetTid;
      setTimeout(() => {
        const tab = document.querySelector(`.b-translator__item[data-translator_id="${targetTid}"]`);
        if (tab) tab.click();
      }, 100);
      setTimeout(() => { if (!streams[targetTid]) fetchStreamsFor(targetTid); }, 1000);
    } else if (nativeActive) {
      activeTranslator = nativeActive.dataset.translator_id;
    }
  }

  function getUIData() {
    const tabs = Array.from(document.querySelectorAll('.b-translator__item'));
    if (tabs.length === 0) {
      const infoRows = Array.from(document.querySelectorAll('.b-post__info tr'));
      const transRow = infoRows.find(tr => tr.querySelector('td.l')?.textContent.includes('В переводе'));
      const transName = transRow ? transRow.querySelector('td:not(.l)')?.textContent.trim() : 'Original';

      let tid = activeTranslator || Object.keys(streams)[0];
      if (!tid || tid === 'single') {
        for (const s of document.scripts) {
          const m = s.textContent.match(/(?:translator_id|"translator_id"\s*:|initCDNMoviesEvents\(\s*\d+\s*,\s*)["']?(\d+)["']?/);
          if (m) { tid = m[1]; break; }
        }
      }
      tid = tid || 'single';

      if (tid !== 'single' && streams['single']) {
        streams[tid] = streams['single'];
        delete streams['single'];
      }
      if (!activeTranslator) activeTranslator = tid;

      return [{ id: tid, name: transName, isPremium: false }];
    }

    return tabs.map(el => ({
      id: el.dataset.translator_id,
      name: el.textContent.trim(),
      isPremium: el.classList.contains('b-prem_translator')
    })).filter(t => !t.isPremium);
  }

  function renderTranslators() {
    const trs = getUIData();
    if (trs.length === 0) return '<span style="color:rgba(255,255,255,0.5);font-size:12px">No voiceovers found</span>';
    return trs.map(t => {
      const activeClass = (t.id === activeTranslator || trs.length === 1) ? ' on' : '';
      const flag = getFlag(t.name);
      const prefix = flag ? flag + ' ' : '';
      return `<span class="rzk-chip${activeClass}" data-tid="${t.id}">${prefix}${t.name}</span>`;
    }).join('');
  }

  function updateUI() {
    const chipsWrap = document.getElementById('rzk-trans');
    if (chipsWrap) chipsWrap.innerHTML = renderTranslators();

    const btnDl = document.getElementById('rzk-action-dl');
    const btnLeech = document.getElementById('rzk-action-leech');
    const btnCopy = document.getElementById('rzk-action-copy');
    if (!btnDl || !btnLeech || !btnCopy) return;

    const tidToUse = activeTranslator || Object.keys(streams)[0];
    const currentStreams = streams[tidToUse];

    if (!currentStreams || Object.keys(currentStreams).length === 0) {
      btnDl.disabled = true; btnLeech.disabled = true; btnCopy.disabled = true;
      btnDl.innerHTML = '⏳ Waiting...';
      btnLeech.innerHTML = `${LEECH_ICON} Leech`;
      return;
    }

    const best = getBestNonProStream(currentStreams);
    if (!best.url) {
      btnDl.disabled = true; btnLeech.disabled = true; btnCopy.disabled = true;
      btnDl.innerHTML = '❌ No free quality';
      return;
    }

    btnDl.disabled = false; btnLeech.disabled = false; btnCopy.disabled = false;
    btnDl.innerHTML = `${DL_ICON} Download <span>(${best.quality})</span>`;
    btnLeech.innerHTML = `${LEECH_ICON} Leech`;

    btnDl.onclick = () => {
      const filename = makeFilename(best.quality);
      const a = document.createElement('a');
      a.href = best.url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast(`⬇️ Downloading: ${best.quality}`);
    };

    btnLeech.onclick = () => {
      const filename = makeFilename(best.quality);
      GM_setClipboard(filename);
      toast(`🚀 Sent to Leech!`);
      const leechUrl = best.url.replace(/^https?:\/\//, match => match.includes('https') ? 'secureleech://' : 'leech://');
      const a = document.createElement('a');
      a.href = leechUrl;
      a.click();
    };

    btnCopy.onclick = () => {
      GM_setClipboard(best.url);
      toast(`📋 Direct link copied!`);
    }
  }

  function buildUI() {
    if (document.getElementById('rzk-wrap')) return;
    const wrap = document.createElement('div');
    wrap.id = 'rzk-wrap';
    const engTitle = getEnglishTitle();

    wrap.innerHTML = `
      <div id="rzk-panel">
        <div class="rzk-title" title="${engTitle}">${engTitle}</div>
        <div class="rzk-lbl">VOICEOVER</div>
        <div class="rzk-scroll-area">
          <div class="rzk-chips" id="rzk-trans">${renderTranslators()}</div>
        </div>
        <hr>
        <div id="rzk-actions">
          <button id="rzk-action-dl" class="rzk-btn rzk-btn-dl" disabled>⏳ Waiting...</button>
          <button id="rzk-action-leech" class="rzk-btn rzk-btn-leech" disabled>${LEECH_ICON} Leech</button>
          <button id="rzk-action-copy" class="rzk-btn rzk-btn-copy" disabled title="Copy link">📋</button>
        </div>
      </div>
      <div id="rzk-pill">
        <span class="rzk-pill-label">Rezka DL</span>
        ${DL_ICON}
      </div>`;

    document.body.appendChild(wrap);

    const pill = wrap.querySelector('#rzk-pill');
    const panel = wrap.querySelector('#rzk-panel');

    pill.addEventListener('click', () => {
      isOpen = !isOpen;
      panel.classList.toggle('open', isOpen);
    });

    wrap.querySelector('#rzk-trans').addEventListener('click', e => {
      const chip = e.target.closest('.rzk-chip[data-tid]');
      if (!chip) return;
      const tid = chip.dataset.tid;
      const nativeTab = document.querySelector(`.b-translator__item[data-translator_id="${tid}"]`);
      if (nativeTab) {
        nativeTab.click();
        activeTranslator = tid;
        updateUI();
      }
    });
  }

  function interceptXHR() {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
      this._rzkUrl = String(url);
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
      if (this._rzkUrl && this._rzkUrl.includes('get_cdn_series')) {
        const savedBody = body;
        this.addEventListener('load', () => {
          try {
            const data = JSON.parse(this.responseText);
            if (data.success && data.url) {
              const params = typeof savedBody === 'string' ? new URLSearchParams(savedBody) : null;
              const tid = params?.get('translator_id') || document.querySelector('.b-translator__item.active')?.dataset?.translator_id;
              if (tid) {
                streams[tid] = parseStreams(data.url);
                activeTranslator = tid;
                updateUI();
              }
            }
          } catch(e) {}
        });
      }
      return origSend.apply(this, arguments);
    };
  }

  function tryInlineScript() {
    for (const s of document.scripts) {
      if (s.src) continue;
      const match = s.textContent.match(/(?:["'])(\[(?:1080|720|480|360|2160)p[^\]]*\][^"']+)(?:["'])/);
      if (match) {
        const tidM = s.textContent.match(/(?:translator_id|"translator_id"\s*:|initCDNMoviesEvents\(\s*\d+\s*,\s*)["']?(\d+)["']?/);
        const tid = tidM ? tidM[1] : 'single';
        streams[tid] = parseStreams(match[1].replace(/\\u003e/g,'>').replace(/\\u003c/g,'<').replace(/\\/g,''));
        if (!activeTranslator) activeTranslator = tid;
        return true;
      }
    }
    return false;
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'rzk-toast';
    el.innerHTML = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  function init() {
    if (!document.getElementById('post_id') && !document.querySelector('[data-id]')) return;

    tryInlineScript();
    autoSelectBestTranslator();
    buildUI();
    updateUI();

    document.addEventListener('click', e => {
      if (e.target.closest('.b-simple_season__item') || e.target.closest('.b-simple_episode__item')) {
        const btnDl = document.getElementById('rzk-action-dl');
        const btnLeech = document.getElementById('rzk-action-leech');
        const btnCopy = document.getElementById('rzk-action-copy');
        if (btnDl) { btnDl.disabled = true; btnDl.innerHTML = '⏳ Waiting...'; }
        if (btnLeech) { btnLeech.disabled = true; }
        if (btnCopy) { btnCopy.disabled = true; }
      }
    }, true);

    setTimeout(() => {
      const tid = activeTranslator || Object.keys(streams)[0];
      if (tid && tid !== 'single' && !streams[tid]) fetchStreamsFor(tid);
    }, 1500);
  }

  interceptXHR();
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);

})();