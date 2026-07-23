# Lidl v6.1 — diagnostica volantino settimanale

Questa versione non modifica il parser PDF. Rafforza la fase di scoperta del volantino:

- attende l'idratazione completa della pagina;
- esegue lo scroll fino a quando l'altezza della pagina non cambia più;
- salva HTML e screenshot completi della pagina Volantini e Riviste;
- registra titoli, link, iframe, script, risorse e storage del browser;
- intercetta risposte HTML, JSON e JavaScript contenenti riferimenti a volantini, flyer, leaflet e date 23/07–29/07;
- continua a includere volantini settimanali e speciali, escludendo Lidl Viaggi.

File diagnostici principali nell'artefatto GitHub:

- `landing-full-page.png`
- `landing-page.html`
- `landing-diagnostics.json`
- `landing-keyword-responses.json`
- `cards.json`
- `flyers.json`
- `flyer-discovery.json`

Il file `flyer-discovery.json` indica anche se il testo finale della pagina contiene la dicitura del volantino settimanale.
