import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { cleanText, numberValue, uniqueOffers } from './common.mjs';
import { resolveLidlFlyer } from './lidl-local.mjs';

const HOME_URL = 'https://www.lidl.it/';
const LANDING_URL = 'https://www.lidl.it/c/volantino-lidl/s10018048';
const WIDGET_URL = 'https://endpoints.leaflets.schwarz/v4/widget?widget_id=b72c9549-b8f0-11ed-b03c-fa163e81deca&store_id=0&region_id=0';
const CACHE_DIR = path.resolve('.cache/lidl');
const PDF_CACHE_VERSION = 2;
const MAX_FLYER_CONCURRENCY = 2;
const DEBUG_ENABLED = /^(1|true|yes)$/i.test(process.env.LIDL_DEBUG || '');
const DEBUG_FULL = /^(1|true|yes)$/i.test(process.env.LIDL_DEBUG_FULL || '');

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function elapsedMs(start) {
  return Math.round(nowMs() - start);
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

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
  if (/^(scopri(?: di più)?|mostra(?: di più)?|offerte|questa settimana|prossima settimana|in punto vendita)$/i.test(title)) return false;
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

function flyerLabel(item = {}) {
  return cleanText([
    item.name,
    item.title,
    item.subtitle,
    item.description,
    item.category,
    item.group,
    item.url
  ].filter(Boolean).join(' '));
}

function isTravelFlyer(item = {}) {
  return /(?:lidl\s*)?viaggi|vacanze|tour|hotel|villaggi|crociere|voli|travel/i.test(flyerLabel(item));
}

function isIncludedFlyer(item = {}) {
  const url = String(item?.url || '');
  if (!url || isTravelFlyer(item)) return false;

  // Include sia il volantino settimanale sia tutti i volantini speciali.
  // Lidl può cambiare i nomi delle sezioni, quindi escludiamo esplicitamente
  // soltanto i volantini Viaggi invece di usare un filtro troppo restrittivo.
  return true;
}

function canonicalFlyerUrl(value = '') {
  try {
    const url = new URL(String(value || ''), LANDING_URL);
    const match = url.pathname.match(/\/l\/it\/volantini\/([^/]+)(?:\/ar\/\d+|\/view\/flyer\/page\/\d+)?/i);
    if (!match) return '';

    const identifier = decodeURIComponent(match[1]);
    if (!identifier) return '';

    // Tutti i formati del viewer vengono ricondotti all'URL stabile /ar/0.
    // In questo modo metadata, PDF e deduplicazione lavorano sullo stesso ID.
    return `https://www.lidl.it/l/it/volantini/${encodeURIComponent(identifier)}/ar/0`;
  } catch {
    return '';
  }
}

function collectFlyersFromPayload(payload, source = 'network') {
  const output = [];
  const visited = new WeakSet();

  const visit = (value, trail = '') => {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${trail}[${index}]`));
      return;
    }

    const rawUrl = value.url || value.href || value.viewerUrl || value.flyerUrl || value.link;
    const identifier = cleanText(value.flyer_identifier || value.flyerIdentifier || value.identifier || '');
    const synthesizedUrl = identifier
      ? `https://www.lidl.it/l/it/volantini/${encodeURIComponent(identifier)}/ar/0`
      : '';
    const url = canonicalFlyerUrl(rawUrl) || canonicalFlyerUrl(synthesizedUrl);
    if (url) {
      output.push({
        ...value,
        url,
        source,
        category: cleanText(value.category || value.group || value.section || ''),
        label: flyerLabel(value) || cleanText(trail) || 'Volantino Lidl'
      });
    }

    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === 'object') visit(child, trail ? `${trail}.${key}` : key);
    }
  };

  visit(payload);
  return output;
}

function dedupeFlyers(items = []) {
  const map = new Map();
  for (const item of items) {
    const url = canonicalFlyerUrl(item?.url);
    if (!url || !isIncludedFlyer({ ...item, url })) continue;
    const identifier = flyerIdentifierFromUrl(url);
    const key = identifier || url.replace(/\/$/, '');
    const previous = map.get(key) || {};
    const sources = [...new Set(
      [previous.source, item.source]
        .flatMap(value => String(value || '').split(','))
        .map(value => cleanText(value))
        .filter(Boolean)
    )];
    map.set(key, {
      ...previous,
      ...item,
      url,
      label: flyerLabel(item) || previous.label || 'Volantino Lidl',
      category: cleanText(item.category || previous.category || ''),
      source: sources.join(',')
    });
  }
  return [...map.values()];
}

