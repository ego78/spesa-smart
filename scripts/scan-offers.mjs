import fs from 'node:fs/promises';

const appsUrl = process.env.APPS_SCRIPT_URL;
const familyCode = process.env.APPS_SCRIPT_CODE;
const braveKey = process.env.BRAVE_SEARCH_API_KEY || '';
if (!appsUrl || !familyCode) throw new Error('Mancano APPS_SCRIPT_URL o APPS_SCRIPT_CODE');

const stores = ['Eurospin','Lidl','Penny Market','Decò','Coop Alleanza','Conad','MD','Famila','Dok','Todis'];
const request = await fetch(appsUrl, {method:'POST',headers:{'content-type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'listProducts',code:familyCode}),redirect:'follow'});
const json = await request.json();
if (!json.ok) throw new Error(json.error || 'Impossibile leggere i prodotti');
const products = json.products || [];
const offers = [];

if (braveKey) {
  for (const product of products) {
    const zone = product.location || 'Sava 74028';
    const query = `${product.name} ${product.brand || ''} offerta volantino (${stores.join(' OR ')}) ${zone}`;
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', '10');
    url.searchParams.set('country', 'IT');
    url.searchParams.set('search_lang', 'it');
    const res = await fetch(url, {headers:{Accept:'application/json','X-Subscription-Token':braveKey}});
    if (!res.ok) { console.warn(`Ricerca fallita per ${product.name}: ${res.status}`); continue; }
    const data = await res.json();
    for (const item of data.web?.results || []) {
      const text = `${item.title || ''} ${item.description || ''}`;
      const store = stores.find(s => new RegExp(s.replace(' Market',''), 'i').test(text));
      if (!store) continue;
      const priceMatch = text.match(/(?:€\s*|euro\s*)(\d{1,3}[,.]\d{2})|(\d{1,3}[,.]\d{2})\s*(?:€|euro)/i);
      const price = priceMatch ? Number((priceMatch[1] || priceMatch[2]).replace(',','.')) : 0;
      offers.push({id:`${product.id}-${Buffer.from(item.url).toString('base64url').slice(0,12)}`,productId:product.id,productName:product.name,store,title:item.title,url:item.url,description:item.description||'',price,foundAt:new Date().toISOString()});
    }
  }
} else {
  console.warn('BRAVE_SEARCH_API_KEY assente: creato file senza nuove offerte.');
}

const unique = [...new Map(offers.map(x => [x.url, x])).values()];
await fs.mkdir('data',{recursive:true});
await fs.writeFile('data/offerte.json', JSON.stringify({updatedAt:new Date().toISOString(),productsChecked:products.length,offers:unique}, null, 2));
console.log(`Controllati ${products.length} prodotti; salvate ${unique.length} offerte.`);
