export const $=id=>document.getElementById(id);
export function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
export function money(v){return new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(Number(v))}
export function uid(){return crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(16).slice(2)}