async function analyzeLandingCardContainers(page) {
  return page.evaluate(() => {
    const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const absolute = value => {
      try { return new URL(value, location.href).href; } catch { return ''; }
    };
    const attrs = node => Object.fromEntries([...node.attributes].map(item => [item.name, item.value]));
    const cssPath = node => {
      if (!(node instanceof Element)) return '';
      const parts = [];
      let current = node;
      while (current && current !== document.documentElement && parts.length < 8) {
        let part = current.tagName.toLowerCase();
        if (current.id) {
          part += `#${CSS.escape(current.id)}`;
          parts.unshift(part);
          break;
        }
        const classes = [...current.classList].filter(Boolean).slice(0, 3);
        if (classes.length) part += `.${classes.map(item => CSS.escape(item)).join('.')}`;
        const siblings = current.parentElement ? [...current.parentElement.children].filter(item => item.tagName === current.tagName) : [];
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(' > ');
    };
    const rect = node => {
      const value = node.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    };
    const sectionFor = node => {
      let current = node;
      for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
        let sibling = current.previousElementSibling;
        while (sibling) {
          const heading = sibling.matches?.('h1,h2,h3,h4,h5,h6') ? sibling : sibling.querySelector?.('h1,h2,h3,h4,h5,h6');
          const text = clean(heading?.textContent || '');
          if (text) return text;
          sibling = sibling.previousElementSibling;
        }
      }
      return '';
    };
    const looksRelevant = node => {
      const text = clean(`${node.textContent || ''} ${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''}`);
      const html = node.outerHTML || '';
      return /volantin|offerte valide|novità in negozio|leaflet|flyer|catalog/i.test(`${text} ${html}`) && !/lidl\s*viaggi|vacanze|hotel|crociere|voli/i.test(text);
    };

    const seedSelectors = [
      'a[href*="/l/it/volantini/"]',
      '[data-testid*="flyer" i]', '[data-test*="flyer" i]', '[data-qa*="flyer" i]',
      '[class*="flyer" i]', '[class*="leaflet" i]', '[class*="catalog" i]',
      'article', 'li', '[role="listitem"]', '[role="button"]', 'button'
    ];
    const seeds = [...new Set(seedSelectors.flatMap(selector => [...document.querySelectorAll(selector)]))]
      .filter(looksRelevant);
    const containers = [];
    const seen = new Set();

    for (const seed of seeds) {
      let container = seed;
      for (let depth = 0; container && depth < 7; depth += 1, container = container.parentElement) {
        if (!(container instanceof Element)) break;
        const box = container.getBoundingClientRect();
        const text = clean(container.textContent);
        const links = [...container.querySelectorAll('a[href]')];
        const images = [...container.querySelectorAll('img')];
        const interactive = container.matches('a,button,[role="button"],[tabindex]') || Boolean(container.querySelector('a,button,[role="button"],[tabindex]'));
        if (box.width >= 140 && box.height >= 100 && box.width <= innerWidth * 1.05 && box.height <= 900 && text.length <= 1800 && (interactive || links.length || images.length)) {
          break;
        }
      }
      if (!(container instanceof Element)) container = seed;
      const selector = cssPath(container);
      if (!selector || seen.has(selector)) continue;
      seen.add(selector);
      const links = [...container.querySelectorAll('a[href]')].map(node => absolute(node.getAttribute('href'))).filter(Boolean);
      const image = container.querySelector('img');
      const clickTarget = container.matches('a,button,[role="button"],[tabindex]')
        ? container
        : container.querySelector('a,button,[role="button"],[tabindex]') || seed;
      containers.push({
        index: containers.length,
        selector,
        seedSelector: cssPath(seed),
        clickSelector: cssPath(clickTarget),
        tag: container.tagName,
        text: clean(container.textContent),
        ariaLabel: clean(container.getAttribute('aria-label')),
        title: clean(container.getAttribute('title')),
        section: sectionFor(container),
        attributes: attrs(container),
        links,
        directFlyerUrls: links.filter(url => /\/l\/it\/volantini\//i.test(url)),
        image: image?.currentSrc || image?.src || '',
        imageAlt: clean(image?.alt),
        rect: rect(container),
        visible: Boolean(container.offsetWidth || container.offsetHeight || container.getClientRects().length),
        interactiveDescendants: container.querySelectorAll('a,button,[role="button"],[tabindex]').length,
        iframeDescendants: container.querySelectorAll('iframe').length,
        htmlPreview: container.outerHTML.slice(0, 5000)
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      url: location.href,
      title: document.title,
      totalSeeds: seeds.length,
      totalContainers: containers.length,
      containers,
      iframes: [...document.querySelectorAll('iframe')].map((node, index) => ({
        index,
        selector: cssPath(node),
        src: absolute(node.getAttribute('src')),
        title: clean(node.title),
        name: clean(node.name),
        attributes: attrs(node),
        rect: rect(node)
      }))
    };
  });
}

async function dismissOverlays(page, popupLog, scope = 'main') {
  const patterns = [
    /accetta tutto|accetta tutti|consenti tutto|accetta e continua/i,
    /continua senza accettare|rifiuta tutto|solo necessari/i,
    /chiudi|close|non ora|no grazie/i
  ];
  for (const pattern of patterns) {
    const candidates = page.getByRole('button', { name: pattern });
    const count = Math.min(await candidates.count().catch(() => 0), 12);
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      try {
        if (!(await candidate.isVisible())) continue;
        const text = cleanText(await candidate.innerText().catch(() => ''));
        await candidate.click({ timeout: 1800 });
        popupLog.push({ at: new Date().toISOString(), scope, type: 'overlay-dismissed', text, method: 'role-button' });
        await page.waitForTimeout(300);
      } catch (error) {
        popupLog.push({ at: new Date().toISOString(), scope, type: 'overlay-dismiss-failed', pattern: String(pattern), error: error.message });
      }
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
}

function installPopupLogging(browserContext, popupLog) {
  browserContext.on('page', popup => {
    popupLog.push({ at: new Date().toISOString(), type: 'page-opened', url: popup.url(), opener: popup.opener()?.url?.() || '' });
    popup.on('dialog', async dialog => {
      popupLog.push({ at: new Date().toISOString(), type: 'dialog', dialogType: dialog.type(), message: dialog.message(), pageUrl: popup.url() });
      await dialog.dismiss().catch(() => {});
    });
    popup.on('close', () => popupLog.push({ at: new Date().toISOString(), type: 'page-closed', url: popup.url() }));
  });
}

async function clickCardWithMethods(page, card, popupLog) {
  const methods = ['locator-click', 'force-click', 'dom-click', 'coordinates-click', 'keyboard-enter'];
  const attempts = [];
  const discovered = [];

  for (const method of methods) {
    const beforeUrl = page.url();
    const beforePages = page.context().pages().length;
    const networkStart = Date.now();
    let popup = null;
    let error = '';
    try {
      await dismissOverlays(page, popupLog, `card-${card.index}`);
      const locator = page.locator(card.clickSelector || card.selector).first();
      await locator.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});
      const popupPromise = page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null);
      if (method === 'locator-click') await locator.click({ timeout: 3000 });
      if (method === 'force-click') await locator.click({ timeout: 3000, force: true });
      if (method === 'dom-click') await locator.evaluate(node => node.click());
      if (method === 'coordinates-click') {
        const box = await locator.boundingBox();
        if (!box) throw new Error('bounding box non disponibile');
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }
      if (method === 'keyboard-enter') {
        await locator.focus();
        await page.keyboard.press('Enter');
      }
      popup = await popupPromise;
      await page.waitForTimeout(1800);
      const target = popup || page;
      await dismissOverlays(target, popupLog, `card-${card.index}-${method}`).catch(() => {});
      const finalUrl = target.url();
      const canonical = canonicalFlyerUrl(finalUrl);
      if (canonical) discovered.push({ title: card.text || card.imageAlt, category: card.section, url: canonical, source: `card-${method}` });
      const nested = await analyzeLandingCardContainers(target).catch(() => null);
      for (const nestedCard of nested?.containers || []) {
        for (const url of nestedCard.directFlyerUrls || []) discovered.push({ title: nestedCard.text, category: nestedCard.section, url, source: `card-${method}-nested` });
      }
      attempts.push({
        method,
        success: true,
        beforeUrl,
        finalUrl,
        popupOpened: Boolean(popup),
        pagesBefore: beforePages,
        pagesAfter: page.context().pages().length,
        elapsedMs: Date.now() - networkStart
      });
    } catch (caught) {
      error = caught.message;
      attempts.push({ method, success: false, beforeUrl, finalUrl: page.url(), popupOpened: Boolean(popup), error, elapsedMs: Date.now() - networkStart });
    } finally {
      if (popup && !popup.isClosed()) await popup.close().catch(() => {});
      if (page.url() !== beforeUrl) {
        await page.goto(LANDING_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(900);
      } else {
        await page.keyboard.press('Escape').catch(() => {});
      }
    }
    if (discovered.length) break;
  }

  return { cardIndex: card.index, selector: card.selector, clickSelector: card.clickSelector, text: card.text, attempts, discovered };
}

async function inspectFramesForFlyers(page) {
  const output = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const data = await frame.evaluate(() => ({
        url: location.href,
        title: document.title,
        text: String(document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 12000),
        links: [...document.querySelectorAll('a[href]')].map(node => node.href).filter(Boolean).slice(0, 500),
        resources: performance.getEntriesByType('resource').map(entry => entry.name).slice(0, 1000)
      }));
      output.push({ ...data, flyerUrls: [...data.links, ...data.resources].filter(url => /\/l\/it\/volantini\//i.test(url)) });
    } catch (error) {
      output.push({ url: frame.url(), error: error.message, flyerUrls: [] });
    }
  }
  return output;
}

async function scrollLandingUntilStable(page) {
  let previousHeight = 0;
  let stableRounds = 0;
  for (let round = 0; round < 20 && stableRounds < 3; round += 1) {
    const height = await page.evaluate(() => Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0));
    await page.evaluate(() => window.scrollTo(0, Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0)));
    await page.waitForTimeout(800);
    const nextHeight = await page.evaluate(() => Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0));
    stableRounds = nextHeight === previousHeight || nextHeight === height ? stableRounds + 1 : 0;
    previousHeight = nextHeight;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

async function resolveViewerFlyers(page) {
  const networkFlyers = [];
  const networkAfterClick = [];
  const popupLog = [];
  const capturedResponses = [];
  const browserContext = page.context();
  installPopupLogging(browserContext, popupLog);

  page.on('dialog', async dialog => {
    popupLog.push({ at: new Date().toISOString(), type: 'dialog', dialogType: dialog.type(), message: dialog.message(), pageUrl: page.url() });
    await dialog.dismiss().catch(() => {});
  });

  let clickPhase = false;
  const responseListener = async response => {
    const request = response.request();
    const url = response.url();
    const contentType = String(response.headers()['content-type'] || '');
    const entry = {
      at: new Date().toISOString(), url, method: request.method(), status: response.status(),
      resourceType: request.resourceType(), contentType, frameUrl: request.frame()?.url?.() || '', afterClick: clickPhase
    };
    if (clickPhase) networkAfterClick.push(entry);
    try {
      const inspect = /json|javascript|text|html/i.test(contentType) || ['xhr', 'fetch', 'script', 'document'].includes(request.resourceType());
      if (!inspect) return;
      let body = await response.text();
      if (body.length > 6_000_000) body = body.slice(0, 6_000_000);
      entry.bodyBytes = Buffer.byteLength(body, 'utf8');
      entry.bodyPreview = cleanText(body).slice(0, 12000);
      if (/endpoints\.leaflets\.schwarz\/v4\/(?:widget|flyer)/i.test(url) && body) {
        try { networkFlyers.push(...collectFlyersFromPayload(JSON.parse(body), clickPhase ? 'click-network' : 'landing-network')); } catch {}
      }
      if (/volantin|leaflet|flyer|catalog|weekly/i.test(`${url}\n${body}`)) capturedResponses.push(entry);
    } catch (error) {
      entry.captureError = error.message;
    }
  };

  page.on('response', responseListener);
  let cardsAnalysis = null;
  let cardClickResults = [];
  let frameAnalysis = [];

  try {
    await page.goto(LANDING_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dismissOverlays(page, popupLog, 'landing');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3500);
    await scrollLandingUntilStable(page);
    cardsAnalysis = await analyzeLandingCardContainers(page);
    frameAnalysis = await inspectFramesForFlyers(page);

    // Le card con href diretto non richiedono alcun click. Clicchiamo solo
    // controlli compatti e plausibili (es. il pulsante del volantino settimanale),
    // evitando header, body e contenitori generici che rallentavano la scansione.
    const clickCandidates = cardsAnalysis.containers
      .filter(card => {
        const directUrls = [card.attributes?.href, ...(card.directFlyerUrls || [])]
          .map(canonicalFlyerUrl)
          .filter(Boolean);
        const text = cleanText(`${card.text || ''} ${card.imageAlt || ''}`);
        const tag = String(card.tag || '').toUpperCase();
        if (directUrls.length || isTravelFlyer({ title: text })) return false;
        if (!['BUTTON', 'A'].includes(tag)) return false;
        if (!text || text.length > 500) return false;
        return /volantino|offerte valide|offerte.*settimana|scopri di più/i.test(text);
      })
      .slice(0, 8);

    clickPhase = true;
    for (const card of clickCandidates) {
      cardClickResults.push(await clickCardWithMethods(page, card, popupLog));
    }
    clickPhase = false;
  } finally {
    page.off('response', responseListener);
  }

  const directCards = (cardsAnalysis?.containers || []).flatMap(card => {
    const urls = [card.attributes?.href, ...(card.directFlyerUrls || [])]
      .map(canonicalFlyerUrl)
      .filter(Boolean);
    return [...new Set(urls)].map(url => ({
      title: card.text || card.imageAlt,
      category: card.section,
      url,
      source: 'card-container'
    }));
  });
  const clickedCards = cardClickResults.flatMap(result => result.discovered || []);
  const frameFlyers = frameAnalysis.flatMap(frame => (frame.flyerUrls || []).map(url => ({ title: frame.title, url, source: 'iframe' })));

  let widgetFlyers = [];
  try {
    const response = await page.request.get(WIDGET_URL, { timeout: 30000, headers: { accept: 'application/json', 'accept-language': 'it-IT,it;q=0.9,en;q=0.7' } });
    if (response.ok()) widgetFlyers = collectFlyersFromPayload(await response.json(), 'widget-fallback');
  } catch {}

  const flyers = dedupeFlyers([...directCards, ...clickedCards, ...frameFlyers, ...networkFlyers, ...widgetFlyers])
    .map((item, index) => ({ ...item, index }));

  await Promise.all([
    writeJson(path.join(DEBUG_DIR, 'cards-analysis.json'), { ...cardsAnalysis, frames: frameAnalysis }),
    writeJson(path.join(DEBUG_DIR, 'card-click-results.json'), cardClickResults),
    writeJson(path.join(DEBUG_DIR, 'network-after-click.json'), networkAfterClick),
    writeJson(path.join(DEBUG_DIR, 'popup-log.json'), popupLog)
  ]);

  return {
    flyers,
    landingCards: cardsAnalysis?.containers || [],
    clickedCards,
    networkFlyers: dedupeFlyers(networkFlyers),
    widgetFlyers: dedupeFlyers(widgetFlyers),
    landingDiagnostics: cardsAnalysis,
    capturedResponses,
    cardClickResults,
    networkAfterClick,
    popupLog,
    frameAnalysis
  };
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


function flyerIdentifierFromUrl(viewerUrl = '') {
  try {
    const pathname = new URL(viewerUrl, LANDING_URL).pathname;
    const match = pathname.match(/\/volantini\/([^/]+)(?:\/ar\/\d+|\/view\/flyer\/page\/\d+)?/i);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

async function fetchFlyerMetadata(page, viewerUrl) {
  const identifier = flyerIdentifierFromUrl(viewerUrl);
  if (!identifier) return null;

  const endpoint = `https://endpoints.leaflets.schwarz/v4/flyer?flyer_identifier=${encodeURIComponent(identifier)}`;
  const response = await page.request.get(endpoint, {
    timeout: 45000,
    headers: {
      accept: 'application/json',
      'accept-language': 'it-IT,it;q=0.9,en;q=0.7'
    }
  });

  if (!response.ok()) return null;
  const payload = await response.json();
  return payload?.flyer || null;
}

function textItemToLineItem(item = {}) {
  const transform = Array.isArray(item.transform) ? item.transform : [];
  return {
    text: cleanText(item.str || ''),
    x: Number(transform[4] || 0),
    y: Number(transform[5] || 0),
    width: Number(item.width || 0),
    height: Math.abs(Number(transform[3] || item.height || 0))
  };
}

function groupPdfLines(items = []) {
  const sorted = items
    .filter(item => item.text)
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];

  for (const item of sorted) {
    const tolerance = Math.max(2.5, item.height * 0.45);
    let line = lines.find(candidate => Math.abs(candidate.y - item.y) <= tolerance);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }

  return lines
    .map(line => ({
      y: line.y,
      items: line.items.sort((a, b) => a.x - b.x),
      text: cleanText(line.items.sort((a, b) => a.x - b.x).map(item => item.text).join(' '))
    }))
    .filter(line => line.text)
    .sort((a, b) => b.y - a.y);
}

function pricesFromText(text = '') {
  const normalized = cleanText(text).replace(/(\d)\s*[,.]\s*(\d{2})/g, '$1,$2');
  const values = [];
  const patterns = [
    /(?:€\s*)?(\d{1,3}[,.]\d{2})(?:\s*€)?/g,
    /(?:€\s*)?(\d{1,3})\s+(\d{2})(?:\s*€)?/g
  ];

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const raw = match[2] ? `${match[1]}.${match[2]}` : match[1].replace(',', '.');
      const value = Number(raw);
      if (Number.isFinite(value) && value >= 0.05 && value <= 999.99) values.push(value);
    }
  }
  return [...new Set(values)];
}

function exactPriceFromItem(text = '') {
  const value = cleanText(text).replace(',', '.');
  const match = value.match(/^€?\s*(\d{1,3}\.\d{2})\s*€?\*?$/);
  if (!match) return null;
  const price = Number(match[1]);
  return Number.isFinite(price) && price >= 0.05 && price <= 499.99 ? price : null;
}

function isUnitPriceText(text = '') {
  const value = cleanText(text);
  return /(?:^|\s)(?:1\s*(?:kg|l|lt)|100\s*g|€\/\s*(?:kg|l|lt|100\s*g))\s*(?:=|:)?/i.test(value) ||
    /\b(?:al\s+kg|al\s+litro|per\s+kg|per\s+litro)\b/i.test(value);
}

function isPdfNoise(text = '') {
  const value = cleanText(text);
  if (!value || value.length < 2) return true;
  if (/^[\d\s/.-]+$/.test(value)) return true;
  return /^(?:dal nostro assortimento|perfetta|vale davvero\.?|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica|prezzi validi.*|prodotti disponibili.*|fino ad esaurimento.*|salvo errori.*|lidl plus|scopri di più|pagina \d+|\d+\/2026)$/i.test(value);
}

function formatFromPdfContext(text = '') {
  const patterns = [
    /\b\d+\s*x\s*\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|cl)\b/i,
    /\b\d+(?:[.,]\d+)?(?:\/\d+(?:[.,]\d+)?)?\s*(?:kg|g|l|ml|cl)\b/i,
    /\b\d+\s*(?:pz|pezzi)\b/i
  ];
  for (const pattern of patterns) {
    const match = cleanText(text).match(pattern);
    if (match) return cleanText(match[0]);
  }
  return '';
}

function cleanPdfTitleParts(parts = []) {
  const cleaned = [];
  for (const raw of parts) {
    let text = cleanText(raw);
    if (!text || isPdfNoise(text) || isUnitPriceText(text)) continue;
    if (exactPriceFromItem(text) !== null) continue;
    if (/^(?:confezione|vaschetta|bottiglia)$/i.test(text)) continue;
    if (/^\d+(?:[.,]\d+)?(?:\/\d+(?:[.,]\d+)?)?\s*(?:kg|g|l|ml|cl)(?:\s+confezione)?$/i.test(text)) continue;
    text = text.replace(/\s+confezione$/i, '').trim();
    if (!text || cleaned.at(-1)?.toLowerCase() === text.toLowerCase()) continue;
    cleaned.push(text);
  }
  return cleanText(cleaned.join(' '))
    .replace(/\b(?:confezione|vaschetta|bottiglia)\b\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function inferOfferFromPriceItem(page, priceItem, flyer = {}) {
  const price = exactPriceFromItem(priceItem.text);
  if (!Number.isFinite(price)) return null;

  const allItems = (page.lines || []).flatMap(line => line.items || []);
  const left = priceItem.x - 175;
  const right = priceItem.x + 42;

  const nearby = allItems.filter(item =>
    item !== priceItem &&
    item.x >= left && item.x <= right &&
    item.y >= priceItem.y + 4 && item.y <= priceItem.y + 145
  );

  const formatCandidates = nearby
    .filter(item => formatFromPdfContext(item.text))
    .filter(item => !isUnitPriceText(item.text))
    .filter(item => item.x <= priceItem.x + 12)
    .sort((a, b) => b.x - a.x || Math.abs(a.y - priceItem.y) - Math.abs(b.y - priceItem.y));
  const formatItem = formatCandidates[0] || null;
  const format = formatFromPdfContext(formatItem?.text || '');

  const titleFloor = formatItem ? formatItem.y + 1 : priceItem.y + 12;
  const titleLeft = formatItem ? formatItem.x - 8 : left;
  const titleRight = formatItem ? Math.max(priceItem.x + 35, formatItem.x + 185) : right;
  const titleItems = nearby
    .filter(item => item.x >= titleLeft && item.x <= titleRight)
    .filter(item => item.y >= titleFloor)
    .filter(item => !formatFromPdfContext(item.text))
    .filter(item => !isPdfNoise(item.text))
    .filter(item => !pricesFromText(item.text).length)
    .sort((a, b) => b.y - a.y || a.x - b.x);

  // Limita il titolo al blocco più vicino al prezzo: evita di inglobare il prodotto sopra.
  const compact = [];
  let lastY = null;
  for (const item of titleItems) {
    if (lastY !== null && lastY - item.y > 32) break;
    compact.push(item.text);
    lastY = item.y;
    if (compact.length >= 6) break;
  }

  let title = cleanPdfTitleParts(compact);
  if (!titleIsUsable(title)) {
    const fallback = nearby
      .filter(item => !formatFromPdfContext(item.text))
      .filter(item => !pricesFromText(item.text).length)
      .sort((a, b) => Math.abs(a.y - priceItem.y) - Math.abs(b.y - priceItem.y))
      .slice(0, 4)
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map(item => item.text);
    title = cleanPdfTitleParts(fallback);
  }

  if (!titleIsUsable(title) || isPdfNoise(title) || !/[a-zàèéìòù]{3}/i.test(title)) return null;

  const neighborhood = cleanText(
    nearby
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map(item => item.text)
      .join(' ')
  );

  return {
    title,
    text: neighborhood,
    price,
    oldPrice: null,
    unitPrice: null,
    format,
    discount: cleanText(neighborhood.match(/-\s*\d{1,2}\s*%/)?.[0] || ''),
    image: flyer.pages?.find(item => Number(item.number) === Number(page.number))?.thumbnail || '',
    sourceUrl: flyer.flyerUrlAbsolute || flyer.hiResPdfUrl || flyer.pdfUrl || '',
    description: `Volantino Lidl, pagina ${page.number}`,
    pdfPage: page.number,
    extractionMethod: 'pdf-coordinate-v2'
  };
}

function dedupePdfOffers(offers = []) {
  const seen = new Map();
  for (const offer of offers) {
    const key = `${offer.pdfPage}|${cleanText(offer.title).toLowerCase().replace(/[^a-z0-9àèéìòù]+/gi, ' ')}|${offer.price.toFixed(2)}`;
    const existing = seen.get(key);
    if (!existing || (offer.format && !existing.format)) seen.set(key, offer);
  }
  return [...seen.values()];
}

function extractPdfOffersFromLines(pages = [], flyer = {}) {
  const output = [];

  for (const page of pages) {
    const priceItems = (page.lines || [])
      .flatMap(line => line.items || [])
      .filter(item => exactPriceFromItem(item.text) !== null);

    for (const priceItem of priceItems) {
      const offer = inferOfferFromPriceItem(page, priceItem, flyer);
      if (offer) output.push(offer);
    }
  }

  return dedupePdfOffers(output);
}

async function readPdfCacheByHash(pdfHash) {
  const cachePath = path.join(CACHE_DIR, `sha256-${pdfHash}.json`);
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    if (cached?.version !== PDF_CACHE_VERSION || cached?.pdfHash !== pdfHash || !Array.isArray(cached.pages)) return null;
    return { ...cached, cachePath, cacheHit: true };
  } catch {
    return null;
  }
}

async function writePdfCache(pdfUrl, pdfHash, result) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `sha256-${pdfHash}.json`);
  await writeJson(cachePath, {
    version: PDF_CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    pdfUrl,
    pdfHash,
    bytes: result.bytes,
    pages: result.pages
  });
  return cachePath;
}

