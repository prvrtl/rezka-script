/**
 * Markup mirroring the parts of an HDrezka page the script reads.
 *
 * Structure is taken from real pages captured with tools/capture.mjs — the
 * selectors, attributes, meta tags and microdata are theirs. The text content
 * is invented, so nothing of the site's own catalogue is checked in here.
 *
 * Every builder takes a `classes` map. Passing SCRAMBLED renames every
 * structural class, which is how the tests prove the script reads the URL,
 * meta tags and data-* attributes rather than the stylesheet.
 */

export const CLASSES = {
  main: 'b-content__main',
  title: 'b-post__title',
  orig: 'b-post__origtitle',
  posterBox: 'b-post__infotable_left',
  rating: 'b-post__rating',
  info: 'b-post__info',
  descr: 'b-post__description_text',
  translators: 'b-translators__list',
  translator: 'b-translator__item',
  seasons: 'b-simple_seasons__list',
  season: 'b-simple_season__item',
  episodes: 'b-simple_episodes__list',
  episode: 'b-simple_episode__item',
  card: 'b-content__inline_item',
  cardCover: 'b-content__inline_item-cover',
  cardLink: 'b-content__inline_item-link',
  nav: 'b-navigation',
  htitle: 'b-content__htitle',
};

/**
 * A plausible redesign: every structural class renamed.
 *
 * Two words survive deliberately, because the script genuinely still depends
 * on them and pretending otherwise would make this test a lie:
 *   - "active" marks the current tab (a conventional state class)
 *   - "prem"   marks a PRO-only voiceover (no data-* equivalent exists)
 */
export const SCRAMBLED = Object.fromEntries(
  Object.keys(CLASSES).map((k) => [k, `c${k.length}-${k.slice(0, 2)}x`])
);

const head = ({ title, year, type, poster, descr, url, duration }) => `
  <meta property="og:type" content="${type}">
  <meta property="og:title" content="${title} (${year})">
  <meta property="og:image" content="${poster}">
  <meta property="og:description" content="${descr}">
  <meta property="og:url" content="${url}">
  ${duration ? `<meta property="og:duration" content="${duration}">` : ''}
  <meta itemprop="description" content="${descr}">
`;

const infoRow = (k, v) => `<tr><td class="l">${k}:</td><td>${v}</td></tr>`;

const ratingBlock = (c, score, votes) => `
  <div class="${c.rating}">
    <span itemprop="average">${score}</span><span itemprop="votes">${votes}</span>
  </div>`;

/** A film: no translator tabs, no episodes. The common case. */
export const filmPage = ({
  id = '55330',
  title = 'Тихий Дом',
  original = 'The Quiet House',
  year = '2007',
  classes: c = CLASSES,
} = {}) => `<!doctype html><html><head>
  ${head({
    title, year, type: 'video.movie',
    poster: 'https://static.example.net/poster.jpg',
    descr: 'Короткое описание вместо настоящего.',
    url: `https://rezka-ua.tv/films/drama/${id}-tihiy-dom-${year}.html`,
    duration: 5580,
  })}
</head><body>
  <div class="${c.main}">
    <div class="${c.title}"><h1 itemprop="name">${title}</h1></div>
    <div class="${c.orig}" itemprop="alternativeHeadline">${original}</div>
    <div class="${c.posterBox}">
      <img itemprop="image" src="https://static.example.net/poster.jpg" alt="${title}">
    </div>
    ${ratingBlock(c, '6.20', '1225')}
    <table class="${c.info}">
      ${infoRow('Год', year)}
      ${infoRow('Страна', 'Россия')}
      ${infoRow('Жанр', '<span itemprop="genre">Драмы</span>, <span itemprop="genre">Мелодрамы</span>')}
      ${infoRow('Время', '93 мин.')}
    </table>
    <div class="${c.descr}">Короткое описание вместо настоящего.</div>
    <div id="player"><div id="cdnplayer"></div></div>
    <input type="hidden" id="post_id" value="${id}">
  </div>
</body></html>`;

/** A series: translator tabs, seasons, episodes carrying both ids. */
export const seriesPage = ({
  id = '91371',
  title = 'Класний керівник',
  original = 'Great Teacher',
  year = '1998',
  translators = [
    { id: '59', name: 'Многоголосый закадровый', active: true },
    { id: '57', name: 'Українська' },
    { id: '238', name: 'HDrezka Studio PRO', prem: true },
  ],
  seasons = ['1', '2'],
  episodes = { 1: ['1', '2', '3'], 2: ['1', '2'] },
  activeSeason = '2',
  activeEpisode = '1',
  classes: c = CLASSES,
} = {}) => `<!doctype html><html><head>
  ${head({
    title, year, type: 'video.tv_series',
    poster: 'https://static.example.net/series.jpg',
    descr: 'Краткое описание сериала.',
    url: `https://rezka-ua.tv/series/comedy/${id}-klasnyi-kerivnyk-${year}.html`,
    duration: 2700,
  })}
