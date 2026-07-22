import fs from 'node:fs/promises';
import { scanEurospin } from '../connectors/eurospin.mjs';
import { scanEurospinLocal } from '../connectors/eurospin-local.mjs';
import { scanPenny } from '../connectors/penny.mjs';
import { scanPennyLocal } from '../connectors/penny-local.mjs';
import { chainFor } from '../connectors/registry.mjs';
import { uniqueOffers } from '../connectors/common.mjs';

const OUTPUT=new URL('../data/offerte.json',import.meta.url);
const LINKS_OUTPUT=new URL('../data/volantini-locali.json',import.meta.url);
const config=JSON.parse(await fs.readFile(new URL('../config/app.json',import.meta.url),'utf8'));
const appsScriptUrl=String(process.env.APPS_SCRIPT_URL||'').trim();
const envFamily=String(process.env.FAMILY_CODE||'').trim();
const familyCode=(envFamily||config.defaultFamilyCode||'default').trim().toUpperCase();

if(!appsScriptUrl)throw new Error('Secret APPS_SCRIPT_URL mancante');
console.log(`Configurazione: famiglia ${familyCode}; Apps Script ${new URL(appsScriptUrl).host}`);
if(!envFamily)console.log(`FAMILY_CODE non presente: uso config/app.json (${familyCode})`);

async function loadRemote(action){
 const url=new URL(appsScriptUrl);url.searchParams.set('action',action);url.searchParams.set('familyCode',familyCode);url.searchParams.set('_',Date.now());
 const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error(`Google Apps Script HTTP ${response.status}`);
 const text=await response.text();let data;try{data=JSON.parse(text)}catch{throw new Error(`Apps Script non ha restituito JSON: ${text.slice(0,120)}`)}
 if(!data.ok)throw new Error(data.error||`Errore ${action}`);return data;
}
async function loadSelectedStores(){
 const data=await loadRemote('listSupermarkets');
 const all=Array.isArray(data.supermarkets)?data.supermarkets:[];
 console.log(`Apps Script ha restituito ${all.length} supermercati (${all.filter(s=>s?.selected===true).length} selezionati)`);
 return all.filter(s=>s&&s.selected===true);
}
function norm(v){return String(v||'').trim().toUpperCase()}
function locationsFor(offer,stores){const chain=norm(offer.store||offer.chain);return stores.filter(s=>{const c=chainFor(s.brand||s.name);return c&&c.aliases.some(a=>chain.includes(a))}).map(s=>({id:s.id||'',name:s.name||s.brand||'',brand:s.brand||s.name||'',address:s.address||'',distance:Number.isFinite(Number(s.distance))?Number(s.distance):null,lat:Number.isFinite(Number(s.lat))?Number(s.lat):null,lon:Number.isFinite(Number(s.lon))?Number(s.lon):null})).sort((a,b)=>(a.distance??9999)-(b.distance??9999))}
function attachFallback(offers,stores){return offers.map(o=>{if(o.localValidityVerified)return o;const locations=locationsFor(o,stores);return{...o,locations,nearestStore:locations[0]||null,offerScope:locations.length?'selected-chain':'national-chain',localValidityVerified:false}})}

function buildFlyerLinks(stores,offers){
 const now=new Date().toISOString();
 return stores.filter(s=>s?.selected===true||true).map(store=>{
   const related=offers.filter(o=>String(o.flyerStoreId||'')===String(store.id||''));
   const verified=related.find(o=>o.localValidityVerified===true);
   const chain=chainFor(store.brand||store.name);
   return {
     familyCode,
     storeId:String(store.id||''),
     chainId:chain?.id||'',
     chain:store.brand||store.name||'',
     storeName:store.name||store.brand||'',
     address:store.address||'',
     connectionMode:['penny','eurospin'].includes(chain?.id)?'automatic':'manual-pdf',
     connected:Boolean(verified),
     verified:Boolean(verified),
     officialStoreId:String(verified?.officialStoreId||store.officialStoreId||store.storeCode||''),
     officialStoreAlias:String(verified?.officialStoreAlias||''),
     flyerId:String(verified?.flyerId||''),
     promotionId:String(verified?.promotionId||''),
     offersCount:related.length,
     lastCheckedAt:now,
     lastSuccessfulUpdateAt:verified?now:null
   };
 });
}

