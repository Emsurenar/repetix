import { aiErrorMessage, callAI, callAIDetailed } from '../../ai/call.js';
import { parseObjekt } from '../../ai/svarstolk.js';
import { buildDeckContext } from '../../ai/client.js';
import { fordjupningsPrompt, saknasForFordjupning } from '../../ai/fordjupning.js';
import { fetchStudyAi } from '../../ai/study-ai.js';
import { createNote } from '../../core/backup.js';
import { S } from '../../core/state.js';
import { saveData } from '../../core/storage.js';
import { openNotebook } from '../deck.js';
import { switchView } from '../router.js';
import { showToast } from '../toast.js';
import { populateAddCardSections } from './add-card.js';


    const runAutoFolder = async (questionText) => {
        const btnAuto = document.getElementById('btn-auto-folder');
        btnAuto.disabled = true;
        btnAuto.innerHTML = 'Auto ';

        try {
            const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
            const existingSections = (deck.sections || []).map(s => ({ id: s.id, title: s.title }));

            const { text, truncated } = await callAIDetailed({
                system: `Du är en expert på att organisera flashcards i mappar/kategorier. Analysera flashcard-frågan och välj den mest passande mappen från listan över befintliga mappar. Om ingen av de befintliga mapparna passar (eller om listan är tom), föreslå en helt ny passande mapp med ett kort, koncist och beskrivande namn (skrivet på samma språk som frågan, oftast svenska eller engelska).\n\nBefintliga mappar:\n${JSON.stringify(existingSections)}\n\nRegler för svar:\n- Om en befintlig mapp passar bra (tematiskt relaterad till frågan), välj den och svara med denna exakta JSON:\n{\n  "action": "existing",\n  "folderId": "id_på_mappen",\n  "folderTitle": "namn_på_mappen"\n}\n- Om ingen av de befintliga mapparna passar bra, eller om inga mappar finns, föreslå en ny och svara med denna exakta JSON:\n{\n  "action": "new",\n  "folderTitle": "Föreslaget Mappnamn"\n}\n\nSvara ENBART med den råa JSON-koden. Ingen introduktion, inga förklaringar, ingen markdown-kodblock.`,
                user: `Fråga: "${questionText}"`,
                maxTokens: 200,
                json: true,
                feature: 'autofolder',
            });

            const result = parseObjekt(text, { truncated });
            if (result.action === 'existing') {
                const foundSec = deck.sections.find(s => s.id === result.folderId);
                if (foundSec) {
                    populateAddCardSections(deck, foundSec.id);
                    showToast(`Valde mappen "${foundSec.title}"!`);
                } else {
                    const foundSecByTitle = deck.sections.find(s => s.title.toLowerCase() === result.folderTitle.toLowerCase());
                    if (foundSecByTitle) {
                        populateAddCardSections(deck, foundSecByTitle.id);
                        showToast(`Valde mappen "${foundSecByTitle.title}"!`);
                    } else {
                        populateAddCardSections(deck, `__new__:${result.folderTitle}`);
                        showToast(`Föreslog ny mapp: "${result.folderTitle}"`);
                    }
                }
            } else if (result.action === 'new') {
                populateAddCardSections(deck, `__new__:${result.folderTitle}`);
                showToast(`Föreslog ny mapp: "${result.folderTitle}"`);
            } else {
                showToast('Kunde inte kategorisera automatiskt.');
            }
        } catch (e) {
            showToast(aiErrorMessage(e));
        } finally {
            btnAuto.disabled = false;
            btnAuto.innerHTML = 'Auto ';
        }
    };

