# Spesa Smart 5.0 — Motore universale

Questa versione introduce un contratto unico per i connettori, catalogo di copertura, pulizia automatica delle offerte scadute, storico degli ultimi 60 aggiornamenti e inserimento rapido della lista. PENNY ed Eurospin estraggono offerte; Lidl collega automaticamente il volantino nazionale. Le altre catene restano predisposte al PDF o a futuri connettori.

## Versione 4.2.1

- PENNY ed Eurospin con offerte disponibili vengono mostrati come “Volantino locale collegato”.
- Il pulsante “Collega PDF” resta nascosto per le catene automatiche.
- Corretto il confronto tra identificativi del punto vendita.

# Spesa Smart v4.2.0

Novità: collegamento automatico e persistente dei volantini locali PENNY/Eurospin, stato in `data/volantini-locali.json`, interfaccia senza richiesta PDF per le catene automatiche e log GitHub Actions compatto.

## Versione 3.0.2

Corretto il caricamento del connettore PENNY locale: aggiunta la funzione `numberValue` usata per convertire i prezzi.

# Spesa Smart

Web app pronta per GitHub Pages.

## Già funzionante
- aggiunta, modifica, duplicazione ed eliminazione prodotti;
- categorie, preferiti e prezzo massimo;
- ricerca e filtro;
- salvataggio automatico nel browser;
- esportazione backup JSON;
- lettura offerte da `data/offerte.json`;
- installazione PWA e uso offline;
- collegamento facoltativo a Google Fogli.

## Pubblicazione
1. Estrai lo ZIP.
2. Carica **tutti i file e le cartelle** nella radice del repository SpesaSmart, sostituendo i file già presenti.
3. Vai in **Settings → Pages**.
4. Scegli **Deploy from a branch**, branch `main`, cartella `/ (root)`.
5. Salva e attendi alcuni minuti.

## Google Fogli
1. Crea un Foglio Google.
2. Vai in **Estensioni → Apps Script**.
3. Incolla `google/Code.gs`.
4. Distribuisci come **Applicazione web**, eseguita da te e accessibile a chiunque abbia il link.
5. Copia l'URL e inseriscilo nelle impostazioni dell'app.

L'app funziona subito anche senza Google Fogli: i dati restano nel browser.

## Offerte
La prima versione contiene due offerte dimostrative. Puoi modificare `data/offerte.json`. La ricerca automatica reale richiede connettori specifici o fonti autorizzate.

## Versione 2.0.0 Alpha

Aggiunto il modulo **I miei supermercati**:
- ricerca dei negozi vicini tramite GPS e OpenStreetMap/Overpass;
- scelta della distanza massima;
- selezione e salvataggio locale;
- sincronizzazione della selezione tramite Apps Script e foglio `Supermercati`;
- filtro delle offerte in base alle catene selezionate;
- collegamento diretto a Google Maps.

Dopo aver sostituito `google/Code.gs`, creare una **nuova distribuzione** della Web App Apps Script.


## Versione 2.0.2

- associa ogni offerta ai punti vendita selezionati della stessa catena;
- mostra il negozio selezionato più vicino, indirizzo e distanza;
- distingue chiaramente le offerte di catena dalla validità locale verificata;
- non dichiara locale un'offerta finché il connector non dispone di una fonte ufficiale specifica del punto vendita.


## Versione 2.1.0
Aggiunto il piano intelligente che assegna ogni prodotto all'offerta più economica tra i supermercati selezionati, raggruppa gli acquisti per negozio e segnala i prodotti ancora da completare.

## Versione 2.1.0 — Volantini locali

Questa versione distingue tra offerte generali della catena e offerte estratte dal PDF ufficiale del punto vendita.

1. In **I miei supermercati**, premi **Trova volantino**.
2. Sul sito ufficiale della catena seleziona il punto vendita corretto.
3. Copia il collegamento diretto al PDF e premi **Collega PDF** nell'app.
4. Salva/aggiorna `google/Code.gs` e crea una nuova versione della distribuzione Apps Script.
5. In GitHub aggiungi il secret `OPENAI_API_KEY`.
6. Avvia il workflow **Cerca offerte automatiche**.

Le offerte estratte dal PDF vengono marcate `localValidityVerified: true`. Le offerte PENNY/Eurospin recuperate dalle fonti generali restano disponibili come fallback, ma sono indicate come non verificate per il singolo negozio.

Catene con collegamento ufficiale già predisposto: PENNY, Eurospin, Lidl, MD, Conad, Despar/Eurospar/Interspar, Famila, Coop/Ipercoop, Carrefour, ALDI, Todis e DOK.


## Versione 3.0.0 — Motore punti vendita

- Usa `config/app.json` come codice famiglia di riserva.
- Interrompe il workflow se Apps Script restituisce zero negozi o zero offerte.
- Associa PENNY al negozio ufficiale più vicino tramite coordinate.
- PENNY non richiede OpenAI, OCR o PDF.
- Il secret opzionale `PENNY_FLYER_ID` permette di forzare un volantino.


## Versione 3.0.1 — Correzione avvio senza OpenAI
Il connettore PDF viene caricato solo quando esiste un volantino PDF collegato e la chiave OPENAI_API_KEY è configurata. PENNY locale può quindi funzionare senza dipendenza OpenAI.

## Versione 4.0.0

- PENNY locale tramite API strutturata.
- Eurospin locale tramite Digital Flyer API.
- Il punto vendita Eurospin di Sava viene associato al codice ufficiale `603860`.
- È possibile impostare un altro negozio con `officialStoreId` nei dati del supermercato oppure con il secret GitHub `EUROSPIN_STORE_CODE`.
- Nessun OCR/OpenAI è necessario per PENNY ed Eurospin quando le API prodotto sono disponibili.
