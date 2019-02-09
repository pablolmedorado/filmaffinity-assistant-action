'use strict';

import { BasicCardOptions, Button, Image, OptionItem } from 'actions-on-google';
import axios, { AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import * as _ from 'lodash';

const searchPageRegex: RegExp = /^\/\w{2}\/search\.php.*$/gim;
const detailPageRegex: RegExp = /^\/\w{2}\/film(\d+)\.html$/gim;

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

const getMovieInfoFromDetailView = ($: CheerioSelector): IMovie => {
  const ratingAverage: number | null = _.defaultTo(
    parseFloat(extractTextFromElement($('[itemprop="ratingValue"]')).replace(',', '.')),
    null
  );
  const ratingCount: number = _.defaultTo(
    parseInt(extractTextFromElement($('[itemprop="ratingCount"]')).replace('.', ''), 10),
    0
  );
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

const getReadableDurationFromMinutes = (duration: number): string => {
  const horas = Math.floor(duration / 60);
  const minutos = duration % 60;

  let result: string = '';
  if (horas) {
    result += horas === 1 ? `${horas} hora` : `${horas} horas`;
  }
  if (horas && minutos) {
    result += ' y ';
  }
  if (minutos) {
    result += minutos === 1 ? `${minutos} minuto` : `${minutos} minutos`;
  }

  return result;
};

export const buildReadableResponseFromMovie = (movie: IMovie): string => {
  let response = `${movie.title} (${movie.year}).`;

  if (movie.rating.average) {
    response += ` Calificación: ${movie.rating.average} sobre 10.`;
  }
  if (movie.duration) {
    response += ` Duración: ${getReadableDurationFromMinutes(movie.duration)}.`;
  }
  if (movie.genres) {
    response += ` Género: ${movie.genres.join(', ')}.`;
  }
  if (movie.directors) {
    response += ` Dirigida por: ${movie.directors.join(', ')}.`;
  }
  if (movie.cast) {
    response += ` Protagonizada por: ${movie.cast.slice(0, 3).join(', ')}.`;
  }
  // if (movie.plot) {
  //   response += ` Sinopsis: ${movie.plot}`;
  // }

  return response;
};

export const buildReadableResponseFromMovieList = (movies: IMovie[]): string => {
  const movieTitles = movies.map((movie) => `"${movie.title}"`);
  const lastMovie = movieTitles.pop();
  const response = `${movieTitles.join('; ')} y ${lastMovie}`;

  return response;
};

export const buildRichResponseFromMovie = (movie: IMovie, locale: string): BasicCardOptions => {
  let subtitle = '';
  if (movie.year) {
    subtitle += `📅${movie.year}. `;
  }
  if (movie.duration) {
    subtitle += `⌛️${getReadableDurationFromMinutes(movie.duration)}. `;
  }
  if (movie.rating.average) {
    subtitle += `⭐️${movie.rating.average}/10`;
  }
  return {
    text: `${movie.plot}`,
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
      title: movie.title,
      description: `${movie.year}. Calificación: ${movie.rating.average}/10`,
      image: new Image({ url: movie.poster, alt: movie.title }),
    };
  });

  return listConfig;
};
