import { aiErrorMessage, callAIDetailed } from './call.js';
import { parseKortlista } from './svarstolk.js';
import { medTankeutrymme } from './tak.js';
import { S } from '../core/state.js';
import { fixLatexInCards, safeParse } from '../ui/images.js';
import { initSelect } from '../ui/select.js';
import { renderLatex } from '../ui/latex.js';
import { showToast } from '../ui/toast.js';


export const fetchDiaryCards = async (diaryText) => {
    document.getElementById('diary-loading').classList.remove('hidden');
    document.getElementById('diary-cards-container').classList.add('hidden');
    document.getElementById('diary-actions-container').classList.add('hidden');
    document.getElementById('btn-close-diary-top').classList.add('hidden');

    const deckInfo = S.appData.decks.map(d => {
        const sectionNames = (d.sections || []).map(s => s.title);
        const bookshelf = d.bookshelfId ? S.appData.bookshelves.find(s => s.id === d.bookshelfId) : null;
        return { name: d.title, bookshelf: bookshelf ? bookshelf.title : null, sections: sectionNames };
    });
    const deckListStr = deckInfo.length > 0 ? JSON.stringify(deckInfo) : '(inga lekar finns ännu)';
    const bookshelfNames = S.appData.bookshelves.map(s => s.title);
    const bookshelfStr = bookshelfNames.length > 0 ? bookshelfNames.join(', ') : '(inga bokhyllor finns ännu)';

    try {
        const { text, truncated } = await callAIDetailed({
            system: `Du är en pedagogisk expert. Användaren skriver fritt om vad de lärt sig idag. Din uppgift är att extrahera nyckelinsikter och skapa flashcards.\n\nDu MÅSTE svara med ENBART en ren JSON-array, utan markdown-block. Formatet MÅSTE vara:\n[{"front": "fråga", "back": "svar", "suggestedDeck": "Namn på föreslagen kortlek", "suggestedBookshelf": "Namn på bokhylla eller null", "suggestedSection": "Namn på mapp i kortleken eller null"}]\n\nAnvändarens befintliga kortlekar med bokhyllor och mappar: ${deckListStr}\nBefintliga bokhyllor: [${bookshelfStr}]\n\nRegler:\n- Om en lärdom passar i en befintlig kortlek, använd det exakta namnet.\n- Om ingen kortlek passar, föreslå ett nytt namn.\n- Föreslå vilken bokhylla kortleken ska tillhöra (befintlig eller ny). Använd null om osäker.\n- Föreslå vilken mapp (section) i kortleken kortet ska placeras i. Använd befintliga mappnamn om de passar, annars föreslå ett nytt namn. Använd null om ingen mapp behövs.\nVIKTIGT: Matematik formateras med LaTeX via dollartecken ($). Använd aldrig backslash-parenteser.\nAnpassa antalet kort efter innehållet, vanligtvis 3–15 kort.`,
            user: `Här är mina lärdomar från idag:\n\n${diaryText}`,
            maxTokens: medTankeutrymme(4000),
            json: true,
            feature: 'diary',
            // Dagboken är användarens egen text; korten plockas ur den, som
            // ur en PDF. Låg ansträngning, av samma skäl som i generatorn.
            effort: 'low',
        });

        // Samma ordningsfel som i topic-generator: vakten stod efter det som
        // redan förutsatte en array.
        const { kort, bortfall, avhugget } = parseKortlista(text, { truncated });
        S.proposedDiaryCards = fixLatexInCards(kort);

        if (avhugget) {
            showToast(`Modellen hann inte skriva klart. ${kort.length} kort kunde räddas.`);
        } else if (bortfall > 0) {
            showToast(`${bortfall} kort saknade fråga eller svar och hoppades över.`);
        }

        document.getElementById('diary-loading').classList.add('hidden');
        document.getElementById('diary-cards-container').classList.remove('hidden');
        document.getElementById('diary-actions-container').classList.remove('hidden');
        renderDiaryCards();

    } catch (e) {
        document.getElementById('diary-loading').classList.add('hidden');
        document.getElementById('btn-close-diary-top').classList.remove('hidden');
        // Dagboksmodalen har inget eget resultatfält för fel, så meddelandet
        // går via toast i stället för en blockerande alert.
        showToast(aiErrorMessage(e));
    }
};

