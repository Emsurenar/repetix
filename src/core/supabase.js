// Supabase-klienten och kontohanteringen.
//
// Klienten skapas bara om konfigurationen finns. Saknas den kör appen vidare i
// enbart lokalt läge — det gör att repot går att klona och köra utan konto, och
// att en felaktig deploy inte ger en vit skärm utan en app som fortfarande
// fungerar mot lokal lagring.

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env?.VITE_SUPABASE_URL;
const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;

/** Sant när molnfunktionerna är konfigurerade. */
export const cloudConfigured = Boolean(url && anonKey);

export const supabase = cloudConfigured
  ? createClient(url, anonKey, {
      auth: {
        // Sessionen ska överleva att fliken stängs; annars måste användaren
        // logga in på nytt varje gång, vilket särskilt på mobil är oanvändbart.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

let currentUser = null;
const listeners = new Set();

/** Den inloggade användaren, eller null. Läses synkront av synken. */
export function getUser() {
  return currentUser;
}

export function getUserId() {
  return currentUser?.id ?? null;
}

/**
 * Prenumerera på inloggningsändringar. Anropas direkt med nuvarande värde så
 * att anroparen slipper hantera "har det redan hänt?".
 */
export function onAuthChange(fn) {
  listeners.add(fn);
  fn(currentUser);
  return () => listeners.delete(fn);
}

/* Återställningslänken.
 *
 * Med detectSessionInUrl konsumerar klienten återställningstoken och skapar en
 * session — användaren blir alltså inloggad av att klicka länken. Utan det här
 * lyssnaren stannade det där: "Glömt lösenordet" var i praktiken en
 * inloggningslänk, och den vars lösenord läckt trodde sig ha bytt det medan
 * det gamla fortfarande gällde. */
const recoveryListeners = new Set();
let recoveryPending = false;

export function onPasswordRecovery(fn) {
  recoveryListeners.add(fn);
  // Händelsen kan ha passerat innan gränssnittet hann koppla sig.
  if (recoveryPending) fn();
  return () => recoveryListeners.delete(fn);
}

export async function updatePassword(password) {
  if (!supabase) return { error: 'Molnlagring är inte konfigurerad.' };
  const { error } = await supabase.auth.updateUser({ password });
  if (!error) recoveryPending = false;
  return { error: error ? translateAuthError(error) : null };
}

function setUser(user) {
  const changed = currentUser?.id !== user?.id;
  currentUser = user ?? null;
  if (changed) for (const fn of listeners) fn(currentUser);
}

/**
 * Läser in befintlig session och börjar lyssna på ändringar.
 * Returnerar användaren om någon redan är inloggad.
 */
export async function initAuth() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  setUser(data.session?.user ?? null);
  supabase.auth.onAuthStateChange((event, session) => {
    setUser(session?.user ?? null);
    if (event === 'PASSWORD_RECOVERY') {
      recoveryPending = true;
      for (const fn of recoveryListeners) fn();
    }
  });
  return currentUser;
}

/**
 * Vilka inloggningssätt som är påslagna i Supabase-projektet.
 *
 * Frågas i stället för att hårdkodas, så att repot fungerar för den som
 * självhostar utan Google: knappen dyker upp av sig själv när leverantören
 * aktiveras, och visas aldrig när ett klick bara hade gett ett felmeddelande.
 */
let providerCache = null;

export async function enabledProviders() {
  if (!supabase) return {};
  if (providerCache) return providerCache;
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
    if (!res.ok) return {};
    const data = await res.json();
    providerCache = data.external ?? {};
    return providerCache;
  } catch {
    // Utan nätet vet vi inte. Att gissa fel åt hållet "påslagen" ger en knapp
    // som inte fungerar, så vi visar hellre ingen.
    return {};
  }
}

// ---------------------------------------------------------------------------
// Kontoåtgärder
//
// Alla returnerar { error } med ett meddelande på svenska i stället för att
// kasta, eftersom varje anropsställe ändå ska visa felet i gränssnittet.
// ---------------------------------------------------------------------------

export async function signUp(email, password, displayName) {
  if (!supabase) return { error: 'Molnlagring är inte konfigurerad.' };
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName || undefined } },
  });
  return { error: error ? translateAuthError(error) : null };
}

export async function signIn(email, password) {
  if (!supabase) return { error: 'Molnlagring är inte konfigurerad.' };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error ? translateAuthError(error) : null };
}

export async function signInWithGoogle() {
  if (!supabase) return { error: 'Molnlagring är inte konfigurerad.' };
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  return { error: error ? translateAuthError(error) : null };
}

export async function sendPasswordReset(email) {
  if (!supabase) return { error: 'Molnlagring är inte konfigurerad.' };
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/#aterstall`,
  });
  return { error: error ? translateAuthError(error) : null };
}

export async function signOut() {
  if (!supabase) return { error: null };
  const { error } = await supabase.auth.signOut();
  return { error: error ? translateAuthError(error) : null };
}

/**
 * Supabases felmeddelanden är på engelska och ibland avsiktligt vaga för att
 * inte avslöja om ett konto finns. Vi översätter de vanliga och släpper
 * igenom resten oförändrade hellre än att visa "något gick fel".
 */
function translateAuthError(error) {
  const msg = error.message ?? String(error);
  const map = {
    'Invalid login credentials': 'Fel e-postadress eller lösenord.',
    'Email not confirmed': 'Bekräfta din e-postadress först. Kolla inkorgen.',
    'User already registered': 'Det finns redan ett konto med den adressen.',
    'Password should be at least 6 characters':
      'Lösenordet måste vara minst 6 tecken.',
    'Unable to validate email address: invalid format': 'E-postadressen ser inte giltig ut.',
    'For security purposes, you can only request this after 60 seconds.':
      'Vänta en minut innan du försöker igen.',
  };
  if (map[msg]) return map[msg];
  if (/rate limit/i.test(msg)) return 'För många försök. Vänta en stund och prova igen.';
  if (/network|fetch/i.test(msg)) return 'Ingen kontakt med servern. Kontrollera din uppkoppling.';
  return msg;
}
