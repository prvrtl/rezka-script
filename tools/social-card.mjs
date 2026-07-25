/**
 * Renders docs/social-card.png — the preview image chat apps and social sites
 * show when the landing page is linked.
 *
 * It has to be a raster file: scrapers do not run JavaScript and most refuse
 * SVG, so the card is laid out in HTML here and screenshotted at 1200×630
 * (rendered at 2× for sharp text on high-density screens).
 *
 *   node tools/social-card.mjs
 */
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'social-card.jpg');

const card = `<!doctype html><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    background: #0a0a0d; color: #f3f3f6;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    display: grid; grid-template-columns: 1fr 520px; align-items: center; gap: 48px;
    padding: 64px; position: relative;
  }
  .aura { position: absolute; left: -160px; top: -220px; width: 900px; height: 700px;
          background: radial-gradient(closest-side, rgba(10,132,255,.22), transparent 70%); }
  .left { position: relative; }
  .brand { display: flex; align-items: center; gap: 16px; margin-bottom: 34px; }
  .mark { width: 62px; height: 62px; border-radius: 17px; flex: none;
          box-shadow: 0 8px 26px rgba(10,132,255,.45); }
  h1 { font-size: 58px; line-height: 1.02; font-weight: 700; letter-spacing: -.042em; }
  h1 .fade { color: #63636f; }
  p { margin-top: 22px; font-size: 23px; line-height: 1.45; color: #9a9aa7; max-width: 22ch; }
  .pills { display: flex; gap: 10px; margin-top: 34px; }
  .pill { padding: 8px 15px; border-radius: 9px; background: #17171d;
          border: 1px solid rgba(255,255,255,.09); color: #c9c9d2; font-size: 16px; }
  .repo { position: absolute; left: 64px; bottom: 52px; display: flex; align-items: center; gap: 10px;
          color: #63636f; font-size: 18px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

  .shot { position: relative; border-radius: 16px; overflow: hidden;
          border: 1px solid rgba(255,255,255,.10); box-shadow: 0 34px 70px rgba(0,0,0,.65); }
  .screen { position: relative; aspect-ratio: 16/9; display: grid; place-items: center; background: #05070a; }
  .still { position: absolute; inset: 0; width: 100%; height: 100%; }
  .play { position: relative; z-index: 1; width: 74px; height: 74px; border-radius: 50%;
          background: rgba(255,255,255,.96); display: grid; place-items: center;
          box-shadow: 0 12px 34px rgba(0,0,0,.5); }
  .play::after { content: ''; width: 0; height: 0; margin-left: 5px;
                 border-left: 21px solid #0a0a0d;
                 border-top: 13px solid transparent; border-bottom: 13px solid transparent; }
  .strip { display: flex; align-items: center; gap: 8px; padding: 14px;
           background: #101015; border-top: 1px solid rgba(255,255,255,.08); }
  .chip { padding: 8px 11px; border-radius: 9px; background: #17171d;
          border: 1px solid rgba(255,255,255,.08); font-size: 14px; color: #c9c9d2; }
  .chip b { font-weight: 600; color: #f3f3f6; }
  .chip span { color: #63636f; font-size: 12px; margin-right: 6px; }
  .grow { flex: 1; }
  .dl { padding: 9px 15px; border-radius: 9px; background: #0a84ff; color: #fff;
        font-size: 14px; font-weight: 600; }
</style>

<svg width="0" height="0" style="position:absolute">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4aa8ff"/><stop offset="1" stop-color="#0a5cff"/>
    </linearGradient>
    <symbol id="logo" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="9" fill="url(#g)"/>
      <text x="16" y="23" text-anchor="middle" fill="#fff" font-size="20" font-weight="700"
            font-family="-apple-system, BlinkMacSystemFont, sans-serif">R</text>
    </symbol>
  </defs>
</svg>

<div class="aura"></div>

<div class="left">
  <div class="brand"><svg class="mark"><use href="#logo"/></svg></div>
  <h1>A new interface<br><span class="fade">for HDrezka</span></h1>
  <p>Plays the file directly, in English, and downloads a whole series.</p>
  <div class="pills">
    <span class="pill">Native player</span>
    <span class="pill">Subtitles</span>
    <span class="pill">Batch download</span>
  </div>
</div>

<div class="shot">
  <div class="screen">
    <svg class="still" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#16323f"/><stop offset=".45" stop-color="#123043"/>
          <stop offset="1" stop-color="#070d14"/>
        </linearGradient>
        <radialGradient id="sun" cx=".72" cy=".62" r=".46">
          <stop offset="0" stop-color="#ff9d4d" stop-opacity=".85"/>
          <stop offset=".45" stop-color="#c9622a" stop-opacity=".35"/>
          <stop offset="1" stop-color="#c9622a" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8fd2e6" stop-opacity="0"/>
          <stop offset="1" stop-color="#8fd2e6" stop-opacity=".16"/>
        </linearGradient>
        <linearGradient id="shaft" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffd9a8" stop-opacity=".20"/>
          <stop offset="1" stop-color="#ffd9a8" stop-opacity="0"/>
        </linearGradient>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7"/>
          <feColorMatrix type="saturate" values="0"/>
        </filter>
        <filter id="soft"><feGaussianBlur stdDeviation="1.6"/></filter>
      </defs>
      <rect width="160" height="90" fill="url(#sky)"/>
      <rect width="160" height="90" fill="url(#sun)"/>
      <g fill="#0b1620" opacity=".85" filter="url(#soft)">
        <rect x="8" y="40" width="9" height="50"/><rect x="21" y="33" width="7" height="57"/>
        <rect x="32" y="45" width="11" height="45"/><rect x="47" y="28" width="8" height="62"/>
        <rect x="59" y="47" width="6" height="43"/><rect x="92" y="36" width="10" height="54"/>
        <rect x="106" y="44" width="7" height="46"/><rect x="118" y="30" width="9" height="60"/>
        <rect x="132" y="46" width="12" height="44"/><rect x="148" y="38" width="8" height="52"/>
      </g>
      <g opacity=".55">
        <polygon points="46,0 54,0 40,90 24,90" fill="url(#shaft)"/>
        <polygon points="104,0 112,0 128,90 112,90" fill="url(#shaft)"/>
      </g>
      <rect y="52" width="160" height="38" fill="url(#haze)"/>
      <g fill="#03060a">
        <ellipse cx="38" cy="74" rx="6.4" ry="7.6"/>
        <path d="M22 90c0-9 7.2-15 16-15s16 6 16 15z"/>
      </g>
      <rect width="160" height="90" filter="url(#grain)" opacity=".07"/>
    </svg>
    <div class="play"></div>
  </div>
  <div class="strip">
    <span class="chip"><span>Voice</span><b>🇺🇦 Ukrainian</b></span>
    <span class="chip"><span>Quality</span><b>1080p</b></span>
    <span class="grow"></span>
    <span class="dl">↓ Download</span>
  </div>
</div>

<div class="repo">github.com/prvrtl/rezka-script</div>
`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
await page.setContent(card, { waitUntil: 'load' });
await page.waitForTimeout(400);
await mkdir(dirname(OUT), { recursive: true });
// JPEG, not PNG: the film grain is noise, which PNG cannot compress — the
// same card came out at 893 KB lossless and under 200 KB here.
await writeFile(OUT, await page.screenshot({ type: 'jpeg', quality: 88 }));
await browser.close();
console.log(`wrote ${OUT}`);
