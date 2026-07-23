import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { cleanText, numberValue, uniqueOffers } from './common.mjs';
import { resolveLidlFlyer } from './lidl-local.mjs';

const HOME_URL = 'https://www.lidl.it/';
const LANDING_URL = 'https://www.lidl.it/c/volantino-lidl/s10018048';
const WIDGET_URL = 'https://endpoints.leaflets.schwarz/v4/widget?widget_id=b72c9549-b8f0-11ed-b03c-fa163e81deca&store_id=0&region_id=0';

function parseItalianPrice(value = '') {
  const text = cleanText(value);
  const euro = text.match(/(?:^|\s)(\d{1,3}(?:[.,]\d{2}))\s*€\*?/);
  if (euro) return numberValue(euro[1]);

  const split = text.match(/(?:^|\s)(\d{1,3})\s*[,.]\s*(\d{2})(?:\s*€|\s|$)/);
  return split ? Number(`${split[1]}.${split[2]}`) : null;
}

function parseDates(text = '') {
  const normalized = cleanText(text);
  const range = normalized.match(
    /(?:dal|da)\s+(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\s+(?:al|a)\s+(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/i
  );

  if (!range) return { validFrom: '', validTo: '' };

  const currentYear = new Date().getFullYear();
  const year1 = Number(range[3] || currentYear);
  const year2 = Number(range[6] || year1);
  const yyyy1 = year1 < 100 ? 2000 + year1 : year1;
  const yyyy2 = year2 < 100 ? 2000 + year2 : year2;

  const iso = (y, m, d) =>
    `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  return {
    validFrom: iso(yyyy1, range[2], range[1]),
    validTo: iso(yyyy2, range[5], range[4])
  };
}

function cleanTitle(value = '') {
  return cleanText(value)
    .replace(/^(in punto vendita|online)\s*/i, '')
    .replace(/\s+\^\{\}\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function titleIsUsable(value = '') {
  const title = cleanTitle(value);
  if (!title || title.length < 3 || title.length > 160) return false;
  if (/^(scopri|mostra|offerte|questa settimana|prossima settimana|in punto vendita)$/i.test(title)) return false;
  if (/^\d/.test(title) && title.length < 12) return false;
  return /[a-zàèéìòù]/i.test(title);
}

function normalizeOffer(raw, context, store, index) {
  const title = cleanTitle(raw.title || raw.imageAlt || '');
  const price = numberValue(raw.price);
  if (!titleIsUsable(title) || !Number.isFinite(price) || price <= 0) return null;

  const dates = parseDates(raw.text || '');
  const appStoreId = String(store.id || '');
  const officialStoreId = String(
    store.officialStoreId ||
    store.storeCode ||
    context.officialStoreId ||
    'IT00812'
  );

  return {
    id: `lidl-${context.flyerId || 'weekly'}-${index}-${title.toLowerCase().replace(/[^a-z0-9]+/gi, '-').slice(0, 48)}`,
    store: 'Lidl',
    chain: 'LIDL',
    product: title,
    brand: cleanText(raw.brand || ''),
    format: cleanText(raw.format || ''),
    category: cleanText(raw.category || ''),
    price,
    oldPrice: Number.isFinite(numberValue(raw.oldPrice)) && numberValue(raw.oldPrice) > price
      ? numberValue(raw.oldPrice)
      : null,
    unitPrice: numberValue(raw.unitPrice),
    discount: cleanText(raw.discount || ''),
    description: cleanText(raw.description || ''),
    image: String(raw.image || ''),
    validFrom: dates.validFrom || context.validFrom || '',
    validTo: dates.validTo || context.validUntil || '',
    sourceUrl: String(raw.sourceUrl || context.offersUrl || context.flyerUrl || LANDING_URL),
    source: 'Lidl Italia - pagina offerte ufficiale',
    localValidityVerified: false,
    offerScope: 'national-chain',
    flyerId: String(context.flyerId || ''),
    promotionId: '',
    flyerStoreId: appStoreId,
    officialStoreId,
    officialStoreAlias: 'sava',
    nearestStore: {
      id: appStoreId,
      name: store.name || store.brand || 'Lidl',
      brand: store.brand || 'Lidl',
      address: store.address || '',
      lat: Number.isFinite(Number(store.lat)) ? Number(store.lat) : null,
      lon: Number.isFinite(Number(store.lon)) ? Number(store.lon) : null,
      distance: Number.isFinite(Number(store.distance)) ? Number(store.distance) : null
    },
    locations: [{
      id: appStoreId,
      name: store.name || store.brand || 'Lidl',
      brand: store.brand || 'Lidl',
      address: store.address || '',
      lat: Number.isFinite(Number(store.lat)) ? Number(store.lat) : null,
      lon: Number.isFinite(Number(store.lon)) ? Number(store.lon) : null,
      distance: Number.isFinite(Number(store.distance)) ? Number(store.distance) : null,
      officialStoreId
    }],
    fetchedAt: new Date().toISOString()
  };
}

async function dismissConsent(page) {
  const labels = [
    /accetta tutto/i,
    /accetta tutti/i,
    /consenti tutto/i,
    /continua senza accettare/i
  ];

  for (const label of labels) {
    const button = page.getByRole('button', { name: label }).first();
    if (await button.count()) {
      try {
        await button.click({ timeout: 2500 });
        await page.waitForTimeout(600);
        return;
      } catch {
        // Il banner può non essere visibile in GitHub Actions.
      }
    }
  }
}

async function resolveViewerUrl(page) {
  try {
    const response = await page.request.get(WIDGET_URL, {
      timeout: 30000,
      headers: {
        accept: 'application/json',
        'accept-language': 'it-IT,it;q=0.9,en;q=0.7'
      }
    });

    if (!response.ok()) return '';
    const payload = await response.json();
    const flyers = payload?.widget?.flyers || [];
    const weekly = flyers.find(item =>
      /offerte\s+valide|settimana|gusti|estate|convenienza/i.test(`${item?.name || ''} ${item?.title || ''}`)
    ) || flyers[0];

    return String(weekly?.url || '');
  } catch {
    return '';
  }
}

async function interactWithViewer(page) {
  // Consente al visualizzatore di completare il caricamento iniziale.
  await page.waitForTimeout(2500);

  // Prova i comandi più comuni del viewer: elenco prodotti, zoom e pagine successive.
  const clickPatterns = [
    /accetta tutto|accetta tutti|consenti tutto/i,
    /prodotti|articoli|offerte/i,
    /pagina successiva|avanti|successiva|next/i
  ];

  for (const pattern of clickPatterns) {
    const controls = page.getByRole('button', { name: pattern });
    const count = Math.min(await controls.count(), 6);
    for (let i = 0; i < count; i += 1) {
      try {
        const control = controls.nth(i);
        if (await control.isVisible()) {
          await control.click({ timeout: 1800 });
          await page.waitForTimeout(650);
        }
      } catch {
        // I controlli cambiano durante la navigazione del volantino.
      }
    }
  }

  // Sfoglia con tastiera e scroll per attivare il lazy loading delle pagine.
  for (let i = 0; i < 18; i += 1) {
    await page.keyboard.press('ArrowRight').catch(() => {});
    await page.mouse.wheel(0, 850);
    await page.waitForTimeout(350);
  }

  await page.keyboard.press('Home').catch(() => {});
  await page.waitForTimeout(800);
}

async function extractViewerCards(page) {
  return page.evaluate(() => {
    const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const price = value => {
      const matches = [...clean(value).matchAll(/(\d{1,3}[.,]\d{2})\s*€/g)];
      return matches.length ? Number(matches[matches.length - 1][1].replace(',', '.')) : null;
    };

    const selectors = [
      '[data-product]', '[data-article]', '[data-offer]',
      '[class*="product"]', '[class*="article"]', '[class*="offer"]',
      '[aria-label*="€"]', '[title*="€"]'
    ];
    const nodes = [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]))];
    const output = [];

    for (const node of nodes) {
      const text = clean(node.textContent || node.getAttribute('aria-label') || node.getAttribute('title'));
      const value = price(text);
      if (!value || text.length < 4 || text.length > 1200) continue;

      const heading = node.querySelector('h1,h2,h3,h4,h5,[class*="title"],[class*="name"]');
      const image = node.querySelector('img');
      const title = clean(heading?.textContent || image?.alt || text.replace(/\d{1,3}[.,]\d{2}\s*€.*/, ''));
      if (!title || title.length < 3) continue;

      output.push({
        title,
        imageAlt: clean(image?.alt),
        text,
        price: value,
        oldPrice: null,
        unitPrice: null,
        format: clean(text.match(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|cl)\b/i)?.[0]),
        discount: clean(text.match(/-\s*\d{1,2}\s*%/)?.[0]),
        image: image?.currentSrc || image?.src || '',
        sourceUrl: location.href
      });
    }

    return output;
  });
}

async function findOffersUrl(page) {
  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismissConsent(page);

  const links = await page.locator('a[href]').evaluateAll(nodes =>
    nodes.map(node => ({
      href: node.href || '',
      text: (node.textContent || '').replace(/\s+/g, ' ').trim()
    }))
  );

  const candidates = links
    .filter(item =>
      /\/c\/(?:offerte-della-settimana|lidl-plus|frutta|carne|super-offerte)[^?#/]*/i.test(item.href) ||
      /super offerte nel tuo punto vendita|offerte attuali/i.test(item.text)
    )
    .sort((a, b) => {
      const score = item => {
        let value = 0;
        if (/offerte-della-settimana/i.test(item.href)) value += 30;
        if (/offerte attuali|super offerte/i.test(item.text)) value += 10;
        if (/kw-/i.test(item.href)) value += 5;
        return value;
      };
      return score(b) - score(a);
    });

  if (candidates[0]?.href) return candidates[0].href;

  // Pagina ufficiale di riserva: contiene comunque i collegamenti alle offerte.
  await page.goto(LANDING_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismissConsent(page);

  const landingLinks = await page.locator('a[href]').evaluateAll(nodes =>
    nodes.map(node => ({
      href: node.href || '',
      text: (node.textContent || '').replace(/\s+/g, ' ').trim()
    }))
  );

  return landingLinks.find(item => /\/c\/offerte-della-settimana-/i.test(item.href))?.href || '';
}

async function expandOffers(page) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const buttons = page.getByRole('button', { name: /mostra di più|show more/i });
    if (!(await buttons.count())) break;

    let clicked = false;
    for (let i = 0; i < await buttons.count(); i += 1) {
      try {
        const button = buttons.nth(i);
        if (await button.isVisible()) {
          await button.click({ timeout: 2500 });
          await page.waitForTimeout(800);
          clicked = true;
        }
      } catch {
        // Un pulsante può sparire dopo il click del precedente.
      }
    }
    if (!clicked) break;
  }

  // Alcune sezioni caricano le card soltanto durante lo scorrimento.
  for (let y = 0; y < 6; y += 1) {
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(400);
  }
  await page.mouse.wheel(0, -10000);
}

async function extractCards(page) {
  return page.evaluate(() => {
    const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const priceFrom = text => {
      const matches = [...clean(text).matchAll(/(\d{1,3}[.,]\d{2})\s*€\*?/g)];
      if (!matches.length) return null;
      return Number(matches[matches.length - 1][1].replace(',', '.'));
    };

    const oldPriceFrom = element => {
      const old = element.querySelector(
        'del, s, strike, [class*="old-price"], [class*="oldPrice"], [class*="previous"], [class*="original"]'
      );
      const match = clean(old?.textContent).match(/(\d{1,3}[.,]\d{2})/);
      return match ? Number(match[1].replace(',', '.')) : null;
    };

    const titleFrom = element => {
      const preferred = element.querySelector(
        'h1, h2, h3, h4, h5, [class*="product"][class*="title"], [class*="product"][class*="name"], [class*="title"], [class*="name"]'
      );
      const heading = clean(preferred?.textContent);
      if (heading) return heading;

      const imageAlt = clean(element.querySelector('img[alt]')?.getAttribute('alt'));
      if (imageAlt && !/^image$/i.test(imageAlt)) return imageAlt;

      return '';
    };

    const formatFrom = text => {
      const patterns = [
        /\b\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|cl)\b/i,
        /\bal\s*kg\b/i,
        /\bal\s*litro\b/i,
        /\bconfezione\b/i
      ];
      return patterns.map(pattern => clean(text).match(pattern)?.[0] || '').find(Boolean) || '';
    };

    const unitPriceFrom = text => {
      const match = clean(text).match(/(\d{1,3}[.,]\d{2})\s*€\s*\/\s*(?:kg|l|lt|100\s*g)/i);
      return match ? Number(match[1].replace(',', '.')) : null;
    };

    const selectors = [
      'article',
      '[data-testid*="product"]',
      '[data-test*="product"]',
      '[class*="product-grid"] > *',
      '[class*="product-card"]',
      '[class*="productCard"]',
      '[class*="offer-card"]',
      '[class*="offerCard"]',
      '[class*="promotion-card"]',
      '[class*="promotionCard"]'
    ];

    const candidates = [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]))];
    const result = [];

    for (const element of candidates) {
      const text = clean(element.textContent);
      if (!text || text.length > 1800 || !text.includes('€')) continue;

      const title = titleFrom(element);
      const price = priceFrom(text);
      if (!title || !price) continue;

      const imageElement = element.querySelector('img');
      const image = imageElement?.currentSrc || imageElement?.src || '';
      const imageAlt = clean(imageElement?.getAttribute('alt'));
      const discount = clean(text.match(/-\s*\d{1,2}\s*%/)?.[0] || '');
      const link = element.closest('a[href]') || element.querySelector('a[href]');

      result.push({
        title,
        imageAlt,
        text,
        price,
        oldPrice: oldPriceFrom(element),
        unitPrice: unitPriceFrom(text),
        format: formatFrom(text),
        discount,
        image,
        sourceUrl: link?.href || location.href
      });
    }

    return result;
  });
}


const DEBUG_DIR = path.resolve('debug/lidl');

function safeFileName(value = '') {
  return cleanText(value)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 110) || 'response';
}

function shortHash(value = '') {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 10);
}

async function prepareDebugDirectory() {
  await fs.rm(DEBUG_DIR, { recursive: true, force: true });
  await fs.mkdir(path.join(DEBUG_DIR, 'responses'), { recursive: true });
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function isInterestingJson(url, body) {
  const haystack = `${url}\n${body}`.toLowerCase();
  return /(offer|offers|product|products|promotion|promotions|campaign|catalog|catalogue|leaflet|flyer|article|articles|tile|tiles|price|weekly|week|kw-|graphql)/.test(haystack);
}

function summarizeJson(value) {
  const summary = {
    type: Array.isArray(value) ? 'array' : typeof value,
    topLevelKeys: [],
    arrays: [],
    probableProducts: 0
  };

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    summary.topLevelKeys = Object.keys(value).slice(0, 60);
  }

  const seen = new Set();
  const stack = [{ value, path: '$' }];
  let inspected = 0;

  while (stack.length && inspected < 30000) {
    const current = stack.pop();
    const item = current.value;
    inspected += 1;

    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);

    if (Array.isArray(item)) {
      summary.arrays.push({ path: current.path, length: item.length });
      for (let i = 0; i < Math.min(item.length, 1500); i += 1) {
        stack.push({ value: item[i], path: `${current.path}[${i}]` });
      }
      continue;
    }

    const keys = Object.keys(item);
    const lower = keys.map(key => key.toLowerCase());
    const hasName = lower.some(key => ['name', 'title', 'productname', 'product_name', 'headline'].includes(key));
    const hasPrice = lower.some(key => key.includes('price') || key.includes('amount'));
    const hasImage = lower.some(key => key.includes('image') || key.includes('media'));

    if (hasName && (hasPrice || hasImage)) summary.probableProducts += 1;

    for (const key of keys.slice(0, 120)) {
      stack.push({ value: item[key], path: `${current.path}.${key}` });
    }
  }

  summary.arrays = summary.arrays
    .sort((a, b) => b.length - a.length)
    .slice(0, 40);

  return summary;
}

async function attachNetworkDebug(page, debugState) {
  page.on('console', message => {
    debugState.console.push({
      type: message.type(),
      text: message.text(),
      location: message.location()
    });
  });

  page.on('pageerror', error => {
    debugState.pageErrors.push({
      message: error.message,
      stack: error.stack || ''
    });
  });

  page.on('requestfailed', request => {
    debugState.failedRequests.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      failure: request.failure()
    });
  });

  page.on('response', async response => {
    const request = response.request();
    const headers = response.headers();
    const contentType = headers['content-type'] || '';
    const url = response.url();

    const entry = {
      url,
      method: request.method(),
      status: response.status(),
      resourceType: request.resourceType(),
      contentType,
      fromServiceWorker: response.fromServiceWorker(),
      timing: request.timing()
    };

    debugState.network.push(entry);

    const jsonLike =
      contentType.includes('application/json') ||
      contentType.includes('+json') ||
      request.resourceType() === 'xhr' ||
      request.resourceType() === 'fetch';

    if (!jsonLike) return;

    try {
      const body = await response.text();
      entry.bodyBytes = Buffer.byteLength(body, 'utf8');

      if (!body || body.length > 20_000_000) return;

      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        return;
      }

      const fileName = `${String(debugState.jsonResponses.length + 1).padStart(3, '0')}-${safeFileName(url)}-${shortHash(url)}.json`;
      const filePath = path.join(DEBUG_DIR, 'responses', fileName);
      await writeJson(filePath, parsed);

      const summary = summarizeJson(parsed);
      const responseInfo = {
        url,
        status: response.status(),
        method: request.method(),
        resourceType: request.resourceType(),
        contentType,
        bodyBytes: entry.bodyBytes,
        file: `responses/${fileName}`,
        interesting: isInterestingJson(url, body),
        summary
      };

      debugState.jsonResponses.push(responseInfo);
    } catch (error) {
      entry.captureError = error.message;
    }
  });
}

async function saveDebugArtifacts(page, debugState, details = {}) {
  try {
    await fs.mkdir(DEBUG_DIR, { recursive: true });
    await fs.writeFile(path.join(DEBUG_DIR, 'page.html'), await page.content(), 'utf8');
    await page.screenshot({
      path: path.join(DEBUG_DIR, 'final-page.png'),
      fullPage: true
    });
  } catch (error) {
    debugState.artifactErrors.push(error.message);
  }

  const counts = {};
  for (const item of debugState.network) {
    counts[item.resourceType] = (counts[item.resourceType] || 0) + 1;
  }

  const interestingResponses = debugState.jsonResponses
    .filter(item => item.interesting || item.summary.probableProducts > 0)
    .sort((a, b) =>
      b.summary.probableProducts - a.summary.probableProducts ||
      b.bodyBytes - a.bodyBytes
    );

  const report = {
    generatedAt: new Date().toISOString(),
    details,
    totals: {
      networkRequests: debugState.network.length,
      jsonResponses: debugState.jsonResponses.length,
      interestingJsonResponses: interestingResponses.length,
      browserConsoleMessages: debugState.console.length,
      pageErrors: debugState.pageErrors.length,
      failedRequests: debugState.failedRequests.length
    },
    requestsByResourceType: counts,
    topJsonCandidates: interestingResponses.slice(0, 30)
  };

  await Promise.all([
    writeJson(path.join(DEBUG_DIR, 'network.json'), debugState.network),
    writeJson(path.join(DEBUG_DIR, 'json-index.json'), debugState.jsonResponses),
    writeJson(path.join(DEBUG_DIR, 'console.json'), debugState.console),
    writeJson(path.join(DEBUG_DIR, 'page-errors.json'), debugState.pageErrors),
    writeJson(path.join(DEBUG_DIR, 'failed-requests.json'), debugState.failedRequests),
    writeJson(path.join(DEBUG_DIR, 'report.json'), report)
  ]);

  const textReport = [
    'SPESA SMART — DEBUG LIDL',
    `Generato: ${report.generatedAt}`,
    '',
    `Pagina offerte: ${details.offersUrl || '-'}`,
    `Titolo pagina: ${details.pageTitle || '-'}`,
    `Card candidate: ${details.rawCards ?? '-'}`,
    `Offerte valide: ${details.validOffers ?? '-'}`,
    '',
    `Richieste HTTP: ${report.totals.networkRequests}`,
    `Risposte JSON salvate: ${report.totals.jsonResponses}`,
    `JSON interessanti: ${report.totals.interestingJsonResponses}`,
    `Errori pagina: ${report.totals.pageErrors}`,
    `Richieste fallite: ${report.totals.failedRequests}`,
    '',
    'MIGLIORI CANDIDATI JSON',
    ...interestingResponses.slice(0, 20).flatMap((item, index) => [
      `${index + 1}. ${item.url}`,
      `   file: ${item.file}`,
      `   byte: ${item.bodyBytes}`,
      `   prodotti probabili: ${item.summary.probableProducts}`,
      `   array principali: ${item.summary.arrays.slice(0, 5).map(array => `${array.path}=${array.length}`).join(', ') || '-'}`
    ])
  ].join('\n');

  await fs.writeFile(path.join(DEBUG_DIR, 'report.txt'), textReport, 'utf8');
}

export async function scanLidlOffers(store = {}) {
  const { chromium } = await import('playwright');
  const context = await resolveLidlFlyer(store);
  await prepareDebugDirectory();

  const debugState = {
    network: [],
    jsonResponses: [],
    console: [],
    pageErrors: [],
    failedRequests: [],
    artifactErrors: []
  };

  const browser = await chromium.launch({ headless: true });
  let page = null;
  let details = {};

  try {
    const browserContext = await browser.newContext({
      locale: 'it-IT',
      timezoneId: 'Europe/Rome',
      viewport: { width: 1440, height: 1100 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
      recordHar: {
        path: path.join(DEBUG_DIR, 'lidl-session.har'),
        mode: 'full',
        content: 'embed'
      }
    });

    page = await browserContext.newPage();
    await attachNetworkDebug(page, debugState);

    const offersUrl = await findOffersUrl(page);
    const viewerUrl = await resolveViewerUrl(page);
    if (!offersUrl && !viewerUrl) {
      throw new Error('Lidl: né pagina offerte né visualizzatore del volantino individuati');
    }

    // Prima apre la pagina offerte: mantiene le card già funzionanti.
    let pageCards = [];
    if (offersUrl) {
      await page.goto(offersUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await dismissConsent(page);
      for (let cycle = 0; cycle < 2; cycle += 1) {
        await expandOffers(page);
        await page.waitForTimeout(900);
      }
      pageCards = await extractCards(page);
    }

    // Poi apre il volantino digitale e intercetta le API del visualizzatore.
    let viewerCards = [];
    if (viewerUrl) {
      await page.goto(viewerUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await dismissConsent(page);
      await interactWithViewer(page);
      viewerCards = await extractViewerCards(page);
    }

    const rawCards = [...pageCards, ...viewerCards];
    const offers = uniqueOffers(
      rawCards
        .map((raw, index) =>
          normalizeOffer(raw, { ...context, offersUrl }, store, index)
        )
        .filter(Boolean)
    );

    details = {
      offersUrl,
      viewerUrl,
      pageTitle: await page.title(),
      pageCards: pageCards.length,
      viewerCards: viewerCards.length,
      rawCards: rawCards.length,
      validOffers: offers.length,
      flyerUrl: context.flyerUrl || '',
      flyerId: context.flyerId || '',
      storeId: String(store.id || ''),
      storeName: store.name || store.brand || 'Lidl'
    };

    await saveDebugArtifacts(page, debugState, details);
    await browserContext.close();

    console.log(`Lidl: pagina offerte ${offersUrl || '-'}; viewer ${viewerUrl || '-'}; ${pageCards.length} card pagina; ${viewerCards.length} card viewer; ${offers.length} offerte valide`);
    console.log(`Lidl debug: ${debugState.network.length} richieste; ${debugState.jsonResponses.length} JSON salvati in debug/lidl`);

    if (!offers.length) {
      throw new Error(
        'Lidl: nessuna offerta estratta. Consultare l’artefatto lidl-debug.'
      );
    }

    return offers;
  } catch (error) {
    details.error = error.message;
    if (page) {
      await saveDebugArtifacts(page, debugState, details);
    } else {
      await writeJson(path.join(DEBUG_DIR, 'fatal-error.json'), {
        generatedAt: new Date().toISOString(),
        error: error.message,
        stack: error.stack || ''
      });
    }
    throw error;
  } finally {
    await browser.close();
  }
}

export const __test = {
  parseItalianPrice,
  parseDates,
  cleanTitle,
  titleIsUsable,
  normalizeOffer
};
