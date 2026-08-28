// Genererar appens PNG-ikoner ur samma geometri som public/favicon.svg.
//
// Varför en generator i stället för färdiga binärfiler: en incheckad PNG som
// ingen vet hur den skapades går inte att ändra. Här är ikonen kod — ändra
// måtten och kör om.
//
// Ingen extern dependency. PNG skrivs för hand med Nodes inbyggda zlib, och
// kanterna slätas genom att rita i fyra gångers upplösning och räkna medelvärde.
//
//   node tools/generate-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HÄR = dirname(fileURLToPath(import.meta.url));
const UT = join(HÄR, '..', 'public');

const BAKGRUND = [0x0e, 0x6a, 0x5e]; // --accent
const FÖRGRUND = [0xfa, 0xf9, 0xf7]; // --surface-0

/** Ikonen ritas i ett 32x32-rutnät, samma som SVG:n. */
const RUTNÄT = 32;
const RADIE = 7;

/**
 * Staplarna: x, bredd, opacitet.
 *
 * Mellanrummen växer 2, 4, 7 — samma slags tillväxt som kortens intervall.
 * Marginalen är 4 på båda sidor, så märket står stadigt i sin ruta.
 */
const STAPLAR = [
  { x: 4, b: 3, a: 1 },
  { x: 9, b: 3, a: 1 },
  { x: 16, b: 3, a: 1 },
  { x: 25, b: 3, a: 0.4 },
];
const STAPEL_Y = 9;
const STAPEL_H = 14;
const STAPEL_R = 1.5;

/**
 * Ligger punkten inuti en rektangel med rundade hörn?
 *
 * Standardformeln för avstånd till en rundad rektangel. Ett första försök som
 * jämförde mot närmaste hörnpunkt gav raka hörn — det testet är bara riktigt
 * i hörnkvadranterna, inte längs kanterna.
 */
function iRundadRuta(x, y, rx, ry, bredd, höjd, radie) {
  const dx = Math.abs(x - (rx + bredd / 2)) - (bredd / 2 - radie);
  const dy = Math.abs(y - (ry + höjd / 2)) - (höjd / 2 - radie);
  const utanför = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inuti = Math.min(Math.max(dx, dy), 0);
  return utanför + inuti - radie <= 0;
}

/** Färgen i en punkt, uttryckt i rutnätets koordinater. */
function färgVid(x, y) {
  if (!iRundadRuta(x, y, 0, 0, RUTNÄT, RUTNÄT, RADIE)) return null; // genomskinligt
  for (const s of STAPLAR) {
    if (iRundadRuta(x, y, s.x, STAPEL_Y, s.b, STAPEL_H, STAPEL_R)) {
      return [
        Math.round(BAKGRUND[0] + (FÖRGRUND[0] - BAKGRUND[0]) * s.a),
        Math.round(BAKGRUND[1] + (FÖRGRUND[1] - BAKGRUND[1]) * s.a),
        Math.round(BAKGRUND[2] + (FÖRGRUND[2] - BAKGRUND[2]) * s.a),
      ];
    }
  }
  return BAKGRUND;
}

/** Ritar ikonen i angiven storlek, fyrfaldigt översamplad. */
function rita(storlek) {
  const ÖS = 4;
  const px = Buffer.alloc(storlek * storlek * 4);

  for (let y = 0; y < storlek; y++) {
    for (let x = 0; x < storlek; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ÖS; sy++) {
        for (let sx = 0; sx < ÖS; sx++) {
          const gx = ((x + (sx + 0.5) / ÖS) / storlek) * RUTNÄT;
          const gy = ((y + (sy + 0.5) / ÖS) / storlek) * RUTNÄT;
          const f = färgVid(gx, gy);
          if (f) {
            r += f[0];
            g += f[1];
            b += f[2];
            a += 255;
          }
        }
      }
      const n = ÖS * ÖS;
      const i = (y * storlek + x) * 4;
      // Färgen medelvärdesbildas bara över de delprov som faktiskt träffade
      // ikonen, annars drar de genomskinliga proven färgen mot svart i kanten.
      const träffar = a / 255 || 1;
      px[i] = Math.round(r / träffar);
      px[i + 1] = Math.round(g / träffar);
      px[i + 2] = Math.round(b / träffar);
      px[i + 3] = Math.round(a / n);
    }
  }
  return px;
}

/** Minimal PNG-skrivare: signatur, IHDR, IDAT, IEND. */
function tillPng(px, storlek) {
  const rader = Buffer.alloc((storlek * 4 + 1) * storlek);
  for (let y = 0; y < storlek; y++) {
    // Filtertyp 0: ingen filtrering. Bilden är liten, zlib klarar sig ändå.
    rader[y * (storlek * 4 + 1)] = 0;
    px.copy(rader, y * (storlek * 4 + 1) + 1, y * storlek * 4, (y + 1) * storlek * 4);
  }

  const bit = (typ, data) => {
    const längd = Buffer.alloc(4);
    längd.writeUInt32BE(data.length);
    const kropp = Buffer.concat([Buffer.from(typ, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(kropp) >>> 0);
    return Buffer.concat([längd, kropp, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(storlek, 0);
  ihdr.writeUInt32BE(storlek, 4);
  ihdr[8] = 8; // bitdjup
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bit('IHDR', ihdr),
    bit('IDAT', deflateSync(rader, { level: 9 })),
    bit('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABELL = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABELL[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

mkdirSync(UT, { recursive: true });

// 180 för iOS hemskärm, 192 och 512 för webbmanifestet.
for (const [namn, storlek] of [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]) {
  const fil = join(UT, namn);
  writeFileSync(fil, tillPng(rita(storlek), storlek));
  console.log(`${namn} (${storlek}x${storlek})`);
}
