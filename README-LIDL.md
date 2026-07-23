# Lidl automatico — v5.1.0 sperimentale

Questa versione aggiunge l'estrazione automatica delle offerte dalla pagina
ufficiale Lidl Italia tramite Playwright.

## Come funziona

1. individua automaticamente la pagina corrente delle offerte settimanali;
2. apre la pagina con Chromium;
3. espande le sezioni "Mostra di più";
4. scorre la pagina per caricare le card;
5. estrae nome, prezzo, vecchio prezzo, formato, immagine e validità;
6. unisce le offerte Lidl a PENNY ed Eurospin in `data/offerte.json`.

## GitHub Actions

Il workflow installa automaticamente Chromium con:

```bash
npx playwright install --with-deps chromium
```

Non è necessario aggiungere nuovi secret.

## Stato del collegamento

Le offerte Lidl sono nazionali. Per questo:

- `offerScope`: `national-chain`
- `localValidityVerified`: `false`

Il punto vendita selezionato viene comunque associato alle offerte.

## Diagnostica

Nel log del workflow apparirà una riga simile a:

```text
Lidl: pagina https://www.lidl.it/c/...; 160 card candidate; 145 offerte valide
```

Se Lidl cambia il markup, il workflow mostrerà:

```text
Lidl: nessuna offerta estratta. Il sito potrebbe aver modificato il markup.
```

In quel caso PENNY ed Eurospin continuano a essere salvati, mentre Lidl resta
temporaneamente a zero grazie alla funzione `safe()` già presente.
