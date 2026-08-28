/* Fritext — skriv svaret ur minnet.
 *
 * Läget var funktionellt men tamt: man skrev, fick en procentsats och en rad
 * med nyckelord, och gick vidare. Ingenting byggdes upp under passet och
 * ingenting drog en tillbaka.
 *
 * Fyra saker gör om det till något man vill spela igen:
 *
 *   1. Måttet medan man skriver. Den tomma rutan är lägets svåraste ögonblick.
 *      En hårfin linje som fylls mot facits längd säger "du är i rätt
 *      storleksordning" utan att avslöja ett enda ord.
 *
 *   2. Nästan rätt räknas. Böjning och stavfel är minne, inte fel. Ett ord som
 *      ligger en Levenshtein-etta eller en svensk ändelse ifrån ger tre
 *      fjärdedels poäng och färgas bärnsten i stället för att strykas. Läget
 *      använder därför INGEN röd ton alls: det säger aldrig att man har fel,
 *      bara vad som fortfarande fattas.
 *
 *   3. Skillnaden syns ordvis. Ditt eget svar färgas om i samma stund det
 *      lämnas in — träff i accent, nästan i bärnsten, resten tyst — och facit
 *      får sina missade begrepp understrukna. Man ser exakt vad som skilde.
 *
 *   4. Kapplöpningen mot rekordet. Rekordet ligger som ett streck i linjen
 *      över frågan, på den takt det hade vid samma kort. Strecket börjar i
 *      högerkanten och vandrar inåt när man går om det. Det är den enda
 *      mekaniken som gör att man vill köra en gång till, och den är helt tyst.
 *
 * Ledtråden är lägets enda beslut: den visar svarets form — begreppens
 * begynnelsebokstav och längd — och sänker kortets poäng. Utan den fastnar ett
 * pass på ett kort man inte minns; med en kostnad är den ett val.
 */

import { S } from '../core/state.js';
import { escapeHtml, fisherYatesShuffle } from '../core/utils.js';
import { renderCardBackImages, safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { finishPlaygroundSession } from '../ui/playground.js';
import { oppnaSpelyta, stangSpelyta } from './spelyta.js';


/* ======================================================================
 * ORDMODELLEN
 *
 * Rena funktioner utan DOM. Bedömningen är lägets kärna och måste gå att läsa
 * på ett ställe.
 * ====================================================================== */

/* Bindeord bär ingen kunskap. De visas i facit men räknas aldrig, så att
 * procenten svarar på "hur mycket av innehållet mindes du" och inte "hur nära
 * ordagrant skrev du". */
const STOPPORD = new Set([
    'och', 'eller', 'men', 'att', 'som', 'den', 'det', 'de', 'dem', 'denna', 'detta', 'dessa',
    'ett', 'en', 'är', 'var', 'vara', 'blir', 'blev', 'har', 'hade', 'kan', 'ska', 'skall',
    'inte', 'icke', 'också', 'även', 'bara', 'endast', 'mycket', 'mer', 'mest', 'sedan',
    'redan', 'genom', 'dock', 'samt', 'vars', 'där', 'här', 'hur', 'när', 'vad', 'vem',
    'vilken', 'vilket', 'vilka', 'med', 'utan', 'från', 'till', 'för', 'mot', 'hos', 'ur',
    'bland', 'inom', 'över', 'under', 'mellan', 'efter', 'före', 'vid', 'på', 'av', 'om',
    'alla', 'andra', 'sin', 'sitt', 'sina', 'han', 'hon', 'hen', 'vi', 'ni', 'jag', 'du',
    'sig', 'man', 'sitt', 'ju', 'så', 'ska', 'skulle', 'vill', 'får', 'gör',
]);

/* Svenska ändelser, längst först. Stammen måste behålla minst fyra tecken —
 * annars blir "sina" till "s" och matchar allt. Listan täcker böjning, inte
 * avledning: "cellens" och "cellen" ska mötas, "cellulär" ska inte. */
const ANDELSER = [
    'ernas', 'arnas', 'ornas', 'andet', 'anden', 'arna', 'erna', 'orna', 'ande', 'ende',
    'erns', 'aste', 'are', 'ast', 'ens', 'ers', 'ets', 'ars', 'ors', 'en', 'er', 'ar',
    'or', 'et', 'na', 'ns', 'ts', 'as', 'n', 't', 's', 'e', 'a',
].sort((a, b) => b.length - a.length);

const stam = (ord) => {
    for (const andelse of ANDELSER) {
        if (ord.length - andelse.length >= 4 && ord.endsWith(andelse)) {
            return ord.slice(0, -andelse.length);
        }
    }
    return ord;
};

/* Levenshtein med tak. Taket gör den billig: så fort hela raden ligger över
 * tröskeln kan svaret inte bli bättre, och ett pass jämför hundratals par. */
const avstand = (a, b, tak) => {
    if (Math.abs(a.length - b.length) > tak) return tak + 1;
    const rad = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let hornet = rad[0];
        rad[0] = i;
        let minsta = i;
        for (let j = 1; j <= b.length; j++) {
            const forra = rad[j];
            rad[j] = Math.min(rad[j] + 1, rad[j - 1] + 1, hornet + (a[i - 1] === b[j - 1] ? 0 : 1));
            hornet = forra;
            if (rad[j] < minsta) minsta = rad[j];
        }
        if (minsta > tak) return tak + 1;
    }
    return rad[b.length];
};

