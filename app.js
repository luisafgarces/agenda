/* =====================================================================
   Agenda compartida — app.js
   Hoy · Calendario · Tareas · Ideas · Áreas. Dos personas, cada cosa
   puede ser "Compartida" (la ven las dos) o "Solo para mí".
   Sin datos clínicos ni financieros. Todo el texto que viene de la base
   de datos se escapa antes de mostrarse.
   ===================================================================== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence,
         setPersistence, signInWithEmailAndPassword, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
         collection, doc, setDoc, deleteDoc, query, where, onSnapshot, terminate, clearIndexedDbPersistence }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

/* ---------- configuración ---------- */
// Estas llaves son públicas por diseño: la seguridad la ponen las reglas de Firestore (firestore.rules).
const firebaseConfig = {
  apiKey: "AIzaSyDSnhVY8cJc7MsXACyWHIwYvUvvDnphGvk",
  authDomain: "agenda-compartida-aff93.firebaseapp.com",
  projectId: "agenda-compartida-aff93",
  storageBucket: "agenda-compartida-aff93.firebasestorage.app",
  messagingSenderId: "56187117223",
  appId: "1:56187117223:web:d30e262eecbc398ac14582"
};
// El usuario escribe "mama" o "hijo"; internamente se convierte en un correo de mentira (no recibe correos).
const DOMINIO = '@agenda-compartida.app';
const VERSION = '1.1';
const fut = () => document.documentElement.getAttribute('data-estilo') === 'futbol';

const AREAS_DEF = [
  { id:'colegio',  nombre:'Colegio',  emoji:'🎒', color:'#2b7de9' },
  { id:'futbol',   nombre:'Fútbol',   emoji:'⚽', color:'#2e9e68' },
  { id:'casa',     nombre:'Casa',     emoji:'🏠', color:'#f2994a' },
  { id:'familia',  nombre:'Familia',  emoji:'💙', color:'#8e5de8' },
  { id:'personal', nombre:'Personal', emoji:'⭐', color:'#14a3b8' },
  { id:'emprende', nombre:'Emprendimiento', emoji:'🚀', color:'#d99a00' }
];
const COLORES = ['#2b7de9','#14a3b8','#2e9e68','#7cb342','#d99a00','#f2994a','#e5534b','#8e5de8','#5b7692'];
const REPS = [['','No se repite'],['diaria','Todos los días'],['laboral','De lunes a viernes'],['semanal','Cada semana'],['mensual','Cada mes'],['anual','Cada año']];
const DIAS_CORTO = ['dom','lun','mar','mié','jue','vie','sáb'];
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

/* ---------- utilidades ---------- */
const LS = {
  g:(k,d)=>{ try{ const v=localStorage.getItem(k); return v==null?d:v; }catch(e){ return d; } },
  s:(k,v)=>{ try{ localStorage.setItem(k,v); }catch(e){} }
};
const $ = (s,r=document)=>r.querySelector(s);
const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const p2 = n => String(n).padStart(2,'0');
const ymd = d => d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());
const pYMD = s => { const a=String(s).split('-'); return new Date(+a[0],+a[1]-1,+a[2]); };
const pDT = s => { const m=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(s||'')); return m ? new Date(+m[1],+m[2]-1,+m[3],+(m[4]||0),+(m[5]||0)) : new Date(NaN); };
const dtStr = d => ymd(d)+'T'+p2(d.getHours())+':'+p2(d.getMinutes());
const hoy = () => ymd(new Date());
const sumar = (s,n) => { const d=pYMD(s); d.setDate(d.getDate()+n); return ymd(d); };
const lunesDe = s => { const d=pYMD(s); d.setDate(d.getDate()-((d.getDay()+6)%7)); return ymd(d); };
const horaTxt = h => { if(!h) return ''; const a=h.split(':'), hh=+a[0]; return (hh%12===0?12:hh%12)+':'+a[1]+' '+(hh<12?'a. m.':'p. m.'); };
const horaDe = d => horaTxt(p2(d.getHours())+':'+p2(d.getMinutes()));
const diaCorto = s => { const d=pYMD(s); return DIAS_CORTO[d.getDay()]+' '+d.getDate()+' '+MESES[d.getMonth()].slice(0,3); };
const etiquetaDia = s => { const h=hoy(); return s===h?'Hoy':s===sumar(h,1)?'Mañana':s===sumar(h,-1)?'Ayer':diaCorto(s); };
const cap = s => s.charAt(0).toUpperCase()+s.slice(1);
const nuevoId = p => p+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const limpiarTxt = s => String(s||'').replace(/\s+/g,' ').trim();
const jsonSeguro = (s,d) => { try{ const v=JSON.parse(s); return v==null?d:v; }catch(e){ return d; } };

/* ---------- estado ---------- */
const S = {
  uid:null, miembros:{}, mine:new Map(), shared:new Map(), items:new Map(),
  areas:AREAS_DEF.map(a=>({...a})), appNombre:'Agenda', miembrosListos:false,
  tab:LS.g('ag_tab','hoy'),
  cal:{ vista:LS.g('ag_calvista', window.innerWidth>=900?'semana':'dia'), fecha:hoy(), quien:'todo', ocultas:new Set(jsonSeguro(LS.g('ag_ocultas','[]'),[])) },
  tr:{ vista:'pend', quien:'todo', area:'', verAtras:false, abiertas:{}, verMasHechas:false },
  qa:{ hoy:{fecha:'hoy'}, tareas:{fecha:'sin'}, area:LS.g('ag_qa_area',''), compartido:LS.g('ag_qa_comp','1')==='1' },
  ideaComp:LS.g('ag_idea_comp','0')==='1', verArch:false,
  online:navigator.onLine, foco:null, shell:false, errDatos:''
};

/* ---------- Firebase ---------- */
const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app, { persistence:[indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence] });
let db = null, desuscribir = [];

function iniciarDB(){
  if(db) return;
  const recordar = LS.g('ag_recordar','0')==='1';
  try {
    db = initializeFirestore(app, { localCache: recordar ? persistentLocalCache({ tabManager: persistentMultipleTabManager() }) : memoryLocalCache() });
  } catch(e){
    console.warn('[agenda] caché persistente no disponible, uso memoria', e);
    db = initializeFirestore(app, { localCache: memoryLocalCache() });
  }
}

/* ---------- personas ---------- */
const otroUid = () => Object.keys(S.miembros).find(u=>u!==S.uid) || null;
const nombreDe = uid => (S.miembros[uid] && S.miembros[uid].nombre) || (uid===S.uid ? 'Tú' : 'La otra persona');
const miNombre = () => (S.miembros[S.uid] && S.miembros[S.uid].nombre) || '';
const nombreOtro = () => { const o=otroUid(); return o ? nombreDe(o) : 'La otra persona'; };
const inicial = n => (String(n||'?').trim().charAt(0) || '?').toUpperCase();

/* ---------- acceso a los datos ---------- */
const todos = () => Array.from(S.items.values());
const tareas = () => todos().filter(i=>i.tipo==='tarea');
const eventos = () => todos().filter(i=>i.tipo==='evento');
const ideas = () => todos().filter(i=>i.tipo==='idea');
const porId = id => S.items.get(id);
const area = id => S.areas.find(a=>a.id===id) || { id:'', nombre:'Sin área', emoji:'•', color:'#5b7692' };
// ¿esta tarea es "para mí"? (la hice yo sin asignar, me la asignaron, o es para los dos)
const paraMi = t => t.para==='ambos' || t.para===S.uid || (!t.para && t.owner===S.uid);

function normalizarTarea(t){
  if(!Array.isArray(t.pasos)) t.pasos=[];
  if(t.fecha==null) t.fecha='';
  if(t.hora==null) t.hora='';
  t.prio = !!t.prio; t.hecha = !!t.hecha;
  return t;
}

function mezclar(){
  const m = new Map(S.shared);
  S.mine.forEach((v,k)=>m.set(k,v));
  S.items = m;
  refrescar();
}

function errorDatos(e){
  console.warn('[agenda] error de datos', e);
  S.errDatos = (e && e.code==='permission-denied')
    ? 'No tengo permiso para leer los datos. Si acabas de crear la agenda, publica las reglas de seguridad (archivo firestore.rules) y recarga.'
    : 'No pude leer los datos ahora mismo. Reviso de nuevo cuando vuelva la conexión.';
  refrescar();
}

function iniciarDatos(){
  const items = collection(db,'items');
  desuscribir.push(onSnapshot(query(items, where('owner','==',S.uid)), s=>{
    S.mine = new Map(s.docs.map(d=>[d.id,{...d.data(),id:d.id}])); S.errDatos=''; mezclar();
  }, errorDatos));
  desuscribir.push(onSnapshot(query(items, where('compartido','==',true)), s=>{
    S.shared = new Map(s.docs.map(d=>[d.id,{...d.data(),id:d.id}])); S.errDatos=''; mezclar();
  }, errorDatos));
  desuscribir.push(onSnapshot(collection(db,'miembros'), s=>{
    const m={}; s.docs.forEach(d=>{ m[d.id]=d.data(); }); S.miembros=m;
    S.miembrosListos = !s.metadata.fromCache || s.docs.length>0;
    if(S.miembrosListos && !m[S.uid]) pedirNombre();
    refrescar();
  }, errorDatos));
  desuscribir.push(onSnapshot(doc(db,'config','areas'), s=>{
    if(s.exists() && Array.isArray(s.data().lista) && s.data().lista.length) S.areas = s.data().lista;
    else { S.areas = AREAS_DEF.map(a=>({...a})); if(!s.metadata.fromCache) setDoc(doc(db,'config','areas'),{lista:S.areas}).catch(()=>{}); }
    refrescar();
  }, errorDatos));
  desuscribir.push(onSnapshot(doc(db,'config','app'), s=>{
    if(s.exists() && s.data().nombre) S.appNombre = String(s.data().nombre).slice(0,30);
    document.title = S.appNombre;
    const n=$('#app-nombre'); if(n) n.textContent = S.appNombre;
  }, ()=>{}));
}

/* ---------- guardar / borrar ---------- */
function limpiar(o){ const r={}; Object.keys(o).forEach(k=>{ if(k!=='id' && o[k]!==undefined) r[k]=o[k]; }); return r; }
function guardar(it){
  it.actualizado = new Date().toISOString();
  // optimista: lo vemos al instante aunque no haya conexión
  S.items.set(it.id, it); if(it.owner===S.uid) S.mine.set(it.id,it); if(it.compartido) S.shared.set(it.id,it); else S.shared.delete(it.id);
  return setDoc(doc(db,'items',it.id), limpiar(it)).catch(e=>{ console.warn('[agenda] no se pudo guardar',e); aviso('No se pudo guardar. Revisa tu conexión.'); });
}
function borrar(it){
  S.items.delete(it.id); S.mine.delete(it.id); S.shared.delete(it.id);
  return deleteDoc(doc(db,'items',it.id)).catch(e=>{ console.warn('[agenda] no se pudo borrar',e); aviso('No se pudo borrar.'); });
}
function nuevoItem(tipo, datos){
  const it = Object.assign({ id:nuevoId(tipo[0]), tipo, owner:S.uid, compartido:true, creado:new Date().toISOString() }, datos);
  return it;
}
function guardarAreas(lista){ S.areas=lista; setDoc(doc(db,'config','areas'),{lista}).catch(()=>aviso('No se pudo guardar las áreas.')); refrescar(); }

/* =====================================================================
   Avisos, ventanas, inicio de sesión y estructura
   ===================================================================== */
let snackT = null;
function snack(txt, undo, ms){
  const r = $('#snack-root'); if(!r) return;
  r.innerHTML = '';
  const d = document.createElement('div'); d.className = 'snack';
  const s = document.createElement('span'); s.textContent = txt; d.appendChild(s);
  if(undo){ const b = document.createElement('button'); b.type='button'; b.textContent='Deshacer'; b.onclick = ()=>{ clearTimeout(snackT); r.innerHTML=''; undo(); }; d.appendChild(b); }
  r.appendChild(d); clearTimeout(snackT); snackT = setTimeout(()=>{ r.innerHTML=''; }, ms||5000);
}
function aviso(t){ snack(t, null, 4000); }