const renderDiaryCards = () => {
    const container = document.getElementById('diary-cards-container');
    container.innerHTML = '';
    const deckNames = S.appData.decks.map(d => d.title);
    const bookshelfNames = S.appData.bookshelves.map(s => s.title);

    S.proposedDiaryCards.forEach((card, index) => {
        const div = document.createElement('div');
        div.className = 'preview-card diary-card';

        const optionsHtml = deckNames.map(name =>
            `<option value="${name}" ${name === card.suggestedDeck ? 'selected' : ''}>${name}</option>`
        ).join('');
        const hasMatch = deckNames.includes(card.suggestedDeck);

        const bookshelfOptionsHtml = bookshelfNames.map(name =>
            `<option value="${name}" ${name === card.suggestedBookshelf ? 'selected' : ''}>${name}</option>`
        ).join('');
        const hasBookshelfMatch = bookshelfNames.includes(card.suggestedBookshelf);

        const selectedDeck = S.appData.decks.find(d => d.title === card.suggestedDeck);
        const sectionNames = selectedDeck ? (selectedDeck.sections || []).map(s => s.title) : [];
        const sectionOptionsHtml = sectionNames.map(name =>
            `<option value="${name}" ${name === card.suggestedSection ? 'selected' : ''}>${name}</option>`
        ).join('');
        const hasSectionMatch = sectionNames.includes(card.suggestedSection);

        /* Tre väljare under kortet, med etikett ovanför var och en. De bar
         * tidigare sina stilar i markupen, mot tokens som inte finns — fälten
         * ritades utan kant och utan bakgrund — och klädde sig aldrig i
         * appens egen väljare, så systemets rullista stod mitt i dialogen. */
        const val = (namn, klass, id, alternativ) => `
            <div class="diary-val">
                <label class="diary-val-label" for="${id}">${namn}</label>
                <span class="select-wrap"><select id="${id}" class="${klass} field" data-index="${index}">${alternativ}</select></span>
            </div>`;
        div.innerHTML = `
            <div class="diary-card-top">
                <div class="preview-card-content">
                    <div class="preview-card-front">${safeParse(card.front)}</div>
                    <div class="preview-card-back">${safeParse(card.back)}</div>
                </div>
                <button type="button" class="preview-card-remove" data-index="${index}" title="Ta bort"></button>
            </div>
            <div class="diary-card-val">
                ${val('Kortlek', 'diary-deck-select', `diary-deck-${index}`, `
                        ${!hasMatch ? `<option value="__new__:${card.suggestedDeck}" selected>Ny: ${card.suggestedDeck}</option>` : ''}
                        ${optionsHtml}`)}
                ${val('Bokhylla', 'diary-bookshelf-select', `diary-bookshelf-${index}`, `
                        <option value="">Ingen</option>
                        ${card.suggestedBookshelf && !hasBookshelfMatch ? `<option value="__new__:${card.suggestedBookshelf}" selected>Ny: ${card.suggestedBookshelf}</option>` : ''}
                        ${bookshelfOptionsHtml}`)}
                ${val('Mapp', 'diary-section-select', `diary-section-${index}`, `
                        <option value="">Ingen</option>
                        ${card.suggestedSection && !hasSectionMatch ? `<option value="__new__:${card.suggestedSection}" selected>Ny: ${card.suggestedSection}</option>` : ''}
                        ${sectionOptionsHtml}`)}
            </div>
        `;
        container.appendChild(div);
        renderLatex(div);
        div.querySelectorAll('select').forEach((sel) => initSelect(sel));
    });

    container.querySelectorAll('.preview-card-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'));
            S.proposedDiaryCards.splice(idx, 1);
            renderDiaryCards();
        });
    });

    container.querySelectorAll('.diary-deck-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = parseInt(sel.getAttribute('data-index'), 10);
            
            // Sync all current inputs back to proposedDiaryCards array first
            container.querySelectorAll('.diary-deck-select').forEach(s => {
                const i = parseInt(s.getAttribute('data-index'), 10);
                S.proposedDiaryCards[i].suggestedDeck = s.value.startsWith('__new__:') ? s.value.replace('__new__:', '') : s.value;
            });
            container.querySelectorAll('.diary-bookshelf-select').forEach(s => {
                const i = parseInt(s.getAttribute('data-index'), 10);
                S.proposedDiaryCards[i].suggestedBookshelf = s.value.startsWith('__new__:') ? s.value.replace('__new__:', '') : s.value;
            });
            container.querySelectorAll('.diary-section-select').forEach(s => {
                const i = parseInt(s.getAttribute('data-index'), 10);
                S.proposedDiaryCards[i].suggestedSection = s.value.startsWith('__new__:') ? s.value.replace('__new__:', '') : s.value;
            });

            // Reset this card's section since the deck changed
            S.proposedDiaryCards[idx].suggestedSection = null;
            renderDiaryCards();
        });
    });

    container.querySelectorAll('.diary-bookshelf-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = parseInt(sel.getAttribute('data-index'), 10);
            S.proposedDiaryCards[idx].suggestedBookshelf = sel.value.startsWith('__new__:') ? sel.value.replace('__new__:', '') : sel.value;
        });
    });

    container.querySelectorAll('.diary-section-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = parseInt(sel.getAttribute('data-index'), 10);
            S.proposedDiaryCards[idx].suggestedSection = sel.value.startsWith('__new__:') ? sel.value.replace('__new__:', '') : sel.value;
        });
    });

    if (S.proposedDiaryCards.length === 0) {
        document.getElementById('diary-actions-container').classList.add('hidden');
        document.getElementById('btn-close-diary-top').classList.remove('hidden');
    }
};
