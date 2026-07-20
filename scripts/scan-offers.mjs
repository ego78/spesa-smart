import fs from "node:fs/promises";
import { search } from "fast-fuzzy";
import { scanEurospin } from "../connectors/eurospin.mjs";
import { scanPenny } from "../connectors/penny.mjs";
import { normalizeProduct, uniqueOffers } from "../connectors/common.mjs";

const OUTPUT = new URL("../data/offerte.json", import.meta.url);
const appsScriptUrl = process.env.APPS_SCRIPT_URL || "";
const familyCode = process.env.FAMILY_CODE || "default";
const minimumScore = Number(process.env.MINIMUM_MATCH_SCORE || "0.62");

async function loadProducts() {
  if (!appsScriptUrl) {
    console.warn("APPS_SCRIPT_URL non configurato: nessun prodotto remoto da filtrare.");
    return [];
  }

  const url = new URL(appsScriptUrl);
  url.searchParams.set("action", "listProducts");
  url.searchParams.set("familyCode", familyCode);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Google Apps Script: HTTP ${response.status}`);

  const data = await response.json();
  return Array.isArray(data) ? data : (data.products || []);
}

function matchesWantedProduct(offer, products) {
  if (!products.length) return true;

  const offerText = normalizeProduct(
    [offer.product, offer.brand, offer.format].filter(Boolean).join(" ")
  );

  return products.some(product => {
    const wanted = normalizeProduct(
      [product.name, product.brand, product.format].filter(Boolean).join(" ")
    );

    if (!wanted) return false;
    if (offerText.includes(wanted) || wanted.includes(offerText)) return true;

    const result = search(wanted, [offerText], {
      returnMatchData: true,
      threshold: minimumScore
    });

    return result.length > 0;
  });
}

async function safeScan(name, scanner) {
  try {
    const offers = await scanner();
    console.log(`${name}: ${offers.length} offerte lette`);
    return offers;
  } catch (error) {
    console.error(`${name}:`, error.message);
    return [];
  }
}

const products = await loadProducts();
console.log(`Prodotti monitorati: ${products.length}`);

const results = await Promise.all([
  safeScan("Eurospin", scanEurospin),
  safeScan("PENNY", scanPenny)
]);

const allOffers = uniqueOffers(results.flat());

const matchedOffers = [...allOffers]
  .sort((a, b) =>
    a.store.localeCompare(b.store, "it") ||
    a.product.localeCompare(b.product, "it")
  );

await fs.writeFile(
  OUTPUT,
  JSON.stringify(matchedOffers, null, 2) + "\n",
  "utf8"
);

console.log(`Offerte totali: ${allOffers.length}`);
console.log(`Offerte corrispondenti: ${matchedOffers.length}`);
