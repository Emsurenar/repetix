import { describe, expect, it, vi } from 'vitest';
import {
  bytesToBase64,
  collectBackupImages,
  collectCloudImagePaths,
  fetchImageAsDataUrl,
  formatBytes,
  inlineBackupImages,
  mimeForPath,
  writeWithinQuota,
} from '../src/core/backup-images.js';

// Vägen som gör en exportfil självbärande, prövad utan webbläsare: upplösaren
// och fetch skickas in, så både lyckade hämtningar, tomma svar, HTTP-fel och
// en upplösning som faller helt går att spela upp här.

const kort = (id, backImages) => ({ id, front: 'f', back: 'b', backImages });

const bibliotek = (...kortlek) => ({ decks: [{ id: 'd1', cards: kortlek }] });

/** Ett svar av samma form som fetch ger, med valfri content-type. */
const svar = (bytes, { type = 'image/webp', ok = true, status = 200 } = {}) => ({
  ok,
  status,
  headers: { get: (namn) => (namn.toLowerCase() === 'content-type' && type ? type : null) },
  arrayBuffer: async () => new Uint8Array(bytes).buffer,
});

/** Upplösare som signerar allt den får. */
const upplosare = (paths) => Promise.resolve(new Map(paths.map((p) => [p, `https://x/${p}?sig`])));

const nBytes = (n, fyll = 7) => Array.from({ length: n }, (_, i) => (i * fyll) % 256);

describe('collectCloudImagePaths', () => {
  it('plockar ut sökvägarna men inte de bilder som redan är data-URL:er', () => {
    const data = bibliotek(kort('k1', ['u/k1/a.webp', 'data:image/png;base64,AAAA']));
    expect(collectCloudImagePaths(data)).toEqual(['u/k1/a.webp']);
  });

  it('tar med varje sökväg en gång, även när två kort delar bild', () => {
    const data = bibliotek(kort('k1', ['u/delad.webp']), kort('k2', ['u/delad.webp']));
    expect(collectCloudImagePaths(data)).toEqual(['u/delad.webp']);
  });

  it('klarar kort utan bilder, tomma bibliotek och trasiga fält', () => {
    expect(collectCloudImagePaths(undefined)).toEqual([]);
    expect(collectCloudImagePaths({})).toEqual([]);
    expect(collectCloudImagePaths(bibliotek(kort('k1', undefined)))).toEqual([]);
    expect(collectCloudImagePaths(bibliotek(kort('k1', 'inte-en-array')))).toEqual([]);
    expect(collectCloudImagePaths(bibliotek(kort('k1', [null, '', 42])))).toEqual([]);
  });
});

