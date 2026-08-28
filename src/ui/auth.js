// Inloggningsöverlägget.
//
// Appen fungerar även utan konto: väljer användaren "Fortsätt utan konto" körs
// allt mot lokal lagring precis som förut. Molnet är alltså en möjlighet, inte
// ett krav — vilket också gör att repot går att köra utan Supabase.

import {
  cloudConfigured,
  onAuthChange,
  sendPasswordReset,
  signIn,
  signInWithGoogle,
  signUp,
} from '../core/supabase.js';

/** Sätts när användaren aktivt valt att köra lokalt, så att vi inte frågar igen. */
const SKIP_KEY = 'repetix_skip_auth';

let mode = 'signin';
let onSignedIn = () => {};

const el = (id) => document.getElementById(id);

const show = (node, visible) => {
  if (node) node.hidden = !visible;
};

function setMode(next) {
  mode = next;
  const isSignUp = mode === 'signup';
  el('auth-submit').textContent = isSignUp ? 'Skapa konto' : 'Logga in';
  el('auth-toggle').textContent = isSignUp ? 'Jag har redan ett konto' : 'Skapa konto';
  el('auth-lead').textContent = isSignUp
    ? 'Skapa ett konto så följer dina kort med mellan dator och telefon.'
    : 'Logga in för att nå dina kort från alla enheter.';
  show(el('auth-name-field'), isSignUp);
  el('auth-password').setAttribute(
    'autocomplete',
    isSignUp ? 'new-password' : 'current-password'
  );
  clearMessages();
}

function clearMessages() {
  show(el('auth-error'), false);
  show(el('auth-notice'), false);
}

function showError(message) {
  const node = el('auth-error');
  node.textContent = message;
  show(node, true);
  show(el('auth-notice'), false);
}

function showNotice(message) {
  const node = el('auth-notice');
  node.textContent = message;
  show(node, true);
  show(el('auth-error'), false);
}

function setBusy(busy) {
  const btn = el('auth-submit');
  btn.disabled = busy;
  btn.textContent = busy
    ? 'Ett ögonblick...'
    : mode === 'signup'
      ? 'Skapa konto'
      : 'Logga in';
}

export function openAuth() {
  el('auth-overlay')?.classList.remove('hidden');
  el('auth-email')?.focus();
}

export function closeAuth() {
  el('auth-overlay')?.classList.add('hidden');
}

/** Har användaren valt att köra utan konto? */
export function hasSkippedAuth() {
  try {
    return localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Kopplar upp inloggningen.
 *
 * @param {{onSignedIn: (user: object) => void}} options anropas när en
 *   användare loggat in, så att appen kan hämta data och rendera om.
 */
export function initAuthUi({ onSignedIn: signedInCallback } = {}) {
  onSignedIn = signedInCallback ?? (() => {});

  const overlay = el('auth-overlay');
  if (!overlay) return;

  // Utan konfiguration finns inget att logga in mot. Då visas överlägget
  // aldrig och appen beter sig som den lokala versionen.
  if (!cloudConfigured) {
    closeAuth();
    return;
  }

  el('auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessages();

    const email = el('auth-email').value.trim();
    const password = el('auth-password').value;
    const name = el('auth-name').value.trim();

    if (!email || !password) {
      showError('Fyll i både e-post och lösenord.');
      return;
    }
    if (mode === 'signup' && password.length < 6) {
      showError('Lösenordet måste vara minst 6 tecken.');
      return;
    }

    setBusy(true);
    const { error } =
      mode === 'signup' ? await signUp(email, password, name) : await signIn(email, password);
    setBusy(false);

    if (error) {
      showError(error);
      return;
    }
    if (mode === 'signup') {
      // Med e-postbekräftelse påslagen finns ingen session förrän länken
      // klickats, så vi kan inte anta att användaren är inloggad här.
      showNotice('Konto skapat. Kolla din e-post om vi bad om en bekräftelse.');
      setMode('signin');
    }
  });

  el('auth-toggle').addEventListener('click', () => {
    setMode(mode === 'signup' ? 'signin' : 'signup');
  });

  el('auth-forgot').addEventListener('click', async () => {
    const email = el('auth-email').value.trim();
    if (!email) {
      showError('Skriv in din e-postadress först, så skickar vi en återställningslänk.');
      el('auth-email').focus();
      return;
    }
    const { error } = await sendPasswordReset(email);
    if (error) showError(error);
    else showNotice('Vi har skickat en återställningslänk till din e-post.');
  });

  el('auth-google').addEventListener('click', async () => {
    const { error } = await signInWithGoogle();
    if (error) showError(error);
  });

  el('auth-skip').addEventListener('click', () => {
    try {
      localStorage.setItem(SKIP_KEY, '1');
    } catch {
      // Går inte att spara valet — appen fungerar ändå, frågan kommer bara igen.
    }
    closeAuth();
  });

  setMode('signin');

  onAuthChange((user) => {
    if (user) {
      closeAuth();
      onSignedIn(user);
    } else if (!hasSkippedAuth()) {
      openAuth();
    }
  });
}
