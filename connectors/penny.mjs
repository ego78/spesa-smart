const PENNY_API =
  "https://www.penny.it/api/product-discovery/categories/" +
  "tutte-le-offerte-99000000/products";

const PENNY_PAGE =
  "https://www.penny.it/categorie/tutte-le-offerte-99000000";

const PAGE_SIZE = 20;

function centsToEuro(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return number / 100;
}

function buildFormat(product) {
  if (product.descriptionShort) {
    return product.descriptionShort.trim();
  }

  const amount = Number(product.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return "";
  }

  const unit =
    product.volumeLabelShort ||
    product.price?.baseUnitShort ||
    "";

  return `${String(product.amount).replace(".", ",")} ${unit}`.trim();
}

function getPriceData(product) {
  const price = product.price || {};

  /*
   * Prezzo normale/promozionale visibile a tutti.
   * Nel JSON PENNY è price.regular.value.
   */
  let currentPrice = centsToEuro(price.regular?.value);

  /*
   * Alcuni prodotti hanno un prezzo riservato PENNYCard.
   * Lo teniamo separato per non confonderlo con il prezzo normale.
   */
  const loyaltyPrice = centsToEuro(price.loyalty?.value);

  /*
   * Prezzo precedente barrato.
   * Può essere presente in crossed oppure standard.value.
   */
  const oldPrice = centsToEuro(
    price.crossed ?? price.standard?.value
  );

  /*
   * Prezzo al kg, litro o pezzo.
   */
  let unitPrice = centsToEuro(
    price.regular?.perStandardizedQuantity
  );

  /*
   * Se esiste soltanto il prezzo PENNYCard, lo usiamo come prezzo
   * principale e prendiamo anche il relativo prezzo unitario.
   */
  let requiresLoyaltyCard = false;

  if (loyaltyPrice !== null) {
    currentPrice = loyaltyPrice;
    requiresLoyaltyCard = true;

    unitPrice = centsToEuro(
      price.loyalty?.perStandardizedQuantity
    );
  }

  return {
    currentPrice,
    oldPrice,
    unitPrice,
    requiresLoyaltyCard
  };
}

function mapProduct(product) {
  const {
    currentPrice,
    oldPrice,
    unitPrice,
    requiresLoyaltyCard
  } = getPriceData(product);

  if (currentPrice === null) {
    return null;
  }

  const brand = product.brand?.name?.trim() || "";
  const name = product.name?.trim() || "";

  if (!name) {
    return null;
  }

  return {
    product: name,
    brand,
    store: "PENNY",

    format: buildFormat(product),

    price: currentPrice,
    oldPrice,
    unitPrice,

    unit:
      product.price?.baseUnitShort ||
      product.volumeLabelShort ||
      "",

    validFrom: product.price?.validityStart || "",
    validUntil: product.price?.validityEnd || "",

    image: product.images?.[0] || "",

    category: product.category || "",
    sku: product.sku || "",
    productId: product.productId || "",

    requiresLoyaltyCard,

    sourceUrl: PENNY_PAGE,
    source: "official-api"
  };
}

async function fetchPennyPage(offset = 0) {
  const url = new URL(PENNY_API);

  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(PAGE_SIZE));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (compatible; SpesaSmart/1.0)"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Errore API PENNY: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

export async function scanPenny() {
  const offers = [];

  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const data = await fetchPennyPage(offset);

    const products = Array.isArray(data.results)
      ? data.results
      : [];

    total = Number(data.total) || products.length;

    for (const product of products) {
      const offer = mapProduct(product);

      if (offer) {
        offers.push(offer);
      }
    }

    if (products.length === 0) {
      break;
    }

    offset += products.length;
  }

  /*
   * Elimina eventuali duplicati usando SKU o productId.
   */
  const unique = new Map();

  for (const offer of offers) {
    const key =
      offer.sku ||
      offer.productId ||
      `${offer.product}-${offer.brand}-${offer.price}`;

    unique.set(key, offer);
  }

  console.log(
    `PENNY: ${unique.size} offerte lette dall'API ufficiale`
  );

  return [...unique.values()];
}
