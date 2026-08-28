import { S } from '../../core/state.js';
import { flashcardDiv, flipBtn, flipCard, nyssVand } from '../flashcard.js';
import { afterCardExit, processRating, renderStudyCard } from '../study.js';


    const skipBtn = document.getElementById('btn-skip');

export function initUiWiringStudy() {

      if (flashcardDiv) flashcardDiv.addEventListener('click', flipCard);
      if (flipBtn) flipBtn.addEventListener('click', flipCard);
      if (skipBtn) {
          /* Kortet skjuts undan åt vänster och nästa kommer in när utgången
           * faktiskt är klar. Här låg en gissad fördröjning på 300 ms mot en
           * övergång som varar 220 — den visste varken när animationen tog
           * slut eller att prefers-reduced-motion nollat den. afterCardExit
           * frågar kortet i stället. */
          skipBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const flashcardContainer = document.querySelector('.flashcard');
              if (!flashcardContainer) return;
              flashcardContainer.classList.add('swipe-left');
              afterCardExit(flashcardContainer, () => {
                  flashcardContainer.classList.remove('swipe-left');
                  S.currentStudyIndex++;
                  renderStudyCard();
              });
          });
      }

      // Rating Buttons
      document.querySelectorAll('.btn-rate').forEach(btn => {
          btn.addEventListener('click', (e) => {
              e.stopPropagation();
              // Betygsraden tar over samma pixlar som "Visa svar" lag pa. Ett
              // andra klick fran samma tryck ska inte bli ett betyg.
              if (nyssVand()) return;
              const rating = parseInt(btn.getAttribute('data-rating'));
              processRating(rating);
          });
      });

      // Keyboard shortcuts for study: Space/Enter to flip, 1-4 to rate
      document.addEventListener('keydown', (e) => {
          if (S.currentViewName !== 'study') return;
          if (S.playgroundMode) return; // Ignore standard study keyboard shortcuts when in a playground mode game
          // Don't intercept if user is typing in the AI input
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

          if ((e.key === ' ' || e.key === 'Enter') && !document.getElementById('study-flip-action').classList.contains('hidden')) {
              e.preventDefault();
              flipCard();
          } else if (e.key === 's' && !document.getElementById('study-flip-action').classList.contains('hidden')) {
              e.preventDefault();
              document.getElementById('btn-skip')?.click();
          } else if (['1','2','3','4'].includes(e.key) && !document.getElementById('study-actions').classList.contains('hidden')) {
              e.preventDefault();
              processRating(parseInt(e.key));
          }
      });
}
