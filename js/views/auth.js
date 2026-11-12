// Dialog di autenticazione: accesso / registrazione / recupero, nuova password, primo accesso, cambio account.
import { h, modal, sheetHeader, field, setError, toast } from '../ui.js';
import { signIn, signUp, resetPassword, updatePassword, authErrorMessage, authAvailable } from '../supabase.js';

const LIB_MSG = 'Accesso e sincronizzazione non disponibili: la libreria non è stata caricata. Scadense continua a funzionare in locale.';
const OFFLINE_HINT = 'Sei offline: per accedere serve una connessione.';

// Modalità: login | signup | recover. Il dialog resta aperto in caso di errore.
export function openAuthModal({ onDone } = {}) {
  let mode = 'login';
  return modal((close) => {
    const email = h('input', { type: 'email', autocomplete: 'email', inputmode: 'email', placeholder: 'tu@email.it' });
    const pass = h('input', { type: 'password', autocomplete: 'current-password' });
    const emailF = field('Email', email);
    const passF = field('Password', pass, { hint: 'Almeno 6 caratteri.' });
    const formErr = h('p', { class: 'err', role: 'alert' });
    const intro = h('p', { class: 'muted' });
    const offlineNote = h('p', { class: 'muted', hidden: true }, OFFLINE_HINT);
    const heading = sheetHeader('Accesso', close);
    const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary' });
    const forgot = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { mode = 'recover'; apply(); email.focus(); } }, 'Password dimenticata?');
    const toggle = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { mode = mode === 'login' ? 'signup' : 'login'; apply(); } });
    const back = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { mode = 'login'; apply(); } }, '‹ Torna all\'accesso');
    const libNote = h('p', { class: 'err', role: 'alert', hidden: authAvailable() }, LIB_MSG);

    function apply() {
      formErr.textContent = '';
      setError(email, ''); setError(pass, '');
      passF.hidden = mode === 'recover';
      forgot.hidden = mode !== 'login';
      toggle.hidden = mode === 'recover';
      back.hidden = mode !== 'recover';
      offlineNote.hidden = navigator.onLine !== false;
      if (mode === 'login') {
        intro.textContent = 'Accedi per sincronizzare le tue scadenze sul cloud e usarle su più dispositivi. Scadense funziona comunque anche senza account e offline.';
        submitBtn.textContent = 'Accedi';
        toggle.textContent = 'Non hai un account? Registrati';
        pass.autocomplete = 'current-password';
      } else if (mode === 'signup') {
        intro.textContent = 'Crea un account per salvare le tue scadenze sul cloud. Puoi usare lo stesso account delle altre app.';
        submitBtn.textContent = 'Registrati';
        toggle.textContent = 'Hai già un account? Accedi';
        pass.autocomplete = 'new-password';
      } else {
        intro.textContent = 'Inserisci la tua email: ti invieremo un link per reimpostare la password.';
        submitBtn.textContent = 'Invia link di recupero';
      }
    }

    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (submitBtn.disabled) return;
      const em = email.value.trim();
      const pw = pass.value;
      formErr.textContent = '';
      setError(email, em ? '' : 'Inserisci la tua email.');
      const needPw = mode !== 'recover';
      setError(pass, !needPw ? '' : (!pw ? 'Inserisci la password.' : (mode === 'signup' && pw.length < 6 ? 'La password deve avere almeno 6 caratteri.' : '')));
      if (!em || (needPw && (!pw || (mode === 'signup' && pw.length < 6)))) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
      submitBtn.disabled = true;
      try {
        const res = mode === 'login' ? await signIn(em, pw) : mode === 'signup' ? await signUp(em, pw) : await resetPassword(em);
        if (res && res.error) { formErr.textContent = authErrorMessage(res.error); return; }
        if (mode === 'recover') {
          toast('Se l\'email è registrata, riceverai un link per reimpostare la password.');
          close(true);
        } else if (mode === 'signup') {
          toast('Registrazione effettuata. Controlla la tua email se richiesto.');
          close(true);
          if (res && res.data && res.data.session && typeof onDone === 'function') onDone();
        } else {
          toast('Accesso effettuato');
          close(true);
          if (typeof onDone === 'function') onDone();
        }
      } catch (err) {
        console.error(err);
        formErr.textContent = authErrorMessage(err);
      } finally {
        submitBtn.disabled = false;
      }
    } },
      heading, intro, libNote, offlineNote, emailF, passF, formErr,
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Annulla'),
        submitBtn),
      forgot, toggle, back);
    apply();
    setTimeout(() => email.focus(), 50);
    return form;
  }, { label: 'Accesso' });
}

// Dialog "nuova password" dopo l'evento PASSWORD_RECOVERY. Chiude solo con successo o Annulla.
export function openNewPasswordModal() {
  return modal((close) => {
    const p1 = h('input', { type: 'password', autocomplete: 'new-password' });
    const p2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const formErr = h('p', { class: 'err', role: 'alert' });
    const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Salva password');
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (submitBtn.disabled) return;
      formErr.textContent = '';
      setError(p1, !p1.value ? 'Inserisci la nuova password.' : (p1.value.length < 6 ? 'La password deve avere almeno 6 caratteri.' : ''));
      setError(p2, p1.value && p2.value !== p1.value ? 'Le due password non coincidono.' : '');
      if (form.querySelector('[aria-invalid="true"]')) { form.querySelector('[aria-invalid="true"]').focus(); return; }
      submitBtn.disabled = true;
      try {
        const { error } = await updatePassword(p1.value);
        if (error) { formErr.textContent = authErrorMessage(error); return; }
        toast('Password aggiornata');
        close(true);
      } catch (err) {
        console.error(err);
        formErr.textContent = authErrorMessage(err);
      } finally { submitBtn.disabled = false; }
    } },
      sheetHeader('Nuova password', close),
      h('p', { class: 'muted' }, 'Imposta la tua nuova password.'),
      field('Nuova password', p1), field('Ripeti password', p2), formErr,
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Annulla'),
        submitBtn));
    setTimeout(() => p1.focus(), 50);
    return form;
  }, { label: 'Nuova password' });
}

// Primo accesso con dati locali: 'upload' | 'later'.
export function askUploadLocal(counts) {
  const c = counts || {};
  const msg = `Trovati ${c.items || 0} scadenze, ${c.categories || 0} categorie su questo dispositivo. Vuoi caricarle nel tuo account? I dati già presenti nel cloud vengono uniti, niente viene cancellato.`;
  return modal((close) => h('div', null,
    sheetHeader('Carica i dati di questo dispositivo?', () => close('later')),
    h('p', { class: 'muted' }, msg),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: () => close('later') }, 'Non ora'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => close('upload') }, 'Carica e unisci'))),
  { label: 'Carica i dati di questo dispositivo' }).then((v) => (v === 'upload' ? 'upload' : 'later'));
}

// Cambio account: true = sostituisci, false = annulla (il chiamante esegue signOut).
export function confirmAccountSwitch() {
  return modal((close) => h('div', null,
    sheetHeader('Cambio account', () => close(false)),
    h('p', { class: 'muted' }, 'Questo dispositivo contiene i dati di un altro account. Per continuare verranno sostituiti con quelli di questo account. Esporta prima un backup se ti serve.'),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: () => close(false) }, 'Annulla'),
      h('button', { type: 'button', class: 'btn btn-danger', onclick: () => close(true) }, 'Sostituisci'))),
  { label: 'Cambio account' }).then((v) => v === true);
}
