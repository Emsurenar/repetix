// Inloggningsöverlägget.
//
// Appen fungerar även utan konto: väljer användaren "Fortsätt utan konto" körs
// allt mot lokal lagring precis som förut. Molnet är alltså en möjlighet, inte
// ett krav — vilket också gör att repot går att köra utan Supabase.

import {
  cloudConfigured,
  enabledProviders,
  onAuthChange,
  onPasswordRecovery,
  sendPasswordReset,
  signIn,
  signInWithGoogle,
  signUp,
  updatePassword,
} from '../core/supabase.js';

/** Sätts när användaren aktivt valt att köra lokalt, så att vi inte frågar igen. */
const SKIP_KEY = 'repetix_skip_auth';

let mode = 'signin';
let onSignedIn = () => {};

const el = (id) => document.getElementById(id);

const show = (node, visible) => {
  if (node) node.hidden = !visible;
};

/* Åtta tecken, inte sex. Sex gäller för inloggning eftersom befintliga konton
 * kan ha kortare lösenord sedan tidigare — men den som just nu sätter ett nytt
 * ska inte få sätta ett sämre än förra. */
const MIN_NYTT_LOSENORD = 8;

function setMode(next) {
  mode = next;
  const isSignUp = mode === 'signup';
  const isRecovery = mode === 'recovery';

  el('auth-submit').textContent = isRecovery
    ? 'Spara nytt lösenord'
    : isSignUp ? 'Skapa konto' : 'Logga in';
  el('auth-lead').textContent = isRecovery
    ? 'Välj ett nytt lösenord. Det gamla slutar gälla när du sparar.'
    : isSignUp
      ? 'Skapa ett konto så följer dina kort med mellan dator och telefon.'
      : 'Logga in för att nå dina kort från alla enheter.';

  /* I återställningsläget döljs allt som hör till inloggningen. Länken har
   * redan bevisat vem användaren är; att fråga efter det gamla lösenordet nu
   * vore att fråga efter det hen glömt. */
  show(el('auth-name-field'), isSignUp);
  show(el('auth-email').closest('.auth-field'), !isRecovery);
  show(el('auth-password').closest('.auth-field'), !isRecovery);
  show(el('auth-new-field'), isRecovery);
  show(el('auth-new-again-field'), isRecovery);
  show(el('auth-switch'), !isRecovery);
  show(el('auth-google'), !isRecovery && el('auth-google')?.dataset.pa === '1');
  show(el('auth-sep'), !isRecovery && el('auth-google')?.dataset.pa === '1');

  if (!isRecovery) {
    /* Frågan och svaret byter tillsammans. Knappen bar tidigare hela meningen
     * ("Jag har redan ett konto") eftersom den stod ensam; nu står den sist i
     * en fråga, och då ska den bara vara handlingen. */
    el('auth-switch-fraga').textContent = isSignUp
      ? 'Har du redan ett konto?'
      : 'Har du inget konto?';
    el('auth-toggle').textContent = isSignUp ? 'Logga in' : 'Skapa konto';
    el('auth-password').setAttribute(
      'autocomplete',
      isSignUp ? 'new-password' : 'current-password'
    );
  }
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

    if (mode === 'recovery') {
      const nytt = el('auth-new-password').value;
      const igen = el('auth-new-password-again').value;
      if (nytt.length < MIN_NYTT_LOSENORD) {
        showError(`Lösenordet måste vara minst ${MIN_NYTT_LOSENORD} tecken.`);
        return;
      }
      if (nytt !== igen) {
        showError('De två lösenorden är inte lika.');
        return;
      }
      setBusy(true);
      const { error: fel } = await updatePassword(nytt);
      setBusy(false);
      if (fel) {
        showError(fel);
        return;
      }
      el('auth-new-password').value = '';
      el('auth-new-password-again').value = '';
      setMode('signin');
      showNotice('Lösenordet är bytt. Du är inloggad.');
      closeAuth();
      return;
    }

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

  // Visa Google-knappen bara om leverantoren faktiskt ar paslagen i projektet.
  // Avdelaren foljer med: ett "eller" utan nagot att valja mellan ar brus.
  void enabledProviders().then((providers) => {
    const pa = Boolean(providers.google);
    // Sparas på elementet så att setMode kan visa knappen igen när
    // återställningsläget lämnas, utan att fråga servern en gång till.
    el('auth-google').dataset.pa = pa ? '1' : '0';
    show(el('auth-google'), pa && mode !== 'recovery');
    show(el('auth-sep'), pa && mode !== 'recovery');
  });

  /* Klickad återställningslänk. Överlägget öppnas oavsett om användaren redan
   * räknas som inloggad — det är hela poängen: token loggade in hen, men
   * lösenordet är fortfarande det gamla tills det här formuläret sparats. */
  onPasswordRecovery(() => {
    setMode('recovery');
    openAuth();
    el('auth-new-password')?.focus();
  });

  onAuthChange((user) => {
    if (mode === 'recovery') return;
    if (user) {
      closeAuth();
      onSignedIn(user);
    } else if (!hasSkippedAuth()) {
      openAuth();
    }
  });
}
