
// --- GENERIC MODAL HELPERS ---
export const showConfirmModal = (title, message, okLabel = 'OK', destructive = false) => {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-confirm');
        document.getElementById('confirm-modal-title').textContent = title;
        document.getElementById('confirm-modal-message').textContent = message;
        const okBtn = document.getElementById('btn-confirm-ok');
        okBtn.textContent = okLabel;
        if (destructive) {
            okBtn.style.background = '#A62626';
            okBtn.style.borderColor = '#A62626';
        } else {
            okBtn.style.background = '';
            okBtn.style.borderColor = '';
        }
        modal.classList.remove('hidden');

        const cleanup = (result) => {
            modal.classList.add('hidden');
            okBtn.removeEventListener('click', onOk);
            document.getElementById('btn-confirm-cancel').removeEventListener('click', onCancel);
            resolve(result);
        };
        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);
        okBtn.addEventListener('click', onOk);
        document.getElementById('btn-confirm-cancel').addEventListener('click', onCancel);
    });
};

export const showPromptModal = (title, defaultValue = '') => {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-prompt');
        document.getElementById('prompt-modal-title').textContent = title;
        const input = document.getElementById('prompt-modal-input');
        input.value = defaultValue;
        modal.classList.remove('hidden');
        setTimeout(() => { input.focus(); input.select(); }, 50);

        const cleanup = (result) => {
            modal.classList.add('hidden');
            form.removeEventListener('submit', onSubmit);
            document.getElementById('btn-prompt-cancel').removeEventListener('click', onCancel);
            resolve(result);
        };
        const form = document.getElementById('form-prompt-modal');
        const onSubmit = (e) => { e.preventDefault(); cleanup(input.value.trim()); };
        const onCancel = () => cleanup(null);
        form.addEventListener('submit', onSubmit);
        document.getElementById('btn-prompt-cancel').addEventListener('click', onCancel);
    });
};
