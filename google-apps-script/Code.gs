const SHEET_NAME = 'Prodotti';
const HEADERS = ['ID','Prodotto','Marca','Formato','Prezzo massimo','Categoria','Note','Zona','Attivo','Creato il','Aggiornato il'];

function doGet(e) {
  return jsonOutput(handleRequest_({
    action: (e && e.parameter && e.parameter.action) || 'listProducts',
    code: (e && e.parameter && e.parameter.code) || ''
  }));
}

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return jsonOutput(handleRequest_(data));
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err.message || err) });
  }
}

function handleRequest_(data) {
  verifyCode_(String(data.code || ''));
  ensureSheet_();
  switch (String(data.action || '')) {
    case 'listProducts': return { ok: true, products: listProducts_() };
    case 'addProduct': return { ok: true, product: addProduct_(data.product || {}) };
    case 'deleteProduct': deleteProduct_(String(data.id || '')); return { ok: true };
    case 'health': return { ok: true, message: 'Spesa Smart collegata' };
    default: throw new Error('Azione non riconosciuta');
  }
}

function verifyCode_(code) {
  const expected = PropertiesService.getScriptProperties().getProperty('FAMILY_CODE');
  if (!expected) throw new Error('Imposta FAMILY_CODE nelle proprietà dello script');
  if (code !== expected) throw new Error('Codice famiglia non valido');
}

function ensureSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function addProduct_(p) {
  const name = clean_(p.name, 100);
  if (!name) throw new Error('Il nome del prodotto è obbligatorio');
  const now = new Date();
  const id = Utilities.getUuid();
  ensureSheet_().appendRow([
    id, name, clean_(p.brand, 80), clean_(p.format, 50),
    number_(p.maxPrice), clean_(p.category, 50), clean_(p.notes, 200),
    clean_(p.location, 100), true, now, now
  ]);
  return { id: id, name: name };
}

function listProducts_() {
  const sh = ensureSheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).getValues()
    .filter(r => r[0] && r[8] !== false)
    .map(r => ({
      id: String(r[0]), name: String(r[1] || ''), brand: String(r[2] || ''),
      format: String(r[3] || ''), maxPrice: Number(r[4] || 0), category: String(r[5] || ''),
      notes: String(r[6] || ''), location: String(r[7] || ''), active: r[8] !== false
    }));
}

function deleteProduct_(id) {
  if (!id) throw new Error('ID mancante');
  const sh = ensureSheet_();
  const ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) { sh.deleteRow(i + 2); return; }
  }
  throw new Error('Prodotto non trovato');
}

function clean_(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
function number_(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; }
function jsonOutput(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
