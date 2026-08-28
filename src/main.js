// Startpunkt. Modulerna innehåller enbart definitioner; all DOM-koppling
// sker i init-funktioner som anropas här, i samma ordning som den
// ursprungliga filen körde dem.

import './app/vendor.js';

import { initCoreState } from './core/state.js';
import { initCoreStorage } from './core/storage.js';
import { initUiImages } from './ui/images.js';
import { initUiModalsWiring } from './ui/modals-wiring.js';
import { initUiRouter } from './ui/router.js';
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
import { initUiWiringAiActions } from './ui/wiring/ai-actions.js';
import { initUiWiringStudy } from './ui/wiring/study.js';
import { initAppInit } from './app/init.js';
import { initUiSearch } from './ui/search.js';

export function start() {
  initCoreState();
  initCoreStorage();
  initUiImages();
  initUiModalsWiring();
  initUiRouter();
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
  initUiWiringAiActions();
  initUiWiringStudy();
  initAppInit();
  initUiSearch();
}

start();
