import{read,write}from'./storage.js';
import{listStoresRemote,saveStoresRemote}from'./api.js';
const STORE_KEY='spesaSmart.supermarkets.v1';
const OVERPASS=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
const BRANDS=['EUROSPIN','PENNY','LIDL','MD','CONAD','FAMILA','CARREFOUR','COOP','DESPAR','INTERSPAR','ALDI','SIGMA','DOK','TODIS','ARD DISCOUNT','MAXI SIDIS'];
const clean=v=>String(v||'').trim();
const idOf=e=>'osm-'+e.type+'-'+e.id;
function distanceKm(a,b,c,d){const r=6371,x=(c-a)*Math.PI/180,y=(d-b)*Math.PI/180,z=Math.sin(x/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(y/2)**2;return 2*r*Math.asin(Math.sqrt(z))}
function normalizeBrand(tags={}){const raw=clean(tags.brand||tags.name||tags.operator).toUpperCase();return BRANDS.find(b=>raw.includes(b))||clean(tags.brand||tags.name||tags.operator)||'Supermercato'}
function storeKey(s){const brand=clean(s.brand||s.name).toUpperCase().replace(/[^A-Z0-9]/g,'');const address=clean(s.address).toUpperCase().replace(/[^A-Z0-9]/g,'');const lat=Math.round(Number(s.lat)*10000),lon=Math.round(Number(s.lon)*10000);return address?`${brand}|${address}`:`${brand}|${lat}|${lon}`}
function dedupeStores(items){const map=new Map();for(const s of items){const k=storeKey(s),old=map.get(k);if(!old||Number(s.distance)<Number(old.distance))map.set(k,s)}return[...map.values()].sort((a,b)=>a.distance-b.distance)}
export function localStores(){return read(STORE_KEY,[])}
export function saveLocalStores(v){write(STORE_KEY,v)}
export async function nearbyStores(lat,lon,radiusKm=20){const radius=Math.max(1,Math.min(50,Number(radiusKm)||20))*1000;const q=`[out:json][timeout:30];(node[shop~"supermarket|discount|convenience"](around:${radius},${lat},${lon});way[shop~"supermarket|discount|convenience"](around:${radius},${lat},${lon});relation[shop~"supermarket|discount|convenience"](around:${radius},${lat},${lon}););out center tags;`;
 let last;for(const base of OVERPASS){try{const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:'data='+encodeURIComponent(q)});if(!r.ok)throw Error('HTTP '+r.status);const d=await r.json();return dedupeStores((d.elements||[]).map(e=>{const slat=e.lat??e.center?.lat,slon=e.lon??e.center?.lon,t=e.tags||{};return{id:idOf(e),name:clean(t.name)||normalizeBrand(t),brand:normalizeBrand(t),address:[t['addr:street'],t['addr:housenumber'],t['addr:city']].filter(Boolean).join(' '),lat:slat,lon:slon,distance:Number(distanceKm(lat,lon,slat,slon).toFixed(1)),selected:false}}).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon)))}catch(e){last=e}}throw Error('Ricerca supermercati non disponibile: '+(last?.message||'errore sconosciuto'))}
export async function loadStores(settings){if(settings.scriptUrl&&settings.familyCode){try{const remote=await listStoresRemote(settings);saveLocalStores(remote);return remote}catch(e){console.warn(e)}}return localStores()}
export async function persistStores(settings,stores){saveLocalStores(stores);if(settings.scriptUrl&&settings.familyCode)await saveStoresRemote(settings,stores);return stores}
export function mapsUrl(s){return`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.lat},${s.lon}`)}`}
