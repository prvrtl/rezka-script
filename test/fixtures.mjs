/**
 * Markup mirroring the parts of an HDrezka page the script reads.
 *
 * Structure is taken from real pages captured with tools/capture.mjs — the
 * selectors, attributes and nesting are theirs. The text content is invented,
 * so nothing of the site's own catalogue is checked into this repo.
 */

const chrome = (title) => `
  <meta property="og:title" content="${title}">
`;

const infoRow = (k, v) => `<tr><td class="l">${k}:</td><td>${v}</td></tr>`;

/** A film: no translator tabs, no episodes. The common case. */
export const filmPage = ({
  id = '55330',
  title = 'Тихий Дом',
  original = 'The Quiet House',
  year = '2007',
} = {}) => `<!doctype html><html><head>
  ${chrome(`${title} (${year})`)}
</head><body>
  <div class="b-content__main">
    <div class="b-post__title"><h1>${title}</h1></div>
    <div class="b-post__origtitle">${original}</div>
    <div class="b-post__infotable_left">
      <img src="https://static.example.net/poster.jpg" alt="${title}">
    </div>
    <div class="b-post__rating"><span class="num">6.20</span><span class="votes">(1225)</span></div>
    <table class="b-post__info">
      ${infoRow('Год', year)}
      ${infoRow('Страна', 'Россия')}
      ${infoRow('Жанр', 'Драмы, Мелодрамы')}
      ${infoRow('В качестве', '720p')}
      ${infoRow('Время', '93 мин.')}
      ${infoRow('Возраст', '18+ только для взрослых')}
    </table>
    <div class="b-post__description_text">短 synopsis stands in for the real one.</div>
    <div id="player" class="b-player">
      <div id="cdnplayer-container" class="b-player__holder_cdn">
        <div id="cdnplayer" class="b-player__container_cdn"></div>
      </div>
      <a class="b-prem-button">Перейти на Premium</a>
    </div>
    <input type="hidden" id="post_id" value="${id}">
  </div>
</body></html>`;

/** A series: translator tabs, one or more seasons, episodes carrying both ids. */
export const seriesPage = ({
  id = '91371',
  title = 'Класний керівник',
  original = 'Great Teacher',
  year = '1998',
  translators = [
    { id: '59', name: 'Многоголосый закадровый', active: true },
    { id: '57', name: 'Українська', },
    { id: '238', name: 'HDrezka Studio PRO', prem: true },
  ],
  seasons = ['1', '2'],
  episodes = { 1: ['1', '2', '3'], 2: ['1', '2'] },
  activeSeason = '2',
  activeEpisode = '1',
} = {}) => `<!doctype html><html><head>
  ${chrome(`${title} (${year})`)}
</head><body>
  <div class="b-content__main">
    <div class="b-post__title"><h1>${title}</h1></div>
    <div class="b-post__origtitle">${original}</div>
    <div class="b-post__infotable_left">
      <img src="https://static.example.net/series.jpg" alt="${title}">
    </div>
    <div class="b-post__rating"><span class="num">9.60</span><span class="votes">(5)</span></div>
    <table class="b-post__info">
      ${infoRow('Дата выхода', `7 июля ${year} года`)}
      ${infoRow('Страна', 'Япония')}
      ${infoRow('Жанр', 'Комедии, Драмы')}
      ${infoRow('В качестве', '720p')}
      ${infoRow('Время', '45 мин.')}
    </table>
    <div class="b-post__description_text">Stand-in synopsis for a series.</div>

    ${translators.length ? `<ul class="b-translators__list">
      ${translators.map(t => `<li class="b-translator__item${t.active ? ' active' : ''}${
        t.prem ? ' b-prem_translator' : ''}" data-translator_id="${t.id}">${t.name}</li>`).join('\n      ')}
    </ul>` : ''}

    <ul class="b-simple_seasons__list">
      ${seasons.map(s => `<li class="b-simple_season__item${s === activeSeason ? ' active' : ''}" data-tab_id="${s}">${s} сезон</li>`).join('\n      ')}
    </ul>
    ${seasons.map(s => `<ul class="b-simple_episodes__list" data-season_id="${s}">
      ${(episodes[s] || []).map(e => `<li class="b-simple_episode__item${
        s === activeSeason && e === activeEpisode ? ' active' : ''
      }" data-season_id="${s}" data-episode_id="${e}">${e} серия</li>`).join('\n      ')}
    </ul>`).join('\n    ')}

    <div id="player" class="b-player">
      <div id="cdnplayer-container" class="b-player__holder_cdn">
        <div id="cdnplayer" class="b-player__container_cdn"></div>
      </div>
    </div>
    <input type="hidden" id="post_id" value="${id}">
  </div>
</body></html>`;

/** Catalog and search render the same card; only the heading and paging differ. */
export const gridPage = ({
  heading = 'Смотреть фильмы в HD онлайн',
  items = [
    { id: '91370', kind: 'films', entity: 'Фильм', title: 'Поколение Икс', meta: '1996, США, Фантастика', slug: 'films/fiction/91370-pokolenie-iks-1996' },
    { id: '981', kind: 'films', entity: 'Фильм', title: 'Матрица', meta: '1999, США, Фантастика', slug: 'films/fiction/981-matrica-1999' },
    { id: '91371', kind: 'series', entity: 'Сериал', title: 'Класний керівник', meta: '1998, Япония, Комедии', slug: 'series/comedy/91371-uchitel-1998' },
  ],
  pages = ['1', '2', '3'],
} = {}) => `<!doctype html><html><head>
  ${chrome(heading)}
</head><body>
  <div class="b-content__main">
    <h1 class="b-content__htitle">${heading}</h1>
    <div class="b-content__inline_items">
      ${items.map(i => `
      <div class="b-content__inline_item" data-id="${i.id}" data-url="https://rezka-ua.tv/${i.slug}.html">
        <div class="b-content__inline_item-cover">
          <a href="https://rezka-ua.tv/${i.slug}.html">
            <img src="https://static.example.net/${i.id}.jpg" height="250" width="166" alt="${i.title}">
            <span class="cat ${i.kind}"><i class="entity">${i.entity}</i><i class="icon"></i></span>
          </a>
        </div>
        <div class="b-content__inline_item-link">
          <a href="https://rezka-ua.tv/${i.slug}.html">${i.title}</a>
          <div>${i.meta}</div>
        </div>
      </div>`).join('')}
    </div>
    ${pages.length ? `<div class="b-navigation">
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
