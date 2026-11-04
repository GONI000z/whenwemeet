import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, doc as fdoc, collection as fcol, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot as fsnap } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { firebaseConfig } from './firebase-config.js';

// Firestore를 화면 코드가 쓰기 편한 모양으로 감싼 얇은 도우미
function makeDb(fs){
  const wrap = (s)=>({ id: s.id, exists: s.exists(), data: ()=>s.data(), metadata: s.metadata });
  const docRef = (path)=>{
    const r = fdoc(fs, path);
    return {
      id: r.id, path: r.path,
      get: async ()=>wrap(await getDoc(r)),
      set: (d)=>setDoc(r, d),
      update: (d)=>updateDoc(r, d),
      delete: ()=>deleteDoc(r),
      onSnapshot: (next, err)=>fsnap(r, { includeMetadataChanges: false }, s=>next(wrap(s)), err),
      collection: (sub)=>colRef(r.path + '/' + sub),
    };
  };
  const colRef = (path)=>{
    const c = fcol(fs, path);
    return {
      path,
      doc: (id)=>docRef(id ? path + '/' + id : fdoc(c).path),
      onSnapshot: (next, err)=>fsnap(c, s=>next({ docs: s.docs.map(wrap), metadata: s.metadata }), err),
    };
  };
  return { doc: docRef, collection: colRef };
}

const app = document.getElementById('app');
const WD = ['일','월','화','수','목','금','토'];
const COLORS = ['#2f5bd3','#1f9d6b','#d0433a','#9b51c9','#e0702b','#0f8fa3','#d4589a','#6f8a1f','#8a5a3c','#c9a20c'];
let db = null, me = null, canWrite = true;
let myList = { groups: [] };           // [{id,name}]
let view = 'home', gid = null;
let group = null, members = {};        // uid -> {nick,yes:[],maybe:[]}
let mode = 'mine', cursor = monthStart(new Date()), selected = null;
let unsubG = null, unsubM = null, loadTimer = null, stale = false;
let pending = null, saveTimer = null, saving = false, confirmLeave = false;
let msg = '';
let events = {}, evSubs = {}, sheet = null, press = null, suppress = false;