describe('bytesToBase64', () => {
  it('ger samma resultat som Buffer för godtyckliga bytes', () => {
    const bytes = new Uint8Array(nBytes(1000, 31));
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('klarar en bild som är större än anropsstacken tål i ett svep', () => {
    // Kortbilderna ligger runt 200 kB. En byte per argument till
    // String.fromCharCode spränger stacken långt innan dess.
    const bytes = new Uint8Array(nBytes(300000, 13));
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('tar både ArrayBuffer och Uint8Array', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(bytesToBase64(bytes.buffer)).toBe(bytesToBase64(bytes));
  });
});

describe('mimeForPath', () => {
  it('läser typen ur filändelsen', () => {
    expect(mimeForPath('u/k1/abc.webp')).toBe('image/webp');
    expect(mimeForPath('u/k1/abc.PNG')).toBe('image/png');
    expect(mimeForPath('u/k1/abc.jpg')).toBe('image/jpeg');
  });

  it('faller tillbaka på jpeg när ändelsen inte säger något', () => {
    expect(mimeForPath('u/k1/abc.bin')).toBe('image/jpeg');
    expect(mimeForPath('')).toBe('image/jpeg');
  });
});

describe('fetchImageAsDataUrl', () => {
  it('bygger en data-URL av bytes och serverns content-type', async () => {
    const bytes = [1, 2, 3, 4];
    const resultat = await fetchImageAsDataUrl('https://x/a', 'u/a.bin', async () =>
      svar(bytes, { type: 'image/webp' })
    );
    expect(resultat.bytes).toBe(4);
    expect(resultat.dataUrl).toBe(`data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`);
  });

  it('använder sökvägens ändelse när svaret saknar bildtyp', async () => {
    const resultat = await fetchImageAsDataUrl('https://x/a', 'u/a.png', async () =>
      svar([9], { type: 'application/octet-stream' })
    );
    expect(resultat.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('kastar på ett felsvar', async () => {
    await expect(
      fetchImageAsDataUrl('https://x/a', 'u/a.webp', async () => svar([1], { ok: false, status: 404 }))
    ).rejects.toThrow(/404/);
  });

  it('kastar på ett tomt svar i stället för att bädda in en tom bild', async () => {
    await expect(
      fetchImageAsDataUrl('https://x/a', 'u/a.webp', async () => svar([]))
    ).rejects.toThrow(/tom/i);
  });
});

describe('collectBackupImages', () => {
  it('hämtar hem varje bild och räknar bytes', async () => {
    const data = bibliotek(kort('k1', ['u/a.webp', 'u/b.webp']));
    const resultat = await collectBackupImages(data, {
      resolve: upplosare,
      fetch: async () => svar(nBytes(120)),
    });

    expect(resultat.total).toBe(2);
    expect(resultat.missing).toEqual([]);
    expect(resultat.bytes).toBe(240);
    expect(Object.keys(resultat.images)).toEqual(['u/a.webp', 'u/b.webp']);
    expect(resultat.images['u/a.webp'].startsWith('data:image/webp;base64,')).toBe(true);
  });

  it('hämtar en delad bild en enda gång', async () => {
    const hamta = vi.fn(async () => svar([1, 2, 3]));
    const data = bibliotek(kort('k1', ['u/delad.webp']), kort('k2', ['u/delad.webp']));
    const resultat = await collectBackupImages(data, { resolve: upplosare, fetch: hamta });

    expect(hamta).toHaveBeenCalledTimes(1);
    expect(resultat.total).toBe(1);
  });

  it('bokför en bild som inte gick att hämta i stället för att tappa den tyst', async () => {
    const data = bibliotek(kort('k1', ['u/a.webp', 'u/trasig.webp']));
    const resultat = await collectBackupImages(data, {
      resolve: upplosare,
      fetch: async (url) => {
        if (url.includes('trasig')) throw new Error('Nätverket svarar inte.');
        return svar([1, 2]);
      },
    });

    expect(Object.keys(resultat.images)).toEqual(['u/a.webp']);
    expect(resultat.missing).toEqual([
      { path: 'u/trasig.webp', reason: 'Nätverket svarar inte.' },
    ]);
  });

  it('bokför en sökväg som saknar adress', async () => {
    const data = bibliotek(kort('k1', ['u/a.webp', 'u/borttagen.webp']));
    const resultat = await collectBackupImages(data, {
      resolve: async (paths) =>
        new Map(paths.filter((p) => !p.includes('borttagen')).map((p) => [p, `https://x/${p}`])),
      fetch: async () => svar([1]),
    });

    expect(resultat.missing).toHaveLength(1);
    expect(resultat.missing[0].path).toBe('u/borttagen.webp');
    expect(resultat.missing[0].reason).toMatch(/offline|utloggad/i);
  });

  it('överlever att hela upplösningen faller — offline ger noll bilder, inget kast', async () => {
    const data = bibliotek(kort('k1', ['u/a.webp', 'u/b.webp']));
    const resultat = await collectBackupImages(data, {
      resolve: async () => {
        throw new Error('Failed to fetch');
      },
      fetch: async () => svar([1]),
    });

    expect(resultat.images).toEqual({});
    expect(resultat.missing).toHaveLength(2);
  });

  it('rapporterar framsteg hela vägen fram, även när bilder faller bort', async () => {
    const data = bibliotek(kort('k1', ['u/a.webp', 'u/b.webp', 'u/c.webp']));
    const framsteg = [];
    await collectBackupImages(data, {
      resolve: upplosare,
      fetch: async (url) => {
        if (url.includes('b.webp')) throw new Error('fel');
        return svar([1]);
      },
      onProgress: (p) => framsteg.push(p),
      samtidiga: 1,
    });

    expect(framsteg[0]).toEqual({ hanterade: 0, totalt: 3 });
    expect(framsteg.at(-1)).toEqual({ hanterade: 3, totalt: 3 });
  });

  it('hämtar flera bilder samtidigt utan att tappa någon', async () => {
    const sokvagar = Array.from({ length: 9 }, (_, i) => `u/bild-${i}.webp`);
    const data = bibliotek(kort('k1', sokvagar));
    let pagaende = 0;
    let hogsta = 0;
    const resultat = await collectBackupImages(data, {
      resolve: upplosare,
      fetch: async () => {
        pagaende += 1;
        hogsta = Math.max(hogsta, pagaende);
        await new Promise((r) => setTimeout(r, 1));
        pagaende -= 1;
        return svar([1]);
      },
      samtidiga: 3,
    });

    expect(Object.keys(resultat.images)).toHaveLength(9);
    expect(hogsta).toBeGreaterThan(1);
    expect(hogsta).toBeLessThanOrEqual(3);
  });

  it('gör ingenting när biblioteket saknar molnbilder', async () => {
    const hamta = vi.fn();
    const resultat = await collectBackupImages(bibliotek(kort('k1', ['data:image/png;base64,AA'])), {
      resolve: upplosare,
      fetch: hamta,
    });

    expect(hamta).not.toHaveBeenCalled();
    expect(resultat).toEqual({ images: {}, bytes: 0, total: 0, missing: [] });
  });
});

describe('inlineBackupImages', () => {
  it('byter sökvägar mot bilddata och lämnar befintliga data-URL:er ifred', () => {
    const redan = 'data:image/png;base64,AAAA';
    const data = bibliotek(kort('k1', ['u/a.webp', redan]));
    const resultat = inlineBackupImages(data, { 'u/a.webp': 'data:image/webp;base64,QUJD' });

    expect(resultat.ersatta).toBe(1);
    expect(resultat.kvar).toBe(0);
    expect(data.decks[0].cards[0].backImages).toEqual(['data:image/webp;base64,QUJD', redan]);
  });

  it('behåller sökvägen i det som lagts in, så att bytet går att backa', () => {
    const data = bibliotek(kort('k1', ['u/a.webp']));
    const { inlagda } = inlineBackupImages(data, { 'u/a.webp': 'data:image/webp;base64,QUJD' });

    expect(inlagda).toHaveLength(1);
    expect(inlagda[0].path).toBe('u/a.webp');
    expect(inlagda[0].index).toBe(0);
    expect(inlagda[0].card).toBe(data.decks[0].cards[0]);
  });

  it('räknar sökvägar utan bilddata i stället för att låtsas att de gick fram', () => {
    const data = bibliotek(kort('k1', ['u/a.webp', 'u/b.webp']));
    const resultat = inlineBackupImages(data, { 'u/a.webp': 'data:image/webp;base64,QUJD' });

    expect([resultat.ersatta, resultat.kvar]).toEqual([1, 1]);
    expect(data.decks[0].cards[0].backImages[1]).toBe('u/b.webp');
  });

  it('avvisar bilddata som inte är en data-URL', () => {
    const data = bibliotek(kort('k1', ['u/a.webp']));
    const resultat = inlineBackupImages(data, { 'u/a.webp': 'u/nagon-annan.webp' });
    expect([resultat.ersatta, resultat.kvar]).toEqual([0, 1]);
  });

  it('släpper inte in något som inte är en bild — filen kommer utifrån', () => {
    const data = bibliotek(kort('k1', ['u/a.webp']));
    const resultat = inlineBackupImages(data, {
      'u/a.webp': 'data:text/html;base64,PHNjcmlwdD4=',
    });

    expect([resultat.ersatta, resultat.kvar]).toEqual([0, 1]);
    expect(data.decks[0].cards[0].backImages[0]).toBe('u/a.webp');
  });

  it('bäddar bara in sådant som går rakt in i en img — det som hämtas är image/*', async () => {
    const hamtade = await collectBackupImages(bibliotek(kort('k1', ['u/a.bin'])), {
      resolve: upplosare,
      fetch: async () => svar([1, 2, 3], { type: 'text/html' }),
    });

    // Serverns typ används bara när den är en bildtyp; annars sökvägens ändelse.
    expect(hamtade.images['u/a.bin'].startsWith('data:image/')).toBe(true);
  });

  it('ger samma bild till båda korten när de delar sökväg', () => {
    const data = bibliotek(kort('k1', ['u/delad.webp']), kort('k2', ['u/delad.webp']));
    const resultat = inlineBackupImages(data, { 'u/delad.webp': 'data:image/webp;base64,QUJD' });

    expect([resultat.ersatta, resultat.kvar]).toEqual([2, 0]);
    expect(data.decks[0].cards[0].backImages[0]).toBe('data:image/webp;base64,QUJD');
    expect(data.decks[0].cards[1].backImages[0]).toBe('data:image/webp;base64,QUJD');
  });

  it('klarar ett bibliotek utan bilder och en fil utan bilddata', () => {
    expect(inlineBackupImages(undefined, undefined).inlagda).toEqual([]);
    expect(inlineBackupImages(bibliotek(kort('k1', undefined)), {}).inlagda).toEqual([]);
  });
});

describe('writeWithinQuota', () => {
  /** En lagring som rymmer ett visst antal tecken och kastar som webbläsaren. */
  const lagring = (tak) => {
    const store = { text: null, skrivningar: 0 };
    store.skriv = (text) => {
      store.skrivningar += 1;
      if (text.length > tak) {
        const err = new Error('quota');
        err.name = 'QuotaExceededError';
        throw err;
      }
      store.text = text;
    };
    return store;
  };

  const arKvotfel = (e) => Boolean(e) && (e.name === 'QuotaExceededError' || e.code === 22);

  /** Bibliotek med n bilder, den i:te 1000*(i+1) tecken stor. */
  const medBilder = (n) => {
    const data = bibliotek(
      ...Array.from({ length: n }, (_, i) => kort(`k${i}`, [`u/bild-${i}.webp`]))
    );
    const images = Object.fromEntries(
      Array.from({ length: n }, (_, i) => [
        `u/bild-${i}.webp`,
        `data:image/webp;base64,${'A'.repeat(1000 * (i + 1))}`,
      ])
    );
    return { data, ...inlineBackupImages(data, images) };
  };

  it('skriver allt i ett försök när det får plats', () => {
    const { data, inlagda } = medBilder(4);
    const store = lagring(1e9);
    const resultat = writeWithinQuota(inlagda, store.skriv, () => JSON.stringify(data), arKvotfel);

    expect(resultat).toEqual({ behallna: 4, utelamnade: 0 });
    expect(store.skrivningar).toBe(1);
    expect(collectCloudImagePaths(JSON.parse(store.text))).toEqual([]);
  });

  /** Storleken utan en enda inbäddad bild, mätt genom att backa och lägga tillbaka. */
  const utanBilder = (data, inlagda) => {
    inlagda.forEach((p) => { p.card.backImages[p.index] = p.path; });
    const langd = JSON.stringify(data).length;
    inlagda.forEach((p) => { p.card.backImages[p.index] = p.dataUrl; });
    return langd;
  };

  /** Flest bilder som ryms under taket, räknat rakt fram. */
  const optimalt = (data, inlagda, tak) => {
    const minst = [...inlagda].sort((a, b) => a.dataUrl.length - b.dataUrl.length);
    let basta = 0;
    for (let k = 0; k <= minst.length; k++) {
      minst.forEach((p, i) => { p.card.backImages[p.index] = i < k ? p.dataUrl : p.path; });
      if (JSON.stringify(data).length <= tak) basta = k;
    }
    minst.forEach((p) => { p.card.backImages[p.index] = p.dataUrl; });
    return basta;
  };

  it('behåller så många bilder som ryms i stället för att ge noll tillbaka', () => {
    const { data, inlagda } = medBilder(6);
    const tak = JSON.stringify(data).length - 6000;
    const bast = optimalt(data, inlagda, tak);
    const store = lagring(tak);
    const resultat = writeWithinQuota(inlagda, store.skriv, () => JSON.stringify(data), arKvotfel);

    // Inte bara "några" — det största antal som faktiskt ryms. Att släppa halva
    // högen per varv hade varit enklare och gett färre bilder tillbaka.
    expect(bast).toBeGreaterThan(1);
    expect(resultat.behallna).toBe(bast);
    expect(resultat.behallna + resultat.utelamnade).toBe(6);
    expect(store.text.length).toBeLessThanOrEqual(tak);
  });

  it('lämnar lagringen med exakt det antal bilder den rapporterar', () => {
    const { data, inlagda } = medBilder(8);
    const store = lagring(JSON.stringify(data).length - 20000);
    const resultat = writeWithinQuota(inlagda, store.skriv, () => JSON.stringify(data), arKvotfel);

    const sparad = JSON.parse(store.text);
    const kvarSomSokvag = collectCloudImagePaths(sparad).length;
    expect(kvarSomSokvag).toBe(resultat.utelamnade);
    expect(8 - kvarSomSokvag).toBe(resultat.behallna);
  });

  it('behåller de minsta bilderna — antalet kort som får sin bild tillbaka räknas', () => {
    const { data, inlagda } = medBilder(5);
    const store = lagring(JSON.stringify(data).length - 12000);
    writeWithinQuota(inlagda, store.skriv, () => JSON.stringify(data), arKvotfel);

    const sparad = JSON.parse(store.text);
    const aterstallda = sparad.decks[0].cards
      .map((c, i) => (c.backImages[0].startsWith('data:') ? i : null))
      .filter((i) => i !== null);
    // Korten är skapade i storleksordning, så de återställda ska vara de första.
    expect(aterstallda).toEqual(aterstallda.slice().sort((a, b) => a - b));
    expect(aterstallda[0]).toBe(0);
  });

  it('söker sig fram med få skrivningar', () => {
    const { data, inlagda } = medBilder(30);
    const store = lagring(JSON.stringify(data).length - 200000);
    writeWithinQuota(inlagda, store.skriv, () => JSON.stringify(data), arKvotfel);

    // En bild i taget hade blivit trettio skrivningar av hela biblioteket.
    expect(store.skrivningar).toBeLessThanOrEqual(8);
  });

  it('faller tillbaka på noll bilder när inte ens den minsta ryms', () => {
    const { data, inlagda } = medBilder(3);
    // Ryms utan bilder, men inte med den minsta på tusen tecken.
    const store = lagring(utanBilder(data, inlagda) + 500);
    const resultat = writeWithinQuota(inlagda, store.skriv, () => JSON.stringify(data), arKvotfel);

    expect(resultat).toEqual({ behallna: 0, utelamnade: 3 });
    expect(collectCloudImagePaths(JSON.parse(store.text))).toHaveLength(3);
  });

  it('kastar vidare när inte ens biblioteket utan bilder får plats', () => {
    const { data, inlagda } = medBilder(3);
    const store = lagring(10);
    expect(() =>
      writeWithinQuota(inlagda, store.skriv, () => JSON.stringify(data), arKvotfel)
    ).toThrow(/quota/);
  });

  it('kastar vidare fel som inte handlar om utrymme', () => {
    const { data, inlagda } = medBilder(2);
    const skriv = () => {
      throw new Error('SecurityError');
    };
    expect(() => writeWithinQuota(inlagda, skriv, () => JSON.stringify(data), arKvotfel)).toThrow(
      'SecurityError'
    );
  });
});

describe('export följt av import', () => {
  it('ger ett bibliotek som visar sina bilder utan nät och utan konto', async () => {
    const bytes = nBytes(64);
    const original = bibliotek(kort('k1', ['u/k1/a.webp']), kort('k2', ['u/k2/b.webp']));

    const hamtade = await collectBackupImages(original, {
      resolve: upplosare,
      fetch: async () => svar(bytes),
    });

    // Filen: sökvägarna orörda i appdatan, bilddatan bredvid. Det är den formen
    // en äldre importör fortfarande kan läsa.
    const fil = JSON.parse(
      JSON.stringify({ images: hamtade.images, data: { noji_clone_data: JSON.stringify(original) } })
    );
    expect(JSON.parse(fil.data.noji_clone_data).decks[0].cards[0].backImages[0]).toBe('u/k1/a.webp');

    const aterstalld = JSON.parse(fil.data.noji_clone_data);
    const resultat = inlineBackupImages(aterstalld, fil.images);

    expect([resultat.ersatta, resultat.kvar]).toEqual([2, 0]);
    for (const card of aterstalld.decks[0].cards) {
      expect(card.backImages[0].startsWith('data:image/webp;base64,')).toBe(true);
    }
    expect(collectCloudImagePaths(aterstalld)).toEqual([]);
  });

  it('växer med drygt 1,33 gånger bildernas storlek', async () => {
    // Base64 är fyra tecken per tre bytes (1,333) och därtill kommer sökvägen
    // som nyckel, citattecken och prefixet "data:image/webp;base64," — knappt
    // hundra tecken per bild, alltså försumbart mot bilden själv.
    const BILDBYTES = 200000;
    const data = bibliotek(kort('k1', ['user-1/kort-1/9f2a-4b.webp']));
    const hamtade = await collectBackupImages(data, {
      resolve: upplosare,
      fetch: async () => svar(nBytes(BILDBYTES, 3)),
    });

    const utan = JSON.stringify({ data: { noji_clone_data: JSON.stringify(data) } }, null, 2).length;
    const med = JSON.stringify(
      { images: hamtade.images, data: { noji_clone_data: JSON.stringify(data) } },
      null,
      2
    ).length;

    const kvot = (med - utan) / BILDBYTES;
    expect(kvot).toBeGreaterThan(1.33);
    expect(kvot).toBeLessThan(1.34);
  });
});

describe('formatBytes', () => {
  it('skriver storleken så att den går att läsa högt', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(12300)).toBe('12,3 kB');
    expect(formatBytes(2400000)).toBe('2,4 MB');
  });
});
