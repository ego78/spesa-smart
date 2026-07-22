export function cleanText(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parsePrice(value = "") {
  const match = cleanText(value).match(/(\d{1,4}(?:[.,]\d{1,2})?)/);
  return match ? Number(match[1].replace(",", ".")) : null;
}


export function numberValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return parsePrice(value);
}

export function normalizeProduct(value = "") {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function uniqueOffers(offers) {
  const seen = new Set();
  return offers.filter(offer => {
    const key = [
      normalizeProduct(offer.product),
      normalizeProduct(offer.store),
      offer.price,
      normalizeProduct(offer.format)
    ].join("|");

    if (!offer.product || !offer.price || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; SpesaSmart/0.3; +GitHub Actions)",
      "accept-language": "it-IT,it;q=0.9,en;q=0.7"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }

  return response.text();
}
