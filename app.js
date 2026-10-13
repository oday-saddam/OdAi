'use strict';
/* ========== أدوات عامة ========== */
const API='https://openrouter.ai/api/v1';
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const ic=(n,c='')=>`<svg class="i ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const money=n=>{n=+n||0;return '$'+(n===0?'0.00':n<0.01?n.toFixed(5):n<1?n.toFixed(4):n.toFixed(2))};
const sleep=(ms,sig)=>new Promise((res,rej)=>{const t=setTimeout(res,ms);sig&&sig.addEventListener('abort',()=>{clearTimeout(t);rej(new DOMException('Aborted','AbortError'))})});
const fetchDeadline=async(url,init={},ms=90000)=>{let timed=false;const c=new AbortController();const t=setTimeout(()=>{timed=true;c.abort()},ms);const parent=init.signal;const stop=()=>c.abort();parent&&parent.addEventListener('abort',stop,{once:true});try{return await fetch(url,{...init,signal:c.signal})}catch(e){if(timed)throw new Error('انتهت مهلة التوليد. جرّب نموذجاً أو مزوّداً آخر.');throw e}finally{clearTimeout(t);parent&&parent.removeEventListener('abort',stop)}};
const LOGO=`<svg class="logo" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="14" fill="#23272c"/><circle cx="24" cy="24" r="9.5" fill="none" stroke="var(--ac)" stroke-width="4"/><circle cx="34.5" cy="13.5" r="3" fill="var(--ac)"/></svg>`;
let toastT;const toast=m=>{const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('on'),2200)};
const copy=t=>navigator.clipboard.writeText(t).then(()=>toast('تم النسخ'),()=>toast('تعذّر النسخ'));

/* ========== التخزين ========== */
const DB={db:null,
  open(){return new Promise((res,rej)=>{const r=indexedDB.open('odai',1);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('chats',{keyPath:'id'});d.createObjectStore('projects',{keyPath:'id'})};r.onsuccess=()=>{this.db=r.result;res()};r.onerror=()=>rej(r.error)})},
  tx(s,m,f){return new Promise((res,rej)=>{if(!this.db)return res(m==='readonly'?[]:null);const t=this.db.transaction(s,m);const q=f(t.objectStore(s));t.oncomplete=()=>res(q&&q.result);t.onerror=()=>rej(t.error)})},
  all(s){return this.tx(s,'readonly',st=>st.getAll())},
  put(s,o){return this.tx(s,'readwrite',st=>st.put(o)).catch(()=>{})},
  del(s,id){return this.tx(s,'readwrite',st=>st.delete(id)).catch(()=>{})},
  clear(s){return this.tx(s,'readwrite',st=>st.clear()).catch(()=>{})}};

const defCfg={sys:'',temp:'',maxTok:'',accent:'#22d3ee',fs:16,model:'openrouter/auto',reasoning:'auto',voice:'alloy',favs:[],limitDaily:'',smartTitle:false,titleModel:'',sttLang:'ar-EG',lastBackup:0,pin:'',pinSalt:''};
let cfg;try{cfg={...defCfg,...JSON.parse(localStorage.getItem('odai.cfg')||'{}')}}catch{cfg={...defCfg}}
let KEY=localStorage.getItem('odai.key')||'';
const saveCfg=()=>localStorage.setItem('odai.cfg',JSON.stringify(cfg));

/* ========== الحالة ========== */
let chats=[],projects=[],cur=null,proj='',models=[],mmap={},acct=null,busy=false,ctl=null,pending=[],stick=true,installEv=null;
const opts={ar:'',vAr:'',vRes:'',vDur:'',img:{}};
let icaps={};
const ILBL={resolution:'الدقة',aspect_ratio:'النسبة',quality:'الجودة',output_format:'الصيغة'};
const getModel=id=>mmap[id]||{id,name:id.split('/').pop(),kind:'text',out:['text'],inn:['text']};
const curModel=()=>getModel(cur.model);
const hdr=()=>({'Authorization':'Bearer '+KEY,'Content-Type':'application/json','HTTP-Referer':location.origin.startsWith('http')?location.origin:'https://odai.app','X-Title':'odAi'});
const newDraft=()=>{cur={id:uid(),title:'محادثة جديدة',projectId:proj,model:cfg.model,reasoning:cfg.reasoning,msgs:[],cost:0,created:Date.now(),updated:Date.now()}};
const persist=c=>DB.put('chats',c);
const recompute=c=>{c.cost=c.msgs.reduce((s,m)=>s+(m.cost||0),0)};
const urls=new WeakMap();
const blobUrl=m=>{if(!m.blob)return'';let u=urls.get(m);if(!u){u=URL.createObjectURL(m.blob);urls.set(m,u)}return u};

/* ========== ماركداون خفيف ========== */
function inl(t){const codes=[];
  t=t.replace(/`([^`\n]+)`/g,(m,c)=>{codes.push(c);return '\u0001'+(codes.length-1)+'\u0001'});
  t=t.replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*\n]*)\*(?!\*)/g,'$1<em>$2</em>').replace(/~~([^~\n]+)~~/g,'<del>$1</del>');
  t=t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return t.replace(/\u0001(\d+)\u0001/g,(m,i)=>'<code>'+codes[i]+'</code>');}
