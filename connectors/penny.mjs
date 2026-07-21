const PENNY_API =
  "https://www.penny.it/api/product-discovery/categories/" +
  "tutte-le-offerte-99000000/products";

const PENNY_PAGE =
  "https://www.penny.it/categorie/tutte-le-offerte-99000000";

const PAGE_SIZE = 20;

/**
 * PENNY restituisce i prezzi in centesimi.
 * Esempio:
 * 79 = 0,79 €
 * 299 = 2,99 €
 */
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

/**
 * Costruisce il formato del prodotto.
 *
 * Usa prima descriptionShort, perché spesso contiene:
 * - 250 g
 * - 3 x 80 g
 * - assortiti
 *
 * Se manca, usa amount e unità.
 */
function buildFormat(product) {
  const description =
    typeof product.descriptionShort === "string"
      ? product.descriptionShort.trim()
      : "";

  if (description) {
    return description;
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

/**
 * Estrae i prezzi dal prodotto PENNY.
 *
 * Gestisce:
 * - prezzo normale
 * - prezzo precedente
 * - prezzo PENNYCard
 * - prezzo al kg/litro/pezzo
 */
function getPriceData(product) {
  const price = product.price || {};

  const regularPrice = centsToEuro(
    price.regular?.value
  );

  const loyaltyPrice = centsToEuro(
    price.loyalty?.value
  );

  const crossedPrice = centsToEuro(
    price.crossed
  );

  const standardPrice = centsToEuro(
    price.standard?.value
  );

  const regularUnitPrice = centsToEuro(
    price.regular?.perStandardizedQuantity
  );

  const loyaltyUnitPrice = centsToEuro(
    price.loyalty?.perStandardizedQuantity
  );

  /*
   * Se esiste il prezzo PENNYCard,
   * viene utilizzato come prezzo dell'offerta.
   */
  if (loyaltyPrice !== null) {
    return {
      currentPrice: loyaltyPrice,
      regularPrice,
      oldPrice:
        crossedPrice ??
        standardPrice ??
        regularPrice,
      unitPrice:
        loyaltyUnitPrice ??
        regularUnitPrice,
      requiresLoyaltyCard: true
    };
  }

  return {
    currentPrice: regularPrice,
    regularPrice,
    oldPrice:
      crossedPrice ??
      standardPrice,
    unitPrice: regularUnitPrice,
    requiresLoyaltyCard: false
  };
}

/**
 * Converte un prodotto restituito dall'API
 * nel formato usato da Spesa Smart.
 */
function mapProduct(product) {
  const name =
    typeof product.name === "string"
      ? product.name.trim()
      : "";

  if (!name) {
    return null;
  }

  const {
    currentPrice,
    regularPrice,
    oldPrice,
    unitPrice,
    requiresLoyaltyCard
  } = getPriceData(product);

  if (currentPrice === null) {
    console.log(
      `PENNY scartato senza prezzo: ${name}`
    );

    return null;
  }

  const brand =
    typeof product.brand?.name === "string"
      ? product.brand.name.trim()
      : "";

  return {
    product: name,
    brand,
    store: "PENNY",

    format: buildFormat(product),

    price: currentPrice,
    regularPrice,
    oldPrice,
    unitPrice,

    unit:
      product.price?.baseUnitShort ||
      product.volumeLabelShort ||
      "",

    validFrom:
      product.price?.validityStart || "",

    validUntil:
      product.price?.validityEnd || "",

    image:
      Array.isArray(product.images)
        ? product.images[0] || ""
        : "",

    category:
      product.category || "",

    sku:
      product.sku || "",

    productId:
      product.productId || "",

    slug:
      product.slug || "",

    requiresLoyaltyCard,

    sourceUrl: PENNY_PAGE,
    source: "official-api"
  };
}

/**
 * Scarica una singola pagina dall'API PENNY.
 *
 * Invia sia:
 * - offset: 0, 20, 40...
 * - page:   1, 2, 3...
 *
 * Questo rende la paginazione più robusta.
 */
async function fetchPennyPage(offset, pageNumber) {
  const url = new URL(PENNY_API);

  url.searchParams.set(
    "offset",
    String(offset)
  );

  url.searchParams.set(
    "page",
    String(pageNumber)
  );

  url.searchParams.set(
    "limit",
    String(PAGE_SIZE)
  );

  /*
   * Ordinamento stabile.
   * Evita che i prodotti cambino posizione
   * durante le richieste successive.
   */
  url.searchParams.set(
    "sortBy",
    "price"
  );

  url.searchParams.set(
    "sortOrder",
    "asc"
  );

  console.log(
    `PENNY richiesta pagina ${pageNumber}: ${url.toString()}`
  );

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (compatible; SpesaSmart/1.0)"
    }
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Errore API PENNY: HTTP ${response.status} - ` +
      text.slice(0, 300)
    );
  }

  const data = await response.json();

  const products = Array.isArray(data.results)
    ? data.results
    : [];

  console.log(
    `PENNY risposta: ` +
    `pagina richiesta=${pageNumber}, ` +
    `offset richiesto=${offset}, ` +
    `offset risposta=${data.offset ?? "n/d"}, ` +
    `ricevuti=${products.length}, ` +
    `count=${data.count ?? "n/d"}, ` +
    `totale=${data.total ?? "n/d"}`
  );

  if (products.length > 0) {
    const firstProduct =
      products[0]?.name || "n/d";

    const lastProduct =
      products[products.length - 1]?.name || "n/d";

    console.log(
      `PENNY pagina ${pageNumber}: ` +
      `${firstProduct} → ${lastProduct}`
    );
  }

  return data;
}

/**
 * Scarica tutte le offerte PENNY.
 */
export async function scanPenny() {
  const offers = [];

  /*
   * Serve per evitare cicli infiniti
   * se l'API restituisce più volte
   * la stessa pagina.
   */
  const seenPages = new Set();

  let offset = 0;
  let pageNumber = 1;
  let total = null;

  while (total === null || offset < total) {
    console.log(
      `PENNY: scarico pagina ${pageNumber}, offset ${offset}`
    );

    const data = await fetchPennyPage(
      offset,
      pageNumber
    );

    const products = Array.isArray(data.results)
      ? data.results
      : [];

    const apiTotal = Number(data.total);

    if (Number.isFinite(apiTotal)) {
      total = apiTotal;
    }

    if (products.length === 0) {
      console.warn(
        `PENNY: pagina vuota all'offset ${offset}`
      );

      break;
    }

    /*
     * Firma della pagina.
     * Serve per capire se l'API ha restituito
     * nuovamente gli stessi prodotti.
     */
    const pageSignature = products
      .map(product =>
        product.sku ||
        product.productId ||
        product.slug ||
        product.name ||
        ""
      )
      .join("|");

    if (seenPages.has(pageSignature)) {
      console.warn(
        `PENNY: pagina duplicata all'offset ${offset}. ` +
        "Scansione interrotta per evitare un ciclo infinito."
      );

      break;
    }

    seenPages.add(pageSignature);

    /*
     * Controllo specifico per verificare
     * se il tonno è presente nella pagina.
     */
    const tunaProducts = products.filter(product =>
      [
        product.name,
        product.brand?.name,
        product.descriptionShort,
        product.descriptionLong,
        product.productMarketing,
        product.regulatedProductName
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes("tonno")
    );

    if (tunaProducts.length > 0) {
      console.log(
        `========== PENNY: TONNO TROVATO NELLA PAGINA ${pageNumber} ==========`
      );

      console.log(
        JSON.stringify(
          tunaProducts.map(product => ({
            name: product.name || "",
            brand: product.brand?.name || "",
            description:
              product.descriptionShort || "",
            sku: product.sku || "",
            price:
              product.price?.loyalty?.value ??
              product.price?.regular?.value ??
              null
          })),
          null,
          2
        )
      );
    }

    for (const product of products) {
      const productName =
        typeof product.name === "string"
          ? product.name
          : "";

      console.log(
        `PENNY prodotto API: ${productName}`
      );

      const offer = mapProduct(product);

      if (offer) {
        offers.push(offer);
      }
    }

    /*
     * Avanziamo in base al numero reale
     * di prodotti ricevuti.
     *
     * Prima pagina: offset 0
     * Seconda pagina: offset 20
     * Terza pagina: offset 40
     */
    offset += products.length;
    pageNumber += 1;
  }

  /*
   * Elimina eventuali prodotti duplicati.
   */
  const uniqueOffers = new Map();

  for (const offer of offers) {
    const key =
      offer.sku ||
      offer.productId ||
      offer.slug ||
      [
        offer.product,
        offer.brand,
        offer.format,
        offer.price
      ].join("|");

    uniqueOffers.set(key, offer);
  }

  const finalOffers =
    [...uniqueOffers.values()];

  /*
   * Controllo finale sul tonno,
   * dopo la conversione dei prodotti.
   */
  const tunaOffers = finalOffers.filter(offer =>
    [
      offer.product,
      offer.brand,
      offer.format
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes("tonno")
  );

  console.log(
    `PENNY: ${finalOffers.length} offerte totali lette`
  );

  console.log(
    `PENNY: ${tunaOffers.length} offerte di tonno trovate`
  );

  if (tunaOffers.length > 0) {
    console.log(
      "PENNY TONNO DOPO LA CONVERSIONE:"
    );

    console.log(
      JSON.stringify(
        tunaOffers,
        null,
        2
      )
    );
  }

  return finalOffers;
}