</head><body>
  <div class="${c.main}">
    <div class="${c.title}"><h1 itemprop="name">${title}</h1></div>
    <div class="${c.orig}" itemprop="alternativeHeadline">${original}</div>
    <div class="${c.posterBox}">
      <img itemprop="image" src="https://static.example.net/series.jpg" alt="${title}">
    </div>
    ${ratingBlock(c, '9.60', '5')}
    <table class="${c.info}">
      ${infoRow('Страна', 'Япония')}
      ${infoRow('Жанр', '<span itemprop="genre">Комедии</span>, <span itemprop="genre">Драмы</span>')}
    </table>
    <div class="${c.descr}">Краткое описание сериала.</div>

    ${translators.length ? `<ul class="${c.translators}">
      ${translators.map(t => `<li class="${c.translator}${t.active ? ' active' : ''}${
        t.prem ? ' prem_translator' : ''}" data-translator_id="${t.id}">${t.name}</li>`).join('\n      ')}
    </ul>` : ''}

    <ul class="${c.seasons}">
      ${seasons.map(s => `<li class="${c.season}${s === activeSeason ? ' active' : ''}" data-tab_id="${s}">${s} сезон</li>`).join('\n      ')}
    </ul>
    ${seasons.map(s => `<ul class="${c.episodes}" data-season_id="${s}">
      ${(episodes[s] || []).map(e => `<li class="${c.episode}${
        s === activeSeason && e === activeEpisode ? ' active' : ''
      }" data-season_id="${s}" data-episode_id="${e}">${e} серия</li>`).join('\n      ')}
    </ul>`).join('\n    ')}

    <div id="player"><div id="cdnplayer"></div></div>
    <input type="hidden" id="post_id" value="${id}">
  </div>
</body></html>`;

/** Catalog and search render the same card; only the heading and paging differ. */
export const gridPage = ({
  heading = 'Смотреть фильмы в HD онлайн',
  items = [
    { id: '91370', entity: 'Фильм', title: 'Поколение Икс', meta: '1996, США, Фантастика', slug: 'films/fiction/91370-pokolenie-iks-1996' },
    { id: '981', entity: 'Фильм', title: 'Матрица', meta: '1999, США, Фантастика', slug: 'films/fiction/981-matrica-1999' },
    { id: '91371', entity: 'Сериал', title: 'Класний керівник', meta: '1998, Япония, Комедии', slug: 'series/comedy/91371-uchitel-1998' },
  ],
  pages = ['1', '2', '3'],
  classes: c = CLASSES,
} = {}) => `<!doctype html><html><head>
  <meta property="og:type" content="website">
  <meta property="og:title" content="${heading}">
</head><body>
  <div class="${c.main}">
    <h1 class="${c.htitle}">${heading}</h1>
    <div>
      ${items.map(i => `
      <div class="${c.card}" data-id="${i.id}" data-url="https://rezka-ua.tv/${i.slug}.html">
        <div class="${c.cardCover}">
          <a href="https://rezka-ua.tv/${i.slug}.html">
            <img src="https://static.example.net/${i.id}.jpg" height="250" width="166" alt="${i.title}">
            <span class="cat"><i class="entity">${i.entity}</i></span>
          </a>
        </div>
        <div class="${c.cardLink}">
          <a href="https://rezka-ua.tv/${i.slug}.html">${i.title}</a>
          <div>${i.meta}</div>
        </div>
      </div>`).join('')}
    </div>
    ${pages.length ? `<div class="${c.nav}">
      ${pages.map(p => `<a href="/films/page/${p}/">${p}</a>`).join('\n      ')}
    </div>` : ''}
  </div>
</body></html>`;

/** Quality lists in the format /ajax/get_cdn_series/ returns them. */
export const streamList = {
  plain: [
    '[360p]https://cdn.example.net/a_360.mp4:hls:manifest.m3u8 or https://cdn.example.net/a_360.mp4',
    '[720p]https://cdn.example.net/a_720.mp4:hls:manifest.m3u8 or https://cdn.example.net/a_720.mp4',
    '[1080p]https://cdn.example.net/a_1080.mp4:hls:manifest.m3u8 or https://cdn.example.net/a_1080.mp4',
  ].join(','),

  withPro: [
    '[360p]https://cdn.example.net/b_360.mp4',
    '[720p]https://cdn.example.net/b_720.mp4',
    '[<span class="pjs-prem-quality">1080p Ultra</span>]https://cdn.example.net/b_1080.mp4',
    '[<span class="pjs-prem-quality">2160p</span>]https://cdn.example.net/b_2160.mp4',
  ].join(','),

  fourK: [
    '[360p]https://cdn.example.net/c_360.mp4',
    '[720p]https://cdn.example.net/c_720.mp4',
    '[4K]https://cdn.example.net/c_2160.mp4',
  ].join(','),

  proOnly: '[<span class="pjs-prem-quality">1080p</span>]https://cdn.example.net/d_1080.mp4',

  hlsOnly: '[1080p]https://cdn.example.net/e_1080.m3u8:hls:manifest.m3u8',
};
