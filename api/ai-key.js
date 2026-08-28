// /api/ai-key — användarens egen API-nyckel: spara, lista och radera.
//
// Nyckeln lämnar aldrig servern igen efter att den sparats. Det som går att
// läsa ut är en ledtråd på åtta tecken, tillräckligt för att känna igen vilken
// nyckel som ligger inne och för lite för att vara till nytta för någon annan.

import { requireUser, serviceClient } from './_lib/auth.js';
import { encrypt } from './_lib/crypto.js';
import { ApiError, readJsonBody, sendError, sendJson } from './_lib/http.js';
import { getProvider } from './_lib/providers.js';

export default async function handler(req, res) {
  try {
    const userId = await requireUser(req);

    if (req.method === 'POST') return await saveKey(req, res, userId);
    if (req.method === 'GET') return await listKeys(res, userId);
    if (req.method === 'DELETE') return await deleteKey(req, res, userId);

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
async function saveKey(req, res, userId) {
  const body = await readJsonBody(req);
  const provider = getProvider(requireProvider(body.provider));

  // Nycklar klistras in, och urklipp bär ofta med sig blanksteg eller radbrott.
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!key) throw new ApiError(400, 'bad_request', 'Begäran saknar fältet key.');

  const verified = await provider.verifyKey(key);
  if (!verified) {
    throw new ApiError(
      401,
      'invalid_key',
      `${provider.label} avvisade nyckeln. Kontrollera att hela nyckeln kopierats med.`
    );
  }

  const hint = keyHint(key);
  const { error } = await serviceClient.from('user_ai_keys').upsert(
    {
      user_id: userId,
      provider: provider.id,
      encrypted_key: encrypt(key),
      key_hint: hint,
      last_verified: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' }
  );
  if (error) throw new ApiError(500, 'server_error', 'Kunde inte spara nyckeln. Försök igen.');

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
async function listKeys(res, userId) {
  const { data, error } = await serviceClient
    .from('user_ai_key_status')
    .select('provider, key_hint, last_verified')
    .eq('user_id', userId)
    .order('provider');
  if (error) throw new ApiError(500, 'server_error', 'Kunde inte läsa dina sparade nycklar.');

  sendJson(res, 200, {
    providers: (data ?? []).map((rad) => ({
      provider: rad.provider,
      hint: rad.key_hint,
      lastVerified: rad.last_verified,
    })),
  });
}

/** Radering är idempotent: en nyckel som redan är borta är fortfarande borta. */
async function deleteKey(req, res, userId) {
  // Basen är påhittad: req.url är bara sökväg och frågesträng i båda
  // körmiljöerna, och URL kräver ändå något att tolka den relativt.
  const query = new URL(req.url, 'http://repetix.invalid').searchParams;
  const provider = getProvider(requireProvider(query.get('provider')));

  const { error } = await serviceClient
    .from('user_ai_keys')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider.id);
  if (error) throw new ApiError(500, 'server_error', 'Kunde inte radera nyckeln. Försök igen.');

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
