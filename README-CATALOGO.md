# Catalogo prodotti unificato — v5.0.1

Questa versione parte dalla base stabile v4.3.0 e aggiunge il catalogo unificato senza introdurre il motore universale incompleto.

Durante ogni scansione:

- le offerte ricevono `canonicalName`, `canonicalKey`, `canonicalTokens` e `normalizedQuantity`;
- nomi equivalenti come `Coca-Cola PET 1,5 L` e `Coca Cola PET 1500 ml` vengono ricondotti alla stessa chiave;
- viene generato `data/catalogo.json` con alias, supermercati, quantità e fascia prezzi;
- l'app usa anche i campi canonici per riconoscere meglio i prodotti monitorati.

Il catalogo non sostituisce il nome originale dell'offerta: lo conserva e aggiunge solamente dati normalizzati.
