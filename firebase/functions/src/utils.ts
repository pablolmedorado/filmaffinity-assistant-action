'use strict';

import { BasicCardOptions, Button, Image, OptionItem } from 'actions-on-google';
import axios, { AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import * as _ from 'lodash';

import { countries, genres } from './entities';

const searchPageRegex: RegExp = /^\/\w{2}\/search\.php.*$/gim;
const detailPageRegex: RegExp = /^\/\w{2}\/film(\d+)\.html$/gim;
const yearTitleRegex: RegExp = /(?<=\()\d{4}(?=\))/gim;

export interface IMovie {
  id: number;
  title: string;
  poster: string;
  country: string;
  year: number;
  rating: {
    average: number | null;
    count: number;
  };
  directors?: string[];
  cast?: string[];
  genres?: string[];
  duration?: number;
  plot?: string;
  awards?: {
    [key: string]: string[];
  };
  position?: number;
}

export interface ISearchResult {
  count: number;
  results: IMovie[];
}

const extractTextFromMultipleElements = ($array: Cheerio, $: CheerioSelector): string[] => {
  return $array
    .map((index, element) => {
      return $(element)
        .text()
        .trim();
    })
    .get();
};

const extractTextFromElement = ($element: Cheerio): string =>
  $element
    .first()
    .text()
    .trim();

const extractTextFromElementsAttr = ($element: Cheerio, attrName: string): string =>
  $element
    .first()
    .attr(attrName)
    .trim();

const getMoviesInfoFromListView = ($: CheerioSelector): ISearchResult => {
  const count: number = parseInt(extractTextFromElement($('.nav-header > .ntabs > .active > a > .count')), 10);

  const movies = $('.movie-card')
    .map((index, element) => {
      const $infoContainer = $('.mc-info-container', element).first();

      const ratingAverage = _.defaultTo(
        parseFloat(extractTextFromElement($('.mr-rating > .avgrat-box', $infoContainer)).replace(',', '.')),
        null
      );
      const ratingCount = _.defaultTo(
        parseInt(extractTextFromElement($('.mr-rating > .ratcount-box', $infoContainer)).replace('.', ''), 10),
        0
      );

      const movie: IMovie = {
        id: $(element).data().movieId,
        year: parseInt(extractTextFromElement($('.ye-w', $(element).closest('.se-it'))), 10),
        poster: extractTextFromElementsAttr($('.mc-poster > a > img', element), 'src'),
        title: extractTextFromElement($('.mc-title > a', $infoContainer)),
        country: extractTextFromElementsAttr($('.mc-title > img', $infoContainer), 'alt'),
        rating: {
          average: ratingAverage,
          count: ratingCount,
        },
        directors: extractTextFromMultipleElements($('.mc-director > .credits > .nb > a', $infoContainer), $),
        cast: extractTextFromMultipleElements($('.mc-cast > .credits > .nb > a', $infoContainer), $),
      };
      return movie;
    })
    .get();
  return { count, results: movies };
};

const getMoviesInfoFromTopView = ($: CheerioSelector): IMovie[] => {
  const movies = $('#top-movies > li > ul')
    .map((index, element) => {
      const $movieCard = $('.content > .movie-card', element).first();
      const $infoContainer = $('.mc-info-container', $movieCard).first();

      let year = '';
      const titleText = extractTextFromElement($('.mc-title', $infoContainer));
      const regexResult = titleText.match(yearTitleRegex);
      if (regexResult) {
        year = regexResult.entries().next().value[1];
      }

      const ratingAverage = _.defaultTo(
        parseFloat(extractTextFromElement($('.data > .avg-rating', element)).replace(',', '.')),
        null
      );
      const ratingCount = _.defaultTo(
        parseInt(extractTextFromElement($('.data > .rat-count', element)).replace('.', ''), 10),
        0
      );

      const movie: IMovie = {
        id: $($movieCard).data().movieId,
        year: parseInt(year, 10),
        poster: extractTextFromElementsAttr($('.mc-poster > a > img', element), 'src'),
        title: extractTextFromElement($('.mc-title > a', $infoContainer)),
        country: extractTextFromElementsAttr($('.mc-title > img', $infoContainer), 'alt'),
        rating: {
          average: ratingAverage,
          count: ratingCount,
        },
        directors: extractTextFromMultipleElements($('.mc-director > .credits > .nb > a', $infoContainer), $),
        cast: extractTextFromMultipleElements($('.mc-cast > .credits > .nb > a', $infoContainer), $),
        position: parseInt(extractTextFromElement($('.position', element)), 10),
      };
      return movie;
    })
    .get();
  return movies;
};

const getMovieInfoFromDetailView = ($: CheerioSelector): IMovie => {
  const ratingAverage: number | null = _.defaultTo(
    parseFloat(extractTextFromElement($('[itemprop="ratingValue"]')).replace(',', '.')),
    null
  );
  const ratingCount: number = _.defaultTo(
    parseInt(extractTextFromElement($('[itemprop="ratingCount"]')).replace('.', ''), 10),
    0
  );
  const awards: { [key: string]: string[] } = {};
  $('.award > div > a').each((index, award) => {
    const splittedAward = $(award)
      .parent()
      .text()
      .trim()
      .split('.')[0]
      .split(': ');
    if (splittedAward[0] in awards) {
      (awards as any)[splittedAward[0]].push(splittedAward.slice(1).join(': '));
    } else {
      (awards as any)[splittedAward[0]] = [splittedAward.slice(1).join(': ')];
    }
  });
  const movie: IMovie = {
    id: parseInt(extractTextFromElementsAttr($('[data-movie-id]'), 'data-movie-id'), 10),
    year: parseInt(extractTextFromElement($('[itemprop="datePublished"]')), 10),
    poster: extractTextFromElementsAttr($('#movie-main-image-container > a > img'), 'src').replace('mmed', 'large'),
    title: extractTextFromElement($('#main-title > [itemprop="name"]')),
    country: extractTextFromElementsAttr($('#country-img > img'), 'alt'),
    rating: {
      average: ratingAverage,
      count: ratingCount,
    },
    directors: extractTextFromMultipleElements($('[itemprop="director"] > a > [itemprop="name"]'), $),
    cast: extractTextFromMultipleElements($('[itemprop="actor"] > a > [itemprop="name"]'), $),
    genres: extractTextFromMultipleElements($('[itemprop="genre"] > a'), $),
    duration: parseInt(extractTextFromElement($('[itemprop="duration"]')).split(' ')[0], 10),
    plot: extractTextFromElement($('[itemprop="description"]')).replace(' (FILMAFFINITY)', ''),
    awards,
  };
  return movie;
};

const getMovieById = async (id: number, locale: string): Promise<IMovie> => {
  const url: string = `https://www.filmaffinity.com/${locale}/film${id}.html`;
  const response: AxiosResponse = await axios.get(url);
  const $: CheerioStatic = cheerio.load(response.data, {
    normalizeWhitespace: true,
    xmlMode: true,
  });
  return getMovieInfoFromDetailView($);
};

export const getMoviesFromQuery = async (query: string, locale: string): Promise<ISearchResult> => {
  const url: string = `https://www.filmaffinity.com/${locale}/search.php`;
  const response: AxiosResponse = await axios.get(url, {
    params: {
      stype: 'title',
      stext: query,
    },
  });
  const $: CheerioStatic = cheerio.load(response.data, {
    normalizeWhitespace: true,
    xmlMode: true,
  });

  let result: ISearchResult = { count: 0, results: [] };
  if (response.request.path.match(detailPageRegex)) {
    result = { count: 1, results: [getMovieInfoFromDetailView($)] };
  } else if (response.request.path.match(searchPageRegex)) {
    result = getMoviesInfoFromListView($);
    const exactMatch = result.results.find((movie) => movie.title.toLowerCase() === query.toLowerCase());
    if (exactMatch) {
      result = { count: 1, results: [await getMovieById(exactMatch.id, locale)] };
    }
  }
  return result;
};

const getReadableDurationFromMinutes = (duration: number, shortFormat: boolean = false): string => {
  const horas = Math.floor(duration / 60);
  const minutos = duration % 60;

  let result: string = '';
  if (horas) {
    if (shortFormat) {
      result += `${horas}h`;
    } else {
      result += horas === 1 ? `${horas} hora` : `${horas} horas`;
    }
  }
  if (horas && minutos) {
    result += ' ';
  }
  if (minutos) {
    if (shortFormat) {
      result += `${minutos}min`;
    } else {
      result += minutos === 1 ? `${minutos} minuto` : `${minutos} minutos`;
    }
  }

  return result;
};

export const buildReadableResponseFromMovie = (movie: IMovie): string => {
  let response = `<s>${movie.title}.</s><s>Año ${movie.year}.</s>`;

  if (movie.rating.average) {
    response += `<s>Calificación: ${movie.rating.average} sobre 10.</s>`;
  }
  if (movie.duration) {
    response += `<s>Duración: ${getReadableDurationFromMinutes(movie.duration)}.</s>`;
  }
  if (movie.genres) {
    response += `<s>Géneros: ${movie.genres.join(', ')}.</s>`;
  }
  if (movie.directors) {
    response += `<s>Dirigida por: ${movie.directors.join(', ')}.</s>`;
  }
  if (movie.cast) {
    response += `<s>Protagonizada por: ${movie.cast.slice(0, 3).join(', ')}.</s>`;
  }

  return `<speak><p>${response}</p></speak>`;
};

export const buildReadableResponseFromMovieList = (movies: IMovie[]): string => {
  const movieTitles = movies.map((movie) => `"${movie.title}"`);
  const lastMovie = movieTitles.pop();
  const response = `${movieTitles.join('; ')} y ${lastMovie}.`;

  return `<speak><p><s>${response}</s></p></speak>`;
};

export const buildReadableResponseFromTopList = (movies: IMovie[]): string => {
  const movieTitles = movies.map(
    (movie) =>
      `${movie.position}: "${movie.title}",` +
      (movie.rating.average ? ` con una puntuación de ${movie.rating.average}` : '')
  );
  const lastMovie = movieTitles.pop();
  const response = `${movieTitles.join(';<break time="1s"/> ')} y ${lastMovie}.`;

  return `<speak><p><s>${response}</s></p></speak>`;
};

export const buildRichResponseFromMovie = (movie: IMovie, locale: string): BasicCardOptions => {
  let subtitle = '';
  if (movie.year) {
    subtitle += `📅${movie.year}. `;
  }
  if (movie.duration) {
    subtitle += `⌛️${getReadableDurationFromMinutes(movie.duration, true)}. `;
  }
  if (movie.rating.average) {
    subtitle += `⭐️${movie.rating.average}/10`;
  }
  let text = '';
  if (movie.genres) {
    text += `🏷: ${movie.genres.join(', ')}.  \n`;
  }
  if (movie.directors) {
    text += `🎬: ${movie.directors.join(', ')}.  \n`;
  }
  if (movie.cast) {
    text += `👥: ${movie.cast.join(', ')}.`;
  }
  return {
    text,
    subtitle,
    title: movie.title,
    buttons: new Button({
      title: 'Ver en FilmAffinity',
      url: `https://m.filmaffinity.com/${locale}/movie.php?id=${movie.id}`,
    }),
    image: new Image({
      url: movie.poster,
      alt: movie.title,
    }),
    display: 'WHITE',
  };
};

export const buildRichResponseFromMovieList = (movies: IMovie[]): { [key: string]: OptionItem } => {
  const listConfig: { [key: string]: OptionItem } = {};
  movies.forEach((movie, index) => {
    listConfig[movie.title] = {
      title: movie.position ? `${movie.position}. ${movie.title}` : movie.title,
      description: `Año ${movie.year}. Calificación: ${movie.rating.average}/10`,
      image: new Image({ url: movie.poster, alt: movie.title }),
    };
  });

  return listConfig;
};

export const getTopMovies = async (
  genre: string,
  country: string,
  yearFrom: number,
  yearTo: number,
  locale: string
): Promise<IMovie[]> => {
  const url: string = `https://www.filmaffinity.com/${locale}/topgen.php`;
  const response: AxiosResponse = await axios.get(url, {
    params: {
      genre: (genres as any)[genre] || '',
      fromyear: yearFrom || '',
      toyear: yearTo || '',
      country: (countries as any)[country] || '',
      nodoc: '',
      notvse: '',
    },
  });
  const $: CheerioStatic = cheerio.load(response.data, {
    normalizeWhitespace: true,
    xmlMode: true,
  });

  return getMoviesInfoFromTopView($);
};