function abrirSheet(html, mount, id, fijo){
  id = id || 'sheet-bg';
  const viejo = document.getElementById(id); if(viejo) viejo.remove();
  const bg = document.createElement('div'); bg.className = 'bg'; bg.id = id;
  if(id!=='sheet-bg') bg.style.zIndex = 120;
  bg.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">'+html+'</div>';
  if(!fijo) bg.addEventListener('pointerdown', e=>{ if(e.target===bg) bg.remove(); });
  $('#modal-root').appendChild(bg);
  const sh = $('.sheet', bg); if(mount) mount(sh);
  return sh;
}
function cerrarSheet(id){ const b = document.getElementById(id||'sheet-bg'); if(b) b.remove(); }

function confirmar(msg, okTxt){
  return new Promise(res=>{
    const sh = abrirSheet('<h2>'+esc(msg)+'</h2><div class="acts"><button class="btn" data-x="no">Cancelar</button><button class="btn btn-danger" data-x="si">'+esc(okTxt||'Sí, borrar')+'</button></div>', null, 'confirm-bg');
    sh.addEventListener('click', e=>{ const b = e.target.closest('[data-x]'); if(!b) return; cerrarSheet('confirm-bg'); res(b.dataset.x==='si'); });
  });
}

function pedirNombre(){
  if(document.getElementById('nombre-bg')) return;
  const sh = abrirSheet('<h2>¡Hola! ¿Cómo te llamas?</h2><p class="muted small" style="margin-bottom:12px">Así te va a ver la otra persona en lo que compartan.</p>'
    + '<div class="fld"><input id="nm" maxlength="24" autocomplete="off" placeholder="Tu nombre"></div>'
    + '<div class="acts"><button class="btn btn-primary" data-x="ok">Listo</button></div>', null, 'nombre-bg', true);
  const go = ()=>{
    const n = limpiarTxt($('#nm',sh).value).slice(0,24); if(!n){ $('#nm',sh).focus(); return; }
    S.miembros[S.uid] = { nombre:n };
    setDoc(doc(db,'miembros',S.uid), { nombre:n, creado:new Date().toISOString() }).catch(()=>aviso('No se pudo guardar tu nombre.'));
    cerrarSheet('nombre-bg'); refrescar();
  };
  sh.addEventListener('click', e=>{ if(e.target.closest('[data-x]')) go(); });
  sh.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); go(); } });
  setTimeout(()=>{ const i=$('#nm',sh); if(i) i.focus(); }, 60);
}

/* ---------- inicio de sesión ---------- */
function mensajeAuth(e){
  const c = (e && e.code) || '';
  if(['auth/invalid-credential','auth/wrong-password','auth/user-not-found','auth/invalid-email','auth/missing-password'].includes(c)) return 'Usuario o clave incorrectos.';
  if(c==='auth/too-many-requests') return 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
  if(c==='auth/network-request-failed') return 'No hay conexión a internet.';
  if(c==='auth/user-disabled') return 'Esta cuenta está desactivada.';
  return 'No pude entrar. Intenta de nuevo.';
}
function renderLogin(){
  $('#root').innerHTML =
    '<div class="login"><div class="login-card">'
    + '<div class="login-logo">📅</div><h1>'+esc(S.appNombre)+'</h1><p class="sub">Entra con tu usuario y tu clave.</p>'
    + '<form id="f-login" autocomplete="on">'
    + '<label class="f">Usuario<input id="lg-u" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next"></label>'
    + '<label class="f">Clave<input id="lg-p" name="password" type="password" autocomplete="current-password" enterkeyhint="go"></label>'
    + '<label class="recordar"><input type="checkbox" id="lg-r"'+(LS.g('ag_recordar','0')==='1'?' checked':'')+'><span>Es mi celular o mi computador: mantener la sesión abierta. No lo marques en un computador compartido, como el del colegio.</span></label>'
    + '<button class="btn btn-primary btn-block" type="submit" id="lg-go">Entrar</button>'
    + '<div class="err" id="lg-err" role="alert"></div></form></div></div>';
  const u = $('#lg-u'); if(u) u.focus();
}
async function entrar(ev){
  ev.preventDefault();
  const u = limpiarTxt($('#lg-u').value).toLowerCase().replace(/\s/g,''), p = $('#lg-p').value, rec = $('#lg-r').checked;
  const err = m => { $('#lg-err').textContent = m; };
  if(!u || !p){ err('Escribe tu usuario y tu clave.'); return; }
  const btn = $('#lg-go'); btn.disabled = true; btn.textContent = 'Entrando…'; err('');
  LS.s('ag_recordar', rec?'1':'0');            // se decide antes de abrir la base de datos
  try {
    await setPersistence(auth, rec ? browserLocalPersistence : browserSessionPersistence);
    await signInWithEmailAndPassword(auth, u.includes('@') ? u : u+DOMINIO, p);
  } catch(e){
    console.warn('[agenda] login', e && e.code);
    err(mensajeAuth(e)); const b=$('#lg-go'); if(b){ b.disabled=false; b.textContent='Entrar'; }
  }
}
function limpiarSesion(){
  desuscribir.forEach(f=>{ try{ f(); }catch(e){} }); desuscribir = [];
  S.mine = new Map(); S.shared = new Map(); S.items = new Map(); S.miembros = {}; S.shell = false;
  detenerFoco(true); cerrarSheet(); cerrarSheet('confirm-bg'); cerrarSheet('nombre-bg');
}
async function salir(){
  limpiarSesion();
  try{ await signOut(auth); }catch(e){}
  if(db){ try{ await terminate(db); await clearIndexedDbPersistence(db); }catch(e){} }
  location.reload();
}

/* ---------- estructura ---------- */
const tabsDef = () => fut()
  ? [['hoy','⚽','Hoy'],['cal','🏟️','Calendario'],['tareas','🥅','Tareas'],['ideas','📋','Jugadas'],['mas','⚙️','Más']]
  : [['hoy','☀️','Hoy'],['cal','📅','Calendario'],['tareas','✅','Tareas'],['ideas','💡','Ideas'],['mas','⚙️','Más']];
function montarShell(){
  $('#root').innerHTML =
    '<div id="app">'
    + '<header class="top"><div class="brand"><span class="ico"><img src="icon-192.png" alt=""></span><span class="n" id="app-nombre">'+esc(S.appNombre)+'</span></div>'
    + '<div class="top-r"><span class="sync" id="sync" title="Conectado"></span><button class="avatar" id="avatar" data-act="tab" data-v="mas" aria-label="Mi cuenta">?</button></div></header>'
    + '<main id="view"></main>'
    + '<button class="fab" id="fab" data-act="fab" aria-label="Agregar">+</button>'
    + '<nav class="tabs" id="tabs">'+tabsDef().map(t=>'<button class="tab" data-act="tab" data-v="'+t[0]+'"><span class="i">'+t[1]+'</span><span>'+t[2]+'</span></button>').join('')+'</nav>'
    + '</div>';
  S.shell = true; document.title = S.appNombre; refrescar(true);
}

let rafP = false, resetPend = false;
function refrescar(reset){
  if(reset) resetPend = true;
  if(!S.shell || rafP) return;
  rafP = true;
  requestAnimationFrame(()=>{ rafP = false; const r = resetPend; resetPend = false; try{ pintar(r); }catch(e){ console.error('[agenda] error al pintar', e); } });
}
function capturarCampos(root){
  const out = [];
  root.querySelectorAll('input[id],select[id],textarea[id]').forEach(el=>{
    out.push({ id:el.id, v:el.value, c:el.checked, f:document.activeElement===el, a:el.selectionStart, b:el.selectionEnd });
  });
  return out;
}
function restaurarCampos(root, lista){
  lista.forEach(o=>{
    const el = root.querySelector('#'+CSS.escape(o.id)); if(!el) return;
    if(el.type==='checkbox'){ el.checked = o.c; }
    else if(el.type!=='date' && el.tagName!=='SELECT'){ if(o.v!==el.value && o.v!=='') el.value = o.v; }
    if(o.f){ el.focus(); try{ if(o.a!=null && el.setSelectionRange) el.setSelectionRange(o.a,o.b); }catch(e){} }
  });
}
function pintar(reset){
  const v = $('#view'); if(!v) return;
  const av = $('#avatar'); if(av) av.textContent = inicial(miNombre() || '?');
  const sy = $('#sync'); if(sy){ sy.className = 'sync'+(S.online?'':' off'); sy.title = S.online ? 'Conectado' : 'Sin conexión: se guarda y se sincroniza después'; }
  document.querySelectorAll('#tabs .tab').forEach(b=>b.classList.toggle('on', b.dataset.v===S.tab));
  const guardados = capturarCampos(v);
  const sc = $('#cal-scroll'), pos = sc ? { t:sc.scrollTop, l:sc.scrollLeft } : null;
  const vistas = { hoy:vistaHoy, cal:vistaCal, tareas:vistaTareas, ideas:vistaIdeas, mas:vistaMas };
  v.className = S.tab==='cal' ? 'wide' : '';
  const aviso_ = S.errDatos ? '<div class="banner bad">'+esc(S.errDatos)+'</div>' : '';
  v.innerHTML = aviso_ + (vistas[S.tab]||vistaHoy)();
  restaurarCampos(v, guardados);
  if(S.tab==='cal') ajustarScrollCal(reset, pos);
  const fab = $('#fab'); if(fab) fab.hidden = (S.tab==='mas');
}

/* =====================================================================
   Piezas compartidas de tareas
   ===================================================================== */
function resolverFecha(c){ const h=hoy(); return c==='hoy'?h : c==='manana'?sumar(h,1) : c==='sin'?'' : (/^\d{4}-\d{2}-\d{2}$/.test(c)?c:''); }
function leerFechaEnTexto(txt){
  let m = /^(.*?)\s+(hoy|ma[ñn]ana|pasado ma[ñn]ana)\s*$/i.exec(txt), resto, pal;
  if(m){ resto = m[1]; pal = m[2]; }
  else { m = /^(hoy|ma[ñn]ana|pasado ma[ñn]ana)\s+(.+)$/i.exec(txt); if(m){ pal = m[1]; resto = m[2]; } }
  if(!m || !limpiarTxt(resto)) return { titulo:txt, fecha:null };
  pal = pal.toLowerCase().replace('ñ','n'); const h = hoy();
  return { titulo:limpiarTxt(resto), fecha: pal==='hoy' ? h : pal==='manana' ? sumar(h,1) : sumar(h,2) };
}
function siguienteFecha(t){
  const base = t.fecha || hoy();
  if(t.rep==='diaria') return sumar(base,1);
  if(t.rep==='laboral'){ let f=sumar(base,1); while([0,6].includes(pYMD(f).getDay())) f=sumar(f,1); return f; }
  if(t.rep==='semanal') return sumar(base,7);
  if(t.rep==='mensual'){ const d=pYMD(base), dia=d.getDate(); d.setDate(1); d.setMonth(d.getMonth()+1); d.setDate(Math.min(dia,new Date(d.getFullYear(),d.getMonth()+1,0).getDate())); return ymd(d); }
  if(t.rep==='anual'){ const d=pYMD(base); const n=new Date(d.getFullYear()+1,d.getMonth(),d.getDate()); return ymd(n); }
  return null;
}
function ordenT(a,b){
  if(a.prio!==b.prio) return a.prio ? -1 : 1;
  if((a.hora||'')!==(b.hora||'')){ if(!a.hora) return 1; if(!b.hora) return -1; return a.hora<b.hora?-1:1; }
  return String(a.creado||'').localeCompare(String(b.creado||''));
}
function quienOkTarea(t, f){ return f==='todo' || (f==='mio' ? paraMi(t) : !paraMi(t)); }
function quienOkEvento(e, f){ return f==='todo' || (f==='mio' ? e.owner===S.uid : e.owner!==S.uid); }

