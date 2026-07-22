Spesa Smart
Web app pronta per GitHub Pages.
Già funzionante
aggiunta, modifica, duplicazione ed eliminazione prodotti;
categorie, preferiti e prezzo massimo;
ricerca e filtro;
salvataggio automatico nel browser;
esportazione backup JSON;
lettura offerte da `data/offerte.json`;
installazione PWA e uso offline;
collegamento facoltativo a Google Fogli.
Pubblicazione
Estrai lo ZIP.
Carica tutti i file e le cartelle nella radice del repository SpesaSmart, sostituendo i file già presenti.
Vai in Settings → Pages.
Scegli Deploy from a branch, branch `main`, cartella `/ (root)`.
Salva e attendi alcuni minuti.
Google Fogli
Crea un Foglio Google.
Vai in Estensioni → Apps Script.
Incolla `google/Code.gs`.
Distribuisci come Applicazione web, eseguita da te e accessibile a chiunque abbia il link.
Copia l'URL e inseriscilo nelle impostazioni dell'app.
L'app funziona subito anche senza Google Fogli: i dati restano nel browser.
Offerte
La prima versione contiene due offerte dimostrative. Puoi modificare `data/offerte.json`. La ricerca automatica reale richiede connettori specifici o fonti autorizzate.
Versione 2.0.0 Alpha
Aggiunto il modulo I miei supermercati:
ricerca dei negozi vicini tramite GPS e OpenStreetMap/Overpass;
scelta della distanza massima;
selezione e salvataggio locale;
sincronizzazione della selezione tramite Apps Script e foglio `Supermercati`;
filtro delle offerte in base alle catene selezionate;
collegamento diretto a Google Maps.
Dopo aver sostituito `google/Code.gs`, creare una nuova distribuzione della Web App Apps Script.
