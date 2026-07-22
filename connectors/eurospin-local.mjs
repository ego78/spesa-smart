import { cleanText, numberValue, uniqueOffers } from './common.mjs';

const ROOT='https://digitalflyer.eurospin.it/api/eurospin/eurospin-italia';
const LANDING='https://www.eurospin.it/volantino/';
const KNOWN_STORE_CODES=[
  {match:/\bsava\b/i,code:'603860'}
];

async function getJson(url,{allow404=false}={}){
  const response=await fetch(url,{headers:{accept:'application/json,text/plain,*/*','user-agent':'Mozilla/5.0 (compatible; SpesaSmart/4.0; +GitHub Actions)'},cache:'no-store'});
  if(allow404&&response.status===404)return null;
  if(!response.ok)throw new Error(`Eurospin HTTP ${response.status} su ${url}`);
  return response.json();
}

function prop(raw,code){
  const item=(raw?.properties||[]).find(p=>String(p?.code||'').toUpperCase()===String(code).toUpperCase());
  if(!item)return null;
  const values=Array.isArray(item.values)?item.values:[];
  return values.length===1?values[0]:values;
}
function textProp(raw,...codes){for(const code of codes){const value=prop(raw,code);if(value!==null&&value!==undefined&&value!=='')return cleanText(typeof value==='object'?(value.label||value.name||value.value||''):value)}return''}
function numProp(raw,...codes){for(const code of codes){const value=numberValue(prop(raw,code));if(Number.isFinite(value))return value}return null}
function fileUrl(value){
  const file=Array.isArray(value)?value[0]:value;
  if(!file)return'';
  if(typeof file==='string')return /^https?:/i.test(file)?file:'';
  const direct=file.url||file.publicUrl||file.downloadUrl||file.src;
  if(direct)return direct;
  const id=file.uniqueId||file.id;
  return id?`https://digitalflyer.eurospin.it/api/files/${encodeURIComponent(id)}`:'';
}
function parseDate(value){
  const s=String(value||'');
  return /^\d{8}/.test(s)?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`:s;
}
function resolveStoreCode(store){
  const direct=String(process.env.EUROSPIN_STORE_CODE||store?.officialStoreId||store?.storeCode||store?.code||'').trim();
  if(direct)return direct;
  const haystack=[store?.name,store?.address,store?.city].filter(Boolean).join(' ');
  return KNOWN_STORE_CODES.find(x=>x.match.test(haystack))?.code||'';
}
function choosePromotion(promotions){
  const now=Date.now();
  const active=(Array.isArray(promotions)?promotions:[]).filter(p=>{
    const start=Date.parse(parseDate(p.startDate)||'1970-01-01');
    const end=Date.parse(parseDate(p.endDate)||'2999-12-31');
    return (!Number.isFinite(start)||start<=now)&&(!Number.isFinite(end)||end+86400000>now)&&p.hidden!==true;
  });
  return (active.length?active:promotions||[]).sort((a,b)=>(Number(b.priority)||0)-(Number(a.priority)||0))[0]||null;
}
async function discoverProductEndpoint(promotionAlias,storeAlias,productId){
  const candidates=[
    `${ROOT}/products/${productId}`,
    `${ROOT}/stores/${storeAlias}/promotions/${promotionAlias}/products/${productId}`,
    `${ROOT}/promotions/${promotionAlias}/stores/${storeAlias}/products/${productId}`,
    `${ROOT}/promotions/${promotionAlias}/products/${productId}`
  ];
  for(const url of candidates){
    try{const data=await getJson(url,{allow404:true});if(data)return{urlTemplate:url.replace(productId,'{id}'),sample:data}}catch(e){if(!/HTTP 4\d\d/.test(e.message))console.warn(`Eurospin endpoint candidato: ${e.message}`)}
  }
  return null;
}
function toOffer(raw,context,store,index){
  const source=raw?.product||raw?.element||raw;
  const title=cleanText(source?.name||source?.title||source?.description||textProp(source,'TITLE','PRODUCT_NAME','NAME','DESCRIPTION'));
  if(!title)return null;
  const price=numberValue(source?.discountedPrice??source?.price?.discounted??source?.price?.current??source?.price??numProp(source,'PRICE','PROMO_PRICE','DISCOUNTED_PRICE','SELLING_PRICE'));
  if(!Number.isFinite(price)||price<=0)return null;
  const oldPrice=numberValue(source?.oldPrice??source?.fullPrice??source?.price?.full??source?.price?.original??numProp(source,'OLD_PRICE','FULL_PRICE','ORIGINAL_PRICE','LIST_PRICE'));
  const appId=String(store.id||'');
  const officialId=String(context.officialStore.code||context.officialStore.identifier||'');
  return {
    id:`eurospin-${context.promotion.code||context.promotion.alias}-${officialId}-${source.uniqueId||source.id||index}`,
    store:'Eurospin',chain:'EUROSPIN',product:title,
    brand:cleanText(source?.brand?.name||source?.brand||textProp(source,'BRAND')),
    format:cleanText(source?.format||source?.packaging||textProp(source,'FORMAT','PACKAGE','WEIGHT','QUANTITY')),
    category:cleanText(source?.category?.name||source?.category||textProp(source,'CATEGORY')),
    price,oldPrice:Number.isFinite(oldPrice)&&oldPrice>price?oldPrice:null,
    unitPrice:numberValue(source?.unitPrice??numProp(source,'UNIT_PRICE','PRICE_PER_UNIT')),
    discount:cleanText(source?.discount||textProp(source,'DISCOUNT','PROMOTION_LABEL')),
    description:cleanText(source?.subtitle||source?.longDescription||textProp(source,'SUBTITLE','LONG_DESCRIPTION')),
    image:fileUrl(source?.image||source?.images||prop(source,'IMAGE')||prop(source,'PRODUCT_IMAGE')||prop(source,'PREVIEW')),
    validFrom:parseDate(source?.startDate||context.promotion.startDate),validTo:parseDate(source?.endDate||context.promotion.endDate),
    sourceUrl:LANDING,source:'Eurospin Digital Flyer API',localValidityVerified:true,offerScope:'local-store',
    flyerId:String(context.promotion.code||context.promotion.identifier||''),flyerStoreId:appId,officialStoreId:officialId,
    nearestStore:{id:appId,name:store.name||context.officialStore.name||'Eurospin',brand:store.brand||'Eurospin',address:store.address||context.officialStore.address||'',lat:Number(store.lat),lon:Number(store.lon),distance:Number(store.distance)||null},
    locations:[{id:appId,name:store.name||context.officialStore.name||'Eurospin',brand:store.brand||'Eurospin',address:store.address||context.officialStore.address||'',lat:Number(store.lat),lon:Number(store.lon),distance:Number(store.distance)||null,officialStoreId:officialId}],
    fetchedAt:new Date().toISOString()
  };
}

export async function scanEurospinLocal(store){
  const storeCode=resolveStoreCode(store);
  if(!storeCode)throw new Error(`Codice ufficiale Eurospin mancante per ${store?.name||store?.address||'punto vendita'}. Aggiungi officialStoreId oppure il secret EUROSPIN_STORE_CODE.`);
  const page=await getJson(`${ROOT}/stores?page=0&code=${encodeURIComponent(storeCode)}`);
  const officialStore=Array.isArray(page?.elements)?page.elements[0]:null;
  if(!officialStore)throw new Error(`Punto vendita Eurospin ${storeCode} non trovato`);
  const storeAlias=officialStore.alias;
  const promotions=await getJson(`${ROOT}/stores/${encodeURIComponent(storeAlias)}/promotions`);
  const promotion=choosePromotion(promotions);
  if(!promotion)throw new Error(`Nessun volantino Eurospin trovato per ${officialStore.name}`);
  const promotionAlias=promotion.alias;
  const ids=await getJson(`${ROOT}/promotions/${encodeURIComponent(promotionAlias)}/stores/${encodeURIComponent(storeAlias)}/products-id`);
  if(!Array.isArray(ids)||!ids.length)throw new Error(`Volantino Eurospin ${promotion.code||promotionAlias} senza prodotti`);
  console.log(`Eurospin: ${store.name||store.address} → ${officialStore.name} (${officialStore.code}), volantino ${promotion.code}, ${ids.length} prodotti`);
  const endpoint=await discoverProductEndpoint(promotionAlias,storeAlias,String(ids[0]));
  if(!endpoint)throw new Error('API Eurospin raggiunta, ma endpoint dei dettagli prodotto non individuato. Acquisisci un nuovo HAR dopo aver aperto una singola offerta del volantino.');
  console.log(`Eurospin: endpoint prodotti ${endpoint.urlTemplate}`);
  const context={officialStore,promotion};
  const offers=[];
  const batchSize=12;
  for(let start=0;start<ids.length;start+=batchSize){
    const batch=ids.slice(start,start+batchSize);
    const rows=await Promise.all(batch.map(async(id)=>{
      if(String(id)===String(ids[0]))return endpoint.sample;
      const url=endpoint.urlTemplate.replace('{id}',encodeURIComponent(id));
      try{return await getJson(url,{allow404:true})}catch(e){console.warn(`Eurospin prodotto ${id}: ${e.message}`);return null}
    }));
    rows.forEach((raw,i)=>{if(raw){const offer=toOffer(raw,context,store,start+i);if(offer)offers.push(offer)}});
  }
  const unique=uniqueOffers(offers);
  if(!unique.length)throw new Error(`Volantino Eurospin ${promotion.code||promotionAlias} letto, ma nessun prezzo estratto`);
  return unique;
}
