# Scadense

> **Nota:** questa app era stata inizialmente chiamata «Nova» ed è stata rinominata **Scadense**. Tabelle Supabase (`scadense_*`), chiave di sessione (`scadense-auth`), database locale e cache sono stati rinominati di conseguenza: nessuna migrazione dai vecchi nomi.

Scadenziario personale della vita adulta: bollo, assicurazione, revisione, documenti, abbonamenti, bollette, garanzie, visite mediche e tutto ciò che ritorna e si dimentica. Funziona offline e l'account è facoltativo: senza account i dati restano solo sul tuo telefono; con l'account li sincronizzi tra più dispositivi.

## Cosa fa

- **Prossime**: scadenze ordinate per urgenza (Scadute / Questa settimana / Questo mese / Più avanti), riepilogo, ricerca e filtri per categoria e stato (attive / archivio).
- **Nuova scadenza**: titolo, categoria, data, ricorrenza (mensile, trimestrale, semestrale, annuale, biennale o personalizzata), importo, preavviso, note e riferimento (n. polizza, targa).
- **Fatto / Rinnovato**: se è ricorrente calcola la prossima data e salva lo storico; altrimenti archivia. Con **Annulla** per tornare indietro.
- **Posticipa**: +1 giorno, +1 settimana, +1 mese o data a scelta.
- **Calendario** mensile con i giorni che hanno scadenze.
- **Costi**: stima annua e mensile delle voci ricorrenti, ripartizione per categoria, prossimi 12 mesi.
- **Pagamento automatico** (con metodo di pagamento): all'apertura Scadense registra gli addebiti maturati, anche quelli persi (con importo nello storico), e passa alla data successiva invece di mostrare «Scadute». Badge «Addebito tra X g» con preavviso, filtro **Automatici** e marcatore distinto nel calendario.
- **Abbonamenti**: vista dedicata con importo, prossimo addebito, equivalente mensile, totali al mese e all'anno; pausa, disdetta («attivo fino al», poi archiviato come **Disdetto**) e riattivazione. Modelli rapidi senza prezzi (Netflix, Spotify, Amazon Prime, Disney+, YouTube Premium, iCloud / Google One, palestra, software).
- **Data di fine o numero di rate** sulle ricorrenze (finanziamenti): rate rimanenti, residuo, barra di avanzamento ed estinzione prevista; dopo l'ultima rata la voce passa in archivio come **Concluso**. Costi, stima annua, prossimi 12 mesi e .ics (con UNTIL) rispettano la fine. Si può combinare con il pagamento automatico.
- **Categorie** personalizzabili, **modelli rapidi** (Bollo auto, RC auto, Revisione, Carta d'identità…).
- **Promemoria** in-app all'apertura, notifiche opzionali (solo ad app aperta) e badge dove supportato.
- **Export .ics** per Google Calendar, **backup JSON** (esporta/importa con unisci o sostituisci), tema chiaro/scuro/automatico.

## Avvio in locale
```
# consigliato: forza i MIME corretti anche su Windows
python serve.py 8080
```
Oppure `python -m http.server 8080` (funziona perche' l'app usa uno script classico, ma su Windows il service worker potrebbe non registrarsi se `.js` risulta `text/plain` nel registro). Poi apri http://localhost:8080. Il service worker richiede `localhost` o HTTPS.

L'app carica `app.bundle.js` (script classico, generato da `js/`). Dopo ogni modifica ai sorgenti in `js/` esegui `node tools/build.mjs` e cambia `CACHE_VERSION` in `sw.js`. Il bundle non dipende dal MIME dei file `.js`: il problema 'Failed to load module script ... text/plain' era solo locale, GitHub Pages serve i MIME corretti.

Test unitari (Node): `node tools/test.mjs`. Rigenerare le icone: `node tools/generate-icons.mjs`.

## Installazione su Android

1. Pubblica la cartella su un hosting HTTPS (ad esempio GitHub Pages) oppure raggiungila in rete locale.
2. Apri l'indirizzo con Chrome.
3. Menu ⋮ → **Installa app** (o **Aggiungi a schermata Home**).

## GitHub Pages

I percorsi sono relativi: basta pubblicare il contenuto della cartella, anche in una sottocartella.

## Backup

Da **Altro → Esporta backup** ottieni un file JSON. Con **Importa backup** puoi unire i dati o sostituire quelli attuali (viene mostrata un'anteprima dei conteggi). Il backup usa lo schema versione 2; i backup versione 1 si importano ancora (i campi nuovi prendono i valori predefiniti), quelli di versione superiore vengono rifiutati. Fai un backup ogni tanto: se cancelli i dati del browser, le scadenze vanno perse.

## Aggiornamenti

Ad ogni modifica ai file cambia la costante `CACHE_VERSION` in `sw.js` (attuale: `v4`): la nuova versione verrà scaricata e l'app mostrerà "Aggiornamento disponibile".

## Account e sincronizzazione (facoltativi)

Da **Altro → Accedi / Registrati** (o dal chip «Accedi» in alto) puoi creare un account Supabase e sincronizzare scadenze, storico e categorie tra più dispositivi. Senza account Scadense non fa alcuna richiesta di rete e funziona come sempre, anche offline.

- **Stesso account, sessione separata**: puoi usare le stesse credenziali di GymBro e IndiSpesabile, ma l'accesso in Scadense è indipendente (chiave `scadense-auth` in `localStorage`): entrare o uscire qui non tocca le altre app.
- **Dati**: tabelle `scadense_items`, `scadense_history`, `scadense_categories` con RLS. Setup in [docs/supabase-setup.md](docs/supabase-setup.md), SQL in [docs/supabase-scadense.sql](docs/supabase-scadense.sql) (idempotente, da eseguire a mano nello SQL Editor).
- **Offline**: le modifiche vengono accodate e inviate al ritorno della rete. Conflitti: vince l'ultima modifica.
- **Libreria**: `vendor/supabase.js` è la build UMD di `@supabase/supabase-js` **2.45.4** (da `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js`), inclusa nella precache del service worker. Se manca, Scadense resta utilizzabile in locale e il chip non compare.
- **Limite noto**: se un dispositivo segna come pagato a mano un addebito automatico mentre un altro, offline, lo registra da solo con la scadenza automatica prima di sincronizzare, lo storico può contenere sia la voce manuale sia quella `auto-` per la stessa data. Gli addebiti automatici registrati da due dispositivi non si duplicano (id deterministico).

### Test

```
node tools/build.mjs                         # rigenera app.bundle.js
node tools/test.mjs                          # test unitari (incluso sync e convergenza a due dispositivi)
node .agents/verify/verify.mjs               # E2E base
node .agents/verify/verify-subs.mjs          # E2E abbonamenti
node .agents/verify/verify-supabase.mjs      # E2E account/sync con Supabase finto in memoria
```

Gli E2E richiedono Playwright installato in `GymBro/.agents/verify/node_modules` e non contattano mai il Supabase reale (tranne una lettura innocua di `/auth/v1/settings`).