const I=s=>inl(esc(s));
function md(src){
  const blocks=[];
  src=src.replace(/```([\w+#.-]*)[^\S\n]*\n?([\s\S]*?)(```|$)/g,(m,l,c)=>{blocks.push([l,c.replace(/\n$/,'')]);return '\n\u0000'+(blocks.length-1)+'\u0000\n'});
  const maths=[];src=src.replace(MATH_RE,(m,a,b,c,d)=>{maths.push([a!==undefined?a:b!==undefined?b:c!==undefined?c:d,a!==undefined||b!==undefined]);return '\u0002'+(maths.length-1)+'\u0002'});
  const L=src.split('\n');let out='',i=0,para=[];
  const flush=()=>{if(para.length){out+='<p>'+I(para.join('\n')).replace(/\n/g,'<br>')+'</p>';para=[]}};
  const li=/^\s*([-*+]|\d+[.)])\s+/;
  const cells=r=>r.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());
  while(i<L.length){const l=L[i];let m;
    if((m=l.match(/^\u0000(\d+)\u0000$/))){flush();const [lang,c]=blocks[m[1]];out+=`<div class="code"><div class="code-h"><span>${esc(lang||'code')}</span><button data-copy>نسخ</button></div><pre><code>${hl(c,lang)}</code></pre></div>`;i++;continue}
    if(/^\s*$/.test(l)){flush();i++;continue}
    if((m=l.match(/^(#{1,4})\s+(.*)$/))){flush();const n=m[1].length+1;out+=`<h${n}>${I(m[2])}</h${n}>`;i++;continue}
    if(/^\s*([-*_])\1{2,}\s*$/.test(l)){flush();out+='<hr>';i++;continue}
    if(/^>\s?/.test(l)){flush();const q=[];while(i<L.length&&/^>\s?/.test(L[i])){q.push(L[i].replace(/^>\s?/,''));i++}out+='<blockquote>'+I(q.join('\n')).replace(/\n/g,'<br>')+'</blockquote>';continue}
    if(li.test(l)){flush();const ord=/^\s*\d/.test(l);const it=[];while(i<L.length&&li.test(L[i])){it.push(L[i].replace(li,''));i++}out+=`<${ord?'ol':'ul'}>`+it.map(x=>'<li>'+I(x)+'</li>').join('')+`</${ord?'ol':'ul'}>`;continue}
    if(l.includes('|')&&i+1<L.length&&/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(L[i+1])){flush();const h=cells(l);i+=2;const rows=[];while(i<L.length&&L[i].includes('|')&&L[i].trim()){rows.push(cells(L[i]));i++}
      out+='<div class="tbl"><table><thead><tr>'+h.map(x=>'<th>'+I(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+I(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';continue}
    para.push(l);i++}
  flush();return out.replace(/\u0002(\d+)\u0002/g,(m,i)=>mathSpan(maths[i][0],maths[i][1]))}

/* ========== العرض ========== */
const KINDS={text:['نص','text'],image:['صور','image'],video:['فيديو','video'],audio:['صوت','audio']};
const REASON=[['auto','تلقائي','يترك النموذج يقرّر'],['off','إيقاف','بدون تفكير إن أمكن'],['low','منخفض','أسرع وأرخص'],['medium','متوسط','توازن جيد'],['high','عالٍ','تفكير أعمق'],['xhigh','أقصى','الأعمق، وهو الأبطأ والأغلى']];
const thread=$('#thread'),scroller=$('#scroll'),inp=$('#inp');
const scrollEnd=()=>{scroller.scrollTop=scroller.scrollHeight};

function renderAll(){renderSide();renderTop();renderThread();renderOpts();renderCredit();setBusy(busy)}

function renderTop(){
  const m=curModel();
  $('#modelChip').innerHTML=`${ic(KINDS[m.kind][1],'c')}<span>${esc(m.name.replace(/^[^:]+:\s*/,''))}</span>${ic('down')}`;
  const t=$('#thinkChip');t.hidden=m.kind!=='text';
  const lv=REASON.find(r=>r[0]===cur.reasoning)||REASON[0];
  t.innerHTML=`${ic('bulb','c')}<span>${lv[1]}</span>`;t.style.opacity=(mmap[m.id]&&!m.reasoning)?.5:1;
  $('#costChip').innerHTML=`${ic('wallet')}<span>${money(cur.cost)}</span>`;
  inp.placeholder={text:'اكتب رسالتك…',image:'صف الصورة التي تريدها…',video:'صف مشهد الفيديو…',audio:'اكتب النص الذي تريد تحويله إلى صوت…'}[m.kind];
}

function renderSide(){
  const q=$('#q').value.trim().toLowerCase();
  let h=`<div class="sec"><span>المشاريع</span><button class="ic sm" data-a="padd" aria-label="مشروع جديد">${ic('plus')}</button></div>`;
  h+=`<div class="row ${!proj?'on':''}" data-proj=""><span class="t">${ic('chat')}كل المحادثات</span></div>`;
  h+=projects.map(p=>`<div class="row ${proj===p.id?'on':''}" data-proj="${p.id}"><span class="t">${ic('folder')}${esc(p.name)}</span><span class="rowacts"><button class="ic sm" data-a="pedit" data-id="${p.id}" aria-label="تعديل المشروع">${ic('pencil')}</button></span></div>`).join('');
  const list=chats.filter(c=>(!proj||c.projectId===proj)&&(!q||c.title.toLowerCase().includes(q)||c.msgs.some(m=>(m.text||'').toLowerCase().includes(q)))).sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||b.updated-a.updated);
  const n=new Date(),d0=new Date(n.getFullYear(),n.getMonth(),n.getDate()).getTime();
  const g=t=>t>=d0?'اليوم':t>=d0-864e5?'أمس':t>=d0-6*864e5?'آخر 7 أيام':'أقدم';
  let last='';
  for(const c of list){const gg=c.pinned?'المثبّتة':g(c.updated);if(gg!==last){h+=`<div class="sec"><span>${gg}</span></div>`;last=gg}
    h+=`<div class="row ${c.id===cur.id?'on':''}" data-chat="${c.id}"><span class="t">${esc(c.title)}</span><span class="rowacts"><button class="ic sm ${c.pinned?'pinon':''}" data-a="pin" aria-label="تثبيت">${ic('pin')}</button><button class="ic sm" data-a="ren" aria-label="إعادة تسمية">${ic('pencil')}</button><button class="ic sm" data-a="mv" aria-label="نقل إلى مشروع">${ic('move')}</button><button class="ic sm" data-a="rm" aria-label="حذف">${ic('trash')}</button></span></div>`}
  if(!list.length)h+=`<div class="mu pad" style="font-size:.88rem">${q?'لا توجد نتائج.':'لا توجد محادثات بعد.'}</div>`;
  $('#sideList').innerHTML=h;
  $('#brand').innerHTML=`${LOGO}<span>od<b>Ai</b></span>`;
}

function renderCredit(){
  const c=$('#credit');
  if(!KEY){c.innerHTML=`<div class="l"><span>الرصيد</span><b>—</b></div><div class="l"><span>أضف المفتاح لعرضه</span></div>`;return}
  const sp=acct?acct.spent:null,rem=acct?acct.left:null;
  c.innerHTML=`<div class="l"><span>المصروف</span><b class="ac">${sp==null?'…':money(sp)}</b></div><div class="l"><span>المتبقي</span><b>${rem==null?'—':money(rem)}</b></div>`;
}

const VOICES_OAI=['alloy','echo','fable','onyx','nova','shimmer'],VOICES_EL=['george','sarah','adam','alice','bella','brian','charlie','daniel','jessica','roger','will'];
const voicesOf=m=>(m.voices&&m.voices.length)?m.voices:m.id.startsWith('elevenlabs/')?VOICES_EL:VOICES_OAI;
const voiceFor=m=>{const vs=voicesOf(m);return vs.includes(cfg.voice)?cfg.voice:vs[0]};
function renderOpts(){
  const m=curModel(),o=$('#opts');let h='';
  const sel=(id,label,vals,val)=>`<label class="o"><small>${label}</small><select id="${id}" aria-label="${label}"><option value="">تلقائي</option>${vals.map(v=>`<option ${String(v)===String(val)?'selected':''}>${esc(v)}</option>`).join('')}</select></label>`;
  if(m.kind==='image'){const c=icaps[m.id];
    if(c){for(const k of Object.keys(ILBL)){const d=c[k];if(d&&d.type==='enum'&&d.values&&d.values.length)h+=sel('o-i-'+k,ILBL[k],d.values,opts.img[k])}
      if(c.n&&c.n.max>1)h+=sel('o-i-n','العدد',Array.from({length:Math.min(c.n.max,4)},(_,i)=>i+1),opts.img.n);
      if(!c.resolution)h+='<span class="hint" style="align-self:center">الدقة ثابتة في هذا النموذج</span>'}
    else h=sel('o-ar','النسبة',['1:1','16:9','9:16','4:3','3:4','3:2','2:3'],opts.ar)}
  else if(m.kind==='video'){const r=m.raw||{};
    h=sel('o-vAr','النسبة',r.supported_aspect_ratios||['16:9','9:16','1:1'],opts.vAr);
    if(r.supported_resolutions)h+=sel('o-vRes','الدقة',r.supported_resolutions,opts.vRes);
    if(r.supported_durations)h+=sel('o-vDur','المدة (ث)',r.supported_durations,opts.vDur);}
  else if(m.kind==='audio')h=`<label class="o"><small>الصوت</small><select id="o-voice" aria-label="الصوت">${voicesOf(m).map(v=>`<option ${v===voiceFor(m)?'selected':''}>${esc(v)}</option>`).join('')}</select></label>`;
  o.innerHTML=h;
}

function msgHTML(m,i){
  if(m.role==='user'){
    const im=(m.imgs&&m.imgs.length)?`<div class="thumbs">${m.imgs.map(u=>`<img src="${u}" alt="">`).join('')}</div>`:'';
    return `<div class="msg u" data-i="${i}"><div class="bub" dir="auto">${im}${fileChips(m)}${esc(m.text||'')}</div>${busy?'':`<div class="acts uacts"><button class="ic" data-act="edit" aria-label="تعديل وإعادة إرسال">${ic('pencil')}</button><button class="ic" data-act="copy" aria-label="نسخ">${ic('copy')}</button></div>`}</div>`}
  const last=i===cur.msgs.length-1;
  let media='';
  if(m.imgs&&m.imgs.length)media+=m.imgs.map((u,j)=>`<img src="${u}" alt="صورة مولّدة"><a class="dl" href="${u}" download="odai-${m.id}-${j+1}.png">${ic('download')}تنزيل الصورة</a>`).join('');
  if(m.blob&&m.k==='video')media+=`<video controls playsinline src="${blobUrl(m)}"></video><a class="dl" href="${blobUrl(m)}" download="odai-${m.id}.mp4">${ic('download')}تنزيل الفيديو</a>`;
  if(m.blob&&m.k==='audio')media+=`<audio controls src="${blobUrl(m)}"></audio><a class="dl" href="${blobUrl(m)}" download="odai-${m.id}.${m.blob.type==='audio/mpeg'?'mp3':'wav'}">${ic('download')}تنزيل الصوت</a>`;
  const think=m.reasoning?`<details class="think" ${m.streaming&&!m.text?'open':''}><summary>${ic('bulb')}التفكير</summary><div class="tbody" dir="auto">${esc(m.reasoning)}</div></details>`:'';
  const status=m.streaming&&(m.status||(!m.text&&!m.reasoning))?`<div class="status"><span class="dot"></span>${esc(m.status||'جارٍ الكتابة…')}</div>`:'';
  const acts=m.streaming?'':`<div class="acts"><button class="ic" data-act="copy" aria-label="نسخ">${ic('copy')}</button>${last?`<button class="ic" data-act="regen" aria-label="إعادة التوليد">${ic('refresh')}</button>`:''}<button class="ic" data-act="del" aria-label="حذف الرسالة">${ic('trash')}</button>${m.cost?`<small>${money(m.cost)}</small>`:''}</div>`;
  return `<div class="msg a" data-i="${i}"><div class="who"><span>${esc(getModel(m.model).name)}</span><i></i></div>${think}${status}<div class="body md" dir="auto">${m.err?`<div class="err">${esc(m.err)}</div>`:''}<div class="media">${media}</div>${m.text?md(m.text):''}</div>${srcHTML(m)}${acts}</div>`}

function renderThread(){
  if(!cur.msgs.length){
    thread.innerHTML=`<div class="empty">${LOGO}<h1>od<span>Ai</span></h1><p>${KEY?'نص وصور وفيديو وصوت، كلها من مفتاح OpenRouter واحد. اختر نموذجاً من الأعلى وابدأ.':'أضف مفتاح OpenRouter لتبدأ.'}</p>${KEY?'':`<button class="btn pri" data-go="settings">${ic('key')}إضافة المفتاح</button>`}</div>`;return}
  thread.innerHTML=cur.msgs.map(msgHTML).join('');
  if(stick)scrollEnd();
}
let raf=0;
function schedule(chat){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;if(chat!==cur)return;const i=cur.msgs.length-1,el=thread.querySelector(`.msg[data-i="${i}"]`);if(el)el.outerHTML=msgHTML(cur.msgs[i],i);else renderThread();if(stick)scrollEnd()})}

function setBusy(b){
  const s=$('#send');s.innerHTML=b?ic('stop','fill'):ic('send');s.setAttribute('aria-label',b?'إيقاف':'إرسال');s.disabled=!b&&!inp.value.trim()&&!pending.length;
}
function renderPending(){$('#pend').innerHTML=pending.map((u,i)=>`<div><img src="${u}" alt=""><button data-rm="${i}" aria-label="إزالة">${ic('x')}</button></div>`).join('');setBusy(busy)}
const autosize=()=>{inp.style.height='auto';inp.style.height=Math.min(inp.scrollHeight,innerHeight*.4)+'px'};

/* ========== النوافذ ========== */
function modal(html,cls=''){closeModal();const r=document.createElement('div');r.className='modal';r.innerHTML=`<div class="sheet ${cls}" role="dialog" aria-modal="true">${html}</div>`;r.addEventListener('mousedown',e=>{if(e.target===r)closeModal()});r.addEventListener('click',e=>{if(e.target.closest('[data-x]'))closeModal()});$('#mr').append(r);return r.firstElementChild}
const closeModal=()=>{$('#mr').innerHTML=''};
const closeViewer=()=>{const v=document.querySelector('.viewer');if(v)v.remove()};
addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();closeViewer()}});


function openViewer(src){
  closeViewer();
  const v=document.createElement('div');v.className='viewer';
  v.innerHTML=`<div class="vbar"><button class="ic" data-v aria-label="إغلاق">${ic('x')}</button><span class="vdim"></span><a class="ic" href="${src}" download="odai-image.png" aria-label="تنزيل">${ic('download')}</a></div><img src="${src}" alt="" draggable="false">`;
  document.body.append(v);
  const img=v.querySelector('img');let sc=1,x=0,y=0,d0=0,s0=1,moved=false,last=0;const pts=new Map();
  const apply=()=>{if(sc<=1){x=0;y=0}img.style.transform=`translate(${x}px,${y}px) scale(${sc})`};
  img.onload=()=>{v.querySelector('.vdim').textContent=img.naturalWidth+'×'+img.naturalHeight};
  v.addEventListener('click',e=>{if(e.target.closest('[data-v]')||e.target===v)closeViewer()});
  img.addEventListener('pointerdown',e=>{img.setPointerCapture(e.pointerId);pts.set(e.pointerId,{x:e.clientX,y:e.clientY});moved=false;
    if(pts.size===2){const [a,b]=[...pts.values()];d0=Math.hypot(a.x-b.x,a.y-b.y)||1;s0=sc}});
  img.addEventListener('pointermove',e=>{const p=pts.get(e.pointerId);if(!p)return;const dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;
    if(pts.size===2){const [a,b]=[...pts.values()];sc=Math.min(6,Math.max(1,s0*Math.hypot(a.x-b.x,a.y-b.y)/d0));moved=true}
    else if(sc>1){x+=dx;y+=dy;moved=true}
    else if(Math.abs(dx)+Math.abs(dy)>3)moved=true;
    apply()});
  img.addEventListener('pointerup',e=>{pts.delete(e.pointerId);
    if(!pts.size&&!moved){const t=Date.now();if(t-last<300){sc=sc>1?1:2.5;apply();last=0}else last=t}});
  img.addEventListener('pointercancel',e=>pts.delete(e.pointerId));
  v.addEventListener('wheel',e=>{e.preventDefault();sc=Math.min(6,Math.max(1,sc*(e.deltaY<0?1.15:.87)));apply()},{passive:false});
}

function openModels(){
  let tab=curModel().kind,q='';
  const sh=modal(`<div class="mh"><span>اختر النموذج</span><button class="ic" data-x aria-label="إغلاق">${ic('x')}</button></div><div class="tabs" id="tabs"></div><div class="search" style="margin:0">${ic('search')}<input id="mq" placeholder="ابحث بالاسم أو المعرّف" autocomplete="off"></div><div class="mlist" id="mlist"></div>`,'tall');
  const fav=m=>cfg.favs.includes(m.id)?1:0;
  const price=v=>!isFinite(v)?'':v===0?'مجاني':'$'+(v<1?v.toFixed(2):v.toFixed(v<10?2:1));
  const draw=()=>{
    $('#tabs',sh).innerHTML=Object.entries(KINDS).map(([k,[l,icn]])=>`<button data-t="${k}" class="${k===tab?'on':''}">${ic(icn)}${l}<small>${models.filter(m=>m.kind===k).length}</small></button>`).join('');
    let L=models.filter(m=>m.kind===tab&&(!q||(m.name+' '+m.id).toLowerCase().includes(q)));
    L.sort((a,b)=>fav(b)-fav(a)||(b.created||0)-(a.created||0));
    const tot=L.length;L=L.slice(0,120);
    $('#mlist',sh).innerHTML=L.map(m=>{
      const b=[];if(m.reasoning)b.push(ic('bulb')+' تفكير');if(m.vision&&m.kind==='text')b.push('رؤية');
      if(m.ctx)b.push(Math.round(m.ctx/1000)+'k');
      if(m.kind==='text'&&isFinite(m.pin))b.push(price(m.pin)+' / '+price(m.pout)+' لكل 1M');
      else if(m.pimg&&+m.pimg>0)b.push('$'+(+m.pimg).toFixed(3)+' / صورة');
      return `<div class="mrow ${m.id===cur.model?'on':''}" data-m="${esc(m.id)}"><div class="mi"><div class="n">${esc(m.name)}</div><div class="s">${esc(m.id)}</div><div class="bds">${b.map(x=>`<span class="bd">${x}</span>`).join('')}</div></div><button class="ic star ${fav(m)?'on':''}" data-f="${esc(m.id)}" aria-label="تفضيل">${ic('star')}</button></div>`}).join('')
      ||`<div class="mu pad">${models.length?'لا توجد نتائج.':'لم تُحمَّل قائمة النماذج. تحقق من الاتصال ثم أعد المحاولة.'}</div>`;
    if(tot>120)$('#mlist',sh).insertAdjacentHTML('beforeend',`<div class="mu pad" style="font-size:.85rem">يُعرض أول 120 من ${tot}. ابحث لتضييق النتائج.</div>`);
  };
  sh.addEventListener('click',e=>{
    const t=e.target.closest('[data-t]');if(t){tab=t.dataset.t;draw();return}
    const f=e.target.closest('[data-f]');if(f){const id=f.dataset.f;cfg.favs=cfg.favs.includes(id)?cfg.favs.filter(x=>x!==id):[...cfg.favs,id];saveCfg();draw();return}
    const r=e.target.closest('[data-m]');if(r){setModel(r.dataset.m);closeModal()}});
  $('#mq',sh).addEventListener('input',e=>{q=e.target.value.trim().toLowerCase();draw()});
  draw();
}
function setModel(id){cur.model=id;cfg.model=id;saveCfg();if(chats.includes(cur))persist(cur);renderTop();renderOpts()}

function openThink(){
  const m=curModel();
  if(m.kind!=='text')return;
  const sh=modal(`<div class="mh"><span>مستوى التفكير</span><button class="ic" data-x aria-label="إغلاق">${ic('x')}</button></div>${REASON.map(([k,l,d])=>`<button class="opt ${k===cur.reasoning?'on':''}" data-r="${k}"><b>${l}</b><small>${d}</small></button>`).join('')}${mmap[m.id]&&!m.reasoning?'<p class="hint pad">هذا النموذج لا يعلن دعم ضبط التفكير، وقد يتجاهل الإعداد.</p>':''}`);
  sh.addEventListener('click',e=>{const r=e.target.closest('[data-r]');if(r){cur.reasoning=r.dataset.r;cfg.reasoning=cur.reasoning;saveCfg();if(chats.includes(cur))persist(cur);renderTop();closeModal()}});
}

const ACC=['#22d3ee','#38bdf8','#2dd4bf','#a78bfa','#fbbf24','#fb7185'];
function applyTheme(){document.documentElement.style.setProperty('--ac',cfg.accent);document.documentElement.style.fontSize=cfg.fs+'px'}

function openSettings(){
  const sh=modal(`<div class="mh"><span>الإعدادات</span><button class="ic" data-x aria-label="إغلاق">${ic('x')}</button></div>
  <div class="fld"><label for="s-key">مفتاح OpenRouter</label><div class="rowf" style="gap:.4rem"><input class="in" id="s-key" type="password" dir="ltr" placeholder="sk-or-v1-…" value="${esc(KEY)}" autocomplete="off" spellcheck="false" style="flex:1"><button class="ic" id="s-eye" style="flex:none;border:1px solid var(--bd)" aria-label="إظهار">${ic('eye')}</button></div>
    <div class="rowf"><button class="btn pri" id="s-save">حفظ والتحقق</button>${KEY?'<button class="btn dng" id="s-out">إزالة المفتاح</button>':''}</div><div class="hint" id="s-st">يُحفظ المفتاح في متصفحك فقط، ويُرسل إلى openrouter.ai مباشرة.</div></div>
  <div class="fld"><label for="s-sys">تعليمات عامة للنموذج (تُرسل مع كل محادثة)</label><textarea class="in" id="s-sys" placeholder="مثال: أجب بالعربية وكن مختصراً.">${esc(cfg.sys)}</textarea></div>
  <div class="rowf"><div class="fld"><label for="s-temp">الحرارة (اختياري)</label><input class="in" id="s-temp" type="number" step="0.1" min="0" max="2" dir="ltr" value="${esc(cfg.temp)}" placeholder="تلقائي"></div><div class="fld"><label for="s-max">أقصى عدد رموز (اختياري)</label><input class="in" id="s-max" type="number" min="1" dir="ltr" value="${esc(cfg.maxTok)}" placeholder="تلقائي"></div></div>
  <div class="fld"><label>اللون المميّز</label><div class="sw">${ACC.map(c=>`<button style="--c:${c}" data-c="${c}" class="${c===cfg.accent?'on':''}" aria-label="${c}"></button>`).join('')}</div></div>
  <div class="fld"><label for="s-fs">حجم الخط</label><input type="range" id="s-fs" min="15" max="20" value="${cfg.fs}"></div>
  <div class="fld"><label>البيانات</label><div class="rowf"><button class="btn" id="s-exp">${ic('download')}تصدير</button><button class="btn" id="s-imp">${ic('upload')}استيراد</button></div><button class="btn dng" id="s-clr">حذف كل المحادثات</button><div class="hint">التصدير لا يتضمن المفتاح ولا مقاطع الفيديو والصوت.</div></div>
  ${installEv?`<button class="btn pri" id="s-inst" style="width:100%">تثبيت التطبيق على الجهاز</button>`:''}`);
  const g=id=>$(id,sh);
  g('#s-eye').onclick=()=>{const k=g('#s-key');k.type=k.type==='password'?'text':'password'};
  g('#s-save').onclick=async()=>{KEY=g('#s-key').value.trim();localStorage.setItem('odai.key',KEY);const st=g('#s-st');st.className='hint';st.textContent='جارٍ التحقق…';
    await refreshAcct();await loadModels();renderAll();
    if(acct){st.className='hint ok';st.textContent='تم التحقق من المفتاح.'}else{st.className='hint bad';st.textContent='تعذّر التحقق. تأكد من المفتاح ومن الاتصال.'}};
  if(g('#s-out'))g('#s-out').onclick=()=>{KEY='';localStorage.removeItem('odai.key');acct=null;closeModal();renderAll();toast('أُزيل المفتاح')};
  g('#s-sys').onchange=e=>{cfg.sys=e.target.value;saveCfg()};
  g('#s-temp').onchange=e=>{cfg.temp=e.target.value;saveCfg()};
  g('#s-max').onchange=e=>{cfg.maxTok=e.target.value;saveCfg()};
  g('#s-fs').oninput=e=>{cfg.fs=+e.target.value;saveCfg();applyTheme()};
  sh.querySelector('.sw').onclick=e=>{const b=e.target.closest('[data-c]');if(!b)return;cfg.accent=b.dataset.c;saveCfg();applyTheme();sh.querySelectorAll('.sw button').forEach(x=>x.classList.toggle('on',x===b))};
  g('#s-exp').onclick=exportData;
  g('#s-imp').onclick=()=>{const f=document.createElement('input');f.type='file';f.accept='application/json';f.onchange=()=>importData(f.files[0]);f.click()};
  g('#s-clr').onclick=async()=>{if(!confirm('سيُحذف كل شيء: المحادثات والمشاريع. متأكد؟'))return;await DB.clear('chats');await DB.clear('projects');chats=[];projects=[];proj='';newDraft();closeModal();renderAll()};
  if(g('#s-inst'))g('#s-inst').onclick=()=>{installEv.prompt();installEv=null;closeModal()};
}
function exportData(){
  const data={v:1,projects,chats:chats.map(c=>({...c,msgs:c.msgs.map(({blob,...m})=>m)}))};
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));a.download='odai-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();
}
async function importData(f){
  if(!f)return;try{const d=JSON.parse(await f.text());
    for(const p of d.projects||[]){await DB.put('projects',p);if(!projects.find(x=>x.id===p.id))projects.push(p)}
    for(const c of d.chats||[]){await DB.put('chats',c);if(!chats.find(x=>x.id===c.id))chats.push(c)}
    renderAll();toast('تم الاستيراد')}catch{toast('ملف غير صالح')}
}

