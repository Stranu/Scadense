# Scadense · Setup Supabase (login + sync cloud)

Guida per attivare l'account facoltativo di Scadense e la sincronizzazione tra dispositivi.
Il codice dell'app è già pronto: qui c'è la parte da fare **a mano sulla dashboard di Supabase**.

Modello:
- **Local-first**: IndexedDB resta la fonte di verità sul dispositivo. Scadense funziona offline e senza account come prima.
- **Auth**: email + password (registrazione, accesso, recupero password via email).
- **Sync**: dopo ogni modifica (con attesa di circa 1,5 s), all'avvio, quando torna la connessione, ogni minuto ad app visibile e con il tasto «Sincronizza ora».
- **Conflitti**: last-write-wins sul campo `updated_at` (orologio del client). Le cancellazioni sono propagate come righe con `deleted = true`.

URL dell'app in produzione (ipotesi): `https://stranu.github.io/Scadense/`

---

## 0. Concetti di sicurezza (leggere una volta)

- La chiave **anon / publishable** è pubblica: è giusto che stia nel codice frontend (`js/supabase.js`), anche in una repo pubblica. La sicurezza NON dipende dal nasconderla.
- La sicurezza dipende da **RLS (Row Level Security)**: con le policy attive ogni utente legge e scrive solo le righe con `user_id = auth.uid()`.
- La chiave `service_role` **non va mai** nel frontend e Scadense non la usa.
- Nessuna chiave o password è scritta in questo documento.
- Piano free: il progetto va in pausa dopo circa una settimana di inattività totale; al primo accesso si risveglia in qualche secondo.

---

## 1. Progetto Supabase: si riusa quello esistente

Scadense usa **lo stesso progetto Supabase** di GymBro e IndiSpesabile: non serve crearne uno nuovo né cambiare URL o chiave. Le tabelle di Scadense hanno il prefisso `scadense_` e non toccano quelle delle altre app.

---

## 2. Creare le tabelle + RLS

1. Apri la dashboard Supabase → **SQL Editor → New query**.
2. Incolla tutto il contenuto del file `docs/supabase-scadense.sql` e premi **Run**.

Lo script è **idempotente**: puoi rieseguirlo senza errori. Crea:
- 3 tabelle: `scadense_items`, `scadense_history`, `scadense_categories` (chiave primaria `(user_id, id)`);
- la colonna `synced_at`, assegnata dal server, usata per il pull incrementale;
- la funzione `scadense_sync_guard()` e un trigger per tabella (ignora le scritture più vecchie di quelle già presenti e aggiorna `synced_at`);
- RLS attiva e 12 policy (`scadense_<tabella>_select_own`, `insert_own`, `update_own`, `delete_own`).

### Verifica rapida RLS
In **Database → Policies** devi vedere 4 policy per ciascuna delle 3 tabelle `scadense_*` e RLS su «Enabled». Se una tabella ha RLS disabilitato non proseguire.

---

## 3. Auth: email + password

1. **Authentication → Providers → Email**: deve essere **Enabled** (già così se usi le altre app).
2. **Conferma email**: se è attiva, dopo la registrazione l'utente deve aprire il link ricevuto prima di poter accedere.
3. **Authentication → URL Configuration → Redirect URLs**: aggiungi
   - `https://stranu.github.io/Scadense/`
   - `http://localhost:8080/`

   Mantieni anche gli URL già presenti per GymBro e IndiSpesabile. Serve perché il link di conferma e quello di recupero password riportino l'utente a Scadense. Il link di recupero torna come `#access_token=...&type=recovery` nell'indirizzo: Scadense lo gestisce da sola e apre il dialog «Nuova password».
4. **Site URL**: lascia quello esistente (non va cambiato per Scadense).

---

## 4. Account condiviso, sessione separata

Puoi usare **lo stesso account** (stessa email e password) delle altre app, ma l'accesso in Scadense è **separato**: accedere o uscire in Scadense non tocca GymBro e IndiSpesabile, e viceversa.

Tecnicamente Scadense salva la sessione in `localStorage` sotto la chiave **`scadense-auth`**, diversa da quella di GymBro (`sb-<ref>-auth-token`) e di IndiSpesabile (`indispesabile-auth`). Scadense non legge né scrive mai le chiavi delle altre app.

I dati invece sono per utente e per app: Scadense scrive solo nelle tabelle `scadense_*`.

---

## 5. Come si comporta l'app

- **Senza account**: nessuna chiamata di rete verso Supabase, tutto resta sul dispositivo.
- **Primo accesso su un dispositivo con dati**: Scadense chiede se caricarli nell'account («Carica e unisci»). I dati già nel cloud vengono uniti, niente viene cancellato. Con «Non ora» il pull avviene lo stesso e in **Altro** compare «Carica i dati locali».
- **Cambio account sullo stesso dispositivo**: Scadense chiede conferma e sostituisce i dati locali con quelli del nuovo account (esporta prima un backup se ti serve).
- **Esci**: i dati restano sul dispositivo; la sincronizzazione si ferma.
- **Offline**: le modifiche restano in coda («Da sincronizzare (N)») e partono al ritorno della connessione.
- **Backup JSON**: formato invariato; l'import passa dal normale percorso di scrittura, quindi si sincronizza se sei connesso.

---

## 6. Checklist finale

- [ ] `docs/supabase-scadense.sql` eseguito senza errori
- [ ] RLS «Enabled» + 4 policy su `scadense_items`, `scadense_history`, `scadense_categories`
- [ ] Provider Email abilitato
- [ ] Redirect URLs con `https://stranu.github.io/Scadense/` e `http://localhost:8080/`
- [ ] Accesso da Scadense (**Altro → Accedi / Registrati**) riuscito
- [ ] Dopo l'accesso, una modifica compare su un secondo dispositivo

---

## 7. Risoluzione problemi

- **«Tabelle Supabase non trovate: esegui docs/supabase-scadense.sql»**: lo script SQL non è stato eseguito (o è andato in errore). Eseguilo e premi «Sincronizza ora».
- **«Email non ancora confermata»**: apri il link nell'email di registrazione, oppure disattiva la conferma in Authentication → Providers → Email (solo per test).
- **Il link di recupero porta a una pagina sbagliata**: manca l'URL di Scadense tra i Redirect URLs.
- **Chip «Offline» con rete presente**: il progetto potrebbe essere in pausa (piano free); riprova dopo qualche secondo con «Sincronizza ora».
- **Chip «Accedi» assente**: la libreria `vendor/supabase.js` non è stata caricata; Scadense continua a funzionare in locale. Controlla che il file esista e sia in cache.
- **Non riesco ad accedere in Scadense ma sì in GymBro**: è normale se non hai mai fatto l'accesso in Scadense; la sessione è separata. Accedi anche qui con le stesse credenziali.

Non verificabile senza il backend reale: invio effettivo delle email di conferma e di recupero, e le impostazioni del tuo progetto (provider e Redirect URLs).
