# Spesa Smart v5.4.0 — Estrazione PDF Lidl

Questa versione scarica automaticamente il PDF ad alta risoluzione indicato dall’API ufficiale del volantino Lidl.

Il motore usa il testo incorporato nel PDF, senza OCR, per individuare nomi, prezzi, formati e pagine. I risultati vengono uniti alle offerte della pagina web e deduplicati.

## Diagnostica

Il workflow crea l’artefatto `lidl-pdf-debug-NUMERO`. Il file `pdf-extraction.json` contiene il testo estratto pagina per pagina e le offerte candidate.

La prima esecuzione è ancora sperimentale: il layout del PDF può associare alcuni prezzi al prodotto sbagliato. Dopo il test reale, il file diagnostico permette di perfezionare il parser.
