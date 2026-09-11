(() => {
  const API = 'https://fundfxt.onrender.com';
  const token = localStorage.getItem('fundfxt_admin_token');
  if (!token) return;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const auth = () => ({Authorization:`Bearer ${localStorage.getItem('fundfxt_admin_token') || token}`,'Content-Type':'application/json'});
  let tables = [], currentTable = '', currentSchema = null, currentPage = 1;

  async function api(path, options={}) {
    const r = await fetch(API + path, {...options, headers:{...auth(), ...(options.headers||{})}});
    const d = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(d.error || d.message || `Request failed (${r.status})`);
    return d;
  }

  function buildUI() {
    if ($('section-database')) return;
    const nav = document.querySelector('.nav');
    if (nav) {
      const label = document.createElement('div'); label.className='nav-label'; label.textContent='Database';
      const button = document.createElement('button'); button.id='database-control-nav'; button.dataset.section='database'; button.innerHTML='<span class="nav-icon">▦</span>Database Control';
      button.addEventListener('click', e => { e.preventDefault(); if (typeof window.showSection==='function') window.showSection('database'); else { document.querySelectorAll('.view').forEach(v=>v.classList.remove('active')); $('section-database').classList.add('active'); } loadTables(); });
      nav.append(label, button);
    }
    const main = document.querySelector('.main'); if (!main) return;
    const section = document.createElement('section'); section.id='section-database'; section.className='view';
    section.innerHTML=`<div class="top"><div><div class="eyebrow">Database Administration</div><h1>Database Control</h1><p>Live MySQL database explorer. Changes are applied directly to the backend database.</p></div><button class="btn secondary" id="dbRefresh">↻ Refresh</button></div><div class="db-layout"><div class="panel db-tables-panel"><div class="db-panel-head"><div><h3>Tables</h3><small id="dbName">Loading database…</small></div></div><input class="input" id="dbTableSearch" placeholder="Search tables…"><div id="dbTables" class="db-table-list"><div class="loading">Loading tables…</div></div></div><div class="panel db-data-panel"><div class="db-panel-head db-data-head"><div><h3 id="dbSelectedTitle">Select a table</h3><small id="dbTableMeta">Choose a table to inspect its records and schema.</small></div><div class="db-actions"><button class="btn secondary" id="dbSchemaBtn" disabled>Schema</button><button class="btn" id="dbAddBtn" disabled>+ Add Row</button></div></div><div class="toolbar db-toolbar"><input class="input search" id="dbRowSearch" placeholder="Search current table…" disabled><button class="btn secondary" id="dbRowSearchBtn" disabled>Search</button></div><div id="dbSchema" class="db-schema" hidden></div><div class="table-wrap db-grid-wrap"><table class="table" id="dbRowsTable"><thead></thead><tbody></tbody></table><div id="dbRowsLoading" class="loading">Select a table.</div><div id="dbRowsEmpty" class="empty" style="display:none">No records found.</div></div><div class="db-pagination"><button class="btn secondary" id="dbPrev" disabled>← Previous</button><span id="dbPageInfo">Page 0 of 0</span><button class="btn secondary" id="dbNext" disabled>Next →</button></div></div></div><div id="dbEditor" class="db-editor" hidden></div>`;
    main.appendChild(section);
    $('dbRefresh').addEventListener('click', loadTables); $('dbTableSearch').addEventListener('input', renderTableList); $('dbRowSearchBtn').addEventListener('click',()=>loadRows(1)); $('dbRowSearch').addEventListener('keydown',e=>{if(e.key==='Enter')loadRows(1)}); $('dbPrev').addEventListener('click',()=>loadRows(currentPage-1)); $('dbNext').addEventListener('click',()=>loadRows(currentPage+1)); $('dbSchemaBtn').addEventListener('click',()=>{$('dbSchema').hidden=!$('dbSchema').hidden}); $('dbAddBtn').addEventListener('click',()=>openEditor(null));
    injectStyles(); loadTables();
  }

  function renderTableList() {
    const q=($('dbTableSearch')?.value||'').trim().toLowerCase(); const list=tables.filter(t=>String(t.name).toLowerCase().includes(q)); const box=$('dbTables'); box.innerHTML='';
    if(!list.length){box.innerHTML='<div class="empty">No tables found.</div>';return;}
    list.forEach(t=>{const b=document.createElement('button'); b.type='button'; b.className='db-table-item'+(t.name===currentTable?' active':''); b.innerHTML=`<span><b>${esc(t.name)}</b><small>${esc(t.type)} · ${Number(t.column_count||0)} cols</small></span><strong>${Number(t.estimated_rows||0).toLocaleString()}</strong>`; b.addEventListener('click',()=>selectTable(t.name)); box.appendChild(b)});
  }

  async function selectTable(name){
    currentTable=name; currentPage=1; renderTableList(); $('dbSelectedTitle').textContent=name; $('dbTableMeta').textContent='Loading schema and records…'; $('dbRowSearch').disabled=false; $('dbRowSearchBtn').disabled=false; $('dbSchemaBtn').disabled=false; $('dbAddBtn').disabled=false; $('dbSchema').hidden=true; $('dbRowsTable').querySelector('thead').innerHTML=''; $('dbRowsTable').querySelector('tbody').innerHTML='';
    await Promise.all([loadSchema(),loadRows(1)]);
  }

  async function loadTables(){
    $('dbTables').innerHTML='<div class="loading">Loading tables…</div>';
    try{const d=await api('/api/admin/database/tables'); tables=d.tables||[]; $('dbName').textContent=d.database||'Connected database'; renderTableList(); if(currentTable && !tables.some(t=>t.name===currentTable)) currentTable='';}
    catch(e){$('dbTables').innerHTML=`<div class="error-box">${esc(e.message)}</div>`}
  }

  async function loadSchema(){
    if(!currentTable)return; try{currentSchema=await api(`/api/admin/database/tables/${encodeURIComponent(currentTable)}/schema`); $('dbTableMeta').textContent=`${currentSchema.columns?.length||0} columns · ${currentSchema.table?.TABLE_TYPE||'TABLE'}`; renderSchema()}catch(e){$('dbTableMeta').textContent='Schema error: '+e.message; currentSchema=null}
  }

  function renderSchema(){const s=currentSchema;if(!s)return;$('dbSchema').innerHTML=`<div class="db-schema-grid">${(s.columns||[]).map(c=>`<div><b>${esc(c.COLUMN_NAME)}</b><span>${esc(c.COLUMN_TYPE)}</span><small>${esc(c.COLUMN_KEY||'')}${c.IS_NULLABLE==='YES'?' · nullable':' · required'}${c.EXTRA?' · '+esc(c.EXTRA):''}</small></div>`).join('')}</div>`}

  async function loadRows(page){
    if(!currentTable)return; currentPage=Math.max(1,page); $('dbRowsLoading').style.display='block'; $('dbRowsEmpty').style.display='none';
    try{const search=($('dbRowSearch').value||'').trim();const d=await api(`/api/admin/database/tables/${encodeURIComponent(currentTable)}/rows?page=${currentPage}&pageSize=50&search=${encodeURIComponent(search)}`);renderRows(d)}
    catch(e){$('dbRowsLoading').style.display='none';$('dbRowsEmpty').style.display='block';$('dbRowsEmpty').textContent='Unable to load table: '+e.message;$('dbRowsTable').querySelector('thead').innerHTML='';$('dbRowsTable').querySelector('tbody').innerHTML=''}
  }

  function renderRows(d){
    const cols=d.columns||[], dataRows=d.rows||[], pk=cols.find(c=>c.COLUMN_KEY==='PRI'); const head=$('dbRowsTable').querySelector('thead'), body=$('dbRowsTable').querySelector('tbody');
    head.innerHTML=`<tr>${cols.map(c=>`<th>${esc(c.COLUMN_NAME)}</th>`).join('')}<th>Actions</th></tr>`; body.innerHTML='';
    dataRows.forEach(row=>{const tr=document.createElement('tr');cols.forEach(c=>{const td=document.createElement('td');const value=row[c.COLUMN_NAME];td.title=String(value??'');td.textContent=value!==null&&typeof value==='object'?JSON.stringify(value):String(value??'');tr.appendChild(td)});const td=document.createElement('td');if(pk){const edit=document.createElement('button');edit.className='copy-btn';edit.textContent='Edit';edit.addEventListener('click',()=>openEditor(row));const del=document.createElement('button');del.className='copy-btn danger';del.textContent='Delete';del.addEventListener('click',()=>deleteRow(row[pk.COLUMN_NAME]));td.append(edit,del)}else td.textContent='Read-only';tr.appendChild(td);body.appendChild(tr)});
    $('dbRowsLoading').style.display='none'; $('dbRowsEmpty').style.display=dataRows.length?'none':'block'; $('dbPageInfo').textContent=`Page ${d.page||1} of ${d.totalPages||1} · ${Number(d.total||0).toLocaleString()} rows`; $('dbPrev').disabled=(d.page||1)<=1; $('dbNext').disabled=(d.page||1)>=(d.totalPages||1);
  }

  function openEditor(row){
    if(!currentSchema)return; const pk=currentSchema.columns.find(c=>c.COLUMN_KEY==='PRI'), editor=$('dbEditor'), editing=!!row; editor.hidden=false;
    editor.innerHTML=`<div class="db-editor-card"><div class="db-panel-head"><div><h3>${editing?'Edit Record':'Add Record'}</h3><small>${esc(currentTable)}</small></div><button class="icon-btn" id="dbEditorClose">×</button></div><div class="db-form-grid">${currentSchema.columns.map(c=>`<label>${esc(c.COLUMN_NAME)}<input class="input" data-db-field="${esc(c.COLUMN_NAME)}" value="${esc(row?.[c.COLUMN_NAME])}" ${editing&&pk?.COLUMN_NAME===c.COLUMN_NAME?'disabled':''} placeholder="${esc(c.COLUMN_TYPE)}"></label>`).join('')}</div><div class="db-editor-actions"><button class="btn secondary" id="dbEditorCancel">Cancel</button><button class="btn" id="dbEditorSave">${editing?'Save Changes':'Insert Record'}</button></div></div>`;
    $('dbEditorClose').addEventListener('click',()=>editor.hidden=true);$('dbEditorCancel').addEventListener('click',()=>editor.hidden=true);$('dbEditorSave').addEventListener('click',()=>saveEditor(row,pk));
  }

  async function saveEditor(original,pk){const data={};document.querySelectorAll('[data-db-field]').forEach(i=>data[i.dataset.dbField]=i.value);try{if(original){if(!pk)throw Error('Edit requires exactly one primary key column');await api(`/api/admin/database/tables/${encodeURIComponent(currentTable)}/rows/${encodeURIComponent(original[pk.COLUMN_NAME])}`,{method:'PATCH',body:JSON.stringify({data})})}else await api(`/api/admin/database/tables/${encodeURIComponent(currentTable)}/rows`,{method:'POST',body:JSON.stringify({data})});$('dbEditor').hidden=true;await loadTables();await loadRows(currentPage)}catch(e){alert(e.message)}}
  async function deleteRow(id){if(!confirm(`Delete this record from ${currentTable}? This cannot be undone.`))return;try{await api(`/api/admin/database/tables/${encodeURIComponent(currentTable)}/rows/${encodeURIComponent(id)}`,{method:'DELETE'});await loadTables();await loadRows(currentPage)}catch(e){alert(e.message)}}

  function injectStyles(){if($('database-control-styles'))return;const s=document.createElement('style');s.id='database-control-styles';s.textContent='.db-layout{display:grid;grid-template-columns:280px minmax(0,1fr);gap:14px}.db-table-list{max-height:610px;overflow:auto}.db-table-item{width:100%;border:1px solid var(--border);background:var(--card);color:var(--text);padding:10px;border-radius:10px;display:flex;justify-content:space-between;text-align:left;margin:5px 0;cursor:pointer}.db-table-item.active,.db-table-item:hover{border-color:var(--green2,#00b56a)}.db-table-item span{display:flex;flex-direction:column;gap:2px}.db-table-item small{color:var(--muted)}.db-table-item strong{font-size:11px;color:var(--green2,#00b56a)}.db-grid-wrap{max-height:560px;overflow:auto}.db-grid-wrap table{min-width:900px}.db-grid-wrap td{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.db-actions{display:flex;gap:8px;flex-wrap:wrap}.db-schema{border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:10px}.db-schema-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.db-schema-grid>div{padding:8px;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;gap:3px}.db-schema-grid span{font-family:monospace;font-size:11px}.db-schema-grid small{color:var(--muted)}.db-editor{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000;padding:5vh 5vw;overflow:auto}.db-editor-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:18px;max-width:1000px;margin:auto;box-shadow:0 20px 70px rgba(0,0,0,.35)}.db-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.db-form-grid label{display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--muted)}.db-editor-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:15px}.db-pagination{display:flex;align-items:center;justify-content:center;gap:14px;padding-top:12px}@media(max-width:900px){.db-layout{grid-template-columns:1fr}.db-table-list{max-height:260px}.db-form-grid{grid-template-columns:1fr}}';document.head.appendChild(s)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',buildUI);else buildUI();
})();
