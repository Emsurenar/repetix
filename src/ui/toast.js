// --- NOTIFICATION ---

/* Hur länge ett besked står kvar. En bekräftelse behöver inte läsas — den
 * behöver bara hinna uppfattas — men den ska inte försvinna medan blicken är
 * på väg dit. */
const LIVSLANGD = 2600;

/**
 * Visar ett kort besked längst ned på skärmen.
 *
 * Notisen togs tidigare bort rakt av när tiden gått ut, mitt i bild. Nu lämnar
 * den samma väg som den kom: den tonar ned och sjunker undan, och tas bort
 * först när den rörelsen är slut. Ett besked som klipps bort ser ut som ett
 * fel i appen, inte som ett besked som är över.
 */
export const showToast = (message) => {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.innerText = message;
    container.appendChild(toast);

    const tabort = () => toast.remove();

    setTimeout(() => {
        toast.classList.add('is-leaving');
        // Säkerhetsnät: om animationen aldrig kommer igång — den som stängt av
        // rörelse får noll varaktighet — ska notisen ändå försvinna.
        const timer = setTimeout(tabort, 400);
        toast.addEventListener(
            'animationend',
            () => {
                clearTimeout(timer);
                tabort();
            },
            { once: true }
        );
    }, LIVSLANGD);
};