/* Tre sätt att vara nästan rätt, och de täcker olika saker: samma stam fångar
 * böjningen ("cellen"/"cellens"), avståndet fångar stavfelet, och avståndet
 * mellan stammarna fångar båda på en gång ("glukos"/"glukosen", där ändelsen
 * kapas olika långt).
 *
 * Två spärrar håller generositeten från att bli slarv. Korta ord får ingen
 * tolerans alls — "hus" och "mus" är inte samma minne, och inte "kall" och
 * "kalv". Och avståndet kräver samma begynnelsebokstav: ett stavfel sitter
 * nästan aldrig i första tecknet, medan "öster" och "väster" annars hade
 * räknats som samma ord. */
const matcha = (a, b) => {
    if (a === b) return 'exakt';
    if (a.length < 4 || b.length < 4) return null;

    const sa = stam(a);
    const sb = stam(b);
    if (sa === sb) return 'nara';

    if (a[0] !== b[0]) return null;

    if (Math.min(a.length, b.length) >= 5) {
        const tak = Math.min(a.length, b.length) >= 7 ? 2 : 1;
        if (avstand(a, b, tak) <= tak) return 'nara';
    }
    if (Math.min(sa.length, sb.length) >= 5 && avstand(sa, sb, 1) <= 1) return 'nara';

    return null;
};

/* Taggar bort utan att gå via DOM: innehållet är användarens eget och behöver
 * aldrig tolkas som markup för att kunna räknas. */
const tillText = (html) => {
    if (!html) return '';
    return String(html)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/[ \t]+/g, ' ')
        .trim();
};

/* Mellanrummen blir egna tecken i listan i stället för att kastas. Då kan
 * texten sättas ihop igen precis som den skrevs, radbrytningar och allt, med
 * bara orden inlindade. */
const dela = (text) => text
    .split(/(\s+)/)
    .filter((bit) => bit.length > 0)
    .map((bit) => {
        const norm = bit.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const ord = norm.length > 0;
        return {
            ra: bit,
            norm,
            ord,
            innehall: ord && norm.length >= 3 && !STOPPORD.has(norm),
            traff: null,
        };
    });

/* Påsjämförelse, inte sekvensjämförelse. Att minnas ett begrepp och att minnas
 * ordföljden är olika saker, och läget frågar efter det första: "cellens
 * kraftverk är mitokondrien" ska ge samma poäng som facits ordning.
 *
 * Två svep, exakta träffar först. Annars kan ett nästan-lika ord lägga beslag
 * på det ord som var någon annans exakta match. */
