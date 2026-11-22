function element(tag,text,cls) {
  const node=document.createElement(tag); if(text!=null) node.textContent=text; if(cls) node.className=cls; return node;
}
async function api(path,data) {
  const r=await fetch(path,data ? {method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(data)} : {});
  if(!r.ok) throw new Error((await r.json().catch(()=>null))?.error || "操作未完成，请重试");
  return r.json();
}

export function initAnnotations(article,lines) {
  const {book,chapter,member}=article.dataset, endpoint="/api/novels/"+book+"/notes";
  const dialog=document.querySelector(".notes-drawer"), floating=document.querySelector("[data-quote-note]");
  const form=dialog.querySelector("form"), thread=dialog.querySelector("[data-note-thread]");
  const excerpt=form.querySelector("blockquote"), replyTo=form.querySelector("[data-reply-to]"), cancel=form.querySelector("[data-note-cancel]");
  const notice=form.querySelector("output"), submit=form.querySelector(".primary");
  let at=-1, quote="", parent=null, draftKey, generation=0, selection, lastFocus, mutation=0;
  const buttons=lines.map((p,i)=>{
    p.dataset.p=i;
    const b=element("button","","para-note"); b.type="button"; b.setAttribute("aria-label","第 "+(i+1)+" 段评论");
    p.previousElementSibling.append(b);
    b.addEventListener("click",()=>open(i,"",b));
    return b;
  });
  function count(i,n) {
    const b=buttons[i]; if(!b)return;
    b.textContent=n?String(n):""; b.classList.toggle("has-notes",Boolean(n)); b.setAttribute("aria-label","第 "+(i+1)+" 段评论，"+n+" 条");
  }
  async function counts() {
    const version=mutation;
    try {
      const data=await api(endpoint+"?chapter="+chapter+"&counts=1");
      if(version===mutation) {const map=new Map(data.counts.map(c=>[c.paragraph,c.n]));buttons.forEach((_,i)=>count(i,map.get(i)||0));}
    } catch { /* Paragraph buttons still open the live thread. */ }
  }
  counts();
  function setDraft(q="",p=null,label="") {
    quote=q;parent=p;draftKey=crypto.randomUUID();
    excerpt.textContent=q;excerpt.hidden=!q;replyTo.textContent=label;replyTo.hidden=!p;cancel.hidden=!p;
  }
  function role(author){return author===member?"我":author==="her"?"她":"他";}
  function action(text,fn) { const b=element("button",text,"note-action");b.type="button";b.addEventListener("click",fn);return b; }
  function noteRow(n) {
    const node=element("section",null,n.parent_id?"note-entry reply":"note-entry");
    const head=element("header");head.append(element("strong",role(n.author)));
    const time=element("time",new Date(n.created_at*1000).toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}));
    head.append(time);node.append(head);
    if(n.quote) node.append(element("blockquote",n.quote));
    node.append(element("div",n.body,"note-body"));
    if(!n.parent_id) node.append(action("回复",()=>{setDraft("",n.id,"回复"+role(n.author));form.elements.body.focus();}));
    if(n.author===member) node.append(action("删除",async()=>{
      if(!confirm(n.parent_id?"删除这条回复？":"删除这条评论和下面的回复？")) return;
      const version=generation, index=at;
      try {
        const data=await api(endpoint+"/"+n.id+"/delete",{});mutation++;
        document.dispatchEvent(new CustomEvent("futari:messages",{detail:data}));
        if(version===generation) {if(parent===n.id)setDraft();await loadThread(index,version);}
      } catch(e) {if(version===generation)notice.textContent=e.message;}
    }));
    return node;
  }
  async function loadThread(index,version) {
    const result=await api(endpoint+"?chapter="+chapter+"&paragraph="+index);
    if(version!==generation || !dialog.open) return;
    const replies=new Map();
    for(const n of result.notes) if(n.parent_id){if(!replies.has(n.parent_id))replies.set(n.parent_id,[]);replies.get(n.parent_id).push(n);}
    const nodes=[];
    for(const n of result.notes) if(!n.parent_id){const node=noteRow(n);for(const reply of replies.get(n.id)||[])node.append(noteRow(reply));nodes.push(node);}
    thread.replaceChildren(...(nodes.length?nodes:[element("div","这段还没有评论。","thread-empty")]));
    count(index,result.notes.length);mutation++;
    const unread=result.notes.filter(n=>n.unread).map(n=>n.id);
    for(let i=0;i<unread.length;i+=200) {
      if(version!==generation || !dialog.open) break;
      const read=await api("/api/messages/read",{book_id:book,chapter,paragraph:index,ids:unread.slice(i,i+200)});
      document.dispatchEvent(new CustomEvent("futari:messages",{detail:read}));
    }
  }
  function open(index,q="",trigger) {
    if(!lines[index])return;
    const version=++generation;at=index;lastFocus=trigger || buttons[index];
    selection=null;floating.hidden=true;getSelection()?.removeAllRanges();
    setDraft(q);form.elements.body.value="";notice.textContent="";submit.disabled=false;
    dialog.querySelector("[data-note-location]").textContent="第 "+(index+1)+" 段";
    thread.replaceChildren(element("div","正在读取评论…","thread-empty"));
    if(!dialog.open) {
      document.documentElement.dataset.notesOpen="";
      document.dispatchEvent(new Event("notes:overlaychange"));dialog.showModal();
      dialog.querySelector("[data-note-close]").focus({preventScroll:true});
    }
    loadThread(index,version).catch(e=>{if(version===generation){thread.replaceChildren();notice.textContent=e.message;}});
  }
  dialog.querySelector("[data-note-close]").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("close",()=>{
    ++generation;at=-1;delete document.documentElement.dataset.notesOpen;
    document.dispatchEvent(new Event("notes:overlaychange"));lastFocus?.focus({preventScroll:true});
  });
  cancel.addEventListener("click",()=>setDraft());
  form.elements.body.addEventListener("input",()=>{draftKey=crypto.randomUUID();});
  form.addEventListener("submit",async e=>{
    e.preventDefault();if(submit.disabled || !form.elements.body.value.trim())return;
    const index=at,version=generation;submit.disabled=true;notice.textContent="";
    try {
      await api(endpoint,{id:draftKey,chapter,paragraph:index,parent_id:parent,quote,body:form.elements.body.value});mutation++;
      document.dispatchEvent(new CustomEvent("futari:messages"));
      if(version===generation){form.elements.body.value="";setDraft();await loadThread(index,version);}
    } catch(err){if(version===generation)notice.textContent=err.message;}
    finally{if(version===generation)submit.disabled=false;}
  });
  function inspectSelection(){
    const s=getSelection();
    if(dialog.open || !s?.rangeCount || s.isCollapsed){selection=null;floating.hidden=true;return;}
    const range=s.getRangeAt(0);
    const p=range.startContainer.parentElement?.closest("p[data-p]");
    if(!p || !article.contains(p) || !p.contains(range.endContainer)){selection=null;floating.hidden=true;return;}
    const q=[...range.toString().trim()].slice(0,300).join("");
    if(!q){floating.hidden=true;return;}
    const r=range.getBoundingClientRect();
    selection={index:Number(p.dataset.p),q};
    floating.hidden=false;
    floating.style.left=Math.max(8,Math.min(innerWidth-floating.offsetWidth-8,r.left+r.width/2-floating.offsetWidth/2))+"px";
    floating.style.top=Math.max(8,Math.min(innerHeight-floating.offsetHeight-8,r.top>55?r.top-floating.offsetHeight-6:r.bottom+5))+"px";
  }
  document.addEventListener("selectionchange",inspectSelection);
  addEventListener("scroll",()=>{if(!floating.hidden)inspectSelection();},{passive:true});
  // Some touch browsers finish a long press with a collapsed caret. Leave native selections alone.
  let press;
  article.addEventListener("pointerdown",e=>{
    const line=e.target.closest("p[data-p]");
    press=e.pointerType==="touch" && e.isPrimary && line ? {line,x:e.clientX,y:e.clientY,time:e.timeStamp} : null;
  });
  article.addEventListener("pointermove",e=>{
    if(press && Math.hypot(e.clientX-press.x,e.clientY-press.y)>10) press=null;
  });
  article.addEventListener("pointercancel",()=>{press=null;});
  article.addEventListener("pointerup",e=>{
    const hit=press;press=null;
    if(!hit || e.timeStamp-hit.time<500) return;
    setTimeout(()=>{
      const s=getSelection(),text=hit.line.firstChild;
      if(!s || !s.isCollapsed || dialog.open || !text?.length) return;
      const caret=document.caretPositionFromPoint?.(hit.x,hit.y);
      const legacy=caret ? null : document.caretRangeFromPoint?.(hit.x,hit.y);
      if((caret?.offsetNode ?? legacy?.startContainer)!==text) return;
      const offset=caret?.offset ?? legacy.startOffset;
      const sentence=typeof Intl.Segmenter==="function"
        ? new Intl.Segmenter("zh",{granularity:"sentence"}).segment(text.data).containing(Math.min(offset,text.length-1)) : null;
      const base=sentence?.index ?? 0, chars=[...(sentence?.segment ?? text.data)];
      const tapped=[...text.data.slice(base,offset)].length;
      const start=Math.max(0,Math.min(tapped-150,chars.length-300));
      const from=base+chars.slice(0,start).join("").length, range=document.createRange();
      range.setStart(text,from);range.setEnd(text,from+chars.slice(start,start+300).join("").length);
      s.removeAllRanges();s.addRange(range);
    },100);
  });
  floating.addEventListener("pointerdown",e=>e.preventDefault());
  floating.addEventListener("click",()=>{if(selection)open(selection.index,selection.q);});
  function deepLink() {
    const match=location.hash.match(/^#note-p-(\d+)$/);if(!match)return;
    const index=Number(match[1]),line=lines[index];if(!line)return;
    line.scrollIntoView({block:"center",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});
    line.classList.add("marked-para");setTimeout(()=>line.classList.remove("marked-para"),1500);
    open(index);
  }
  addEventListener("hashchange",deepLink);
  if(location.hash) requestAnimationFrame(deepLink);
}
