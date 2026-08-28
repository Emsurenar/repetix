import { S } from '../core/state.js';
import { escapeHtml, fisherYatesShuffle } from '../core/utils.js';
import { renderCardBackImages, safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { finishPlaygroundSession } from '../ui/playground.js';
import { oppnaSpelyta, stangSpelyta } from './spelyta.js';

/* Sudden Death.
 *
 * Läget hette "tre liv" men tog ändå slut efter tjugo kort. Då är livräknaren
 * bara pynt: man dog sällan, och när man gjorde det spelade det ingen roll,
 * för rundan var på väg att ta slut ändå. Här är korten en ström som fylls på,
 * och det enda som avslutar rundan är det tredje felet. Först då betyder "hur
 * långt kom du" något, och först då finns det ett rekord att jaga.
 *
 * Insatsen stiger med djupet: klockan krymper per nivå och kortets värde växer.
 * Ett sent kort är värt flera tidiga, och det är hela skälet till att man vill
 * skydda en runda i stället för att slarva bort den och starta om.
 *
 * Talen nedan är speltempo, inte rörelse, och får därför INTE komma ur
 * rörelsetokens. Den som bett systemet om mindre rörelse ska få ett stillare
 * gränssnitt — inte en kortare betänketid.
 */
const LIV = 3;
const NIVA_STEG = 5; /* rätt svar per nivå */
const KLOCKA_START = 8000;
const KLOCKA_KRYMP = 700; /* per nivå */
const KLOCKA_MIN = 3000;
const SNABB_ANDEL = 0.3; /* svar inom denna andel av klockan räknas som snabbt */
const SNABB_FAKTOR = 1.5;
const POANG_BAS = 100;
const POANG_PER_NIVA = 25;
const COMBO_TAK = 3;
const COMBO_LIV = 10; /* rätt i rad som ger ett liv tillbaka */
const BONUS_FULLA_LIV = 250; /* ... eller poäng, när alla liv redan finns */
const PAUS_VID_RATT = 420; /* ms — ett rätt svar ska inte bryta flytet */
const NARA_REKORD = 0.85; /* härifrån och upp är rekordet inom räckhåll */

const enDecimal = (tal) => tal.toFixed(1).replace('.', ',');
const klockaForNiva = (niva) => Math.max(KLOCKA_MIN, KLOCKA_START - (niva - 1) * KLOCKA_KRYMP);
const comboFor = (svit) => Math.min(COMBO_TAK, 1 + svit * 0.1);

/* Alternativen är korta rader, inte kortets baksida i sin helhet: fyra
 * formaterade svar med bilder och formler blir en vägg. Det fullständiga
 * svaret visas i avslöjningen efter ett fel, där det finns tid att läsa det. */
const textAv = (html) => {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || '').trim().substring(0, 120);
};

