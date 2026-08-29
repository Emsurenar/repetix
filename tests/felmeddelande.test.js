// @vitest-environment jsdom
//
// settings.js importgraf når src/ui/dom.js, som läser document vid
// inläsning. Testet rör inget DOM självt — jsdom finns här bara för att
// modulen ska gå att importera alls.

import { describe, expect, it } from 'vitest';

import { felmeddelande } from '../src/ui/settings.js';

/* Felmeddelandet som når användaren är det enda spåret som finns.
 *
 * Serverfunktionerna loggar med flit ingenting — en logg är det enklaste
 * sättet att av misstag skriva ut en användares API-nyckel. Följden är att om
 * klienten kastar bort serverns beskrivning så är felet borta för alltid, och
 * det var precis vad som hände: "Leverantören svarade med ett fel" visades
 * likadant vare sig krediterna tagit slut, leverantören låg nere eller vi
 * ringde fel adress.
 */
describe('felmeddelande', () => {
  it('behåller statuskoden ur serverns beskrivning', () => {
    const text = felmeddelande(
      'provider_error',
      'Leverantören svarade med fel (429) när nyckeln skulle kontrolleras.'
    );
    expect(text).toContain('429');
  });

  it('lägger uppmaningen sist, efter vad som hände', () => {
    const text = felmeddelande('provider_error', 'Ingen kontakt med leverantören.');
    expect(text).toBe('Ingen kontakt med leverantören. Prova igen om en liten stund.');
  });

  it('faller tillbaka på en hel mening när servern inte sa något', () => {
    expect(felmeddelande('provider_error', undefined)).toBe(
      'Leverantören svarade med ett fel. Prova igen om en liten stund.'
    );
  });

  /* Tom sträng är inte nullish. Med ?? hade den passerat som ett giltigt
   * meddelande och användaren fått en ruta utan text i. */
  it('behandlar tom servertext som ingen text', () => {
    expect(felmeddelande('provider_error', '   ')).toBe(
      'Leverantören svarade med ett fel. Prova igen om en liten stund.'
    );
    expect(felmeddelande('okänd_kod', '')).toBe('Något gick fel på servern.');
  });

  /* Koder där klienten vet mer än servern ska inte få serverns text påklistrad:
   * "din inloggning har gått ut" är mer användbart än "unauthorized". */
  it('låter klientens text gälla för koder utan serverspecifik detalj', () => {
    expect(felmeddelande('unauthorized', 'Din session gäller inte längre.')).toBe(
      'Din inloggning har gått ut. Logga in igen och försök på nytt.'
    );
  });
});
