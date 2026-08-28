import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Huvudnyckeln läses när modulen laddas, alltså måste den finnas innan
// importen sker. Ett statiskt import-uttryck hade hissats över den här raden.
process.env.AI_KEY_SECRET = randomBytes(32).toString('base64');
const { decrypt, encrypt, readMasterKey } = await import('../api/_lib/crypto.js');

const NYCKEL = 'sk-ant-api03-DetTaRenLangNyckelStrangMedÅÄÖ-1234567890';

describe('readMasterKey', () => {
  it('godtar 32 byte i base64', () => {
    const hemlighet = randomBytes(32).toString('base64');
    expect(readMasterKey(hemlighet)).toHaveLength(32);
  });

  it('kastar nar hemligheten saknas', () => {
    expect(() => readMasterKey(undefined)).toThrow(/AI_KEY_SECRET saknas/);
    expect(() => readMasterKey('')).toThrow(/AI_KEY_SECRET saknas/);
  });

  it('kastar vid fel nyckellangd', () => {
    expect(() => readMasterKey(randomBytes(16).toString('base64'))).toThrow(/32 byte/);
    expect(() => readMasterKey(randomBytes(64).toString('base64'))).toThrow(/32 byte/);
  });

  it('kastar nar hemligheten inte ar base64', () => {
    expect(() => readMasterKey('inte en riktig hemlighet')).toThrow(/32 byte/);
  });
});

describe('encrypt och decrypt', () => {
  it('ger tillbaka samma text efter en rundtur', () => {
    expect(decrypt(encrypt(NYCKEL))).toBe(NYCKEL);
  });

  it('klarar tecken utanfor ascii', () => {
    expect(decrypt(encrypt('nyckel-med-åäö-och-emojifritt-innehåll'))).toBe(
      'nyckel-med-åäö-och-emojifritt-innehåll'
    );
  });

  it('lagrar iv, authTag och chiffertext i base64', () => {
    const delar = encrypt(NYCKEL).split(':');
    expect(delar).toHaveLength(3);
    expect(Buffer.from(delar[0], 'base64')).toHaveLength(12);
    expect(Buffer.from(delar[1], 'base64')).toHaveLength(16);
    expect(Buffer.from(delar[2], 'base64').length).toBeGreaterThan(0);
  });

  it('ger olika chiffertext varje gang, eftersom iv slumpas per kryptering', () => {
    const forsta = encrypt(NYCKEL);
    const andra = encrypt(NYCKEL);
    expect(forsta).not.toBe(andra);
    expect(forsta.split(':')[0]).not.toBe(andra.split(':')[0]);
    expect(decrypt(forsta)).toBe(NYCKEL);
    expect(decrypt(andra)).toBe(NYCKEL);
  });

  it('avvisar manipulerad chiffertext i stallet for att ge skrap', () => {
    const delar = encrypt(NYCKEL).split(':');
    const chiffertext = Buffer.from(delar[2], 'base64');
    chiffertext[0] ^= 0xff;
    delar[2] = chiffertext.toString('base64');
    expect(() => decrypt(delar.join(':'))).toThrow();
  });

  it('avvisar manipulerad authTag', () => {
    const delar = encrypt(NYCKEL).split(':');
    const tag = Buffer.from(delar[1], 'base64');
    tag[0] ^= 0xff;
    delar[1] = tag.toString('base64');
    expect(() => decrypt(delar.join(':'))).toThrow();
  });

  it('avvisar en post med bytt iv', () => {
    const delar = encrypt(NYCKEL).split(':');
    delar[0] = randomBytes(12).toString('base64');
    expect(() => decrypt(delar.join(':'))).toThrow();
  });

  it('avvisar varden med fel format', () => {
    expect(() => decrypt('bara-en-strang')).toThrow(/fel format/);
    expect(() => decrypt('aaa:bbb')).toThrow(/fel format/);
    expect(() =>
      decrypt(`${randomBytes(8).toString('base64')}:${randomBytes(16).toString('base64')}:x`)
    ).toThrow(/fel format/);
  });
});
