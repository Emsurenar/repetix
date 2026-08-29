// /api/ai-key — användarens egen API-nyckel: spara, lista och radera.
//
// Nyckeln lämnar aldrig servern igen efter att den sparats. Det som går att
// läsa ut är en ledtråd på åtta tecken, tillräckligt för att känna igen vilken
// nyckel som ligger inne och för lite för att vara till nytta för någon annan.

import { requireUser } from './_lib/auth.js';
import { encrypt } from './_lib/crypto.js';
import {
  ApiError,
  dbError,
  readJsonBody,
  readTextField,
  sendError,
  sendJson,
} from './_lib/http.js';
import { enforceRateLimit } from './_lib/limit.js';
import { getProvider } from './_lib/providers.js';

/**
 * En API-nyckel är kort och består av tecken som får stå i ett HTTP-huvud.
 * Gränsen finns för att strängen skickas vidare som autentiseringshuvud till
 * leverantören — utan den kan slutpunkten användas för att skicka megabyte i
 * ett huvud från våra servrar.
 */
const MAX_KEY_CHARS = 512;

/**
 * Synliga ASCII-tecken utan blanksteg. Ett radbrott i ett huvudvärde är den
 * klassiska vägen att smuggla in en egen rad i en HTTP-begäran, och en riktig
 * nyckel innehåller aldrig något utanför det här intervallet.
 */
const KEY_PATTERN = /^[\x21-\x7e]+$/;

export default async function handler(req, res) {
  try {
    const { userId, db } = await requireUser(req);

    // Gäller alla tre metoderna. Läsning och radering rör inte nätet utanför
    // Supabase, men kostar en serverfunktion var.
    await enforceRateLimit(db, 'ai-key');

    if (req.method === 'POST') return await saveKey(req, res, userId, db);
    if (req.method === 'GET') return await listKeys(res, userId, db);
    if (req.method === 'DELETE') return await deleteKey(req, res, userId, db);

    throw new ApiError(405, 'bad_request', 'Slutpunkten tar emot POST, GET och DELETE.');
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * Sparar en nyckel, men först efter att leverantören bekräftat att den
 * fungerar. En felskrivning ska upptäckas här, medan användaren står kvar i
 * inställningarna och har nyckeln i urklipp — inte nästa gång någon försöker
 * generera kort och får ett fel som ser ut att komma från appen.
 */
async function saveKey(req, res, userId, db) {
  const body = await readJsonBody(req);
  const provider = getProvider(requireProvider(body.provider));

  // Nycklar klistras in, och urklipp bär ofta med sig blanksteg eller radbrott.
  const key = readTextField(body.key, { name: 'key', max: MAX_KEY_CHARS, required: true });
  if (!KEY_PATTERN.test(key)) {
    throw new ApiError(
      400,
      'bad_request',
      'API-nyckeln innehåller tecken som inte kan skickas till leverantören. Kontrollera att bara nyckeln kopierats med.'
    );
  }

  // Egen, hårdare kvot precis före kontrollen mot leverantören.
  //
  // Kontrollen skickar den inkomna strängen som autentiseringshuvud och skiljer
  // sedan exakt på giltig och ogiltig nyckel, utan att kosta en enda token.
  // Obegränsad är den ett orakel: den som skrapat ihop nycklar någon annanstans
  // kan triagera dem mot fyra leverantörer från våra IP-nummer och under vårt
  // namn. Taket gör slutpunkten obrukbar för det utan att märkas av någon som
  // lägger in sin egen nyckel.
  await enforceRateLimit(db, 'ai-key:verify');

  const verified = await provider.verifyKey(key);
  if (!verified) {
    throw new ApiError(
      401,
      'invalid_key',
      `${provider.label} avvisade nyckeln. Kontrollera att hela nyckeln kopierats med.`
    );
  }

  const hint = keyHint(key);
  const { error } = await db.from('user_ai_keys').upsert(
    {
      user_id: userId,
      provider: provider.id,
      encrypted_key: encrypt(key),
      key_hint: hint,
      last_verified: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' }
  );
  if (error) throw dbError(error, 'Kunde inte spara nyckeln. Försök igen.');

  sendJson(res, 200, { ok: true, hint, verified: true });
}

/**
 * Läser metadata via vyn user_ai_key_status i stället för tabellen.
 *
 * Vyn saknar kolumnen med chiffertexten, så den här slutpunkten kan inte ens
 * av misstag lämna ut den — en felskriven select går inte att skriva. Att
 * läsningen alls måste ske på servern beror på att tabellen medvetet saknar
 * select-policy: klienten kommer inte åt raderna själv.
 */
async function listKeys(res, userId, db) {
  const { data, error } = await db
    .from('user_ai_key_status')
    .select('provider, key_hint, last_verified')
    .eq('user_id', userId)
    .order('provider');
  if (error) throw dbError(error, 'Kunde inte läsa dina sparade nycklar.');

  sendJson(res, 200, {
    providers: (data ?? []).map((rad) => ({
      provider: rad.provider,
      hint: rad.key_hint,
      lastVerified: rad.last_verified,
    })),
  });
}

/** Radering är idempotent: en nyckel som redan är borta är fortfarande borta. */
async function deleteKey(req, res, userId, db) {
  // Basen är påhittad: req.url är bara sökväg och frågesträng i båda
  // körmiljöerna, och URL kräver ändå något att tolka den relativt.
  const query = new URL(req.url, 'http://repetix.invalid').searchParams;
  const provider = getProvider(requireProvider(query.get('provider')));

  const { error } = await db
    .from('user_ai_keys')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider.id);
  if (error) throw dbError(error, 'Kunde inte radera nyckeln. Försök igen.');

  sendJson(res, 200, { ok: true });
}

/**
 * Leverantören är obligatorisk i alla tre riktningarna. Ett eget meddelande
 * här, eftersom "okänd leverantör: " med tomt namn inte säger användaren
 * någonting om vad som saknas.
 */
function requireProvider(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new ApiError(400, 'bad_request', 'Begäran saknar fältet provider.');
  return name;
}

/**
 * Fyra tecken i var ände enligt kontraktet. Korta strängar maskeras helt —
 * annars hade ledtråden visat nästan hela nyckeln, vilket är precis vad den
 * finns till för att undvika.
 */
function keyHint(key) {
  if (key.length < 12) return '...';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