function h(tag, attrs, ...kids){
  const el = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs||{})){
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : String(k));
  return el;
}
function toast(t){ const el=document.getElementById('toast'); el.textContent=t; el.hidden=false; clearTimeout(toast.t); toast.t=setTimeout(()=>el.hidden=true,2200); }
function monthStart(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function key(y,m,d){ return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function todayKey(){ const t=new Date(); return key(t.getFullYear(),t.getMonth(),t.getDate()); }
function fmt(k){ const [y,m,d]=k.split('-').map(Number); const w=new Date(y,m-1,d).getDay(); return `${m}월 ${d}일 (${WD[w]})`; }
function colorOf(id){
  let i = memberList().findIndex(m=>m.id===id);
  if (i < 0){ let s=0; for (const c of id) s=(s*31+c.charCodeAt(0))>>>0; i = s % 40; }
  if (i < COLORS.length) return COLORS[i];
  return `hsl(${Math.round((i*137.508)%360)},58%,44%)`;   // 11번째부터는 겹치지 않게 색상환을 돌며 새 색을 만듦
}
function tint(el, id, fill){
  const c = colorOf(id); el.style.color = c;
  if (fill){ el.style.background = 'var(--ev-soft)'; el.style.background = `color-mix(in srgb, ${c} 17%, transparent)`; }
  return el;
}
function code6(){ const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; const r=crypto.getRandomValues(new Uint32Array(6)); for(const x of r) s+=a[x%a.length]; return s; }
function memberList(){ return Object.entries(members).map(([id,m])=>({id,...m})).sort((a,b)=>(a.joinedAt||0)-(b.joinedAt||0)); }
function avatar(id,nick){ const d=h('span',{class:'dot'},(nick||'?').slice(0,1)); d.style.background=colorOf(id); return d; }
function myDoc(){ return db.doc(`users/${me}`); }

/* ---------- boot ---------- */
async function boot(){
  try{
    const fapp = initializeApp(firebaseConfig);
    const auth = getAuth(fapp);
    let fs;
    try { fs = initializeFirestore(fapp, { localCache: persistentLocalCache(), experimentalAutoDetectLongPolling: true }); }
    catch(e){ fs = initializeFirestore(fapp, { experimentalAutoDetectLongPolling: true }); }
    db = makeDb(fs);
    const user = await new Promise((resolve, reject)=>{
      const off = onAuthStateChanged(auth, u=>{ if (u){ off(); resolve(u); } }, reject);
      signInAnonymously(auth).catch(reject);
    });
    me = user.uid;
  }catch(e){
    console.error(e);
    showFatal('서버에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 앱을 다시 열어 주세요.');
    return;
  }
  try { const s = await myDoc().get(); if (s.exists) myList = { groups: s.data().groups || [] }; } catch(e){}
  const q = new URLSearchParams(location.search).get('join');
  const m = location.hash.match(/^#j-([A-Z0-9]{6})$/i);
  const jc = (q && /^[A-Z0-9]{6}$/i.test(q)) ? q : (m ? m[1] : '');
  if (jc) { joinCode = jc.toUpperCase(); }
  else { let last=null; try{ last=localStorage.getItem('lastGroup'); }catch(e){} if (last && myList.groups.some(g=>g.id===last)) return openGroup(last); }
  render();
}
function showFatal(t){ app.querySelector('.panel').replaceChildren(h('p',{class:'note'},t)); }
let joinCode = '';

/* ---------- my list ---------- */
async function saveMyList(){ try { await myDoc().set({ groups: myList.groups }); } catch(e){ toast('목록을 저장하지 못했어요'); } }

/* ---------- home ---------- */
function renderHome(){
  const kids = [];
  const list = h('div',{class:'glist'});
  if (!myList.groups.length) list.append(h('p',{class:'empty'},'아직 참여한 모임이 없어요. 아래에서 새 모임을 만들거나 초대 코드를 입력하세요.'));
  for (const g of myList.groups) list.append(h('button',{class:'gitem',onclick:()=>openGroup(g.id)}, h('span',{},g.name), h('small',{},'열기 ›')));
  kids.push(h('section',{class:'panel'}, h('h2',{},'내 모임'), list));

  const nm = h('input',{id:'newName',placeholder:'예) 대학 동기 연말 모임',maxlength:'30'});
  const nk1 = h('input',{id:'newNick',placeholder:'모임에서 쓸 내 이름',maxlength:'12',value:lastNick()});
  kids.push(h('section',{class:'panel'}, h('h2',{},'새 모임 만들기'),
    h('label',{for:'newName'},'모임 이름',nm), h('label',{for:'newNick'},'내 이름',nk1),
    h('button',{class:'primary',disabled:!canWrite,onclick:()=>createGroup(nm.value.trim(),nk1.value.trim())},'만들고 초대 코드 받기')));

  const cd = h('input',{id:'joinCode',placeholder:'6자리 코드',maxlength:'6',value:joinCode,style:'text-transform:uppercase;letter-spacing:.15em'});
  const nk2 = h('input',{id:'joinNick',placeholder:'모임에서 쓸 내 이름',maxlength:'12',value:lastNick()});
  kids.push(h('section',{class:'panel'}, h('h2',{},'초대 코드로 참여'),
    h('label',{for:'joinCode'},'초대 코드',cd), h('label',{for:'joinNick'},'내 이름',nk2),
    msg ? h('p',{class:'note warn'},msg) : null,
    h('button',{class:'primary',disabled:!canWrite,onclick:()=>joinGroup(cd.value.trim().toUpperCase(),nk2.value.trim())},'참여하기')));
  return kids;
}
function lastNick(){ try{ return localStorage.getItem('nick')||''; }catch(e){ return ''; } }
function rememberNick(n){ try{ localStorage.setItem('nick',n); }catch(e){} }

async function createGroup(name, nick){
  if (!name){ toast('모임 이름을 적어 주세요'); return; }
  if (!nick){ toast('내 이름을 적어 주세요'); return; }
  try{
    let code = code6();
    for (let i=0;i<3;i++){ const s = await db.doc('codes/'+code).get(); if (!s.exists) break; code = code6(); }
    const ref = db.collection('groups').doc();
    await ref.set({ name, code, owner: me, createdAt: Date.now() });
    await db.doc('codes/'+code).set({ gid: ref.id });
    await ref.collection('members').doc(me).set({ nick, yes:[], maybe:[], joinedAt: Date.now() });
    myList.groups.unshift({ id: ref.id, name }); await saveMyList(); rememberNick(nick);
    toast('모임을 만들었어요'); openGroup(ref.id);
  }catch(e){ console.error(e); toast('만들지 못했어요. 인터넷 연결을 확인해 주세요'); }
}
async function joinGroup(code, nick){
  msg=''; joinCode=code;
  if (!/^[A-Z0-9]{6}$/.test(code)){ msg='초대 코드는 영문·숫자 6자리예요.'; render(); return; }
  if (!nick){ toast('내 이름을 적어 주세요'); return; }
  try{
    const c = await db.doc('codes/'+code).get();
    if (!c.exists){ msg='이 코드로 된 모임을 찾지 못했어요. 코드를 다시 확인해 주세요.'; render(); return; }
    const id = c.data().gid; const g = await db.doc('groups/'+id).get();
    if (!g.exists){ msg='삭제된 모임이에요.'; render(); return; }
    const mref = db.doc(`groups/${id}/members/${me}`); const ms = await mref.get();
    if (ms.exists) await mref.update({ nick }); else await mref.set({ nick, yes:[], maybe:[], joinedAt: Date.now() });
    if (!myList.groups.some(x=>x.id===id)){ myList.groups.unshift({ id, name: g.data().name }); await saveMyList(); }
    rememberNick(nick); joinCode=''; if (location.hash || location.search) history.replaceState(null,'',location.pathname);
    toast(`"${g.data().name}"에 참여했어요`); openGroup(id);
  }catch(e){ console.error(e); msg='참여하지 못했어요. 인터넷 연결을 확인해 주세요.'; render(); }
}

/* ---------- group ---------- */
function openGroup(id){
  closeGroup(); view='group'; gid=id; group=null; members={}; selected=null; mode='mine'; confirmLeave=false; stale=false;
  try{ localStorage.setItem('lastGroup',id); }catch(e){}
  loadTimer = setTimeout(()=>{ stale=true; render(); }, 10000);
  unsubG = db.doc('groups/'+id).onSnapshot(s=>{
    group = s.exists ? s.data() : { missing:true };
    const li = myList.groups.find(g=>g.id===id);
    if (li && s.exists && li.name !== group.name){ li.name = group.name; saveMyList(); }
    render();
  }, ()=>{ group={missing:true}; render(); });
  events = {};
  unsubM = db.collection(`groups/${id}/members`).onSnapshot(s=>{
    if (!s.metadata.fromCache){ clearTimeout(loadTimer); stale=false; }
    const next={}; for (const d of s.docs) next[d.id]=d.data();
    if (pending) next[me] = { ...(next[me]||{}), ...pending };
    members = next; syncEvSubs(); render();
  }, ()=>{ clearTimeout(loadTimer); render(); });
  render();
}
function closeGroup(){ if (unsubG) unsubG(); if (unsubM) unsubM(); for (const u of Object.values(evSubs)) u(); evSubs={}; unsubG=unsubM=null; if (sheet) closeSheet(); clearTimeout(loadTimer); }
function goHome(){ flush(); closeGroup(); view='home'; gid=null; try{ localStorage.removeItem('lastGroup'); }catch(e){} render(); }

function mine(){ const m = members[me] || {}; return { yes: new Set(m.yes||[]), maybe: new Set(m.maybe||[]) }; }
function toggle(k){
  if (!canWrite){ toast('보기 전용이라 체크할 수 없어요'); return; }
  if (!members[me]){ toast('이 모임에 참여한 뒤 체크할 수 있어요'); return; }
  const { yes } = mine();
  if (yes.has(k)) yes.delete(k); else yes.add(k);
  pending = { yes:[...yes].sort(), maybe:[] };
  members[me] = { ...members[me], ...pending };
  clearTimeout(saveTimer); saveTimer = setTimeout(flush, 700); render();
}
async function flush(){
  clearTimeout(saveTimer);
  if (!pending || saving || !gid) return;
  const body = pending, at = gid; saving = true; render();
  try { await db.doc(`groups/${at}/members/${me}`).update(body); if (pending===body) pending=null; }
  catch(e){ toast('저장하지 못했어요. 다시 체크해 주세요'); pending=null; }
  saving=false; if (pending) flush(); else render();
}
async function leaveGroup(){
  try{ await db.doc(`groups/${gid}/members/${me}`).delete(); }catch(e){}
  myList.groups = myList.groups.filter(g=>g.id!==gid); await saveMyList(); toast('모임에서 나왔어요'); goHome();
}

function tally(){
  const t = {}; const list = memberList();
  for (const m of list){
    for (const k of m.yes||[]) (t[k] ||= {yes:[],maybe:[]}).yes.push(m);
  }
  return t;
}

function renderGroup(){
  const kids = [];
  if (!group) return [h('div',{class:'panel'},h('p',{class:'empty'}, stale ? '아직 데이터를 불러오지 못했어요. 연결을 확인해 주세요.' : '모임을 불러오는 중…'))];
  if (group.missing) return [h('div',{class:'panel'},h('p',{class:'empty'},'이 모임을 찾을 수 없어요.'),h('button',{onclick:()=>{ myList.groups=myList.groups.filter(g=>g.id!==gid); saveMyList(); goHome(); }},'목록에서 지우기'))];
  const list = memberList(); const n = list.length; const t = tally(); const tk = todayKey();

  // header
  kids.push(h('div',{class:'top'},
    h('div',{style:'min-width:0'}, h('button',{class:'ghost',onclick:goHome,style:'margin-left:-8px'},'‹ 내 모임'), h('h1',{},group.name)),
    members[me] ? h('button',{class:'me-btn','aria-label':'내 이름 변경',onclick:()=>{ if (!canWrite) return toast('보기 전용이라 바꿀 수 없어요'); sheet={mode:'nick'}; renderSheet(); }}, avatar(me, members[me].nick), members[me].nick, h('span',{style:'color:var(--muted);font-weight:500'},'· 이름 변경')) : null
  ));
  // invite + members
  const copy = async ()=>{
    const web = (window.APP_CONFIG && window.APP_CONFIG.webUrl) || '';
    const text = `"${group.name}" 날짜 정하자! 되는 날 체크해 줘 🙌\n초대 코드: ${group.code}` + (web ? `\n아이폰·웹: ${web}?join=${group.code}` : '') + `\n(안드로이드 앱에서는 초대 코드 입력)`;
    if (await copyText(text)) toast('초대 메시지를 복사했어요. 카톡에 붙여넣으세요'); else toast('코드를 길게 눌러 복사해 주세요');
  };
  kids.push(h('section',{class:'panel'},
    h('div',{class:'row',style:'justify-content:space-between'}, h('div',{class:'row'}, h('span',{class:'sub',style:'margin:0'},'초대 코드'), h('span',{class:'code'},group.code)), h('button',{onclick:copy},'초대 메시지 복사')),
    h('div',{class:'chips'}, list.map(m=>h('span',{class:'chip'},avatar(m.id,m.nick), m.nick + (m.id===me?' (나)':''))) ),
    stale ? h('p',{class:'note'},'최신 내용이 아닐 수 있어요. 연결을 확인해 주세요.') : null,
    !members[me] ? h('p',{class:'note warn'},'이 모임에서 나온 상태예요. 초대 코드로 다시 참여할 수 있어요.') : null
  ));

  // calendar
  const y = cursor.getFullYear(), mo = cursor.getMonth();
  const first = new Date(y,mo,1).getDay(), days = new Date(y,mo+1,0).getDate();
  const isThisMonth = y===new Date().getFullYear() && mo===new Date().getMonth();
  const { yes } = mine();
  const grid = h('div',{class:'grid'}, WD.map((w,i)=>h('div',{class:'wd'+(i===0?' sun':i===6?' sat':'')},w)));
  for (let i=0;i<first;i++) grid.append(h('div',{class:'cell blank','aria-hidden':'true'}));
  for (let d=1; d<=days; d++){
    const k = key(y,mo,d), w=(first+d-1)%7, past = k < tk, c = t[k] || {yes:[],maybe:[]};
    let cls = 'cell' + (w===0?' sun':w===6?' sat':'') + (past?' past':'') + (k===tk?' today':'');
    let label = `${mo+1}월 ${d}일`;
    if (c.yes.length) label += ` 가능: ${c.yes.map(m=>m.nick).join(', ')}`;
    if (mode==='mine'){
      if (yes.has(k)) cls+=' yes';
    } else {
      if (selected===k) cls+=' sel';
      if (n && c.yes.length===n) cls+=' all';
    }
    const evk = eventsOn(k);
    if (evk.length) label += ` 일정: ${evk.map(([,e])=>e.title).join(', ')}`;
    const cell = h('button',{class:cls,'aria-label':label,
      onclick:()=>{ if (suppress) return; if (mode==='mine'){ if (past) toast('지난 날은 가능 체크 대신 길게 눌러 일정을 넣을 수 있어요'); else toggle(k); } else { selected = selected===k?null:k; render(); } },
      onpointerdown:(e)=>startPress(e,k), onpointermove:movePress, onpointerup:endPress, onpointercancel:endPress, onpointerleave:endPress,
      oncontextmenu:(e)=>{ e.preventDefault(); endPress(); openDay(k); }},
      h('span',{class:'n'},d),
      evChips(evk),
      nameList(c));
    if (mode==='all' && !past && n){
      const r = (c.yes.length + c.maybe.length*0.4)/n;
      if (r>0) cell.style.background = `rgba(var(--heat),${(0.1+r*0.55).toFixed(2)})`;
    }
    grid.append(cell);
  }
  const prevDisabled = false;
  kids.push(h('section',{class:'panel'},
    h('div',{class:'tabs',role:'group'},
      h('button',{'aria-pressed':String(mode==='mine'),onclick:()=>{mode='mine';render();}},'내 가능일 체크'),
      h('button',{'aria-pressed':String(mode==='all'),onclick:()=>{mode='all';render();}},'겹치는 날 보기')),
    h('div',{class:'cal-head'},
      h('button',{class:'ghost',disabled:prevDisabled,'aria-label':'이전 달',onclick:()=>{cursor=new Date(y,mo-1,1);selected=null;render();}},'‹'),
      h('button',{class:'month-btn','aria-label':'연도와 월 고르기',onclick:()=>{ sheet={mode:'month', year:y}; renderSheet(); }}, h('h2',{},`${y}년 ${mo+1}월`), h('span',{class:'caret','aria-hidden':'true'},'▾')),
      h('button',{class:'ghost','aria-label':'다음 달',onclick:()=>{cursor=new Date(y,mo+1,1);selected=null;render();}},'›')),
    grid,
    mode==='mine'
      ? h('div',{class:'legend'}, h('span',{},'되는 날을 누르면 ',h('b',{style:'color:var(--yes)'},'가능'),', 한 번 더 누르면 취소. 길게 누르면 ',h('b',{style:'color:var(--ev)'},'그날 일정'),' 보기')
      , h('span',{class:'status',style:'margin-left:auto'}, saving||pending ? '저장 중…' : (members[me]?'저장됨':'')))
      : h('div',{class:'legend'}, h('span',{},'진할수록 많이 겹쳐요. 날짜를 누르면 전체 명단이, 길게 누르면 그날 일정이 보여요.')),
    mode==='all' && selected ? detail(selected, t[selected], list) : null
  ));

  // other events
  const evs = Object.entries(events).filter(([,e])=>e.end>=tk).sort((a,b)=>a[1].start.localeCompare(b[1].start) || a[1].end.localeCompare(b[1].end));
  const el = h('div',{class:'best'});
  if (!evs.length) el.append(h('p',{class:'empty'},'아직 등록된 일정이 없어요. 달력에서 날짜를 길게 누르면 그날 일정을 보고 추가할 수 있어요.'));
  for (const [id,e] of evs){
    const by = members[e.by];
    const own = e.by===me;
    el.append(h(own?'button':'div',{class:'bitem',onclick: own ? ()=>openSheet({id,...e}) : null},
      tint(h('span',{class:'d'}, range(e.start,e.end)), e.by),
      h('span',{class:'evtitle'}, e.title),
      h('span',{class:'who',style:'font-size:12px'}, own ? '내 일정 ›' : (by ? by.nick : ''))));
  }
  kids.push(h('section',{class:'panel'}, h('div',{class:'panel-head'}, h('h2',{},'기타 일정'), h('button',{disabled:!canWrite,onclick:()=>openSheet({start: selected && selected>=tk ? selected : tk})},'+ 일정 추가')), el));

  // best dates
  const best = Object.entries(t).filter(([k])=>k>=tk)
    .map(([k,c])=>({k, y:c.yes.length, m:c.maybe.length, c}))
    .filter(x=>x.y>0).sort((a,b)=> (b.y+b.m*0.4)-(a.y+a.m*0.4) || a.k.localeCompare(b.k)).slice(0,5);
  const bl = h('div',{class:'best'});
  if (!best.length) bl.append(h('p',{class:'empty'}, n<2 ? '친구들이 들어와서 날짜를 체크하면 여기에 많이 겹치는 날이 나와요.' : '아직 겹치는 날이 없어요. 각자 되는 날을 더 체크해 보세요.'));
  for (const b of best){
    bl.append(h('button',{class:'bitem',onclick:()=>{ const [yy,mm]=b.k.split('-').map(Number); cursor=new Date(yy,mm-1,1); mode='all'; selected=b.k; render(); }},
      h('span',{class:'d'},fmt(b.k)),
      h('span',{class:'who'}, b.c.yes.map(m=>m.nick).join(', ')),
      b.y===n && n>1 ? h('span',{class:'pill'},'모두 가능') : h('span',{class:'score'},`${b.y}/${n}`)));
  }
  kids.push(h('section',{class:'panel'}, h('h2',{},'제일 많이 되는 날'), bl));

  // leave
  if (members[me]) kids.push(confirmLeave
    ? h('div',{class:'confirm'}, '정말 이 모임에서 나갈까요? 내가 체크한 날짜도 지워져요.', h('button',{onclick:leaveGroup},'나가기'), h('button',{class:'ghost',onclick:()=>{confirmLeave=false;render();}},'취소'))
    : h('div',{}, h('button',{class:'ghost',onclick:()=>{confirmLeave=true;render();}},'모임 나가기')));
  return kids;
}
function syncEvSubs(){
  if (evSubs.all) return;
  const g = gid;
  evSubs.all = db.collection(`groups/${g}/events`).onSnapshot(s=>{
    const n = {}; for (const d of s.docs) n[d.id] = d.data();
    events = n; render(); if (sheet && sheet.mode==='day') renderSheet();
  }, (e)=>console.error(e));
}
async function writeMyEvent(id, body){
  const ref = db.doc(`groups/${gid}/events/${id}`);
  if (body) await ref.set({ ...body, by: me }); else await ref.delete();
}
function newId(){ const a='abcdefghijkmnopqrstuvwxyz23456789'; let s=''; for (const x of crypto.getRandomValues(new Uint32Array(14))) s+=a[x%a.length]; return s; }
function eventsOn(k){ return Object.entries(events).filter(([,e])=>e.start<=k && k<=e.end).sort((a,b)=>a[1].start.localeCompare(b[1].start)); }
function short(k){ const [,m,d]=k.split('-').map(Number); return `${m}.${d}`; }
function range(a,b){ return a===b ? fmt(a) : `${short(a)} ~ ${short(b)}`; }
function evChips(list){
  if (!list.length) return null;
  const box = h('span',{class:'evs'});
  box.append(tint(h('span',{class:'ev'}, list[0][1].title), list[0][1].by, true));
  if (list.length>1) box.append(h('span',{class:'ev more'},`+일정 ${list.length-1}`));
  return box;
}
function startPress(e,k){
  endPress();
  if (e.button && e.button!==0) return;
  press = { x:e.clientX, y:e.clientY, t:setTimeout(()=>{
    press = null; suppress = true; setTimeout(()=>{ suppress=false; }, 700);
    try{ navigator.vibrate && navigator.vibrate(15); }catch(_){}
    openDay(k);
  }, 500) };
}
function movePress(e){ if (press && Math.hypot(e.clientX-press.x, e.clientY-press.y) > 10) endPress(); }
function endPress(){ if (press){ clearTimeout(press.t); press=null; } }

function openDay(k){ sheet = { mode:'day', k }; renderSheet(); }
function openSheet(init){
  if (!canWrite){ toast('보기 전용이라 일정을 추가할 수 없어요'); return; }
  if (init.id && init.by && init.by!==me){ toast('일정은 등록한 사람만 고칠 수 있어요'); return; }
  sheet = { mode:'form', id: init.id||null, title: init.title||'', start: init.start, end: init.end||init.start, back: init.back||null };
  renderSheet();
  if (!sheet.id) setTimeout(()=>{ const t=document.getElementById('evTitle'); if (t) t.focus(); }, 60);
}
function closeSheet(){ sheet = null; renderSheet(); }
function sheetShell(title, ...kids){
  return h('div',{class:'sheet-back',onclick:(ev)=>{ if (ev.target===ev.currentTarget) closeSheet(); }},
    h('div',{class:'sheet',role:'dialog','aria-modal':'true','aria-labelledby':'sheetTitle'}, h('h2',{id:'sheetTitle'},title), ...kids));
}
function renderSheet(){
  const root = document.getElementById('sheetRoot');
  if (!sheet){ root.replaceChildren(); return; }
  if (sheet.mode==='day') return renderDay(root);
  if (sheet.mode==='nick') return renderNick(root);
  if (sheet.mode==='month') return renderMonth(root);
  const t = h('input',{id:'evTitle',maxlength:'30',value:sheet.title});
  const s = h('input',{id:'evStart',type:'date',value:sheet.start});
  const e = h('input',{id:'evEnd',type:'date',value:sheet.end,min:sheet.start});
  s.addEventListener('change',()=>{ e.min = s.value; if (!e.value || e.value < s.value) e.value = s.value; });
  const err = h('p',{class:'note warn',hidden:true});
  const fail = (m)=>{ err.textContent=m; err.hidden=false; };
  const editing = sheet.id, back = sheet.back;
  const done = ()=>{ if (back) openDay(back); else closeSheet(); };
  const saveBtn = h('button',{class:'primary',onclick:async()=>{
    const body = { gid, title:t.value.trim(), start:s.value, end:e.value||s.value };
    if (!body.title) return fail('일정 이름을 적어 주세요.');
    if (!body.start) return fail('시작 날짜를 골라 주세요.');
    if (body.end < body.start) return fail('끝 날짜가 시작 날짜보다 빨라요.');
    saveBtn.disabled = true;
    try{
      const prev = editing && events[editing];
      await writeMyEvent(editing || newId(), { ...body, createdAt: (prev && prev.createdAt) || Date.now() });
      toast(editing ? '일정을 고쳤어요' : '일정을 추가했어요'); done();
    }catch(x){ saveBtn.disabled=false; console.error(x); fail('저장하지 못했어요. 인터넷 연결을 확인해 주세요.'); }
  }}, editing ? '저장' : '추가');
  let armed = false;
  const delBtn = editing ? h('button',{class:'ghost',style:'margin-left:auto;color:var(--sun)',onclick:async()=>{
    if (!armed){ armed=true; delBtn.textContent='한 번 더 누르면 삭제'; return; }
    delBtn.disabled = true;
    try{ await writeMyEvent(editing, null); toast('일정을 지웠어요'); done(); }
    catch(x){ delBtn.disabled=false; fail('지우지 못했어요.'); }
  }},'삭제') : null;
  root.replaceChildren(sheetShell(editing ? '일정 고치기' : '기타 일정 추가',
    h('label',{for:'evTitle'},'일정 이름',t),
    h('div',{class:'two'}, h('label',{for:'evStart'},'시작',s), h('label',{for:'evEnd'},'끝 (하루면 그대로)',e)),
    err,
    h('div',{class:'row'}, saveBtn, h('button',{class:'ghost',onclick:done},'취소'), delBtn)));
}
function renderMonth(root){
  const cy = cursor.getFullYear(), cm = cursor.getMonth();
  const now = new Date(), ny = now.getFullYear(), nm = now.getMonth();
  const yr = sheet.year;
  const go = (yy, mm)=>{ cursor = new Date(yy, mm, 1); selected = null; closeSheet(); render(); };
  const grid = h('div',{class:'mgrid'});
  for (let m=0; m<12; m++){
    const cls = 'mcell' + (yr===cy && m===cm ? ' on' : '') + (yr===ny && m===nm ? ' now' : '');
    grid.append(h('button',{class:cls,onclick:()=>go(yr,m)}, `${m+1}월`));
  }
  root.replaceChildren(sheetShell('연도와 월 고르기',
    h('div',{class:'yrow'},
      h('button',{class:'ghost','aria-label':'이전 해',onclick:()=>{ sheet.year--; renderSheet(); }},'‹'),
      h('strong',{class:'yval'},`${yr}년`),
      h('button',{class:'ghost','aria-label':'다음 해',onclick:()=>{ sheet.year++; renderSheet(); }},'›')),
    grid,
    h('div',{class:'row'}, h('button',{onclick:()=>go(ny,nm)},'이번 달로'), h('button',{class:'ghost',onclick:closeSheet},'닫기'))));
}
function renderNick(root){
  const cur = (members[me] && members[me].nick) || '';
  const inp = h('input',{id:'nickInput',maxlength:'12',value:cur});
  const err = h('p',{class:'note warn',hidden:true});
  const save = h('button',{class:'primary',onclick:async()=>{
    const nick = inp.value.trim();
    if (!nick){ err.textContent='이름을 적어 주세요.'; err.hidden=false; return; }
    if (nick===cur) return closeSheet();
    save.disabled = true;
    try{ await db.doc(`groups/${gid}/members/${me}`).update({ nick }); rememberNick(nick); toast('이름을 바꿨어요'); closeSheet(); }
    catch(x){ save.disabled=false; err.textContent='바꾸지 못했어요. 잠시 후 다시 해 주세요.'; err.hidden=false; }
  }},'저장');
  inp.addEventListener('keydown',(e)=>{ if (e.key==='Enter') save.click(); });
  root.replaceChildren(sheetShell('내 이름 변경',
    h('p',{class:'sub',style:'margin:0'},`"${group.name}" 모임에서 친구들에게 보이는 이름이에요.`),
    h('label',{for:'nickInput'},'이름',inp), err,
    h('div',{class:'row'}, save, h('button',{class:'ghost',onclick:closeSheet},'취소'))));
  setTimeout(()=>inp.focus(),60);
}
function renderDay(root){
  const k = sheet.k, list = eventsOn(k);
  const avail = memberList().filter(m=>(m.yes||[]).includes(k));
  const box = h('div',{class:'best'});
  if (!list.length) box.append(h('p',{class:'empty'},'이 날 등록된 일정이 없어요.'));
  for (const [id,e] of list){
    const own = e.by===me, by = members[e.by];
    box.append(h(own?'button':'div',{class:'bitem',onclick: own ? ()=>openSheet({id,...e,back:k}) : null},
      tint(h('span',{class:'d'}, e.start===e.end ? '하루' : `${short(e.start)} ~ ${short(e.end)}`), e.by),
      h('span',{class:'evtitle'}, e.title),
      h('span',{class:'who',style:'font-size:12px'}, own ? '수정 ›' : (by ? by.nick : ''))));
  }
  root.replaceChildren(sheetShell(fmt(k),
    h('div',{class:'panel-head'}, h('span',{class:'sub',style:'margin:0'},'기타 일정'),
      h('button',{class:'primary','aria-label':'이 날 일정 추가',disabled:!canWrite,onclick:()=>openSheet({start:k,back:k})},'+')),
    box,
    h('p',{class:'sub',style:'margin:0'}, avail.length ? `이 날 가능: ${avail.map(m=>m.nick).join(', ')}` : '이 날 가능하다고 한 사람은 아직 없어요.'),
    h('div',{class:'row'}, h('button',{class:'ghost',onclick:closeSheet},'닫기'))));
}
document.addEventListener('keydown',(e)=>{ if (e.key==='Escape' && sheet) closeSheet(); });

function nameList(c){
  const all = [...c.yes.map(m=>({m,mb:false})), ...c.maybe.map(m=>({m,mb:true}))];
  const box = h('span',{class:'names'});
  const max = all.length > 3 ? 2 : 3;
  for (const {m,mb} of all.slice(0,max)){
    const dot = h('i'); dot.style.background = colorOf(m.id);
    const nmEl = h('span',{class:'nm'}, dot, h('span',{}, m.nick)); tint(nmEl, m.id); box.append(nmEl);
  }
  if (all.length > max) box.append(h('span',{class:'nm more'},`+${all.length-max}명`));
  return box;
}
function detail(k, c, list){
  c = c || {yes:[],maybe:[]};
  const no = list.filter(m=>!c.yes.includes(m));
  const line = (lab, arr, color)=>h('div',{class:'ln'}, h('b',{style:`color:${color}`},lab), h('span',{}, arr.length ? arr.map(m=>m.nick).join(', ') : '–'));
  const ev = eventsOn(k);
  return h('div',{class:'detail note'}, h('strong',{},fmt(k)), ev.length ? h('div',{class:'ln'}, h('b',{style:'color:var(--ev)'},'일정'), h('span',{}, ev.map(([,e])=>e.title).join(', '))) : null, line('가능',c.yes,'var(--yes)'), line('미정',no,'var(--muted)'));
}

function render(){
  const header = app.firstElementChild;
  const body = view==='home' ? renderHome() : renderGroup();
  header.hidden = view!=='home';
  app.replaceChildren(header, ...body);
}
document.addEventListener('visibilitychange', ()=>{ if (document.hidden) flush(); });

async function copyText(text){
  try{ await navigator.clipboard.writeText(text); return true; }catch(e){}
  try{
    const ta = h('textarea',{style:'position:fixed;opacity:0;top:0;left:0'}); ta.value = text; document.body.append(ta);
    ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  }catch(e){ return false; }
}

// 안드로이드 뒤로가기: 창 닫기 → 모임 목록 → 앱 종료
if (Capacitor.isNativePlatform()){
  document.documentElement.classList.add('native');
  CapApp.addListener('backButton', ()=>{
    if (sheet) closeSheet();
    else if (view==='group') goHome();
    else CapApp.exitApp();
  });
}
boot();