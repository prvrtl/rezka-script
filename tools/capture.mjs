/**
 * Saves real page markup so the UI can be built and tested against it.
 *
 * Runs a headed browser on a persistent profile. If the site puts up its bot
 * check, this script stops and waits for YOU to clear it in the window — it
 * does not try to solve or evade it. The profile keeps the result, so later
 * runs normally go straight through.
 *
 *   node tools/capture.mjs watch=https://…/55330-….html catalog=https://…/films/
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'fixtures', 'raw');
const PROFILE = process.env.RZK_PROFILE
  || join(process.env.TMPDIR || '/tmp', 'rzk-capture-profile');

/** The interstitial announces itself in the title; real pages never do. */
const CHALLENGE = /не бот|checking your browser|just a moment|attention required/i;

async function settled(page) {
  const title = await page.title().catch(() => '');
  if (CHALLENGE.test(title)) return false;
  return page.evaluate(() => Boolean(document.querySelector('#post_id, .b-content__inline_item, .b-navigation, #main')));
}

async function waitForHuman(page, url) {
  process.stdout.write(`\n  ⏸  ${url}\n     A bot check is up. Clear it in the browser window; I'll continue when the page loads.\n`);
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    if (await settled(page)) { process.stdout.write('     ✓ through\n'); return true; }
  }
  process.stdout.write('     ✗ gave up after 5 minutes\n');
  return false;
}

const targets = process.argv.slice(2)
  .map(arg => { const i = arg.indexOf('='); return { name: arg.slice(0, i), url: arg.slice(i + 1) }; })
  .filter(t => t.name && t.url);

if (!targets.length) {
  console.error('usage: node tools/capture.mjs <name>=<url> [<name>=<url> …]');
  process.exit(1);
}

await mkdir(OUT, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1440, height: 900 },
  locale: 'uk-UA'
});
const page = context.pages()[0] || await context.newPage();

for (const { name, url } of targets) {
  process.stdout.write(`\n▸ ${name}\n  ${url}\n`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  } catch (e) {
    process.stdout.write(`  ✗ ${e.message.split('\n')[0]}\n`);
    continue;
  }

  if (!(await settled(page)) && !(await waitForHuman(page, url))) continue;

  await page.waitForTimeout(1500);
  const html = await page.content();
  await writeFile(join(OUT, `${name}.html`), html);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  process.stdout.write(`  ✓ ${(html.length / 1024).toFixed(0)} KB → fixtures/raw/${name}.html\n`);
}

await context.close();
process.stdout.write('\ndone\n');
