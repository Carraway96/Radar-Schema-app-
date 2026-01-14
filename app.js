/* Schema – Smågrupp (v1.6) — per-lesson comment + resource + improved OneDrive/SharePoint follow */
(function () {
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

  function conflictIconSrc() { 
    try { return follow.conflictIconDataUrl || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='%23ef4444' d='M1,21H23L12,2'/><rect x='11' y='9' width='2' height='6' fill='white'/><rect x='11' y='17' width='2' height='2' fill='white'/></svg>"; } 
    catch { return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='%23ef4444' d='M1,21H23L12,2'/><rect x='11' y='9' width='2' height='6' fill='white'/><rect x='11' y='17' width='2' height='2' fill='white'/></svg>"; }
  }

  const WEEKDAYS = ["Söndag","Måndag","Tisdag","Onsdag","Torsdag","Fredag","Lördag"];
  const toMinutes = (hhmm) => { const [h,m] = hhmm.split(":").map(Number); return h*60 + m; };
  const fmt = (n) => String(n).padStart(2,"0");
  const fromMinutes = (min) => `${fmt(Math.floor(min/60))}:${fmt(min%60)}`;
  const todayLocal = () => new Date();
  const ymd = (d) => `${d.getFullYear()}-${fmt(d.getMonth()+1)}-${fmt(d.getDate())}`;
  const randomColor = (s) => { let h=0; for (let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))%360; return `hsl(${h}deg 70% 50%)`; };
  const byKlassOrder = (a, b) => {
    const parseK = (k) => { const m = String(k).toUpperCase().match(/^([7-9])([A-ZÅÄÖ])?$/); return m ? {grade:+m[1], letter:m[2]||""}:{grade:9,letter:"Z"}; };
    const A=parseK(a.klass), B=parseK(b.klass);
    if (A.grade!==B.grade) return A.grade-B.grade;
    return A.letter.localeCompare(B.letter,"sv");
  };

  // Keep storage key to avoid breaking saved data from v1.3
  const STORAGE_KEY = "schema_app_db_v1_3";
  const SETTINGS_KEY = STORAGE_KEY + "_settings";
  const IDXDB_NAME = "schema_app_db"; const IDXDB_STORE = "handles";

  function emptyDB(){return {subjects:{},students:[],lessons:[],absences:{},meta:{createdAt:Date.now(),version:5}};}
  let db = loadDB() || emptyDB();
  let follow = { dataUrl:"", pollSeconds:0, conflictIconDataUrl:"" };

  // File handle state
  let fileHandle = null;
  let fileSupported = !!(window.showOpenFilePicker && window.showSaveFilePicker);
  let fileName = "";

  // UI elements
  let currentWeekday=todayLocal().getDay(); if(currentWeekday===0) currentWeekday=1;
  const weekdaySelect=$("#weekdaySelect");
  const mixContainer=$("#mixContainer");
  const bigContainer=$("#bigContainer");
  const studentListEl=$("#studentList");
  const studentSearch=$("#studentSearch");
  const statusText=$("#statusText");
  const toast=$("#toast");
  const storageInfo=$("#storageInfo");
  const btnReconnect=$("#btnReconnect");

  const lessonDialog=$("#lessonDialog");
  const lessonForm=$("#lessonForm");
  const lessonTitle=$("#lessonDialogTitle");
  const btnDeleteLesson=$("#btnDeleteLesson");

  const studentDialog=$("#studentDialog");
  const studentForm=$("#studentForm");
  const studentTitle=$("#studentDialogTitle");
  const btnDeleteStudent=$("#btnDeleteStudent");

  const settingsDialog=$("#settingsDialog");
  const settingsForm=$("#settingsForm");

  // Editing state
  let editingLessonId = null;
  /* __COLOR_PICK_WIRING__ */
  const colorEls = {
    get input(){ return document.getElementById("lessonColor"); },
    get swatch(){ return document.getElementById("lessonColorSwatch"); },
    get button(){ return document.getElementById("btnPickLessonColor"); }
  };

  // Buttons
  $("#btnAddLesson").addEventListener("click",()=>openLessonDialog(false));
  $("#btnEditLesson").addEventListener("click",()=>showToast("Tips: Klicka på en lektionshuvudrad för att redigera."));
  $("#btnAddStudent").addEventListener("click",()=>openStudentDialog(false));
  $("#btnEditStudent").addEventListener("click",()=>showToast("Tips: Klicka på en elevrad för att redigera."));
  $("#btnToday").addEventListener("click",()=>{ currentWeekday=todayLocal().getDay()||1; weekdaySelect.value=String(currentWeekday); render(); });
  $("#btnPrintPDF").addEventListener("click",()=>window.print());
  $("#btnExport").addEventListener("click",exportJSON);
  $("#btnNewDB").addEventListener("click",()=>{ if(!confirm("Skapa ny TOM databas? Detta raderar nuvarande lokala data.")) return; db=emptyDB(); saveDB(); render(); });
  $("#btnSettings").addEventListener("click",()=>openSettings());
  $("#btnOpenFile").addEventListener("click",openFileViaPicker);
  $("#btnSaveFile").addEventListener("click",saveFileViaPicker);
  btnReconnect.addEventListener("click", reconnectFilePermission);

  // Import file
  $("#importFile").addEventListener("change",(e)=>{
    const file=e.target.files?.[0]; if(!file) return;
    const r=new FileReader();
    r.onload=()=>{ 
      try{ 
        const j=JSON.parse(r.result); 
        if(!j.students||!j.lessons) throw new Error("Ogiltig databasfil."); 
        db=j; saveDB(); render(); showToast("Databas importerad."); 
      }catch(err){ alert("Kunde inte importera: "+err.message);} 
    };
    r.readAsText(file); e.target.value="";
  });

  // Weekday select
  WEEKDAYS.forEach((n,idx)=>{
    const opt=document.createElement("option"); opt.value=String(idx); opt.textContent=n; weekdaySelect.appendChild(opt);
  });
  if(currentWeekday) weekdaySelect.value=String(currentWeekday);
  weekdaySelect.addEventListener("change",()=>{ currentWeekday=Number(weekdaySelect.value); render(); });

  // Search students
  studentSearch.addEventListener("input", renderStudentList);

  // Student row click-to-edit
  studentListEl.addEventListener("click",(e)=>{
    const row = e.target.closest(".student-row"); if(!row) return;
    const id = row.getAttribute("data-id"); if(!id) return;
    openStudentDialog(true, id);
  });

  // ----- DB persistence -----
  function saveDB(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); setStatus("Autosparat"); saveToConnectedFile().catch(()=>{}); updateStorageInfo(); }
  function loadDB(){ try{ const raw=localStorage.getItem(STORAGE_KEY); return raw?JSON.parse(raw):null; }catch{ return null; } }
  function saveSettings(){ localStorage.setItem(SETTINGS_KEY, JSON.stringify(follow)); }
  function loadSettings(){ try{ const raw=localStorage.getItem(SETTINGS_KEY); if(raw) follow=JSON.parse(raw);}catch{} }
  loadSettings();

  // ----- IndexedDB helpers for file handle -----
  function idbOpen(){
    return new Promise((resolve, reject)=>{
      const r = indexedDB.open(IDXDB_NAME, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(IDXDB_STORE); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbSet(key, val){
    const dbx = await idbOpen();
    return new Promise((resolve,reject)=>{
      const tx = dbx.transaction(IDXDB_STORE, "readwrite");
      tx.objectStore(IDXDB_STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbGet(key){
    const dbx = await idbOpen();
    return new Promise((resolve,reject)=>{
      const tx = dbx.transaction(IDXDB_STORE, "readonly");
      const req = tx.objectStore(IDXDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(tx.error);
    });
  }
  async function persistHandle(h){ try { await idbSet("dbFileHandle", h); } catch(e){ console.warn("Kunde inte spara file handle:", e); } }
  async function restoreHandle(){
    try {
      const h = await idbGet("dbFileHandle");
      if (!h) return;
      const perm = await h.queryPermission({mode:"readwrite"});
      if (perm === "granted") {
        fileHandle = h; fileName = h.name || "(fil)";
        showToast("Fil återansluten.");
        updateStorageInfo();
      } else {
        btnReconnect.style.display = "inline-block";
      }
    } catch (e) {
      console.warn("Återanslutning misslyckades:", e);
    }
  }
  async function reconnectFilePermission(){
    try {
      const h = await idbGet("dbFileHandle"); if (!h) return alert("Ingen tidigare fil hittades.");
      const perm = await h.requestPermission({mode:"readwrite"});
      if (perm === "granted") {
        fileHandle = h; fileName = h.name || "(fil)";
        btnReconnect.style.display = "none";
        showToast("Fil återansluten.");
        updateStorageInfo();
      } else {
        alert("Behörighet nekad. Välj fil igen via Öppna/Spara som.");
      }
    } catch (e) {
      alert("Kunde inte återansluta: " + e.message);
    }
  }

  // ---------- Rendering ----------
  function subjectColor(subj){ if(!db.subjects[subj]) db.subjects[subj]=randomColor(subj); return db.subjects[subj]; }

  function render(){ renderLessons(); renderStudentList(); saveDB(); }

  function renderLessons(){
    mixContainer.innerHTML=""; bigContainer.innerHTML="";
    const dayLessons=db.lessons.filter(l=>l.weekday===currentWeekday);
    const byStart=(a,b)=>toMinutes(a.start)-toMinutes(b.start);
    const mix=dayLessons.filter(l=>l.placeType==="Mix").sort(byStart);
    const big=dayLessons.filter(l=>l.placeType==="Stor klass").sort(byStart);

    const renderLesson=(l,targetEl)=>{
      const el=document.createElement("div");
      el.className="lesson";
      el.setAttribute("data-id", l.id);
      el.style.setProperty("--lesson-color", (l.color || subjectColor(l.subject)));

      const hasAnyConflict=lessonHasAnyConflict(l,dayLessons);
      const hasComment = !!(l.comment && String(l.comment).trim());
      const resource = (l.resource && String(l.resource).trim()) ? String(l.resource).trim() : "";

      const metaParts = [
        `<strong>${escapeHTML(l.room||"")}</strong>`,
        `${escapeHTML(WEEKDAYS[l.weekday])}`,
        `${l.start}–${l.end}`
      ];
      if (resource) metaParts.push(`<span class="resource-pill">Resurs: ${escapeHTML(resource)}</span>`);

      el.innerHTML=`
        <div class="lesson-header" data-id="${l.id}" title="Klicka för att redigera">
          <div class="lesson-title">
            <span class="subject-pill" style="border-color:${subjectColor(l.subject)}33;background:${subjectColor(l.subject)}22">
              <span class="subject-dot" style="background:${subjectColor(l.subject)}"></span>
              ${escapeHTML(l.subject)}
            </span>
            ${hasAnyConflict?`<span class="conflict-icon" title="Konflikter för en eller flera elever"><img src="${conflictIconSrc()}" alt="Konflikt"/></span>`:""}
            ${hasComment?`<span class="note-icon" title="${escapeHTML(String(l.comment).trim())}">📝</span>`:""}
          </div>
          <div class="lesson-meta">${metaParts.join(" &middot; ")}</div>
        </div>
        <details>
          <summary>Visa elever</summary>
          ${hasComment?`<div class="lesson-comment"><strong>Kommentar:</strong> ${escapeHTML(String(l.comment).trim())}</div>`:""}
          <div class="lesson-students"></div>
        </details>`;

      // Click-to-edit on header
      $(".lesson-header", el).addEventListener("click",(ev)=>{
        const id = ev.currentTarget.getAttribute("data-id");
        openLessonDialog(true, id);
      });

      // Students
      const list=$(".lesson-students",el);
      const students=l.studentIds.map(id=>db.students.find(s=>s.id===id)).filter(Boolean).sort(byKlassOrder);
      const today=ymd(todayLocal()); const absent=db.absences[today]||{};
      students.forEach(s=>{
        if(absent[s.id]) return;
        const chip=document.createElement("span"); chip.className="student-chip";
        const conflicts=describeConflictsForStudent(l,s,dayLessons); const has=conflicts.length>0;
        chip.title=has?conflicts.join("\\n"):`${s.name} (${s.klass})`;
        chip.innerHTML=`<span class="klass">${escapeHTML(s.klass)}</span><span class="name">${escapeHTML(s.name)}</span>${has?`<span class="badge conflict-icon"><img src="${conflictIconSrc()}" alt="Konflikt"/></span>`:""}`;
        list.appendChild(chip);
      });

      targetEl.appendChild(el);
    };

    mix.forEach(l=>renderLesson(l,mixContainer));
    big.forEach(l=>renderLesson(l,bigContainer));
  }

  function lessonHasAnyConflict(lesson, dayLessons){
    if(lesson.placeType!=="Mix") return false;
    return lesson.studentIds.some(sid=>{
      const s=db.students.find(x=>x.id===sid); if(!s) return false;
      return describeConflictsForStudent(lesson,s,dayLessons).length>0;
    });
  }
  function overlaps(aStart,aEnd,bStart,bEnd){ return toMinutes(aStart)<toMinutes(bEnd)&&toMinutes(bStart)<toMinutes(aEnd); }
  function describeConflictsForStudent(lesson, student, dayLessons){
    if(lesson.placeType!=="Mix") return [];
    const Ls=toMinutes(lesson.start), Le=toMinutes(lesson.end);
    const stor=dayLessons.filter(l=>l.placeType==="Stor klass"&&l.studentIds.includes(student.id));
    const msgs=[];
    for(const big of stor){
      const Bs=toMinutes(big.start), Be=toMinutes(big.end);
      if(!overlaps(lesson.start,lesson.end,big.start,big.end)) continue;
      if(Bs<=Ls && Be>Ls && Be<=Le) msgs.push(`${student.name} kommer sent från ${big.subject} (slutar ${fromMinutes(Be)}).`);
      if(Bs>=Ls && Bs<Le && Be>=Le) msgs.push(`${student.name} går tidigare till ${big.subject} (börjar ${fromMinutes(Bs)}).`);
      if(Bs<=Ls && Be>=Le) msgs.push(`${student.name} är uppbunden i ${big.subject} ${big.start}–${big.end}.`);
    }
    return msgs;
  }

  function renderStudentList(){
    const filter=studentSearch.value.trim().toLowerCase();
    const today=ymd(todayLocal()); const absent=db.absences[today]||{};
    const students=[...db.students].sort(byKlassOrder).filter(s=>s.name.toLowerCase().includes(filter)||s.klass.toLowerCase().includes(filter));
    studentListEl.innerHTML="";
    const dayLessons=db.lessons.filter(l=>l.weekday===currentWeekday);
    const nowMin=toMinutes(fmt(todayLocal().getHours())+":"+fmt(todayLocal().getMinutes()));
    for(const s of students){
      const row=document.createElement("div"); row.className="student-row"; row.setAttribute("data-id", s.id);
      const todays=dayLessons.filter(l=>l.studentIds.includes(s.id));
      const current=todays.find(l=>toMinutes(l.start)<=nowMin && nowMin<toMinutes(l.end));
      const next=todays.filter(l=>toMinutes(l.start)>nowMin).sort((a,b)=>toMinutes(a.start)-toMinutes(b.start))[0];
      let whereText="—", whereTitle="";
      if(absent[s.id]){ whereText="Frånvarande"; whereTitle=`${s.name} är frånvarande idag.`; }
      else if(current){ whereText=`${current.subject} (${current.start}–${current.end})`; whereTitle=`${s.name} är på ${current.subject} i ${current.room||"okänd sal"}.`; }
      else { whereText="Rast"; whereTitle= next?`Nästa: ${next.subject} ${next.start}–${next.end}`:"Inga fler lektioner idag"; }
      const nameCell=document.createElement("div"); nameCell.innerHTML=`<strong>${escapeHTML(s.name)}</strong> <span class="muted">(${escapeHTML(s.klass)})</span>`; nameCell.title=whereTitle;
      const whereCell=document.createElement("div"); whereCell.className="where"; whereCell.textContent=whereText; whereCell.title=whereTitle;
      const absentCell=document.createElement("div"); const cb=document.createElement("input"); cb.type="checkbox"; cb.className="absent-check"; cb.checked=!!absent[s.id];
      cb.title="Markera frånvaro för idag (tas bort från schemavisningen)";
      cb.addEventListener("click",(ev)=>ev.stopPropagation());
      cb.addEventListener("change",()=>{ if(!db.absences[today]) db.absences[today]={}; db.absences[today][s.id]=cb.checked||undefined; saveDB(); renderLessons(); });
      absentCell.appendChild(cb);
      row.appendChild(nameCell); row.appendChild(whereCell); row.appendChild(absentCell);
      studentListEl.appendChild(row);
    }
  }

  // ---------- Dialogs: Lesson ----------
  function openLessonDialog(edit=false, editId=null){
    if(follow.dataUrl){ alert("Du är i följ-läge (datakälla-URL aktiv). Ta bort URL i Inställningar för att redigera."); return; }
    const selWeekday=lessonForm.elements["weekday"]; selWeekday.innerHTML="";
    WEEKDAYS.forEach((n,idx)=>{ const opt=document.createElement("option"); opt.value=String(idx); opt.textContent=n; selWeekday.appendChild(opt); });
    selWeekday.value=String(currentWeekday);
    const studentSel=$("#lessonStudentsSelect"); studentSel.innerHTML="";
    db.students.sort(byKlassOrder).forEach(s=>{ const opt=document.createElement("option"); opt.value=s.id; opt.textContent=`${s.klass} – ${s.name}`; studentSel.appendChild(opt); });

    editingLessonId = null;

    if(edit && editId){
      const target = db.lessons.find(l=>l.id===editId);
      if(!target) { showToast("Kunde inte hitta lektionen."); return; }

      lessonTitle.textContent="Redigera lektion";
      if (lessonForm.elements["subject"])  lessonForm.elements["subject"].value  = target.subject || "";
      if (lessonForm.elements["placeType"]) lessonForm.elements["placeType"].value = target.placeType || "";
      if (lessonForm.elements["room"])     lessonForm.elements["room"].value     = target.room || "";
      if (lessonForm.elements["weekday"])  lessonForm.elements["weekday"].value  = String(target.weekday);
      if (lessonForm.elements["start"])    lessonForm.elements["start"].value    = target.start || "";
      if (lessonForm.elements["end"])      lessonForm.elements["end"].value      = target.end || "";
      if (lessonForm.elements["color"])    lessonForm.elements["color"].value    = target.color || "#1d4ed8";
      if (lessonForm.elements["resource"]) lessonForm.elements["resource"].value = target.resource || "";
      if (lessonForm.elements["comment"])  lessonForm.elements["comment"].value  = target.comment || "";

      initLessonColorUI(target.color || "#1d4ed8");
      $$("#lessonStudentsSelect option").forEach(opt=>{ opt.selected=target.studentIds.includes(opt.value); });
      btnDeleteLesson.hidden=false; btnDeleteLesson.onclick=()=>{
        if(!confirm("Ta bort lektion?")) return;
        db.lessons=db.lessons.filter(l=>l.id!==target.id);
        saveDB(); render(); lessonDialog.close(); showToast("Lektion borttagen.");
      };
      lessonDialog.showModal(); lessonDialog.returnValue=""; lessonDialog.addEventListener("close", onLessonDialogClose, {once:true, passive:true});
      editingLessonId = target.id;
    } else if (edit && !editId) {
      showToast("Klicka på en lektionshuvudrad för att redigera.");
    } else {
      lessonTitle.textContent="Ny lektion";
      if (lessonForm.reset) try { lessonForm.reset(); } catch {}
      if (lessonForm.elements["weekday"]) lessonForm.elements["weekday"].value = String(currentWeekday);
      btnDeleteLesson.hidden=true;
      if (lessonForm.elements["color"]) lessonForm.elements["color"].value = "#1d4ed8";
      if (lessonForm.elements["resource"]) lessonForm.elements["resource"].value = "";
      if (lessonForm.elements["comment"]) lessonForm.elements["comment"].value = "";
      initLessonColorUI("#1d4ed8");
      lessonDialog.showModal(); lessonDialog.returnValue=""; lessonDialog.addEventListener("close", onLessonDialogClose, {once:true, passive:true});
    }
  }

  function initLessonColorUI(defaultColor){
    try {
      if (!colorEls.input) return;
      const c = defaultColor || colorEls.input.value || "#1d4ed8";
      colorEls.input.value = c;
      if (colorEls.swatch) colorEls.swatch.style.background = c;
      if (colorEls.button) colorEls.button.onclick = () => colorEls.input.click();
      colorEls.input.oninput = () => { if (colorEls.swatch) colorEls.swatch.style.background = colorEls.input.value; };
    } catch {}
  }

  function onLessonDialogClose(e){
    if(lessonDialog.returnValue!=="save") return;
    const fd=new FormData(lessonForm);
    const subject=String(fd.get("subject")||"").trim();
    const placeType=String(fd.get("placeType"));
    const room=String(fd.get("room")||"").trim();
    const weekday=Number(fd.get("weekday"));
    const start=String(fd.get("start"));
    const end=String(fd.get("end"));
    const color=String(fd.get("color")||"");
    const resource=String(fd.get("resource")||"").trim();
    const comment=String(fd.get("comment")||"").trim();
    const studentIds=Array.from(lessonForm.elements["students"].selectedOptions).map(o=>o.value);
    if(!subject||!start||!end) return;

    if (editingLessonId) {
      const l = db.lessons.find(x=>x.id===editingLessonId);
      if (l) {
        l.subject=subject; l.placeType=placeType; l.room=room; l.weekday=weekday; l.start=start; l.end=end; l.studentIds=studentIds;
        l.color = color || undefined;
        l.resource = resource || undefined;
        l.comment = comment || undefined;
        if (!db.subjects[subject]) db.subjects[subject]=randomColor(subject);
        showToast("Lektion uppdaterad.");
      }
    } else {
      const id=crypto.randomUUID();
      db.lessons.push({
        id,subject,placeType,room,weekday,start,end,studentIds,
        color: color || undefined,
        resource: resource || undefined,
        comment: comment || undefined
      });
      if (!db.subjects[subject]) db.subjects[subject]=randomColor(subject);
      showToast("Lektion tillagd.");
    }

    currentWeekday = weekday; weekdaySelect.value = String(currentWeekday);
    saveDB(); render();
  }

  // ---------- Dialogs: Student ----------
  function openStudentDialog(edit=false, editId=null){
    if(follow.dataUrl){ alert("Du är i följ-läge (datakälla-URL aktiv). Ta bort URL i Inställningar för att redigera."); return; }
    if(edit && editId){
      const s = db.students.find(x=>x.id===editId);
      if(!s) return;
      studentTitle.textContent="Redigera elev";
      studentForm.elements["name"].value=s.name;
      studentForm.elements["klass"].value=s.klass;
      btnDeleteStudent.hidden=false;
      btnDeleteStudent.onclick=()=>{
        if(!confirm("Ta bort elev? Eleven tas även bort från lektioner.")) return;
        db.students=db.students.filter(x=>x.id!==s.id);
        db.lessons.forEach(l=>l.studentIds=l.studentIds.filter(id=>id!==s.id));
        saveDB(); render(); studentDialog.close(); showToast("Elev borttagen.");
      };
      studentDialog.showModal();
      studentDialog.returnValue="";
      studentDialog.addEventListener("close",(e)=>onStudentDialogClose(e, s.id), {once:true, passive:true});
    } else if(edit && !editId){
      showToast("Klicka på en elev i listan för att redigera.");
    } else {
      studentTitle.textContent="Ny elev"; studentForm.reset(); btnDeleteStudent.hidden=true;
      studentDialog.showModal(); studentDialog.returnValue=""; studentDialog.addEventListener("close",(e)=>onStudentDialogClose(e, null),{once:true, passive:true});
    }
  }
  function onStudentDialogClose(e, editId){
    if(studentDialog.returnValue!=="save") return;
    const fd=new FormData(studentForm); const name=String(fd.get("name")||"").trim(); const klass=String(fd.get("klass")||"").trim().toUpperCase();
    if(!name||!klass) return;
    if(editId){ const s=db.students.find(x=>x.id===editId); if(s){ s.name=name; s.klass=klass; showToast("Elev uppdaterad."); } }
    else { const id=crypto.randomUUID(); db.students.push({id,name,klass}); showToast("Elev tillagd."); }
    saveDB(); render();
  }

  // ---------- Settings & follow mode ----------
  function openSettings(){
    settingsForm.reset(); settingsForm.elements["dataUrl"].value=follow.dataUrl||""; settingsForm.elements["pollSeconds"].value=follow.pollSeconds||0;
    settingsDialog.showModal(); settingsDialog.returnValue="";
    settingsDialog.addEventListener("close", onSettingsClose, {once:true,passive:true});
    settingsForm.elements["conflictIcon"].addEventListener("change",(e)=>{
      const file=e.target.files?.[0]; if(!file) return; const r=new FileReader(); r.onload=()=>{ follow.conflictIconDataUrl=r.result; saveSettings(); showToast("Ikon uppdaterad."); }; r.readAsDataURL(file);
    });
  }
  function onSettingsClose(e){
    if(settingsDialog.returnValue!=="save") return;
    const fd=new FormData(settingsForm);
    follow.dataUrl=String(fd.get("dataUrl")||"").trim();
    follow.pollSeconds=Number(fd.get("pollSeconds")||"0");
    saveSettings(); setupPolling(); render();
  }

  function looksLikeHtml(text, contentType){
    const t = (text || "").trimStart();
    if (contentType && /text\/html/i.test(contentType)) return true;
    return t.startsWith("<!doctype") || t.startsWith("<html") || t.startsWith("<");
  }

  function buildCandidateUrls(originalUrl){
    const u = String(originalUrl || "").trim();
    if (!u) return [];
    const urls = [];

    const withParam = (url, key, val) => {
      try {
        const x = new URL(url);
        x.searchParams.set(key, val);
        return x.toString();
      } catch {
        const hasQ = url.includes("?");
        return url + (hasQ ? "&" : "?") + encodeURIComponent(key) + "=" + encodeURIComponent(val);
      }
    };

    // 1) original
    urls.push(u);

    // 2) Common "force file" params (often needed for OneDrive/SharePoint)
    urls.push(withParam(u, "download", "1"));
    urls.push(withParam(u, "raw", "1"));
    urls.push(withParam(u, "web", "0"));

    // 3) If it's OneDrive live share page, try converting to /download endpoint
    //    (works for links like https://onedrive.live.com/?cid=...&resid=...&authkey=...)
    try{
      const parsed = new URL(u);
      if (/onedrive\.live\.com$/i.test(parsed.hostname)) {
        const cid = parsed.searchParams.get("cid");
        const resid = parsed.searchParams.get("resid") || parsed.searchParams.get("id");
        const authkey = parsed.searchParams.get("authkey");
        if (cid && resid) {
          const d = new URL("https://onedrive.live.com/download");
          d.searchParams.set("cid", cid);
          d.searchParams.set("resid", resid);
          if (authkey) d.searchParams.set("authkey", authkey);
          urls.push(d.toString());
        }
      }
    }catch{}

    // 4) Extra SharePoint-ish variants
    if (/my\.sharepoint\.com/i.test(u) || /sharepoint\.com/i.test(u) || /1drv\.ms/i.test(u)) {
      if (!/[\?&]download=1/i.test(u)) urls.push(u + (u.includes("?") ? "&" : "?") + "download=1");
      urls.push(withParam(withParam(u, "download", "1"), "web", "0"));
    }

    // De-dup
    return Array.from(new Set(urls));
  }

  async function fetchText(url){
    const res = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      headers: { "Accept": "application/json,text/plain,*/*" }
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, finalUrl: res.url || url, contentType: res.headers.get("content-type") || "" };
  }

  function setupPolling(){
    if(window._pollTimer){ clearInterval(window._pollTimer); window._pollTimer=null; }
    if(!follow.dataUrl||!follow.pollSeconds) return;
    let lastHash=null;

    const tick=async()=>{
      const candidates = buildCandidateUrls(follow.dataUrl);

      try{
        setStatus("Hämtar datakälla…");

        let lastErr = null;

        for (const url of candidates) {
          try{
            const res = await fetchText(url);
            if(!res.ok){
              lastErr = new Error(`HTTP ${res.status}`);
              continue;
            }

            // If we got an HTML page, it's almost certainly a share/preview page, not the raw JSON file
            if (looksLikeHtml(res.text, res.contentType)) {
              lastErr = new Error("Fick HTML (förhandsvisningssida) istället för JSON.");
              continue;
            }

            const hash=await digest(res.text);
            if(hash!==lastHash){
              let json;
              try{
                json = JSON.parse(res.text);
              }catch(e){
                lastErr = new Error("Kunde inte tolka som JSON (fel fil/länk).");
                continue;
              }

              if(json.students&&json.lessons){
                db=json; saveDB(); render(); showToast("Datakälla uppdaterad."); lastHash=hash;
              } else {
                lastErr = new Error("Datakälla saknar students/lessons.");
                continue;
              }
            }

            setStatus("Klar");
            return; // success
          }catch(e){
            // CORS / network errors often land here as TypeError: Failed to fetch
            lastErr = e;
            continue;
          }
        }

        setStatus("Fel vid hämtning");
        console.warn("Datakälla misslyckades. Testade länkar:", candidates);
        console.warn("Senaste fel:", lastErr);

      }catch(err){
        setStatus("Fel vid hämtning");
        console.warn(err);
      }
    };

    tick();
    window._pollTimer=setInterval(tick, Math.max(5, follow.pollSeconds)*1000);
  }

  async function digest(str){ const enc=new TextEncoder().encode(str); const buf=await crypto.subtle.digest("SHA-256",enc); return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join(""); }

  // ---------- File System Access ----------
  async function openFileViaPicker(){
    try{
      if(!fileSupported) return alert("Öppna fil stöds inte i denna webbläsare. Prova Chrome/Edge.");
      const [handle]=await window.showOpenFilePicker({types:[{description:"JSON",accept:{"application/json":[".json"]}}],excludeAcceptAllOption:false,multiple:false});
      const file=await handle.getFile(); const text=await file.text(); const json=JSON.parse(text);
      if(!json.students||!json.lessons) throw new Error("Ogiltig databasfil.");
      fileHandle=handle; fileName=handle.name; await persistHandle(handle);
      db=json; saveDB(); render(); showToast("Fil öppnad och kopplad. Autosparar till filen."); updateStorageInfo(); btnReconnect.style.display="none";
    }catch(e){ if(e && e.name!=="AbortError") alert("Kunde inte öppna fil: "+e.message); }
  }
  async function saveFileViaPicker(){
    try{
      if(fileSupported){
        if(!fileHandle){
          fileHandle=await window.showSaveFilePicker({suggestedName:"schema-db.json",types:[{description:"JSON",accept:{"application/json":[".json"]}}]});
          fileName=fileHandle.name; await persistHandle(fileHandle);
        }
        await writeToFileHandle(fileHandle, JSON.stringify(db,null,2)); showToast("Sparat till fil."); updateStorageInfo(); btnReconnect.style.display="none";
      } else {
        exportJSON();
      }
    }catch(e){ if(e && e.name!=="AbortError") alert("Kunde inte spara fil: "+e.message); }
  }
  async function saveToConnectedFile(){ if(!fileHandle) return; try{ await writeToFileHandle(fileHandle, JSON.stringify(db,null,2)); }catch(e){ console.warn("Autosave-to-file misslyckades:",e); } }
  async function writeToFileHandle(handle,text){ const perm=await handle.requestPermission({mode:"readwrite"}); if(perm!=="granted") throw new Error("Behörighet nekad"); const w=await handle.createWritable(); await w.write(text); await w.close(); }

  // ---------- Misc helpers ----------
  function exportJSON(){
    const blob=new Blob([JSON.stringify(db,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob); const a=Object.assign(document.createElement("a"),{href:url,download:"schema-db.json"});
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); showToast("Databas exporterad.");
  }
  function setStatus(msg){ statusText.textContent=msg; }
  function showToast(msg){ toast.textContent=msg; toast.classList.add("show"); setTimeout(()=>toast.classList.remove("show"),1800); }
  function escapeHTML(s){ return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }
  function updateStorageInfo(){ const parts=["Lagring: Lokal webbläsare"]; if(fileHandle) parts.push(`+ Fil: ${fileName||"(kopplad)"}`); if(follow.dataUrl) parts.push(`+ Följ-läge från URL`); storageInfo.textContent=parts.join(" • "); }

  // Init
  render(); setupPolling(); updateStorageInfo(); restoreHandle();

})();