function openProject(id){
  const p=projects.find(x=>x.id===id)||{name:'',instructions:''};
  const sh=modal(`<div class="mh"><span>${id?'تعديل المشروع':'مشروع جديد'}</span><button class="ic" data-x aria-label="إغلاق">${ic('x')}</button></div>
  <div class="fld"><label for="p-n">اسم المشروع</label><input class="in" id="p-n" value="${esc(p.name)}"></div>
  <div class="fld"><label for="p-i">تعليمات المشروع (تُضاف لكل محادثة داخله)</label><textarea class="in" id="p-i" placeholder="مثال: أنت مساعد برمجة. أعطني الشيفرة أولاً ثم الشرح.">${esc(p.instructions)}</textarea></div>
  <div class="rowf"><button class="btn pri" id="p-s">حفظ</button>${id?'<button class="btn dng" id="p-d">حذف المشروع</button>':''}</div>`);
  $('#p-s',sh).onclick=()=>{const name=$('#p-n',sh).value.trim();if(!name)return $('#p-n',sh).focus();
    let o=projects.find(x=>x.id===id);if(!o){o={id:uid()};projects.push(o)}o.name=name;o.instructions=$('#p-i',sh).value;DB.put('projects',o);if(!id)proj=o.id;closeModal();renderSide()};
  if(id)$('#p-d',sh).onclick=()=>{if(!confirm('حذف المشروع؟ تبقى محادثاته دون مشروع.'))return;projects=projects.filter(x=>x.id!==id);DB.del('projects',id);chats.forEach(c=>{if(c.projectId===id){c.projectId='';persist(c)}});if(proj===id)proj='';closeModal();renderSide()};
}
function openMove(c){
  const sh=modal(`<div class="mh"><span>نقل المحادثة إلى</span><button class="ic" data-x aria-label="إغلاق">${ic('x')}</button></div><button class="opt ${!c.projectId?'on':''}" data-p=""><b>بدون مشروع</b></button>${projects.map(p=>`<button class="opt ${c.projectId===p.id?'on':''}" data-p="${p.id}"><b>${esc(p.name)}</b></button>`).join('')}${projects.length?'':'<p class="hint pad">أنشئ مشروعاً من قسم المشاريع أولاً.</p>'}`);
  sh.addEventListener('click',e=>{const b=e.target.closest('[data-p]');if(!b)return;c.projectId=b.dataset.p;persist(c);closeModal();renderSide()});
}

/* ========== واجهة OpenRouter ========== */
async function loadModels(){
  try{
    const [a,v]=await Promise.allSettled([fetch(API+'/models?output_modalities=all').then(r=>r.json()),fetch(API+'/videos/models',{headers:KEY?hdr():{}}).then(r=>r.json())]);
    const list=[];
    for(const x of (a.value&&a.value.data)||[]){
      const out=(x.architecture&&x.architecture.output_modalities)||['text'],inn=(x.architecture&&x.architecture.input_modalities)||['text'],sp=x.supported_parameters||[],p=x.pricing||{};
      const kind=out.includes('image')?'image':(out.includes('audio')||out.includes('speech'))?'audio':out.includes('video')?'video':'text';
      list.push({id:x.id,name:x.name||x.id,kind,out,inn,speech:out.includes('speech'),voices:((x.supported_voices||(x.architecture&&x.architecture.supported_voices)||[]).map(v=>typeof v==='string'?v:(v&&(v.id||v.name||v.voice_id))).filter(Boolean)),ctx:x.context_length,reasoning:sp.includes('reasoning')||sp.includes('include_reasoning'),vision:inn.includes('image'),pin:+p.prompt*1e6,pout:+p.completion*1e6,pimg:p.image,created:x.created});
    }
    const idx=Object.fromEntries(list.map(m=>[m.id,m]));
    for(const x of (v.value&&v.value.data)||[]){const id=x.id||x.canonical_slug;if(!id)continue;
      if(idx[id]){idx[id].kind='video';idx[id].raw=x}else{const m={id,name:x.name||id,kind:'video',out:['video'],inn:['text','image'],raw:x,created:x.created};list.push(m);idx[id]=m}}
    if(list.length){models=list;mmap=idx}
  }catch(e){toast('تعذّر تحميل قائمة النماذج')}
  renderTop();renderOpts();
}
async function loadImageCaps(){
  try{const r=await fetch(API+'/images/models');if(!r.ok)return;const j=await r.json();
    for(const x of (j.data||j.models||[]))if(x.id)icaps[x.id]=x.supported_parameters||{};
    renderOpts()}catch{}
}
async function refreshAcct(){
  if(!KEY){acct=null;renderCredit();return}
  try{
    const [c,k]=await Promise.allSettled([fetch(API+'/credits',{headers:hdr()}).then(r=>r.ok?r.json():null),fetch(API+'/key',{headers:hdr()}).then(r=>r.ok?r.json():null)]);
    const cd=c.value&&c.value.data,kd=k.value&&k.value.data;
    if(!cd&&!kd)throw 0;
    const spent=cd?cd.total_usage:kd.usage;
    let left=cd?cd.total_credits-cd.total_usage:null;
    if(kd&&kd.limit_remaining!=null)left=left==null?kd.limit_remaining:Math.min(left,kd.limit_remaining);
    acct={spent,left};
  }catch{acct=null}
  renderCredit();
}
async function apiError(res){
  let m='';try{const j=await res.json();m=(j.error&&(j.error.message||JSON.stringify(j.error)))||''}catch{}
  const map={401:'المفتاح غير صالح أو منتهٍ.',402:'الرصيد غير كافٍ. اشحن حسابك في OpenRouter.',403:'تم حظر الطلب (قد يكون المحتوى مخالفاً لسياسة المزوّد).',404:'النموذج غير متاح حالياً.',429:'تجاوزت الحد المسموح. حاول بعد قليل.'};
  const head=/safety|moderation|content.policy/i.test(m)?'رفض نظام الأمان لدى المزوّد هذا الطلب (قد يكون رفضاً خاطئاً). أعد المحاولة أو غيّر صياغة الوصف قليلاً.':/is a decisions model/i.test(m)?'هذا نموذج «قرارات» (يُرجع احتمالات لا نصوصاً) ولا يعمل في الدردشة. اختر نموذج محادثة آخر.':(map[res.status]||'خطأ '+res.status);
  return new Error(head+(m?'\n'+m:''));
}
async function sse(res,fn){
  const rd=res.body.getReader(),dec=new TextDecoder();let buf='';
  for(;;){const {done,value}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});let k;
    while((k=buf.indexOf('\n'))>=0){const line=buf.slice(0,k).trim();buf=buf.slice(k+1);if(!line.startsWith('data:'))continue;const d=line.slice(5).trim();if(d==='[DONE]')continue;
      let j;try{j=JSON.parse(d)}catch{continue}fn(j)}}
}
const lastUser=c=>[...c.msgs].reverse().find(m=>m.role==='user');
function history(c){
  const sys=[cfg.sys,(projects.find(p=>p.id===c.projectId)||{}).instructions].filter(Boolean).join('\n\n');
  const out=sys?[{role:'system',content:sys}]:[];const lu=lastUser(c);
  for(const m of c.msgs){
    if(m.role==='assistant'){if(m.k!=='text'||!m.text||m.streaming)continue;out.push({role:'assistant',content:m.text});continue}
    if(m.k!=='text'&&m!==lu)continue;
    out.push({role:'user',content:userContent(m)});
  }
  return out;
}

