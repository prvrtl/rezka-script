/**
 * Prints the structure the UI codes against, from pages saved by capture.mjs.
 * Re-run this when the site changes shape to see which contracts moved.
 *
 *   node tools/capture.mjs watch=<url> …   # saves fixtures/raw/*.html
 *   node tools/inspect.mjs [name …]        # default: watch catalog search
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'raw');
const load = (f) => new JSDOM(readFileSync(join(RAW, `${f}.html`), 'utf8')).window.document;
const has = (doc, sels) => {
  for (const s of sels) {
    const n = doc.querySelectorAll(s).length;
    console.log(`  ${n ? '✓' : '·'} ${s.padEnd(44)} ${n || ''}`);
  }
};
const clean = (s, n = 90) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function watch(name) {
  const d = load(name);
  console.log(`\n=== ${name.toUpperCase()} ===`);
  has(d, [
    '#post_id', '#ctrl_links', '#ctrl_favs', '#ctrl_token_id',
    '.b-post__title h1', '.b-post__origtitle', '.b-post__infotable_left img',
    '.b-post__description_text', '.b-post__rating', '.b-post__info tr',
    '.b-translator__item', '.b-prem_translator', '.b-translators__list',
    '.b-simple_season__item', '.b-simple_episode__item', '.b-simple_episode__list',
    '#cdnplayer', '#player', '.b-prem-button', '.b-post__schedule_block',
  ]);

  const links = d.querySelector('#ctrl_links');
  if (links) {
    const v = links.value || links.getAttribute('value') || '';
    console.log(`\n  #ctrl_links (${v.length} chars): ${clean(v, 150)}`);
  }

  console.log('\n  rating:   ', clean(d.querySelector('.b-post__rating')?.textContent, 60));
  console.log('  poster:   ', clean(d.querySelector('.b-post__infotable_left img')?.getAttribute('src'), 80));
  console.log('  descr len:', (d.querySelector('.b-post__description_text')?.textContent || '').trim().length, 'chars');

  const seasons = [...d.querySelectorAll('.b-simple_season__item')];
  const eps = [...d.querySelectorAll('.b-simple_episode__item')];
  if (seasons.length) console.log(`\n  seasons: ${seasons.map(s => s.dataset.tab_id).join(', ')}`);
  if (eps.length) console.log(`  episodes(first 8): ${eps.slice(0, 8).map(e => `s${e.dataset.season_id}e${e.dataset.episode_id}`).join(' ')}`);
  for (const t of [...d.querySelectorAll('.b-translator__item')].slice(0, 10)) {
    console.log(`  voice id=${String(t.dataset.translator_id).padEnd(6)} prem=${t.classList.contains('b-prem_translator') ? 'Y' : 'n'} ${clean(t.textContent, 36)}`);
  }

  console.log('\n  -- info rows --');
  for (const tr of d.querySelectorAll('.b-post__info tr')) {
    const k = clean(tr.querySelector('td.l')?.textContent, 24).replace(/:$/, '');
    if (k) console.log(`     ${k.padEnd(16)} ${clean(tr.querySelector('td:not(.l)')?.textContent, 56)}`);
  }
}

function grid(name) {
  const d = load(name);
  console.log(`\n=== ${name.toUpperCase()} ===`);
  const items = [...d.querySelectorAll('.b-content__inline_item')];
  console.log(`  ${items.length} cards, ${d.querySelectorAll('.b-navigation a').length} pagination links`);
  console.log('  heading:', clean(d.querySelector('.b-content__htitle')?.textContent, 60));

  const c = items[0];
  if (!c) return;
  const link = c.querySelector('.b-content__inline_item-link');
  console.log('\n  -- card fields --');
  console.log('    data-id   ', c.dataset.id);
  console.log('    data-url  ', clean(c.dataset.url, 70));
  console.log('    cover     ', clean(c.querySelector('img')?.getAttribute('src'), 70));
  console.log('    kind      ', clean(c.querySelector('.cat .entity')?.textContent, 20), '| class:', c.querySelector('.cat')?.className);
  console.log('    title     ', clean(link?.querySelector('a')?.textContent, 50));
  console.log('    meta      ', clean(link?.querySelector('div')?.textContent, 60));
  console.log('    rating    ', clean(c.querySelector('.b-category-bestrating, .rating')?.textContent, 20));
  console.log('    info badge', clean(c.querySelector('.info')?.textContent, 30));
  console.log('\n  -- link block --');
  console.log('   ', clean(link?.innerHTML, 300));
}

const args = process.argv.slice(2);
const targets = args.length ? args : ['watch', 'catalog', 'search'];
for (const t of targets) {
  if (!existsSync(join(RAW, `${t}.html`))) { console.log(`\n(no fixtures/raw/${t}.html — run capture.mjs)`); continue; }
  (t.startsWith('catalog') || t.startsWith('search')) ? grid(t) : watch(t);
}
