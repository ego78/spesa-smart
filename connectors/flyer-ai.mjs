import OpenAI, { toFile } from 'openai';

function cleanJson(text=''){
  const raw=String(text).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const start=raw.indexOf('['), end=raw.lastIndexOf(']');
  if(start<0||end<start) throw new Error('JSON offerte non trovato nella risposta AI');
  return JSON.parse(raw.slice(start,end+1));
}

export async function scanFlyerPdf(store, flyerUrl){
  if(!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY non configurata');
  const response=await fetch(flyerUrl,{headers:{'User-Agent':'Mozilla/5.0 SpesaSmart/2.1'}});
  if(!response.ok) throw new Error(`Download volantino HTTP ${response.status}`);
  const type=response.headers.get('content-type')||'';
  if(!type.includes('pdf')&&!String(flyerUrl).toLowerCase().includes('.pdf')) throw new Error('Il collegamento non sembra un PDF');
  const buffer=Buffer.from(await response.arrayBuffer());
  if(buffer.length>45*1024*1024) throw new Error('Volantino PDF troppo grande (massimo 45 MB)');

  const client=new OpenAI();
  const uploaded=await client.files.create({
    file: await toFile(buffer, `volantino-${store.id||'negozio'}.pdf`, {type:'application/pdf'}),
    purpose:'user_data'
  });
  try{
    const result=await client.responses.create({
      model: process.env.OPENAI_FLYER_MODEL||'gpt-5-mini',
      input:[{role:'user',content:[
        {type:'input_file',file_id:uploaded.id},
        {type:'input_text',text:`Estrai tutte le offerte alimentari e per la casa da questo volantino. Restituisci SOLO un array JSON valido. Ogni elemento deve avere: product, brand, format, price (numero in euro), oldPrice (numero o null), unitPrice (numero o null), unit, validFrom, validUntil, category. Non inventare dati illeggibili. Punto vendita: ${store.name||store.brand}, ${store.address||''}.`}
      ]}]
    });
    const rows=cleanJson(result.output_text);
    return rows.filter(x=>x&&x.product&&Number.isFinite(Number(x.price))).map(x=>({
      product:String(x.product).trim(), brand:String(x.brand||'').trim(), format:String(x.format||'').trim(),
      price:Number(x.price), oldPrice:x.oldPrice==null?null:Number(x.oldPrice), unitPrice:x.unitPrice==null?null:Number(x.unitPrice),
      unit:String(x.unit||''), validFrom:String(x.validFrom||''), validUntil:String(x.validUntil||''), category:String(x.category||''),
      store:store.brand||store.name||'Supermercato', sourceUrl:flyerUrl, source:'official-local-flyer-ai',
      localValidityVerified:true, flyerStoreId:store.id, flyerStoreName:store.name||store.brand||'', flyerAddress:store.address||''
    }));
  } finally {
    await client.files.delete(uploaded.id).catch(()=>{});
  }
}
