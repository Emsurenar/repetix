// Kryptering av användarnas API-nycklar.
//
// AES-256-GCM valdes för autentiseringstaggens skull. Utan tagg dekrypteras en
// manipulerad post till skräp, och skräpet hade skickats vidare som
// autentiseringshuvud till leverantören — felet skulle alltså dyka upp som ett
// obegripligt 401 långt ifrån sin orsak. Med tagg avvisas posten här.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;

/**
 * 96 bitar är den storlek GCM är konstruerad för: kortare vektorer minskar
 * marginalen mot kollisioner, längre hashas ned internt utan att ge något.
 */
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Tolkar och kontrollerar huvudnyckeln.
 *
 * Base64-avkodningen i Node är förlåtande och hoppar tyst över ogiltiga
 * tecken, så en halvt inklistrad hemlighet ger ingen egen felsignal.
 * Längdkontrollen är därför det som fångar både fel längd och trasig base64.
 */
export function readMasterKey(secret) {
  if (!secret) {
    throw new Error(
      'AI_KEY_SECRET saknas. Sätt den till 32 slumpade byte i base64 innan serverfunktionerna startas.'
    );
  }
  const key = Buffer.from(String(secret), 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `AI_KEY_SECRET måste vara ${KEY_BYTES} byte i base64, men avkodades till ${key.length} byte.`
    );
  }
  return key;
}

/**
 * Läses vid modulinläsning, alltså vid kallstart och när utvecklingsservern
 * monterar handlern. En felaktig konfiguration ska upptäckas då och inte vid
 * första användarens första anrop, när felet i stället ser ut som ett fel i
 * appen.
 */
const masterKey = readMasterKey(process.env.AI_KEY_SECRET);

/**
 * Krypterar en API-nyckel för lagring.
 * Formatet är `iv:authTag:chiffertext`, alla tre i base64.
 *
 * Initieringsvektorn slumpas per kryptering. Med återanvänd vektor läcker GCM
 * inte bara likhet mellan poster utan i praktiken hela nyckelströmmen.
 */
export function encrypt(plaintext) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((del) => del.toString('base64')).join(':');
}

/**
 * Återskapar en API-nyckel ur det lagrade värdet.
 *
 * Kastar om posten är manipulerad, trasig, eller krypterad med en annan
 * huvudnyckel. Anropsstället ska behandla alla tre som "användaren måste lägga
 * in sin nyckel på nytt" — det finns ingen väg tillbaka från någon av dem.
 */
export function decrypt(stored) {
  const parts = String(stored).split(':');
  if (parts.length !== 3) throw new Error('Den lagrade nyckeln har fel format.');

  const [iv, authTag, ciphertext] = parts.map((del) => Buffer.from(del, 'base64'));
  if (iv.length !== IV_BYTES || authTag.length !== TAG_BYTES) {
    throw new Error('Den lagrade nyckeln har fel format.');
  }

  const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