async function extractPdfOffers(flyer) {
  const totalStarted = nowMs();
  const pdfUrl = String(flyer?.hiResPdfUrl || flyer?.pdfUrl || '');
  if (!pdfUrl) return { offers: [], pages: [], pdfUrl: '', bytes: 0, cacheHit: false, timings: { totalMs: 0 } };

  const downloadStarted = nowMs();
  const response = await fetch(pdfUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0',
      accept: 'application/pdf,*/*'
    },
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`Lidl PDF: download fallito (${response.status})`);

  const data = new Uint8Array(await response.arrayBuffer());
  const downloadMs = elapsedMs(downloadStarted);
  const byteLength = data.byteLength;
  const hashStarted = nowMs();
  const pdfHash = sha256(data);
  const hashMs = elapsedMs(hashStarted);
  const cached = await readPdfCacheByHash(pdfHash);

  if (cached) {
    const extractionStarted = nowMs();
    const offers = extractPdfOffersFromLines(cached.pages, flyer);
    return {
      offers,
      pages: cached.pages,
      pdfUrl,
      pdfHash,
      bytes: Number(cached.bytes || byteLength),
      cacheHit: true,
      cachePath: cached.cachePath,
      timings: {
        downloadMs,
        hashMs,
        parsePdfMs: 0,
        extractOffersMs: elapsedMs(extractionStarted),
        totalMs: elapsedMs(totalStarted)
      }
    };
  }

  const parseStarted = nowMs();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const pdfPage = await document.getPage(pageNumber);
    const content = await pdfPage.getTextContent();
    const items = content.items.map(textItemToLineItem).filter(item => item.text);
    pages.push({
      number: pageNumber,
      lines: groupPdfLines(items),
      rawText: cleanText(items.map(item => item.text).join(' '))
    });
  }
  const parsePdfMs = elapsedMs(parseStarted);
  const extractionStarted = nowMs();
  const offers = extractPdfOffersFromLines(pages, flyer);
  const extractOffersMs = elapsedMs(extractionStarted);

  const result = {
    offers,
    pages,
    pdfUrl,
    pdfHash,
    bytes: byteLength,
    cacheHit: false,
    timings: {
      downloadMs,
      hashMs,
      parsePdfMs,
      extractOffersMs,
      totalMs: elapsedMs(totalStarted)
    }
  };
  result.cachePath = await writePdfCache(pdfUrl, pdfHash, result);
  return result;
}

