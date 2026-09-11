(() => {
  const API = "https://fundfxt.onrender.com";
  const token = localStorage.getItem("fundfxt_admin_token");
  if (!token) return;

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
  const esc = (v) => String(v ?? "").replace(/[&<>\"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);
  let currentTable = "";
  let currentPage = 1;
  let currentSchema = null;

  async function request(path, options = {}) {
    const r = await fetch(API + path, { ...options, headers: { ...auth(), ...(options.headers || {}) } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
    return d;
  }

  function buildUI() {
    if ($("database-control-nav")) return;
    const nav = document.querySelector(".nav");
    if (nav) {
      const label = document.createElement("div");
      label.className = "nav-label";
      label.textContent = "Database";
      const button = document.createElement("button");
      button.id = "database-control-nav";
      button.dataset.section = "database";
      button.innerHTML = '<span class="nav-icon">▦</span>Database Control';
      button.onclick = () => window.showSection("database");
      nav.append(label, button);
    }

    const main = document.querySelector(".main");
    if (!main) return;
    const section = document.createElement("section");
    section.id = "section-database";
    section.className = "view";
    section.innerHTML = `
      <div class="top">
        <div>
          <div class="eyebrow">Database Administration</div>
          <h1>Database Control</h1>
          <p>Live MySQL database explorer. Changes are applied directly to the backend database.</p>
        </div>
        <button class="btn secondary" id="dbRefresh">↻ Refresh</button>
      </div>
      <div class="db-layout">
        <div class="panel db-tables-panel">
          <div class="db-panel-head"><div><h3>Tables</h3><small id="dbName">Loading database…</small></div></div>
          <input class="input" id="dbTableSearch" placeholder="Search tables…" />
          <div id="dbTables" class="db-table-list"><div class="loading">Loading tables…</div></div>
        </div>
        <div class="panel db-data-panel">
          <div class="db-panel-head db-data-head">
            <div><h3 id="dbSelectedTitle">Select a table</h3><small id="dbTableMeta">Choose a table to inspect its records and schema.</small></div>
            <div class="db-actions"><button class="btn secondary" id="dbSchemaBtn" disabled>Schema</button><button class="btn" id="dbAddBtn" disabled>+ Add Row</button></div>
          </div>
          <div class="toolbar db-toolbar">
            <input class="input search" id="dbRowSearch" placeholder="Search current table…" disabled />
            <button class="btn secondary" id="dbRowSearchBtn" disabled>Search</button>
          </div>
          <div id="dbSchema" class="db-schema" hidden></div>
          <div class="table-wrap db-grid-wrap"><table class="table" id="dbRowsTable"><thead></thead><tbody></tbody></table><div id="dbRowsLoading" class="loading">Select a table.</div><div id="dbRowsEmpty" class="empty">No records found.</div></div>
          <div class="db-pagination"><button class="btn secondary" id="dbPrev" disabled>← Previous</button><span id="dbPageInfo">Page 0 of 0</span><button class="btn secondary" id="dbNext" disabled>Next →</button></div>
        </div>
      </div>
      <div id="dbEditor" class="db-editor" hidden></div>
    `;
    main.appendChild(section);

    $("dbRefresh").onclick = loadTables;
    $("dbTableSearch").oninput = renderTableList;
    $("dbRowSearchBtn").onclick = () => loadRows(1);
    $("dbRowSearch").onkeydown = (e) => { if (e.key === "Enter") loadRows(1); };
    $("dbPrev").onclick = () => loadRows(currentPage - 1);
    $("dbNext").onclick = () => loadRows(currentPage + 1);
    $("dbSchemaBtn").onclick = toggleSchema;
    $("dbAddBtn").onclick = () => openEditor(null);
    loadTables();
  }

  let tables = [];
  function renderTableList() {
    const q = ($("dbTableSearch")?.value || "").toLowerCase();
    const rows = tables.filter((t) => String(t.name).toLowerCase().includes(q));
    $("dbTables").innerHTML = rows.length ? rows.map((t) => `
      <button class="db-table-item ${t.name === currentTable ? "active" : ""}" onclick="window.__dbSelectTable(${JSON.stringify(t.name)})">
        <span><b>${esc(t.name)}</b><small>${esc(t.type)} · ${Number(t.column_count || 0)} cols</small></span><strong>${Number(t.estimated_rows || 0).toLocaleString()}</strong>
      </button>`).join("") : '<div class="empty">No tables found.</div>';
  }

  window.__dbSelectTable = (name) => {
    currentTable = name;
    currentPage = 1;
    renderTableList();
    $("dbSelectedTitle").textContent = name;
    $("dbTableMeta").textContent = "Loading table schema…";
    $("dbRowSearch").disabled = false;
    $("dbRowSearchBtn").disabled = false;
    $("dbSchemaBtn").disabled = false;
    $("dbAddBtn").disabled = false;
    $("dbSchema").hidden = true;
    loadSchema();
    loadRows(1);
  };

  async function loadTables() {
    $("dbTables").innerHTML = '<div class="loading">Loading tables…</div>';
    try {
      const d = await request("/api/admin/database/tables");
      tables = d.tables || [];
      $("dbName").textContent = d.database || "Connected database";
      renderTableList();
    } catch (e) {
      $("dbTables").innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
    }
  }

  async function loadSchema() {
    if (!currentTable) return;
    try {
      currentSchema = await request(`/api/admin/database/tables/${encodeURIComponent(currentTable)}/schema`);
      $("dbTableMeta").textContent = `${currentSchema.columns.length} columns · ${currentSchema.table.TABLE_TYPE || "TABLE"}`;
      renderSchema();
    } catch (e) {
      $("dbTableMeta").textContent = e.message;
    }
  }

  function renderSchema() {
    const s = currentSchema;
    if (!s) return;
    $("dbSchema").innerHTML = `<div class="db-schema-grid">${s.columns.map((c) => `<div><b>${esc(c.COLUMN_NAME)}</b><span>${esc(c.COLUMN_TYPE)}</span><small>${esc(c.COLUMN_KEY || "")} ${c.IS_NULLABLE === "YES" ? "· nullable" : "· required"}${c.EXTRA ? " · " + esc(c.EXTRA) : ""}</small></div>`).join("")}</div>`;
  }

  function toggleSchema() { $("dbSchema").hidden = !$("dbSchema").hidden; }

  async function loadRows(page) {
    if (!currentTable) return;
    currentPage = Math.max(page, 1);
    $("dbRowsLoading").style.display = "block";
    $("dbRowsEmpty").style.display = "none";
    try {
      const search = ($("dbRowSearch").value || "").trim();
      const d = await request(`/api/admin/database/tables/${encodeURIComponent(currentTable)}/rows?page=${currentPage}&pageSize=50&search=${encodeURIComponent(search)}`);
      renderRows(d);
    } catch (e) {
      $("dbRowsLoading").style.display = "none";
      $("dbRowsEmpty").style.display = "block";
      $("dbRowsEmpty").textContent = e.message;
    }
  }

  function renderRows(d) {
    const columns = d.columns || [];
    const pk = columns.find((c) => c.COLUMN_KEY === "PRI");
    const head = $("dbRowsTable").querySelector("thead");
    const body = $("dbRowsTable").querySelector("tbody");
    head.innerHTML = `<tr>${columns.map((c) => `<th>${esc(c.COLUMN_NAME)}</th>`).join("")}<th>Actions</th></tr>`;
    body.innerHTML = (d.rows || []).map((row) => {
      const id = pk ? row[pk.COLUMN_NAME] : null;
      const encoded = encodeURIComponent(JSON.stringify(row));
      return `<tr>${columns.map((c) => `<td title="${esc(row[c.COLUMN_NAME])}">${esc(row[c.COLUMN_NAME])}</td>`).join("")}<td class="db-row-actions">${id !== null && id !== undefined ? `<button class="copy-btn" onclick='window.__dbEdit(${encoded})'>Edit</button><button class="copy-btn danger" onclick='window.__dbDelete(${JSON.stringify(String(id))})'>Delete</button>` : '<small>Read-only</small>'}</td></tr>`;
    }).join("");
    $("dbRowsLoading").style.display = "none";
    $("dbRowsEmpty").style.display = d.rows?.length ? "none" : "block";
    $("dbPageInfo").textContent = `Page ${d.page} of ${d.totalPages} · ${Number(d.total).toLocaleString()} rows`;
    $("dbPrev").disabled = d.page <= 1;
    $("dbNext").disabled = d.page >= d.totalPages;
  }

  function openEditor(row) {
    if (!currentSchema) return;
    const pk = currentSchema.columns.find((c) => c.COLUMN_KEY === "PRI");
    const editing = Boolean(row);
    const values = row || {};
    const editor = $("dbEditor");
    editor.hidden = false;
    editor.innerHTML = `<div class="db-editor-card"><div class="db-panel-head"><div><h3>${editing ? "Edit Record" : "Add Record"}</h3><small>${esc(currentTable)}</small></div><button class="icon-btn" id="dbEditorClose">×</button></div><div class="db-form-grid">${currentSchema.columns.map((c) => `<label>${esc(c.COLUMN_NAME)}<input class="input" data-db-field="${esc(c.COLUMN_NAME)}" value="${esc(values[c.COLUMN_NAME])}" ${editing && pk?.COLUMN_NAME === c.COLUMN_NAME ? "disabled" : ""} placeholder="${esc(c.COLUMN_TYPE)}" /></label>`).join("")}</div><div class="db-editor-actions"><button class="btn secondary" id="dbEditorCancel">Cancel</button><button class="btn" id="dbEditorSave">${editing ? "Save Changes" : "Insert Record"}</button></div></div>`;
    $("dbEditorClose").onclick = () => editor.hidden = true;
    $("dbEditorCancel").onclick = () => editor.hidden = true;
    $("dbEditorSave").onclick = () => saveEditor(row, pk);
  }

  async function saveEditor(original, pk) {
    const data = {};
    document.querySelectorAll("[data-db-field]").forEach((input) => { data[input.dataset.dbField] = input.value; });
    try {
      if (original) {
        if (!pk) throw new Error("This table has no single primary key; editing is disabled.");
        await request(`/api/admin/database/tables/${encodeURIComponent(currentTable)}/rows/${encodeURIComponent(original[pk.COLUMN_NAME])}`, { method: "PATCH", body: JSON.stringify({ data }) });
      } else {
        await request(`/api/admin/database/tables/${encodeURIComponent(currentTable)}/rows`, { method: "POST", body: JSON.stringify({ data }) });
      }
      $("dbEditor").hidden = true;
      await loadTables();
      await loadRows(currentPage);
    } catch (e) { alert(e.message); }
  }

  window.__dbEdit = (encoded) => { try { openEditor(JSON.parse(decodeURIComponent(encoded))); } catch (e) { alert("Unable to open record editor"); } };
  window.__dbDelete = async (id) => {
    if (!confirm(`Delete this record from ${currentTable}? This cannot be undone.`)) return;
    try {
      await request(`/api/admin/database/tables/${encodeURIComponent(currentTable)}/rows/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadTables();
      await loadRows(currentPage);
    } catch (e) { alert(e.message); }
  };

  function injectStyles() {
    if ($("database-control-styles")) return;
    const style = document.createElement("style");
    style.id = "database-control-styles";
    style.textContent = `
      .db-layout{display:grid;grid-template-columns:280px minmax(0,1fr);gap:14px;min-height:520px}.db-tables-panel,.db-data-panel{min-width:0}.db-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.db-panel-head h3{margin:0 0 3px}.db-panel-head small{color:var(--muted)}.db-table-list{margin-top:10px;max-height:610px;overflow:auto}.db-table-item{width:100%;border:1px solid var(--border);background:var(--card);color:var(--text);padding:10px 11px;border-radius:10px;display:flex;justify-content:space-between;text-align:left;margin:5px 0;cursor:pointer}.db-table-item:hover,.db-table-item.active{border-color:var(--green2);transform:translateY(-1px)}.db-table-item span{display:flex;flex-direction:column;gap:2px}.db-table-item small{color:var(--muted)}.db-table-item strong{font-size:11px;color:var(--green2)}.db-data-head{align-items:flex-start}.db-actions{display:flex;gap:8px;flex-wrap:wrap}.db-toolbar{margin-bottom:10px}.db-grid-wrap{max-height:560px;overflow:auto}.db-grid-wrap table{min-width:900px}.db-grid-wrap td{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.db-row-actions{white-space:nowrap}.db-row-actions .danger{color:#ff6b6b}.db-pagination{display:flex;align-items:center;justify-content:center;gap:14px;padding-top:12px}.db-schema{border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:10px;background:rgba(0,0,0,.08)}.db-schema-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.db-schema-grid>div{padding:8px;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;gap:3px}.db-schema-grid span{font-family:monospace;font-size:11px}.db-schema-grid small{color:var(--muted)}.db-editor{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000;padding:5vh 5vw;overflow:auto}.db-editor-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:18px;max-width:1000px;margin:auto;box-shadow:0 20px 70px rgba(0,0,0,.35)}.db-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.db-form-grid label{display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--muted)}.db-editor-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:15px}@media(max-width:900px){.db-layout{grid-template-columns:1fr}.db-table-list{max-height:260px}.db-form-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function init() { injectStyles(); buildUI(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
