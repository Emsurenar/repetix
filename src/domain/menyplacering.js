// Var en radmeny ska fällas ut, och hur hög den får bli.
//
// Ren funktion utan DOM: den som anropar mäter, den här bestämmer.

/** Under det här går menyn inte att använda; hellre en rullande lista. */
const MINSTA_HOJD = 96;

/**
 * Väljer sida och höjd för en utfälld radmeny.
 *
 * Tre saker som den tidigare regeln inte klarade:
 *
 * 1. Den mätte mot hela fönstret. På en telefon är den yta man faktiskt ser
 *    lägre än så — webbläsarens egen list ligger över nederkanten — så en meny
 *    som "fick plats" ändå hamnade halvt bakom den. Måtten som skickas in ska
 *    komma från den synliga ytan, inte från fönstret.
 * 2. Den fällde bara upp när HELA menyn fick plats ovanför. Fick den inte plats
 *    på någondera sidan stod den kvar nedåt och kapades. Nu väljer den den
 *    rymligare sidan.
 * 3. Den lämnade ingen marginal, så en meny kunde sluta en pixel innanför
 *    kanten och ändå ligga bakom listen.
 *
 * `maxHojd` är null när menyn får plats som den är. Annars är den taket, och
 * menyn rullar internt — hellre en meny man rullar i än en avklippt knapp man
 * inte vet finns.
 *
 * @param {object} matt
 * @param {number} matt.knappTop  knappens överkant, i den synliga ytans koordinater
 * @param {number} matt.knappBottom knappens underkant
 * @param {number} matt.panelHojd menyns naturliga höjd
 * @param {number} matt.synligTop  synliga ytans överkant
 * @param {number} matt.synligBottom synliga ytans underkant
 * @param {number} [matt.luft] avstånd mellan knapp och meny, och mot kanten
 * @returns {{uppat: boolean, maxHojd: number|null}}
 */
export function valjMenyplacering({
    knappTop,
    knappBottom,
    panelHojd,
    synligTop,
    synligBottom,
    luft = 8,
}) {
    const platsNedan = synligBottom - knappBottom - luft * 2;
    const platsOvan = knappTop - synligTop - luft * 2;

    /* Nedåt är förstahandsvalet: menyn hänger under knappen man tryckte på, och
     * en meny som byter sida utan skäl flyttar sig under fingret. Uppåt bara
     * när den inte får plats nedanför OCH det är rymligare ovanför. */
    const uppat = panelHojd > platsNedan && platsOvan > platsNedan;
    const plats = uppat ? platsOvan : platsNedan;

    return {
        uppat,
        maxHojd: panelHojd > plats ? Math.max(Math.floor(plats), MINSTA_HOJD) : null,
    };
}