async function safe(name,fn){try{const out=await fn();console.log(`${name}: ${out.length} offerte`);return out}catch(e){console.error(`${name}: ${e.message}`);return[]}}

const stores=await loadSelectedStores();
console.log(`Punti vendita selezionati: ${stores.length}`);
if(!stores.length)throw new Error(`Nessun supermercato selezionato per ${familyCode}. Controlla FAMILY_CODE e APPS_SCRIPT_URL.`);
const pennyStores=stores.filter(s=>chainFor(s.brand||s.name)?.id==='penny');
const eurospinStores=stores.filter(s=>chainFor(s.brand||s.name)?.id==='eurospin');
const pennyJobs=pennyStores.map(store=>safe(`PENNY locale ${store.name||store.brand}`,()=>scanPennyLocal(store)));
const eurospinJobs=eurospinStores.map(store=>safe(`Eurospin locale ${store.name||store.brand}`,()=>scanEurospinLocal(store)));
const pdfStores=stores.filter(s=>chainFor(s.brand||s.name)?.id!=='penny'&&String(s.flyerUrl||'').trim());
let pdfJobs=[];
if(pdfStores.length){
  if(!process.env.OPENAI_API_KEY){
    console.warn(`Ignoro ${pdfStores.length} volantini PDF: secret OPENAI_API_KEY non configurato.`);
  }else{
    const { scanFlyerPdf }=await import('../connectors/flyer-ai.mjs');
    pdfJobs=pdfStores.map(store=>safe(`Volantino locale ${store.name||store.brand}`,()=>scanFlyerPdf(store,String(store.flyerUrl).trim())));
  }
}
const localResults=(await Promise.all([...pennyJobs,...eurospinJobs,...pdfJobs])).flat();
const verifiedStoreIds=new Set(localResults.map(o=>String(o.flyerStoreId||'')).filter(Boolean));
const chains=[...new Set(stores.map(s=>chainFor(s.brand||s.name)?.id).filter(Boolean))];
const fallbackJobs=[];
if(chains.includes('penny')&&pennyStores.length&&!pennyStores.some(s=>verifiedStoreIds.has(String(s.id))))fallbackJobs.push(safe('PENNY generale di riserva',scanPenny));
if(chains.includes('eurospin')&&!stores.some(s=>chainFor(s.brand||s.name)?.id==='eurospin'&&verifiedStoreIds.has(String(s.id))))fallbackJobs.push(safe('Eurospin generale',scanEurospin));
const fallback=attachFallback((await Promise.all(fallbackJobs)).flat(),stores);
const offers=uniqueOffers([...localResults,...fallback]).sort((a,b)=>String(a.store).localeCompare(String(b.store),'it')||String(a.product).localeCompare(String(b.product),'it'));
await fs.writeFile(OUTPUT,JSON.stringify(offers,null,2)+'\n','utf8');
const flyerLinks=buildFlyerLinks(stores,offers);
await fs.writeFile(LINKS_OUTPUT,JSON.stringify({generatedAt:new Date().toISOString(),familyCode,stores:flyerLinks},null,2)+'\n','utf8');
console.log('Collegamenti volantini: '+flyerLinks.map(x=>`${x.chain}: ${x.connected?'collegato':'non collegato'} (${x.offersCount})`).join(' | '));
console.log(`Offerte locali verificate: ${offers.filter(o=>o.localValidityVerified).length}`);
console.log(`Offerte generali/non verificate: ${offers.filter(o=>!o.localValidityVerified).length}`);
console.log(`Totale offerte: ${offers.length}`);
if(!offers.length)throw new Error('Nessuna offerta prodotta: aggiornamento non valido.');
