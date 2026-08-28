// Monterar api/*.js som middleware i Vites utvecklingsserver.
//
// Vercels funktioner körs inte av Vite. Utan det här skulle serversidan behöva
// startas separat lokalt, och lokal kod skulle förr eller senare divergera från
// den deployade. Handlerna är skrivna i Nodes (req, res)-form just för att
// samma fil ska gå att köra på båda ställena: Vite lämnar över samma req och
// res som Vercel gör, så pluginen behöver bara hitta rätt fil och anropa den.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';

/**
 * Bara slutpunktsnamn — inga snedstreck, inga punkter, inget inledande
 * understreck. Vercel routar aldrig till filer som börjar med _, och api/_lib
 * är delad kod och inte slutpunkter. Samma regel måste gälla lokalt, annars
 * vore /api/_lib/crypto anropbar i utveckling men inte i produktion.
 */
const ENDPOINT_NAME = /^[a-zA-Z0-9-]+$/;

export function apiPlugin({ dir = 'api' } = {}) {
  let envLoaded = false;

  return {
    name: 'repetix:api',
    apply: 'serve',

    configureServer(server) {
      const apiDir = resolve(server.config.root, dir);

      // Registreras direkt i stället för via en returnerad funktion, så att
      // /api/... hanteras innan Vites egna middlewares hinner svara med
      // index.html.
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        if (!envLoaded) {
          loadServerEnv(server.config);
          envLoaded = true;
        }

        const file = resolveHandler(apiDir, req.url);
        if (!file) return respond(res, 404, { error: 'Okänd slutpunkt.', code: 'bad_request' });

        runHandler(server, file, req, res).catch((err) => {
          // Endast utveckling. Här är felmeddelandet det värdefulla — typiskt
          // att AI_KEY_SECRET saknas i .env, vilket handlern säger ifrån om
          // redan vid inläsningen. I produktion syns aldrig den här vägen,
          // eftersom samma fel då kastar vid kallstart.
          if (res.writableEnded) return;
          respond(res, 500, {
            error: err?.message ?? 'Okänt fel i api-handlern.',
            code: 'server_error',
          });
        });
      });
    },
  };
}

async function runHandler(server, file, req, res) {
  // ssrLoadModule i stället för import: Vite håller modulgrafen aktuell, så en
  // ändrad handler slår igenom vid nästa anrop utan omstart av servern.
  const mod = await server.ssrLoadModule(file);
  if (typeof mod.default !== 'function') {
    throw new Error(`${file} saknar en default-exporterad handler.`);
  }
  await mod.default(req, res);
}

function resolveHandler(apiDir, url) {
  const name = url.split('?')[0].slice('/api/'.length).replace(/\/+$/, '');
  if (!ENDPOINT_NAME.test(name)) return null;
  const file = resolve(apiDir, `${name}.js`);
  return existsSync(file) ? file : null;
}

/**
 * Lyfter in serverns miljövariabler i process.env.
 *
 * Vite exponerar bara VITE_-prefixade variabler, och då i import.meta.env i
 * klienten. Serverns tre variabler får inte ha det prefixet — det skulle bygga
 * in service role-nyckeln i klientpaketet — så de måste plockas ur .env för
 * hand. Värdena stannar i utvecklingsserverns egen process: de definieras
 * ingenstans i bygget och kan därför inte hamna i klienten.
 *
 * Redan satta variabler lämnas orörda, så att skalets värden vinner över .env
 * på samma sätt som i produktion.
 */
function loadServerEnv(config) {
  const env = loadEnv(config.mode, config.root, '');
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith('VITE_')) continue;
    if (process.env[name] === undefined) process.env[name] = value;
  }
}

function respond(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}
