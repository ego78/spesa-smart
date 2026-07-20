import * as cheerio from "cheerio";
import { cleanText, parsePrice, uniqueOffers, fetchHtml } from "./common.mjs";

const URL = "https://www.eurospin.it/promozioni/";

function getDates(text) {
  const matches = text.match(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/g) || [];
  return matches;
}

export async function scanEurospin() {
  const html = await fetchHtml(URL);
  const $ = cheerio.load(html);
  const offers = [];

  const selectors = [
    "article",
    ".product",
    ".promotion",
    ".promozione",
    ".card",
    "[class*='product']",
    "[class*='promo']"
  ].join(",");

  $(selectors).each((_, element) => {
    const node = $(element);
    const text = cleanText(node.text());
    if (!text || text.length > 1200 || !/€/.test(text)) return;

    const title = cleanText(
      node.find("h1,h2,h3,h4,h5,.title,[class*='title'],[class*='name']").first().text()
    );

    const brand = cleanText(
      node.find(".brand,[class*='brand'],[class*='marchio']").first().text()
    );

    const format = cleanText(
      node.find(".format,[class*='format'],[class*='weight'],[class*='peso']").first().text()
    );

    const prices = [...text.matchAll(/(\d{1,4}[.,]\d{2})\s*€/g)]
      .map(match => parsePrice(match[1]))
      .filter(Boolean);

    if (!title || !prices.length) return;

    const dates = getDates(text);
    offers.push({
      product: title,
      brand,
      store: "Eurospin",
      format,
      price: prices.at(-1),
      oldPrice: prices.length > 1 ? prices[0] : null,
      validFrom: dates[0] || "",
      validUntil: dates[1] || "",
      sourceUrl: URL,
      source: "official"
    });
  });

  // Fallback for pages where each promotion is exposed mostly as text blocks.
  if (!offers.length) {
    $("h2,h3,h4").each((_, heading) => {
      const title = cleanText($(heading).text());
      const block = cleanText($(heading).parent().text());
      const prices = [...block.matchAll(/(\d{1,4}[.,]\d{2})\s*€/g)]
        .map(match => parsePrice(match[1]))
        .filter(Boolean);

      if (title && prices.length) {
        offers.push({
          product: title,
          store: "Eurospin",
          format: "",
          price: prices.at(-1),
          oldPrice: prices.length > 1 ? prices[0] : null,
          validFrom: "",
          validUntil: "",
          sourceUrl: URL,
          source: "official"
        });
      }
    });
  }

  return uniqueOffers(offers);
}
