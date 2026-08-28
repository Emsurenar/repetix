import { S } from '../core/state.js';
import { escapeHtml, fisherYatesShuffle } from '../core/utils.js';
import { renderCardBackImages, safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { finishPlaygroundSession } from '../ui/playground.js';
import { processRating } from '../ui/study.js';
import { oppnaSpelyta, stangSpelyta } from './spelyta.js';

/* Action — klockan är motståndaren.
 *
 * Läget var en rytmlek: svaret avslöjades ord för ord och man tryckte i takt
 * med en krympande ring. Poängen mätte alltså handleden och inte minnet — man
 * kunde maxa ett kort man aldrig sett — och omgången tog slut när korten tog
 * slut, inte när man misslyckades. Ett spel man inte kan förlora är ett spel
 * man inte behöver spela igen.
 *
 * Nu hänger allt på ett enda tal: sekunderna kvar. Klockan tickar bara medan
 * man försöker minnas, fylls på av varje rätt svar, och ger mindre tillbaka
 * för varje nivå. Kön tar aldrig slut — den fylls på ur hela fokusområdet — så
 * omgången kan bara sluta på ett sätt: klockan når noll. Slutskärmen ställer
 * resultatet mot rekordet på samma linjal, och det är den bilden man vill köra
 * en gång till för.
 *
 * Två tangenter bär hela spelet, och de betyder samma sak i båda faserna:
 * mellanslag är "det går bra", F är "det gick inte". Flödet blir en enda
 * upprepad tangent så länge man har rätt, och ett misstag bryter takten även
 * i fingrarna.
 */

/* Lägets egen klocka. Talen här är speldesign, inte rörelse, och får därför
 * inte komma ur rörelsetokens: den som bett om mindre rörelse ska få ett
 * stillsamt gränssnitt, inte ett spel utan tid. Allt som ANIMERAS läses ur
 * tokens i action.css och nollas där tillsammans med resten. */
const KLOCKA_START = 20000;
/* Taket är det som håller trycket uppe. Utan det bankar en skicklig spelare
 * ihop flera minuter och spänningen är borta för resten av omgången. */
const KLOCKA_TAK = 28000;

/* Påfyllningen krymper med 400 ms per nivå och tar slut helt vid nivå tolv.
 * Det är avsiktligt: utan en botten kan en tillräckligt snabb spelare aldrig
 * dö, och ett läge man inte kan förlora har ingen slutbild att jaga. Från
 * nivå tolv spelar man på lånad tid, och det är där omgången är som bäst.
 *
 * Klockan går däremot alltid i en sekund per sekund. Eskaleringen ligger i
 * belöningen och inte i takten — ett tal som ljuger om sin egen enhet går
 * inte att räkna med, och nedräkningen är hela lägets besked. */
const ATER_BAS = 4400;
const ATER_STEG = 400;
const NIVA_KORT = 4;

const BLIXT = 1200;
const TROG = 5000;
/* Blixtsvaret ger halva påfyllningen till. Andel och inte fast tal: en bonus
 * som står still medan grunden krymper blir till slut hela ekonomin. */
const BLIXT_ANDEL = 0.5;

const KRITISKT = 5000;
const KOMBO_STEG = 4;
const MULT_TAK = 4;
/* Tre steg och ett "Kör". Kort med flit: nedräkningen står mellan spelaren och
 * nästa försök, och ett läge man vill spela igen får inte kosta tre sekunder av
 * väntan varje gång. */
const NEDRAKNING_STEG = 450;

/* Betygsraden i repetitionen kostade en gång ett betyg på ett oläst kort:
 * knappen man just tryckt på byts mot en annan på samma pixlar, och en
 * dubbelklick hann igenom. Här är faran värre — mellanslag betyder "visa
 * svaret" och en tiondels sekund senare "jag hade rätt". Spärren gör att det
 * andra trycket måste vara medvetet. Ett tangenttryck kräver dessutom att
 * föregående släppts. */
const DOM_SPARR = 260;

export const actionReveal = (allCards) => {
    /* Egen kopia: processRating lägger tillbaka ett "Igen"-kort sist i
     * S.currentStudyCards, och den listan får inte vara lägets kö. */
    const startkort = [...S.currentStudyCards];
    const brunn = allCards && allCards.length ? allCards : startkort;

    /* Ny rekordnyckel. Poängen räknas på ett helt annat sätt än i
     * rytmversionen, så ett gammalt rekord hade varit ett annat spels tal. */
    let pbNyckel = 'spaced_rep_action_v2_pb_all';
    let pbTitel = 'Hela biblioteket';
    if (S.playgroundFilterSource && S.playgroundFilterSource.size > 0) {
        const deckIds = new Set();
        S.playgroundFilterSource.forEach((val) => {
            const match = val.match(/^deck:([^:]+)/);
            if (match) deckIds.add(match[1]);
        });
        if (deckIds.size === 1) {
            const enda = Array.from(deckIds)[0];
            const deck = S.appData.decks.find((d) => d.id === enda);
            pbNyckel = `spaced_rep_action_v2_pb_${enda}`;
            pbTitel = deck ? deck.title : 'Fokusområde';
        } else {
            pbNyckel = `spaced_rep_action_v2_pb_focus_${Array.from(deckIds).sort().join('_')}`;
            pbTitel = 'Fokusområde';
        }
    }
    let rekord = parseInt(localStorage.getItem(pbNyckel) || '0', 10);
    if (!Number.isFinite(rekord)) rekord = 0;

    // --- Omgångens tillstånd ---
    let fas = 'intro';
    let ko = [];
    let aktivt = null;
    let bank = KLOCKA_START;
    let sistaBildruta = 0;
    let minnesStart = 0;
    let minnesTid = 0;
    let gavUpp = false;
    let domOppnad = 0;
    let poang = 0;
    let kombo = 0;
    let bastaKombo = 0;
    let ratt = 0;
    let besvarade = 0;
    let blixtar = 0;
    let raddningar = 0;
    let rekordSlaget = false;
    let bedomda = new Set();
    let omgangStart = Date.now();

    let raf = 0;
    let timer = 0;
    let avslutad = false;

    /* Var fjärde kort höjer nivån, var fjärde i rad höjer multiplikatorn. Samma
     * takt med flit: var fjärde gång man har rätt stiger både det man tjänar
     * och det spelet kräver. Nivån nollas aldrig, multiplikatorn vid varje fel
     * — det man byggt upp av skicklighet består, det man byggt upp av svit
     * måste förtjänas om. */
    const niva = () => 1 + Math.floor(ratt / NIVA_KORT);
    const multiplikator = () => Math.min(MULT_TAK, 1 + Math.floor(kombo / KOMBO_STEG) * 0.5);
    /* Nivån skickas in i stället för att läsas: svaret som höjer nivån ska
     * betalas enligt den nivå man svarade på. Den nya biter från nästa kort,
     * vilket är vad beskedet "Nivå 4" på skärmen betyder. */
    const tidTillbaka = (n = niva()) => Math.max(0, ATER_BAS - (n - 1) * ATER_STEG);
    const tal = (n) => String(n).replace('.', ',');
    const sekunder = (ms) => tal((ms / 1000).toFixed(1));

    const rentText = (html) => {
        if (!html) return '';
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        return (tmp.textContent || '').trim();
    };

    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    overlay.className = 'cinema-overlay action-scene';
    overlay.innerHTML = `
        <div class="action-stage">
            <div class="action-rail">
                <div class="action-clock-box">
                    <p id="action-clock-label" class="label">Kvar</p>
                    <span id="action-clock" class="action-clock num">${sekunder(bank)}</span>
                </div>
                <div class="action-tally">
                    <p class="label">Poäng</p>
                    <span id="action-score" class="action-score num">0</span>
                    <span class="action-meter">
                        <span id="action-mult" class="action-mult num">×1</span>
                        <span id="action-ladder" class="action-ladder" aria-hidden="true"></span>
                        <span id="action-level" class="action-level">Nivå 1</span>
                    </span>
                </div>
            </div>

            <div class="progress action-drain">
                <i id="action-drain" class="progress-fill action-drain-fill"></i>
            </div>

            <div id="action-play" class="action-play"></div>

            <p id="action-flash" class="action-flash" role="status" aria-live="polite"></p>
        </div>
    `;

    oppnaSpelyta(overlay);

    const stage = overlay.querySelector('.action-stage');
    const spelplan = overlay.querySelector('#action-play');
    const klockaEl = overlay.querySelector('#action-clock');
    const klockaLabelEl = overlay.querySelector('#action-clock-label');
    const drainEl = overlay.querySelector('#action-drain');
    const poangEl = overlay.querySelector('#action-score');
    const multEl = overlay.querySelector('#action-mult');
    const nivaEl = overlay.querySelector('#action-level');
    const stegEl = overlay.querySelector('#action-ladder');
    const flashEl = overlay.querySelector('#action-flash');

    for (let i = 0; i < KOMBO_STEG; i++) stegEl.appendChild(document.createElement('i'));

    // --- Talen i slisten ---

    const ritaKlocka = () => {
        const text = sekunder(Math.max(0, bank));
        if (klockaEl.textContent !== text) klockaEl.textContent = text;
        /* Stapeln mäts mot taket och inte mot startvärdet: då syns påfyllningen
         * som att linjen växer tillbaka, vilket är hela belöningen. */
        const andel = Math.max(0, Math.min(1, bank / KLOCKA_TAK));
        drainEl.style.transform = `scaleX(${andel})`;
        stage.classList.toggle('is-critical', bank <= KRITISKT && fas !== 'slut' && fas !== 'intro');
    };

    /* En animation startar inte om av att klassen läggs tillbaka. Ta bort, läs
     * offsetWidth, lägg på. */
    const pulsera = (el) => {
        el.classList.remove('is-updated');
        void el.offsetWidth;
        el.classList.add('is-updated');
    };

    const ritaTal = () => {
        poangEl.textContent = String(poang);
        poangEl.classList.toggle('is-record', rekordSlaget);
        const m = multiplikator();
        multEl.textContent = `×${tal(m)}`;
        multEl.classList.toggle('is-hot', m > 1);
        const kvar = m >= MULT_TAK ? KOMBO_STEG : kombo % KOMBO_STEG;
        Array.from(stegEl.children).forEach((prick, i) => prick.classList.toggle('is-on', i < kvar));
        nivaEl.textContent = `Nivå ${niva()}`;
        /* Sista sträckan: nivån har ätit upp hela påfyllningen och klockan bara
         * går. Talet byter ton så att man vet varför den inte reser sig mer. */
        nivaEl.classList.toggle('is-slut', tidTillbaka() === 0);
    };

    const visaBesked = (delar, ton) => {
        flashEl.innerHTML = '';
        if (!delar.length) return;
        const rad = document.createElement('span');
        rad.className = `action-flash-txt is-${ton}`;
        rad.textContent = delar.join(' · ');
        flashEl.appendChild(rad);
        rad.addEventListener('animationend', () => rad.remove(), { once: true });
    };

    /* Ytan färgas ett ögonblick. Elementet skapas på nytt varje gång i stället
     * för att få en klass tillbaka — en animation startar inte om av det. */
    const tona = (ton) => {
        const tint = document.createElement('div');
        tint.className = `action-tint is-${ton}`;
        overlay.appendChild(tint);
        tint.addEventListener('animationend', () => tint.remove(), { once: true });
    };

    // --- Klockan ---

    const tick = (nu) => {
        if (avslutad || fas !== 'minns') return;
        bank -= nu - sistaBildruta;
        sistaBildruta = nu;
        if (bank <= 0) {
            bank = 0;
            ritaKlocka();
            doden();
            return;
        }
        ritaKlocka();
        raf = requestAnimationFrame(tick);
    };

    /* Klockan står medan svaret läses. Det är lägets viktigaste regel — den är
     * skälet att man vågar läsa svaret ordentligt i stället för att fly vidare
     * — och den syns bara om den sägs: ett tal som slutat ticka märks inte i
     * den sekund man är stressad. */
    const frys = (pa) => {
        stage.classList.toggle('is-frozen', pa);
        klockaLabelEl.textContent = pa ? 'Klockan står' : 'Kvar';
    };

    const startaKlockan = () => {
        cancelAnimationFrame(raf);
        frys(false);
        /* Tiden räknas från nu och inte från när fasen började: renderingen av
         * frågan ska inte kosta spelaren något. */
        sistaBildruta = performance.now();
        raf = requestAnimationFrame(tick);
    };

    const stoppaKlockan = () => {
        cancelAnimationFrame(raf);
        raf = 0;
    };

    const stada = () => {
        avslutad = true;
        stoppaKlockan();
        clearTimeout(timer);
        document.removeEventListener('keydown', pilotKeydown);
    };

    let stangd = false;
    const stangSpel = () => {
        if (stangd) return;
        stangd = true;
        S.playgroundSessionStats.correct = poang;
        S.playgroundSessionStats.total = besvarade;
        stada();
        stangSpelyta(overlay, finishPlaygroundSession);
    };

    // --- Kön ---

    const dra = () => {
        if (ko.length === 0) ko = fisherYatesShuffle([...brunn]);
        return ko.shift() || null;
    };

    // --- Bedömningen ---

    /* Betyget härleds ur klockan i stället för att frågas efter. Fyra knappar
     * under tidspress är tre för många, och skillnaden mellan "Bra" och "Lätt"
     * ÄR hur lång tid hågkomsten tog — det är precis vad ett lätt kort betyder.
     * Invarianten Igen ≤ Svårt < Bra < Lätt bor kvar i domain/srs.js. */
    const betygFor = (rattUt, tid) => {
        if (!rattUt) return 1;
        if (tid < BLIXT) return 4;
        if (tid > TROG) return 2;
        return 3;
    };

    /* Ett kort bedöms en gång per omgång. Kön fylls på ur samma brunn, så ett
     * litet fokusområde kan visa samma kort fyra gånger — och fyra "Lätt" i
     * följd hade skjutit kortet månader fram på underlaget av en enda verklig
     * hågkomst. Poängen räknas varje gång; schemat rör vi bara första. */
    const betygsatt = (kort, betyg) => {
        if (!kort || bedomda.has(kort.id)) return;
        bedomda.add(kort.id);
        let i = S.currentStudyCards.indexOf(kort);
        if (i === -1) {
            S.currentStudyCards.push(kort);
            i = S.currentStudyCards.length - 1;
        }
        S.currentStudyIndex = i;
        processRating(betyg);
    };

    const registrera = (rattUt) => {
        const kort = aktivt;
        const komboFore = kombo;
        const nivaFore = niva();
        const kritiskt = bank <= KRITISKT;
        besvarade++;

        if (rattUt) {
            ratt++;
            kombo++;
            if (kombo > bastaKombo) bastaKombo = kombo;

            const blixt = minnesTid < BLIXT;
            if (blixt) blixtar++;

            const grund = tidTillbaka(nivaFore);
            const tillbaka = grund + (blixt ? grund * BLIXT_ANDEL : 0);
            bank = Math.min(KLOCKA_TAK, bank + tillbaka);
            if (kritiskt && tillbaka > 0) raddningar++;

            /* Snabbheten dubblar poängen som mest. Den mäts på hågkomsten, inte
             * på hur fort man hann läsa svaret — läsningen är gratis. */
            const snabbhet = 1 + Math.max(0, 3000 - minnesTid) / 3000;
            const vunnet = Math.round(100 * multiplikator() * snabbhet);
            poang += vunnet;

            const delar = [`+${vunnet}`];
            const m = multiplikator();
            if (m > 1) delar.push(`×${tal(m)}`);
            if (kritiskt && tillbaka > 0) delar.unshift(`Räddning +${sekunder(tillbaka)} s`);
            if (niva() > nivaFore) delar.push(`Nivå ${niva()}`);
            /* Från nivå tolv ger ett rätt svar ingen tid alls. Det måste sägas
             * rakt ut — annars läses det som att spelet slutat svara. */
            if (grund === 0) delar.push('Ingen tid tillbaka');
            if (!rekordSlaget && rekord > 0 && poang > rekord) {
                rekordSlaget = true;
                delar.length = 0;
                delar.push('Rekordet slaget', String(poang));
            }
            visaBesked(delar, 'vinst');
            /* Ytan firar bara en riktig räddning. Ett rätt svar som inte gav
             * någon tid alls har inte räddat något. */
            if (kritiskt && tillbaka > 0) tona('vinst');
            pulsera(klockaEl);
        } else {
            /* Ingen tidsstraff utöver den uteblivna påfyllningen. Ett kort man
             * just höll på att lära sig ska inte kosta extra att läsa. */
            kombo = 0;
            const delar = [gavUpp ? 'Vet inte' : 'Fel'];
            if (komboFore >= KOMBO_STEG) delar.push(`Combo ${komboFore} bruten`);
            visaBesked(delar, 'forlust');
            tona('forlust');
            /* Kortet kommer tillbaka om några kort. Chansen till upprättelse är
             * halva sviten i ett läge där man annars bara förlorar tid. */
            if (kort) ko.splice(Math.min(ko.length, 3), 0, kort);
        }

        betygsatt(kort, betygFor(rattUt, minnesTid));
        pulsera(poangEl);
        ritaTal();
        ritaKlocka();
    };

    // --- Faserna ---

    const knappRad = (primar, primarTangent, sekundar, sekundarTangent) => `
        <div class="action-choices">
            <button type="button" id="action-go" class="action-key action-key--go">
                ${primar}<span class="kbd">${primarTangent}</span>
            </button>
            ${
                sekundar
                    ? `<button type="button" id="action-no" class="action-key action-key--no">
                ${sekundar}<span class="kbd">${sekundarTangent}</span>
            </button>`
                    : ''
            }
        </div>
    `;

    const kopplaKnappar = (paGo, paNo) => {
        const go = spelplan.querySelector('#action-go');
        const no = spelplan.querySelector('#action-no');
        if (go) go.onclick = paGo;
        if (no) no.onclick = paNo;
    };

    const gradKlass = (text) => {
        const n = text.length;
        if (n > 220) return ' is-lang';
        if (n > 90) return ' is-medel';
        return '';
    };

    const visaIntro = () => {
        fas = 'intro';
        stage.classList.remove('is-critical');
        spelplan.innerHTML = `
            <section class="action-panel action-intro">
                <p class="label">Action</p>
                <h1 class="action-headline">Klockan är motståndaren</h1>
                <ul class="action-rules">
                    <li><span class="kbd">Mellanslag</span> när du har svaret. Klockan stannar medan du läser.</li>
                    <li><span class="kbd">F</span> när du inte vet. Kortet ger ingen tid tillbaka.</li>
                    <li>Rätt svar fyller på klockan — mindre för varje nivå.</li>
                    <li>Fyra rätt i rad höjer multiplikatorn. Ett fel nollar den.</li>
                </ul>
                <p class="action-record">Rekord <span class="num">${rekord}</span> · ${escapeHtml(pbTitel)}</p>
                ${knappRad('Kör', 'Mellanslag', '', '')}
            </section>
        `;
        kopplaKnappar(() => startaNedrakning(), null);
    };

    const startaNedrakning = () => {
        if (fas !== 'intro' && fas !== 'slut') return;
        fas = 'nedrakning';
        nyOmgang();
        let n = 3;
        const rita = () => {
            spelplan.innerHTML = `
                <div class="action-count">
                    <span class="action-count-n num">${n > 0 ? n : 'Kör'}</span>
                </div>
            `;
            if (n > 0) {
                n--;
                timer = setTimeout(rita, NEDRAKNING_STEG);
            } else {
                timer = setTimeout(nastaKort, NEDRAKNING_STEG);
            }
        };
        rita();
    };

    const nastaKort = () => {
        if (avslutad) return;
        aktivt = dra();
        if (!aktivt) {
            doden();
            return;
        }
        fas = 'minns';
        gavUpp = false;

        const fragaText = rentText(aktivt.front);
        spelplan.innerHTML = `
            <section class="action-panel">
                <p class="label">Fråga</p>
                <div id="action-question" class="action-question${gradKlass(fragaText)}"></div>
            </section>
            ${knappRad('Jag har det', 'Mellanslag', 'Vet inte', 'F')}
        `;
        const fraga = spelplan.querySelector('#action-question');
        fraga.innerHTML = safeParse(aktivt.front || '');
        renderLatex(fraga);

        kopplaKnappar(
            () => jagHarDet(),
            () => vetInte()
        );
        ritaTal();
        minnesStart = performance.now();
        startaKlockan();
    };

    const visaFacit = (endastVidare) => {
        const kort = aktivt;
        const fragaText = rentText(kort.front);
        spelplan.innerHTML = `
            <section class="action-panel">
                <p class="label">Fråga</p>
                <div id="action-question" class="action-question is-dockad${gradKlass(fragaText)}"></div>
                <p class="label">Svar</p>
                <div id="action-answer" class="action-answer"></div>
            </section>
            ${
                endastVidare
                    ? knappRad('Vidare', 'Mellanslag', '', '')
                    : knappRad('Rätt', 'Mellanslag', 'Fel', 'F')
            }
        `;
        const fraga = spelplan.querySelector('#action-question');
        fraga.innerHTML = safeParse(kort.front || '');
        renderLatex(fraga);

        const svar = spelplan.querySelector('#action-answer');
        svar.innerHTML = safeParse(kort.back || '');
        renderCardBackImages(svar, kort.backImages);
        renderLatex(svar);

        if (endastVidare) {
            kopplaKnappar(() => vidare(), null);
        } else {
            kopplaKnappar(
                () => domslut(true),
                () => domslut(false)
            );
        }
    };

    const jagHarDet = () => {
        if (fas !== 'minns') return;
        minnesTid = performance.now() - minnesStart;
        stoppaKlockan();
        frys(true);
        fas = 'dom';
        domOppnad = Date.now();
        visaFacit(false);
    };

    /* Att ge upp tidigt är ett riktigt val under press: kortet är förlorat
     * ändå, och varje sekund man gräver vidare är en sekund färre på klockan. */
    const vetInte = () => {
        if (fas !== 'minns') return;
        minnesTid = performance.now() - minnesStart;
        stoppaKlockan();
        frys(true);
        gavUpp = true;
        fas = 'facit';
        domOppnad = Date.now();
        registrera(false);
        visaFacit(true);
    };

    const domslut = (rattUt) => {
        if (fas !== 'dom') return;
        if (Date.now() - domOppnad < DOM_SPARR) return;
        fas = 'mellan';
        registrera(rattUt);
        nastaKort();
    };

    const vidare = () => {
        if (fas !== 'facit') return;
        if (Date.now() - domOppnad < DOM_SPARR) return;
        fas = 'mellan';
        nastaKort();
    };

    // --- Slutet ---

    const doden = () => {
        if (fas === 'slut') return;
        stoppaKlockan();
        fas = 'slut';
        bank = 0;
        ritaKlocka();
        frys(false);
        stage.classList.remove('is-critical');

        const foreDetta = rekord;
        const nyttRekord = poang > rekord;
        if (nyttRekord) {
            rekord = poang;
            localStorage.setItem(pbNyckel, String(poang));
        }

        /* Båda staplarna mäts mot det största av de två talen. Slog man rekordet
         * ligger det gamla kvar som ett streck bakom en; missade man det sitter
         * strecket längst ut och den egna linjen stannar strax innan. Det är
         * mellanrummet man vill köra en gång till för. */
        const topp = Math.max(poang, foreDetta, 1);
        const tid = Math.round((Date.now() - omgangStart) / 1000);

        spelplan.innerHTML = `
            <section class="action-panel action-end">
                <p class="label">Tiden tog slut</p>
                <p class="action-final num">${poang}</p>
                <p class="action-final-note${nyttRekord ? ' is-record' : ''}">
                    ${
                        nyttRekord
                            ? foreDetta > 0
                                ? `Nytt rekord — ${poang - foreDetta} poäng bättre`
                                : 'Nytt rekord'
                            : `${foreDetta - poang} poäng från rekordet`
                    }
                </p>

                <div class="action-ghost">
                    <div class="progress action-ghost-track">
                        <i id="action-ghost-fill" class="action-ghost-fill"></i>
                    </div>
                    <i id="action-ghost-mark" class="action-ghost-mark"></i>
                </div>
                <div class="action-ghost-legend num">
                    <span>Denna runda ${poang}</span>
                    <span>Rekord ${Math.max(foreDetta, poang)}</span>
                </div>

                <dl class="action-stats">
                    <div><dt>Kort rätt</dt><dd class="num">${ratt} av ${besvarade}</dd></div>
                    <div><dt>Längsta combo</dt><dd class="num">${bastaKombo}</dd></div>
                    <div><dt>Blixtsvar</dt><dd class="num">${blixtar}</dd></div>
                    <div><dt>Räddningar</dt><dd class="num">${raddningar}</dd></div>
                    <div><dt>Nivå</dt><dd class="num">${niva()}</dd></div>
                    <div><dt>Tid</dt><dd class="num">${tid} s</dd></div>
                </dl>

                <div class="action-choices action-choices--end">
                    <button type="button" id="action-again" class="action-key action-key--go">
                        Spela igen<span class="kbd">Enter</span>
                    </button>
                    <button type="button" id="action-exit" class="action-key action-key--no">
                        Avsluta<span class="kbd">Esc</span>
                    </button>
                </div>
            </section>
        `;

        const fyll = spelplan.querySelector('#action-ghost-fill');
        const mark = spelplan.querySelector('#action-ghost-mark');
        fyll.style.width = `${(poang / topp) * 100}%`;
        mark.style.left = `${(foreDetta / topp) * 100}%`;
        mark.hidden = foreDetta === 0;

        const igen = spelplan.querySelector('#action-again');
        igen.onclick = () => startaNedrakning();
        spelplan.querySelector('#action-exit').onclick = () => stangSpel();
        igen.focus();

        visaBesked([], 'vinst');
    };

    const nyOmgang = () => {
        clearTimeout(timer);
        stoppaKlockan();
        frys(false);
        S.currentStudyCards = [...startkort];
        ko = fisherYatesShuffle([...startkort]);
        bedomda = new Set();
        aktivt = null;
        bank = KLOCKA_START;
        poang = 0;
        kombo = 0;
        bastaKombo = 0;
        ratt = 0;
        besvarade = 0;
        blixtar = 0;
        raddningar = 0;
        rekordSlaget = false;
        omgangStart = Date.now();
        ritaTal();
        ritaKlocka();
    };

    // --- Tangenterna ---

    /* Faserna gör varje handling omöjlig att utföra två gånger: den första
     * byter fas och den andra faller ur på sin egen vakt. Därför gör det inget
     * att ett mellanslag når både den fokuserade knappen och den här lyssnaren.
     *
     * En nedhållen tangent stoppas av e.repeat och inte av en egen flagga för
     * "nere": en flagga som sätts av keydown och släpps av keyup fastnar för
     * alltid den gång fönstret tappar fokus med tangenten nere, och då slutar
     * spelets enda knapp att fungera. */
    function pilotKeydown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            stangSpel();
            return;
        }
        if (e.repeat) return;

        const nyckel = e.key.toLowerCase();

        if (nyckel === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            if (fas === 'intro') startaNedrakning();
            else if (fas === 'minns') jagHarDet();
            else if (fas === 'dom') domslut(true);
            else if (fas === 'facit') vidare();
            else if (fas === 'slut') startaNedrakning();
            return;
        }

        if (nyckel === 'f') {
            e.preventDefault();
            if (fas === 'minns') vetInte();
            else if (fas === 'dom') domslut(false);
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            if (fas === 'slut' || fas === 'intro') startaNedrakning();
        }
    }

    document.addEventListener('keydown', pilotKeydown);

    ritaTal();
    ritaKlocka();
    visaIntro();
};
