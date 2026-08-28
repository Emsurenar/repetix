import { S } from '../../core/state.js';
import { flashcardDiv, flipBtn, flipCard } from '../flashcard.js';
import { processRating, renderStudyCard } from '../study.js';


    const skipBtn = document.getElementById('btn-skip');

export function initUiWiringStudy() {

      if (flashcardDiv) flashcardDiv.addEventListener('click', flipCard);
      if (flipBtn) flipBtn.addEventListener('click', flipCard);
      if (skipBtn) {
          skipBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const flashcardContainer = document.querySelector('.flashcard');
              flashcardContainer.classList.add('swipe-left');
              setTimeout(() => {
                  flashcardContainer.classList.remove('swipe-left');
                  S.currentStudyIndex++;
                  renderStudyCard();
              }, 300);
          });
      }

      // Rating Buttons
      document.querySelectorAll('.btn-rate').forEach(btn => {
          btn.addEventListener('click', (e) => {
              e.stopPropagation();
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
