import { S } from '../core/state.js';
import { fisherYatesShuffle } from '../core/utils.js';
import { renderCardBackImages, safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { finishPlaygroundSession } from '../ui/playground.js';
import { oppnaSpelyta, stangSpelyta } from './spelyta.js';

/* Dragkampen — ett rep mellan dig och datorn.
 *
 * Mätaren ÄR dramaturgin. Den räknar inte poäng i efterhand utan rör sig hela
 * tiden, också medan du läser påståendet, och allt läget gör syftar till att
 * göra den rörelsen värd att titta på.
 *
 * Fyra regler bär spänningen, och alla fyra finns för att skapa vändningar:
 *
 *   Sviten drar hårdare. Ett ensamt rätt tar tio steg, det femte i rad tjugosex.
 *   Det är det som gör att man vill svara en gång till i stället för att sluta.
 *
 *   Datorn drar hårdast när den är trängd. Ju närmare din mållinje repet
 *   ligger, desto mer motstånd — de sista stegen är de dyraste. Vid avgrunden
 *   släpper den i stället, så att en comeback alltid är möjlig. Kraften står
 *   utskriven i klartext ovanför repet: det ska kännas hårt, inte lömskt.
 *
 *   Ett misstag nära mållinjen kostar dubbelt. Att stå på +85 och tappa
 *   greppet ska svida; det är priset för att ha något att förlora.
 *
 *   Tvekan kostar. Datorn tar spjärn medan du läser och börjar dra först
 *   efteråt, så varje runda är en liten kapplöpning utan att en klocka behöver
 *   ticka ned i hörnet.
 */

/* Repets längd åt vardera hållet. Allt annat i filen är steg på den skalan. */
const MAL = 100;

/* Vad ett rätt svar drar: tio plus fyra per kort i sviten, upp till fem kort.
 * Taket finns för att en lång svit inte ska avgöra matchen i ett svep — då
 * blir resten av korten meningslösa. */
const GRUNDDRAG = 10;
const SVITSTEG = 4;
const SVITTAK = 4;

/* Vad ett fel kostar. Grundpriset är lägre än den fulla sviten, så att ett
 * misstag mitt i matchen är en motgång och inte en dödsdom. Nära mållinjen
 * kostar det dubbelt, vid avgrunden nästan ingenting: där finns inte mycket
 * rep kvar att ta, och en comeback ska alltid vara möjlig. */
const MISSTAG = 15;
const MISSTAG_MALLINJE = 30;
const MISSTAG_AVGRUND = 8;

/* Zonerna. Ovanför mållinjen är det matchboll och misstagen kostar dubbelt;
 * nedanför avgrunden håller datorn igen och ett rätt svar drar extra. */
const MALLINJE = 60;
const AVGRUND = -60;

/* Lästiden innan datorn börjar dra. Den skalar med hur mycket text rundan
 * innehåller: ett långt påstående ska inte straffas för att det är långt. Det
 * är tvekan som ska kosta, inte antalet tecken. */
const LASTID_MIN_MS = 900;
const LASTID_PER_TECKEN_MS = 20;
const LASTID_MAX_MS = 4000;
const lastid = (langd) => Math.min(LASTID_MAX_MS, LASTID_MIN_MS + langd * LASTID_PER_TECKEN_MS);

/* Samma klickspärr som repetitionen har: en dubbelklick på ett svar får inte
 * också bläddra förbi facit. Fönstret ska fånga studsen från samma tryck, inte
 * hindra någon som bestämt sig. */
const KLICKSPARR_MS = 350;

/* Hur många påståenden i rad som får ha samma sanningsvärde. Ren slump ger
 * ibland fem sanna i följd, och då slutar man läsa och börjar gissa mönster. */
const SANNINGSRAD = 3;

/* Datorns dragkraft i steg per sekund. Grunden växer långsamt med matchens
 * längd, närhetsfaktorn gör de sista stegen mot din mållinje dyrast, och
 * övertagsfaktorn låter den släppa när den redan tagit nästan hela repet. */
const motdrag = (rundor, matare) => {
    const bas = 0.7 + rundor * 0.09;
    const narhet = 1 + (Math.max(0, matare) / MAL) * 1.2;
    const overtag = matare <= AVGRUND ? 0.5 : 1;
    return Math.min(3.6, bas * narhet * overtag);
};

/* Kraften i ord i stället för i decimaler. Ett tal per sekund säger ingenting
 * om hur det känns; "drar stenhårt" gör det. */
const KRAFTORD = ['tar spjärn', 'drar', 'drar hårt', 'drar stenhårt'];
const kraftord = (kraft) => KRAFTORD[Math.min(KRAFTORD.length - 1, Math.floor(kraft / 1.1))];

const dragkraft = (svit, matare) =>
    GRUNDDRAG + Math.min(Math.max(svit, 1) - 1, SVITTAK) * SVITSTEG + (matare <= AVGRUND ? 4 : 0);

const misstagskostnad = (matare) => {
    if (matare >= MALLINJE) return MISSTAG_MALLINJE;
    if (matare <= AVGRUND - 10) return MISSTAG_AVGRUND;
    return MISSTAG;
};

/* Kortens text utan uppmärkning, för att kunna jämföra två svar med varandra.
 * Med regex och inte med ett DOM-element: jämförelsen görs mot HELA
 * biblioteket en gång per runda, och att bygga och tolka ett element per kort
 * är hundratals millisekunder på en stor samling. Skillnaden mellan &amp; och
 * & spelar ingen roll för frågan "är det här samma svar". */
const textAv = (html) =>
    String(html || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

const tecken = (n) => (n > 0 ? `+${n}` : `${n}`);

/* Rekordet hör till fokusområdet, inte till appen: att slå sitt rekord i en
 * kortlek med tolv kort säger inget om hela biblioteket. Samma nyckling som
 * Sudden Death använder. */
const rekordnyckel = () => {
    const lekar = new Set();
    if (S.playgroundFilterSource) {
        S.playgroundFilterSource.forEach((v) => {
            const m = String(v).match(/^deck:([^:]+)/);
            if (m) lekar.add(m[1]);
        });
    }
    if (lekar.size === 0) return 'repetix_dk_rekord_alla';
    return `repetix_dk_rekord_${Array.from(lekar).sort().join('_')}`;
};

const TOMT_REKORD = { matcher: 0, segrar: 0, bastaSvit: 0, snabbasteSeger: 0 };

const lasRekord = (nyckel) => {
    try {
        const rad = JSON.parse(localStorage.getItem(nyckel) || '{}');
        return {
            matcher: Number(rad.matcher) || 0,
            segrar: Number(rad.segrar) || 0,
            bastaSvit: Number(rad.bastaSvit) || 0,
            snabbasteSeger: Number(rad.snabbasteSeger) || 0,
        };
    } catch {
        return { ...TOMT_REKORD };
    }
};

const sparaRekord = (nyckel, rekord) => {
    try {
        localStorage.setItem(nyckel, JSON.stringify(rekord));
    } catch {
        /* Privat läge eller fullt lager. Rekordet är en trevlighet, inte data
         * som får stoppa en match. */
    }
};

/* Repet som markup. Samma bild används i arenan och på slutbilden — där som
 * frusen slutställning — så att slutet visar exakt det man spelat mot. */
const banaHtml = ({ statisk = false, p = 0, du = 0, dator = 0 } = {}) => `
    <div class="dk-bana" style="--p:${p};--du:${du};--dator:${dator}"
        ${statisk ? 'aria-hidden="true"' : `role="progressbar" aria-label="Repets läge" aria-valuemin="${-MAL}" aria-valuemax="${MAL}" aria-valuenow="0"`}>
        <div class="dk-rep">
            <i class="dk-fyll dk-fyll--dator"></i>
            <i class="dk-fyll dk-fyll--du"></i>
        </div>
        <i class="dk-mitt" aria-hidden="true"></i>
        <i class="dk-mal dk-mal--dator" aria-hidden="true"></i>
        <i class="dk-mal dk-mal--du" aria-hidden="true"></i>
        <div class="dk-vagn" aria-hidden="true"><span class="dk-knut"><span class="dk-knut-i"></span></span></div>
    </div>`;

export const dragkampenReveal = (allCards) => {
    const nyckel = rekordnyckel();
    let rekord = lasRekord(nyckel);

    /* Den som bett systemet om mindre rörelse ska inte se repet glida. Regeln
     * går inte att lägga i CSS: läget är det enda i appen som skriver ett
     * transform per bildruta, och en tokenvaraktighet når inte dit. */
    const mindreRorelse = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    let kort = S.currentStudyCards;

    let matare = 0;
    let visad = 0;
    let svit = 0;
    let bastaSvit = 0;
    let rundor = 0;
    let ratt = 0;
    let ledningsbyten = 0;
    let ledande = 0;
    let kortIdx = 0;

    let besvarad = false;
    let avslutad = false;
    let garVidare = false;
    let rekordSvitSlagen = false;
    let facitSant = true;
    let aktuelltKort = null;
    let sanningsrad = { varde: null, antal: 0 };

    let rundStart = 0;
    let rundLastid = LASTID_MIN_MS;
    let bytteVid = 0;
    let sistaRam = 0;
    let ramme = null;
    let sistZon = '';
    let sistLage = null;
    let sistKraftord = '';
    let sistDrog = null;

    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    overlay.className = 'cinema-overlay dk-yta';

    const nyssBytt = () => performance.now() - bytteVid < KLICKSPARR_MS;

    /* Repet ritas om varje bildruta. Att leta upp elementen en gång i stället
     * för sextio gånger i sekunden är skillnaden mellan en ritning och en
     * sökning. */
    let el = {};

    /* ---- Arenan --------------------------------------------------------- */

    const byggArena = () => {
        overlay.innerHTML = `
            <div class="arena dk" id="dk-arena">
                <div class="arena-top">
                    <span class="micro">Dragkampen</span>
                    <span class="arena-meta num">
                        <span id="dk-runda">Runda 1 av ${kort.length}</span>
                    </span>
                </div>

                <div class="dk-matare">
                    <div class="dk-sidor">
                        <span class="dk-sida dk-sida--dator">
                            <span class="micro">Datorn</span>
                            <span id="dk-kraft" class="dk-kraft">tar spjärn</span>
                        </span>
                        <span id="dk-lage" class="dk-lage num">0</span>
                        <span class="dk-sida dk-sida--du">
                            <span id="dk-svit" class="dk-kraft"></span>
                            <span class="micro">Du</span>
                        </span>
                    </div>
                    ${banaHtml()}
                </div>

                <div class="dk-pastaende" id="dk-pastaende">
                    <p class="micro">Frågan</p>
                    <div id="dk-fraga" class="dk-fraga"></div>
                    <p class="micro">Påstås vara</p>
                    <div id="dk-ansprak" class="dk-ansprak"></div>
                </div>

                <div class="arena-options dk-knappar">
                    <button type="button" id="dk-falskt" class="dk-knapp dk-knapp--falskt">
                        <span class="kbd" aria-hidden="true">&larr;</span>
                        <span>Falskt</span>
                    </button>
                    <button type="button" id="dk-sant" class="dk-knapp dk-knapp--sant">
                        <span>Sant</span>
                        <span class="kbd" aria-hidden="true">&rarr;</span>
                    </button>
                </div>

                <div class="arena-reveal dk-hylla" id="dk-hylla" aria-live="polite"></div>
            </div>
        `;

        el = {
            arena: overlay.querySelector('#dk-arena'),
            bana: overlay.querySelector('.dk-bana'),
            lage: overlay.querySelector('#dk-lage'),
            kraft: overlay.querySelector('#dk-kraft'),
            svit: overlay.querySelector('#dk-svit'),
            runda: overlay.querySelector('#dk-runda'),
            fraga: overlay.querySelector('#dk-fraga'),
            ansprak: overlay.querySelector('#dk-ansprak'),
            pastaende: overlay.querySelector('#dk-pastaende'),
            knut: overlay.querySelector('.dk-knut-i'),
            hylla: overlay.querySelector('#dk-hylla'),
            sant: overlay.querySelector('#dk-sant'),
            falskt: overlay.querySelector('#dk-falskt'),
        };

        el.sant.onclick = () => svara(true);
        el.falskt.onclick = () => svara(false);
    };

    /* ---- Repet ---------------------------------------------------------- */

    const ritaBana = () => {
        if (!el.bana) return;
        const p = Math.max(-1, Math.min(1, visad / MAL));
        el.bana.style.setProperty('--p', String(p));
        el.bana.style.setProperty('--du', String(Math.max(0, p)));
        el.bana.style.setProperty('--dator', String(Math.max(0, -p)));

        /* Talet byts bara när heltalet gör det. Ett tal som skrivs om sextio
         * gånger i sekunden går inte att läsa, bara att titta på. */
        const lage = Math.round(visad);
        if (lage !== sistLage && el.lage) {
            sistLage = lage;
            el.lage.textContent = tecken(lage);
            el.lage.classList.toggle('is-du', lage > 6);
            el.lage.classList.toggle('is-dator', lage < -6);
        }
    };

    const ritaZon = () => {
        if (!el.arena) return;
        const zon = matare >= MALLINJE ? 'is-matchboll' : matare <= AVGRUND ? 'is-avgrund' : '';
        if (zon === sistZon) return;
        el.arena.classList.remove('is-matchboll', 'is-avgrund');
        if (zon) el.arena.classList.add(zon);
        sistZon = zon;
    };

    /* Ledningen byter ägare först när repet passerat en dödzon kring mitten.
     * Utan den räknas varje darrning vid noll som en vändning. */
    const noteraLedning = () => {
        if (Math.abs(matare) <= 6) return;
        const sida = Math.sign(matare);
        if (ledande !== 0 && sida !== ledande) ledningsbyten++;
        ledande = sida;
    };

    const flyttaRepet = (nyttVarde) => {
        matare = Math.max(-MAL, Math.min(MAL, nyttVarde));
        noteraLedning();
        ritaZon();
    };

    const skrivAria = () => {
        const bana = el.bana;
        if (!bana) return;
        const lage = Math.round(matare);
        bana.setAttribute('aria-valuenow', String(lage));
        bana.setAttribute(
            'aria-valuetext',
            lage > 0 ? `Du leder med ${lage}` : lage < 0 ? `Datorn leder med ${-lage}` : 'Jämnt'
        );
    };

    /* ---- Bildrutan ------------------------------------------------------ */

    const steg = (nu) => {
        const dt = Math.min(0.1, (nu - sistaRam) / 1000);
        sistaRam = nu;

        const drar = !besvarad && !avslutad && nu - rundStart > rundLastid;
        if (drar) flyttaRepet(matare - motdrag(rundor, matare) * dt);

        /* Repet halkar mot sitt nya läge i stället för att hoppa dit. Rycket
         * när ett svar landar är hela skillnaden mellan en siffra som ändras
         * och en dragkamp man ser. */
        visad += mindreRorelse ? matare - visad : (matare - visad) * (1 - Math.pow(0.001, dt));
        ritaBana();

        if (el.kraft) {
            const ord = drar ? kraftord(motdrag(rundor, matare)) : 'tar spjärn';
            if (ord !== sistKraftord) {
                sistKraftord = ord;
                el.kraft.textContent = ord;
            }
            if (drar !== sistDrog) {
                sistDrog = drar;
                el.kraft.classList.toggle('is-on', drar);
            }
        }

        if (!avslutad && matare <= -MAL) {
            avsluta(false, 'mal');
            return;
        }

        ramme = avslutad ? null : requestAnimationFrame(steg);
    };

    const startaRam = () => {
        if (ramme !== null) return;
        sistaRam = performance.now();
        ramme = requestAnimationFrame(steg);
    };

    const stoppaRam = () => {
        if (ramme !== null) cancelAnimationFrame(ramme);
        ramme = null;
    };

    /* ---- Rundan --------------------------------------------------------- */

    const valjSanning = () => {
        let sant = Math.random() < 0.5;
        if (sanningsrad.varde === sant && sanningsrad.antal >= SANNINGSRAD) sant = !sant;
        sanningsrad = sanningsrad.varde === sant
            ? { varde: sant, antal: sanningsrad.antal + 1 }
            : { varde: sant, antal: 1 };
        return sant;
    };

    /* Ett falskt påstående måste vara falskt. Det gamla läget tog ett
     * slumpkort ur högen utan att jämföra texten, så två kort med samma svar
     * gav ett "falskt" påstående som var sant — och den som svarade rätt fick
     * fel. Inget dödar ett spel snabbare än att det fuskar. */
    const valjAnsprak = (kortet, sant) => {
        if (sant) return { text: kortet.back, sant: true };

        /* Ett svep, inte två: kort ur samma kortlek ligger nära i betydelse och
         * ger de påståenden som är värda att tveka inför, men hela biblioteket
         * får duga när leken är för liten. */
        const facit = textAv(kortet.back);
        const naraHall = [];
        const hela = [];
        for (const c of allCards) {
            if (c.id === kortet.id) continue;
            const text = textAv(c.back);
            if (!text || text === facit) continue;
            hela.push(c);
            if (c.originalDeckId === kortet.originalDeckId) naraHall.push(c);
        }

        const pool = naraHall.length > 0 ? naraHall : hela;
        if (pool.length === 0) return { text: kortet.back, sant: true };
        return { text: pool[Math.floor(Math.random() * pool.length)].back, sant: false };
    };

    const visaRunda = () => {
        if (matare >= MAL) { avsluta(true, 'mal'); return; }
        if (matare <= -MAL) { avsluta(false, 'mal'); return; }
        if (kortIdx >= kort.length) { avsluta(matare > 0, 'kort'); return; }

        besvarad = false;
        garVidare = false;
        rundStart = performance.now();
        bytteVid = performance.now();

        const kortet = kort[kortIdx];
        aktuelltKort = kortet;
        const ansprak = valjAnsprak(kortet, valjSanning());
        facitSant = ansprak.sant;

        el.runda.textContent = `Runda ${kortIdx + 1} av ${kort.length}`;

        el.fraga.innerHTML = safeParse(kortet.front);
        renderLatex(el.fraga);
        el.ansprak.innerHTML = safeParse(ansprak.text);
        renderLatex(el.ansprak);

        /* Lästiden mäts på den renderade texten, inte på uppmärkningen: ett
         * kort med formler har mer att läsa än sin källkod antyder. */
        rundLastid = lastid((el.fraga.textContent || '').length + (el.ansprak.textContent || '').length);

        /* Ett nytt påstående ska komma in, inte bytas ut under handen. En
         * animation startar inte om av att klassen läggs tillbaka — den måste
         * bort, layouten läsas, och klassen på igen. */
        el.pastaende.classList.remove('is-sant', 'is-falskt', 'is-ny');
        void el.pastaende.offsetWidth;
        el.pastaende.classList.add('is-ny');

        if (el.knut) el.knut.classList.remove('is-ryck-du', 'is-ryck-dator');

        [el.sant, el.falskt].forEach((knapp) => {
            knapp.classList.remove('is-facit', 'is-miss');
            knapp.removeAttribute('aria-disabled');
        });

        el.svit.textContent = svit >= 2 ? `Svit ${svit}` : '';
        el.svit.classList.toggle('is-on', svit >= 2);

        skrivAria();
        visaInsats();
        startaRam();
    };

    /* Hyllan står kvar hela rundan och byter bara innehåll. Den fylls med vad
     * som står på spel INNAN man svarar: ett tal i accent och ett i rött, och
     * nära mållinjen är det röda dubbelt så stort. Att se priset innan man
     * bestämmer sig är hela skillnaden mellan en fråga och ett vad. */
    const visaInsats = () => {
        const vinst = dragkraft(svit + 1, matare);
        const forlust = misstagskostnad(matare);
        el.hylla.innerHTML = `
            <p class="dk-insats">
                <span class="dk-insats-del"><span class="dk-tal num is-du">${tecken(vinst)}</span> om du har rätt</span>
                <span class="arena-sep" aria-hidden="true"></span>
                <span class="dk-insats-del"><span class="dk-tal num is-dator">${tecken(-forlust)}</span> om du har fel</span>
            </p>
        `;
    };

    const svara = (sagerSant) => {
        if (besvarad || avslutad) return;
        besvarad = true;
        bytteVid = performance.now();

        const korrekt = sagerSant === facitSant;
        const fore = matare;

        /* Ett besked i taget, det som betyder mest. Läget har fem saker att
         * säga efter ett svar, och fem märken samtidigt är inget märke alls. */
        let flagga = '';
        let flaggaAr = 'du';

        if (korrekt) {
            svit++;
            ratt++;
            if (svit > bastaSvit) bastaSvit = svit;
            if (fore <= AVGRUND) flagga = 'Comeback';
            flyttaRepet(fore + dragkraft(svit, fore));
            S.playgroundSessionStats.correct++;
            if (!rekordSvitSlagen && rekord.bastaSvit > 0 && bastaSvit > rekord.bastaSvit) {
                rekordSvitSlagen = true;
                flagga = `Nytt rekord — svit ${bastaSvit}`;
            } else if (!flagga && matare >= MALLINJE) {
                flagga = 'Matchboll';
            } else if (!flagga && svit >= 3) {
                flagga = `Svit ${svit}`;
            }
        } else {
            flaggaAr = 'dator';
            if (fore >= MALLINJE) flagga = 'Du tappade greppet';
            svit = 0;
            flyttaRepet(fore - misstagskostnad(fore));
            S.playgroundSessionStats.again++;
            if (!flagga && matare <= AVGRUND) flagga = 'Avgrundskant';
        }

        rundor++;
        const flytt = Math.round(matare - fore);
        skrivAria();

        /* Knapparna blir facit i stället för att försvinna: den som svarat ska
         * se vilken sida som var rätt på exakt den plats där valet stod. De
         * blir aldrig disabled — då kastas tangentbordsfokus ut ur arenan mitt
         * i rundan. */
        [el.sant, el.falskt].forEach((knapp) => knapp.setAttribute('aria-disabled', 'true'));
        (facitSant ? el.sant : el.falskt).classList.add('is-facit');
        if (!korrekt) (sagerSant ? el.sant : el.falskt).classList.add('is-miss');

        el.pastaende.classList.add(facitSant ? 'is-sant' : 'is-falskt');

        /* Knuten lutar bakåt och snäpper på plats åt det håll repet drogs.
         * Rörelsen ligger på ett eget element inuti knuten: vagnens transform
         * skrivs om varje bildruta och kan inte samtidigt bära en animation. */
        if (el.knut) {
            el.knut.classList.remove('is-ryck-du', 'is-ryck-dator');
            void el.knut.offsetWidth;
            el.knut.classList.add(flytt >= 0 ? 'is-ryck-du' : 'is-ryck-dator');
        }

        const slut = matare >= MAL || matare <= -MAL || kortIdx + 1 >= kort.length;
        const visaFacit = !facitSant;

        el.hylla.innerHTML = `
            <div class="dk-utfall">
                <span class="dk-utfall-tal num ${flytt >= 0 ? 'is-du' : 'is-dator'}">${tecken(flytt)}</span>
                <div class="dk-utfall-text">
                    <p class="arena-verdict ${korrekt ? 'is-good' : 'is-bad'}">${korrekt ? 'Rätt' : 'Fel'}</p>
                    <p class="dk-utfall-lead">Påståendet var ${facitSant ? 'sant' : 'falskt'}.${flagga ? `<span class="dk-flagga is-${flaggaAr}">${flagga}</span>` : ''}</p>
                </div>
            </div>
            ${visaFacit ? `<p class="micro">Rätt svar</p><div id="dk-facit" class="arena-answer"></div>` : ''}
            <div class="dk-vidare">
                <button type="button" id="dk-nasta" class="btn primary">${slut ? 'Se resultatet' : 'Nästa'}</button>
                <span class="arena-hint"><span class="kbd">Space</span> ${slut ? 'se resultatet' : 'fortsätt'}</span>
            </div>
        `;

        if (visaFacit) {
            const facitEl = el.hylla.querySelector('#dk-facit');
            facitEl.innerHTML = safeParse(aktuelltKort.back);
            renderLatex(facitEl);
            renderCardBackImages(facitEl, aktuelltKort.backImages);
        }

        el.hylla.querySelector('#dk-nasta').onclick = nasta;
    };

    const nasta = () => {
        if (!besvarad || avslutad || garVidare) return;
        garVidare = true;
        kortIdx++;
        visaRunda();
    };

    /* ---- Slutbilden ----------------------------------------------------- */

    const avsluta = (vann, orsak) => {
        if (avslutad) return;
        avslutad = true;
        stoppaRam();
        S.playgroundSessionStats._dragkampenWon = vann;

        const fore = { ...rekord };
        rekord.matcher++;
        if (vann) rekord.segrar++;
        const nySvit = bastaSvit > fore.bastaSvit;
        const nySeger = vann && (fore.snabbasteSeger === 0 || rundor < fore.snabbasteSeger);
        if (nySvit) rekord.bastaSvit = bastaSvit;
        if (nySeger) rekord.snabbasteSeger = rundor;
        sparaRekord(nyckel, rekord);

        /* Första matchen sätter varje rekord per definition. Att fira det gör
         * ordet värdelöst nästa gång — det ska betyda att man slog sig själv. */
        const firaSvit = nySvit && fore.bastaSvit > 0;
        const firaSeger = nySeger && fore.snabbasteSeger > 0;

        const lage = Math.round(matare);
        const p = Math.max(-1, Math.min(1, matare / MAL));
        const titel = orsak === 'mal'
            ? (vann ? 'Du drog hem det' : 'Datorn drog hem det')
            : 'Korten tog slut';
        const ingress = orsak === 'mal'
            ? (vann
                ? `Repet gick över din linje på ${rundor} rundor.`
                : 'Datorn drog repet hela vägen över sin linje.')
            : (vann
                ? `Du ledde med ${lage} när sista kortet var spelat.`
                : `Datorn ledde med ${-lage} när sista kortet var spelat.`);

        const rekordrad = (etikett, varde, jamforelse, ny) => `
            <div${ny ? ' class="is-nytt"' : ''}>
                <dt>${etikett}</dt>
                <dd class="num">${varde}${ny ? '<span class="dk-flagga">Nytt rekord</span>' : jamforelse ? `<span class="dk-tidigare">${jamforelse}</span>` : ''}</dd>
            </div>`;

        overlay.innerHTML = `
            <div class="arena arena--end dk dk-slut${vann ? ' is-seger' : ''}">
                <p class="micro">Dragkampen</p>
                <h2 class="arena-end-title">${titel}</h2>
                <p class="arena-end-lead">${ingress}</p>

                <div class="dk-matare dk-matare--slut">
                    <div class="dk-sidor">
                        <span class="dk-sida dk-sida--dator"><span class="micro">Datorn</span></span>
                        <span class="dk-lage num ${lage > 6 ? 'is-du' : lage < -6 ? 'is-dator' : ''}">${tecken(lage)}</span>
                        <span class="dk-sida dk-sida--du"><span class="micro">Du</span></span>
                    </div>
                    ${banaHtml({ statisk: true, p, du: Math.max(0, p), dator: Math.max(0, -p) })}
                </div>

                <dl class="arena-stats">
                    <div><dt>Rundor</dt><dd class="num">${rundor}</dd></div>
                    <div><dt>Rätt bedömningar</dt><dd class="num">${ratt} av ${rundor}</dd></div>
                    <div><dt>Längsta svit</dt><dd class="num">${bastaSvit}</dd></div>
                    <div><dt>Ledningsbyten</dt><dd class="num">${ledningsbyten}</dd></div>
                </dl>

                <p class="micro dk-rekordrubrik">Ditt rekord</p>
                <dl class="arena-stats dk-rekord">
                    ${rekordrad('Längsta svit', bastaSvit, fore.bastaSvit > 0 ? `rekord ${fore.bastaSvit}` : '', firaSvit)}
                    ${rekordrad(
                        'Seger på',
                        vann ? `${rundor} rundor` : '—',
                        fore.snabbasteSeger > 0 ? `rekord ${fore.snabbasteSeger}` : '',
                        firaSeger
                    )}
                    ${rekordrad('Vunna matcher', `${rekord.segrar} av ${rekord.matcher}`, '', false)}
                </dl>

                <div class="arena-end-actions">
                    <button type="button" id="dk-igen" class="btn primary">Dra igen</button>
                    <button type="button" id="dk-avsluta" class="btn">Avsluta</button>
                </div>
                <p class="arena-hint"><span class="kbd">Enter</span> dra igen</p>
            </div>
        `;

        /* Arenan är utbytt, så de sparade elementen pekar på noder som inte
         * längre sitter i dokumentet. */
        el = {};
        bytteVid = performance.now();
        overlay.querySelector('#dk-igen').onclick = dragIgen;
        overlay.querySelector('#dk-avsluta').onclick = stangSpel;
    };

    /* Ett nytt drag utan att lämna arenan. Vägen tillbaka till spelhallen och
     * in i läget igen är fem tryck; det är där lusten att ta en till dör. */
    const dragIgen = () => {
        kort = fisherYatesShuffle([...kort]);
        S.currentStudyCards = kort;
        rekord = lasRekord(nyckel);

        matare = 0;
        visad = 0;
        svit = 0;
        bastaSvit = 0;
        rundor = 0;
        ratt = 0;
        ledningsbyten = 0;
        ledande = 0;
        kortIdx = 0;
        besvarad = false;
        avslutad = false;
        garVidare = false;
        rekordSvitSlagen = false;
        sanningsrad = { varde: null, antal: 0 };
        sistZon = '';
        sistLage = null;
        sistKraftord = '';
        sistDrog = null;

        S.playgroundSessionStats.correct = 0;
        S.playgroundSessionStats.again = 0;
        S.playgroundSessionStats.total = kort.length;
        S.playgroundSessionStats.startTime = Date.now();

        byggArena();
        visaRunda();
    };

    /* ---- In- och utgång -------------------------------------------------- */

    const stad = () => {
        stoppaRam();
        document.removeEventListener('keydown', tangent);
    };

    const stangSpel = () => {
        avslutad = true;
        stad();
        stangSpelyta(overlay, finishPlaygroundSession);
    };

    const tangent = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); stangSpel(); return; }
        if (avslutad) {
            if (e.key === 'Enter' && !nyssBytt()) { e.preventDefault(); dragIgen(); }
            return;
        }
        if (besvarad) {
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); nasta(); }
            return;
        }
        /* Bokstäverna är genvägar till Falskt och Sant, men bara utan
         * modifierare: Cmd+F är webbläsarens sökruta, och att den skulle svara
         * "falskt" åt en är oförlåtligt i ett läge där svaret inte går att ta
         * tillbaka. */
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === 'ArrowLeft' || e.key === 'f' || e.key === 'F') { e.preventDefault(); svara(false); }
        else if (e.key === 'ArrowRight' || e.key === 's' || e.key === 'S') { e.preventDefault(); svara(true); }
    };

    /* Ett klick var som helst går vidare, men aldrig på en knapp: knapparna
     * sköter sig själva, och studsen från samma tryck fångas av spärren. */
    overlay.addEventListener('click', (e) => {
        if (avslutad || !besvarad || nyssBytt()) return;
        if (e.target.closest('button')) return;
        nasta();
    });

    document.addEventListener('keydown', tangent);

    byggArena();
    oppnaSpelyta(overlay);
    visaRunda();
};
