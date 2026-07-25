/** Markup mirroring the parts of an HDrezka page the script actually reads. */

const head = (ogTitle) => `
  <meta property="og:title" content="${ogTitle}">
`;

export const seriesPage = ({
  translators = [
    { id: '56', name: 'Дубляж HDrezka Studio', active: true },
    { id: '57', name: 'Українська' },
    { id: '58', name: 'HDrezka Studio PRO', prem: true },
  ],
  season = '2',
  episode = '5',
} = {}) => `<!doctype html><html><head>
  ${head('Пример (2021) смотреть онлайн')}
</head><body>
  <input type="hidden" id="post_id" value="12345">
  <h1>Пример</h1>
  <div class="b-post__origtitle">Пример / The Example: Show</div>

  <ul class="b-translators__list">
    ${translators
      .map(
        (t) =>
          `<li class="b-translator__item${t.active ? ' active' : ''}${
            t.prem ? ' b-prem_translator' : ''
          }" data-translator_id="${t.id}">${t.name}</li>`
      )
      .join('\n    ')}
  </ul>

  <ul class="b-simple_season__list">
    <li class="b-simple_season__item" data-tab_id="1">1</li>
    <li class="b-simple_season__item active" data-tab_id="${season}">${season}</li>
  </ul>
  <ul class="b-simple_episode__list">
    <li class="b-simple_episode__item" data-episode_id="1">1</li>
    <li class="b-simple_episode__item active" data-episode_id="${episode}">${episode}</li>
  </ul>
</body></html>`;

/** A film page: no translator tabs, translation named in the info table. */
export const moviePage = () => `<!doctype html><html><head>
  ${head('Другой Пример (1999) смотреть онлайн')}
</head><body>
  <input type="hidden" id="post_id" value="777">
  <h1>Другой Пример</h1>
  <div class="b-post__origtitle">Другой Пример / Another Example</div>
  <table class="b-post__info">
    <tr><td class="l">В переводе:</td><td>Дубляж</td></tr>
  </table>
</body></html>`;

/** Quality lists in the format /ajax/get_cdn_series/ returns them. */
export const streamList = {
  plain: [
    '[360p]https://cdn.example.net/a_360.mp4:hls:manifest.m3u8 or https://cdn.example.net/a_360.mp4',
    '[720p]https://cdn.example.net/a_720.mp4:hls:manifest.m3u8 or https://cdn.example.net/a_720.mp4',
    '[1080p]https://cdn.example.net/a_1080.mp4:hls:manifest.m3u8 or https://cdn.example.net/a_1080.mp4',
  ].join(','),

  /** 1080p and up are behind PRO; only 720p should ever be offered. */
  withPro: [
    '[360p]https://cdn.example.net/b_360.mp4',
    '[720p]https://cdn.example.net/b_720.mp4',
    '[<span class="pjs-prem-quality">1080p Ultra</span>]https://cdn.example.net/b_1080.mp4',
    '[<span class="pjs-prem-quality">2160p</span>]https://cdn.example.net/b_2160.mp4',
  ].join(','),

  /** "4K" carries no resolution digits — the label sorts wrong if parsed naively. */
  fourK: [
    '[360p]https://cdn.example.net/c_360.mp4',
    '[720p]https://cdn.example.net/c_720.mp4',
    '[4K]https://cdn.example.net/c_2160.mp4',
  ].join(','),

  proOnly: [
    '[<span class="pjs-prem-quality">1080p</span>]https://cdn.example.net/d_1080.mp4',
  ].join(','),
};