export const suddenDeathReveal = (allCards) => {
    /* Playground väljer ut en startlek; poolen är hela fokusområdet och fyller
     * på när leken tar slut. Utan påfyllningen skulle djupet ha ett tak, och
     * ett tak är precis vad läget inte ska ha. */
    const startKort = S.currentStudyCards || [];
    const pool = allCards && allCards.length ? allCards : startKort;

    let ko = fisherYatesShuffle([...startKort]);
    let koIdx = 0;
    let poang = 0;
    let djup = 0;
    let ratt = 0;
    let svit = 0;
    let langstaSvit = 0;
    let liv = LIV;
    let niva = 1;
    let snabbaste = null;
    let miss = [];
    let rekordSlaget = false;
    let besvarat = false;
    let lage = 'intro'; /* intro | spel | slut */

    let klockaTimeout = null;
    let klockaRAF = null;
    let klockaStart = 0;
    let klockaLangd = KLOCKA_START;
    let vidareTimeout = null;

    /* Rekordet hör till det man valt att spela: hela biblioteket, en kortlek
     * eller ett hopplock. Nyckeln för poängen är oförändrad sedan tidigare
     * versioner, så rekord som redan står kvar fortsätter gälla. */
    let pbKey = 'spaced_rep_sd_pb_all';
    let pbTitle = 'Hela biblioteket';
    if (S.playgroundFilterSource && S.playgroundFilterSource.size > 0) {
        const deckIds = new Set();
        S.playgroundFilterSource.forEach((val) => {
            const match = val.match(/^deck:([^:]+)/);
            if (match) deckIds.add(match[1]);
        });
        if (deckIds.size === 1) {
            const singleDeckId = Array.from(deckIds)[0];
            const deckObj = S.appData.decks.find((d) => d.id === singleDeckId);
            pbKey = `spaced_rep_sd_pb_${singleDeckId}`;
            pbTitle = deckObj ? deckObj.title : 'Fokusområde';
        } else {
            pbKey = `spaced_rep_sd_pb_focus_${Array.from(deckIds).sort().join('_')}`;
            pbTitle = 'Fokusområde';
        }
    }
    const pbDjupKey = `${pbKey}_djup`;

    let rekord = parseInt(localStorage.getItem(pbKey) || '0', 10) || 0;
    let rekordDjup = parseInt(localStorage.getItem(pbDjupKey) || '0', 10) || 0;

    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    /* Egen klass på hela ytan: alla stilar i games/suddendeath.css hänger under
     * den. Klassnamnen med sd-prefix delas med tre andra lägen, och utan scopet
     * hade en regel här ritat om deras slutskärmar. */
    overlay.className = 'cinema-overlay sd-game';

    oppnaSpelyta(overlay);

    const rensaTimers = () => {
        clearTimeout(klockaTimeout);
        clearTimeout(vidareTimeout);
        cancelAnimationFrame(klockaRAF);
    };

    const cleanup = () => {
        rensaTimers();
        document.removeEventListener('keydown', tangentNed);
        document.removeEventListener('keyup', tangentUpp);
    };

    const closeGame = () => {
        cleanup();
        stangSpelyta(overlay, finishPlaygroundSession);
    };

    /* ------------------------------------------------------------------
     * BESKED
     * ---------------------------------------------------------------- */

    /* Ett besked i taget. Ett fel, en nivå och ett extra liv kan infalla på
     * samma svar, och tre texter ovanpå varandra blir en enda gröt — den som
     * väger tyngst vinner, resten syns ändå i slisten.
     *
     * Beskedet hänger i arenan och inte i överlägget, så att det alltid stiger
     * ur slistens tomma mitt och ut ur bild. Räknat på fönstrets höjd hamnade
     * det mitt på frågan, och nästa kort kommer efter en knapp halv sekund. */
    const visaFlyt = (text, typ) => {
        const hem = overlay.querySelector('.sd-arena') || overlay;
        hem.querySelector('.sd-flyt')?.remove();
        const el = document.createElement('div');
        el.className = `sd-flyt is-${typ}`;
        el.textContent = text;
        hem.appendChild(el);
        el.addEventListener('animationend', () => el.remove(), { once: true });
    };

    /* Ett fel färgar hela ytan ett ögonblick, och det sista felet färgar den
     * längre. Slaget är lägets enda skarpa rörelse; att dö ska synas utan att
     * man läser en siffra. */
    const visaSlag = (dodande) => {
        const el = document.createElement('div');
        el.className = dodande ? 'sd-slag is-tung' : 'sd-slag';
        overlay.appendChild(el);
        el.addEventListener('animationend', () => el.remove(), { once: true });
    };

    /* ------------------------------------------------------------------
     * SLISTEN
     * ---------------------------------------------------------------- */

    const ritaLiv = () => {
        const pips = overlay.querySelector('#sd-pips');
        if (pips) {
            /* Prickarna byggs en gång och byter klass, aldrig innerHTML: ett
             * nyskapat element börjar i sitt slutläge, och då syns aldrig att
             * ett liv slocknade. */
            pips.querySelectorAll('.sd-pip').forEach((pip, i) => {
                pip.classList.toggle('is-borta', i >= liv);
            });
        }
        const etikett = overlay.querySelector('#sd-liv-etikett');
        if (etikett) {
            if (liv <= 0) etikett.textContent = 'Inga liv kvar';
            else if (liv === 1) etikett.textContent = 'Sista livet';
            else etikett.textContent = `${liv} liv`;
        }
        /* Sista livet färgar hela rummet svagt varmt. Ingen skakning och ingen
         * puls — ett tillstånd som ligger kvar känns längre än ett ryck. */
        overlay.classList.toggle('is-sista-livet', liv === 1);
        overlay.classList.toggle('is-dod', liv <= 0);
    };

    const ritaRekordrad = () => {
        const rad = overlay.querySelector('#sd-rekord');
        const fyll = overlay.querySelector('#sd-rekord-fyll');
        const text = overlay.querySelector('#sd-rekord-text');
        if (!rad || !fyll || !text) return;

        if (rekord <= 0) {
            fyll.style.width = '0%';
            rad.classList.remove('is-nara', 'is-slaget');
            text.textContent = 'Rundan sätter rekordet';
            return;
        }
        const andel = Math.min(1, poang / rekord);
        fyll.style.width = `${(andel * 100).toFixed(1)}%`;
        const slaget = poang > rekord;
        rad.classList.toggle('is-slaget', slaget);
        rad.classList.toggle('is-nara', !slaget && andel >= NARA_REKORD);
        text.textContent = slaget
            ? `${poang - rekord} över rekordet`
            : `${rekord - poang} till rekordet`;
    };

    const ritaCombo = () => {
        const el = overlay.querySelector('#sd-combo');
        if (!el) return;
        const visa = svit >= 2;
        const m = comboFor(svit);
        el.textContent = visa ? `×${enDecimal(m)} · ${svit} i rad` : '';
        el.classList.toggle('is-on', visa);
        el.classList.toggle('is-tak', m >= COMBO_TAK);
    };

    /* Det extra livet är lägets enda väg tillbaka, och en morot man inte ser
     * drar ingen. Den tänds först när den är inom tre svar. */
    const ritaStatus = () => {
        const el = overlay.querySelector('#sd-status');
        if (!el) return;
        let text = '';
        if (liv < LIV && svit > 0) {
            const kvar = COMBO_LIV - (svit % COMBO_LIV);
            if (kvar <= 3) text = kvar === 1 ? '1 rätt till ett extra liv' : `${kvar} rätt till ett extra liv`;
        }
        el.textContent = text;
        el.classList.toggle('is-on', text !== '');
    };

    const ritaHud = () => {
        const poangEl = overlay.querySelector('#sd-poang');
        if (poangEl) poangEl.textContent = String(poang);
        const djupEl = overlay.querySelector('#sd-djup');
        if (djupEl) djupEl.textContent = `Kort ${djup}`;
        const nivaEl = overlay.querySelector('#sd-niva');
        if (nivaEl) nivaEl.textContent = `Nivå ${niva}`;
        ritaLiv();
        ritaRekordrad();
        ritaCombo();
        ritaStatus();
    };

    /* ------------------------------------------------------------------
     * TANGENTER
     * ---------------------------------------------------------------- */

    const tangentNed = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeGame();
            return;
        }

        /* Står fokus på en knapp sköter webbläsaren aktiveringen. Utan spärren
         * skulle Enter både köra handlaren och klicka knappen, och rundan
         * startade om två gånger. Spärren gäller bara bekräftelsetangenterna —
         * siffrorna ska välja svar var fokus än råkar stå. */
        const paKnapp = !!e.target?.closest?.('button');
        const bekraftar = (e.key === ' ' || e.key === 'Enter') && !paKnapp;

        if (lage === 'intro' || lage === 'slut') {
            if (bekraftar) {
                e.preventDefault();
                startaRunda();
            }
            return;
        }

        if (besvarat) {
            if (bekraftar) {
                e.preventDefault();
                vidare();
            }
            return;
        }

        if (['1', '2', '3', '4'].includes(e.key)) {
            e.preventDefault();
            const knapp = overlay.querySelectorAll('.sd-option-btn')[parseInt(e.key, 10) - 1];
            if (knapp) {
                knapp.classList.add('pressed');
                knapp.click();
            }
        }
    };

    /* Trycket ska släppa när fingret gör det, även om svaret redan är avgivet. */
    const tangentUpp = (e) => {
        if (!['1', '2', '3', '4'].includes(e.key)) return;
        const knapp = overlay.querySelectorAll('.sd-option-btn')[parseInt(e.key, 10) - 1];
        knapp?.classList.remove('pressed');
    };

    document.addEventListener('keydown', tangentNed);
    document.addEventListener('keyup', tangentUpp);

    /* Efter ett fel står spelet stilla tills man går vidare. Då ska hela ytan
     * duga som knapp — den som spelar med mus vill inte sikta. */
    overlay.addEventListener('mousedown', (e) => {
        if (lage !== 'spel' || !besvarat) return;
        if (e.target.closest('button')) return;
        vidare();
    });

    /* ------------------------------------------------------------------
     * RUNDAN
     * ---------------------------------------------------------------- */

    const startaRunda = () => {
        rensaTimers();
        ko = fisherYatesShuffle([...startKort]);
        koIdx = 0;
        poang = 0;
        djup = 0;
        ratt = 0;
        svit = 0;
        langstaSvit = 0;
        liv = LIV;
        niva = 1;
        snabbaste = null;
        miss = [];
        rekordSlaget = false;
        besvarat = false;
        lage = 'spel';
        overlay.classList.remove('is-sista-livet', 'is-dod');
        ritaArena();
        visaKort();
    };

    const nastaKort = () => {
        if (koIdx >= ko.length) {
            const pafyllning = fisherYatesShuffle([...pool]);
            /* Samma kort två gånger i rad läser som ett fel i spelet, inte som
             * slumpen. Det första flyttas sist när det råkar bli en dubblett. */
            if (pafyllning.length > 1 && ko.length && pafyllning[0].id === ko[ko.length - 1].id) {
                pafyllning.push(pafyllning.shift());
            }
            ko = pafyllning;
            koIdx = 0;
        }
        return ko[koIdx++];
    };

    const ritaArena = () => {
        overlay.innerHTML = `
            <div class="arena sd-arena">
                <div class="arena-top">
                    <div class="sd-liv-rad">
                        <span id="sd-pips" class="sd-pips" aria-hidden="true"
                            ><i class="sd-pip"></i><i class="sd-pip"></i><i class="sd-pip"></i
                        ></span>
                        <span id="sd-liv-etikett" class="sd-liv-etikett">${LIV} liv</span>
                    </div>
                    <div class="arena-meta num">
                        <span id="sd-niva">Nivå 1</span>
                        <span class="arena-sep" aria-hidden="true"></span>
                        <span id="sd-djup">Kort 1</span>
                    </div>
                </div>

                <div class="arena-timer">
                    <div class="progress"><i id="sd-klocka-fyll" class="progress-fill"></i></div>
                    <span id="sd-klocka-text" class="num">${enDecimal(KLOCKA_START / 1000)} s</span>
                </div>

                <div id="sd-rekord" class="sd-rekord">
                    <span id="sd-poang" class="sd-poang num">0</span>
                    <div class="progress"><i id="sd-rekord-fyll" class="progress-fill"></i></div>
                    <span id="sd-rekord-text" class="sd-rekord-text num"></span>
                </div>

                <div class="arena-body">
                    <div id="sd-fraga" class="arena-question"></div>
                    <div id="sd-alternativ" class="arena-options"></div>
                </div>

                <div class="arena-foot">
                    <span id="sd-status" class="sd-status" aria-live="polite"></span>
                    <span id="sd-combo" class="sd-combo num"></span>
                </div>
            </div>
        `;
    };

    /* ------------------------------------------------------------------
     * KORTET
     * ---------------------------------------------------------------- */

    const visaKort = () => {
        if (liv <= 0) {
            visaSlut();
            return;
        }
        rensaTimers();
        besvarat = false;

        const kort = nastaKort();
        if (!kort) {
            visaSlut();
            return;
        }
        djup++;
        ritaHud();

        const fragaEl = overlay.querySelector('#sd-fraga');
        if (fragaEl) {
            fragaEl.innerHTML = safeParse(kort.front);
            renderLatex(fragaEl);
            /* En animation startar inte om av att klassen läggs tillbaka. Utan
             * varvet över offsetWidth byter frågan text utan att röra sig, och
             * i ett läge där man svarar var fjärde sekund läses det som att
             * ingenting hände. */
            fragaEl.classList.remove('is-ny');
            void fragaEl.offsetWidth;
            fragaEl.classList.add('is-ny');
        }
        overlay.querySelector('.sd-avslojning')?.remove();

        const rattText = textAv(kort.back);
        const alternativ = byggAlternativ(kort, rattText);

        const behallare = overlay.querySelector('#sd-alternativ');
        if (!behallare) return;
        behallare.classList.remove('is-avgjord');
        behallare.innerHTML = '';

        alternativ.forEach((alt, i) => {
            const knapp = document.createElement('button');
            knapp.className = 'sd-option-btn sd-option-entry';
            /* Bara platsen i raden. Själva förskjutningen räknas i CSS ur
             * rörelsetokens, så att den nollas med resten vid mindre rörelse. */
            knapp.style.setProperty('--i', String(i));
            if (alt.correct) knapp.dataset.ratt = '1';
            knapp.innerHTML = `<span class="sd-key-badge">${i + 1}</span><span class="sd-opt-text"></span>`;
            knapp.querySelector('.sd-opt-text').innerHTML = safeParse(alt.text);
            renderLatex(knapp);
            knapp.addEventListener('click', (e) => {
                e.stopPropagation();
                svara(kort, alt, knapp, rattText);
            });
            behallare.appendChild(knapp);
        });

        klockaLangd = klockaForNiva(niva);
        startaKlockan(kort, rattText);
    };

    /* Distraktorerna hämtas i tre led: samma mapp först, sedan samma kortlek,
     * sist resten. Ett alternativ ur en helt annan kortlek går att sortera bort
     * utan att kunna kortet, och då mäter läget ingenting. */
    const byggAlternativ = (kort, rattText) => {
        const iSammaMapp = kort.sectionId
            ? pool.filter(
                  (c) => c.id !== kort.id && c.sectionId === kort.sectionId && textAv(c.back) !== rattText
              )
            : [];
        const iSammaLek = pool.filter(
            (c) =>
                c.id !== kort.id &&
                c.originalDeckId === kort.originalDeckId &&
                textAv(c.back) !== rattText &&
                !iSammaMapp.some((s) => s.id === c.id)
        );
        const ovriga = pool.filter(
            (c) =>
                c.id !== kort.id &&
                textAv(c.back) !== rattText &&
                !iSammaMapp.some((s) => s.id === c.id) &&
                !iSammaLek.some((s) => s.id === c.id)
        );

        const sedda = new Set();
        const fel = [];
        for (const c of [
            ...fisherYatesShuffle(iSammaMapp),
            ...fisherYatesShuffle(iSammaLek),
            ...fisherYatesShuffle(ovriga),
        ]) {
            const txt = textAv(c.back);
            if (sedda.has(txt)) continue;
            sedda.add(txt);
            fel.push(txt);
            if (fel.length === 3) break;
        }
        while (fel.length < 3) fel.push('—');

        return fisherYatesShuffle([
            { text: rattText, correct: true },
            { text: fel[0], correct: false },
            { text: fel[1], correct: false },
            { text: fel[2], correct: false },
        ]);
    };

    const startaKlockan = (kort, rattText) => {
        const fyll = overlay.querySelector('#sd-klocka-fyll');
        const text = overlay.querySelector('#sd-klocka-text');
        const rad = overlay.querySelector('.arena-timer');
        if (fyll) {
            fyll.style.transition = 'none';
            fyll.style.transform = 'scaleX(1)';
        }
        rad?.classList.remove('is-urgent');
        klockaStart = performance.now();

        const steg = (nu) => {
            if (besvarat) return;
            const kvar = Math.max(0, 1 - (nu - klockaStart) / klockaLangd);
            if (fyll) fyll.style.transform = `scaleX(${kvar})`;
            if (text) text.textContent = `${enDecimal((kvar * klockaLangd) / 1000)} s`;
            /* Ett enda skifte, inte tre. Färgen byter på sista tredjedelen och
             * storleken står stilla — ett hoppande tal mitt i en fråga stjäl
             * den uppmärksamhet det ska påminna om. */
            rad?.classList.toggle('is-urgent', kvar <= 0.33);
            if (kvar > 0) klockaRAF = requestAnimationFrame(steg);
        };
        klockaRAF = requestAnimationFrame(steg);

        klockaTimeout = setTimeout(() => {
            if (besvarat) return;
            missa(kort, null, rattText, 'Tiden ute', '(hann inte svara)');
        }, klockaLangd);
    };

    /* ------------------------------------------------------------------
     * SVARET
     * ---------------------------------------------------------------- */

    /* Bara märkningen. Det fullständiga svaret — med bilder och formler — hör
     * hemma i avslöjningen under, och att byta ut knappens text mot det gör att
     * hela rutnätet hoppar en fjärdedels sekund innan nästa kort ändå kommer. */
    const markeraRatt = () => {
        overlay.querySelector('.sd-option-btn[data-ratt]')?.classList.add('sd-correct');
    };

    const lasAlternativ = (valdKnapp) => {
        const behallare = overlay.querySelector('#sd-alternativ');
        behallare?.classList.add('is-avgjord');
        overlay.querySelectorAll('.sd-option-btn').forEach((b) => {
            b.classList.remove('pressed');
            if (b !== valdKnapp && !b.dataset.ratt) b.classList.add('is-tyst');
        });
    };

    const svara = (kort, alt, knapp, rattText) => {
        if (besvarat || lage !== 'spel') return;
        if (!alt.correct) {
            knapp.classList.add('sd-wrong');
            missa(kort, knapp, rattText, null, alt.text);
            return;
        }

        besvarat = true;
        rensaTimers();

        const anvand = (performance.now() - klockaStart) / klockaLangd;
        const svarMs = anvand * klockaLangd;
        if (snabbaste === null || svarMs < snabbaste) snabbaste = svarMs;

        ratt++;
        svit++;
        if (svit > langstaSvit) langstaSvit = svit;

        const snabb = anvand <= SNABB_ANDEL;
        const kortvarde = POANG_BAS + (niva - 1) * POANG_PER_NIVA;
        const vunnet = Math.round(kortvarde * (snabb ? SNABB_FAKTOR : 1) * comboFor(svit));
        poang += vunnet;

        /* Tio rätt i rad ger tillbaka det man förlorat, och när inget är
         * förlorat betalas samma bedrift i poäng. Annars vore en felfri runda
         * den enda där mekaniken inte finns. */
        let livtext = null;
        if (svit % COMBO_LIV === 0) {
            if (liv < LIV) {
                liv++;
                livtext = 'Extra liv';
            } else {
                poang += BONUS_FULLA_LIV;
                livtext = `${COMBO_LIV} i rad · +${BONUS_FULLA_LIV}`;
            }
        }

        const nyNiva = 1 + Math.floor(ratt / NIVA_STEG);
        const nivaUpp = nyNiva > niva;
        niva = nyNiva;

        /* Rekordet väger tyngst av alla besked. Det är ögonblicket hela läget
         * finns för, och det får inte drunkna i en poängsiffra. */
        if (!rekordSlaget && rekord > 0 && poang > rekord) {
            rekordSlaget = true;
            visaFlyt('Rekordet slaget', 'rekord');
        } else if (livtext) {
            visaFlyt(livtext, 'liv');
        } else if (nivaUpp) {
            visaFlyt(`Nivå ${niva} · ${enDecimal(klockaForNiva(niva) / 1000)} s`, 'niva');
        } else {
            visaFlyt(snabb ? `Snabbt +${vunnet}` : `+${vunnet}`, 'ratt');
        }

        markeraRatt();
        lasAlternativ(knapp);
        ritaHud();
        if (nivaUpp) markeraNiva();

        vidareTimeout = setTimeout(vidare, PAUS_VID_RATT);
    };

    const markeraNiva = () => {
        const el = overlay.querySelector('#sd-niva');
        if (!el) return;
        el.classList.remove('is-ny');
        void el.offsetWidth; /* en klass som läggs tillbaka startar inte om av sig själv */
        el.classList.add('is-ny');
    };

    const missa = (kort, knapp, rattText, ersattText, dittSvar) => {
        if (besvarat || lage !== 'spel') return;
        besvarat = true;
        rensaTimers();

        const foreDetta = comboFor(svit);
        const brutenCombo = svit >= 5;
        svit = 0;
        liv--;

        miss.push({
            kort,
            ditt: dittSvar || '(tomt)',
            djup,
            niva,
            dodande: liv <= 0,
        });

        markeraRatt();
        lasAlternativ(knapp);
        visaSlag(liv <= 0);

        if (ersattText) visaFlyt(ersattText, 'fel');
        else if (brutenCombo) visaFlyt(`Combo bruten ×${enDecimal(foreDetta)}`, 'fel');
        else visaFlyt('Fel', 'fel');

        ritaHud();
        visaAvslojning(kort, rattText);
    };

    /* Rätt svar är flyt, fel svar är stopp. Asymmetrin är hela poängen: det
     * enda tillfälle man behöver läsa svaret är när man inte kunde det, och då
     * ska spelet stå still tills man själv går vidare. */
    const visaAvslojning = (kort, rattText) => {
        const kropp = overlay.querySelector('.arena-body');
        if (!kropp) return;
        const slut = liv <= 0;
        const block = document.createElement('div');
        block.className = 'sd-avslojning arena-reveal';
        block.innerHTML = `
            <p class="micro">Rätt svar</p>
            <div id="sd-ratt-svar" class="arena-answer">${safeParse(kort.back || rattText)}</div>
            ${
                kort.description
                    ? `<div id="sd-fordjupning" class="sd-fordjupning">${safeParse(kort.description)}</div>`
                    : ''
            }
            <div class="sd-avslojning-foot">
                <button id="sd-vidare" class="btn primary">
                    ${slut ? 'Se resultatet' : 'Nästa kort'} <span class="kbd">Space</span>
                </button>
                <span class="sd-avslojning-liv ${slut ? 'is-dod' : ''}">${
                    slut ? 'Rundan är över' : liv === 1 ? 'Sista livet' : `${liv} liv kvar`
                }</span>
            </div>
        `;
        kropp.appendChild(block);

        const svarEl = block.querySelector('#sd-ratt-svar');
        if (svarEl) renderCardBackImages(svarEl, kort.backImages);
        renderLatex(block);

        const knapp = block.querySelector('#sd-vidare');
        knapp.addEventListener('click', (e) => {
            e.stopPropagation();
            vidare();
        });
        knapp.focus();
    };

    const vidare = () => {
        if (lage !== 'spel') return;
        rensaTimers();
        if (liv <= 0) visaSlut();
        else visaKort();
    };

    /* ------------------------------------------------------------------
     * SLUTBILDEN
     * ---------------------------------------------------------------- */

    const visaSlut = () => {
        rensaTimers();
        lage = 'slut';
        overlay.classList.remove('is-sista-livet', 'is-dod');

        const gammaltRekord = rekord;
        const gammaltDjup = rekordDjup;
        const nyttRekord = poang > gammaltRekord;
        if (nyttRekord) {
            rekord = poang;
            localStorage.setItem(pbKey, String(poang));
        }
        if (djup > rekordDjup) {
            rekordDjup = djup;
            localStorage.setItem(pbDjupKey, String(djup));
        }

        /* Spelhallens egen resultatvy läser poängen härifrån. */
        S.playgroundSessionStats.correct = poang;
        S.playgroundSessionStats.total = djup;

        const tak = Math.max(poang, gammaltRekord, 1);
        const bredd = (varde) => `${((varde / tak) * 100).toFixed(1)}%`;

        let utfall;
        let utfallKlass;
        if (gammaltRekord <= 0) {
            utfall = `Första rekordet är satt: ${poang} poäng att slå.`;
            utfallKlass = 'is-rekord';
        } else if (nyttRekord) {
            utfall = `Nytt rekord — ${poang - gammaltRekord} poäng bättre än förra.`;
            utfallKlass = 'is-rekord';
        } else if (poang >= gammaltRekord * NARA_REKORD) {
            utfall = `Bara ${gammaltRekord - poang} poäng från rekordet.`;
            utfallKlass = 'is-nara';
        } else {
            utfall = `${gammaltRekord - poang} poäng kvar till rekordet.`;
            utfallKlass = '';
        }

        const felPanel = miss.length
            ? `
            <section class="sd-panel">
                <p class="micro">Det du missade</p>
                <div class="sd-fel-lista">
                    ${miss
                        .map(
                            (m, i) => `
                        <article class="sd-fel ${m.dodande ? 'is-dodande' : ''}">
                            <p class="sd-fel-marke">${m.dodande ? `Sista livet · kort ${m.djup}` : `Kort ${m.djup}`}</p>
                            <div class="sd-fel-fraga">${safeParse(m.kort.front)}</div>
                            <div class="sd-fel-par">
                                <span class="sd-fel-etikett">Du svarade</span>
                                <span class="sd-fel-ditt">${escapeHtml(m.ditt)}</span>
                            </div>
                            <div class="sd-fel-par">
                                <span class="sd-fel-etikett">Rätt svar</span>
                                <span class="sd-fel-ratt" data-svar="${i}">${safeParse(m.kort.back)}</span>
                            </div>
                        </article>`
                        )
                        .join('')}
                </div>
            </section>`
            : '';

        overlay.innerHTML = `
            <div class="sd-slut ${miss.length ? 'har-fel' : ''}">
                <section class="sd-panel">
                    <p class="micro">Sudden Death · ${escapeHtml(pbTitle)}</p>
                    <p class="sd-slutpoang num ${nyttRekord ? 'is-rekord' : ''}">${poang}</p>
                    <p class="sd-slut-lead">Du föll på kort ${djup}, nivå ${niva}.</p>

                    <div class="sd-jmf">
                        <div class="sd-jmf-rad is-denna">
                            <span class="sd-jmf-namn">Denna runda</span>
                            <span class="progress"><i class="progress-fill" style="width:${bredd(poang)}"></i></span>
                            <span class="sd-jmf-tal num">${poang}</span>
                        </div>
                        <div class="sd-jmf-rad">
                            <span class="sd-jmf-namn">${nyttRekord ? 'Förra rekordet' : 'Ditt rekord'}</span>
                            <span class="progress"><i class="progress-fill-soft" style="width:${bredd(gammaltRekord)}"></i></span>
                            <span class="sd-jmf-tal num">${gammaltRekord}</span>
                        </div>
                    </div>

                    <p class="sd-utfall ${utfallKlass}">${utfall}</p>

                    <dl class="arena-stats">
                        <div>
                            <dt>Djup</dt>
                            <dd class="num">${djup} kort${gammaltDjup ? ` · rekord ${rekordDjup}` : ''}</dd>
                        </div>
                        <div>
                            <dt>Längsta combo</dt>
                            <dd class="num">×${enDecimal(comboFor(langstaSvit))} · ${langstaSvit} i rad</dd>
                        </div>
                        <div>
                            <dt>Högsta nivå</dt>
                            <dd class="num">${niva}</dd>
                        </div>
                        <div>
                            <dt>Klockan till sist</dt>
                            <dd class="num">${enDecimal(klockaForNiva(niva) / 1000)} s</dd>
                        </div>
                        <div>
                            <dt>Snabbaste svar</dt>
                            <dd class="num">${snabbaste === null ? '—' : `${enDecimal(snabbaste / 1000)} s`}</dd>
                        </div>
                    </dl>

                    <div class="arena-end-actions">
                        <button id="sd-igen" class="btn primary lg">En gång till <span class="kbd">Enter</span></button>
                        <button id="sd-avsluta" class="btn">Avsluta</button>
                    </div>
                </section>
                ${felPanel}
            </div>
        `;

        miss.forEach((m, i) => {
            const svarEl = overlay.querySelector(`.sd-fel-ratt[data-svar="${i}"]`);
            if (svarEl) renderCardBackImages(svarEl, m.kort.backImages);
        });
        renderLatex(overlay.querySelector('.sd-slut'));

        overlay.querySelector('#sd-igen').addEventListener('click', startaRunda);
        overlay.querySelector('#sd-avsluta').addEventListener('click', closeGame);
        /* Fokus står på omstarten. Impulsen efter en död är att trycka igen,
         * och den ska inte behöva leta efter en knapp. */
        overlay.querySelector('#sd-igen').focus();
    };

    /* ------------------------------------------------------------------
     * INGÅNGEN
     * ---------------------------------------------------------------- */

    const visaIntro = () => {
        lage = 'intro';
        overlay.innerHTML = `
            <div class="sd-intro">
                <p class="micro">Sudden Death</p>
                <h1 class="sd-intro-rubrik">Tre liv. Ett fel för mycket och det är slut.</h1>

                <div class="sd-rekordkort">
                    <div class="sd-rekordkort-tal-rad">
                        <span class="sd-rekordkort-tal num">${rekord}</span>
                        <span class="sd-rekordkort-enhet">poäng</span>
                    </div>
                    <p class="sd-rekordkort-under">${
                        rekord > 0
                            ? `Ditt rekord i ${escapeHtml(pbTitle)}${rekordDjup ? `, satt på ${rekordDjup} kort` : ''}.`
                            : `Inget rekord i ${escapeHtml(pbTitle)} än. Rundan sätter det.`
                    }</p>
                </div>

                <dl class="arena-stats">
                    <div>
                        <dt>Klockan</dt>
                        <dd class="num">${enDecimal(KLOCKA_START / 1000)} s, ner till ${enDecimal(KLOCKA_MIN / 1000)} s</dd>
                    </div>
                    <div>
                        <dt>Ny nivå</dt>
                        <dd>var ${NIVA_STEG}:e rätt, och kortet blir värt mer</dd>
                    </div>
                    <div>
                        <dt>Rätt i rad</dt>
                        <dd>upp till ×${COMBO_TAK} på poängen</dd>
                    </div>
                    <div>
                        <dt>${COMBO_LIV} rätt i rad</dt>
                        <dd>ett liv tillbaka</dd>
                    </div>
                </dl>

                <div class="sd-intro-foot">
                    <button id="sd-start" class="btn primary lg">Starta <span class="kbd">Space</span></button>
                    <button id="sd-lamna" class="btn">Avbryt</button>
                </div>
            </div>
        `;
        overlay.querySelector('#sd-start').addEventListener('click', startaRunda);
        overlay.querySelector('#sd-lamna').addEventListener('click', closeGame);
        overlay.querySelector('#sd-start').focus();
    };

    visaIntro();
};