function filaTarea(t, o){
  o = o || {};
  const a = area(t.area), h = hoy(), ide = esc(t.id);
  const meta = [];
  meta.push('<span><span class="dot" style="background:'+esc(a.color)+'"></span> '+esc(a.emoji)+' '+esc(a.nombre)+'</span>');
  if(t.fecha && !o.sinFecha){ const late = !t.hecha && t.fecha<h; meta.push('<span class="'+(late?'late':'')+'">📅 '+esc(etiquetaDia(t.fecha))+(late?' · atrasada':'')+'</span>'); }
  if(t.hora) meta.push('<span>🕒 '+esc(horaTxt(t.hora))+'</span>');
  const np = t.pasos.length, nd = t.pasos.filter(p=>p.d).length;
  if(np) meta.push('<span>☑ '+nd+'/'+np+'</span>');
  if(t.rep) meta.push('<span title="Se repite">🔁</span>');
  if(t.notas) meta.push('<span>📝</span>');
  meta.push('<span title="'+(t.compartido?'Compartida':'Solo para mí')+'">'+(t.compartido?'👥':'🔒')+'</span>');
  if(t.owner!==S.uid) meta.push('<span class="av">de '+esc(nombreDe(t.owner))+'</span>');
  else if(t.para==='ambos') meta.push('<span class="av">para los dos</span>');
  else if(t.para && t.para!==S.uid) meta.push('<span class="av">para '+esc(nombreDe(t.para))+'</span>');
  let acts = '';
  if(!t.hecha){
    acts += '<button class="btn btn-sm btn-primary" data-act="empezar" data-id="'+ide+'">▶ Empezar</button>';
    if(np) acts += '<button class="btn btn-sm" data-act="pasos" data-id="'+ide+'">'+(S.tr.abiertas[t.id]?'▴':'▾')+' Pasos</button>';
    if(o.mover) acts += '<button class="btn btn-sm" data-act="mover" data-v="hoy" data-id="'+ide+'">Hoy</button><button class="btn btn-sm" data-act="mover" data-v="manana" data-id="'+ide+'">Mañana</button>';
  }
  let pasos = '';
  if(np && S.tr.abiertas[t.id]) pasos = '<div class="steps">'+t.pasos.map((p,i)=>'<label class="'+(p.d?'d':'')+'"><input type="checkbox" data-paso="'+i+'" data-id="'+ide+'"'+(p.d?' checked':'')+'><span>'+esc(p.t)+'</span></label>').join('')+'</div>';
  return '<div class="task'+(t.hecha?' done':'')+(o.big?' big':'')+'" data-id="'+ide+'">'
    + '<button class="chk" data-act="'+(t.hecha?'reabrir':'chk')+'" data-id="'+ide+'" aria-label="'+(t.hecha?'Volver a abrir':'Marcar como hecha')+'"></button>'
    + '<div class="t-main" data-act="edit-t" data-id="'+ide+'"><div class="t-tit">'+esc(t.titulo)+'</div><div class="t-meta">'+meta.join('')+'</div>'
    + (acts?'<div class="t-acts" data-stop="1">'+acts+'</div>':'')+pasos+'</div>'
    + (t.hecha ? '' : '<button class="star'+(t.prio?' on':'')+'" data-act="star" data-id="'+ide+'" aria-label="Importante">'+(t.prio?'★':'☆')+'</button>')
    + '</div>';
}

function qaHTML(k){
  const f = S.qa[k].fecha, h = hoy(), otra = !['hoy','manana','sin'].includes(f);
  const ar = S.areas.some(a=>a.id===S.qa.area) ? S.qa.area : (S.areas[0]||{}).id;
  const chip = (v,t)=>'<button type="button" class="chip'+(f===v?' on':'')+'" data-act="qa-fecha" data-k="'+k+'" data-v="'+v+'">'+t+'</button>';
  return '<form class="qa" data-qa="'+k+'"><div class="qa-row"><input type="text" id="qa-t-'+k+'" maxlength="200" placeholder="Escribe una tarea y Enter…" autocomplete="off" enterkeyhint="done"><button class="qa-go" type="submit" aria-label="Agregar tarea">+</button></div>'
    + '<div class="chips scroll">'+chip('hoy','Hoy')+chip('manana','Mañana')+chip('sin','Sin fecha')
    + '<label class="chip'+(otra?' on':'')+'">📅 <input type="date" id="qa-d-'+k+'" data-qa-date="'+k+'" min="'+h+'" value="'+(otra?esc(f):'')+'"></label>'
    + '<select id="qa-a-'+k+'" data-qa-area="1" aria-label="Área">'+S.areas.map(a=>'<option value="'+esc(a.id)+'"'+(a.id===ar?' selected':'')+'>'+esc(a.emoji)+' '+esc(a.nombre)+'</option>').join('')+'</select>'
    + '<button type="button" class="chip" data-act="qa-comp" title="Quién la ve">'+(S.qa.compartido?'👥 Compartida':'🔒 Solo yo')+'</button></div></form>';
}
function qaCrear(k){
  const inp = $('#qa-t-'+k); if(!inp) return;
  let txt = limpiarTxt(inp.value); if(!txt) return;
  let f = resolverFecha(S.qa[k].fecha); const r = leerFechaEnTexto(txt); if(r.fecha){ txt = r.titulo; f = r.fecha; }
  const sel = $('#qa-a-'+k); const ar = sel ? sel.value : (S.areas[0]||{}).id;
  S.qa.area = ar; LS.s('ag_qa_area', ar);
  const t = nuevoItem('tarea', { titulo:txt.slice(0,200), area:ar, fecha:f, hora:'', prio:false, notas:'', pasos:[], rep:'', hecha:false, compartido:S.qa.compartido, para:'' });
  guardar(t); inp.value = ''; refrescar();
  snack('Anotada ✓ → '+(f?etiquetaDia(f):'sin fecha'), ()=>{ borrar(t); refrescar(); }, 4000);
}

function completar(id){
  const t = porId(id); if(!t || t.hecha) return;
  const row = document.querySelector('.task[data-id="'+CSS.escape(id)+'"]');
  const fn = ()=>{
    t.hecha = true; t.hechaEn = new Date().toISOString();
    let sig = null;
    if(t.rep){
      const nf = siguienteFecha(t);
      if(nf){
        sig = nuevoItem('tarea', { titulo:t.titulo, area:t.area, fecha:nf, hora:t.hora||'', prio:t.prio, notas:t.notas||'', pasos:t.pasos.map(p=>({t:p.t,d:false})), rep:t.rep, hecha:false, compartido:t.compartido, para:t.para||t.owner });
        guardar(sig);
      }
    }
    guardar(t); refrescar();
    const frases = fut() ? ['¡GOOOL! ⚽','¡Golazo! 🔥','¡Al fondo de la red! 🥅','¡Qué jugada! 👏','¡Otro gol! ⚽'] : ['¡Hecha! 🎉','Una menos 💪','¡Bien hecho!','Lo lograste ✅','Eso cuenta 🌟'];
    snack(frases[Math.floor(Math.random()*frases.length)]+(sig?' · próxima: '+etiquetaDia(sig.fecha):''), ()=>{
      t.hecha = false; delete t.hechaEn; guardar(t); if(sig) borrar(sig); refrescar();
    }, 6000);
  };
  if(row){ row.classList.add('out'); setTimeout(fn, 230); } else fn();
}

/* =====================================================================
   HOY
   ===================================================================== */