function offerComparisonKey(offer = {}) {
  return cleanText(`${offer.chain || offer.store || ''}|${offer.product || offer.title || ''}|${offer.format || ''}`)
    .toLowerCase()
    .replace(/[^a-z0-9àèéìòù|]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function compareWithPreviousLidlOffers(currentOffers = []) {
  let previous = [];
  try {
    const payload = JSON.parse(await fs.readFile(path.resolve('data/offerte.json'), 'utf8'));
    previous = (Array.isArray(payload) ? payload : payload?.items || [])
      .filter(item => /lidl/i.test(String(item.chain || item.store || '')));
  } catch {
    // Primo avvio o archivio non ancora presente.
  }

  const previousMap = new Map(previous.map(item => [offerComparisonKey(item), item]).filter(([key]) => key));
  const currentMap = new Map(currentOffers.map(item => [offerComparisonKey(item), item]).filter(([key]) => key));
  const added = [];
  const removed = [];
  const priceChanged = [];

  for (const [key, item] of currentMap) {
    const old = previousMap.get(key);
    if (!old) added.push(item);
    else if (Number(old.price) !== Number(item.price)) {
      priceChanged.push({ key, product: item.product, format: item.format, oldPrice: Number(old.price), newPrice: Number(item.price) });
    }
  }
  for (const [key, item] of previousMap) {
    if (!currentMap.has(key)) removed.push(item);
  }

  return {
    generatedAt: new Date().toISOString(),
    previousCount: previous.length,
    currentCount: currentOffers.length,
    addedCount: added.length,
    removedCount: removed.length,
    priceChangedCount: priceChanged.length,
    added,
    removed,
    priceChanged
  };
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
  await fs.mkdir(DEBUG_DIR, { recursive: true });
  if (DEBUG_FULL) await fs.mkdir(path.join(DEBUG_DIR, 'responses'), { recursive: true });
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
      if (DEBUG_FULL) {
        const filePath = path.join(DEBUG_DIR, 'responses', fileName);
        await writeJson(filePath, parsed);
      }

      const summary = summarizeJson(parsed);
      const responseInfo = {
        url,
        status: response.status(),
        method: request.method(),
        resourceType: request.resourceType(),
        contentType,
        bodyBytes: entry.bodyBytes,
        file: DEBUG_FULL ? `responses/${fileName}` : '',
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
    if (DEBUG_FULL) {
      await fs.writeFile(path.join(DEBUG_DIR, 'page.html'), await page.content(), 'utf8');
      await page.screenshot({
        path: path.join(DEBUG_DIR, 'final-page.png'),
        fullPage: true
      });
    }
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

  const writes = [
    writeJson(path.join(DEBUG_DIR, 'report.json'), report),
    writeJson(path.join(DEBUG_DIR, 'page-errors.json'), debugState.pageErrors),
    writeJson(path.join(DEBUG_DIR, 'failed-requests.json'), debugState.failedRequests.slice(0, 200))
  ];
  if (DEBUG_FULL) {
    writes.push(
      writeJson(path.join(DEBUG_DIR, 'network.json'), debugState.network),
      writeJson(path.join(DEBUG_DIR, 'json-index.json'), debugState.jsonResponses),
      writeJson(path.join(DEBUG_DIR, 'console.json'), debugState.console)
    );
  }
  await Promise.all(writes);

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
  const scanStarted = nowMs();
  const phaseTimings = {};
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
      ...(DEBUG_FULL ? {
        recordHar: {
          path: path.join(DEBUG_DIR, 'lidl-session.har'),
          mode: 'minimal',
          content: 'omit'
        }
      } : {})
    });

    page = await browserContext.newPage();
    await attachNetworkDebug(page, debugState);

    const discoveryStarted = nowMs();
    const offersUrl = await findOffersUrl(page);
    const discovery = await resolveViewerFlyers(page);
    phaseTimings.discoveryMs = elapsedMs(discoveryStarted);
    const viewerFlyers = discovery.flyers;
    await writeJson(path.join(DEBUG_DIR, 'cards.json'), discovery.landingCards);
    await writeJson(path.join(DEBUG_DIR, 'flyers.json'), viewerFlyers);
    await writeJson(path.join(DEBUG_DIR, 'flyer-discovery.json'), {
      landingCards: discovery.landingCards.length,
      clickedCards: discovery.clickedCards.length,
      networkFlyers: discovery.networkFlyers.length,
      widgetFlyers: discovery.widgetFlyers.length,
      keywordResponses: discovery.capturedResponses?.length || 0,
      landingTextContainsWeekly: /volantino settimanale|volantini settimanali/i.test(discovery.landingDiagnostics?.bodyText || ''),
      finalFlyers: viewerFlyers.length,
      sources: viewerFlyers.map(item => ({ label: item.label, url: item.url, category: item.category, source: item.source }))
    });
    if (!offersUrl && !viewerFlyers.length) {
      throw new Error('Lidl: né pagina offerte né volantini individuati');
    }

    // Prima apre la pagina offerte: mantiene le card già funzionanti.
    const offersPageStarted = nowMs();
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
    phaseTimings.offersPageMs = elapsedMs(offersPageStarted);

    // Elabora i volantini in parallelo (massimo due alla volta). Il PDF resta
    // la sorgente primaria; il viewer viene usato soltanto quando manca il PDF.
    const flyerJobs = viewerFlyers.map((flyerEntry, index) => async () => {
      const viewerUrl = flyerEntry.url;
      const canonicalUrl = canonicalFlyerUrl(viewerUrl) || viewerUrl;
      let flyerViewerCards = [];
      const flyerStarted = nowMs();
      let pdfResult = { offers: [], pages: [], pdfUrl: '', bytes: 0, cacheHit: false, timings: {} };

      try {
        const flyerMetadata = await fetchFlyerMetadata(page, canonicalUrl);
        if (flyerMetadata?.hiResPdfUrl || flyerMetadata?.pdfUrl) {
          pdfResult = await extractPdfOffers(flyerMetadata);
          const safeIndex = String(index + 1).padStart(2, '0');
          await writeJson(path.join(DEBUG_DIR, `pdf-extraction-${safeIndex}.json`), {
            flyerLabel: flyerEntry.label,
            viewerUrl: canonicalUrl,
            pdfUrl: pdfResult.pdfUrl,
            pdfHash: pdfResult.pdfHash || '',
            bytes: pdfResult.bytes,
            cacheHit: pdfResult.cacheHit,
            cachePath: pdfResult.cachePath || '',
            timings: pdfResult.timings || {},
            pages: DEBUG_FULL ? pdfResult.pages.map(item => ({ number: item.number, lines: item.lines, rawText: item.rawText })) : pdfResult.pages.map(item => ({ number: item.number, lineCount: item.lines?.length || 0 })),
            offers: pdfResult.offers
          });
        } else {
          const fallbackPage = await browserContext.newPage();
          try {
            await fallbackPage.goto(canonicalUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await dismissConsent(fallbackPage);
            await fallbackPage.waitForTimeout(800);
            flyerViewerCards = await extractViewerCards(fallbackPage);
          } finally {
            await fallbackPage.close().catch(() => {});
          }
        }

        return {
          index,
          offers: pdfResult.offers,
          viewerCards: flyerViewerCards,
          summary: {
            label: flyerEntry.label,
            viewerUrl: canonicalUrl,
            flyerIdentifier: flyerIdentifierFromUrl(canonicalUrl),
            pdfUrl: pdfResult.pdfUrl,
            pdfBytes: pdfResult.bytes,
            pdfPages: pdfResult.pages.length,
            viewerCards: flyerViewerCards.length,
            pdfCards: pdfResult.offers.length,
            cacheHit: Boolean(pdfResult.cacheHit),
            timings: { ...(pdfResult.timings || {}), flyerTotalMs: elapsedMs(flyerStarted) },
            status: 'ok'
          }
        };
      } catch (flyerError) {
        debugState.artifactErrors.push(`Volantino ${flyerEntry.label}: ${flyerError.message}`);
        return {
          index,
          offers: [],
          viewerCards: flyerViewerCards,
          summary: {
            label: flyerEntry.label,
            viewerUrl: canonicalUrl,
            flyerIdentifier: flyerIdentifierFromUrl(canonicalUrl),
            viewerCards: flyerViewerCards.length,
            pdfCards: 0,
            cacheHit: false,
            timings: { flyerTotalMs: elapsedMs(flyerStarted) },
            status: 'error',
            error: flyerError.message
          }
        };
      }
    });

    const flyersStarted = nowMs();
    const flyerResults = [];
    for (let offset = 0; offset < flyerJobs.length; offset += MAX_FLYER_CONCURRENCY) {
      const batch = flyerJobs.slice(offset, offset + MAX_FLYER_CONCURRENCY);
      flyerResults.push(...await Promise.all(batch.map(job => job())));
    }
    flyerResults.sort((a, b) => a.index - b.index);
    phaseTimings.flyersMs = elapsedMs(flyersStarted);

    const viewerCards = flyerResults.flatMap(item => item.viewerCards);
    const pdfOffers = flyerResults.flatMap(item => item.offers);
    const processedFlyers = flyerResults.map(item => item.summary);

    await writeJson(path.join(DEBUG_DIR, 'flyers-summary.json'), {
      generatedAt: new Date().toISOString(),
      discoverySource: 'pagina Volantini e Riviste + rete + widget fallback',
      totalDiscovered: viewerFlyers.length,
      landingCards: discovery.landingCards.length,
      clickedCards: discovery.clickedCards.length,
      networkFlyers: discovery.networkFlyers.length,
      widgetFlyers: discovery.widgetFlyers.length,
      excludedRule: 'Lidl Viaggi / vacanze / travel',
      processedFlyers
    });

    const normalizationStarted = nowMs();
    const rawCards = [...pageCards, ...viewerCards, ...pdfOffers];
    const offers = uniqueOffers(
      rawCards
        .map((raw, index) =>
          normalizeOffer(raw, { ...context, offersUrl }, store, index)
        )
        .filter(Boolean)
    );

    phaseTimings.normalizeMs = elapsedMs(normalizationStarted);
    const comparisonStarted = nowMs();
    const offerChanges = await compareWithPreviousLidlOffers(offers);
    phaseTimings.compareMs = elapsedMs(comparisonStarted);
    await writeJson(path.join(DEBUG_DIR, 'offers-change-summary.json'), offerChanges);

    details = {
      offersUrl,
      viewerUrls: viewerFlyers.map(item => item.url),
      includedFlyers: viewerFlyers.length,
      processedFlyers,
      pageTitle: await page.title(),
      pageCards: pageCards.length,
      viewerCards: viewerCards.length,
      pdfCards: pdfOffers.length,
      pdfPages: processedFlyers.reduce((sum, item) => sum + Number(item.pdfPages || 0), 0),
      pdfUrls: processedFlyers.map(item => item.pdfUrl).filter(Boolean),
      pdfBytes: processedFlyers.reduce((sum, item) => sum + Number(item.pdfBytes || 0), 0),
      pdfCacheHits: processedFlyers.filter(item => item.cacheHit).length,
      offerChanges: {
        previousCount: offerChanges.previousCount,
        added: offerChanges.addedCount,
        removed: offerChanges.removedCount,
        priceChanged: offerChanges.priceChangedCount
      },
      rawCards: rawCards.length,
      validOffers: offers.length,
      flyerUrl: context.flyerUrl || '',
      flyerId: context.flyerId || '',
      storeId: String(store.id || ''),
      storeName: store.name || store.brand || 'Lidl',
      timings: { ...phaseTimings, totalMs: elapsedMs(scanStarted) },
      debugMode: DEBUG_FULL ? 'full' : (DEBUG_ENABLED ? 'compact' : 'minimal')
    };

    await saveDebugArtifacts(page, debugState, details);
    await browserContext.close();

    console.log(`Lidl: pagina offerte ${offersUrl || '-'}; ${viewerFlyers.length} volantini inclusi; ${pageCards.length} card pagina; ${viewerCards.length} card viewer; ${pdfOffers.length} card PDF; ${offers.length} offerte valide`);
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
  normalizeOffer,
  pricesFromText,
  exactPriceFromItem,
  isUnitPriceText,
  inferOfferFromPriceItem,
  groupPdfLines,
  extractPdfOffersFromLines,
  flyerIdentifierFromUrl,
  flyerLabel,
  isTravelFlyer,
  isIncludedFlyer,
  canonicalFlyerUrl,
  collectFlyersFromPayload,
  dedupeFlyers
};
