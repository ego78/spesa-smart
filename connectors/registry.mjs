export const CHAIN_REGISTRY = [
  { id:'penny', aliases:['PENNY'], name:'PENNY', flyerLandingUrl:'https://www.penny.it/offerte', scanner:'penny' },
  { id:'eurospin', aliases:['EUROSPIN'], name:'Eurospin', flyerLandingUrl:'https://www.eurospin.it/volantino/', scanner:'eurospin' },
  { id:'lidl', aliases:['LIDL'], name:'Lidl', flyerLandingUrl:'https://www.lidl.it/c/volantino/s10019218' },
  { id:'md', aliases:['MD','MD DISCOUNT'], name:'MD', flyerLandingUrl:'https://www.mdspa.it/volantino/' },
  { id:'conad', aliases:['CONAD','CONAD CITY','CONAD SUPERSTORE'], name:'Conad', flyerLandingUrl:'https://www.conad.it/volantini-e-offerte' },
  { id:'despar', aliases:['DESPAR','EUROSPAR','INTERSPAR'], name:'Despar / Eurospar / Interspar', flyerLandingUrl:'https://www.despar.it/it/volantini/' },
  { id:'famila', aliases:['FAMILA','EMISFERO'], name:'Famila', flyerLandingUrl:'https://www.famila.it/volantini' },
  { id:'coop', aliases:['COOP','IPERCOOP'], name:'Coop', flyerLandingUrl:'https://www.coop.it/volantini' },
  { id:'carrefour', aliases:['CARREFOUR'], name:'Carrefour', flyerLandingUrl:'https://www.carrefour.it/volantini.html' },
  { id:'aldi', aliases:['ALDI'], name:'ALDI', flyerLandingUrl:'https://www.aldi.it/it/offerte.html' },
  { id:'todis', aliases:['TODIS'], name:'Todis', flyerLandingUrl:'https://www.todis.it/volantino/' },
  { id:'doko', aliases:['DOK','A&O','FAMILA SUD'], name:'DOK', flyerLandingUrl:'https://www.doksupermercati.it/' }
];

export function chainFor(value=''){
  const text=String(value).trim().toUpperCase();
  return CHAIN_REGISTRY.find(c=>c.aliases.some(a=>text.includes(a)||a.includes(text)))||null;
}
