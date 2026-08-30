/* Inläsningen av en PDF.
 *
 * Två steg med flit: extraktionen är gratis och tar en sekund, och att se att
 * texten blev läsbar innan man betalar för ett AI-anrop spelar roll just här —
 * LaTeX-matematik kommer ut trasig, och fyrtio kort byggda på grus är dyrare
 * att rensa bort än att aldrig ha beställt.
 */

import { S } from '../../core/state.js';
import { laesPdf } from '../../core/pdf.js';
import { sparaKalla } from '../../core/sources.js';
import { TECKENTAK, overTaket } from '../../domain/kalltext.js';
import { renderaKallor } from '../deck.js';
import { showToast } from '../toast.js';

export function initUiWiringKalla() {
    const knapp = document.getElementById('btn-lagg-till-kalla');
    const falt = document.getElementById('input-kalla-fil');
    if (!knapp || !falt) return;

    knapp.addEventListener('click', () => falt.click());

    falt.addEventListener('change', async () => {
        const fil = falt.files?.[0];
        // Fältet nollställs direkt: väljs samma fil igen utlöses annars ingen
        // change-händelse, och knappen ser trasig ut.
        falt.value = '';
        if (!fil) return;

        knapp.disabled = true;
        knapp.textContent = 'Läser...';

        try {
            const { text, pages, chars } = await laesPdf(fil);

            if (!text) {
                showToast('Ingen text gick att läsa ur PDF:en. Är den inskannad?');
                return;
            }
            if (overTaket(text)) {
                showToast(
                    `Texten är ${chars.toLocaleString('sv-SE')} tecken. Taket är ${TECKENTAK.toLocaleString('sv-SE')}.`
                );
                return;
            }

            const res = await sparaKalla({
                deckId: S.currentDeckId,
                title: fil.name.replace(/\.pdf$/i, ''),
                text,
                pages,
            });

            if (!res.ok) return showToast(res.error);
            showToast(`${pages} sidor inlästa.`);
            void renderaKallor(S.currentDeckId);
        } catch {
            showToast('Kunde inte läsa PDF:en.');
        } finally {
            knapp.disabled = false;
            knapp.textContent = 'Lägg till PDF';
        }
    });
}
