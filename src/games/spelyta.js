/* Spelytans in- och utgång.
 *
 * Alla åtta lägen bygger samma helskärmsöverlägg och tog tidigare bort det med
 * ett `overlay.remove()`. Det blev ett hårt klipp: en hel yta försvann mellan
 * två bildrutor och biblioteket stod plötsligt där. Den här modulen äger
 * utgången i stället, så att den ser likadan ut i alla lägen och bara behöver
 * ändras på ett ställe.
 */

/* Lägena la tidigare in överlägget och satte .active i en requestAnimationFrame.
 * Det räcker inte: så länge webbläsaren aldrig hunnit räkna ut utgångsläget
 * slås de två stilarna ihop till en enda, och övergången hoppas över helt.
 * Ytan slogs alltså på i ett hugg trots att regeln fanns. En framtvingad
 * layoutläsning emellan gör utgångsläget verkligt, och först då finns det
 * något att tona ifrån.
 */
export const oppnaSpelyta = (overlay) => {
    document.body.appendChild(overlay);
    void overlay.offsetWidth;
    overlay.classList.add('active');
};

/* Anropet efter att ytan börjat lämna, inte efter att den är borta: vyn bakom
 * ska redan vara den man är på väg till när överlägget tonar bort. Görs det i
 * omvänd ordning ser man i en fjärdedels sekund vyn man kom ifrån.
 */
export const stangSpelyta = (overlay, efterat) => {
    if (!overlay || overlay.dataset.stangs) return;
    overlay.dataset.stangs = '1';

    /* Id:t släpps direkt. Lägena frågar efter #cinema-overlay för att veta om
     * de fortfarande spelar, och ett nytt läge kan startas medan det gamla
     * ännu tonar — två element med samma id hade gjort den frågan omöjlig. */
    overlay.removeAttribute('id');
    overlay.classList.add('is-leaving');

    /* Varaktigheten läses ur den beräknade stilen i stället för att upprepas
     * här: den kommer ur rörelsetokens, och den som bett om mindre rörelse har
     * noll där. transitionend duger inte — en övergång på noll millisekunder
     * skickar aldrig något event. */
    const varaktighet = parseFloat(getComputedStyle(overlay).transitionDuration) * 1000 || 0;
    setTimeout(() => overlay.remove(), varaktighet);

    if (typeof efterat === 'function') efterat();
};
