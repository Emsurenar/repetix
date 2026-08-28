import { describe, expect, it } from 'vitest';
import {
  dataUrlByteLength,
  extensionForMime,
  fitWithin,
  isDataUrl,
  parseDataUrl,
  pickOutputMime,
} from '../src/core/image-compress.js';
import { buildStoragePath, collectPendingImages } from '../src/core/image-store.js';

// Själva omkodningen testas inte här: den kräver canvas och createImageBitmap,
// som inte finns i Node. Det som testas är allt runtomkring — måtten,
// formatvalet, sökvägarna och urvalet som gör migreringen återupptagbar.

const dataUrl = (base64 = 'AAAA', mime = 'image/png') => `data:${mime};base64,${base64}`;

const bibliotek = (kort) => ({
  decks: [{ id: 'd1', cards: kort }],
});

describe('isDataUrl', () => {
  it('känner igen en data-URL', () => {
    expect(isDataUrl(dataUrl())).toBe(true);
  });

  it('avvisar en storage_path', () => {
    expect(isDataUrl('9f1c/kort-1/abc.webp')).toBe(false);
  });

  it('avvisar allt som inte är en sträng', () => {
    expect(isDataUrl(null)).toBe(false);
    expect(isDataUrl(undefined)).toBe(false);
    expect(isDataUrl(42)).toBe(false);
  });

  it('luras inte av en sökväg som råkar innehålla ordet data', () => {
    expect(isDataUrl('user/data:kort/1.webp')).toBe(false);
  });
});

describe('parseDataUrl', () => {
  it('plockar ut mime-typ och base64-flagga', () => {
    expect(parseDataUrl('data:image/webp;base64,QUJD')).toEqual({
      mime: 'image/webp',
      base64: true,
      payload: 'QUJD',
    });
  });

  it('normaliserar versaler i mime-typen', () => {
    expect(parseDataUrl('data:IMAGE/JPEG;base64,QQ==').mime).toBe('image/jpeg');
  });

  it('klarar en data-URL utan base64-kodning', () => {
    expect(parseDataUrl('data:text/plain,hej')).toEqual({
      mime: 'text/plain',
      base64: false,
      payload: 'hej',
    });
  });

  it('ger null för en storage_path', () => {
    expect(parseDataUrl('9f1c/kort-1/abc.webp')).toBeNull();
  });
});

describe('dataUrlByteLength', () => {
  it('räknar avkodad storlek ur base64-längden', () => {
    // "ABC" -> QUJD: fyra tecken base64 blir tre byte.
    expect(dataUrlByteLength('data:image/png;base64,QUJD')).toBe(3);
  });

  it('räknar bort utfyllnadstecken', () => {
    expect(dataUrlByteLength('data:image/png;base64,QQ==')).toBe(1);
    expect(dataUrlByteLength('data:image/png;base64,QUI=')).toBe(2);
  });

  it('ger noll för något som inte är en data-URL', () => {
    expect(dataUrlByteLength('9f1c/kort-1/abc.webp')).toBe(0);
  });
});

describe('extensionForMime', () => {
  it('väljer ändelse efter mime-typ', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/webp')).toBe('webp');
    expect(extensionForMime('image/png')).toBe('png');
  });

  it('bryr sig inte om versaler', () => {
    expect(extensionForMime('IMAGE/WEBP')).toBe('webp');
  });

  it('faller tillbaka på bin för okänd typ', () => {
    expect(extensionForMime('application/octet-stream')).toBe('bin');
    expect(extensionForMime(undefined)).toBe('bin');
  });
});

describe('pickOutputMime', () => {
  it('väljer webp när webbläsaren kan koda det', () => {
    expect(pickOutputMime('image/jpeg', true)).toBe('image/webp');
  });

  it('faller tillbaka på jpeg annars', () => {
    expect(pickOutputMime('image/png', false)).toBe('image/jpeg');
  });

  it('lämnar gif och svg orörda', () => {
    expect(pickOutputMime('image/gif', true)).toBeNull();
    expect(pickOutputMime('image/svg+xml', true)).toBeNull();
  });
});