async function runText(chat,a,mod){
  const body={model:mod.id,messages:history(chat),stream:true,usage:{include:true}};
  const lv=chat.reasoning;if(lv==='off')body.reasoning={enabled:false};else if(lv!=='auto')body.reasoning={effort:lv};
  if(cfg.temp!=='')body.temperature=+cfg.temp;if(cfg.maxTok)body.max_tokens=+cfg.maxTok;
  if(chat.web)body.plugins=[{id:'web'}];
  const res=await fetch(API+'/chat/completions',{method:'POST',headers:hdr(),body:JSON.stringify(body),signal:ctl.signal});
  if(!res.ok)throw await apiError(res);
  await sse(res,j=>{
    if(j.error)throw new Error(j.error.message||'خطأ من المزوّد');
    const d=(j.choices&&j.choices[0]&&j.choices[0].delta)||{};
    if(d.reasoning)a.reasoning+=d.reasoning;
    else if(Array.isArray(d.reasoning_details))for(const x of d.reasoning_details)if(x.text)a.reasoning+=x.text;
    if(d.content)a.text+=d.content;
    addSources(a,d.annotations);addSources(a,j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.annotations);
    if(j.usage){a.cost=+j.usage.cost||0}
    schedule(chat);
  });
}
async function runImageChat(chat,a,mod){
  const u=lastUser(chat);
  const content=(u.imgs&&u.imgs.length)?[{type:'text',text:u.text||' '},...u.imgs.map(x=>({type:'image_url',image_url:{url:x}}))]:u.text;
  const body={model:mod.id,messages:[{role:'user',content}],modalities:mod.out.includes('text')?['image','text']:['image'],usage:{include:true}};
  if(opts.ar)body.image_config={aspect_ratio:opts.ar};
  const res=await fetch(API+'/chat/completions',{method:'POST',headers:hdr(),body:JSON.stringify(body),signal:ctl.signal});
  if(!res.ok)throw await apiError(res);
  const j=await res.json();if(j.error)throw new Error(j.error.message||'خطأ من المزوّد');
  const msg=(j.choices&&j.choices[0]&&j.choices[0].message)||{};
  a.text=typeof msg.content==='string'?msg.content:'';
  a.imgs=(msg.images||[]).map(x=>(x.image_url&&x.image_url.url)||x.url).filter(Boolean);
  a.cost=+(j.usage&&j.usage.cost)||0;
  if(!a.imgs.length)throw new Error('لم يُرجع النموذج أي صورة.'+(a.text?'\n'+a.text:''));
}
async function runImage(chat,a,mod){
  const u=lastUser(chat);
  a.status='جارٍ إنشاء الصورة…';schedule(chat);
  const base={model:mod.id,prompt:u.text||' '};
  if(u.imgs&&u.imgs.length)base.input_references=u.imgs.map(x=>({type:'image_url',image_url:{url:x}}));
  const c=icaps[mod.id],extra={};
  if(c){for(const k of Object.keys(ILBL)){const d=c[k],v=opts.img[k];if(v&&d&&d.type==='enum'&&d.values.map(String).includes(String(v)))extra[k]=v}
    if(c.n&&c.n.max>1&&opts.img.n)extra.n=+opts.img.n}
  else if(opts.ar)extra.aspect_ratio=opts.ar;
  const res=await fetchDeadline(API+'/images',{method:'POST',headers:hdr(),body:JSON.stringify({...base,...extra}),signal:ctl.signal},90000);
  if(!res.ok){
    const e1=await apiError(res);
    if(!c&&[400,404,405,422].includes(res.status)){
      try{await runImageChat(chat,a,mod);return}catch(e2){if(e2.name==='AbortError')throw e2}
    }
    throw e1;
  }
  const j=await res.json();if(j.error)throw new Error(j.error.message||'خطأ من المزوّد');
  a.imgs=(j.data||[]).map(x=>x.b64_json?`data:${x.media_type||'image/png'};base64,${x.b64_json}`:x.url).filter(Boolean);
  a.cost=+(j.usage&&j.usage.cost)||0;
  if(!a.imgs.length)throw new Error('لم يُرجع النموذج أي صورة.');
}
function wav(pcm,rate=24000){
  const h=new DataView(new ArrayBuffer(44)),w=(o,s)=>[...s].forEach((c,i)=>h.setUint8(o+i,c.charCodeAt(0)));
  w(0,'RIFF');h.setUint32(4,36+pcm.length,true);w(8,'WAVEfmt ');h.setUint32(16,16,true);h.setUint16(20,1,true);h.setUint16(22,1,true);h.setUint32(24,rate,true);h.setUint32(28,rate*2,true);h.setUint16(32,2,true);h.setUint16(34,16,true);w(36,'data');h.setUint32(40,pcm.length,true);
  return new Blob([h,pcm],{type:'audio/wav'});
}
async function runAudio(chat,a,mod){
  if(!mod.speech)return runAudioChat(chat,a,mod);
  const u=lastUser(chat),body={model:mod.id,input:u.text,response_format:'mp3'},v=voiceFor(mod);
  if(v)body.voice=v;
  a.status='جارٍ توليد الصوت…';schedule(chat);
  const res=await fetch(API+'/audio/speech',{method:'POST',headers:hdr(),body:JSON.stringify(body),signal:ctl.signal});
  if(!res.ok)throw await apiError(res);
  const gid=res.headers.get('X-Generation-Id');
  a.blob=new Blob([await res.arrayBuffer()],{type:'audio/mpeg'});
  if(gid)for(let i=0;i<3&&!a.cost;i++){await sleep(1500,ctl.signal);
    try{const r=await fetch(API+'/generation?id='+encodeURIComponent(gid),{headers:hdr(),signal:ctl.signal});if(r.ok){const g=await r.json();a.cost=+(g.data&&g.data.total_cost)||0}}catch(e){if(e.name==='AbortError')throw e}}
}
async function runAudioChat(chat,a,mod){
  const u=lastUser(chat);
  const body={model:mod.id,messages:[{role:'user',content:u.text}],modalities:['text','audio'],audio:{voice:cfg.voice,format:'pcm16'},stream:true,usage:{include:true}};
  const res=await fetch(API+'/chat/completions',{method:'POST',headers:hdr(),body:JSON.stringify(body),signal:ctl.signal});
  if(!res.ok)throw await apiError(res);
  const parts=[];a.status='جارٍ توليد الصوت…';
  await sse(res,j=>{
    if(j.error)throw new Error(j.error.message||'خطأ من المزوّد');
    const d=(j.choices&&j.choices[0]&&j.choices[0].delta)||{};
    if(d.audio){if(d.audio.data)parts.push(Uint8Array.from(atob(d.audio.data),c=>c.charCodeAt(0)));if(d.audio.transcript)a.text+=d.audio.transcript}
    if(d.content)a.text+=d.content;
    if(j.usage)a.cost=+j.usage.cost||0;
    schedule(chat);
  });
  if(!parts.length)throw new Error('لم يُرجع النموذج أي صوت.');
  a.blob=wav(new Uint8Array(await new Blob(parts).arrayBuffer()));
}
async function runVideo(chat,a,mod){
  const u=lastUser(chat);
  const body={model:mod.id,prompt:u.text};
  if(opts.vAr)body.aspect_ratio=opts.vAr;if(opts.vRes)body.resolution=opts.vRes;if(opts.vDur)body.duration=+opts.vDur;
  if(u.imgs&&u.imgs.length)body.frame_images=[{type:'image_url',image_url:{url:u.imgs[0]},frame_type:'first_frame'}];
  const res=await fetch(API+'/videos',{method:'POST',headers:hdr(),body:JSON.stringify(body),signal:ctl.signal});
  if(!res.ok)throw await apiError(res);
  let j=await res.json();const id=j.id,poll=j.polling_url||`${API}/videos/${id}`,t0=Date.now();
  for(;;){
    a.status=`جارٍ إنشاء الفيديو… ${Math.round((Date.now()-t0)/1000)} ث (قد يستغرق دقائق، أبقِ التطبيق مفتوحاً)`;schedule(chat);
    await sleep(4000,ctl.signal);
    const r=await fetch(poll,{headers:hdr(),signal:ctl.signal});if(!r.ok)throw await apiError(r);j=await r.json();
    if(j.status==='completed')break;
    if(Date.now()-t0>8*60e3)throw new Error('انتهت مهلة إنشاء الفيديو. أوقفنا الانتظار لحماية رصيدك.');
    if(['failed','cancelled','expired'].includes(j.status))throw new Error('فشل إنشاء الفيديو.'+(j.error?'\n'+(j.error.message||j.error):''));
  }
  a.cost=+((j.usage&&j.usage.cost)??j.cost)||0;
  a.status='جارٍ تنزيل الفيديو…';schedule(chat);
  let vr=await fetch(`${API}/videos/${id}/content`,{headers:hdr(),signal:ctl.signal});
  if(!vr.ok&&j.unsigned_urls&&j.unsigned_urls[0])vr=await fetch(j.unsigned_urls[0],{signal:ctl.signal});
  if(!vr.ok)throw await apiError(vr);
  a.blob=new Blob([await vr.blob()],{type:'video/mp4'});
}

async function generate(chat){
  const mod=getModel(chat.model);
  const a={id:uid(),role:'assistant',k:mod.kind,text:'',reasoning:'',imgs:[],model:mod.id,streaming:true,ts:Date.now()};
  chat.msgs.push(a);busy=true;ctl=new AbortController();stick=true;
  if(!chats.includes(chat))chats.unshift(chat);
  persist(chat);
  renderThread();renderSide();setBusy(true);
  try{
    await ({text:runText,image:runImage,video:runVideo,audio:runAudio}[mod.kind])(chat,a,mod);
  }catch(e){
    if(e.name==='AbortError'){if(!a.text&&!a.imgs.length&&!a.blob&&!a.reasoning)chat.msgs.pop()}
    else a.err=(e&&e.message)||String(e);
  }
  a.streaming=false;a.status='';busy=false;ctl=null;
  chat.updated=Date.now();recompute(chat);persist(chat);
  if(chat===cur){renderThread();renderTop()}renderSide();setBusy(false);refreshAcct();
}
function send(){
  if(busy)return;const text=inp.value.trim(),imgs=pending.slice(),files=pfiles.slice();if(!text&&!imgs.length&&!files.length)return;
  if(!KEY){toast('أضف مفتاح OpenRouter أولاً');openSettings();return}
  const mod=curModel();if(!limitOk())return;
  cur.msgs.push({id:uid(),role:'user',k:mod.kind,text,imgs,files,ts:Date.now()});
  if(cur.msgs.length===1)cur.title=(text||(files[0]&&files[0].name)||'صورة').replace(/\s+/g,' ').slice(0,42);
  inp.value='';pending=[];pfiles=[];renderPending();autosize();renderEst();
  generate(cur);
}
function regen(){
  if(busy)return;let i=cur.msgs.length-1;while(i>=0&&cur.msgs[i].role==='assistant')i--;
  if(i<0)return;cur.msgs.length=i+1;generate(cur);
}

/* ========== الأحداث ========== */
const app=$('#app');
$('#openSide').onclick=()=>app.classList.add('open');
$('#closeSide').onclick=$('#scrim').onclick=()=>app.classList.remove('open');
$('#newChat').onclick=()=>{newDraft();app.classList.remove('open');renderAll();inp.focus()};
$('#q').oninput=renderSide;
$('#openSettings').onclick=openSettings;
$('#credit').onclick=()=>{if(!KEY)return openSettings();refreshAcct();toast('جارٍ تحديث الرصيد…')};
$('#modelChip').onclick=openModels;
$('#thinkChip').onclick=openThink;
$('#costChip').onclick=()=>toast('تكلفة هذه المحادثة: '+money(cur.cost));
$('#send').onclick=()=>busy?ctl&&ctl.abort():send();
$('#attach').onclick=()=>$('#file').click();
$('#file').onchange=async e=>{await addFiles(e.target.files);e.target.value=''};
$('#pend').onclick=e=>{const b=e.target.closest('[data-rm]');if(b){pending.splice(+b.dataset.rm,1);renderPending()}};
inp.addEventListener('input',()=>{autosize();setBusy(busy)});
inp.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!matchMedia('(pointer:coarse)').matches){e.preventDefault();send()}});
$('#opts').addEventListener('change',e=>{const id=e.target.id;if(id==='o-voice'){cfg.voice=e.target.value;saveCfg()}else if(id.startsWith('o-i-'))opts.img[id.slice(4)]=e.target.value;else if(id.startsWith('o-'))opts[id.slice(2)]=e.target.value});
thread.addEventListener('load',e=>{const im=e.target;if(im.tagName!=='IMG'||!im.closest('.media'))return;const d=im.nextElementSibling;
  if(d&&d.classList.contains('dl')&&!d.dataset.d){d.dataset.d=1;d.insertAdjacentHTML('beforeend',`<span class="mu" style="direction:ltr"> · ${im.naturalWidth}×${im.naturalHeight}</span>`)}},true);
scroller.addEventListener('scroll',()=>{stick=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<90});

thread.addEventListener('click',e=>{
  if(e.target.closest('[data-go]'))return openSettings();
  const vi=e.target.closest('.media img, .thumbs img');if(vi)return openViewer(vi.src);
  const cb=e.target.closest('[data-copy]');if(cb)return copy(cb.closest('.code').querySelector('code').textContent);
  const a=e.target.closest('[data-act]');if(!a)return;
  const i=+a.closest('.msg').dataset.i,m=cur.msgs[i];
  if(a.dataset.act==='copy')copy(m.text||'');
  else if(a.dataset.act==='regen')regen();
  else if(a.dataset.act==='edit')editMsg(i);
  else if(a.dataset.act==='del'){cur.msgs.splice(i,1);recompute(cur);persist(cur);renderThread();renderTop()}
});
$('#sideList').addEventListener('click',e=>{
  const a=e.target.closest('[data-a]');
  if(a){e.stopPropagation();const row=a.closest('[data-chat]'),c=row&&chats.find(x=>x.id===row.dataset.chat);
    if(a.dataset.a==='padd')openProject('');
    else if(a.dataset.a==='pedit')openProject(a.dataset.id);
    else if(c&&a.dataset.a==='pin'){c.pinned=!c.pinned;persist(c);renderSide()}
    else if(c&&a.dataset.a==='ren'){const t=prompt('اسم المحادثة',c.title);if(t&&t.trim()){c.title=t.trim();persist(c);renderSide()}}
    else if(c&&a.dataset.a==='mv')openMove(c);
    else if(c&&a.dataset.a==='rm'){if(confirm('حذف هذه المحادثة؟')){chats=chats.filter(x=>x!==c);DB.del('chats',c.id);if(cur===c)newDraft();renderAll()}}
    return}
  const p=e.target.closest('[data-proj]');if(p){proj=p.dataset.proj;renderSide();return}
  const r=e.target.closest('[data-chat]');if(r){const c=chats.find(x=>x.id===r.dataset.chat);if(c){cur=c;stick=true;app.classList.remove('open');renderAll();scrollEnd()}}
});

