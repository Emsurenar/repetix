import { S } from '../core/state.js';
import { fisherYatesShuffle } from '../core/utils.js';
import { safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { finishPlaygroundSession } from '../ui/playground.js';
import { oppnaSpelyta, stangSpelyta } from './spelyta.js';

/* Transportbandet.
 *
 * Lägets enda verkliga tillgång är att det rör sig i realtid — inget annat av
 * de åtta gör det. Den gamla versionen slösade bort den: ett kort i taget, och
 * efter varje kort stannade allt tills man tryckte på mellanslag. Kvar blev en
 * flervalsfråga med en långsam nedräkning framför.
 *
 * Nu driver två klockor spelet, och de ställer var sin fråga:
 *
 *   Falltiden  "hinner jag bedöma DET HÄR kortet?" Kortet landar i korgen man
 *              siktar mot när tiden är ute, så en timeout är en chansning på
 *              siktet och inte en automatisk förlust. Sikta tidigt, bestäm sent.
 *
 *   Matningen  "hinner jag med tempot alls?" Nya kort läggs på bandet oavsett
 *              om man hunnit med det förra. Tvekar man växer kön.
 *
 * Ett fel kostar INGET liv. Det kostar sviten och ett stopp — och matningen
 * fortsätter under stoppet, så priset betalas i kö. Kön är därmed spelets enda
 * dödssätt: allt som saktar ner en, tvekan såväl som misstag, fyller bandet, och
 * ett överfullt band kostar ett liv. Den första versionen av det här bygget tog
 * ett liv per fel i stället, och en runda var slut efter sju kort och tjugo
 * sekunder — man hann aldrig se maskinen dra åt.
 *
 * Båda klockorna dras åt för var femte hanterat kort. Rundan är ändlös och tar
 * slut när liven gör det: det finns ingen mållinje att nå, bara ett eget rekord
 * att slå. Rekordet syns under hela rundan som en jaktlinje, så att man vet om
 * man ligger före eller efter sig själv medan man spelar.
 */

/* Tempot ligger här och inte i tokens: det styr spelmekaniken, inte utseendet.
 * Den som bett systemet om mindre rörelse ska fortfarande kunna spela spelet —
 * allt som bara är utsmyckning hämtar sin varaktighet ur CSS och blir noll. */
const FALLTID_START = 3.2; // sekunder för ett kort att nå korgarna
const FALLTID_MIN = 1.15;
const FALLTID_STEG = 0.16; // per nivå

const MATNING_START = 3.0; // sekunder mellan två kort på bandet
/* Golvet ligger medvetet under vad en människa håller uppe i längden. Med ett
 * golv på 1,35 s överlevde varje halvvan spelare hur länge som helst, och ett
 * rekord som bara mäter uthållighet är inget rekord. */
const MATNING_MIN = 0.6;
const MATNING_STEG = 0.18;

const KORT_PER_NIVA = 5;
const KO_TAK = 5; // fler kort än så på bandet och det svämmar över

const STOPP_START = 1.6; // sekunder som rättelsen står kvar efter ett fel
const STOPP_MIN = 1.0;
const STOPP_STEG = 0.06;

const NEDRAKNING_STEG = 0.5; // sekunder per siffra i 3–2–1

/* Andhämtningen när bandet gått tomt. Matningen har sin egen takt, men en
 * spelare som är snabbare än maskinen ska mötas av mer att göra och inte av tre
 * sekunders tom lucka — det är just den luckan som gjorde det gamla läget tamt.
 * En tredjedels sekund räcker för att ögat ska hinna släppa förra kortet. */
const TOM_PAUS = 0.35;

/* Sista femtedelen av fallet. Då byter schaktet ton. Utan en markering syns
 * "nu är det bråttom" först när kortet redan landat, och hela lägets spänning
 * ligger just i den sista biten. */
const KRITISK_ANDEL = 0.8;

/* Spärr efter varje avgörande. Betygsraden i repetitionen hade samma fälla: ett
 * dubbeltryck satte ett betyg på ett kort ingen läst. Här skulle det bränna
 * nästa kort på bandet i stället. 180 ms är kortare än ett avsiktligt omtryck
 * och längre än en studsande knapp. */
const SPARR_MS = 180;

/* Mappnamnen är användarens egen text och sätts in i markup. Ett citattecken i
 * ett mappnamn hade annars brutit korgens aria-label mitt itu. */
const TECKEN = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const text = (varde) => String(varde ?? '').replace(/[&<>"']/g, (c) => TECKEN[c]);

export const transportbandetReveal = () => {
    /* Fyra mappar, de med flest kort. Fler korgar går inte att träffa med en
     * tumme, färre gör spelet till en gissning. */
    const kandidater = (S.currentStudyCards || []).filter((c) => c && c._sectionTitle);
    const antalPerMapp = {};
    kandidater.forEach((c) => {
        antalPerMapp[c._sectionTitle] = (antalPerMapp[c._sectionTitle] || 0) + 1;
    });
    const mappar = Object.entries(antalPerMapp)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([titel]) => titel);
    const pool = kandidater.filter((c) => mappar.includes(c._sectionTitle));

    /* Rekordnyckeln bär en version. Rundan var tidigare tjugo kort lång och
     * poängen därmed taknära; nu är den ändlös, och ett gammalt tal går inte
     * att jämföra med ett nytt. */
    let pbNyckel = 'spaced_rep_tb_pb2_all';
    let pbTitel = 'Hela biblioteket';
    if (S.playgroundFilterSource && S.playgroundFilterSource.size > 0) {
        const deckIds = new Set();
        S.playgroundFilterSource.forEach((val) => {
            const traff = val.match(/^deck:([^:]+)/);
            if (traff) deckIds.add(traff[1]);
        });
        if (deckIds.size === 1) {
            const deckId = Array.from(deckIds)[0];
            const deck = S.appData.decks.find((kortlek) => kortlek.id === deckId);
            pbNyckel = `spaced_rep_tb_pb2_${deckId}`;
            pbTitel = deck ? deck.title : 'Fokusområde';
        } else {
            pbNyckel = `spaced_rep_tb_pb2_focus_${Array.from(deckIds).sort().join('_')}`;
            pbTitel = 'Fokusområde';
        }
    }

    let personBasta = parseInt(localStorage.getItem(pbNyckel) || '0', 10) || 0;
    let pbVidStart = personBasta;

    // --- Rundans tillstånd -------------------------------------------------
    let hog = []; // dragbunten, blandas om när den tar slut
    let ko = []; // kort som ligger och väntar på bandet
    let aktivt = null; // kortet i luften
    let lage = 'nedrakning'; // nedrakning | spelar | stopp | slut
    let nedrakning = 3;
    let nedrakningUr = 0;
    /* Matarklockan startar full: det första kortet ska ligga på bandet när
     * nedräkningen tar slut, inte tre sekunder efter den. */
    let matarUr = MATNING_START;
    let stoppUr = 0;
    let sikte = 0;
    let liv = 3;
    let poang = 0;
    let svit = 0;
    let bastaSvit = 0;
    let sorterade = 0;
    let felsorterade = 0;
    let hanterade = 0;
    let niva = 1;
    let rekordSlaget = false;
    let sparrTill = 0;
    let rafId = null;
    let forraTid = 0;
    let rundStart = 0;
    let livTexten = '';

    const plan = {}; // spelplanens element, hämtade en gång per runda

    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    overlay.className = 'cinema-overlay cinema-overlay--game tb-overlay';

    /* Alla fördröjningar samlas, så att en avslutad runda inte lämnar efter sig
     * något som rör i en DOM den inte längre äger. */
    const timers = new Set();
    const senare = (fn, ms) => {
        const id = setTimeout(() => {
            timers.delete(id);
            fn();
        }, ms);
        timers.add(id);
        return id;
    };

    const falltid = () => Math.max(FALLTID_MIN, FALLTID_START - (niva - 1) * FALLTID_STEG);
    const matning = () => Math.max(MATNING_MIN, MATNING_START - (niva - 1) * MATNING_STEG);
    const stopptid = () => Math.max(STOPP_MIN, STOPP_START - (niva - 1) * STOPP_STEG);

    /* Sviten trappas i steg i stället för att växa jämnt. Ett tröskelvärde man
     * ser sig passera är värt mer än en kurva man aldrig märker. */
    const multiplikator = () => (svit >= 10 ? 3 : svit >= 6 ? 2 : svit >= 3 ? 1.5 : 1);

    const korgMitt = (i) => ((i + 0.5) * 100) / mappar.length;

    // --- Spelplanen --------------------------------------------------------

    const spelplanHtml = () => `
        <div class="tb-plan" style="--tb-korgar:${mappar.length}">
            <div class="tb-hud">
                <span class="tb-liv-namn label">Liv</span>
                <div id="tb-liv" class="tb-liv" role="img"></div>
                <div class="tb-hud-tal num">
                    <span id="tb-niva">Nivå 1</span>
                    <span class="arena-sep" aria-hidden="true"></span>
                    <span id="tb-poang" class="tb-poang">0</span>
                    <span id="tb-mult" class="tb-mult"></span>
                </div>
            </div>

            <div id="tb-jakt" class="tb-jakt">
                <span id="tb-jakt-namn" class="tb-jakt-namn label">Rekord</span>
                <span class="progress"><span id="tb-jakt-fyll" class="progress-fill"></span></span>
                <span id="tb-jakt-tal" class="num">0</span>
            </div>

            <div id="tb-ko" class="tb-ko">
                <span class="tb-ko-namn label">Kö</span>
                <span id="tb-ko-slots" class="tb-ko-slots" aria-hidden="true">
                    ${Array.from({ length: KO_TAK }, () => '<i></i>').join('')}
                </span>
                <span id="tb-ko-tal" class="num">0 / ${KO_TAK}</span>
            </div>

            <div id="tb-schakt" class="tb-schakt">
                ${mappar
                    .slice(1)
                    .map(
                        (_, i) =>
                            `<span class="tb-skiljare" aria-hidden="true" style="left:${((i + 1) * 100) / mappar.length}%"></span>`
                    )
                    .join('')}
                <span id="tb-lane" class="tb-lane" aria-hidden="true"></span>
                <div id="tb-nedrakning" class="tb-nedrakning num">3</div>
            </div>

            <div class="tb-korgar">
                ${mappar
                    .map(
                        (titel, i) => `
                    <button type="button" class="tb-korg" data-idx="${i}"
                            aria-label="Sortera i ${text(titel)}" aria-keyshortcuts="${i + 1}">
                        <span class="tb-korg-num num">${i + 1}</span>
                        <span class="tb-korg-namn">${text(titel)}</span>
                    </button>`
                    )
                    .join('')}
            </div>

            <p class="tb-hint">Tryck på en korg för att sortera<span class="tb-hint-tangent"> · ← → sikta · ↓ släpp · 1–4 direkt</span></p>
        </div>
    `;

    const byggSpelplan = () => {
        overlay.classList.add('cinema-overlay--game');
        overlay.innerHTML = spelplanHtml();

        plan.liv = overlay.querySelector('#tb-liv');
        plan.niva = overlay.querySelector('#tb-niva');
        plan.poang = overlay.querySelector('#tb-poang');
        plan.mult = overlay.querySelector('#tb-mult');
        plan.jakt = overlay.querySelector('#tb-jakt');
        plan.jaktNamn = overlay.querySelector('#tb-jakt-namn');
        plan.jaktFyll = overlay.querySelector('#tb-jakt-fyll');
        plan.jaktTal = overlay.querySelector('#tb-jakt-tal');
        plan.ko = overlay.querySelector('#tb-ko');
        plan.koSlots = Array.from(overlay.querySelectorAll('#tb-ko-slots i'));
        plan.koTal = overlay.querySelector('#tb-ko-tal');
        plan.schakt = overlay.querySelector('#tb-schakt');
        plan.lane = overlay.querySelector('#tb-lane');
        plan.nedrakning = overlay.querySelector('#tb-nedrakning');
        plan.korgar = Array.from(overlay.querySelectorAll('.tb-korg'));

        /* Ett tryck på en korg siktar och släpper i ett svep — det är hela
         * styrningen på telefon, där det inte finns några piltangenter.
         * pointerdown i stället för click för att svaret ska komma i samma
         * ögonblick som fingret nuddar; det syntetiska klicket stoppas så att
         * ett tryck inte räknas två gånger. Tangentbordets Enter och Blanksteg
         * ger ett klick utan pekare (detail 0) och släpps därför igenom. */
        plan.korgar.forEach((korg) => {
            const idx = parseInt(korg.dataset.idx, 10);
            korg.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                sikta(idx);
                slapp();
            });
            korg.addEventListener('click', (e) => {
                if (e.detail !== 0) return;
                sikta(idx);
                slapp();
            });
        });

        ritaLiv();
        ritaKo();
        ritaHud();
        uppdateraSikte();
    };

    // --- HUD ---------------------------------------------------------------

    const ritaLiv = () => {
        const etikett = `${liv} av 3 liv kvar`;
        if (etikett === livTexten) return;
        livTexten = etikett;
        plan.liv.setAttribute('aria-label', etikett);
        plan.liv.innerHTML = Array.from(
            { length: 3 },
            (_, i) => `<i class="${i < liv ? '' : 'is-borta'}"></i>`
        ).join('');
    };

    const ritaKo = () => {
        plan.koSlots.forEach((slot, i) => slot.classList.toggle('is-fylld', i < ko.length));
        plan.koTal.textContent = `${ko.length} / ${KO_TAK}`;
        plan.ko.classList.toggle('is-varning', ko.length >= KO_TAK - 2 && ko.length < KO_TAK);
        plan.ko.classList.toggle('is-full', ko.length >= KO_TAK);
        plan.schakt.classList.toggle('is-trangt', ko.length >= KO_TAK - 2);
    };

    const ritaHud = () => {
        if (lage === 'slut') return;

        plan.niva.textContent = `Nivå ${niva}`;
        plan.poang.textContent = String(poang);

        const m = multiplikator();
        plan.mult.textContent = m === 1 ? '' : `×${String(m).replace('.', ',')} · ${svit} i rad`;
        plan.mult.classList.toggle('is-on', m > 1);

        if (pbVidStart <= 0) {
            /* Utan ett rekord finns ingen jakt. Raden står kvar som ankare men
             * utan stapel — en tom mätare är värre än ingen. */
            plan.jakt.classList.add('is-tom');
            plan.jaktNamn.textContent = 'Första rundan';
            plan.jaktTal.textContent = '—';
            return;
        }

        plan.jakt.classList.remove('is-tom');
        const andel = Math.min(1, poang / pbVidStart);
        plan.jaktFyll.style.width = `${andel * 100}%`;
        plan.jaktTal.textContent = String(pbVidStart);

        if (poang > pbVidStart && !rekordSlaget) {
            rekordSlaget = true;
            plan.jakt.classList.add('is-slaget');
            plan.jaktNamn.textContent = 'Rekord slaget';
            flyt('Rekord slaget', 'is-rekord', 50);
        }
    };

    /* Ett stigande besked ovanför korgen man träffade. Det ligger i schaktet och
     * inte i mitten, så att ögat får bekräftelsen där handlingen skedde. */
    const flyt = (besked, typ, vidProcent) => {
        if (lage === 'slut' || !plan.schakt) return;
        const el = document.createElement('div');
        el.className = `tb-flyt ${typ}`;
        el.textContent = besked;
        el.style.left = `${vidProcent}%`;
        plan.schakt.appendChild(el);
        senare(() => el.remove(), 900);
    };

    const blinkaKorg = (index, klass) => {
        const korg = plan.korgar[index];
        if (!korg) return;
        korg.classList.add(klass);
        senare(() => korg.classList.remove(klass), 320);
    };

    // --- Sikte -------------------------------------------------------------

    /* Kortet är bredare än en ränna — en fråga får inte plats på en fjärdedels
     * skärm — och skulle klippas av schaktets kant vid de yttersta korgarna. Det
     * glider därför så långt det får och stannar där. Siktet läses ändå av den
     * upplysta rännan bakom, som alltid står exakt över sin korg. */
    const kortVanster = () => {
        const bredd = plan.schakt.clientWidth || 1;
        const marginal = ((aktivt.halvbredd + 8) / bredd) * 100;
        if (marginal >= 50) return 50;
        return Math.max(marginal, Math.min(100 - marginal, korgMitt(sikte)));
    };

    const uppdateraSikte = () => {
        plan.korgar.forEach((korg, i) => korg.classList.toggle('is-sikte', i === sikte));
        plan.lane.style.left = `${(sikte * 100) / mappar.length}%`;
        /* Ett avgjort kort har flyttats till mitten för att visa svaret och ska
         * inte ryckas tillbaka av att man siktar om under rättelsen. */
        if (aktivt && aktivt.el && !aktivt.klar) aktivt.el.style.left = `${kortVanster()}%`;
    };

    const sikta = (index) => {
        if (lage === 'slut') return;
        const nytt = Math.max(0, Math.min(mappar.length - 1, index));
        if (nytt === sikte) return;
        sikte = nytt;
        uppdateraSikte();
    };

    // --- Bandet ------------------------------------------------------------

    const dragKort = () => {
        if (!pool.length) return null;
        if (!hog.length) hog = fisherYatesShuffle([...pool]);
        return hog.pop();
    };

    const matarIn = () => {
        if (ko.length >= KO_TAK) {
            svammaOver();
            return;
        }
        const kort = dragKort();
        if (!kort) return;
        ko.push(kort);
        ritaKo();
    };

    /* Kön svämmar över. Hela bandet töms i stället för att ett kort trillar av:
     * ett liv borta OCH en full kö kvar hade gjort nästa sekund omöjlig, och tre
     * liv skulle brinna upp utan att spelaren fick chansen att komma ikapp. */
    const svammaOver = () => {
        ko = [];
        ritaKo();
        flyt('Bandet svämmade över', 'is-fel', 50);
        plan.schakt.classList.add('is-overfull');
        senare(() => plan.schakt && plan.schakt.classList.remove('is-overfull'), 520);
        tappaLiv();
    };

    /* Enda stället ett liv går förlorat: ett överfullt band. Ett fel kostar
     * svit och tid, aldrig ett liv. */
    const tappaLiv = () => {
        liv -= 1;
        ritaLiv();
        if (liv > 0) return;
        /* Sista livet: klockan stannar med en gång, men slutbilden dröjer så att
         * beskedet — och en rättelse som råkar stå kvar — hinner läsas färdigt.
         * Det är rundans sista kort, och det är det man minns. */
        slut(lage === 'stopp' ? Math.round(stopptid() * 1000) : 700);
    };

    /* Kortet läggs på bandet i mitten och glider till den ränna man siktar i.
     * Bredden går inte att veta innan det står i dokumentet, och måttet krävs
     * för att veta hur långt åt sidan det får glida utan att klippas. */
    const skapaFallkort = () => {
        const el = document.createElement('div');
        el.className = 'tb-kort';
        el.innerHTML = safeParse(aktivt.kort.front);
        renderLatex(el);
        el.style.left = '50%';
        el.style.transform = 'translate(-50%, 0)';
        plan.schakt.appendChild(el);
        aktivt.el = el;
        matOm();
        el.style.left = `${kortVanster()}%`;
    };

    /* Måtten tas en gång per kort i stället för varje bildruta: en layoutläsning
     * direkt efter en stilskrivning tvingar fram en ny layout, och det sextio
     * gånger i sekunden för ett element som inte ändrat storlek. */
    const matOm = () => {
        if (!aktivt || !aktivt.el) return;
        aktivt.resa = Math.max(0, plan.schakt.clientHeight - aktivt.el.offsetHeight);
        aktivt.halvbredd = aktivt.el.offsetWidth / 2;
    };

    /* Vänds telefonen mitt i ett fall är både fallhöjden och sidled fel. Måtten
     * tas om och kortet flyttas tillbaka in i sin ränna. */
    const vidStorleksbyte = () => {
        matOm();
        if (aktivt && aktivt.el && !aktivt.klar) aktivt.el.style.left = `${kortVanster()}%`;
    };

    const plockaFranKo = () => {
        const kort = ko.shift();
        if (!kort) return;
        ritaKo();
        aktivt = {
            kort,
            t: 0,
            falltid: falltid(),
            el: null,
            resa: 0,
            halvbredd: 0,
            klar: false,
            kritisk: false,
        };
        skapaFallkort();
    };

    const uppdateraFall = (dt) => {
        aktivt.t += dt;
        const andel = Math.min(1, aktivt.t / aktivt.falltid);
        aktivt.el.style.transform = `translate(-50%, ${andel * aktivt.resa}px)`;

        const kritisk = andel >= KRITISK_ANDEL;
        if (kritisk !== aktivt.kritisk) {
            aktivt.kritisk = kritisk;
            aktivt.el.classList.toggle('is-kritisk', kritisk);
            plan.lane.classList.toggle('is-kritisk', kritisk);
        }

        if (aktivt.t >= aktivt.falltid) avgor();
    };

    // --- Avgörandet --------------------------------------------------------

    const slapp = () => {
        if (lage !== 'spelar' || !aktivt || aktivt.klar) return;
        if (performance.now() < sparrTill) return;
        avgor();
    };

    const avgor = () => {
        if (!aktivt || aktivt.klar) return;
        aktivt.klar = true;
        sparrTill = performance.now() + SPARR_MS;
        plan.lane.classList.remove('is-kritisk');

        const rattIdx = mappar.indexOf(aktivt.kort._sectionTitle);
        const ratt = sikte === rattIdx;

        hanterade += 1;
        const nyNiva = 1 + Math.floor(hanterade / KORT_PER_NIVA);
        if (nyNiva > niva) {
            niva = nyNiva;
            flyt(`Nivå ${niva}`, 'is-niva', 50);
        }

        if (ratt) avgorRatt();
        else avgorFel(rattIdx);

        ritaHud();
    };

    const avgorRatt = () => {
        /* Sviten räknas upp först, så att kortet som når tröskeln också är det
         * som får den nya multiplikatorn. Räknas den efteråt lovar HUD:en ett
         * tal som gällde först nästa gång. */
        svit += 1;
        if (svit > bastaSvit) bastaSvit = svit;

        /* Snabbhet betalar sig linjärt: sorterar man direkt är kortet värt tre
         * gånger så mycket som i sista stund. Det är den enda belöningen som
         * också löser problemet den skapar — ett snabbt avgörande tömmer kön. */
        const kvar = 1 - Math.min(1, aktivt.t / aktivt.falltid);
        const vunnet = Math.round((10 + Math.round(20 * kvar)) * multiplikator());
        poang += vunnet;

        sorterade += 1;
        /* Spelhallens sammanfattning räknar KORT, inte poäng, och summerar över
         * alla rundor man tar innan man går ut. Den gamla versionen skrev över
         * fältet med poängsumman på slutet, så resultatvyn påstod att man
         * sorterat trehundra kort. */
        S.playgroundSessionStats.correct += 1;

        blinkaKorg(sikte, 'is-ratt');
        flyt(`+${vunnet}`, 'is-ratt', korgMitt(sikte));

        /* Kortet åker ner i korgen i stället för att bara försvinna. Utan den
         * framtvingade layoutläsningen slås start- och slutläget ihop till ett
         * och resan hoppas över helt. */
        const el = aktivt.el;
        el.classList.add('is-landar');
        void el.offsetWidth;
        el.style.transform = `translate(-50%, ${aktivt.resa}px) scale(0.92)`;
        el.style.opacity = '0';
        senare(() => el.remove(), 320);

        aktivt = null;
    };

    const avgorFel = (rattIdx) => {
        svit = 0;
        felsorterade += 1;
        S.playgroundSessionStats.again += 1;

        /* Båda korgarna står kvar hela stoppet: den man valde och den man borde
         * ha valt. En blinkning på tre tiondelar hinner inte jämföras med
         * någonting. */
        plan.korgar[sikte].classList.add('is-fel');
        if (rattIdx >= 0) plan.korgar[rattIdx].classList.add('is-facit');

        /* Kortet stannar och vänder sig. Rätt svar och rätt mapp ska stå kvar
         * tillsammans en stund — det är hela lägets pedagogik, och den enda
         * anledningen att fallet någonsin får stanna. Bandet stannar däremot
         * inte: matningen räknar vidare, och det är felets hela pris. */
        const el = aktivt.el;
        el.innerHTML = safeParse(aktivt.kort.back);
        renderLatex(el);
        el.classList.add('is-svar');
        el.style.left = '50%';
        /* Något ovanför mitten, inte i den: rättelsen ligger längst ner i
         * schaktet och de två får inte mötas på en liggande telefon. */
        el.style.top = '42%';
        el.style.transform = 'translate(-50%, -50%)';

        const rattelse = document.createElement('div');
        rattelse.className = 'tb-rattelse';
        rattelse.innerHTML = `<span class="label">Rätt mapp</span><span class="tb-rattelse-mapp">${text(mappar[rattIdx] || '—')}</span>`;
        plan.schakt.appendChild(rattelse);
        aktivt.rattelse = rattelse;

        lage = 'stopp';
        stoppUr = 0;
    };

    const avslutaStopp = () => {
        if (aktivt) {
            if (aktivt.el) aktivt.el.remove();
            if (aktivt.rattelse) aktivt.rattelse.remove();
            aktivt = null;
        }
        plan.korgar.forEach((korg) => korg.classList.remove('is-facit', 'is-fel'));
        plan.lane.classList.remove('is-kritisk');
        lage = 'spelar';
    };

    // --- Klockan -----------------------------------------------------------

    const kliv = (nu) => {
        rafId = requestAnimationFrame(kliv);
        /* Taket på tiodelen: en flik som legat i bakgrunden ger annars ett kliv
         * på flera sekunder, och spelaren förlorar allt utan att ha sett något. */
        const dt = Math.min(0.1, (nu - forraTid) / 1000);
        forraTid = nu;

        if (lage === 'nedrakning') {
            nedrakningUr += dt;
            if (nedrakningUr < NEDRAKNING_STEG) return;
            nedrakningUr = 0;
            nedrakning -= 1;
            if (nedrakning > 0) {
                plan.nedrakning.textContent = String(nedrakning);
                /* En animering startar inte om av att klassen läggs tillbaka.
                 * Ett nytt element gör det däremot. */
                const ny = plan.nedrakning.cloneNode(true);
                plan.nedrakning.replaceWith(ny);
                plan.nedrakning = ny;
            } else {
                plan.nedrakning.remove();
                lage = 'spelar';
                rundStart = Date.now();
            }
            return;
        }

        if (lage !== 'spelar' && lage !== 'stopp') return;

        /* Matningen räknas FÖRE stoppet och gäller i båda lägena. Ett fel
         * stannar fallet men aldrig bandet — annars kostar ett misstag ingenting
         * alls, och kön, som är rundans enda dödssätt, slutar röra sig.
         *
         * Är både luften och kön tomma kortas väntan till en andhämtning.
         * Klockan flyttas bara framåt, aldrig bakåt: den som halkat efter ska
         * inte belönas med extra tid av att ett ögonblick ha hunnit ikapp. */
        const takt = matning();
        if (lage === 'spelar' && !aktivt && !ko.length && matarUr < takt - TOM_PAUS) {
            matarUr = takt - TOM_PAUS;
        }

        matarUr += dt;
        if (matarUr >= takt) {
            matarUr = 0;
            matarIn();
        }
        if (lage === 'slut') return; // matningen kan ha sänkt det sista livet

        if (lage === 'stopp') {
            stoppUr += dt;
            if (stoppUr >= stopptid()) avslutaStopp();
            return;
        }

        if (!aktivt && ko.length) plockaFranKo();
        if (aktivt && !aktivt.klar) uppdateraFall(dt);
    };

    const startaKlockan = () => {
        forraTid = performance.now();
        rafId = requestAnimationFrame(kliv);
    };

    // --- Slutbilden --------------------------------------------------------

    const slut = (fordrojning = 0) => {
        lage = 'slut';
        cancelAnimationFrame(rafId);
        rafId = null;
        if (fordrojning > 0) senare(ritaSlutbild, fordrojning);
        else ritaSlutbild();
    };

    const ritaSlutbild = () => {
        timers.forEach(clearTimeout);
        timers.clear();

        const nyttRekord = poang > personBasta;
        if (nyttRekord) {
            personBasta = poang;
            localStorage.setItem(pbNyckel, String(poang));
        }

        const sekunder = rundStart ? Math.round((Date.now() - rundStart) / 1000) : 0;
        const tak = Math.max(poang, pbVidStart, 1);
        const diff = poang - pbVidStart;

        let ledning;
        if (pbVidStart <= 0) ledning = `${poang} poäng står nu som rekordet att slå.`;
        else if (diff > 0) ledning = `${diff} poäng över det gamla rekordet.`;
        else if (diff === 0) ledning = 'Exakt på rekordet. En poäng till hade räckt.';
        else if (-diff <= Math.max(20, pbVidStart * 0.1)) ledning = `Så nära. ${-diff} poäng kvar.`;
        else ledning = `${-diff} poäng kvar till rekordet.`;

        const jamforelse =
            pbVidStart <= 0
                ? ''
                : `
            <div class="tb-jamfor">
                <div class="tb-jamfor-rad">
                    <span class="tb-jamfor-namn">Denna runda</span>
                    <span class="tb-jamfor-spar"><i class="is-nu" style="width:${(poang / tak) * 100}%"></i></span>
                    <span class="tb-jamfor-tal num">${poang}</span>
                </div>
                <div class="tb-jamfor-rad">
                    <span class="tb-jamfor-namn">Rekord · ${text(pbTitel)}</span>
                    <span class="tb-jamfor-spar"><i style="width:${(pbVidStart / tak) * 100}%"></i></span>
                    <span class="tb-jamfor-tal num">${pbVidStart}</span>
                </div>
            </div>`;

        overlay.classList.remove('cinema-overlay--game');
        overlay.innerHTML = `
            <div class="arena arena--end tb-slut">
                <p class="micro">Transportbandet</p>
                <h2 class="arena-end-title">${nyttRekord ? 'Nytt rekord' : 'Bandet stannade'}</h2>
                <p class="tb-slut-poang num">${poang}</p>
                <p class="arena-end-lead">${ledning}</p>
                ${jamforelse}
                <dl class="arena-stats">
                    <div><dt>Rätt sorterade</dt><dd class="num">${sorterade}</dd></div>
                    <div><dt>Fel korg</dt><dd class="num">${felsorterade}</dd></div>
                    <div><dt>Längsta svit</dt><dd class="num">${bastaSvit}</dd></div>
                    <div><dt>Högsta nivå</dt><dd class="num">${niva}</dd></div>
                    <div><dt>Tid på bandet</dt><dd class="num">${sekunder} s</dd></div>
                </dl>
                <div class="arena-end-actions">
                    <button type="button" id="tb-igen" class="btn primary">Spela igen</button>
                    <button type="button" id="tb-avsluta" class="btn secondary">Avsluta</button>
                </div>
            </div>
        `;

        overlay.querySelector('#tb-igen').addEventListener('click', spelaIgen);
        overlay.querySelector('#tb-avsluta').addEventListener('click', stangSpelet);
        overlay.querySelector('#tb-igen').focus();
    };

    // --- Rundan ------------------------------------------------------------

    const nollstall = () => {
        hog = [];
        ko = [];
        aktivt = null;
        lage = 'nedrakning';
        nedrakning = 3;
        nedrakningUr = 0;
        matarUr = MATNING_START;
        stoppUr = 0;
        sikte = 0;
        liv = 3;
        poang = 0;
        svit = 0;
        bastaSvit = 0;
        sorterade = 0;
        felsorterade = 0;
        hanterade = 0;
        niva = 1;
        rekordSlaget = false;
        sparrTill = 0;
        rundStart = 0;
        livTexten = '';
        pbVidStart = personBasta;
    };

    /* Omstarten går rakt in i nedräkningen. Ett mellanting med en startknapp
     * hade lagt ett tryck mellan "jag vill igen" och att spela, och det är
     * precis det trycket som avgör om man tar en runda till. */
    const spelaIgen = () => {
        timers.forEach(clearTimeout);
        timers.clear();
        cancelAnimationFrame(rafId);
        nollstall();
        byggSpelplan();
        startaKlockan();
    };

    const stada = () => {
        cancelAnimationFrame(rafId);
        rafId = null;
        timers.forEach(clearTimeout);
        timers.clear();
        document.removeEventListener('keydown', tangent);
        window.removeEventListener('resize', vidStorleksbyte);
    };

    const stangSpelet = () => {
        stada();
        stangSpelyta(overlay, finishPlaygroundSession);
    };

    // --- Tangentbordet -----------------------------------------------------

    function tangent(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            stangSpelet();
            return;
        }

        if (lage === 'slut') {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                spelaIgen();
            }
            return;
        }

        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            sikta(sikte - 1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            sikta(sikte + 1);
        } else if (e.key === 'ArrowDown' || e.key === ' ') {
            e.preventDefault();
            slapp();
        } else if (['1', '2', '3', '4'].includes(e.key)) {
            e.preventDefault();
            const idx = parseInt(e.key, 10) - 1;
            if (idx < mappar.length) {
                sikta(idx);
                slapp();
            }
        }
    }

    // --- Start -------------------------------------------------------------

    oppnaSpelyta(overlay);
    byggSpelplan();
    document.addEventListener('keydown', tangent);
    window.addEventListener('resize', vidStorleksbyte);
    startaKlockan();
};
