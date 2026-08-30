import { describe, expect, it } from 'vitest';

import { washStyle, washUrl } from '../src/ui/wash.js';

/* Sökvägen måste vara absolut, och det syns bara i produktion.
 *
 * En relativ url() inuti en CSS-variabel löses mot basadressen för den
 * STILMALL som använder var(), inte mot dokumentet. Vite serverar stilarna
 * inbakade i sidan under utveckling — bas '/' — men bygget lägger dem i en
 * fil under /assets/. Samma rad blev därför /wash/w13.jpg lokalt och
 * /assets/wash/w13.jpg i produktion, där den gav 404 och en helsvart panel.
 */
describe('washUrl', () => {
  it('ger en absolut sökväg', () => {
    expect(washUrl('d1')).toMatch(/^\/wash\/w\d{2}\.jpg$/);
  });

  it('ger en absolut sökväg för varje tänkbart id', () => {
    for (const id of ['d1', '17880358867036zx3i', '78be2ee0-f38f-4123-aea3-c282d00d4510', 'å']) {
      expect(washUrl(id), id).toMatch(/^\/wash\/w\d{2}\.jpg$/);
    }
  });

  /* Samma sak i strängformen. Den finns för spelhallens brickor, som bygger
   * sina element ur en mall — glöms den bort är felet tillbaka just där. */
  it('ger en absolut sökväg även i strängformen', () => {
    expect(washStyle('d1')).toContain("url('/wash/");
  });

  it('ger ingenting utan id', () => {
    expect(washUrl(null)).toBeNull();
    expect(washUrl('')).toBeNull();
    expect(washStyle(null)).toBe('');
  });

  /* Samma kortlek ska alltid få samma bild: bakgrunden är en identitet, inte
   * ett infall. */
  it('ger samma bild för samma kortlek varje gång', () => {
    expect(washUrl('d1')).toBe(washUrl('d1'));
    expect(washUrl('abc')).toBe(washUrl('abc'));
  });

  it('håller sig inom de trettio bilder som finns', () => {
    const sedda = new Set();
    for (let i = 0; i < 500; i++) sedda.add(washUrl(`deck-${i}`));
    for (const url of sedda) {
      const nummer = Number(url.match(/w(\d{2})\.jpg$/)[1]);
      expect(nummer).toBeGreaterThanOrEqual(1);
      expect(nummer).toBeLessThanOrEqual(30);
    }
  });
});
