'use strict';

import { BasicCard, dialogflow, DialogflowConversation, List, Permission, Suggestions } from 'actions-on-google';
import * as functions from 'firebase-functions';
import {
  buildReadableResponseFromMovie,
  buildReadableResponseFromMovieList,
  buildReadableResponseFromTopList,
  buildRichResponseFromMovie,
  buildRichResponseFromMovieList,
  getMoviesFromQuery,
  getTopMovies,
  IMovie,
  ISearchResult,
} from './utils';

// Instantiate the Dialogflow client.
const app = dialogflow({ debug: true });

// Handle the Dialogflow intent named 'Default Welcome Intent'.
app.intent('Default Welcome Intent', (conv) => {
  const name = (conv.user.storage as any).givenName;
  if (!name) {
    conv.ask(
      new Permission({
        context: '¡Bienvenido! Para conocerte mejor',
        permissions: 'NAME',
      })
    );
  } else {
    conv.ask(`¡Hola de nuevo, ${name}! ¿Qué quieres hacer?`);
  }
});

// Handle the Dialogflow intent named 'actions_intent_PERMISSION'. If user
// agreed to PERMISSION prompt, then boolean value 'permissionGranted' is true.
app.intent('actions_intent_PERMISSION', (conv, params, permissionGranted) => {
  if (!permissionGranted) {
    conv.ask('De acuerdo, te llamaré "Tipo de incógnito".');
  } else {
    (conv.user.storage as any).givenName = conv.user.name.given;
    conv.ask(`Gracias, ${(conv.user.storage as any).givenName}.`);
  }
  conv.ask('¿Qué quieres hacer? Puedes pedir ayuda si lo necesitas.');
});

// Handle the Dialogflow intent named 'search movie'.
// The intent collects a parameter named 'movie'
app.intent('search movie', async (conv: DialogflowConversation, params: any) => {
  try {
    const movieToSearch = conv.arguments.get('OPTION') || params.query;
    (conv.data as any).lastMovie = undefined;
    const movies: ISearchResult = await getMoviesFromQuery(movieToSearch, 'es');

    if (movies.count === 1) {
      (conv.data as any).lastMovie = movies.results[0];
      if (conv.screen) {
        conv.ask('Aquí tienes:');
        conv.ask(new BasicCard(buildRichResponseFromMovie(movies.results[0], 'es')));
      } else {
        conv.ask(buildReadableResponseFromMovie(movies.results[0]));
      }
      conv.ask('¿Qué quieres hacer ahora?');
      conv.ask(new Suggestions(['🎞 Sinopsis', '🏆 Premios']));
    } else if (movies.count > 1) {
      const relevantMovies = movies.results.slice(0, 3);

      conv.ask(
        `He encontrado ${
          movies.count
        } películas que contienen "${movieToSearch}" en su título. Éstas son las más relevantes:`
      );

      if (conv.screen) {
        const listItems = buildRichResponseFromMovieList(relevantMovies);
        conv.ask(new List({ title: `🔎 Resultados con "${movieToSearch}"`, items: listItems }));
      } else {
        conv.ask(buildReadableResponseFromMovieList(relevantMovies));
      }
    } else {
      conv.ask(`Lo siento, no he encontrado ninguna película con el término de búsqueda "${movieToSearch}".`);
      conv.ask('¿Qué quieres hacer ahora?');
    }
  } catch (error) {
    conv.close('Disculpa, estoy experimentando algunas dificultades. Por favor prueba un poco más tarde. ¡Gracias!');
  }
});

app.intent('search movie - plot', (conv: DialogflowConversation) => {
  const movie = (conv.data as any).lastMovie as IMovie;
  if (movie && movie.plot) {
    if (conv.screen) {
      conv.ask('Aquí tienes:');
      conv.ask(new BasicCard({ title: movie.title, subtitle: '🎞 Sinopsis', text: movie.plot }));
    } else {
      conv.ask(`<speak><p>${movie.plot}</p><break time="1s"/></speak>`);
    }
  } else {
    conv.ask('Lo siento, no has seleccionado ninguna película.');
  }
  conv.ask('¿Qué quieres hacer ahora?');
});

app.intent('search movie - awards', (conv: DialogflowConversation) => {
  const movie = (conv.data as any).lastMovie as IMovie;
  if (movie) {
    if (movie.awards && Object.keys(movie.awards).length) {
      let text = '';
      if (conv.screen) {
        conv.ask('Aquí tienes:');
        for (const award in movie.awards) {
          if (movie.awards.hasOwnProperty(award)) {
            text += `📅 **${award}**:  \n${(movie.awards as any)[award].join('.  \n')}.  \n`;
          }
        }
        conv.ask(new BasicCard({ title: movie.title, subtitle: '🏆 Premios', text }));
      } else {
        for (const award in movie.awards) {
          if (movie.awards.hasOwnProperty(award)) {
            text += `Año ${award}:<break time="1s"/>  ${(movie.awards as any)[award].join('.<break time="1s"/> ')}`;
          }
        }
        conv.ask(`<speak>${text}</speak>`);
      }
    } else {
      conv.ask('La película seleccionada no tiene premios.');
    }
  } else {
    conv.ask('Lo siento, no has seleccionado ninguna película.');
  }
  conv.ask('¿Qué quieres hacer ahora?');
});

app.intent('top movies', async (conv: DialogflowConversation, params: any) => {
  try {
    const movies: IMovie[] = await getTopMovies(params.genre, params.country, params.yearFrom, params.yearTo, 'es');
    conv.ask('Las películas mejor valoradas según tus criterios de búsqueda son:');

    if (conv.screen) {
      const listItems = buildRichResponseFromMovieList(movies.slice(0, 10));
      conv.ask(new List({ title: `🔝 Top películas`, items: listItems }));
    } else {
      conv.ask(buildReadableResponseFromTopList(movies.slice(0, 5)));
    }
  } catch (error) {
    conv.close('Disculpa, estoy experimentando algunas dificultades. Por favor prueba un poco más tarde. ¡Gracias!');
  }
});

// Set the DialogflowApp object to handle the HTTPS POST request.
export const dialogflowFirebaseFulfillment = functions.https.onRequest(app);
