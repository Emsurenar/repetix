import { S } from '../core/state.js';
import { RATING, previewInterval, withScheduleDefaults } from '../domain/srs.js';
import { loadRecords, saveRecords, updatePersonalRecords } from '../domain/stats.js';
import { renderCardBackImages, safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { finishPlaygroundSession } from '../ui/playground.js';
import { processRating } from '../ui/study.js';
import { oppnaSpelyta, stangSpelyta } from './spelyta.js';

/* Dammiga kort — de tjugo kort som legat orörda längst.
 *
 * Lägets hela dramaturgi ligger i ÅLDERN. Inget annat läge vet hur länge ett
 * kort fått ligga, och det är den enda siffra som kan göra en repetition till
 * ett fynd. Därför är åldern rubrik i stället för fotnot, dammet ligger som en
 * yta på själva frågan, och passets utbyte räknas i tid man väckt — inte i
 * antal rätt. Ett läge som bara räknar rätt har alla åtta lägen redan.
 *
 * Tre saker ska skapa sug:
 *
 *   Högen är fysisk. Den krymper med ett ark per kort och VÄGRAR krympa när
 *   man svarar Igen: kortet läggs tillbaka längst bak och ett nytt ark reser
 *   sig i högen medan det man just lämnade glider av. Man ser sitt eget
 *   omtag som ett ark, inte som en siffra.
 *
 *   Skörden växer. "Väckt" tickar upp med kortets ålder efter varje fynd och
 *   står kvar hela passet. Talet blir aldrig mindre, vilket är hela poängen
 *   med en räknare man vill se växa.
 *
 *   Slutbilden mäter mot en själv. Väckt tid ställs mot personligt rekord i
 *   en stapel, lagren man grävt genom ritas som en borrkärna, och "Gräv
 *   vidare" tar nästa lager direkt — nästa pass är alltid ett tryck bort.
 */

const DYGN = 24 * 60 * 60 * 1000;
const MANAD_DYGN = 30.44;

/* Hur många ark högen ritar som mest. Kortleken är tjugo, men varje Igen
 * lägger tillbaka ett kort, så antalet kan växa. Bortom tjugofyra ark säger
 * bilden ändå bara "mycket kvar", och talet bredvid bär sanningen. */
const MAX_ARK = 24;

/* Kort får inte klickas bort direkt efter att svaret tagits fram: mittpunkten
 * på "Blås bort dammet" hamnar nära betygsraden som ersätter den, och ett
 * betyg går inte att ta tillbaka. Fönstret ska fånga studsen från samma tryck,
 * inte hindra någon som bestämt sig. Tangenterna 1–4 passerar det helt. */
const KLICKSPARR_MS = 350;

/* Dammets fem steg. Ordet är belöningen i sig — man vill hitta en fossil, och
 * man vet direkt om kortet man tittar på är ett sådant fynd. */
const DAMMSTEGEN = [
    { fran: 0, namn: 'Nyss rörd' },
    { fran: 7, namn: 'Tunn hinna' },
    { fran: 30, namn: 'Dammigt' },
    { fran: 90, namn: 'Bortglömt' },
    { fran: 365, namn: 'Fossil' },
];

const dammniva = (dagar) => {
    let n = 0;
    for (let i = 0; i < DAMMSTEGEN.length; i++) if (dagar >= DAMMSTEGEN[i].fran) n = i;
    return n;
};

/* Tid skriven som man säger den. Ett kort som legat i 847 dagar säger ingen
 * något; "2 år 4 mån" är ett fynd. */
const formateraSpann = (dagar) => {
    const d = Math.max(0, Math.round(dagar));
    if (d === 1) return '1 dag';
    if (d < 30) return `${d} dagar`;
    if (d < 365) {
        const manader = Math.max(1, Math.round(d / MANAD_DYGN));
        return manader === 1 ? '1 månad' : `${manader} månader`;
    }
    let ar = Math.floor(d / 365);
    let man = Math.round((d - ar * 365) / MANAD_DYGN);
    if (man >= 12) {
        ar += 1;
        man = 0;
    }
    return man === 0 ? `${ar} år` : `${ar} år ${man} mån`;
};

const dygnText = (dagar) => (dagar < 1 ? '< 1d' : `${Math.round(dagar)}d`);

/* Rekorden ligger under en egen nyckel i pg_records. Objektet läses om vid
 * varje skrivning: betygsättningen skriver dagsräkningar till samma post, och
 * en gammal kopia hade raderat dem. */
const REKORD = 'dammiga';

const lasRekord = () => {
    const r = loadRecords()[REKORD] || {};
    return {
        vacktDagar: r.vacktDagar || 0,
        aldstaDagar: r.aldstaDagar || 0,
        svep: r.svep || 0,
    };
};

const skrivRekord = (passet) => {
    const bok = loadRecords();
    const forra = bok[REKORD] || {};
    bok[REKORD] = {
        vacktDagar: Math.max(forra.vacktDagar || 0, passet.vacktDagar),
        aldstaDagar: Math.max(forra.aldstaDagar || 0, passet.aldstaDagar),
        svep: Math.max(forra.svep || 0, passet.svep),
    };
    saveRecords(bok);
};

export const dammigaReveal = () => {
    const korten = S.currentStudyCards;
    const nu = Date.now();

    /* Åldern fryses vid start. processRating skriver lastReviewed till nu, så
     * ett kort som kommer tillbaka efter Igen hade annars sagt "0 dagar" mitt
     * i passet — och då finns lägets enda dramaturgi inte längre. */
    const alder = new Map();
    korten.forEach((k) => {
        if (alder.has(k.id)) return;
        const skapad = parseInt(k.id, 10);
        const fodd = Number.isFinite(skapad) ? Math.min(skapad, nu) : nu;
        const sist = k.lastReviewed || fodd;
        alder.set(k.id, {
            dagar: Math.max(0, Math.floor((nu - sist) / DYGN)),
            aldrig: !k.lastReviewed,
        });
    });

    const alla = [...alder.values()];
    const totaltDamm = alla.reduce((s, f) => s + f.dagar, 0);
    const aldstaIPasset = alla.reduce((m, f) => Math.max(m, f.dagar), 0);
    const rekordVidStart = lasRekord();

    let kortIdx = 0;
    let vackt = 0;
    /* Passet kan bara ta slut när varje kort är avdammat — Igen lägger tillbaka
     * kortet. "Klarade" hade därför alltid stått på tjugo av tjugo. Det som
     * går att misslyckas med är att klara kortet på FÖRSTA försöket. */
    let direkt = 0;
    let omtag = 0;
    let svep = 0;
    let bastaSvep = 0;
    let aldstaVackt = 0;
    let fas = 'start';
    let vandesVid = 0;

    const sedda = new Set();
    const lagren = [];
    const lagerPlats = new Map();
    const klockor = new Set();

    /* Kortets egna funktioner byts ut för varje kort. Tangentbordet får aldrig
     * ha en egen lyssnare per kort: den gamla versionen la på en ny vid varje
     * vändning och tog bara bort den om man betygsatte med tangent. Klickade
     * man i stället låg den kvar och betygsatte NÄSTA kort i samma tryck. */
    let vandFn = null;
    let betygFn = null;
    let slutFn = null;

    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    overlay.className = 'cinema-overlay';
    overlay.innerHTML = `
        <div class="arena dm">
            <div class="arena-top">
                <span class="micro">Dammiga kort</span>
                <span id="dm-svep" class="dm-svep num">svep 0</span>
            </div>
            <div class="dm-vagskal">
                <div class="dm-hog-rad">
                    <div id="dm-hog" class="dm-hog" aria-hidden="true"></div>
                    <span id="dm-kvar" class="dm-kvar num">${korten.length} kvar</span>
                </div>
                <p class="dm-skord">
                    <span class="micro">Väckt</span>
                    <span id="dm-vackt" class="dm-skord-n num">0 dagar</span>
                </p>
            </div>
            <div id="dm-scen" class="dm-scen"></div>
        </div>
    `;

    oppnaSpelyta(overlay);

    const vanta = (fn, ms) => {
        const id = setTimeout(() => {
            klockor.delete(id);
            fn();
        }, ms);
        klockor.add(id);
    };

    const rensa = () => {
        document.removeEventListener('keydown', tangent);
        klockor.forEach(clearTimeout);
        klockor.clear();
    };

    const stang = () => {
        rensa();
        /* Slutbilden i arenan ÄR passets resultat: den jämför mot rekord och
         * erbjuder nästa pass. Den generella resultatvyn hade sagt samma sak
         * en gång till, tystare. */
        stangSpelyta(overlay, () => finishPlaygroundSession(true));
    };

    // ---- Högen ---------------------------------------------------------
    //
    // Ett ark per kort som är kvar, det främsta mörkt. Arken flyttar sig med
    // transform och inte med layout, så att en hög på tjugofyra ark kan lägga
    // om sig i en enda bildruta.

    const hogEl = overlay.querySelector('#dm-hog');
    const arken = [];

    hogEl.style.setProperty('--djup', String(MAX_ARK - 1));

    const markeraFramst = () => {
        arken.forEach((ark, i) => ark.classList.toggle('is-framst', i === 0));
    };

    const indexera = () => {
        arken.forEach((ark, i) => ark.style.setProperty('--i', String(i)));
    };

    /* Ett nytt ark läggs djupast och tonar in. Klassen tas bort först efter en
     * framtvingad layoutläsning: sätts båda tillstånden i samma bildruta slås
     * de ihop till ett, och övergången hoppas över. */
    const laggTillArk = () => {
        if (arken.length >= MAX_ARK) return;
        const ark = document.createElement('i');
        ark.className = 'dm-ark is-ny';
        ark.style.setProperty('--i', String(arken.length));
        hogEl.insertBefore(ark, hogEl.firstChild);
        arken.push(ark);
        void ark.offsetWidth;
        ark.classList.remove('is-ny');
    };

    const taBortFramst = () => {
        const ark = arken.shift();
        if (!ark) return;
        ark.classList.remove('is-framst');
        ark.classList.add('is-av');
        /* Varaktigheten läses ur beräknad stil i stället för att upprepas här:
         * den kommer ur rörelsetokens, och den som bett om mindre rörelse har
         * noll där. */
        const varaktighet = parseFloat(getComputedStyle(ark).transitionDuration) * 1000 || 0;
        vanta(() => ark.remove(), varaktighet);
        indexera();
        markeraFramst();
    };

    /* Högen ska alltid visa lika många ark som det finns kort kvar. Igen lägger
     * tillbaka ett kort utan att antalet ändras — arket som glider av ersätts
     * av ett nytt längst bak, och högen står stilla. Det är hela poängen. */
    const synkaHog = () => {
        const mal = Math.min(Math.max(0, korten.length - kortIdx), MAX_ARK);
        while (arken.length < mal) laggTillArk();
        while (arken.length > mal) taBortFramst();
    };

    const byggHog = () => {
        const antal = Math.min(korten.length, MAX_ARK);
        // Djupast först i markupen, så att det främsta arket ritas överst.
        for (let i = antal - 1; i >= 0; i--) {
            const ark = document.createElement('i');
            ark.className = 'dm-ark';
            ark.style.setProperty('--i', String(i));
            hogEl.appendChild(ark);
            arken[i] = ark;
        }
        markeraFramst();
    };

    // ---- Slisten -------------------------------------------------------

    /* En animation startar inte om av att klassen läggs tillbaka. Ta bort, läs
     * offsetWidth, lägg på. */
    const blinka = (el) => {
        if (!el) return;
        el.classList.remove('is-updated');
        void el.offsetWidth;
        el.classList.add('is-updated');
    };

    const uppdateraSlist = ({ skorden = false } = {}) => {
        const kvarEl = overlay.querySelector('#dm-kvar');
        if (kvarEl) kvarEl.textContent = `${Math.max(0, korten.length - kortIdx)} kvar`;

        const vacktEl = overlay.querySelector('#dm-vackt');
        if (vacktEl) {
            vacktEl.textContent = formateraSpann(vackt);
            if (skorden) blinka(vacktEl);
        }

        const svepEl = overlay.querySelector('#dm-svep');
        if (svepEl) {
            svepEl.textContent = `svep ${svep}`;
            svepEl.classList.toggle('is-on', svep >= 2);
        }
    };

    const scen = (html) => {
        const el = overlay.querySelector('#dm-scen');
        el.innerHTML = html;
        return el;
    };

    // ---- Ingången ------------------------------------------------------
    //
    // Insatsen sägs innan man börjar. "Sex år och fyra månaders damm" är ett
    // löfte, och ett pass utan löfte är bara en lista kort.

    const visaStart = () => {
        fas = 'start';
        vandFn = null;
        betygFn = null;
        scen(`
            <div class="dm-akt dm-start">
                <p class="micro">Högen</p>
                <p class="dm-hero num">${formateraSpann(totaltDamm)}</p>
                <p class="dm-hero-l">samlat damm i ${korten.length} kort · äldst ${formateraSpann(aldstaIPasset)}</p>
                <div class="arena-foot arena-foot--center">
                    <button id="dm-borja" type="button" class="btn primary lg">Börja gräva <span class="kbd">Space</span></button>
                </div>
            </div>
        `);
        overlay.querySelector('#dm-borja').addEventListener('click', () => visaKort());
    };

    // ---- Kortet --------------------------------------------------------

    const visaKort = () => {
        if (kortIdx >= korten.length) {
            visaSlut();
            return;
        }

        fas = 'fraga';
        const kortet = korten[kortIdx];
        const fynd = alder.get(kortet.id) || { dagar: 0, aldrig: false };
        const niva = dammniva(fynd.dagar);
        const aterkomst = sedda.has(kortet.id);

        if (!aterkomst) {
            sedda.add(kortet.id);
            lagerPlats.set(kortet.id, lagren.length);
            lagren.push({ dagar: fynd.dagar, rent: false });
        }

        /* Djupare än något man grävt fram förut. Korten kommer äldst först, så
         * flaggan kan bara falla på passets första kort — och det är precis
         * där ett fynd gör mest nytta. */
        const rekordfynd = !aterkomst && fynd.dagar > rekordVidStart.aldstaDagar && fynd.dagar > 0;

        scen(`
            <div class="dm-akt">
                <div class="dm-alder">
                    <p class="micro">${fynd.aldrig ? 'Aldrig repeterat' : 'Orört i'}</p>
                    <div class="dm-alder-rad">
                        <span class="dm-alder-n num">${formateraSpann(fynd.dagar)}</span>
                        <span class="dm-niva" data-niva="${niva}">${DAMMSTEGEN[niva].namn}</span>
                        ${rekordfynd ? '<span class="dm-flagga">Djupaste fyndet hittills</span>' : ''}
                        ${aterkomst ? '<span class="dm-flagga is-tyst">Tillbaka ur högen</span>' : ''}
                    </div>
                </div>
                <div id="dm-fraga" class="arena-question dm-fraga" data-niva="${niva}">
                    <span class="dm-yta">${safeParse(kortet.front)}</span>
                </div>
                <div class="arena-foot arena-foot--center">
                    <button id="dm-blas" type="button" class="btn primary lg">Blås bort dammet <span class="kbd">Space</span></button>
                </div>
            </div>
        `);
        renderLatex(overlay.querySelector('#dm-fraga'));

        const blasBort = () => {
            if (fas !== 'fraga') return;
            fas = 'svar';
            vandFn = null;
            vandesVid = performance.now();

            const akt = overlay.querySelector('.dm-akt');
            const fragaEl = overlay.querySelector('#dm-fraga');
            fragaEl.classList.add('is-ren');
            akt.querySelector('.arena-foot')?.remove();

            /* Nivåmärket byter ord i stället för att försvinna. Att "Fossil"
             * blir "Uppgrävt" på samma pixlar är belöningen för vändningen —
             * en yta som ändrar tillstånd, inte en ny ruta som dyker upp. */
            const nivaEl = akt.querySelector('.dm-niva');
            if (nivaEl) {
                nivaEl.textContent = 'Uppgrävt';
                nivaEl.dataset.niva = 'ren';
            }

            const svarEl = document.createElement('div');
            svarEl.className = 'arena-reveal dm-svar';
            svarEl.innerHTML = `
                <p class="micro">Svar</p>
                <div id="dm-svar-text" class="arena-answer">${safeParse(kortet.back)}</div>
                ${kortet.description ? `<div id="dm-djup" class="dm-djup">${safeParse(kortet.description)}</div>` : ''}
            `;
            akt.appendChild(svarEl);

            const textEl = svarEl.querySelector('#dm-svar-text');
            renderLatex(textEl);
            renderCardBackImages(textEl, kortet.backImages);
            const djupEl = svarEl.querySelector('#dm-djup');
            if (djupEl) renderLatex(djupEl);

            /* Betygsknapparna klonades tidigare ur repetitionsvyn. Klonen tog
             * med sig fyra id:n som redan fanns i dokumentet, och intervallen
             * i den visade det FÖRRA kortets tider. De byggs här i stället,
             * ur samma funktion som faktiskt schemalägger. */
            const grund = withScheduleDefaults(kortet);
            const betygEl = document.createElement('div');
            betygEl.className = 'dm-betyg';
            betygEl.innerHTML = `
                <button type="button" class="btn-rate rating-1" data-rating="1" aria-label="Igen — kortet läggs tillbaka i högen">Igen<small>i högen</small></button>
                <button type="button" class="btn-rate rating-2" data-rating="2" aria-label="Svårt — kortet sover ${dygnText(previewInterval(grund, RATING.HARD))}">Svårt<small>sover ${dygnText(previewInterval(grund, RATING.HARD))}</small></button>
                <button type="button" class="btn-rate rating-3" data-rating="3" aria-label="Bra — kortet sover ${dygnText(previewInterval(grund, RATING.GOOD))}">Bra<small>sover ${dygnText(previewInterval(grund, RATING.GOOD))}</small></button>
                <button type="button" class="btn-rate rating-4" data-rating="4" aria-label="Lätt — kortet sover ${dygnText(previewInterval(grund, RATING.EASY))}">Lätt<small>sover ${dygnText(previewInterval(grund, RATING.EASY))}</small></button>
            `;
            betygEl.querySelectorAll('.btn-rate').forEach((knapp) => {
                knapp.addEventListener('click', (e) => {
                    e.stopPropagation();
                    satt(parseInt(knapp.dataset.rating, 10), false);
                });
            });
            akt.appendChild(betygEl);
        };

        const satt = (betyg, franTangent) => {
            if (fas !== 'svar') return;
            if (!franTangent && performance.now() - vandesVid < KLICKSPARR_MS) return;
            fas = 'mellan';
            vandFn = null;
            betygFn = null;

            S.currentStudyIndex = kortIdx;
            /* processRating räknar sessionsstatistiken själv när passet är ett
             * spelläge, och lägger tillbaka kortet sist i högen vid Igen. Den
             * gamla versionen räknade en gång till här: varje kort bokfördes
             * dubbelt i resultatet. */
            processRating(betyg);

            if (betyg === RATING.AGAIN) {
                omtag++;
                svep = 0;
            } else {
                vackt += fynd.dagar;
                aldstaVackt = Math.max(aldstaVackt, fynd.dagar);
                svep++;
                bastaSvep = Math.max(bastaSvep, svep);
                if (!aterkomst) {
                    direkt++;
                    const plats = lagerPlats.get(kortet.id);
                    if (plats !== undefined) lagren[plats].rent = true;
                }
            }

            taBortFramst();
            kortIdx++;
            synkaHog();
            uppdateraSlist({ skorden: betyg !== RATING.AGAIN });
            visaKort();
        };

        vandFn = blasBort;
        betygFn = satt;
        overlay.querySelector('#dm-blas').addEventListener('click', blasBort);
    };

    // ---- Slutbilden ----------------------------------------------------

    /* Finns det mer att gräva i? Korten som just repeterats ligger nu överst i
     * ordningen, så ett nytt pass tar nästa lager — men bara om det finns ett.
     * Samma filter som spelhallen använder, läst ur tillståndet. */
    const finnsMerDamm = () => {
        const spelade = new Set(korten.map((k) => k.id));
        return S.appData.decks.some((d) =>
            d.cards.some((c) => {
                if (c.type === 'note' || spelade.has(c.id)) return false;
                if (S.playgroundFilterAll) return true;
                const nyckel = c.sectionId
                    ? `deck:${d.id}:section:${c.sectionId}`
                    : `deck:${d.id}:unsorted`;
                return S.playgroundFilterSource.has(nyckel);
            })
        );
    };

    const gravVidare = () => {
        rensa();
        stangSpelyta(overlay, () => {
            finishPlaygroundSession(true);
            window.startPlaygroundStudy?.('dammiga');
        });
    };

    const visaSlut = () => {
        fas = 'slut';
        vandFn = null;
        betygFn = null;

        const forra = lasRekord();
        const slogVackt = vackt > forra.vacktDagar;
        const slogAldsta = aldstaVackt > forra.aldstaDagar;
        const slogSvep = bastaSvep > forra.svep;
        skrivRekord({ vacktDagar: vackt, aldstaDagar: aldstaVackt, svep: bastaSvep });
        updatePersonalRecords(lagren.length + omtag, Math.round((Date.now() - nu) / 1000));

        let andel = vackt > 0 ? 100 : 0;
        if (forra.vacktDagar > 0) andel = Math.min(100, Math.round((vackt / forra.vacktDagar) * 100));

        /* Borrkärnan: ett streck per kort, högt om kortet legat länge, i accent
         * om det gick på första försöket. Passet kommer äldst först, så
         * profilen lutar nedåt — man ser hur djupt man grävde och exakt var
         * man tappade greppet. */
        const karnan = lagren
            .map((lager, i) => {
                const h = aldstaIPasset > 0
                    ? Math.max(6, Math.round((lager.dagar / aldstaIPasset) * 100))
                    : 6;
                return `<i class="dm-stav${lager.rent ? ' is-vackt' : ''}" style="--h:${h};--i:${i}"></i>`;
            })
            .join('');

        const vidare = finnsMerDamm();

        rensa();
        overlay.innerHTML = `
            <div class="arena arena--end dm-slut">
                <p class="micro">Dammiga kort</p>
                <h2 class="arena-end-title">Uppgrävt</h2>

                <div class="dm-karna" aria-hidden="true">${karnan}</div>

                <div class="dm-jamfor">
                    <div class="dm-jamfor-rad">
                        <span class="dm-jamfor-n num is-nu">${formateraSpann(vackt)}</span>
                        <span class="dm-jamfor-l">väckt i det här passet</span>
                        ${slogVackt ? '<span class="dm-flagga">Nytt rekord</span>' : ''}
                    </div>
                    <div class="progress" aria-hidden="true">
                        <i class="progress-fill" style="width:${andel}%"></i>
                    </div>
                    <div class="dm-jamfor-rad">
                        <span class="dm-jamfor-n num">${forra.vacktDagar > 0 ? formateraSpann(forra.vacktDagar) : 'inget än'}</span>
                        <span class="dm-jamfor-l">ditt rekord</span>
                    </div>
                </div>

                <dl class="arena-stats">
                    <div>
                        <dt>Avdammade på första försöket</dt>
                        <dd class="num">${direkt} av ${lagren.length}</dd>
                    </div>
                    <div>
                        <dt>Äldsta fyndet</dt>
                        <dd class="num">${formateraSpann(aldstaVackt)}${slogAldsta ? ' <span class="dm-flagga">Rekord</span>' : ''}</dd>
                    </div>
                    <div>
                        <dt>Längsta svepet</dt>
                        <dd class="num">${bastaSvep} kort${slogSvep ? ' <span class="dm-flagga">Rekord</span>' : ''}</dd>
                    </div>
                    <div>
                        <dt>Omtag</dt>
                        <dd class="num">${omtag}</dd>
                    </div>
                </dl>

                <div class="arena-end-actions">
                    ${vidare ? '<button id="dm-vidare" type="button" class="btn primary">Gräv vidare <span class="kbd">↵</span></button>' : ''}
                    <button id="dm-exit" type="button" class="btn">Avsluta</button>
                </div>
            </div>
        `;

        const vidareEl = overlay.querySelector('#dm-vidare');
        if (vidareEl) vidareEl.addEventListener('click', gravVidare);
        overlay.querySelector('#dm-exit').addEventListener('click', stang);
        slutFn = vidareEl ? gravVidare : stang;
        document.addEventListener('keydown', tangent);
    };

    // ---- Tangentbordet -------------------------------------------------

    function tangent(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            stang();
            return;
        }
        const framat = e.key === ' ' || e.key === 'Enter';
        if (fas === 'start' && framat) {
            e.preventDefault();
            visaKort();
        } else if (fas === 'fraga' && framat) {
            e.preventDefault();
            vandFn?.();
        } else if (fas === 'svar' && ['1', '2', '3', '4'].includes(e.key)) {
            e.preventDefault();
            betygFn?.(parseInt(e.key, 10), true);
        } else if (fas === 'slut' && e.key === 'Enter') {
            e.preventDefault();
            slutFn?.();
        }
    }

    document.addEventListener('keydown', tangent);
    byggHog();
    visaStart();
};
