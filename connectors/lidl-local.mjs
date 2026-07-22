const LANDING_URL='https://www.lidl.it/c/volantino-lidl/s10018048';

function absolute(url){
  try{return new URL(url,LANDING_URL).href}catch{return ''}
}
function clean(value=''){
  return String(value).replaceAll('\\u002F','/').replaceAll('\\/','/').replaceAll('&amp;','&');
}
function candidateUrls(html){
  const text=clean(html);
  const found=new Set();
  const patterns=[
    /https?:\/\/www\.lidl\.it\/l\/it\/volantini\/[^"'<>\\s]+/gi,
    /\/l\/it\/volantini\/[^"'<>\\s]+/gi
  ];
  for(const pattern of patterns){
    for(const match of text.matchAll(pattern)){
      const url=absolute(match[0].replace(/[),.;]+$/,''));
      if(url)found.add(url);
    }
  }
  return [...found];
}
function score(url){
  const u=url.toLowerCase();
  let value=0;
  if(u.includes('volantino-settimanale'))value+=20;
  if(u.includes('/view/flyer'))value+=10;
  if(u.includes('-naz'))value+=8;
  if(u.includes('offerte-valide-dal-'))value+=6;
  if(u.includes('viaggi'))value-=50;
  return value;
}
function normalizeFlyerUrl(url){
  if(!url)return '';
  return url.replace(/\/view\/flyer(?:\/page\/\d+)?(?:[?#].*)?$/i,'/view/flyer/page/1');
}
function parseValidity(url){
  const m=String(url).match(/dal-(\d{2})-(\d{2})-al-(\d{2})-(\d{2})/i);
  if(!m)return {validFrom:'',validUntil:''};
  const year=new Date().getFullYear();
  return {validFrom:`${m[1]}.${m[2]}.${year}`,validUntil:`${m[3]}.${m[4]}.${year}`};
}

export async function resolveLidlFlyer(store={}){
  const response=await fetch(LANDING_URL,{headers:{'user-agent':'Mozilla/5.0 SpesaSmart/4.3','accept-language':'it-IT,it;q=0.9'}});
  if(!response.ok)throw new Error(`Lidl pagina volantini HTTP ${response.status}`);
  const html=await response.text();
  const urls=candidateUrls(html).sort((a,b)=>score(b)-score(a));
  const flyerUrl=normalizeFlyerUrl(urls[0]||'');
  if(!flyerUrl)throw new Error('Lidl: volantino settimanale non trovato nella pagina ufficiale');
  const validity=parseValidity(flyerUrl);
  return {
    chain:'Lidl',
    officialStoreId:String(store.officialStoreId||store.storeCode||'IT00812'),
    officialStoreAlias:'sava',
    flyerId:flyerUrl.split('/volantini/')[1]?.split('/view/')[0]||'',
    flyerUrl,
    sourceUrl:LANDING_URL,
    offerScope:'national-chain',
    localValidityVerified:false,
    connected:true,
    ...validity
  };
}