export function initUiWiringAiActions() {

      document.getElementById('btn-auto-folder').addEventListener('click', async () => {
          const questionText = document.getElementById('card-front').value.trim();
          if (!questionText) {
              showToast('Skriv en fråga först!');
              document.getElementById('card-front').focus();
              return;
          }
          runAutoFolder(questionText);
      });

      // Note Actions
      document.getElementById('btn-add-note').addEventListener('click', () => {
          S.currentNoteId = null;
          document.getElementById('note-content').value = '';
          document.getElementById('note-form-title').innerText = 'Lägg till anteckning';
          switchView('addNote');
      });

      document.getElementById('form-add-note').addEventListener('submit', (e) => {
          e.preventDefault();
          const content = document.getElementById('note-content').value.trim();
          if (content && S.currentNotebookId) {
              const notebook = S.appData.notebooks.find(n => n.id === S.currentNotebookId);
              if (S.currentNoteId) {
                  // Update
                  const note = notebook.notes.find(n => n.id === S.currentNoteId);
                  note.content = content;
                  showToast('Anteckning uppdaterad!');
              } else {
                  // Create
                  notebook.notes.push(createNote(content));
                  showToast('Anteckning sparad!');
              }
              saveData();
              openNotebook(S.currentNotebookId);
          }
      });

      /* Fyra knappar gör samma dans: lås, anropa, fyll fältet, återställ.
       *
       * Den låg tidigare utskriven en gång, och varje ny knapp hade kopierat
       * den. Kopian bar dessutom med sig en detalj som bara syntes när den
       * gick fel: knappens etikett skrevs tillbaka som en litteral sträng,
       * med ett inledande blanksteg som ingen hade skrivit. Här läses den ur
       * knappen i stället, så den kan inte glida ifrån markupen.
       *
       * @param {object} o
       * @param {string} o.knappId
       * @param {string} o.malId fältet som fylls
       * @param {() => string|null} o.saknas felmeddelande, eller null
       * @param {() => {system: string, user: string, maxTokens: number}} o.bygg
       * @param {string} o.klarText
       * @param {() => void} [o.efterat]
       */
      const kopplaGenerering = ({ knappId, malId, saknas, bygg, klarText, efterat }) => {
          const btn = document.getElementById(knappId);
          if (!btn) return;
          const etikett = btn.textContent;

          btn.addEventListener('click', async () => {
              const fel = saknas();
              if (fel) {
                  showToast(fel);
                  return;
              }

              btn.disabled = true;
              btn.textContent = 'Laddar...';
              try {
                  const text = await callAI(bygg());
                  document.getElementById(malId).value = text.trim();
                  showToast(klarText);
                  efterat?.();
              } catch (e) {
                  showToast(aiErrorMessage(e));
              } finally {
                  btn.disabled = false;
                  btn.textContent = etikett;
              }
          });
      };

      /** Svaret, som det alltid genererats. Långformatet styrs av kryssrutan
       * i SAMMA formulär — den lästes tidigare från båda formulären med eller
       * emellan, så en ikryssad ruta i redigeringsmodalen gav långt svar i
       * Nytt kort. */
      const svarsPrompt = (frontId, longformId) => () => {
          const frontText = document.getElementById(frontId).value.trim();
          const isLongForm = document.getElementById(longformId)?.checked || false;
          const promptInstruction = isLongForm
              ? "Din uppgift är att besvara flashcards med ett djupgående och detaljerat svar (långformat). Använd rubriker, listor och styckeindelningar för att göra informationen lättläst. Glöm inte LaTeX för matematik."
              : "Din uppgift är att besvara flashcards med max 50 ord. MYCKET VIKTIGT: Du får absolut inte hitta på information eller gissa (hallucinera inte). Om du inte är 100% säker på sanningen, ska du bara svara: \"Jag vet inte\". Formatera ALL matematik med LaTeX via dollartecken, t.ex. $\\frac{1}{2}$ eller $\\sin(x)$.";

          return {
              system: `Du är en expert på fakta och lärande. ${promptInstruction}`,
              user: `Här är frågan: ${frontText}\nOm du är helt säker på svaret, ge det till mig${isLongForm ? ' i detalj' : ' kort'}. Om du är osäker, svara exakt "Jag vet inte".${buildDeckContext(S.currentDeckId)}`,
              maxTokens: isLongForm ? 1500 : 300,
              feature: 'answer',
          };
      };

      const kraverFraga = (frontId) => () =>
          document.getElementById(frontId).value.trim() ? null : 'Skriv en fråga på framsidan först!';

      const fordjupningFran = (frontId, backId) => () =>
          fordjupningsPrompt({
              front: document.getElementById(frontId).value,
              back: document.getElementById(backId).value,
              deckContext: buildDeckContext(S.currentDeckId),
          });

      const saknasFor = (frontId, backId) => () =>
          saknasForFordjupning({
              front: document.getElementById(frontId).value,
              back: document.getElementById(backId).value,
          });

      // Nytt kort. Bara här sorteras kortet in i en mapp automatiskt — i
      // redigeringsmodalen ligger kortet redan där användaren lade det.
      kopplaGenerering({
          knappId: 'btn-generate-answer',
          malId: 'card-back',
          saknas: kraverFraga('card-front'),
          bygg: svarsPrompt('card-front', 'card-longform'),
          klarText: 'Svar genererat!',
          efterat: () => runAutoFolder(document.getElementById('card-front').value.trim()),
      });

      kopplaGenerering({
          knappId: 'btn-generate-description',
          malId: 'card-description',
          saknas: saknasFor('card-front', 'card-back'),
          bygg: fordjupningFran('card-front', 'card-back'),
          klarText: 'Fördjupning genererad!',
      });

      // Redigera. Modalen hade ingen av de två knapparna, utan skäl.
      kopplaGenerering({
          knappId: 'btn-edit-generate-answer',
          malId: 'edit-card-back',
          saknas: kraverFraga('edit-card-front'),
          bygg: svarsPrompt('edit-card-front', 'edit-card-longform'),
          klarText: 'Svar genererat!',
      });

      kopplaGenerering({
          knappId: 'btn-edit-generate-description',
          malId: 'edit-card-description',
          saknas: saknasFor('edit-card-front', 'edit-card-back'),
          bygg: fordjupningFran('edit-card-front', 'edit-card-back'),
          klarText: 'Fördjupning genererad!',
      });

      // Study Session
      // btn-study event listener is now dynamically attached inside openDeck

      document.getElementById('form-study-ai').addEventListener('submit', (e) => {
          e.preventDefault();
          const inputObj = document.getElementById('input-study-ai');
          const question = inputObj.value.trim();
          if (!question) return;

          const card = S.currentStudyCards[S.currentStudyIndex];
          if (card) fetchStudyAi(card, question);
      });
}