function fileToDataUrl(f,max=1600){return new Promise((res,rej)=>{const fr=new FileReader();fr.onerror=rej;fr.onload=()=>{const im=new Image();im.onerror=rej;im.onload=()=>{const s=Math.min(1,max/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*s);c.height=Math.round(im.height*s);c.getContext('2d').drawImage(im,0,0,c.width,c.height);res(c.toDataURL('image/jpeg',.86))};im.src=fr.result};fr.readAsDataURL(f)})}

addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEv=e});
if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('sw.js').catch(()=>{});

/* ========== ميزات إضافية (تعمل فوق الكود الأصلي دون تغييره) ========== */
const startToday=()=>{const n=new Date();return new Date(n.getFullYear(),n.getMonth(),n.getDate()).getTime()};
let spentSince=t=>chats.reduce((s,c)=>s+c.msgs.reduce((x,m)=>x+((m.role==='assistant'&&(m.ts||0)>=t)?(m.cost||0):0),0),0);
const readData=f=>new Promise((res,rej)=>{const r=new FileReader();r.onerror=rej;r.onload=()=>res(r.result);r.readAsDataURL(f)});
const blobToData=readData;

/* --- تلوين الشيفرة --- */
const HL_KW=new Set(('abstract as async await break case catch class const continue def default del delete do elif else enum except export extends false finally for from function if implements import in instanceof interface is lambda let new nil none null nonlocal not of or pass raise return self static super switch this throw true try typeof undefined var void while with yield and fn pub mut impl use mod struct trait match loop go func package type chan select defer range int float double string bool char long public private protected final echo fi then done readonly declare namespace using True False None').split(' '));
const HL_A=/(\/\*[\s\S]*?(?:\*\/|$)|<!--[\s\S]*?(?:-->|$)|\/\/[^\n]*)|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?)|(\b0x[\da-fA-F]+\b|\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;
const HL_B=/(<!--[\s\S]*?(?:-->|$)|#[^\n]*)|("""[\s\S]*?(?:"""|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?)|(\b0x[\da-fA-F]+\b|\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;
function hl(code,lang){
  lang=(lang||'').toLowerCase();
  if(!lang||/^(text|txt|plain|plaintext|output|console|log|md|markdown)$/.test(lang))return esc(code);
  const re=/^(py|python|sh|bash|shell|zsh|yaml|yml|rb|ruby|toml|dockerfile|r|perl|ps1|powershell|makefile|conf|ini)$/.test(lang)?HL_B:HL_A;
  let out='',last=0,m;re.lastIndex=0;
  while((m=re.exec(code))){
    const t=m[0];out+=esc(code.slice(last,m.index));
    let c='';if(m[1])c='c';else if(m[2])c='s';else if(m[3])c='n';else if(m[4]||m[5])c=HL_KW.has(t)?'k':(m[4]?'f':'');
    out+=c?`<span class="tk-${c}">${esc(t)}</span>`:esc(t);last=m.index+t.length;
  }
  return out+esc(code.slice(last));
}

/* --- المعادلات الرياضية (KaTeX تُحمَّل عند الحاجة فقط) --- */
const MATH_RE=/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$\w])\$(?!\s)([^$\n]*?[\\^_{}][^$\n]*?)(?<!\s)\$(?![\w$])/g;
const katexCache=new Map();let katexP=null,katexFail=0;
function mathSpan(t,d){const h=katexCache.get((d?'D':'I')+t);return `<span class="mth${d?' d':''}${h?' done':''}" data-t="${esc(t)}">${h||((d?'$$':'$')+esc(t)+(d?'$$':'$'))}</span>`}
function loadKatex(){
  if(window.katex)return Promise.resolve(window.katex);
  if(katexP)return katexP;
  katexP=new Promise((res,rej)=>{
    const l=document.createElement('link');l.rel='stylesheet';l.href='https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.css';document.head.append(l);
    const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js';
    s.onload=()=>res(window.katex);s.onerror=()=>{katexP=null;katexFail=Date.now();rej(new Error('katex'))};document.head.append(s);
  });
  return katexP;
}
function typeset(root){
  const els=[...root.querySelectorAll('.mth:not(.done)')];
  if(!els.length||(!window.katex&&katexFail&&Date.now()-katexFail<30000))return;
  loadKatex().then(k=>{
    for(const el of els){
      if(el.classList.contains('done')||!el.isConnected)continue;
      try{const d=el.classList.contains('d');k.render(el.dataset.t,el,{displayMode:d,throwOnError:false});el.classList.add('done');katexCache.set((d?'D':'I')+el.dataset.t,el.innerHTML)}catch{}
    }
  }).catch(()=>{});
}
{let mt=0;new MutationObserver(()=>{clearTimeout(mt);mt=setTimeout(()=>typeset(thread),60)}).observe(thread,{childList:true,subtree:true})}