const jamfor = (facit, svar) => {
    for (const niva of ['exakt', 'nara']) {
        for (const f of facit) {
            if (!f.innehall || f.traff) continue;
            for (const s of svar) {
                if (!s.ord || s.traff) continue;
                if (matcha(s.norm, f.norm) !== niva) continue;
                s.traff = niva;
                f.traff = niva;
                break;
            }
        }
    }

    const innehall = facit.filter((f) => f.innehall);
    const exakta = innehall.filter((f) => f.traff === 'exakt').length;
    const nara = innehall.filter((f) => f.traff === 'nara').length;

    /* Facit utan innehållsord — "Ja", "1789" — har inget att räkna. Då jämförs
     * hela svaret mot hela facit i stället, med samma tolerans. */
    let del;
    if (innehall.length === 0) {
        const a = facit.map((t) => t.norm).join('');
        const b = svar.map((t) => t.norm).join('');
        const niva = a && b ? matcha(b, a) : null;
        del = niva === 'exakt' ? 1 : niva === 'nara' ? 0.75 : 0;
    } else {
        del = (exakta + 0.75 * nara) / innehall.length;
    }

    return { traff: Math.round(del * 100), exakta, nara, begrepp: innehall.length };
};

/* Sätter ihop texten igen med orden inlindade. Bara det som gav poäng får en
 * klass — resten står kvar i sin egen ton, aldrig överstruket. */
const rita = (tokens, roll) => tokens.map((t) => {
    if (!t.ord) return escapeHtml(t.ra);
    let klass = '';
    if (t.traff === 'exakt') klass = 'ft-ord ft-ord--traff';
    else if (t.traff === 'nara') klass = 'ft-ord ft-ord--nara';
    else if (roll === 'facit' && t.innehall) klass = 'ft-ord ft-ord--miss';
    return klass ? `<span class="${klass}">${escapeHtml(t.ra)}</span>` : escapeHtml(t.ra);
}).join('');

/* Formler, kod, tabeller och bilder överlever inte en ordvis uppdelning. De
 * korten får facit renderat som vanligt och begreppen man missade som en egen
 * rad — hellre en tystare återkoppling än ett sönderskrivet facit. */
