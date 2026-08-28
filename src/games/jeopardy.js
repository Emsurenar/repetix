import { S } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { renderCardBackImages, safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { finishPlaygroundSession } from '../ui/playground.js';
import { oppnaSpelyta, stangSpelyta } from './spelyta.js';

/* Jeopardy — "Du ser svaret. Gissa frågan."
 *
 * Läget var en bläddrare: femton svar i rad, en knapp som visade frågan, en
 * slutskärm som räknade hur många kort som passerat. Ingenting stod på spel, så
 * ingenting drog.
 *
 * Det som gör formatet spännande är inte avslöjandet utan ORDNINGEN: man
 * bestämmer vad en ledtråd är värd innan man sett den. Fyra beslut, som alla
 * kostar något:
 *
 *   Rutan    Tre potter per runda, och den största hör alltid till det kort du
 *            kan sämst — ordningen räknas ur din egen repetitionshistorik.
 *            Girighet köper ett svårare kort, inte bara ett större tal. Den som
 *            spelar försiktigt hela vägen sparar därför de svåraste korten till
 *            finalen, där de är värda mest och kostar mest.
 *   Klockan  Potten sjunker medan man tänker, insatsen man riskerar gör det
 *            inte. Att tänka färdigt är alltid tillåtet och aldrig gratis.
 *   Sviten   Tre rätt i rad ger ×1,5, fem ger ×2, en miss nollar. Det man till
 *            slut är rädd om är inte poängen utan sviten.
 *   Finalen  Sista ledtråden satsas det fritt på, upp till hela kassan. Där
 *            avgörs rekordet — och det är rekordet man kommer tillbaka för.
 *
 * Bedömningen är egen, som allt annat i appen. Det som håller den ärlig är att
 * insatsen är låst innan frågan syns: att svara "rätt" på något man passerat
 * kostar bara en själv, och beslutet att våga är redan taget.
 *
 * Schemaläggningen rörs aldrig. playground.js vänder fram- och baksida och
 * märker kopiorna med `_jeopardy`, och processRating hoppar därför över dem.
 * Det här är ett spel om korten, inte en repetition av dem.
 */

/* Poängstegen, en per svårighetsnivå. Andra halvan av spelet dubblar dem: den
 * som ligger under kan fortfarande ta igen allt, och den som leder har
 * plötsligt något att förlora. */
const STEG = [200, 400, 600];

/* Vad potten som lägst sjunker till när klockan gått ut. Fyra tiondelar är nog
 * för att det ska löna sig att svara sent hellre än att passa, och för lite för
 * att man ska våga tänka färdigt. */
const LAGSTA_ANDEL = 0.4;

/* Grundtiden krymper en sekund per runda ner till sju. Kortleken blir svårare
 * av sig själv när de lätta korten är spelade; klockan ser till att även den
 * som valt lätt hela vägen känner det. Lästiden nedan läggs till. */
const BETANKETID = 14;
const MINSTA_BETANKETID = 7;
const FINALTID = 18;

const svitfaktor = (n) => (n >= 5 ? 2 : n >= 3 ? 1.5 : 1);

/* Klockan ska räcka till att LÄSA ledtråden också, inte bara till att minnas.
 * Ett svar på tre ord och ett på tre meningar fick annars samma tid, och det
 * långa kortet blev svårt av fel skäl. Råtexten duger som mått: den är längre
 * än den renderade, vilket bara är generöst åt rätt håll. */
const lastid = (kort) => Math.min(6, Math.floor(String(kort.front || '').length / 70));

const tal = (n) => Math.round(n).toLocaleString('sv-SE');
const decimal = (n) => n.toLocaleString('sv-SE');
const tiotal = (n) => Math.round(n / 10) * 10;

/* Alltid en decimal, även på jämna sekunder: talet står i monospace bredvid en
 * stapel som rör sig, och ett tecken som försvinner och kommer tillbaka läses
 * som ett hopp. */
const sekTal = (s) => `${s.toFixed(1).replace('.', ',')} s`;

/* Hur väl kortet sitter, räknat ur schemaläggningens egna fält. Ett långt
 * intervall och hög lätthet betyder att man kan det; återfall drar ner. Ett
 * kort som aldrig repeterats får lägst värde och hamnar därför på den dyraste
 * rutan, vilket är rätt: det är det man minst troligt kan. */
const familjaritet = (kort) => {
    const intervall = Number(kort.interval) || 0;
    const repetitioner = Number(kort.repetition) || 0;
    const latthet = Number(kort.easeFactor) || 2.5;
    const tapp = Number(kort.lapses) || 0;
    return Math.log1p(intervall) * 2 + repetitioner + (latthet - 2.5) * 2 - tapp * 1.5;
};

export const jeopardyReveal = () => {
    const kortlek = S.currentStudyCards;

    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    /* Egen klass utöver den delade: spelplanen är högre än de andra lägenas och
     * behöver få rulla. Att ändra .cinema-overlay hade ändrat alla åtta. */
    overlay.className = 'cinema-overlay jp-overlay';

    oppnaSpelyta(overlay);

    /* Rekordet hör ihop med det man spelat på — ett resultat från hela
     * biblioteket går inte att jämföra med ett från en enda kortlek. */
    let rekordNyckel = 'spaced_rep_jp_pb_all';
    let rekordTitel = 'Hela biblioteket';
    if (S.playgroundFilterSource && S.playgroundFilterSource.size > 0) {
        const lekar = new Set();
        S.playgroundFilterSource.forEach((varde) => {
            const traff = varde.match(/^deck:([^:]+)/);
            if (traff) lekar.add(traff[1]);
        });
        if (lekar.size === 1) {
            const id = Array.from(lekar)[0];
            const lek = S.appData.decks.find((d) => d.id === id);
            rekordNyckel = `spaced_rep_jp_pb_${id}`;
            rekordTitel = lek ? lek.title : 'Fokusområde';
        } else if (lekar.size > 1) {
            rekordNyckel = `spaced_rep_jp_pb_focus_${Array.from(lekar).sort().join('_')}`;
            rekordTitel = 'Fokusområde';
        }
    }
    let rekord = parseInt(localStorage.getItem(rekordNyckel) || '0', 10) || 0;

    const totalRundor = kortlek.length;
    /* Finalen kräver att det finns ett spel före den. Med tre kort eller färre
     * blir "satsa hela kassan" bara ett dyrt sätt att spela sista kortet. */
    const harFinal = totalRundor >= 4;
    const spelrundor = totalRundor - (harFinal ? 1 : 0);
    const andraHalvan = Math.ceil(spelrundor / 2);
    const dubblat = (i) => spelrundor > 2 && i >= andraHalvan;

    let pool = [];
    let runda = 0;
    let poang = 0;
    let svit = 0;
    let bastaSvit = 0;
    let ratt = 0;
    let fel = 0;
    let passade = 0;
    let storstaPott = 0;
    let finalUtfall = null;
    let poangAndrat = false;

    let klockaRAF = null;
    let tangentbord = null;

    const stoppaKlocka = () => {
        if (klockaRAF !== null) {
            cancelAnimationFrame(klockaRAF);
            klockaRAF = null;
        }
    };

    /* Klockan är spelregel och inte utsmyckning: den går även för den som bett
     * systemet om mindre rörelse. Därför drivs den per bildruta härifrån i
     * stället för av en CSS-animering, som rörelselagret stänger av. */
    const startaKlocka = (sekunder, vidTick, vidSlut) => {
        stoppaKlocka();
        const start = performance.now();
        const steg = (nu) => {
            const kvar = Math.max(0, 1 - (nu - start) / (sekunder * 1000));
            vidTick(kvar, sekunder * kvar);
            if (kvar <= 0) {
                klockaRAF = null;
                vidSlut();
                return;
            }
            klockaRAF = requestAnimationFrame(steg);
        };
        klockaRAF = requestAnimationFrame(steg);
    };

    const avsluta = () => {
        stoppaKlocka();
        document.removeEventListener('keydown', globalTangent);
    };
    const stangSpel = () => {
        avsluta();
        stangSpelyta(overlay, finishPlaygroundSession);
    };

    /* En enda lyssnare för hela spelet, som frågar den aktuella skärmen vad
     * tangenten betyder. Varje skärm lade tidigare på sin egen och tog inte
     * alltid bort den igen. */
    const globalTangent = (e) => {
        /* Autorepetition räknas inte. En tangent som hålls nere skickar tiotals
         * händelser i sekunden, och skärmarna byts på samma tangenter: ett
         * kvarhållet "1" hade bedömt kortet och sedan valt första rutan i nästa
         * runda innan man hunnit se den. */
        if (e.repeat) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            stangSpel();
            return;
        }
        if (typeof tangentbord === 'function') tangentbord(e);
    };

    /* Kategorin är det enda man vet om ledtråden innan man satsat. Mappen är en
     * bättre kategori än kortleken när kortet ligger i en. */
    const kategori = (kort) => {
        const lek = S.appData.decks.find((d) => d.id === kort.originalDeckId);
        if (!lek) return 'Blandat';
        const mapp =
            kort.sectionId && lek.sections ? lek.sections.find((s) => s.id === kort.sectionId) : null;
        return (mapp && mapp.title) || lek.title || 'Blandat';
    };

    const sep = '<span class="arena-sep" aria-hidden="true"></span>';
    const rundText = () => `Runda ${Math.min(runda + 1, totalRundor)} av ${totalRundor}`;
    const toppslist = (hoger) => `
        <div class="arena-top">
            <span class="micro">Jeopardy</span>
            <span class="arena-meta num">${hoger}</span>
        </div>
    `;

    const kassa = (etikett) => `
        <div class="jp-bank">
            <p class="micro">${etikett}</p>
            <p class="jp-sum num${poang < 0 ? ' is-neg' : ''}${poangAndrat ? ' is-updated' : ''}">${tal(poang)}</p>
        </div>
    `;

    /* Attributvärde, inte innehåll: escapeHtml går via innerHTML och lämnar
     * citattecknen orörda, som i deck.js. */
    const attr = (varde) => escapeHtml(varde).replace(/"/g, '&quot;');

    const ruta = (i, overtext, varde, niva) => `
        <button type="button" class="jp-cell" data-i="${i}" data-niva="${niva}"
                aria-label="${attr(overtext)}, ${tal(varde)} poäng">
            <span class="jp-cell-kat">${escapeHtml(overtext)}</span>
            <span class="jp-cell-varde num">${tal(varde)}</span>
            <span class="kbd jp-cell-key">${i + 1}</span>
        </button>
    `;

    /* Tre kort per runda: det man kan bäst till den minsta potten, det man kan
     * sämst till den största. De två som blir över ligger kvar i poolen. */
    const valjBrickor = () => {
        const n = pool.length;
        if (n === 1) return [{ kort: pool[0], niva: 1 }];
        if (n === 2)
            return [
                { kort: pool[1], niva: 0 },
                { kort: pool[0], niva: 2 },
            ];
        return [
            { kort: pool[n - 1], niva: 0 },
            { kort: pool[Math.floor(n / 2)], niva: 1 },
            { kort: pool[0], niva: 2 },
        ];
    };

    const visaInsats = () => {
        stoppaKlocka();
        if (pool.length === 0) {
            visaSlut();
            return;
        }
        if (harFinal && pool.length === 1) {
            visaFinal();
            return;
        }

        const faktor = dubblat(runda) ? 2 : 1;
        const brickor = valjBrickor().map((b) => ({ ...b, varde: STEG[b.niva] * faktor }));
        const nyDubbling = dubblat(runda) && !dubblat(runda - 1);
        const svitVarde = svitfaktor(svit);

        overlay.innerHTML = `
            <div class="arena">
                ${toppslist(rundText() + (svit >= 2 ? sep + `Svit ${svit}` : ''))}
                ${kassa('Kassa')}
                ${svitVarde > 1 ? `<p class="jp-mult num">Sviten ger ×${decimal(svitVarde)} på nästa rätt</p>` : ''}
                ${nyDubbling ? '<p class="jp-note">Dubbla poängen härifrån.</p>' : ''}
                <div class="jp-board" data-antal="${brickor.length}">
                    ${brickor.map((b, i) => ruta(i, kategori(b.kort), b.varde, b.niva)).join('')}
                </div>
                ${runda === 0 ? '<p class="arena-hint">Större pott, svårare kort.</p>' : ''}
            </div>
        `;
        poangAndrat = false;

        const valj = (i) => {
            const b = brickor[i];
            if (!b) return;
            tangentbord = null;
            pool = pool.filter((k) => k !== b.kort);
            visaLedtrad(b.kort, b.varde, false);
        };

        overlay.querySelectorAll('.jp-cell').forEach((el) => {
            el.addEventListener('click', () => valj(parseInt(el.dataset.i, 10)));
        });
        tangentbord = (e) => {
            const i = ['1', '2', '3'].indexOf(e.key);
            if (i > -1 && i < brickor.length) {
                e.preventDefault();
                valj(i);
            }
        };
    };

    /* Finalen: kategorin syns, ledtråden inte, och insatsen är fri upp till
     * kassan. Sexhundra är golvet så att den som ligger på noll fortfarande har
     * något att spela om. */
    const visaFinal = () => {
        const kort = pool[0];
        const tak = Math.max(poang, 600);
        const insatser = [tiotal(tak * 0.25), tiotal(tak * 0.5), tak];
        const etiketter = poang > 0 ? ['Fjärdedel', 'Hälften', 'Allt'] : ['Lågt', 'Mellan', 'Högt'];

        overlay.innerHTML = `
            <div class="arena">
                ${toppslist(rundText() + sep + 'Finalen')}
                ${kassa('Kassa')}
                <p class="jp-note">Hela insatsen vinns eller förloras. Klockan drar inget av den, och ett uteblivet svar kostar den ändå.</p>
                <p class="micro">Kategori · ${escapeHtml(kategori(kort))}</p>
                <div class="jp-board" data-antal="3">
                    ${insatser.map((v, i) => ruta(i, etiketter[i], v, i)).join('')}
                </div>
            </div>
        `;
        poangAndrat = false;

        const valj = (i) => {
            if (insatser[i] === undefined) return;
            tangentbord = null;
            pool = [];
            visaLedtrad(kort, insatser[i], true);
        };

        overlay.querySelectorAll('.jp-cell').forEach((el) => {
            el.addEventListener('click', () => valj(parseInt(el.dataset.i, 10)));
        });
        tangentbord = (e) => {
            const i = ['1', '2', '3'].indexOf(e.key);
            if (i > -1) {
                e.preventDefault();
                valj(i);
            }
        };
    };

    const visaLedtrad = (kort, insats, arFinal) => {
        const faktor = arFinal ? 1 : svitfaktor(svit);
        const sekunder =
            (arFinal ? FINALTID : Math.max(MINSTA_BETANKETID, BETANKETID - runda)) + lastid(kort);
        /* Potten är vad man vinner om man svarar just nu: insatsen, gånger
         * sviten, minus det klockan hunnit äta. Insatsen man riskerar står
         * still — det är hela spänningen i formatet. */
        let potten = tiotal(insats * faktor);

        overlay.innerHTML = `
            <div class="arena">
                ${toppslist(rundText() + sep + `Kassa ${tal(poang)}`)}
                <div class="jp-clue-top">
                    <span class="micro">${escapeHtml(kategori(kort))}</span>
                    <span class="jp-pot-wrap">
                        <span id="jp-pott" class="jp-pot num">${tal(potten)}</span>
                        ${faktor > 1 ? `<span class="jp-mult num">Svit ${svit} ×${decimal(faktor)}</span>` : ''}
                    </span>
                </div>
                <div id="jp-klocka" class="arena-timer">
                    <div class="progress" aria-hidden="true"><i id="jp-fyll" class="progress-fill jp-timer-fill"></i></div>
                    <span id="jp-tid" class="num">${sekTal(sekunder)}</span>
                </div>
                <div class="arena-body">
                    <p class="micro">Svaret är</p>
                    <div id="jp-svar" class="arena-question">${safeParse(kort.front)}</div>
                </div>
                <div class="arena-foot jp-foot">
                    <span class="arena-score num jp-risk">Risk −${tal(insats)}</span>
                    <span class="jp-foot-actions">
                        ${arFinal ? '' : '<button type="button" id="jp-passa" class="btn text">Passa</button>'}
                        <button type="button" id="jp-svara" class="btn primary lg">Svara <span class="kbd">Space</span></button>
                    </span>
                </div>
            </div>
        `;

        const svarEl = overlay.querySelector('#jp-svar');
        renderLatex(svarEl);
        renderCardBackImages(svarEl, kort.backImages);

        const pottEl = overlay.querySelector('#jp-pott');
        const tidEl = overlay.querySelector('#jp-tid');
        const fyllEl = overlay.querySelector('#jp-fyll');
        const klockaEl = overlay.querySelector('#jp-klocka');

        const ga = (orsak) => {
            stoppaKlocka();
            tangentbord = null;
            visaFacit(kort, insats, potten, orsak, arFinal);
        };

        startaKlocka(
            sekunder,
            (kvar, sekKvar) => {
                if (!arFinal) {
                    const nytt = tiotal(insats * (LAGSTA_ANDEL + (1 - LAGSTA_ANDEL) * kvar) * faktor);
                    if (nytt !== potten) {
                        potten = nytt;
                        pottEl.textContent = tal(potten);
                    }
                }
                tidEl.textContent = sekTal(sekKvar);
                fyllEl.style.transform = `scaleX(${kvar})`;
                klockaEl.classList.toggle('is-urgent', kvar <= 0.25);
            },
            () => ga('tid')
        );

        overlay.querySelector('#jp-svara').addEventListener('click', () => ga('svar'));
        overlay.querySelector('#jp-passa')?.addEventListener('click', () => ga('passade'));

        tangentbord = (e) => {
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                ga('svar');
            }
        };
    };

    const visaFacit = (kort, insats, potten, orsak, arFinal) => {
        const harSvarat = orsak === 'svar';
        const avgor = (rattSvar) => {
            tangentbord = null;
            if (rattSvar) {
                poang += potten;
                ratt++;
                svit++;
                if (svit > bastaSvit) bastaSvit = svit;
                if (potten > storstaPott) storstaPott = potten;
                if (arFinal) finalUtfall = potten;
            } else {
                poang -= insats;
                fel++;
                svit = 0;
                if (arFinal) finalUtfall = -insats;
            }
            poangAndrat = true;
            runda++;
            visaInsats();
        };

        /* Tiden ute i en vanlig runda kostar bara sviten — annars vore ett
         * chansat svar alltid bättre än att erkänna att man inte vet, och då
         * betyder den egna bedömningen ingenting. I finalen är regeln den
         * omvända: där är insatsen redan lagd. */
        const passera = () => {
            tangentbord = null;
            if (arFinal) {
                poang -= insats;
                finalUtfall = -insats;
                fel++;
                poangAndrat = true;
            } else {
                passade++;
            }
            svit = 0;
            runda++;
            visaInsats();
        };

        /* Vad det kostade, sagt i samma andetag som varför. Ett "Tiden ute" över
         * ett kort man själv lämnat är fel besked, och en bruten svit man inte
         * hade är ingen förlust. */
        let foljd = 'noll poäng';
        if (arFinal) foljd = `insatsen förlorad −${tal(insats)}`;
        else if (svit > 0) foljd = 'sviten bruten';

        const domsrad = harSvarat
            ? `
                <div class="jp-judge">
                    <button type="button" id="jp-ratt" class="btn lg">Rätt <span class="jp-judge-n num jp-plus">+${tal(potten)}</span> <span class="kbd">1</span></button>
                    <button type="button" id="jp-fel" class="btn lg">Fel <span class="jp-judge-n num jp-minus">−${tal(insats)}</span> <span class="kbd">2</span></button>
                </div>
            `
            : `
                <p class="arena-verdict is-bad">${orsak === 'passade' ? 'Passade' : 'Tiden ute'}, ${foljd}.</p>
                <div class="arena-foot arena-foot--center">
                    <button type="button" id="jp-nasta" class="btn primary lg">Nästa <span class="kbd">Space</span></button>
                </div>
            `;

        overlay.innerHTML = `
            <div class="arena">
                ${toppslist(rundText() + sep + `Kassa ${tal(poang)}`)}
                <div class="arena-body">
                    <p class="micro">Svaret var</p>
                    <div id="jp-eko" class="jp-echo">${safeParse(kort.front)}</div>
                    <div class="arena-reveal">
                        <p class="micro">Frågan var</p>
                        <div id="jp-fraga" class="arena-answer">${safeParse(kort.back)}</div>
                        ${kort.description ? `<div id="jp-desc" class="jp-desc">${safeParse(kort.description)}</div>` : ''}
                    </div>
                </div>
                ${domsrad}
            </div>
        `;

        renderLatex(overlay.querySelector('#jp-eko'));
        renderLatex(overlay.querySelector('#jp-fraga'));
        const descEl = overlay.querySelector('#jp-desc');
        if (descEl) renderLatex(descEl);

        if (harSvarat) {
            overlay.querySelector('#jp-ratt').addEventListener('click', () => avgor(true));
            overlay.querySelector('#jp-fel').addEventListener('click', () => avgor(false));
            tangentbord = (e) => {
                if (e.key === '1') {
                    e.preventDefault();
                    avgor(true);
                } else if (e.key === '2') {
                    e.preventDefault();
                    avgor(false);
                }
            };
        } else {
            overlay.querySelector('#jp-nasta').addEventListener('click', passera);
            tangentbord = (e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    passera();
                }
            };
        }
    };

    const visaSlut = () => {
        stoppaKlocka();
        const foregaende = rekord;
        const slogRekord = poang > foregaende;
        if (slogRekord) {
            rekord = poang;
            localStorage.setItem(rekordNyckel, String(poang));
        }

        /* Spelhallens egen slutskärm läser de här två. Utan dem påstod den
         * "0 av 0 rätt" efter varje avslutad omgång. */
        S.playgroundSessionStats.correct = ratt;
        S.playgroundSessionStats.again = fel + passade;

        /* Avståndet till rekordet, inte en beröm. Ett tal man ligger under är
         * det enda som gör "en gång till" till en självklarhet. */
        let ledtext;
        if (slogRekord) {
            ledtext =
                foregaende > 0
                    ? `Nytt rekord, ${tal(poang - foregaende)} poäng bättre än förra gången.`
                    : 'Nytt rekord.';
        } else if (foregaende <= 0) {
            ledtext = 'Rekordet står fortfarande på noll.';
        } else if (poang === foregaende) {
            ledtext = 'Du tangerade rekordet.';
        } else {
            ledtext = `${tal(foregaende - poang)} poäng från rekordet ${tal(foregaende)}.`;
        }

        overlay.innerHTML = `
            <div class="arena arena--end">
                <p class="micro">Jeopardy · ${escapeHtml(rekordTitel)}</p>
                <h2 class="jp-sum jp-sum--end num${poang < 0 ? ' is-neg' : ''}">${tal(poang)}</h2>
                <p class="arena-end-lead">${ledtext}</p>
                <dl class="arena-stats">
                    <div><dt>Rätt</dt><dd class="num">${ratt}</dd></div>
                    <div><dt>Fel</dt><dd class="num">${fel}</dd></div>
                    ${passade > 0 ? `<div><dt>Passade</dt><dd class="num">${passade}</dd></div>` : ''}
                    <div><dt>Längsta svit</dt><dd class="num">${bastaSvit}</dd></div>
                    <div><dt>Största pott</dt><dd class="num">${tal(storstaPott)}</dd></div>
                    ${finalUtfall !== null ? `<div><dt>Finalen</dt><dd class="num ${finalUtfall < 0 ? 'jp-minus' : 'jp-plus'}">${finalUtfall < 0 ? '−' : '+'}${tal(Math.abs(finalUtfall))}</dd></div>` : ''}
                    <div><dt>Rekord</dt><dd class="num">${tal(rekord)}</dd></div>
                </dl>
                <div class="arena-end-actions">
                    <button type="button" id="jp-igen" class="btn primary lg">Spela igen <span class="kbd">Enter</span></button>
                    <button type="button" id="jp-avsluta" class="btn">Avsluta</button>
                </div>
            </div>
        `;

        overlay.querySelector('#jp-igen').addEventListener('click', starta);
        overlay.querySelector('#jp-avsluta').addEventListener('click', stangSpel);
        tangentbord = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                starta();
            }
        };
    };

    const starta = () => {
        /* Svåraste först. Ordningen är hela rutvalets grund: pottens storlek
         * betyder något bara så länge den följer kortets svårighet. */
        pool = [...kortlek].sort((a, b) => familjaritet(a) - familjaritet(b));
        runda = 0;
        poang = 0;
        svit = 0;
        bastaSvit = 0;
        ratt = 0;
        fel = 0;
        passade = 0;
        storstaPott = 0;
        finalUtfall = null;
        poangAndrat = false;
        S.playgroundSessionStats.correct = 0;
        S.playgroundSessionStats.again = 0;
        S.playgroundSessionStats.startTime = Date.now();
        visaInsats();
    };

    /* Reglerna sägs en gång, som par och inte som stycken, och rekordet står
     * överst: det är det man ska vilja slå, och det ska synas innan man börjar. */
    const visaIntro = () => {
        overlay.innerHTML = `
            <div class="arena arena--end">
                <p class="micro">Jeopardy</p>
                <h2 class="arena-end-title">Du ser svaret. Gissa frågan.</h2>
                <div class="jp-bank">
                    <p class="micro">Rekord · ${escapeHtml(rekordTitel)}</p>
                    <p class="jp-sum num">${tal(rekord)}</p>
                </div>
                <dl class="arena-stats">
                    <div><dt>Välj ruta</dt><dd>Större pott, svårare kort</dd></div>
                    <div><dt>Rätt</dt><dd>Potten in i kassan</dd></div>
                    <div><dt>Fel</dt><dd>Hela insatsen ur den</dd></div>
                    <div><dt>Klockan</dt><dd>Sänker potten, inte insatsen</dd></div>
                    <div><dt>Svit 3 och 5</dt><dd class="num">×1,5 och ×2</dd></div>
                    ${harFinal ? '<div><dt>Sista ledtråden</dt><dd>Finalen — satsa upp till hela kassan</dd></div>' : ''}
                </dl>
                <div class="arena-end-actions">
                    <button type="button" id="jp-start" class="btn primary lg">Starta <span class="kbd">Space</span></button>
                </div>
            </div>
        `;
        overlay.querySelector('#jp-start').addEventListener('click', starta);
        tangentbord = (e) => {
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                starta();
            }
        };
    };

    document.addEventListener('keydown', globalTangent);
    visaIntro();
};
