/* Hur lång tid en hög kort tar.
 *
 * Det som stoppar en från att börja är sällan att det är mycket — det är att
 * man inte vet hur mycket. "Fjorton kort" är ett tal man måste översätta
 * själv; "ungefär två minuter" är ett besked man kan ta ställning till stående
 * i en kö.
 *
 * Siffran är medvetet trubbig. Den ska vara ärlig nog att lita på och vag nog
 * att inte vara ett löfte: därför "ungefär", därför avrundning uppåt till hela
 * minuter, och därför inget alls när högen är så liten att svaret ändå är
 * "nu".
 */

/** Sekunder per kort. Ett moget kort besvaras på ett andetag; ett nytt tar
 *  längre tid. Åtta sekunder är snittet över ett helt pass. */
const SEKUNDER_PER_KORT = 8;

/** Under den här gränsen är tiden inte värd att nämna. */
const MINSTA_ANTAL = 5;

/**
 * @param {number} antal kort som ska repeteras
 * @returns {string} t.ex. "ungefär 2 minuter", eller '' när det inte är värt
 *   att säga något
 */
export const uppskattadTid = (antal) => {
    if (!Number.isFinite(antal) || antal < MINSTA_ANTAL) return '';

    const minuter = Math.round((antal * SEKUNDER_PER_KORT) / 60);
    if (minuter <= 1) return 'ungefär en minut';
    if (minuter < 60) return `ungefär ${minuter} minuter`;

    const timmar = Math.round(minuter / 30) / 2;
    // Halvtimmar skrivs ut som "en och en halv" i stället för "1,5" — det är
    // en uppskattning, inte ett mätvärde.
    if (timmar === 1) return 'ungefär en timme';
    if (timmar === 1.5) return 'ungefär en och en halv timme';
    return `ungefär ${Number.isInteger(timmar) ? timmar : timmar.toString().replace('.', ',')} timmar`;
};