function filaEvento(oc, ahora){
  const e = oc.it, a = area(e.area);
  const hora = oc.todoDia ? 'Todo el día' : horaDe(oc.ini)+' – '+horaDe(oc.fin);
  const pasado = !oc.todoDia && oc.fin<=ahora, ya = !oc.todoDia && oc.ini<=ahora && oc.fin>ahora;
  const sub = [];
  if(e.lugar) sub.push('📍 '+esc(e.lugar));
  sub.push(esc(a.emoji)+' '+esc(a.nombre));
  sub.push(e.compartido?'👥':'🔒');
  if(e.owner!==S.uid) sub.push('de '+esc(nombreDe(e.owner)));
  if(e.rep) sub.push('🔁');
  return '<div class="ev'+(pasado?' past':'')+(ya?' now':'')+'" style="border-left-color:'+esc(a.color)+'" data-act="edit-e" data-id="'+esc(e.id)+'"><div class="h">'+esc(hora)+'</div><div><div class="tt">'+(ya?'▶ ':'')+esc(e.titulo)+'</div><div class="sub">'+sub.join(' · ')+'</div></div></div>';
}
function vistaHoy(){
  const h = hoy(), ahora = new Date();
  const mias = tareas().filter(t=>!t.hecha && paraMi(t));
  const vencen = mias.filter(t=>t.fecha && t.fecha<=h);
  const atras = mias.filter(t=>t.fecha && t.fecha<h);
  const hechasHoy = tareas().filter(t=>t.hecha && paraMi(t) && t.hechaEn && ymd(new Date(t.hechaEn))===h);
  const imp = vencen.filter(t=>t.prio).sort(ordenT).slice(0,3);
  const resto = mias.filter(t=>t.fecha===h && !imp.includes(t)).sort(ordenT);
  const total = vencen.length + hechasHoy.length, pct = total ? Math.round(hechasHoy.length/total*100) : 0;
  const evs = ocurrenciasDia(h).sort((a,b)=> (a.todoDia===b.todoDia) ? a.ini-b.ini : (a.todoDia?-1:1));
  const otras = tareas().filter(t=>!t.hecha && !paraMi(t) && t.fecha && t.fecha<=h).sort(ordenT);
  const fh = cap(ahora.toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long'}));
  const nom = miNombre();
  let html = '<div class="h-page"><div><h1>Hola'+(nom?', '+esc(nom):'')+(fut()?' ⚽':' 👋')+'</h1><div class="sub">'+esc(fh)+'</div></div></div>';
  html += qaHTML('hoy');
  if(total) html += '<div class="prog"><div class="prog-t"><span>'+(fut()?'⚽ Goles de hoy':'Tu avance de hoy')+'</span><b>'+hechasHoy.length+' de '+total+'</b></div><div class="bar"><i style="width:'+pct+'%"></i></div></div>';
  if(atras.length){
    html += '<div class="banner warn">⏰ Tienes <b>'+atras.length+'</b> tarea'+(atras.length>1?'s':'')+' atrasada'+(atras.length>1?'s':'')
      + '<div class="row"><button class="btn btn-sm" data-act="atras-ver">'+(S.tr.verAtras?'Ocultar':'Verlas')+'</button><button class="btn btn-sm" data-act="atras-hoy">Pasarlas a hoy</button></div></div>';
    if(S.tr.verAtras) html += atras.sort(ordenT).map(t=>filaTarea(t,{mover:true})).join('');
  }
  if(vencen.length) html += '<button class="btn btn-primary btn-block" data-act="empezar-mejor" style="margin-bottom:6px">'+(fut()?'⚽ Patear una tarea':'🎯 Empezar con una tarea')+'</button>';
  if(imp.length) html += '<div class="sec"><span>⭐ Lo más importante</span></div>'+imp.map(t=>filaTarea(t,{big:true})).join('');
  html += '<div class="sec"><span>📅 Eventos de hoy</span><button class="link" data-act="ir-cal">Ver calendario</button></div>';
  html += evs.length ? evs.map(oc=>filaEvento(oc,ahora)).join('') : '<div class="empty"><b>Sin eventos hoy</b>Lo que agendes aparece aquí.</div>';
  html += '<div class="sec"><span>✅ Para hoy</span></div>';
  html += resto.length ? resto.map(t=>filaTarea(t)).join('') : (imp.length||atras.length ? '<div class="empty">'+(fut()?'Sin más jugadas por hoy. 🏁':'Nada más para hoy.')+'</div>' : '<div class="empty"><b>'+(fut()?'Cancha libre hoy 🏟️':'Hoy está libre 🎉')+'</b>Escribe arriba lo que quieras hacer hoy.</div>');
  if(hechasHoy.length) html += '<details style="margin-top:10px"><summary class="link">Hechas hoy ('+hechasHoy.length+')</summary>'+hechasHoy.map(t=>filaTarea(t,{sinFecha:true})).join('')+'</details>';
  if(otras.length) html += '<details style="margin-top:10px"><summary class="link">De '+esc(nombreOtro())+' para hoy ('+otras.length+')</summary>'+otras.map(t=>filaTarea(t)).join('')+'</details>';
  return html;
}

/* =====================================================================
   TAREAS
   ===================================================================== */
function chipsQuien(valor, act, esTarea){
  const o = nombreOtro();
  const c = (v,t)=>'<button class="chip'+(valor===v?' on':'')+'" data-act="'+act+'" data-v="'+v+'">'+t+'</button>';
  return c('todo','Todo')+c('mio',esTarea?'Mías':'Míos')+c('otro',(esTarea?'De ':'De ')+esc(o));
}
function chipsArea(valor, act){
  return '<button class="chip'+(!valor?' on':'')+'" data-act="'+act+'" data-v="">Todas</button>'
    + S.areas.map(a=>'<button class="chip'+(valor===a.id?' on':'')+'" data-act="'+act+'" data-v="'+esc(a.id)+'"><span class="dot" style="background:'+esc(a.color)+'"></span>'+esc(a.nombre)+'</button>').join('');
}
function vistaTareas(){
  const h = hoy(), q = S.tr;
  const base = tareas().filter(t=>quienOkTarea(t,q.quien) && (!q.area || t.area===q.area));
  const pend = base.filter(t=>!t.hecha), hec = base.filter(t=>t.hecha);
  let html = '<div class="h-page"><div><h1>✅ Tareas</h1></div><button class="btn btn-sm btn-primary" data-act="empezar-mejor">🎯 Empezar</button></div>';
  html += qaHTML('tareas');
  html += '<div class="seg" style="margin-bottom:10px"><button class="'+(q.vista==='pend'?'on':'')+'" data-act="tr-vista" data-v="pend">Pendientes '+pend.length+'</button><button class="'+(q.vista==='hechas'?'on':'')+'" data-act="tr-vista" data-v="hechas">Hechas '+hec.length+'</button></div>';
  html += '<div class="chips scroll" style="margin-bottom:6px">'+chipsQuien(q.quien,'tr-quien',true)+'</div>';
  html += '<div class="chips scroll" style="margin-bottom:10px">'+chipsArea(q.area,'tr-area')+'</div>';
  if(q.vista==='pend'){
    if(!pend.length) return html + '<div class="empty"><b>Nada pendiente ✨</b>Cuando anotes una tarea aparece aquí.</div>';
    const m1 = sumar(h,1);
    const g = { atras:[], hoy:[], man:[], prox:[], sin:[] };
    pend.forEach(t=>{ if(!t.fecha) g.sin.push(t); else if(t.fecha<h) g.atras.push(t); else if(t.fecha===h) g.hoy.push(t); else if(t.fecha===m1) g.man.push(t); else g.prox.push(t); });
    const sec = (tit,arr,o)=> arr.length ? '<div class="sec"><span>'+tit+' · '+arr.length+'</span></div>'+arr.map(t=>filaTarea(t,o)).join('') : '';
    html += sec('⏰ Atrasadas', g.atras.sort((a,b)=>a.fecha<b.fecha?-1:1), {mover:true});
    html += sec('☀️ Hoy', g.hoy.sort(ordenT), {sinFecha:true});
    html += sec('Mañana', g.man.sort(ordenT), {sinFecha:true});
    html += sec('📅 Próximas', g.prox.sort((a,b)=>a.fecha<b.fecha?-1:a.fecha>b.fecha?1:ordenT(a,b)));
    html += sec('Sin fecha', g.sin.sort(ordenT), {mover:true});
    return html;
  }
  const lim = sumar(h,-30);
  const rec = hec.filter(t=>t.hechaEn && ymd(new Date(t.hechaEn))>=lim).sort((a,b)=>String(b.hechaEn).localeCompare(String(a.hechaEn)));
  if(!rec.length) return html + '<div class="empty"><b>Aún no hay tareas hechas</b>Cada ✓ cuenta. Aquí verás lo que ya lograste.</div>';
  let ult = '';
  rec.forEach(t=>{ const d = ymd(new Date(t.hechaEn)); if(d!==ult){ ult = d; html += '<div class="sec"><span>'+esc(etiquetaDia(d))+'</span></div>'; } html += filaTarea(t,{sinFecha:true}); });
  return html;
}

/* =====================================================================
   CALENDARIO
   ===================================================================== */
const HH = 56;   // alto de una hora en la cuadrícula (px); debe coincidir con --hh en app.css

// Devuelve la ocurrencia de un evento que cae en el día [D0, D1) o null.
function ocEnDia(it, D0, D1, dia){
  const b = pDT(it.inicio); if(isNaN(b)) return null;
  const todo = !!it.todoDia;
  let dur;
  if(todo){ const f = it.fin ? pDT(it.fin) : b; dur = Math.max(0, pYMD(ymd(f)) - pYMD(ymd(b))); }
  else { const f = it.fin ? pDT(it.fin) : null; dur = (f && f>b) ? f-b : 3600000; }
  if(!it.rep){
    const fin = todo ? new Date(pYMD(ymd(b)).getTime()+dur+86400000) : new Date(b.getTime()+dur);
    return (b<D1 && fin>D0) ? { it, ini:b, fin, todoDia:todo } : null;
  }
  if(dia < ymd(b)) return null;
  if(it.repHasta && dia > it.repHasta) return null;
  const dow = D0.getDay(); let ok = false;
  switch(it.rep){
    case 'diaria':  ok = true; break;
    case 'laboral': ok = dow>=1 && dow<=5; break;
    case 'semanal': ok = dow===b.getDay(); break;
    case 'mensual': ok = D0.getDate()===b.getDate(); break;
    case 'anual':   ok = D0.getDate()===b.getDate() && D0.getMonth()===b.getMonth(); break;
  }
  if(!ok) return null;
  const ini = new Date(D0.getFullYear(), D0.getMonth(), D0.getDate(), b.getHours(), b.getMinutes());
  const fin = todo ? new Date(D1) : new Date(ini.getTime()+dur);
  return { it, ini, fin, todoDia:todo };
}
function ocurrenciasDia(dia, filtrar){
  const D0 = pYMD(dia), D1 = new Date(D0); D1.setDate(D1.getDate()+1);
  const out = [];
  eventos().forEach(it=>{
    if(!it.inicio) return;
    if(filtrar && (S.cal.ocultas.has(it.area||'') || !quienOkEvento(it, S.cal.quien))) return;
    const oc = ocEnDia(it, D0, D1, dia); if(oc) out.push(oc);
  });
  return out;
}
function diasVista(){
  const f = S.cal.fecha;
  if(S.cal.vista==='dia') return [f];
  const l = lunesDe(f); return [0,1,2,3,4,5,6].map(i=>sumar(l,i));
}
function tituloCal(){
  const f = S.cal.fecha, d = pYMD(f);
  if(S.cal.vista==='dia') return cap(d.toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long'}));
  if(S.cal.vista==='mes') return cap(MESES[d.getMonth()])+' '+d.getFullYear();
  const l = pYMD(lunesDe(f)), r = new Date(l); r.setDate(r.getDate()+6);
  return l.getDate()+(l.getMonth()!==r.getMonth() ? ' '+MESES[l.getMonth()].slice(0,3) : '')+' – '+r.getDate()+' '+MESES[r.getMonth()].slice(0,3)+' '+r.getFullYear();
}
// reparte los eventos que se cruzan en columnas
function colocar(ocs, D0){
  const items = ocs.map(o=>{ const s = Math.max(0,(o.ini-D0)/60000), e = Math.min(1440,(o.fin-D0)/60000); return { o, s, e:Math.max(e, s+28) }; })
    .sort((a,b)=>a.s-b.s || b.e-a.e);
  const out = []; let grupo = [], fin = -1;
  const cerrar = ()=>{
    if(!grupo.length) return; const cols = [];
    grupo.forEach(it=>{ let c = cols.findIndex(x=>x<=it.s); if(c<0){ c = cols.length; cols.push(0); } cols[c] = it.e; it.col = c; });
    grupo.forEach(it=>{ it.n = cols.length; out.push(it); }); grupo = [];
  };
  items.forEach(it=>{ if(grupo.length && it.s>=fin){ cerrar(); fin = -1; } grupo.push(it); fin = Math.max(fin, it.e); });
  cerrar(); return out;
}
function vistaCal(){
  const c = S.cal, h = hoy();
  let html = '<div class="cal-bar"><button class="btn btn-sm" data-act="cal-prev" aria-label="Anterior">‹</button><button class="btn btn-sm" data-act="cal-hoy">Hoy</button><button class="btn btn-sm" data-act="cal-next" aria-label="Siguiente">›</button><div class="ttl">'+esc(tituloCal())+'</div></div>';
  html += '<div class="seg" style="margin-bottom:10px;max-width:360px"><button class="'+(c.vista==='dia'?'on':'')+'" data-act="cal-vista" data-v="dia">Día</button><button class="'+(c.vista==='semana'?'on':'')+'" data-act="cal-vista" data-v="semana">Semana</button><button class="'+(c.vista==='mes'?'on':'')+'" data-act="cal-vista" data-v="mes">Mes</button></div>';
  html += '<div class="cal-filters"><div class="chips scroll" style="margin-bottom:6px">'+chipsQuien(c.quien,'cal-quien',false)+'</div>'
    + '<div class="chips scroll">'+S.areas.map(a=>'<button class="chip'+(c.ocultas.has(a.id)?'':' on')+'" data-act="cal-area-t" data-v="'+esc(a.id)+'" style="'+(c.ocultas.has(a.id)?'':'background:'+esc(a.color)+';border-color:'+esc(a.color)+';color:#fff')+'">'+esc(a.emoji)+' '+esc(a.nombre)+'</button>').join('')+'</div></div>';
  if(c.vista==='mes') return html + vistaMes(h);
  const dias = diasVista(), n = dias.length, cw = n===1 ? 200 : 92;
  const nowMin = new Date().getHours()*60 + new Date().getMinutes();
  const porDia = dias.map(d=>ocurrenciasDia(d,true));
  const hayAd = porDia.some(l=>l.some(o=>o.todoDia));
  let head = '<div class="cal-g" style="--n:'+n+';--cw:'+cw+'px"><div class="cal-corner"></div>'+dias.map(d=>{
    const dd = pYMD(d); return '<div class="cal-dh'+(d===h?' hoy':'')+'" data-act="cal-dia" data-v="'+d+'">'+DIAS_CORTO[dd.getDay()]+'<b>'+dd.getDate()+'</b></div>';
  }).join('')+'</div>';
  if(hayAd) head += '<div class="cal-g" style="--n:'+n+';--cw:'+cw+'px"><div class="cal-adl">todo el día</div>'+porDia.map(l=>'<div class="cal-ad">'+l.filter(o=>o.todoDia).map(o=>'<div class="chipad" data-act="edit-e" data-id="'+esc(o.it.id)+'" style="background:'+esc(area(o.it.area).color)+'">'+(o.it.compartido?'':'🔒 ')+esc(o.it.titulo)+'</div>').join('')+'</div>').join('')+'</div>';
  let horas = '<div class="cal-hours">'; for(let i=0;i<24;i++) horas += '<div>'+(i===0?'':((i%12===0?12:i%12)+(i<12?' am':' pm')))+'</div>'; horas += '</div>';
  const cols = dias.map((d,i)=>{
    const D0 = pYMD(d);
    const evs = colocar(porDia[i].filter(o=>!o.todoDia), D0).map(it=>{
      const o = it.o, a = area(o.it.area), top = it.s/60*HH, alto = Math.max(22,(it.e-it.s)/60*HH-2);
      const txt = '<b>'+(o.it.compartido?'':'🔒 ')+esc(o.it.titulo)+'</b>'+(alto>=42 ? esc(horaDe(o.ini))+(o.it.lugar?' · '+esc(o.it.lugar):'') : '');
      return '<div class="cal-ev'+(o.it.compartido?'':' priv')+'" data-act="edit-e" data-id="'+esc(o.it.id)+'" style="top:'+top+'px;height:'+alto+'px;left:calc('+(it.col/it.n*100)+'% + 1px);width:calc('+(100/it.n)+'% - 3px);background:'+esc(a.color)+'" title="'+esc(o.it.titulo)+'">'+txt+'</div>';
    }).join('');
    const ahora = d===h ? '<div class="cal-now" style="top:'+(nowMin/60*HH)+'px"></div>' : '';
    return '<div class="cal-col" data-dia="'+d+'">'+evs+ahora+'</div>';
  }).join('');
  html += '<div class="cal-scroll" id="cal-scroll"><div class="cal-in"><div class="cal-sticky">'+head+'</div><div class="cal-g" style="--n:'+n+';--cw:'+cw+'px">'+horas+cols+'</div></div></div>';
  html += '<p class="muted small" style="margin-top:8px">Toca un espacio vacío para agendar. Las franjas rayadas con 🔒 son solo tuyas.</p>';
  return html;
}
function vistaMes(h){
  const f = pYMD(S.cal.fecha), mes = f.getMonth();
  const ini = lunesDe(ymd(new Date(f.getFullYear(), mes, 1)));
  let html = '<div class="mes"><div class="mes-h">'+['lun','mar','mié','jue','vie','sáb','dom'].map(x=>'<div>'+x+'</div>').join('')+'</div><div class="mes-g">';
  for(let i=0;i<42;i++){
    const d = sumar(ini,i), dd = pYMD(d);
    const evs = ocurrenciasDia(d,true).sort((a,b)=>(a.todoDia===b.todoDia)?a.ini-b.ini:(a.todoDia?-1:1));
    const vis = evs.slice(0,3), mas = evs.length-vis.length;
    html += '<div class="mes-c'+(dd.getMonth()!==mes?' otro':'')+(d===h?' hoy':'')+'" data-act="cal-dia" data-v="'+d+'"><span class="n">'+dd.getDate()+'</span>'
      + vis.map(o=>'<div class="m" style="background:'+esc(area(o.it.area).color)+'">'+(o.it.compartido?'':'🔒')+esc(o.it.titulo)+'</div>').join('')
      + (mas>0?'<div class="mas">+'+mas+' más</div>':'')+'</div>';
    if(i===34 && pYMD(sumar(ini,35)).getMonth()!==mes){ break; }   // si la 6ª semana ya es otro mes, no la mostramos
  }
  return html + '</div></div>';
}
function ajustarScrollCal(reset, pos){
  const sc = $('#cal-scroll'); if(!sc) return;
  if(reset || !pos){
    const hr = diasVista().includes(hoy()) ? Math.max(0, new Date().getHours()-1) : 7;
    sc.scrollTop = hr*HH; sc.scrollLeft = 0;
  } else { sc.scrollTop = pos.t; sc.scrollLeft = pos.l; }
}
function moverCal(dir){
  const c = S.cal;
  if(c.vista==='dia') c.fecha = sumar(c.fecha, dir);
  else if(c.vista==='semana') c.fecha = sumar(c.fecha, 7*dir);
  else { const d = pYMD(c.fecha); c.fecha = ymd(new Date(d.getFullYear(), d.getMonth()+dir, 1)); }
  refrescar(true);
}

/* =====================================================================
   Editor de EVENTOS
   ===================================================================== */
const areaOpciones = sel => S.areas.map(a=>'<option value="'+esc(a.id)+'"'+(a.id===sel?' selected':'')+'>'+esc(a.emoji)+' '+esc(a.nombre)+'</option>').join('');
const repOpciones = sel => REPS.map(r=>'<option value="'+r[0]+'"'+(r[0]===(sel||'')?' selected':'')+'>'+r[1]+'</option>').join('');
const sumarMin = (hm, n) => { const a = hm.split(':'); const t = Math.min(23*60+59, (+a[0])*60+(+a[1])+n); return p2(Math.floor(t/60))+':'+p2(t%60); };
function proximaHora(dia){
  const n = new Date(); if(dia===hoy()){ const h = Math.min(22, n.getHours()+1); return p2(h)+':00'; } return '08:00';
}
function segComp(valor){
  return '<div class="seg" id="seg-comp"><button type="button" class="'+(valor?'on':'')+'" data-x="comp" data-v="1">👥 Compartido</button><button type="button" class="'+(valor?'':'on')+'" data-x="comp" data-v="0">🔒 Solo yo</button></div>'
    + '<p class="muted small" id="comp-txt" style="margin-top:6px">'+(valor?'Lo ven los dos.':'Solo lo ves tú en la app.')+'</p>';
}
function ligarSegComp(sh, inicial_){
  let v = inicial_;
  sh.addEventListener('click', e=>{
    const b = e.target.closest('[data-x="comp"]'); if(!b) return;
    v = b.dataset.v==='1';
    sh.querySelectorAll('#seg-comp button').forEach(x=>x.classList.toggle('on', (x.dataset.v==='1')===v));
    const t = $('#comp-txt',sh); if(t) t.textContent = v ? 'Lo ven los dos.' : 'Solo lo ves tú en la app.';
    const sel = $('#tk-para',sh); if(sel) sel.closest('.fld').hidden = !v;
  });
  return ()=>v;
}
function abrirEvento(id, preset){
  const e = id ? porId(id) : null;
  if(id && !e) return;
  const mio = !e || e.owner===S.uid;
  preset = preset || {};
  let dia, h1, h2, dia2, td = false;
  if(e){
    const i = pDT(e.inicio), f = e.fin ? pDT(e.fin) : new Date(i.getTime()+3600000);
    td = !!e.todoDia; dia = ymd(i); dia2 = ymd(f); h1 = p2(i.getHours())+':'+p2(i.getMinutes()); h2 = p2(f.getHours())+':'+p2(f.getMinutes());
    if(!td && (ymd(f)!==dia || h2<=h1)) h2 = sumarMin(h1,60);
  } else { dia = preset.dia || (S.tab==='cal' ? S.cal.fecha : hoy()); dia2 = dia; h1 = preset.hora || proximaHora(dia); h2 = sumarMin(h1,60); }
  const arSel = e ? e.area : (S.areas.some(a=>a.id===S.qa.area) ? S.qa.area : (S.areas[0]||{}).id);
  const html = '<h2>'+(e?'Editar evento':'Nuevo evento')+'</h2>'
    + (e && !mio ? '<div class="nota-dueno">Lo creó '+esc(nombreDe(e.owner))+'. Puedes cambiarlo, pero solo '+esc(nombreDe(e.owner))+' puede borrarlo.</div>' : '')
    + '<div class="fld"><label for="ev-t">¿Qué es?</label><input id="ev-t" maxlength="120" autocomplete="off" placeholder="Ej.: Entrenamiento de fútbol" value="'+esc(e?e.titulo:(preset.titulo||''))+'"></div>'
    + '<div class="fld"><label style="display:flex;gap:10px;align-items:center;text-transform:none;letter-spacing:0;font-size:.95rem;color:var(--ink);font-weight:600"><input type="checkbox" id="ev-td"'+(td?' checked':'')+'> Todo el día</label></div>'
    + '<div class="grid2"><div class="fld"><label for="ev-d" id="ev-dl">'+(td?'Desde':'Día')+'</label><input type="date" id="ev-d" value="'+esc(dia)+'"></div>'
    + '<div class="fld" id="g-d2"'+(td?'':' hidden')+'><label for="ev-d2">Hasta</label><input type="date" id="ev-d2" value="'+esc(dia2)+'"></div></div>'
    + '<div class="grid2" id="g-h"'+(td?' hidden':'')+'><div class="fld"><label for="ev-h1">Desde</label><input type="time" id="ev-h1" value="'+esc(h1)+'"></div><div class="fld"><label for="ev-h2">Hasta</label><input type="time" id="ev-h2" value="'+esc(h2)+'"></div></div>'
    + '<div class="grid2"><div class="fld"><label for="ev-a">Área</label><select id="ev-a">'+areaOpciones(arSel)+'</select></div><div class="fld"><label for="ev-l">Lugar (opcional)</label><input id="ev-l" maxlength="80" value="'+esc(e?e.lugar||'':'')+'"></div></div>'
    + '<div class="grid2"><div class="fld"><label for="ev-r">Repetir</label><select id="ev-r">'+repOpciones(e?e.rep:'')+'</select></div><div class="fld" id="g-rh"'+((e&&e.rep)?'':' hidden')+'><label for="ev-rh">Hasta el (opcional)</label><input type="date" id="ev-rh" value="'+esc(e&&e.repHasta?e.repHasta:'')+'"></div></div>'
    + '<div class="fld"><label for="ev-n">Notas (opcional)</label><textarea id="ev-n" maxlength="500">'+esc(e?e.notas||'':'')+'</textarea></div>'
    + (mio ? '<div class="fld"><label>¿Quién lo ve?</label>'+segComp(e ? !!e.compartido : true)+'</div>' : '<p class="muted small">'+(e.compartido?'👥 Compartido':'🔒 Solo yo')+'</p>')
    + '<div class="err" id="ev-err" role="alert"></div>'
    + '<div class="acts">'+(e && mio ? '<button class="btn btn-danger spacer" data-x="del">Borrar</button>' : '')+'<button class="btn" data-x="cancel">Cancelar</button><button class="btn btn-primary" data-x="save">Guardar</button></div>';
  const sh = abrirSheet(html);
  const getComp = mio ? ligarSegComp(sh, e ? !!e.compartido : true) : (()=>e.compartido);
  let h2Manual = !!e;
  $('#ev-h2',sh).addEventListener('input', ()=>{ h2Manual = true; });
  $('#ev-h1',sh).addEventListener('change', ()=>{ if(!h2Manual) $('#ev-h2',sh).value = sumarMin($('#ev-h1',sh).value||'08:00', 60); });
  $('#ev-td',sh).addEventListener('change', ev=>{
    const t = ev.target.checked; $('#g-d2',sh).hidden = !t; $('#g-h',sh).hidden = t; $('#ev-dl',sh).textContent = t ? 'Desde' : 'Día';
    if(t && !$('#ev-d2',sh).value) $('#ev-d2',sh).value = $('#ev-d',sh).value;
  });
  $('#ev-r',sh).addEventListener('change', ev=>{ $('#g-rh',sh).hidden = !ev.target.value; });
  sh.addEventListener('click', async ev=>{
    const b = ev.target.closest('[data-x]'); if(!b) return;
    const x = b.dataset.x, err = m=>{ $('#ev-err',sh).textContent = m; };
    if(x==='cancel') cerrarSheet();
    else if(x==='del'){
      if(await confirmar('¿Borrar este evento'+(e.rep?' y todas sus repeticiones':'')+'?')){
        const copia = {...e}; borrar(e); cerrarSheet(); refrescar(); snack('Evento borrado', ()=>{ guardar(copia); refrescar(); }, 6000);
      }
    }
    else if(x==='save'){
      const tit = limpiarTxt($('#ev-t',sh).value); if(!tit){ err('Ponle un nombre al evento.'); return; }
      const td2 = $('#ev-td',sh).checked, d1 = $('#ev-d',sh).value; if(!d1){ err('Elige el día.'); return; }
      let inicio, fin;
      if(td2){ let d2 = $('#ev-d2',sh).value || d1; if(d2<d1) d2 = d1; inicio = d1+'T00:00'; fin = d2+'T00:00'; }
      else {
        const a = $('#ev-h1',sh).value, c = $('#ev-h2',sh).value;
        if(!a || !c){ err('Completa las horas.'); return; }
        if(c<=a){ err('La hora final debe ser después de la inicial.'); return; }
        inicio = d1+'T'+a; fin = d1+'T'+c;
      }
      const rep = $('#ev-r',sh).value; let repHasta = rep ? ($('#ev-rh',sh).value||'') : ''; if(repHasta && repHasta<d1) repHasta = '';
      const datos = { titulo:tit.slice(0,120), inicio, fin, todoDia:td2, area:$('#ev-a',sh).value, lugar:limpiarTxt($('#ev-l',sh).value).slice(0,80), rep, repHasta, notas:$('#ev-n',sh).value.trim().slice(0,500) };
      let it;
      if(e){ it = Object.assign(e, datos); if(mio) it.compartido = getComp(); }
      else { it = nuevoItem('evento', Object.assign(datos, { compartido:getComp() })); }
      S.qa.area = datos.area; LS.s('ag_qa_area', datos.area);
      guardar(it); cerrarSheet();
      if(!(e && S.tab==='cal')){ S.cal.fecha = d1; }
      refrescar(); snack(e?'Evento guardado ✓':'Evento agendado ✓', null, 2500);
    }
  });
  setTimeout(()=>{ if(!e){ const t = $('#ev-t',sh); if(t) t.focus(); } }, 80);
}

/* =====================================================================
   Editor de TAREAS
   ===================================================================== */
function pasoFila(p){
  return '<div class="paso"><input type="checkbox" class="paso-d"'+(p&&p.d?' checked':'')+' aria-label="Hecho"><input type="text" class="paso-t" maxlength="120" placeholder="Paso…" value="'+esc(p?p.t:'')+'"><button type="button" class="btn btn-sm btn-ghost" data-x="del-paso" aria-label="Quitar paso">✕</button></div>';
}
function abrirTarea(id){
  const t = id ? porId(id) : null;
  if(id && !t) return;
  const mio = !t || t.owner===S.uid;
  const f0 = t ? t.fecha : '';
  const otro = otroUid();
  const parVal = t ? (t.para || t.owner) : S.uid;
  const paraOpc = [[S.uid,'Yo']].concat(otro ? [[otro, nombreDe(otro)]] : []).concat(otro ? [['ambos','Los dos']] : []);
  const compIni = t ? !!t.compartido : S.qa.compartido;
  const html = '<h2>'+(t?'Editar tarea':'Nueva tarea')+'</h2>'
    + (t && !mio ? '<div class="nota-dueno">La creó '+esc(nombreDe(t.owner))+'. Puedes cambiarla o marcarla como hecha, pero solo '+esc(nombreDe(t.owner))+' puede borrarla.</div>' : '')
    + '<div class="fld"><label for="tk-t">¿Qué hay que hacer?</label><input id="tk-t" maxlength="200" autocomplete="off" placeholder="Ej.: Hacer la tarea de ciencias" value="'+esc(t?t.titulo:'')+'"></div>'
    + '<div class="grid2"><div class="fld"><label for="tk-a">Área</label><select id="tk-a">'+areaOpciones(t?t.area:(S.areas.some(a=>a.id===S.qa.area)?S.qa.area:(S.areas[0]||{}).id))+'</select></div>'
    + '<div class="fld"><label for="tk-h">Hora (opcional)</label><input type="time" id="tk-h" value="'+esc(t?t.hora||'':'')+'"></div></div>'
    + '<div class="fld"><label>¿Para cuándo?</label><div class="chips" style="margin-bottom:8px"><button type="button" class="chip" data-x="f" data-v="hoy">Hoy</button><button type="button" class="chip" data-x="f" data-v="manana">Mañana</button><button type="button" class="chip" data-x="f" data-v="sin">Sin fecha</button></div><input type="date" id="tk-f" value="'+esc(f0)+'"></div>'
    + '<div class="fld"><button type="button" class="chip'+(t&&t.prio?' on':'')+'" id="tk-p" data-x="prio">'+(t&&t.prio?'★':'☆')+' Importante</button></div>'
    + '<div class="fld"><label>Pasos (opcional)</label><div id="tk-pasos">'+(t?t.pasos.map(pasoFila).join(''):'')+'</div><button type="button" class="btn btn-sm" data-x="add-paso">＋ Agregar paso</button></div>'
    + '<div class="fld"><label for="tk-r">Repetir</label><select id="tk-r">'+repOpciones(t?t.rep:'')+'</select></div>'
    + '<div class="fld"><label for="tk-n">Notas (opcional)</label><textarea id="tk-n" maxlength="500">'+esc(t?t.notas||'':'')+'</textarea></div>'
    + (mio ? '<div class="fld"><label>¿Quién la ve?</label>'+segComp(compIni)+'</div>' : '<p class="muted small">'+(t.compartido?'👥 Compartida':'🔒 Solo yo')+'</p>')
    + '<div class="fld"'+((compIni && otro)?'':' hidden')+'><label for="tk-para">¿Para quién es?</label><select id="tk-para">'+paraOpc.map(o=>'<option value="'+esc(o[0])+'"'+(o[0]===parVal?' selected':'')+'>'+esc(o[1])+'</option>').join('')+'</select></div>'
    + '<div class="err" id="tk-err" role="alert"></div>'
    + '<div class="acts">'+(t && mio ? '<button class="btn btn-danger spacer" data-x="del">Borrar</button>' : '')+'<button class="btn" data-x="cancel">Cancelar</button><button class="btn btn-primary" data-x="save">Guardar</button></div>';
  const sh = abrirSheet(html);
  const getComp = mio ? ligarSegComp(sh, compIni) : (()=>t.compartido);
  let prio = !!(t && t.prio);
  sh.addEventListener('click', async ev=>{
    const b = ev.target.closest('[data-x]'); if(!b) return;
    const x = b.dataset.x;
    if(x==='f'){ $('#tk-f',sh).value = resolverFecha(b.dataset.v); }
    else if(x==='prio'){ prio = !prio; b.classList.toggle('on',prio); b.textContent = (prio?'★':'☆')+' Importante'; }
    else if(x==='add-paso'){ $('#tk-pasos',sh).insertAdjacentHTML('beforeend', pasoFila(null)); const ins = sh.querySelectorAll('.paso-t'); ins[ins.length-1].focus(); }
    else if(x==='del-paso'){ b.closest('.paso').remove(); }
    else if(x==='cancel'){ cerrarSheet(); }
    else if(x==='del'){
      if(await confirmar('¿Borrar esta tarea?')){ const copia = {...t}; borrar(t); cerrarSheet(); refrescar(); snack('Tarea borrada', ()=>{ guardar(copia); refrescar(); }, 6000); }
    }
    else if(x==='save'){
      const tit = limpiarTxt($('#tk-t',sh).value); if(!tit){ $('#tk-err',sh).textContent = 'Escribe qué hay que hacer.'; return; }
      const pasos = Array.from(sh.querySelectorAll('.paso')).map(r=>({ t:limpiarTxt($('.paso-t',r).value).slice(0,120), d:$('.paso-d',r).checked })).filter(p=>p.t);
      const comp = getComp(); let para = $('#tk-para',sh) ? $('#tk-para',sh).value : '';
      if(!comp) para = '';
      const ownerFinal = t ? t.owner : S.uid;
      if(para===ownerFinal) para = '';
      const datos = { titulo:tit.slice(0,200), area:$('#tk-a',sh).value, fecha:$('#tk-f',sh).value||'', hora:$('#tk-h',sh).value||'', prio, pasos, rep:$('#tk-r',sh).value, notas:$('#tk-n',sh).value.trim().slice(0,500), para };
      let it;
      if(t){ it = Object.assign(t, datos); if(mio) it.compartido = comp; }
      else { it = nuevoItem('tarea', Object.assign(datos, { hecha:false, compartido:comp })); S.qa.compartido = comp; LS.s('ag_qa_comp', comp?'1':'0'); }
      S.qa.area = datos.area; LS.s('ag_qa_area', datos.area);
      guardar(it); cerrarSheet(); refrescar(); snack(t?'Tarea guardada ✓':'Tarea creada ✓', null, 2500);
    }
  });
  setTimeout(()=>{ if(!t){ const i = $('#tk-t',sh); if(i) i.focus(); } }, 80);
}

/* =====================================================================
   MODO FOCO (una sola cosa a la vez)
   ===================================================================== */
function mejorTarea(excluir){
  const h = hoy();
  const c = tareas().filter(t=>!t.hecha && paraMi(t) && !(excluir||[]).includes(t.id));
  const rank = t => (t.prio && t.fecha && t.fecha<=h) ? 0 : (t.fecha && t.fecha<=h) ? 1 : t.prio ? 2 : 3;
  c.sort((a,b)=>rank(a)-rank(b) || ordenT(a,b));
  return c[0] || null;
}
function abrirFoco(id, saltadas){
  const t = id ? porId(id) : mejorTarea(saltadas);
  if(!t){ aviso('No tienes tareas pendientes 🎉'); return; }
  detenerFoco(true);
  S.foco = { id:t.id, dur:15*60, resto:15*60, corriendo:false, fin:0, timer:null, saltadas:saltadas||[], terminado:false };
  pintarFoco();
}
function detenerFoco(cerrar){
  if(S.foco && S.foco.timer) clearInterval(S.foco.timer);
  if(cerrar){ S.foco = null; const f = document.getElementById('foco'); if(f) f.remove(); }
}
const mmss = s => p2(Math.floor(s/60))+':'+p2(s%60);
function pintarFoco(){
  const F = S.foco; if(!F) return;
  const t = porId(F.id); if(!t){ detenerFoco(true); return; }
  const a = area(t.area);
  let el = document.getElementById('foco');
  if(!el){ el = document.createElement('div'); el.id = 'foco'; el.className = 'foco'; document.body.appendChild(el); }
  el.innerHTML = '<div class="foco-in"><div class="lab">🎯 Una cosa a la vez</div><div class="tit">'+esc(t.titulo)+'</div>'
    + '<div class="lab">'+esc(a.emoji)+' '+esc(a.nombre)+(t.notas?' · '+esc(t.notas):'')+'</div>'
    + (t.pasos.length ? '<div class="pasos">'+t.pasos.map((p,i)=>'<label><input type="checkbox" data-fpaso="'+i+'"'+(p.d?' checked':'')+'><span'+(p.d?' style="text-decoration:line-through;opacity:.6"':'')+'>'+esc(p.t)+'</span></label>').join('')+'</div>' : '')
    + '<div class="time" id="foco-time">'+mmss(F.resto)+'</div>'
    + (F.corriendo||F.terminado ? '' : '<div class="chips" style="justify-content:center">'+[10,15,25].map(m=>'<button class="chip'+(F.dur===m*60?' on':'')+'" data-act="foco-dur" data-v="'+m+'">'+m+' min</button>').join('')+'</div>')
    + (F.terminado ? '<p style="font-weight:700;margin:6px 0">¡Se acabó el tiempo! 🎉 ¿Terminaste?</p>' : '')
    + '<div class="row"><button class="btn btn-primary" data-act="foco-go">'+(F.corriendo?'⏸ Pausar':(F.terminado?'↻ Otros minutos':'▶ Empezar'))+'</button><button class="btn btn-ok" data-act="foco-ok">✓ Ya la terminé</button></div>'
    + '<div class="row"><button class="btn btn-ghost" data-act="foco-otra">Otra tarea</button><button class="btn btn-ghost" data-act="foco-salir">Salir</button></div></div>';
}
function focoGo(){
  const F = S.foco; if(!F) return;
  if(F.corriendo){ F.corriendo = false; clearInterval(F.timer); F.resto = Math.max(0, Math.round((F.fin-Date.now())/1000)); pintarFoco(); return; }
  if(F.terminado || F.resto<=0){ F.terminado = false; F.resto = F.dur; }
  F.corriendo = true; F.fin = Date.now()+F.resto*1000;
  F.timer = setInterval(()=>{
    const r = Math.max(0, Math.round((F.fin-Date.now())/1000)); F.resto = r;
    const el = document.getElementById('foco-time'); if(el) el.textContent = mmss(r);
    if(r<=0){ clearInterval(F.timer); F.corriendo = false; F.terminado = true; try{ if(navigator.vibrate) navigator.vibrate([200,100,200]); }catch(e){} pintarFoco(); }
  }, 500);
  pintarFoco();
}

/* =====================================================================
   IDEAS (bandeja de entrada)
   ===================================================================== */
function fechaCaptura(iso){ const d = new Date(iso); if(isNaN(d)) return ''; return etiquetaDia(ymd(d))+' '+d.toLocaleTimeString('es-CO',{hour:'numeric',minute:'2-digit'}); }
function tarjetaIdea(it, arch){
  const id = esc(it.id), mio = it.owner===S.uid;
  return '<div class="idea"><div class="txt" data-act="idea-edit" data-id="'+id+'" style="cursor:pointer">'+esc(it.texto)+'</div>'
    + '<div class="t-meta" style="margin:6px 0 8px"><span>'+(it.compartido?'👥 Compartida':'🔒 Solo yo')+'</span><span>🕒 '+esc(fechaCaptura(it.creado))+'</span>'+(mio?'':'<span class="av">de '+esc(nombreDe(it.owner))+'</span>')+'</div>'
    + '<div class="t-acts">'
    + (arch ? '<button class="btn btn-sm" data-act="idea-rest" data-id="'+id+'">↩ Restaurar</button>'
            : '<button class="btn btn-sm btn-primary" data-act="idea-conv" data-id="'+id+'">✅ Hacer tarea</button><button class="btn btn-sm" data-act="idea-arch" data-id="'+id+'">📦 Archivar</button>')
    + (mio ? '<button class="btn btn-sm btn-danger" data-act="idea-del" data-id="'+id+'">🗑</button>' : '')
    + '</div></div>';
}
function vistaIdeas(){
  const act = ideas().filter(i=>!i.archivada).sort((a,b)=>String(b.creado).localeCompare(String(a.creado)));
  const arch = ideas().filter(i=>i.archivada).sort((a,b)=>String(b.creado).localeCompare(String(a.creado)));
  let html = '<div class="h-page"><div><h1>💡 Ideas</h1><div class="sub">Anota lo que se te ocurra, sin ordenarlo. Después decides qué hacer.</div></div></div>';
  html += '<form class="qa" id="ideas-form"><div class="qa-row"><input type="text" id="idea-in" maxlength="300" placeholder="¿Qué quieres recordar?" autocomplete="off" enterkeyhint="done"><button class="qa-go" type="submit" aria-label="Guardar idea">+</button></div>'
    + '<div class="chips"><button type="button" class="chip" data-act="idea-comp">'+(S.ideaComp?'👥 Compartida':'🔒 Solo yo')+'</button></div></form>';
  html += '<div class="sec"><span>Por revisar · '+act.length+'</span></div>';
  html += act.length ? act.map(i=>tarjetaIdea(i,false)).join('') : '<div class="empty"><b>Sin ideas por ahora ✨</b>Escríbelas arriba cuando se te ocurran.</div>';
  if(arch.length){
    html += '<div style="margin-top:8px"><button class="link" data-act="idea-verarch">'+(S.verArch?'Ocultar':'Ver')+' archivadas ('+arch.length+')</button></div>';
    if(S.verArch) html += arch.map(i=>tarjetaIdea(i,true)).join('');
  }
  return html;
}
function ideaCrear(){
  const inp = $('#idea-in'); if(!inp) return;
  const txt = limpiarTxt(inp.value); if(!txt) return;
  const it = nuevoItem('idea', { texto:txt.slice(0,300), archivada:false, compartido:S.ideaComp });
  guardar(it); inp.value = ''; refrescar();
  snack('Idea guardada ✓', ()=>{ borrar(it); refrescar(); }, 3000);
}
function ideaConvertir(id){
  const it = porId(id); if(!it) return;
  const ar = S.areas.some(a=>a.id===S.qa.area) ? S.qa.area : (S.areas[0]||{}).id;
  const t = nuevoItem('tarea', { titulo:it.texto.slice(0,200), area:ar, fecha:'', hora:'', prio:false, notas:'', pasos:[], rep:'', hecha:false, compartido:it.compartido, para:'' });
  guardar(t);
  const era = it.owner===S.uid;
  if(era) borrar(it); else { it.archivada = true; guardar(it); }
  refrescar();
  snack('Convertida en tarea ✓', ()=>{ borrar(t); if(era) guardar({...it}); else { it.archivada = false; guardar(it); } refrescar(); }, 7000);
}
function abrirIdea(id){
  const it = porId(id); if(!it) return;
  const mio = it.owner===S.uid;
  const sh = abrirSheet('<h2>Editar idea</h2><div class="fld"><textarea id="id-t" maxlength="300">'+esc(it.texto)+'</textarea></div>'
    + (mio ? '<div class="fld"><label>¿Quién la ve?</label>'+segComp(!!it.compartido)+'</div>' : '<p class="muted small">De '+esc(nombreDe(it.owner))+' · '+(it.compartido?'👥 Compartida':'🔒 Solo yo')+'</p>')
    + '<div class="acts"><button class="btn" data-x="cancel">Cancelar</button><button class="btn btn-primary" data-x="save">Guardar</button></div>');
  const getComp = mio ? ligarSegComp(sh, !!it.compartido) : (()=>it.compartido);
  sh.addEventListener('click', ev=>{
    const b = ev.target.closest('[data-x]'); if(!b) return;
    if(b.dataset.x==='cancel') cerrarSheet();
    else if(b.dataset.x==='save'){
      const v = limpiarTxt($('#id-t',sh).value); if(!v) return;
      it.texto = v.slice(0,300); if(mio) it.compartido = getComp();
      guardar(it); cerrarSheet(); refrescar();
    }
  });
}

/* =====================================================================
   MÁS: cuenta, áreas, privacidad
   ===================================================================== */
const TEXTO_PRIVACIDAD = 'Lo que marcas 🔒 «Solo yo» solo lo ves tú en la app. Lo 👥 «Compartido» lo ven los dos. '
  + 'La persona que administra la agenda (quien creó el proyecto) puede ver todos los datos desde el panel de administración, aunque no desde esta app. '
  + 'Por eso esta agenda es de los dos y ambos deben saberlo.';
function aplicarTema(){
  const t = LS.g('ag_tema','auto'); const r = document.documentElement;
  if(t==='auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', t);
  if(LS.g('ag_estilo','azul')==='futbol') r.setAttribute('data-estilo','futbol'); else r.removeAttribute('data-estilo');
}
function vistaMas(){
  const usuario = (auth.currentUser && auth.currentUser.email || '').replace(DOMINIO,'');
  const tema = LS.g('ag_tema','auto');
  let html = '<div class="h-page"><div><h1>⚙️ Más</h1></div></div>';
  html += '<div class="card"><div class="lbl">Tu cuenta</div><div style="display:flex;align-items:center;gap:12px"><span class="avatar" style="width:46px;height:46px;font-size:1.2rem;display:flex;align-items:center;justify-content:center">'+esc(inicial(miNombre()||'?'))+'</span>'
    + '<div style="flex:1;min-width:0"><b>'+esc(miNombre()||'Sin nombre')+'</b><div class="muted small">Usuario: '+esc(usuario)+'</div></div><button class="btn btn-sm" data-act="mas-nombre">Cambiar nombre</button></div></div>';
  html += '<div class="card"><div class="lbl">Áreas</div><p class="muted small" style="margin-bottom:10px">Las áreas ordenan y le ponen color a todo. Las dos personas ven las mismas áreas.</p>'
    + S.areas.map(a=>'<button class="list-item" data-act="area-edit" data-id="'+esc(a.id)+'"><span class="dot" style="background:'+esc(a.color)+';width:16px;height:16px"></span><span class="main"><b>'+esc(a.emoji)+' '+esc(a.nombre)+'</b></span><span class="muted">Editar ›</span></button>').join('')
    + '<button class="btn btn-sm" data-act="area-nueva">＋ Nueva área</button></div>';
  html += '<div class="card"><div class="lbl">Nombre de la agenda</div><div style="display:flex;gap:8px"><input id="mas-app" maxlength="30" value="'+esc(S.appNombre)+'"><button class="btn" data-act="mas-app">Guardar</button></div></div>';
  html += '<div class="card"><div class="lbl">Apariencia</div><div class="seg"><button class="'+(tema==='auto'?'on':'')+'" data-act="tema" data-v="auto">Automático</button><button class="'+(tema==='light'?'on':'')+'" data-act="tema" data-v="light">Claro</button><button class="'+(tema==='dark'?'on':'')+'" data-act="tema" data-v="dark">Oscuro</button></div></div>';
  const est = LS.g('ag_estilo','azul');
  html += '<div class="card"><div class="lbl">Estilo</div><div class="seg"><button class="'+(est!=='futbol'?'on':'')+'" data-act="estilo" data-v="azul">💙 Azul</button><button class="'+(est==='futbol'?'on':'')+'" data-act="estilo" data-v="futbol">⚽ Fútbol</button></div><p class="muted small" style="margin-top:8px">Se guarda en este aparato. Cada uno elige el suyo.</p></div>';
  html += '<div class="card"><div class="lbl">Privacidad</div><p class="small">'+esc(TEXTO_PRIVACIDAD)+'</p></div>';
  html += '<div class="card"><div class="lbl">Instalar como app</div><p class="small"><b>iPhone:</b> abre esta página en Safari, toca el botón Compartir y elige «Añadir a pantalla de inicio».<br><b>Android:</b> en Chrome, menú ⋮ → «Instalar app».<br><b>Computador:</b> en Chrome o Edge, ícono de instalar a la derecha de la barra de direcciones.</p></div>';
  html += '<button class="btn btn-block btn-danger" data-act="salir">Cerrar sesión</button><p class="muted small" style="text-align:center;margin-top:12px">Agenda v'+VERSION+'</p>';
  return html;
}
function abrirArea(id){
  const a = id ? S.areas.find(x=>x.id===id) : null; if(id && !a) return;
  let color = a ? a.color : COLORES[S.areas.length % COLORES.length];
  const sh = abrirSheet('<h2>'+(a?'Editar área':'Nueva área')+'</h2>'
    + '<div class="grid2"><div class="fld"><label for="ar-n">Nombre</label><input id="ar-n" maxlength="24" value="'+esc(a?a.nombre:'')+'"></div><div class="fld"><label for="ar-e">Emoji</label><input id="ar-e" maxlength="4" value="'+esc(a?a.emoji:'📌')+'"></div></div>'
    + '<div class="fld"><label>Color</label><div class="sw" id="ar-sw">'+COLORES.map(c=>'<span data-c="'+c+'" class="'+(c===color?'sel':'')+'" style="background:'+c+'"></span>').join('')+'</div></div>'
    + '<div class="err" id="ar-err" role="alert"></div>'
    + '<div class="acts">'+(a?'<button class="btn btn-danger spacer" data-x="del">Eliminar</button>':'')+'<button class="btn" data-x="cancel">Cancelar</button><button class="btn btn-primary" data-x="save">Guardar</button></div>');
  sh.addEventListener('click', async ev=>{
    const sw = ev.target.closest('#ar-sw span'); if(sw){ color = sw.dataset.c; sh.querySelectorAll('#ar-sw span').forEach(s=>s.classList.toggle('sel', s===sw)); return; }
    const b = ev.target.closest('[data-x]'); if(!b) return;
    if(b.dataset.x==='cancel') cerrarSheet();
    else if(b.dataset.x==='save'){
      const n = limpiarTxt($('#ar-n',sh).value); if(!n){ $('#ar-err',sh).textContent = 'Ponle un nombre.'; return; }
      const e = limpiarTxt($('#ar-e',sh).value) || '📌';
      if(a) guardarAreas(S.areas.map(x=>x.id===a.id ? { id:a.id, nombre:n, emoji:e, color } : x));
      else guardarAreas(S.areas.concat([{ id:'a'+Date.now().toString(36), nombre:n, emoji:e, color }]));
      cerrarSheet();
    }
    else if(b.dataset.x==='del'){
      if(S.areas.length<=1){ $('#ar-err',sh).textContent = 'Debe quedar al menos un área.'; return; }
      const usos = todos().filter(i=>i.area===a.id).length;
      if(usos){ $('#ar-err',sh).textContent = 'Hay '+usos+' cosa(s) en esta área. Cámbialas de área antes de eliminarla.'; return; }
      if(await confirmar('¿Eliminar el área «'+a.nombre+'»?','Sí, eliminar')){ guardarAreas(S.areas.filter(x=>x.id!==a.id)); cerrarSheet(); }
    }
  });
}
function cambiarNombre(){
  const sh = abrirSheet('<h2>Tu nombre</h2><div class="fld"><input id="nm2" maxlength="24" value="'+esc(miNombre())+'"></div><div class="acts"><button class="btn" data-x="cancel">Cancelar</button><button class="btn btn-primary" data-x="save">Guardar</button></div>');
  sh.addEventListener('click', ev=>{
    const b = ev.target.closest('[data-x]'); if(!b) return;
    if(b.dataset.x==='cancel') cerrarSheet();
    else { const n = limpiarTxt($('#nm2',sh).value).slice(0,24); if(!n) return; S.miembros[S.uid] = Object.assign({}, S.miembros[S.uid], { nombre:n }); setDoc(doc(db,'miembros',S.uid), { nombre:n, creado:(S.miembros[S.uid]&&S.miembros[S.uid].creado)||new Date().toISOString() }).catch(()=>aviso('No se pudo guardar.')); cerrarSheet(); refrescar(); }
  });
}

/* =====================================================================
   Acciones (clics) y arranque
   ===================================================================== */
function chooserNuevo(){
  const sh = abrirSheet('<h2>¿Qué quieres agregar?</h2>'
    + '<button class="opt" data-x="tarea"><span class="i">✅</span><span>Una tarea<small>Algo que hay que hacer</small></span></button>'
    + '<button class="opt" data-x="evento"><span class="i">📅</span><span>Un evento<small>Algo con día y hora</small></span></button>'
    + '<button class="opt" data-x="idea"><span class="i">💡</span><span>Una idea<small>Anótala rápido, luego decides</small></span></button>');
  sh.addEventListener('click', ev=>{
    const b = ev.target.closest('[data-x]'); if(!b) return; cerrarSheet();
    if(b.dataset.x==='tarea') abrirTarea(null); else if(b.dataset.x==='evento') abrirEvento(null);
    else { S.tab = 'ideas'; LS.s('ag_tab','ideas'); refrescar(true); setTimeout(()=>{ const i=$('#idea-in'); if(i) i.focus(); }, 120); }
  });
}
const ACC = {
  'tab': b=>{ S.tab = b.dataset.v; LS.s('ag_tab', S.tab); refrescar(true); window.scrollTo(0,0); },
  'fab': ()=>{
    if(S.tab==='cal') abrirEvento(null);
    else if(S.tab==='tareas') abrirTarea(null);
    else if(S.tab==='ideas'){ const i=$('#idea-in'); if(i) i.focus(); }
    else chooserNuevo();
  },
  'chk': b=>completar(b.dataset.id),
  'reabrir': b=>{ const t=porId(b.dataset.id); if(t){ t.hecha=false; delete t.hechaEn; guardar(t); refrescar(); } },
  'edit-t': b=>abrirTarea(b.dataset.id),
  'edit-e': b=>abrirEvento(b.dataset.id),
  'star': b=>{
    const t = porId(b.dataset.id); if(!t) return;
    if(!t.prio){
      const h = hoy(), n = tareas().filter(x=>!x.hecha && x.prio && paraMi(x) && x.fecha && x.fecha<=h).length;
      if(n>=3 && t.fecha && t.fecha<=h){ snack('Ya tienes 3 importantes para hoy. Quita una ⭐ para elegir otra.', null, 3500); return; }
    }
    t.prio = !t.prio; guardar(t); refrescar();
  },
  'empezar': b=>abrirFoco(b.dataset.id),
  'empezar-mejor': ()=>abrirFoco(null),
  'pasos': b=>{ S.tr.abiertas[b.dataset.id] = !S.tr.abiertas[b.dataset.id]; refrescar(); },
  'mover': b=>{ const t=porId(b.dataset.id); if(!t) return; const ant=t.fecha; t.fecha = b.dataset.v==='hoy' ? hoy() : sumar(hoy(),1); guardar(t); refrescar(); snack('Movida a '+(b.dataset.v==='hoy'?'hoy':'mañana'), ()=>{ t.fecha=ant; guardar(t); refrescar(); }, 4000); },
  'atras-ver': ()=>{ S.tr.verAtras = !S.tr.verAtras; refrescar(); },
  'atras-hoy': ()=>{
    const h = hoy(), mov = tareas().filter(t=>!t.hecha && paraMi(t) && t.fecha && t.fecha<h), prev = mov.map(t=>[t,t.fecha]);
    mov.forEach(t=>{ t.fecha = h; guardar(t); }); refrescar();
    snack(mov.length+' pasada'+(mov.length>1?'s':'')+' a hoy', ()=>{ prev.forEach(p=>{ p[0].fecha = p[1]; guardar(p[0]); }); refrescar(); }, 8000);
  },
  'ir-cal': ()=>{ S.cal.vista = 'dia'; S.cal.fecha = hoy(); ACC.tab({dataset:{v:'cal'}}); },
  'qa-fecha': b=>{ S.qa[b.dataset.k].fecha = b.dataset.v; refrescar(); const i=$('#qa-t-'+b.dataset.k); if(i) i.focus(); },
  'qa-comp': ()=>{ S.qa.compartido = !S.qa.compartido; LS.s('ag_qa_comp', S.qa.compartido?'1':'0'); refrescar(); },
  'tr-vista': b=>{ S.tr.vista = b.dataset.v; refrescar(); },
  'tr-quien': b=>{ S.tr.quien = b.dataset.v; refrescar(); },
  'tr-area': b=>{ S.tr.area = b.dataset.v; refrescar(); },
  'cal-prev': ()=>moverCal(-1),
  'cal-next': ()=>moverCal(1),
  'cal-hoy': ()=>{ S.cal.fecha = hoy(); refrescar(true); },
  'cal-vista': b=>{ S.cal.vista = b.dataset.v; LS.s('ag_calvista', S.cal.vista); refrescar(true); },
  'cal-quien': b=>{ S.cal.quien = b.dataset.v; refrescar(); },
  'cal-area-t': b=>{ const id=b.dataset.v; if(S.cal.ocultas.has(id)) S.cal.ocultas.delete(id); else S.cal.ocultas.add(id); LS.s('ag_ocultas', JSON.stringify(Array.from(S.cal.ocultas))); refrescar(); },
  'cal-dia': b=>{ S.cal.fecha = b.dataset.v; if(S.cal.vista==='mes' || S.cal.vista==='semana'){ S.cal.vista = 'dia'; LS.s('ag_calvista','dia'); } refrescar(true); },
  'idea-comp': ()=>{ S.ideaComp = !S.ideaComp; LS.s('ag_idea_comp', S.ideaComp?'1':'0'); refrescar(); },
  'idea-conv': b=>ideaConvertir(b.dataset.id),
  'idea-arch': b=>{ const it=porId(b.dataset.id); if(!it) return; it.archivada=true; guardar(it); refrescar(); snack('Archivada', ()=>{ it.archivada=false; guardar(it); refrescar(); }, 5000); },
  'idea-rest': b=>{ const it=porId(b.dataset.id); if(!it) return; it.archivada=false; guardar(it); refrescar(); },
  'idea-del': async b=>{ const it=porId(b.dataset.id); if(!it) return; if(await confirmar('¿Borrar esta idea?')){ const c={...it}; borrar(it); refrescar(); snack('Idea borrada', ()=>{ guardar(c); refrescar(); }, 6000); } },
  'idea-edit': b=>abrirIdea(b.dataset.id),
  'idea-verarch': ()=>{ S.verArch = !S.verArch; refrescar(); },
  'mas-nombre': ()=>cambiarNombre(),
  'mas-app': ()=>{ const n = limpiarTxt($('#mas-app').value).slice(0,30); if(!n) return; S.appNombre = n; document.title = n; const a=$('#app-nombre'); if(a) a.textContent = n; setDoc(doc(db,'config','app'),{nombre:n}).catch(()=>aviso('No se pudo guardar.')); aviso('Nombre guardado ✓'); },
  'estilo': b=>{ LS.s('ag_estilo', b.dataset.v); aplicarTema(); location.reload(); },
  'tema': b=>{ LS.s('ag_tema', b.dataset.v); aplicarTema(); refrescar(); },
  'area-edit': b=>abrirArea(b.dataset.id),
  'area-nueva': ()=>abrirArea(null),
  'salir': async ()=>{ if(await confirmar('¿Cerrar sesión?','Sí, salir')) salir(); },
  'foco-dur': b=>{ const F=S.foco; if(!F||F.corriendo) return; F.dur = +b.dataset.v*60; F.resto = F.dur; pintarFoco(); },
  'foco-go': ()=>focoGo(),
  'foco-ok': ()=>{ const F=S.foco; if(!F) return; const id=F.id; detenerFoco(true); completar(id); },
  'foco-otra': ()=>{ const F=S.foco; if(!F) return; const sal=F.saltadas.concat([F.id]); const n=mejorTarea(sal); if(!n){ aviso('No hay otra tarea pendiente.'); return; } abrirFoco(n.id, sal); },
  'foco-salir': ()=>{ detenerFoco(true); refrescar(); }
};

document.addEventListener('click', ev=>{
  const tg = ev.target;
  // clic en un espacio vacío de la cuadrícula → nuevo evento a esa hora
  const col = tg.classList && tg.classList.contains('cal-col') ? tg : null;
  if(col){
    const r = col.getBoundingClientRect(); const min = Math.max(0, Math.min(23*60, Math.floor((ev.clientY - r.top)/HH*2)*30));
    abrirEvento(null, { dia:col.dataset.dia, hora:p2(Math.floor(min/60))+':'+p2(min%60) }); return;
  }
  if(tg.closest && tg.closest('.steps')) return;                       // los pasos solo cambian su casilla
  const b = tg.closest ? tg.closest('[data-act]') : null; if(!b) return;
  const f = ACC[b.dataset.act]; if(f) f(b, ev);
});
document.addEventListener('change', ev=>{
  const el = ev.target;
  if(el.dataset && el.dataset.paso!==undefined){
    const t = porId(el.dataset.id), i = +el.dataset.paso; if(!t || !t.pasos[i]) return;
    t.pasos[i].d = el.checked; guardar(t); refrescar();
  } else if(el.dataset && el.dataset.fpaso!==undefined){
    const F = S.foco, t = F && porId(F.id), i = +el.dataset.fpaso; if(!t || !t.pasos[i]) return;
    t.pasos[i].d = el.checked; guardar(t); pintarFoco();
  } else if(el.dataset && el.dataset.qaDate){
    S.qa[el.dataset.qaDate].fecha = el.value || 'sin'; refrescar();
  } else if(el.dataset && el.dataset.qaArea!==undefined){
    S.qa.area = el.value; LS.s('ag_qa_area', el.value);
  }
});
document.addEventListener('submit', ev=>{
  const f = ev.target; ev.preventDefault();
  if(f.id==='f-login') entrar(ev);
  else if(f.dataset && f.dataset.qa) qaCrear(f.dataset.qa);
  else if(f.id==='ideas-form') ideaCrear();
});
document.addEventListener('keydown', ev=>{
  if(ev.key==='Escape'){ if(document.getElementById('confirm-bg')) cerrarSheet('confirm-bg'); else if(document.getElementById('sheet-bg')) cerrarSheet(); }
});
window.addEventListener('online', ()=>{ S.online = true; refrescar(); });
window.addEventListener('offline', ()=>{ S.online = false; refrescar(); });
let diaVisto = hoy();
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState==='visible'){ if(hoy()!==diaVisto){ diaVisto = hoy(); S.cal.fecha = hoy(); } refrescar(); }
});
setInterval(()=>{ if(S.shell && S.tab==='cal' && !document.hidden) refrescar(); }, 60000);   // mueve la línea de "ahora"

aplicarTema();
$('#root').innerHTML = '<div class="login"><div class="login-card" style="text-align:center"><div class="login-logo">📅</div><p class="sub" style="margin:0">Cargando…</p></div></div>';
onAuthStateChanged(auth, user=>{
  if(user){
    if(S.uid===user.uid && S.shell) return;
    S.uid = user.uid; iniciarDB(); iniciarDatos(); montarShell();
  } else {
    limpiarSesion(); S.uid = null; renderLogin();
  }
});
if('serviceWorker' in navigator){ window.addEventListener('load', ()=>{ navigator.serviceWorker.register('sw.js').catch(e=>console.warn('[agenda] sw', e)); }); }