/* --- مصادر البحث وملفات المستخدم --- */
function addSources(a,an){
  if(!Array.isArray(an))return;a.sources=a.sources||[];
  for(const x of an){const u=(x&&x.url_citation&&x.url_citation.url)||(x&&x.url);
    if(u&&/^https?:\/\//.test(u)&&!a.sources.some(s=>s.url===u))a.sources.push({url:u,title:(x.url_citation&&x.url_citation.title)||''})}
}
function srcHTML(m){
  const s=m.sources||[];if(!s.length)return '';
  return `<div class="srcs"><b>${ic('globe')}المصادر</b>${s.map(x=>{let h;try{h=new URL(x.url).hostname.replace(/^www\./,'')}catch{h=x.url}return `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer" title="${esc(x.title||'')}">${esc(h)}</a>`}).join('')}</div>`;
}
const fileChips=m=>(m.files&&m.files.length)?`<div class="thumbs">${m.files.map(f=>`<span class="fchip">${ic('file')}${esc(f.name)}</span>`).join('')}</div>`:'';
function userContent(m){
  const files=m.files||[],imgs=m.imgs||[],tf=files.filter(f=>f.kind==='text'),pdfs=files.filter(f=>f.kind==='pdf');
  let t=m.text||'';
  if(tf.length)t=tf.map(f=>'[الملف: '+f.name+']\n```\n'+f.data+'\n```').join('\n\n')+(t?'\n\n'+t:'');
  if(!imgs.length&&!pdfs.length)return t;
  return [{type:'text',text:t||' '},...imgs.map(u=>({type:'image_url',image_url:{url:u}})),...pdfs.map(f=>({type:'file',file:{filename:f.name,file_data:f.data}}))];
}

/* --- إرفاق الملفات والصور (اختيار / لصق / سحب) --- */
let pfiles=[];
async function addFiles(list){
  for(const f of list){
    try{
      if(f.type&&f.type.startsWith('image/')){pending.push(await fileToDataUrl(f))}
      else if(f.type==='application/pdf'||/\.pdf$/i.test(f.name)){
        if(f.size>15*1048576){toast('ملف PDF أكبر من 15 ميغابايت: '+f.name);continue}
        pfiles.push({name:f.name,kind:'pdf',data:await readData(f)});
      }else{
        if(f.size>2e6){toast('الملف كبير جداً: '+f.name);continue}
        let t=await f.text();
        if(t.includes('\u0000')){toast('نوع الملف غير مدعوم: '+f.name);continue}
        if(t.length>300000){t=t.slice(0,300000)+'\n…[اقتُطع]';toast('اقتُطع الملف الطويل: '+f.name)}
        pfiles.push({name:f.name,kind:'text',data:t});
      }
    }catch{toast('تعذّر قراءة: '+f.name)}
  }
  renderPending();renderEst();
}
renderPending=(o=>function(){o();
  $('#pend').insertAdjacentHTML('beforeend',pfiles.map((f,i)=>`<div class="fp"><span>${ic('file')}${esc(f.name)}</span><button data-rmf="${i}" aria-label="إزالة">${ic('x')}</button></div>`).join(''));
  setBusy(busy)})(renderPending);
setBusy=(o=>function(b){o(b);if(!b&&pfiles.length)$('#send').disabled=false})(setBusy);
$('#pend').addEventListener('click',e=>{const b=e.target.closest('[data-rmf]');if(b){pfiles.splice(+b.dataset.rmf,1);renderPending();renderEst()}});
inp.addEventListener('paste',e=>{const fs=[...(e.clipboardData&&e.clipboardData.files||[])];if(fs.length){e.preventDefault();addFiles(fs)}});
{const bx=$('.box');bx.addEventListener('dragover',e=>e.preventDefault());bx.addEventListener('drop',e=>{e.preventDefault();if(e.dataTransfer&&e.dataTransfer.files.length)addFiles(e.dataTransfer.files)})}

/* --- تعديل رسالتك وإعادة إرسالها --- */
function editMsg(i){
  if(busy)return;const m=cur.msgs[i];if(!m||m.role!=='user')return;
  inp.value=m.text||'';pending=(m.imgs||[]).slice();pfiles=(m.files||[]).slice();
  cur.msgs.length=i;recompute(cur);if(chats.includes(cur))persist(cur);
  renderThread();renderTop();renderSide();renderPending();autosize();renderEst();inp.focus();toast('عدّل رسالتك ثم أرسلها');
}

/* --- تقدير التكلفة قبل الإرسال + حدّ الصرف اليومي --- */
const LTR=x=>'\u2066'+x+'\u2069';
function estimate(){
  const m=curModel();
  try{
    if(m.kind==='text'){
      if(!isFinite(m.pin))return null;
      let ch=inp.value.length;
      for(const x of history(cur))ch+=typeof x.content==='string'?x.content.length:x.content.filter(p=>p.type==='text').reduce((s,p)=>s+p.text.length,0);
      ch+=pfiles.filter(f=>f.kind==='text').reduce((s,f)=>s+f.data.length,0);
      const c=Math.ceil(ch/3)*m.pin/1e6;
      return {c,t:'الإدخال ≈ '+LTR(money(c))+(isFinite(m.pout)&&m.pout>0?' · الرد ≈ '+LTR(money(m.pout/1000))+' لكل 1000 رمز':'')};
    }
    if(m.kind==='image'){const p=+m.pimg;if(p>0){const n=+opts.img.n||1;return {c:p*n,t:'≈ '+LTR(money(p*n))+' للصورة'}}return null}
    if(m.kind==='video'&&m.raw&&m.raw.pricing_skus){
      const k=m.raw.pricing_skus,pr=+(k['per-video-second-'+opts.vRes]||k['per-video-second']),d=+opts.vDur||(m.raw.supported_durations||[])[0];
      if(pr&&d)return {c:pr*d,t:'≈ '+LTR(money(pr*d))+' لمدة '+d+' ث'};
    }
  }catch{}
  return null;
}
function renderEst(){const e=estimate();$('#est').textContent=e?e.t:''}
function limitOk(){
  const lim=+cfg.limitDaily;if(!lim)return true;
  const e=estimate(),sp=spentSince(startToday());
  if(sp+(e?e.c:0)<=lim)return true;
  return confirm('صرفك اليوم '+money(sp)+' وحدّك اليومي '+money(lim)+'.\nقد يتجاوز هذا الطلب الحد. هل تتابع؟');
}
inp.addEventListener('input',renderEst);
$('#opts').addEventListener('change',renderEst);
renderOpts=(o=>function(){o();renderEst()})(renderOpts);
renderTop=(o=>function(){o();const w=$('#webBtn');w.hidden=curModel().kind!=='text';w.classList.toggle('on',!!cur.web);renderEst()})(renderTop);
$('#webBtn').onclick=()=>{cur.web=!cur.web;if(chats.includes(cur))persist(cur);renderTop();toast(cur.web?'البحث في الإنترنت: مفعّل (قد تُضاف رسوم بحث)':'البحث في الإنترنت: متوقف')};

/* --- تقرير الصرف --- */
function openReport(){
  const t0=startToday(),days=[];
  for(let i=6;i>=0;i--){const d=t0-i*864e5;days.push([d,spentSince(d)-spentSince(d+864e5)])}
  const mx=Math.max(...days.map(x=>x[1]),1e-9),bm={};
  for(const c of chats)for(const m of c.msgs)if(m.role==='assistant'&&m.cost){const k=m.model||'?';(bm[k]=bm[k]||{c:0,n:0}).c+=m.cost;bm[k].n++}
  const rows=Object.entries(bm).sort((a,b)=>b[1].c-a[1].c).slice(0,10);
  modal(`<div class="mh"><span>تقرير الصرف</span><button class="ic" data-x aria-label="إغلاق">${ic('x')}</button></div>
  <div class="rp-cards"><div class="rp-card"><small>اليوم</small><b>${money(spentSince(t0))}</b></div><div class="rp-card"><small>آخر 7 أيام</small><b>${money(spentSince(t0-6*864e5))}</b></div><div class="rp-card"><small>آخر 30 يوماً</small><b>${money(spentSince(t0-29*864e5))}</b></div><div class="rp-card"><small>إجمالي الحساب</small><b>${acct&&acct.spent!=null?money(acct.spent):'—'}</b></div></div>
  <div class="fld"><label>آخر 7 أيام</label>${days.map(([d,v])=>`<div class="rp-row"><span>${new Date(d).toLocaleDateString('ar-EG',{weekday:'short'})}</span><div class="rp-bar"><i style="width:${Math.round(v/mx*100)}%"></i></div><b>${money(v)}</b></div>`).join('')}</div>
  <div class="fld"><label>حسب النموذج</label>${rows.length?rows.map(([k,v])=>`<div class="rp-row"><span style="width:auto;flex:1;direction:ltr;text-align:start;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tx)">${esc(getModel(k).name)}</span><span style="width:auto">${v.n}×</span><b>${money(v.c)}</b></div>`).join(''):'<div class="hint">لا توجد بيانات بعد.</div>'}</div>
  <div class="hint">أرقام اليوم والأيام تحسب من محادثات هذا المتصفح فقط، أما «إجمالي الحساب» فمن OpenRouter.</div>`);
}

/* --- المعرض --- */
function galleryItems(){
  const it=[];
  for(const c of chats)for(const m of c.msgs){if(m.role!=='assistant')continue;
    (m.imgs||[]).forEach(u=>it.push({t:'image',src:u,m,c}));
    if(m.blob&&(m.k==='video'||m.k==='audio'))it.push({t:m.k,m,c})}
  return it.sort((a,b)=>(b.m.ts||0)-(a.m.ts||0));
}
function openGallery(){
  let tab='all',lim=48;
  const sh=modal(`<div class="mh"><span>المعرض</span><button class="ic" data-x aria-label="إغلاق">${ic('x')}</button></div><div class="tabs" id="gt"></div><div class="gal" id="gg"></div>`,'tall');
  const draw=()=>{
    const all=galleryItems(),cnt=k=>k==='all'?all.length:all.filter(x=>x.t===k).length;
    $('#gt',sh).innerHTML=[['all','الكل'],['image','صور'],['video','فيديو'],['audio','صوت']].map(([k,l])=>`<button data-t="${k}" class="${k===tab?'on':''}">${l}<small>${cnt(k)}</small></button>`).join('');
    const L=all.filter(x=>tab==='all'||x.t===tab);
    $('#gg',sh).innerHTML=L.slice(0,lim).map(x=>{
      const cap=`<div class="gcap"><span>${esc(getModel(x.m.model).name.replace(/^[^:]+:\s*/,''))}</span><span class="mu">${new Date(x.m.ts||Date.now()).toLocaleDateString('ar-EG')}</span><button class="ic sm" data-open="${x.c.id}" aria-label="فتح المحادثة">${ic('chat')}</button></div>`;
      if(x.t==='image')return `<div class="gi"><img loading="lazy" src="${x.src}" alt="" data-gv>${cap}</div>`;
      if(x.t==='video')return `<div class="gi"><video src="${blobUrl(x.m)}" controls playsinline preload="metadata"></video>${cap}</div>`;
      return `<div class="gi wide"><audio src="${blobUrl(x.m)}" controls></audio>${cap}</div>`}).join('')||'<div class="mu pad">لا توجد وسائط مولّدة بعد.</div>';
    if(L.length>lim)$('#gg',sh).insertAdjacentHTML('beforeend',`<button class="btn" data-more style="grid-column:1/-1">عرض المزيد (${L.length-lim})</button>`);
  };
  sh.addEventListener('click',e=>{
    const t=e.target.closest('[data-t]');if(t){tab=t.dataset.t;lim=48;draw();return}
    if(e.target.closest('[data-more]')){lim+=48;draw();return}
    const g=e.target.closest('[data-gv]');if(g){openViewer(g.src);return}
    const o=e.target.closest('[data-open]');if(o){const c=chats.find(x=>x.id===o.dataset.open);if(c){closeModal();cur=c;stick=true;renderAll();scrollEnd()}}
  });
  draw();
}

/* --- مقارنة نموذجين --- */
function fillDL(){const d=$('#tm-list');d.innerHTML=models.filter(m=>m.kind==='text').map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}
loadModels=(o=>async function(){await o();fillDL()})(loadModels);
async function cmpStream(id,prompt,box,signal){
  const name=getModel(id).name;let text='',cost=0;const t0=Date.now();
  const draw=done=>{box.innerHTML=`<div class="cmp-h"><b>${esc(name)}</b><span class="mu">${done?((Date.now()-t0)/1000).toFixed(1)+' ث · '+LTR(money(cost)):'…'}</span></div><div class="md" dir="auto">${md(text)||'<span class="dot"></span>'}</div>${done&&text?'<button class="btn" data-adopt style="margin-top:.6rem">متابعة في محادثة</button>':''}`};
  box.dataset.id=id;draw(false);
  try{
    const res=await fetch(API+'/chat/completions',{method:'POST',headers:hdr(),signal,body:JSON.stringify({model:id,messages:[...(cfg.sys?[{role:'system',content:cfg.sys}]:[]),{role:'user',content:prompt}],stream:true,usage:{include:true}})});
    if(!res.ok)throw await apiError(res);
    let last=0;
    await sse(res,j=>{if(j.error)throw new Error(j.error.message||'خطأ من المزوّد');const d=(j.choices&&j.choices[0]&&j.choices[0].delta)||{};
      if(d.content)text+=d.content;if(j.usage)cost=+j.usage.cost||0;const n=Date.now();if(n-last>120){last=n;draw(false)}});
  }catch(e){if(e.name!=='AbortError')text+=(text?'\n\n':'')+'⚠️ '+((e&&e.message)||e)}
  draw(true);box._res={text,cost};
}
function openCompare(){
  fillDL();
  const tms=models.filter(m=>m.kind==='text'),a0=curModel().kind==='text'?cur.model:((tms[0]||{}).id||''),b0=(tms.find(m=>m.id!==a0)||{}).id||'';
  const sh=modal(`<div class="mh"><span>مقارنة نموذجين</span><button class="ic" data-x aria-label="إغلاق">${ic('x')}</button></div>
  <div class="rowf"><div class="fld"><label for="cA">النموذج الأول</label><input class="in" id="cA" dir="ltr" list="tm-list" value="${esc(a0)}" autocomplete="off"></div><div class="fld"><label for="cB">النموذج الثاني</label><input class="in" id="cB" dir="ltr" list="tm-list" value="${esc(b0)}" autocomplete="off"></div></div>
  <div class="fld"><textarea class="in" id="cQ" placeholder="اكتب سؤالاً يُرسل إلى النموذجين معاً…"></textarea></div>
  <div class="rowf"><button class="btn pri" id="cGo">قارن</button></div><div class="hint" style="margin-top:.4rem">يُحتسب سعر كل نموذج على حدة. لا تُحفظ المقارنة إلا إن اخترت «متابعة في محادثة».</div>
  <div class="cmp"><div class="cmp-col" id="cRA"></div><div class="cmp-col" id="cRB"></div></div>`,'tall wide');
  let cc=null;const go=$('#cGo',sh);
  go.onclick=async()=>{
    if(cc){cc.abort();return}
    const A=$('#cA',sh).value.trim(),B=$('#cB',sh).value.trim(),q=$('#cQ',sh).value.trim();
    if(!KEY){toast('أضف مفتاح OpenRouter أولاً');return}
    if(!q)return $('#cQ',sh).focus();
    for(const id of [A,B])if(!mmap[id]||mmap[id].kind!=='text'){toast('اختر نموذج نص صحيحاً من القائمة: '+(id||'—'));return}
    cc=new AbortController();go.textContent='إيقاف';
    await Promise.all([cmpStream(A,q,$('#cRA',sh),cc.signal),cmpStream(B,q,$('#cRB',sh),cc.signal)]);
    cc=null;go.textContent='قارن';refreshAcct();
  };
  sh.addEventListener('click',e=>{
    const b=e.target.closest('[data-adopt]');if(!b)return;
    const box=b.closest('.cmp-col'),r=box._res,q=$('#cQ',sh).value.trim();if(!r)return;ledger.remove(box._lid);
    const id=box.dataset.id,now=Date.now();
    const c={id:uid(),title:q.slice(0,42),projectId:proj,model:id,reasoning:cfg.reasoning,titled:true,cost:r.cost,created:now,updated:now,
      msgs:[{id:uid(),role:'user',k:'text',text:q,imgs:[],ts:now},{id:uid(),role:'assistant',k:'text',text:r.text,reasoning:'',imgs:[],model:id,cost:r.cost,ts:now}]};
    chats.unshift(c);persist(c);cur=c;closeModal();renderAll();toast('فُتحت المحادثة');
  });
}

/* --- الإدخال الصوتي (يعمل مع Chrome على أندرويد) --- */
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;let rec=null;
if(!SR)$('#mic').hidden=true;
function toggleMic(){
  if(!SR)return toast('المتصفح لا يدعم الإدخال الصوتي');
  if(rec){rec.stop();return}
  const base=inp.value?inp.value.replace(/\s*$/,' '):'';
  rec=new SR();rec.lang=cfg.sttLang||'ar-EG';rec.interimResults=true;rec.continuous=false;
  rec.onresult=e=>{let t='';for(const r of e.results)t+=r[0].transcript;inp.value=base+t;autosize();setBusy(busy);renderEst()};
  rec.onerror=e=>toast(e.error==='not-allowed'?'اسمح للمتصفح باستخدام الميكروفون':'تعذّر الإدخال الصوتي: '+e.error);
  rec.onend=()=>{rec=null;$('#mic').classList.remove('rec')};
  try{rec.start();$('#mic').classList.add('rec')}catch{rec=null}
}
$('#mic').onclick=toggleMic;

/* --- عناوين ذكية للمحادثات --- */
generate=(o=>async function(chat){await o(chat);try{await smartTitle(chat)}catch{}})(generate);
async function smartTitle(chat){
  if(!cfg.smartTitle||chat.titled||chat.msgs.length!==2)return;
  const u=chat.msgs[0],a=chat.msgs[1];if(!a||a.err||!a.text||a.k!=='text')return;
  let id=(cfg.titleModel||'').trim();
  if(!id){const m=getModel(chat.model);if(!(m.pout<=5))return;id=m.id}
  chat.titled=true;
  const r=await fetch(API+'/chat/completions',{method:'POST',headers:hdr(),body:JSON.stringify({model:id,max_tokens:60,usage:{include:true},messages:[
    {role:'system',content:'اكتب عنواناً قصيراً جداً (من 2 إلى 5 كلمات) يلخّص المحادثة بلغة المستخدم، دون علامات اقتباس أو نقطة في آخره. أجب بالعنوان فقط.'},
    {role:'user',content:(u.text||'').slice(0,500)+'\n---\n'+a.text.slice(0,500)}]})});
  if(!r.ok)return;const j=await r.json();
  const t=(((j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content)||'')+'').replace(/["'«»“”`*#]/g,'').split('\n')[0].trim().replace(/[.。]$/,'').slice(0,60);
  if(!t)return;
  chat.title=t;a.cost=(a.cost||0)+(+(j.usage&&j.usage.cost)||0);recompute(chat);persist(chat);renderSide();if(chat===cur)renderTop();
}

/* --- نسخ احتياطي كامل (يشمل الفيديو والصوت) --- */
async function exportFull(){
  const out=[];
  for(const c of chats){const msgs=[];for(const m of c.msgs){const {blob,...r}=m;if(blob)r.__blob={type:blob.type,data:await blobToData(blob)};msgs.push(r)}out.push({...c,msgs})}
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({v:2,projects,chats:out})],{type:'application/json'}));
  a.download='odai-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();
  cfg.lastBackup=Date.now();saveCfg();const b=$('#bk');if(b)b.remove();
}
async function importFull(f){
  if(!f)return;
  try{
    const d=JSON.parse(await f.text());
    for(const p of d.projects||[]){await DB.put('projects',p);if(!projects.find(x=>x.id===p.id))projects.push(p)}
    for(const c of d.chats||[]){
      for(const m of c.msgs||[])if(m.__blob){m.blob=await (await fetch(m.__blob.data)).blob();delete m.__blob}
      await DB.put('chats',c);if(!chats.find(x=>x.id===c.id))chats.push(c);
    }
    renderAll();toast('تم الاستيراد');
  }catch{toast('ملف غير صالح')}
}
function checkBackup(){
  if(!chats.length||$('#bk'))return;
  const base=cfg.lastBackup||Math.min(...chats.map(c=>c.created||Date.now()));
  if(Date.now()-base<7*864e5)return;
  $('.top').insertAdjacentHTML('afterend',`<div class="banner" id="bk"><span>مضى أسبوع على آخر نسخة احتياطية لمحادثاتك.</span><button class="btn pri" id="bkNow">تصدير</button><button class="ic sm" id="bkX" aria-label="لاحقاً">${ic('x')}</button></div>`);
  $('#bkNow').onclick=exportFull;
  $('#bkX').onclick=()=>{cfg.lastBackup=Date.now()-6*864e5;saveCfg();$('#bk').remove()};
}
try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch{}

/* --- قفل التطبيق --- */
async function sha(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
let lockTries=0;
function showLock(){
  if($('#lock'))return;
  const d=document.createElement('div');d.className='lock';d.id='lock';
  d.innerHTML=`${LOGO}<h1 style="direction:ltr;font-size:2rem">od<span style="color:var(--ac)">Ai</span></h1><input class="in" id="lk-in" type="password" inputmode="numeric" autocomplete="off" dir="ltr" placeholder="الرمز السري"><button class="btn pri" id="lk-go" style="min-width:10rem">فتح</button><div class="hint bad" id="lk-err"></div>`;
  document.body.append(d);
  const tryOpen=async()=>{
    const v=$('#lk-in').value;if(!v)return;
    if(await sha(cfg.pinSalt+v)===cfg.pin){lockTries=0;d.remove()}
    else{lockTries++;$('#lk-err').textContent='رمز غير صحيح';$('#lk-in').value='';if(lockTries>=3){$('#lk-go').disabled=true;setTimeout(()=>{$('#lk-go').disabled=false},Math.min(30000,lockTries*2000))}}
  };
  $('#lk-go').onclick=tryOpen;$('#lk-in').addEventListener('keydown',e=>{if(e.key==='Enter')tryOpen()});
  setTimeout(()=>{const i=$('#lk-in');if(i)i.focus()},50);
}
{let hiddenAt=0;document.addEventListener('visibilitychange',()=>{if(document.hidden)hiddenAt=Date.now();else if(cfg.pin&&hiddenAt&&Date.now()-hiddenAt>60000)showLock()})}
function openLockSetup(){
  if(!(window.crypto&&crypto.subtle)){toast('القفل يحتاج فتح التطبيق من رابط https');return}
  const has=!!cfg.pin;
  const sh=modal(`<div class="mh"><span>قفل التطبيق</span><button class="ic" data-x aria-label="إغلاق">${ic('x')}</button></div>
  ${has?'<div class="fld"><label for="l-old">الرمز الحالي</label><input class="in" id="l-old" type="password" inputmode="numeric" dir="ltr" autocomplete="off"></div>':''}
  <div class="fld"><label for="l-new">رمز جديد (من 4 إلى 8 أرقام)</label><input class="in" id="l-new" type="password" inputmode="numeric" maxlength="8" dir="ltr" autocomplete="off"></div>
  <div class="rowf"><button class="btn pri" id="l-save">حفظ</button>${has?'<button class="btn dng" id="l-rm">إزالة القفل</button>':''}</div><div class="hint bad" id="l-err"></div>`);
  const err=m=>{$('#l-err',sh).textContent=m};
  const okOld=async()=>!has||(await sha(cfg.pinSalt+$('#l-old',sh).value)===cfg.pin);
  $('#l-save',sh).onclick=async()=>{
    const v=$('#l-new',sh).value;if(!/^\d{4,8}$/.test(v))return err('الرمز من 4 إلى 8 أرقام');
    if(!(await okOld()))return err('الرمز الحالي غير صحيح');
    cfg.pinSalt=uid()+uid();cfg.pin=await sha(cfg.pinSalt+v);saveCfg();closeModal();toast('تم تفعيل القفل');
  };
  if(has)$('#l-rm',sh).onclick=async()=>{if(!(await okOld()))return err('الرمز الحالي غير صحيح');cfg.pin='';cfg.pinSalt='';saveCfg();closeModal();toast('أُزيل القفل')};
}

/* --- إضافات نافذة الإعدادات --- */
openSettings=(o=>function(){
  o();const sh=document.querySelector('.sheet');if(!sh||!sh.querySelector('#s-exp'))return;
  fillDL();
  const fld=sh.querySelector('#s-exp').closest('.fld');
  fld.insertAdjacentHTML('beforebegin',`
  <div class="fld"><label for="s-lim">حدّ الصرف اليومي بالدولار (اختياري)</label><input class="in" id="s-lim" type="number" min="0" step="0.5" dir="ltr" value="${esc(cfg.limitDaily)}" placeholder="بدون حد"><div class="hint">ينبّهك التطبيق قبل إرسال طلب يتجاوز الحد. الحساب من محادثات هذا المتصفح.</div></div>
  <div class="fld"><label>عناوين المحادثات الذكية</label><label class="chk"><input type="checkbox" id="s-st2" ${cfg.smartTitle?'checked':''}>توليد عنوان قصير بعد أول رد</label><input class="in" id="s-tm" dir="ltr" list="tm-list" placeholder="معرّف نموذج للعناوين (اختياري)" value="${esc(cfg.titleModel||'')}"><div class="hint">دون تحديد نموذج يُستخدم نموذج المحادثة إن كان رخيصاً (حتى 5$ لكل مليون رمز رد)، وإلا يبقى العنوان المختصر.</div></div>
  <div class="fld"><label for="s-stt">لغة الإدخال الصوتي</label><select class="in" id="s-stt">${[['ar-EG','العربية (مصر)'],['ar-SA','العربية (السعودية)'],['ar-AE','العربية (الإمارات)'],['en-US','English (US)']].map(([v,l])=>`<option value="${v}" ${cfg.sttLang===v?'selected':''}>${l}</option>`).join('')}</select></div>
  <div class="fld"><label>قفل التطبيق</label><button class="btn" id="s-lock">${ic('lock')}${cfg.pin?'تغيير الرمز أو إزالته':'تعيين رمز سري'}</button><div class="hint">يُطلب الرمز عند الفتح وبعد دقيقة في الخلفية. يمنع الوصول العابر فقط ولا يشفّر بياناتك.</div></div>`);
  const g=id=>sh.querySelector(id);
  g('#s-lim').onchange=e=>{cfg.limitDaily=e.target.value;saveCfg()};
  g('#s-st2').onchange=e=>{cfg.smartTitle=e.target.checked;saveCfg()};
  g('#s-tm').onchange=e=>{cfg.titleModel=e.target.value.trim();saveCfg()};
  g('#s-stt').onchange=e=>{cfg.sttLang=e.target.value;saveCfg()};
  g('#s-lock').onclick=openLockSetup;
  g('#s-exp').onclick=exportFull;
  g('#s-imp').onclick=()=>{const f=document.createElement('input');f.type='file';f.accept='application/json';f.onchange=()=>importFull(f.files[0]);f.click()};
  const h=fld.querySelector('.hint');if(h)h.textContent='يشمل التصدير الصور والفيديو والصوت، ولا يشمل مفتاح OpenRouter.';
})(openSettings);

/* --- ربط الأزرار الجديدة --- */
$('#openGallery').onclick=()=>{app.classList.remove('open');openGallery()};
$('#openCompare').onclick=()=>{app.classList.remove('open');openCompare()};
$('#openReport').onclick=()=>{app.classList.remove('open');openReport()};
if(cfg.pin)showLock();


/* ========== الدفعة الثانية: الصور ↔ الفيديو، ملفات المشاريع، التصدير، الصرف، التحديث ========== */
const APP_VER='2026.10.12-2';
const dl=(name,blob)=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),4000)};
const fname=c=>((c.title||'').replace(/[\\/:*?"<>|]+/g,' ').trim().slice(0,40))||'odai-chat';

/* --- سجل صرف للمقارنات (لا تُحفظ كرسائل) --- */
const ledger={
  all(){try{return JSON.parse(localStorage.getItem('odai.ledger')||'[]')}catch{return []}},
  save(a){try{localStorage.setItem('odai.ledger',JSON.stringify(a.slice(-300)))}catch{}},
  add(cost,model){if(!cost)return null;const id=uid(),a=this.all();a.push({id,ts:Date.now(),cost,model});this.save(a);return id},
  remove(id){if(id)this.save(this.all().filter(x=>x.id!==id))}
};
spentSince=(o=>t=>o(t)+ledger.all().reduce((s,x)=>s+(x.ts>=t?x.cost:0),0))(spentSince);

/* --- أزرار الصور: تعديل / تحريك / نسخة جديدة --- */
msgHTML=(o=>function(m,i){
  let h=o(m,i);
  if(m.role==='assistant'&&!m.streaming&&m.imgs&&m.imgs.length){
    const one=m.imgs.length===1;
    const bar=m.imgs.map((u,j)=>`<div class="imgacts">${one?'':`<span class="mu">صورة ${j+1}</span>`}<button class="btn sm" data-ia="edit" data-j="${j}">${ic('pencil')}تعديل</button><button class="btn sm" data-ia="anim" data-j="${j}">${ic('video')}تحريك</button>${j===0?`<button class="btn sm" data-ia="again" data-j="0">${ic('refresh')}نسخة جديدة</button>`:''}</div>`).join('');
    h=h.replace(/<div class="media">[\s\S]*?<\/div>/,mm=>mm+bar);
  }
  return h})(msgHTML);
setModel=(o=>function(id){o(id);if(getModel(id).kind==='video'){cfg.lastVid=id;saveCfg()}})(setModel);
thread.addEventListener('click',e=>{
  const b=e.target.closest('[data-ia]');if(!b||busy)return;
  const i=+b.closest('.msg').dataset.i,m=cur.msgs[i],src=m&&(m.imgs||[])[+b.dataset.j];if(!src)return;
  const act=b.dataset.ia,mod=getModel(m.model);
  if(act==='edit'){
    if(mod.kind==='image')setModel(mod.id);else{const im=models.find(x=>x.kind==='image');if(im)setModel(im.id)}
    pending=[src];pfiles=[];renderPending();renderEst();inp.focus();toast('اكتب التعديل المطلوب ثم أرسل');
  }else if(act==='anim'){
    const vm=(getModel(cfg.lastVid||'').kind==='video'&&cfg.lastVid)||(models.find(x=>x.kind==='video')||{}).id;
    if(!vm){toast('لا يوجد نموذج فيديو متاح');return}
    setModel(vm);pending=[src];pfiles=[];renderPending();renderEst();inp.focus();toast('اكتب وصف الحركة ثم أرسل');
  }else if(act==='again'){
    const u=cur.msgs.slice(0,i).reverse().find(x=>x.role==='user');if(!u)return;
    if(mod.kind==='image')setModel(mod.id);
    if(!limitOk())return;
    cur.msgs.push({id:uid(),role:'user',k:'image',text:u.text,imgs:(u.imgs||[]).slice(),files:[],ts:Date.now()});
    generate(cur);
  }
});

/* --- ملفات المشاريع --- */
async function readEntry(f){
  if(f.type==='application/pdf'||/\.pdf$/i.test(f.name)){
    if(f.size>15*1048576){toast('ملف PDF أكبر من 15 ميغابايت: '+f.name);return null}
    return {name:f.name,kind:'pdf',data:await readData(f)};
  }
  if(f.type&&f.type.startsWith('image/')||f.type&&f.type.startsWith('audio/')||f.type&&f.type.startsWith('video/')){toast('المشاريع تقبل PDF والملفات النصية فقط: '+f.name);return null}
  if(f.size>2e6){toast('الملف كبير جداً: '+f.name);return null}
  let t=await f.text();
  if(t.includes('\u0000')){toast('نوع الملف غير مدعوم: '+f.name);return null}
  if(t.length>200000){t=t.slice(0,200000)+'\n…[اقتُطع]';toast('اقتُطع الملف الطويل: '+f.name)}
  return {name:f.name,kind:'text',data:t};
}
history=(o=>function(c){
  const out=o(c),p=projects.find(x=>x.id===c.projectId),fs=(p&&p.files)||[];
  if(!fs.length)return out;
  const tf=fs.filter(f=>f.kind==='text'),pf=fs.filter(f=>f.kind==='pdf');
  if(tf.length){
    const extra='ملفات المشروع (مرجع ثابت):\n\n'+tf.map(f=>'[الملف: '+f.name+']\n```\n'+f.data+'\n```').join('\n\n');
    if(out[0]&&out[0].role==='system')out[0]={...out[0],content:out[0].content+'\n\n'+extra};else out.unshift({role:'system',content:extra});
  }
  if(pf.length){
    const i=out.findIndex(m=>m.role==='user');
    if(i>=0){const m=out[i],parts=typeof m.content==='string'?[{type:'text',text:m.content}]:m.content.slice();
      pf.forEach(f=>parts.push({type:'file',file:{filename:f.name,file_data:f.data}}));out[i]={...m,content:parts}}
  }
  return out})(history);
openProject=(o=>function(id){
  o(id);const sh=document.querySelector('.sheet');if(!sh||!sh.querySelector('#p-s'))return;
  const p=projects.find(x=>x.id===id);let files=p&&p.files?p.files.slice():[];
  sh.querySelector('#p-s').closest('.rowf').insertAdjacentHTML('beforebegin',`<div class="fld"><label>ملفات المشروع (تُرسل مع كل رسالة داخله)</label><div id="pf-list"></div><button class="btn" id="pf-add">${ic('plus')}إضافة ملف</button><div class="hint" id="pf-hint"></div></div>`);
  const draw=()=>{
    sh.querySelector('#pf-list').innerHTML=files.map((f,i)=>`<div class="rp-row"><span style="width:auto;flex:1;color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ic('file')} ${esc(f.name)}</span><button class="ic sm" data-pfr="${i}" aria-label="إزالة">${ic('trash')}</button></div>`).join('');
    const chars=files.filter(f=>f.kind==='text').reduce((s,f)=>s+f.data.length,0);
    sh.querySelector('#pf-hint').textContent=files.length?`تُرسل هذه الملفات مع كل رسالة في المشروع (≈ ${Math.ceil(chars/3).toLocaleString('ar-EG')} رمز نصي). الملفات الكبيرة ترفع التكلفة.`:'';
  };
  const pick=document.createElement('input');pick.type='file';pick.multiple=true;pick.accept='application/pdf,.pdf,.txt,.md,.csv,.json,.js,.ts,.py,.html,.css,.xml,.yaml,.yml,.log,.sql,.sh';
  sh.querySelector('#pf-add').onclick=()=>pick.click();
  pick.onchange=async()=>{
    for(const f of pick.files){try{const en=await readEntry(f);if(en){const tot=files.filter(x=>x.kind==='text').reduce((s,x)=>s+x.data.length,0)+(en.kind==='text'?en.data.length:0);
      if(tot>300000){toast('تجاوزت حدّ الملفات النصية للمشروع');continue}files.push(en)}}catch{toast('تعذّر قراءة: '+f.name)}}
    pick.value='';draw();
  };
  sh.querySelector('#pf-list').addEventListener('click',e=>{const b=e.target.closest('[data-pfr]');if(b){files.splice(+b.dataset.pfr,1);draw()}});
  sh.querySelector('#p-s').addEventListener('click',()=>{
    if(document.querySelector('#p-n'))return;
    const t=projects.find(x=>x.id===(id||proj));if(t){t.files=files;DB.put('projects',t)}
  });
  draw();
})(openProject);

/* --- تصدير المحادثة: Markdown / PDF / صورة --- */
function chatMD(c){
  const L=['# '+c.title,'','> '+new Date(c.created).toLocaleString('ar-EG')+' · '+getModel(c.model).name+' · '+money(c.cost),''];
  for(const m of c.msgs){
    if(m.role==='user'){L.push('## 👤 أنت','');if(m.files&&m.files.length)L.push(m.files.map(f=>'📎 '+f.name).join('، '),'');if(m.imgs&&m.imgs.length)L.push('[صور مرفقة: '+m.imgs.length+']','');L.push(m.text||'','')}
    else{
      L.push('## 🤖 '+getModel(m.model).name,'');
      if(m.reasoning)L.push('<details><summary>التفكير</summary>\n\n'+m.reasoning+'\n\n</details>','');
      if(m.text)L.push(m.text,'');
      if(m.imgs&&m.imgs.length)L.push('[صور مولّدة: '+m.imgs.length+']','');
      if(m.blob)L.push('['+(m.k==='video'?'فيديو':'صوت')+' مولّد]','');
      if(m.sources&&m.sources.length)L.push('**المصادر:**',...m.sources.map(s=>'- '+s.url),'');
      if(m.err)L.push('> ⚠️ '+m.err,'');
    }
  }
  return L.join('\n');
}
function expCSS(dark){
  const bg=dark?'#16181b':'#fff',tx=dark?'#f4f6f7':'#111',mu=dark?'#98a2ab':'#667',s=dark?'#23272c':'#eef2f4',cb=dark?'#101215':'#f4f6f8',bd=dark?'#2f353b':'#d8dee3',ac=dark?'#22d3ee':'#0b7285';
  return `body{margin:0}.xp{background:${bg};color:${tx};font-family:Cairo,'Noto Sans Arabic','Segoe UI',Tahoma,sans-serif;font-size:16px;line-height:1.75;padding:24px;direction:rtl}
.xp .hd{border-bottom:1px solid ${bd};padding-bottom:12px;margin-bottom:16px}.xp .hd b{font-size:22px;display:block}.xp .hd span{color:${mu};font-size:13px}
.xp .u{background:${s};border-radius:14px;padding:8px 14px;margin:14px 0 14px 18%;white-space:normal;word-break:break-word}
.xp .a{margin:14px 0}.xp .who{color:${mu};font-size:12px;direction:ltr;text-align:right;margin-bottom:2px}
.xp img{max-width:100%;border-radius:12px;display:block;margin:6px 0}.xp .fc{display:inline-block;background:${s};border-radius:8px;padding:0 8px;font-size:13px;margin:2px}
.xp .er{color:#e5484d;border:1px solid #e5484d;border-radius:10px;padding:6px 10px;margin:6px 0}
.xp p{margin:8px 0}.xp ul,.xp ol{padding-inline-start:22px}.xp h2,.xp h3,.xp h4,.xp h5{margin:14px 0 4px}
.xp .code{background:${cb};border:1px solid ${bd};border-radius:10px;margin:10px 0;direction:ltr;overflow:hidden}.xp .code-h{background:${s};color:${mu};font-size:12px;padding:2px 10px}
.xp pre{margin:0;padding:10px 12px;white-space:pre-wrap;word-break:break-all;text-align:left;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.55}.xp code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em}
.xp .tk-c{color:${mu}}.xp .tk-s{color:${dark?'#9bd3a0':'#2b7a3d'}}.xp .tk-n{color:${dark?'#f2b878':'#b45309'}}.xp .tk-k{color:${ac}}.xp .tk-f{color:${dark?'#8fb8ff':'#1d4ed8'}}
.xp table{border-collapse:collapse}.xp th,.xp td{border:1px solid ${bd};padding:4px 8px}.xp blockquote{border-inline-start:3px solid ${ac};margin:8px 0;padding:0 12px;color:${mu}}
.xp .ft{color:${mu};font-size:12px;text-align:center;margin-top:20px;direction:ltr}`;
}
function expBody(c){
  const meta=new Date(c.created).toLocaleString('ar-EG')+' · '+esc(getModel(c.model).name)+' · '+LTR(money(c.cost));
  return `<div class="hd"><b>${esc(c.title)}</b><span>${meta}</span></div>`+c.msgs.map(m=>{
    if(m.role==='user')return `<div class="u" dir="auto">${(m.files||[]).map(f=>`<span class="fc">📎 ${esc(f.name)}</span>`).join('')}${(m.imgs||[]).map(u=>`<img src="${u}" alt="">`).join('')}${esc(m.text||'').replace(/\n/g,'<br>')}</div>`;
    const media=(m.imgs||[]).map(u=>`<img src="${u}" alt="">`).join('')+(m.blob?`<div class="fc">${m.k==='video'?'🎬 فيديو مولّد':'🔊 صوت مولّد'}</div>`:'');
    return `<div class="a"><div class="who">${esc(getModel(m.model).name)}</div>${m.err?`<div class="er">${esc(m.err)}</div>`:''}${media}<div dir="auto">${md(m.text||'').replace(/<button data-copy>[^<]*<\/button>/g,'')}</div></div>`;
  }).join('')+'<div class="ft">odAi</div>';
}
const expDoc=(c,dark)=>`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(c.title)}</title><style>${expCSS(dark)}@page{margin:14mm}</style></head><body><div class="xp">${expBody(c)}</div></body></html>`;
function exportPDF(c){
  const f=document.createElement('iframe');f.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  f.srcdoc=expDoc(c,false);
  f.onload=()=>{try{f.contentWindow.focus();f.contentWindow.print()}catch{toast('تعذّرت الطباعة')}setTimeout(()=>f.remove(),120000)};
  document.body.append(f);
}
async function exportPNG(c){
  const W=720,f=document.createElement('iframe');f.style.cssText=`position:fixed;left:-9999px;top:0;width:${W}px;height:200px;border:0`;
  f.srcdoc=expDoc(c,true);document.body.append(f);
  try{
    await new Promise(r=>f.onload=r);const d=f.contentDocument;
    await Promise.all([...d.images].map(i=>i.decode().catch(()=>{})));
    const h=d.documentElement.scrollHeight;
    const xml=new XMLSerializer().serializeToString(d.querySelector('.xp')),css=d.querySelector('style').textContent;
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>${css}</style>${xml}</div></foreignObject></svg>`;
    let sc=2;if(h*sc>16000)sc=1;if(h*sc>16000){toast('المحادثة أطول من أن تُحفظ كصورة. استخدم PDF');return}
    const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await img.decode();
    const cv=document.createElement('canvas');cv.width=W*sc;cv.height=h*sc;const x=cv.getContext('2d');x.scale(sc,sc);x.drawImage(img,0,0);
    const blob=await new Promise(r=>cv.toBlob(r,'image/png'));if(!blob)throw new Error('blob');
    dl(fname(c)+'.png',blob);
  }catch{toast('تعذّر حفظ الصورة في هذا المتصفح. استخدم PDF')}
  finally{f.remove()}
}
function openChatMenu(){
  if(!cur.msgs.length){toast('لا توجد رسائل لتصديرها');return}
  const sh=modal(`<div class="mh"><span>${esc(cur.title)}</span><button class="ic" data-x aria-label="إغلاق">${ic('x')}</button></div>
  <div class="hint" style="margin-bottom:.8rem">${cur.msgs.length} رسالة · التكلفة ${LTR(money(cur.cost))}</div>
  <button class="opt" data-e="md"><b>تصدير Markdown</b><small>ملف نصي منسّق يفتح في أي محرر</small></button>
  <button class="opt" data-e="pdf"><b>تصدير PDF</b><small>من نافذة الطباعة اختر «حفظ كـ PDF»</small></button>
  <button class="opt" data-e="png"><b>حفظ كصورة</b><small>صورة واحدة للمحادثة بالوضع الداكن، مناسبة للنشر</small></button>`);
  sh.addEventListener('click',e=>{
    const b=e.target.closest('[data-e]');if(!b)return;const c=cur;closeModal();
    if(b.dataset.e==='md')dl(fname(c)+'.md',new Blob([chatMD(c)],{type:'text/markdown'}));
    else if(b.dataset.e==='pdf')exportPDF(c);else exportPNG(c);
  });
}
$('#costChip').onclick=openChatMenu;
renderTop=(o=>function(){o();const c=$('#costChip');c.insertAdjacentHTML('beforeend',ic('down'));c.title='تكلفة المحادثة وخيارات التصدير'})(renderTop);

/* --- حدّ الصرف داخل تقرير الصرف --- */
openReport=(o=>function(){
  o();const sh=document.querySelector('.sheet');if(!sh||!sh.querySelector('.rp-cards'))return;
  const sp=spentSince(startToday()),lim=+cfg.limitDaily||0,pct=lim?Math.min(100,Math.round(sp/lim*100)):0;
  sh.querySelector('.rp-cards').insertAdjacentHTML('afterend',`<div class="fld"><label for="r-lim">حدّ الصرف اليومي بالدولار</label><input class="in" id="r-lim" type="number" min="0" step="0.5" dir="ltr" value="${esc(cfg.limitDaily)}" placeholder="بدون حد">${lim?`<div class="rp-row"><div class="rp-bar"><i style="width:${pct}%;${pct>=80?'background:var(--er)':''}"></i></div><b>${pct}%</b></div><div class="hint">${LTR(money(sp))} من ${LTR(money(lim))} اليوم</div>`:'<div class="hint">اتركه فارغاً لإلغاء الحد. ينبّهك التطبيق قبل تجاوزه.</div>'}</div>`);
  sh.querySelector('#r-lim').onchange=e=>{cfg.limitDaily=e.target.value;saveCfg();openReport()};
})(openReport);
// تكلفة المقارنات تُسجَّل في السجل حتى لو لم تُحفظ كمحادثة
cmpStream=(o=>async function(id,prompt,box,signal){await o(id,prompt,box,signal);if(box._res&&box._res.cost)box._lid=ledger.add(box._res.cost,id)})(cmpStream);

/* --- التحقق من التحديث --- */
async function hardReload(){
  try{const rs=await navigator.serviceWorker.getRegistrations();await Promise.all(rs.map(r=>r.unregister()));const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)))}catch{}
  location.reload();
}
async function checkUpdate(){
  if(!location.protocol.startsWith('http')){toast('التحقق من التحديث يعمل من رابط GitHub فقط');return}
  try{
    const r=await fetch(location.pathname+'?v='+Date.now(),{cache:'no-store'}),t=await r.text(),m=t.match(/const APP_VER='([^']+)'/);
    if(!m)throw 0;
    if(m[1]===APP_VER){toast('أنت على أحدث إصدار ('+APP_VER+')');return}
    if(confirm('يوجد إصدار أحدث ('+m[1]+'). تحديث الآن؟'))await hardReload();
  }catch{toast('تعذّر التحقق من التحديث')}
}
openSettings=(o=>function(){
  o();const sh=document.querySelector('.sheet');if(!sh||!sh.querySelector('#s-exp'))return;
  sh.insertAdjacentHTML('beforeend',`<div class="fld" style="margin-top:1rem"><label>الإصدار ${esc(APP_VER)}</label><button class="btn" id="s-upd">${ic('refresh')}التحقق من وجود تحديث</button></div>`);
  sh.querySelector('#s-upd').onclick=checkUpdate;
})(openSettings);

/* ========== تشغيل ========== */
(async()=>{
  applyTheme();
  try{await DB.open();chats=await DB.all('chats')||[];projects=await DB.all('projects')||[];chats.forEach(c=>c.msgs.forEach(m=>{if(m.streaming){m.streaming=false;if(!m.text&&!(m.imgs||[]).length&&!m.blob)m.err='انقطع التوليد قبل اكتمال الرد.'}}))}catch{setTimeout(()=>alert('التخزين غير متاح في هذا الرابط، لذلك لن تُحفظ المحادثات.\nافتح التطبيق من رابط GitHub (https) وليس من ملف على الجهاز.'),600)}
  newDraft();renderAll();checkBackup();
  loadModels();loadImageCaps();refreshAcct();
})();