const harFormatering = (text) => /[$`|*_#<>[\]\\]/.test(text || '');

/* Ledtråden är svarets form, inte dess innehåll: begynnelsebokstaven och exakt
 * så många prickar som ordet har tecken kvar. Man ser hur långt man har kvar
 * utan att få något gratis. */
const maskera = (facit, niva) => {
    const begrepp = facit.filter((t) => t.innehall).slice(0, 12);
    const masker = begrepp.map((t) => t.norm.slice(0, niva) + '·'.repeat(Math.max(0, t.norm.length - niva)));
    const fler = facit.filter((t) => t.innehall).length - begrepp.length;
    return masker.join('  ') + (fler > 0 ? `  +${fler}` : '');
};


/* ======================================================================
 * REKORDET
 *
 * Nyckeln följer fokusområdet, som i Sudden Death, och dessutom antalet kort:
 * ett pass på sex kort och ett på tio är inte samma tävling.
 * ====================================================================== */

const rekordnyckel = (antal) => {
    let bas = 'spaced_rep_ft_pb_all';
    if (S.playgroundFilterSource && S.playgroundFilterSource.size > 0) {
        const kortlekar = new Set();
        S.playgroundFilterSource.forEach((val) => {
            const trafF = val.match(/^deck:([^:]+)/);
            if (trafF) kortlekar.add(trafF[1]);
        });
        if (kortlekar.size === 1) bas = `spaced_rep_ft_pb_${Array.from(kortlekar)[0]}`;
        else if (kortlekar.size > 1) bas = `spaced_rep_ft_pb_focus_${Array.from(kortlekar).sort().join('_')}`;
    }
    return `${bas}_${antal}`;
};

const lasRekord = (nyckel) => {
    try { return parseInt(localStorage.getItem(nyckel) || '0', 10) || 0; } catch { return 0; }
};

const skrivRekord = (nyckel, varde) => {
    // Privat läge kastar. Rekordet får leva i sessionen i stället för att fälla passet.
    try { localStorage.setItem(nyckel, String(varde)); } catch { /* tyst */ }
};


/* ======================================================================
 * OMDÖMET
 *
 * Ett ord i stället för bara ett tal. Talet säger hur mycket, ordet säger vad
 * det betyder — och inget av dem säger "fel".
 * ====================================================================== */

const omdome = (traff) => {
    if (traff >= 100) return 'Ordagrant';
    if (traff >= 85) return 'Nästan allt';
    if (traff >= 60) return 'Kärnan sitter';
    if (traff >= 35) return 'Halvvägs';
    if (traff > 0) return 'Fragment';
    return 'Blankt';
};

const STARK = 60;                       // gränsen för att serien ska hålla
const LEDTRADSKOSTNAD = [1, 0.7, 0.45]; // ingen, en, två ledtrådar
const siffra = (v) => `<span class="num">${v}</span>`;
const tal = (v) => v.toLocaleString('sv-SE');


export const fritextSessionReveal = () => {
    const grundkort = [...S.currentStudyCards];
    const nyckel = rekordnyckel(grundkort.length);

    let kort = grundkort;
    let rekord = lasRekord(nyckel);
    let arOmtag = false;

    let index = 0;
    let klara = 0;
    let poang = 0;
    let serie = 0;
    let langstaSerie = 0;
    let naraTotalt = 0;
    let ledtradarTotalt = 0;
    let traffSumma = 0;
    let utfallen = [];

    let lage = 'skriv';       // skriv | facit | slut
    let ledtradar = 0;        // för det kort som visas just nu

    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    overlay.className = 'cinema-overlay ft-overlay';

    oppnaSpelyta(overlay);

    /* Passet har redan en egen slutbild med rekordjämförelsen. Den generiska
     * resultatvyn efteråt hade sagt samma sak sämre, så utgången hoppar över
     * den och går rakt till spelhallen. */
    const avsluta = () => {
        document.removeEventListener('keydown', tangent);
        stangSpelyta(overlay, () => finishPlaygroundSession(true));
    };

    /* Rekordets takt vid samma kort. Att jämföra mot slutsumman hade sagt
     * "du ligger 700 efter" på kort ett; takten säger om man är före eller
     * efter sitt eget bästa jag just nu. */
    const takt = () => (rekord > 0 ? Math.round((rekord * klara) / kort.length) : 100 * klara);

    /* Kapplöpningen. Skalan är den största av poängen och takten, så att
     * rekordstrecket står i högerkanten tills man går om det och sedan
     * vandrar inåt. Ingen text behöver säga att man leder. */
    const kapplinje = () => {
        /* Ett omtag på ett urval kort är inte samma tävling som ett helt pass,
         * och en linje utan mätning hade sett ut som en mätare på noll. */
        if (arOmtag) {
            return `<div class="ft-kapp is-omtag">
                <span class="micro">Omtag</span>
                <span class="ft-kapp-delta">Räknas inte mot rekordet</span>
            </div>`;
        }

        const mal = takt();
        const skala = Math.max(poang, mal, 1);
        const namn = rekord > 0 ? `Rekord ${tal(rekord)}` : 'Riktmärke';
        const diff = poang - mal;

        let delta = rekord > 0 ? 'Kör igång' : 'Första passet';
        let fore = false;
        if (klara > 0) {
            if (poang > rekord && rekord > 0) { delta = 'Rekordet slaget'; fore = true; }
            else if (diff > 0) { delta = `${tal(diff)} före`; fore = true; }
            else if (diff < 0) { delta = `${tal(-diff)} efter`; }
            else { delta = 'Jämnt'; }
        }

        return `<div class="ft-kapp${fore ? ' is-fore' : ''}">
            <span class="micro">${namn}</span>
            <div class="ft-kapp-spar">
                <i class="ft-kapp-fyll" style="transform:scaleX(${poang / skala})"></i>
                ${mal > 0 ? `<i class="ft-kapp-tick" style="left:${(mal / skala) * 100}%"></i>` : ''}
            </div>
            <span class="ft-kapp-delta num">${delta}</span>
        </div>`;
    };

    const slist = () => `<div class="arena-top">
        <span class="micro">Fritext</span>
        <span class="arena-meta num">
            <span>${tal(poang)} p</span>
            <span class="arena-sep" aria-hidden="true"></span>
            <span>${Math.min(index + 1, kort.length)} av ${kort.length}</span>
        </span>
    </div>`;

    /* ------------------------------------------------------------------
     * SKRIVLÄGET
     * ---------------------------------------------------------------- */

    const visaKort = () => {
        if (index >= kort.length) { visaSlut(); return; }

        lage = 'skriv';
        ledtradar = 0;

        const kortet = kort[index];
        const facitText = tillText(kortet.back || '');
        const facitOrd = dela(facitText);
        const ordAntal = facitOrd.filter((t) => t.ord).length;

        const ritaSkrivlage = () => {
            overlay.innerHTML = `
                <div class="arena ft-arena">
                    ${slist()}
                    ${kapplinje()}
                    <div class="arena-body">
                        <div class="ft-fraga">${safeParse(kortet.front || '')}</div>
                        ${ledtradar > 0 ? `<div class="ft-ledtrad">
                            <p class="micro">Svarets form</p>
                            <p class="ft-ledtrad-ord num">${escapeHtml(maskera(facitOrd, ledtradar))}</p>
                        </div>` : ''}
                        <div class="ft-svarsruta">
                            <label class="micro" for="ft-falt">Ditt svar</label>
                            <textarea id="ft-falt" class="ft-falt" spellcheck="false" autocomplete="off" autocapitalize="sentences"></textarea>
                            <div id="ft-matt" class="ft-matt">
                                <div class="ft-matt-spar"><i id="ft-matt-fyll" class="ft-matt-fyll"></i></div>
                                <span id="ft-matt-tal" class="ft-matt-tal num">0 · ~${ordAntal} ord</span>
                            </div>
                        </div>
                    </div>
                    <div class="arena-foot">
                        <button id="ft-ledtrad" type="button" class="btn text"${ledtradar >= 2 ? ' disabled' : ''}>
                            ${ledtradar === 0 ? 'Ledtråd' : ledtradar === 1 ? 'Mer ledtråd' : 'Ledtråd använd'}
                            ${ledtradar < 2 ? `<span class="ft-kostnad num">×${String(LEDTRADSKOSTNAD[ledtradar + 1]).replace('.', ',')}</span>` : ''}
                        </button>
                        <button id="ft-ratta" type="button" class="btn primary">Rätta <span class="kbd">⌘↵</span></button>
                    </div>
                </div>
            `;
            renderLatex(overlay.querySelector('.ft-fraga'));

            const falt = overlay.querySelector('#ft-falt');
            const matt = overlay.querySelector('#ft-matt');
            const fyll = overlay.querySelector('#ft-matt-fyll');
            const mattTal = overlay.querySelector('#ft-matt-tal');

            /* Måttet är lägets enda återkoppling medan man skriver, och det
             * enda som får finnas: allt som röjde innehåll hade gjort
             * rutan till en gissningslek i stället för ett minnesprov. */
            const uppdateraMatt = () => {
                const skrivet = falt.value.trim();
                const antal = skrivet ? skrivet.split(/\s+/).length : 0;
                const andel = ordAntal > 0 ? Math.min(1, antal / ordAntal) : 0;
                fyll.style.transform = `scaleX(${andel})`;
                mattTal.textContent = `${antal} · ~${ordAntal} ord`;
                matt.classList.toggle('is-nara', ordAntal > 0 && antal >= ordAntal * 0.7);
            };
            falt.addEventListener('input', uppdateraMatt);
            uppdateraMatt();

            overlay.querySelector('#ft-ratta').addEventListener('click', () => ratta(falt.value, facitOrd));

            overlay.querySelector('#ft-ledtrad').addEventListener('click', () => {
                if (ledtradar >= 2) return;
                /* Ledtråden ritar om hela skrivläget. Både texten och
                 * skrivmarkören måste följa med över — att be om hjälp mitt i
                 * en mening får inte kosta meningen. */
                const skrivet = falt.value;
                const markor = falt.selectionStart;
                ledtradar++;
                ledtradarTotalt++;
                ritaSkrivlage();
                const nyttFalt = overlay.querySelector('#ft-falt');
                nyttFalt.value = skrivet;
                nyttFalt.setSelectionRange(markor, markor);
                nyttFalt.dispatchEvent(new Event('input'));
            });

            requestAnimationFrame(() => falt.focus());
        };

        ritaSkrivlage();
    };

    /* ------------------------------------------------------------------
     * RÄTTNINGEN
     * ---------------------------------------------------------------- */

    const ratta = (svarText, facitOrd) => {
        if (lage !== 'skriv') return;
        lage = 'facit';

        const kortet = kort[index];
        const svarOrd = dela(svarText.trim());
        const resultat = jamfor(facitOrd, svarOrd);

        const stark = resultat.traff >= STARK;
        const multiplikator = 1 + Math.min(serie, 5) * 0.1;
        const perfekt = resultat.traff === 100 ? 25 : 0;
        const kostnad = LEDTRADSKOSTNAD[ledtradar] ?? 0.45;
        const kortpoang = Math.round((resultat.traff + perfekt) * multiplikator * kostnad);

        poang += kortpoang;
        klara++;
        traffSumma += resultat.traff;
        naraTotalt += resultat.nara;
        utfallen.push({ kort: kortet, traff: resultat.traff });

        if (stark) {
            serie++;
            if (serie > langstaSerie) langstaSerie = serie;
            S.playgroundSessionStats.correct++;
        } else {
            serie = 0;
            S.playgroundSessionStats.again++;
        }

        const ton = resultat.traff >= STARK ? ' is-hog' : resultat.traff >= 35 ? ' is-mellan' : ' is-lag';

        /* Ordningen i detaljraden är avsiktlig: först hur mycket som satt, sedan
         * generositeten, sist bonusen. Nästan-rätt ska stå bredvid poängen och
         * inte gömmas i en fotnot — det är hela poängen med den. */
        const delar = [];
        if (resultat.begrepp > 0) delar.push(`${siffra(resultat.exakta + resultat.nara)} av ${siffra(resultat.begrepp)} begrepp`);
        if (resultat.nara > 0) delar.push(`${siffra(resultat.nara)} nästan rätt — räknas`);
        if (multiplikator > 1) delar.push(`serie ${siffra('×' + multiplikator.toFixed(1).replace('.', ','))}`);
        if (perfekt > 0) delar.push('ordagrant +25');
        if (ledtradar > 0) delar.push(`ledtråd ${siffra('×' + String(kostnad).replace('.', ','))}`);

        const rikt = harFormatering(kortet.back);
        const missade = facitOrd.filter((t) => t.innehall && !t.traff);
        const sista = index + 1 >= kort.length;

        overlay.innerHTML = `
            <div class="arena ft-arena">
                ${slist()}
                ${kapplinje()}
                <div class="arena-body">
                    <div class="ft-utfall ft-in" style="--i:0" role="status">
                        <div class="ft-utfall-topp">
                            <span class="ft-procent num${ton}">${resultat.traff}<span class="ft-procent-tecken">%</span></span>
                            <span class="ft-omdome">${omdome(resultat.traff)}</span>
                            <span class="ft-kortpoang num${kortpoang > 0 ? '' : ' is-noll'}">+${tal(kortpoang)}</span>
                        </div>
                        <div class="ft-traffspar"><i class="ft-traffyll${ton}" style="transform:scaleX(${resultat.traff / 100})"></i></div>
                        ${delar.length ? `<p class="ft-detalj">${delar.join(' · ')}</p>` : ''}
                    </div>

                    <div class="ft-block ft-in" style="--i:1">
                        <p class="micro">Ditt svar</p>
                        <div class="ft-svar">${svarOrd.length ? rita(svarOrd, 'svar') : '<span class="ft-tomt">Du lämnade rutan tom.</span>'}</div>
                    </div>

                    <div class="ft-block ft-in" style="--i:2">
                        <p class="micro">Facit</p>
                        <div id="ft-facit" class="ft-facit${rikt ? '' : ' is-markerad'}">${rikt ? safeParse(kortet.back || '') : rita(facitOrd, 'facit')}</div>
                        ${rikt && missade.length ? `<div class="ft-missade">${missade.slice(0, 12).map((t) => `<span class="ft-missad">${escapeHtml(t.ra)}</span>`).join('')}${missade.length > 12 ? `<span class="ft-missad ft-missad--fler num">+${missade.length - 12}</span>` : ''}</div>` : ''}
                    </div>

                    ${kortet.description ? `<div class="ft-block ft-in" style="--i:3">
                        <p class="micro">Fördjupning</p>
                        <div id="ft-fordjupning" class="ft-fordjupning">${safeParse(kortet.description)}</div>
                    </div>` : ''}
                </div>
                <div class="arena-foot arena-foot--center">
                    <button id="ft-nasta" type="button" class="btn primary">${sista ? 'Se resultatet' : 'Nästa kort'} <span class="kbd">⏎</span></button>
                </div>
            </div>
        `;

        const facitEl = overlay.querySelector('#ft-facit');
        if (rikt) renderLatex(facitEl);
        renderCardBackImages(facitEl, kortet.backImages);
        const fordjupningEl = overlay.querySelector('#ft-fordjupning');
        if (fordjupningEl) renderLatex(fordjupningEl);

        const nastaKnapp = overlay.querySelector('#ft-nasta');
        nastaKnapp.addEventListener('click', nasta);
        /* Fokus på knappen, inte bara ett tangentbordsgenväg i luften: då
         * fungerar Retur och blanksteg av sig själva, och skärmläsaren landar
         * på det som faktiskt ska göras härnäst. */
        requestAnimationFrame(() => nastaKnapp.focus({ preventScroll: true }));
    };

    const nasta = () => {
        if (lage !== 'facit') return;
        index++;
        visaKort();
    };

    /* ------------------------------------------------------------------
     * SLUTBILDEN
     * ---------------------------------------------------------------- */

    const visaSlut = () => {
        lage = 'slut';

        const tidigare = rekord;
        const raknas = !arOmtag && klara === kort.length;
        const nyttRekord = raknas && poang > tidigare;
        if (nyttRekord) { rekord = poang; skrivRekord(nyckel, poang); }

        const snitt = klara > 0 ? Math.round(traffSumma / klara) : 0;
        const skala = Math.max(poang, tidigare, 1);

        /* Raden ska säga vad man ska göra med talet ovanför. Ett avstånd till
         * rekordet är det enda som får en att vilja köra igen — "bra jobbat"
         * hade varit ett slut, inte en fortsättning. */
        let lead;
        if (arOmtag) lead = 'Omtaget räknas inte mot rekordet — det var övning.';
        else if (nyttRekord && tidigare > 0) lead = `Nytt rekord. Du slog det gamla med ${tal(poang - tidigare)} poäng.`;
        else if (nyttRekord) lead = 'Första passet är i hus. Nu finns det något att slå.';
        else if (tidigare === 0) lead = 'Rekordet står fortfarande öppet.';
        else if (poang === tidigare) lead = 'Exakt jämnt med rekordet.';
        else lead = `${tal(tidigare - poang)} poäng från rekordet.`;

        const svaga = utfallen.filter((u) => u.traff < STARK).sort((a, b) => a.traff - b.traff);

        const rader = [
            { t: 'Kort', v: tal(klara) },
            { t: 'Träffsäkerhet', v: `${snitt} %` },
            { t: 'Längsta serie', v: tal(langstaSerie) },
        ];
        if (naraTotalt > 0) rader.push({ t: 'Nästan rätt', v: tal(naraTotalt) });
        if (ledtradarTotalt > 0) rader.push({ t: 'Ledtrådar', v: tal(ledtradarTotalt) });

        overlay.innerHTML = `
            <div class="arena ft-arena arena--end">
                <p class="micro">Fritext</p>
                <h2 class="ft-slutpoang num">${tal(poang)}</h2>
                <p class="ft-slutlead${nyttRekord ? ' is-rekord' : ''}">${lead}</p>

                ${arOmtag ? '' : `<div class="ft-jamfor">
                    <div class="ft-jamfor-rad is-nu">
                        <span class="ft-jamfor-namn">Nu</span>
                        <div class="ft-jamfor-spar"><i style="transform:scaleX(${poang / skala})"></i></div>
                        <span class="ft-jamfor-tal num">${tal(poang)}</span>
                    </div>
                    <div class="ft-jamfor-rad">
                        <span class="ft-jamfor-namn">${nyttRekord ? 'Tidigare' : 'Rekord'}</span>
                        <div class="ft-jamfor-spar"><i style="transform:scaleX(${tidigare / skala})"></i></div>
                        <span class="ft-jamfor-tal num">${tal(tidigare)}</span>
                    </div>
                </div>`}

                <dl class="ft-slutlista">
                    ${rader.map((r) => `<div><dt>${r.t}</dt><dd class="num">${r.v}</dd></div>`).join('')}
                </dl>

                ${svaga.length ? `<div class="ft-svaga">
                    <p class="micro">Satt sämst</p>
                    ${svaga.slice(0, 4).map((u) => `<div class="ft-svag">
                        <span class="ft-svag-fraga">${escapeHtml(tillText(u.kort.front || '').slice(0, 90))}</span>
                        <span class="ft-svag-tal num">${u.traff} %</span>
                    </div>`).join('')}
                </div>` : ''}

                <div class="arena-end-actions">
                    ${svaga.length ? `<button id="ft-svaga-om" type="button" class="btn primary">Ta om de svaga (${svaga.length})</button>` : ''}
                    <button id="ft-igen" type="button" class="btn${svaga.length ? '' : ' primary'}">Spela igen</button>
                    <button id="ft-avsluta" type="button" class="btn text">Avsluta</button>
                </div>
            </div>
        `;

        const omStart = (nyaKort, omtag) => {
            kort = nyaKort;
            arOmtag = omtag;
            index = 0;
            klara = 0;
            poang = 0;
            serie = 0;
            langstaSerie = 0;
            naraTotalt = 0;
            ledtradarTotalt = 0;
            traffSumma = 0;
            utfallen = [];
            S.playgroundSessionStats = { correct: 0, again: 0, total: nyaKort.length, startTime: Date.now() };
            visaKort();
        };

        const svagaKnapp = overlay.querySelector('#ft-svaga-om');
        if (svagaKnapp) svagaKnapp.addEventListener('click', () => omStart(svaga.map((u) => u.kort), true));
        overlay.querySelector('#ft-igen').addEventListener('click', () => omStart(fisherYatesShuffle([...grundkort]), false));
        overlay.querySelector('#ft-avsluta').addEventListener('click', avsluta);

        const forst = overlay.querySelector('.arena-end-actions .btn.primary');
        if (forst) requestAnimationFrame(() => forst.focus({ preventScroll: true }));
    };

    /* ------------------------------------------------------------------
     * TANGENTERNA
     *
     * En enda lyssnare för hela läget. Den gamla versionen la på en andra
     * lyssnare vid varje rättning och tog bara bort den när den fick löpa
     * färdigt — avbröt man passet mitt i ett facit låg den kvar på
     * document och svarade på blanksteg långt efter att ytan var borta.
     * ---------------------------------------------------------------- */

    const tangent = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); avsluta(); return; }

        /* Står fokus på en knapp sköter webbläsaren aktiveringen själv, och en
         * egen hantering hade utlöst handlingen två gånger. Genvägen med
         * kommandotangent går ändå igenom: den hör till läget, inte till
         * knappen som råkar ha fokus. */
        if (e.target instanceof Element && e.target.closest('button') && !e.metaKey && !e.ctrlKey) return;

        if (lage === 'skriv') {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                overlay.querySelector('#ft-ratta')?.click();
            }
            return;
        }

        if (lage === 'facit' && (e.key === ' ' || e.key === 'Enter')) {
            e.preventDefault();
            nasta();
        }
    };
    document.addEventListener('keydown', tangent);

    visaKort();
};