describe('fitWithin', () => {
  it('skalar ned längsta sidan till maxmåttet', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it('skalar ned efter höjden när bilden är stående', () => {
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('skalar aldrig upp en liten bild', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('ger heltal även vid udda proportioner', () => {
    const { width, height } = fitWithin(1000, 333, 500);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
  });

  it('behåller minst en pixel', () => {
    expect(fitWithin(2000, 3, 100).height).toBe(1);
  });

  it('klarar orimliga mått utan att kasta', () => {
    expect(fitWithin(0, 0, 1600)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(800, 600, 0)).toEqual({ width: 800, height: 600 });
  });
});

describe('buildStoragePath', () => {
  const userId = '3f8c2a1e-0000-4444-8888-abcdefabcdef';

  it('lägger user-id först, eftersom lagringspolicyn jämför just den nivån', () => {
    const path = buildStoragePath(userId, 'kort-1', 'image/webp', 'slump');
    expect(path.split('/')[0]).toBe(userId);
  });

  it('grupperar per kort och sätter ändelse efter mime-typ', () => {
    expect(buildStoragePath(userId, 'kort-1', 'image/webp', 'slump')).toBe(
      `${userId}/kort-1/slump.webp`
    );
  });

  it('saneras så att ett kort-id inte kan skapa extra mappnivåer', () => {
    const path = buildStoragePath(userId, '../annan/kort', 'image/jpeg', 'slump');
    expect(path.split('/')).toHaveLength(3);
    expect(path.split('/')[0]).toBe(userId);
  });

  it('ger unika sökvägar för samma kort', () => {
    const a = buildStoragePath(userId, 'kort-1', 'image/webp');
    const b = buildStoragePath(userId, 'kort-1', 'image/webp');
    expect(a).not.toBe(b);
  });
});

describe('collectPendingImages', () => {
  it('plockar upp base64-poster och hoppar över redan flyttade', () => {
    const data = bibliotek([
      { id: 'k1', backImages: [dataUrl(), 'anvandare/k1/redan.webp'] },
      { id: 'k2', backImages: ['anvandare/k2/redan.webp'] },
    ]);

    const kvar = collectPendingImages(data);
    expect(kvar).toHaveLength(1);
    expect(kvar[0]).toMatchObject({ cardId: 'k1', index: 0 });
  });

  it('ger tom lista när ingenting återstår, så en omkörning laddar inte upp igen', () => {
    const data = bibliotek([{ id: 'k1', backImages: ['anvandare/k1/a.webp'] }]);
    expect(collectPendingImages(data)).toEqual([]);
  });

  it('pekar på kortet så att posten kan bytas ut på plats', () => {
    const data = bibliotek([{ id: 'k1', backImages: [dataUrl()] }]);
    const [uppgift] = collectPendingImages(data);

    uppgift.card.backImages[uppgift.index] = 'anvandare/k1/ny.webp';

    expect(data.decks[0].cards[0].backImages).toEqual(['anvandare/k1/ny.webp']);
    expect(collectPendingImages(data)).toEqual([]);
  });

  it('mäter varje posts storlek', () => {
    const data = bibliotek([{ id: 'k1', backImages: ['data:image/png;base64,QUJD'] }]);
    expect(collectPendingImages(data)[0].bytes).toBe(3);
  });

  it('klarar kort utan bilder och ett tomt bibliotek', () => {
    expect(collectPendingImages(bibliotek([{ id: 'k1' }, { id: 'k2', backImages: [] }]))).toEqual(
      []
    );
    expect(collectPendingImages({})).toEqual([]);
    expect(collectPendingImages(undefined)).toEqual([]);
  });

  it('går igenom flera kortlekar', () => {
    const data = {
      decks: [
        { id: 'd1', cards: [{ id: 'k1', backImages: [dataUrl()] }] },
        { id: 'd2', cards: [{ id: 'k2', backImages: [dataUrl(), dataUrl()] }] },
      ],
    };
    expect(collectPendingImages(data).map((u) => u.cardId)).toEqual(['k1', 'k2', 'k2']);
  });
});
