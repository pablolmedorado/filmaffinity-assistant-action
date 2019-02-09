'use strict';

import { BasicCard, dialogflow, DialogflowConversation, List, Permission, Suggestions } from 'actions-on-google';
import * as functions from 'firebase-functions';
import {
  buildReadableResponseFromMovie,
  buildReadableResponseFromMovieList,
  buildRichResponseFromMovie,
  buildRichResponseFromMovieList,
  getMoviesFromQuery,
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
        conv.ask('He encontrado ésto:');
        conv.ask(new BasicCard(buildRichResponseFromMovie(movies.results[0], 'es')));
      } else {
        conv.ask(buildReadableResponseFromMovie(movies.results[0]));
      }
      conv.ask('¿Qué quieres hacer ahora?');
      conv.ask(new Suggestions('Sinopsis'));
    } else if (movies.count > 1) {
      const relevantMovies = movies.results.slice(0, 3);

      conv.ask(
        `He encontrado ${
          movies.count
        } películas que contienen "${movieToSearch}" en su título. Éstas son las más relevantes:`
      );

      if (conv.screen) {
        const listItems = buildRichResponseFromMovieList(relevantMovies);
        conv.ask(new List({ title: `Resultados con "${movieToSearch}"`, items: listItems }));
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
      conv.ask(new BasicCard({ title: movie.title, subtitle: 'Sinopsis', text: movie.plot }));
    } else {
      conv.ask(`<speak>${movie.plot} <break time="1s"/> Eso es todo.</speak>`);
    }
  } else {
    conv.ask('Lo siento, no has seleccionado ninguna película.');
  }
  conv.ask('¿Qué quieres hacer ahora?');
});

// Set the DialogflowApp object to handle the HTTPS POST request.
export const dialogflowFirebaseFulfillment = functions.https.onRequest(app);
