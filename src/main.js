// Startpunkt. Modulerna innehåller enbart definitioner; all DOM-koppling
// sker i init-funktioner som anropas här, i samma ordning som den
// ursprungliga filen körde dem.

// Stilarna importeras har for att ordningen ska vara deterministisk:
// tokens, bas, komponenter, layout, vyer. Spellagenas arvda stilar sist,
// tills de byggs om i etapp 5.
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/motion.css';
import './styles/layout.css';
import './styles/views/library.css';
import './styles/views/deck.css';
import './styles/views/study.css';
import './styles/views/forms.css';
import './styles/views/auth.css';
import './styles/views/search.css';
import './styles/views/settings.css';
import './styles/games-legacy.css';
// Spelhallen laddas sist och ar scopad till #view-playground: den ska vinna
// over den gamla stilmallens .pg-regler utan !important.
import './styles/views/playground.css';
import './styles/views/games.css';
/* Ett läge per fil, laddade sist så att de vinner över den gamla
 * stilmallen utan !important. */
import './styles/games/action.css';
import './styles/games/lucktext.css';
import './styles/games/fritext.css';
import './styles/games/jeopardy.css';
import './styles/games/dammiga.css';
import './styles/games/suddendeath.css';
import './styles/games/transportbandet.css';
import './styles/games/dragkampen.css';

import { initCloud } from './app/cloud.js';
import { loadReviewLog } from './core/sync.js';

import { initCoreState } from './core/state.js';
import { initCoreStorage } from './core/storage.js';
import { initUiImages } from './ui/images.js';
import { initUiModalsWiring } from './ui/modals-wiring.js';
import { initUiRouter } from './ui/router.js';
import { initUiSegmented } from './ui/segmented.js';
import { initUiSelects } from './ui/select.js';
import { initUiPlayground } from './ui/playground.js';
import { initUiLibrary } from './ui/library.js';
import { initAiClient } from './ai/client.js';
import { initAiDeckInsights } from './ai/deck-insights.js';
import { initAiProposedCards } from './ai/proposed-cards.js';
import { initAiSort } from './ai/sort.js';
import { initUiWiringNavigation } from './ui/wiring/navigation.js';
import { initUiWiringDeckActions } from './ui/wiring/deck-actions.js';
import { initAiWiringTopicGenerator } from './ai/wiring/topic-generator.js';
import { initAiWiringDiary } from './ai/wiring/diary.js';
import { initUiWiringCreate } from './ui/wiring/create.js';
import { initUiWiringMove } from './ui/wiring/move.js';
import { initUiWiringCardForms } from './ui/wiring/card-forms.js';
import { initUiWiringAddCard } from './ui/wiring/add-card.js';
import { initUiWiringKalla } from './ui/wiring/kalla.js';
import { initUiKallfraga } from './ui/deck.js';
import { initUiWiringAiActions } from './ui/wiring/ai-actions.js';
import { initUiWiringStudy } from './ui/wiring/study.js';
import { initAppInit } from './app/init.js';
import { initUiSearch } from './ui/search.js';
import { initSettings } from './ui/settings.js';
import { initSenastePlats } from './ui/senaste-plats.js';
import { initTangentbord } from './ui/tangentbord.js';

export function start() {
  initCoreState();
  initCoreStorage();
  initUiImages();
  initUiModalsWiring();
  initUiRouter();
  initUiSegmented();
  initUiSelects();
  initUiPlayground();
  initUiLibrary();
  initAiClient();
  initAiDeckInsights();
  initAiProposedCards();
  initAiSort();
  initUiWiringNavigation();
  initUiWiringDeckActions();
  initAiWiringTopicGenerator();
  initAiWiringDiary();
  initUiWiringCreate();
  initUiWiringMove();
  initUiWiringCardForms();
  initUiWiringAddCard();
  initUiWiringKalla();
  initUiKallfraga();
  initUiWiringAiActions();
  initUiWiringStudy();
  initAppInit();
  initUiSearch();
  initSettings();
  /* Sparar var man står. Ligger efter initAppInit med flit: uppstarten byter
   * ingen vy själv, och dess återställning är skjuten till en mikrotask — som
   * alltså kör efter den här raden och därmed med lyssnaren på plats. */
  initSenastePlats();
  // Skriver tangentbordets höjd som en variabel. Måste kopplas före första
  // dialogen kan öppnas; den läser variabeln i sin max-height.
  initTangentbord();
}

start();

// Repetitionsloggen las in i minnet sa att Spelhallen kan rakna statistik
// synkront under rendering.
void loadReviewLog();

// Molnlagret startas efter att appen renderat sin lokala data, sa att en
// langsam uppkoppling aldrig fordrojer forsta malningen.
void initCloud();
