Aimport * as cheerio from "cheerio";
import { cleanText, parsePrice, uniqueOffers, fetchHtml } from "./common.mjs";

const URL = "https://www.penny.it/categorie/tutte-le-offerte-99000000";

function italianDate(text, prefix) {
  const expression = new RegExp(`${prefix}\\s+(?:lun|mar|mer|gio|ven|sab|dom)?\\s*(\\d{1,2}\\.\\d{1,2}\\.\\d{4})`, "i");
  return text.match(expression)?.[1] || "";
}

export async function scanPenny() {
  const html = await fetchHtml(URL);
  const $ = cheerio.load(html);
  const offers = [];

  const selectors = [
    "article",
    ".product",
    ".product-tile",
    ".offer",
    ".card",
    "[class*='product']",
    "[class*='offer']"
  ].join(",");

  $(selectors).each((_, element) => {
    const node = $(element);
    const text = cleanText(node.text());
    if (!text || text.length > 1600 || !/€/.test(text)) return;

    const title = cleanText(
      node.find("h2,h3,h4,.title,[class*='title'],[class*='name']").first().text()
    );

    const brand = cleanText(
      node.find(".brand,[class*='brand']").first().text()
    );

    const format = cleanText(
      node.find(".size,.format,[class*='size'],[class*='format'],[class*='weight']").first().text()
    );

    const prices = [...text.matchAll(/(\d{1,4}[.,]\d{2})\s*€/g)]
      .map(match => parsePrice(match[1]))
      .filter(Boolean);

    if (!title || !prices.length) return;

    offers.push({
      product: title,
      brand,
      store: "PENNY",
      format,
      price: prices.at(-1),
      oldPrice: prices.length > 1 ? prices[0] : null,
      validFrom: italianDate(text, "da"),
      validUntil: italianDate(text, "a"),
      sourceUrl: URL,
      source: "official"
    });
  });

  return uniqueOffers(offers);
}
