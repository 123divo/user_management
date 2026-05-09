const client = window.supabaseClient;

const TABLES = {
  extension_user: {
    name: "extension_user",
    editableFields: new Set(["extentions_name", "email", "role", "active", "expire_date", "max_active_devices"]),
    keyCandidates: ["id_user", "email"]
  },
  py_app_user: {
    name: "py_app_user",
    editableFields: new Set(["username", "password", "role", "device_id", "active", "expire_date"]),
    keyCandidates: ["id", "id_user", "user_id", "email"]
  }
};

const refreshBtn = document.getElementById("refresh-btn");
const searchInput = document.getElementById("search-input");
const statusText = document.getElementById("status-text");
const tableHead = document.getElementById("table-head");
const tableBody = document.getElementById("table-body");
const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));

let activeTable = "extension_user";
let rowsByTable = { extension_user: [], py_app_user: [] };
let filteredRows = [];
let editingRowKey = null;

function setStatus(message) {
  statusText.textContent = message;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function pickKeyFields(tableName, row) {
  const config = TABLES[tableName];
  const keys = [];
  for (const key of config.keyCandidates) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      keys.push(key);
      if (key.toLowerCase().includes("id")) break;
    }
  }
  return keys;
}

function buildRowKey(tableName, row) {
  const keys = pickKeyFields(tableName, row);
  if (!keys.length) {
    return `__row__:${Math.random().toString(36).slice(2)}`;
  }
  return keys.map((key) => `${key}:${String(row[key])}`).join("|");
}

async function loadTableRows(tableName) {
  const { data, error } = await client
    .from(tableName)
    .select("*")
    .order("id_user", { ascending: true, nullsFirst: false });

  if (error && !String(error.message || "").toLowerCase().includes("id_user")) {
    throw error;
  }

  if (error) {
    const fallback = await client.from(tableName).select("*");
    if (fallback.error) throw fallback.error;
    return fallback.data || [];
  }

  return data || [];
}

function inferColumns(rows) {
  const columnSet = new Set();
  rows.forEach((row) => Object.keys(row || {}).forEach((key) => columnSet.add(key)));

  const preferred = [
    "id_user",
    "id",
    "user_id",
    "extentions_name",
    "email",
    "username",
    "password",
    "role",
    "device_id",
    "active",
    "expire_date",
    "active_devices",
    "max_active_devices"
  ];
  const columns = [];

  preferred.forEach((key) => {
    if (columnSet.has(key)) {
      columns.push(key);
      columnSet.delete(key);
    }
  });

  return [...columns, ...Array.from(columnSet)];
}

function getRowsWithSearch(rows, keyword) {
  const term = normalizeText(keyword);
  if (!term) return [...rows];

  return rows.filter((row) => normalizeText(Object.values(row || {}).join(" ")).includes(term));
}

function renderTableHead(columns) {
  tableHead.innerHTML = `<tr><th>No.</th>${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}<th>Action</th></tr>`;
}

function renderValueEditor(tableName, field, value) {
  const editable = TABLES[tableName].editableFields.has(field);
  if (!editable) return `<span>${escapeHtml(value ?? "")}</span>`;

  if (field === "expire_date") {
    const raw = String(value ?? "").trim();
    let dateValue = "";
    if (raw) {
      const parsed = new Date(raw);
      if (Number.isFinite(parsed.getTime())) {
        const yyyy = parsed.getFullYear();
        const mm = String(parsed.getMonth() + 1).padStart(2, "0");
        const dd = String(parsed.getDate()).padStart(2, "0");
        dateValue = `${yyyy}-${mm}-${dd}`;
      }
    }
    return `<input class="cell-input" type="date" data-field="${escapeHtml(field)}" value="${escapeHtml(dateValue)}">`;
  }

  if (typeof value === "boolean") {
    return `<input class="cell-check" type="checkbox" data-field="${escapeHtml(field)}" ${value ? "checked" : ""}>`;
  }

  return `<input class="cell-input" type="text" data-field="${escapeHtml(field)}" value="${escapeHtml(value ?? "")}">`;
}

function renderReadOnlyValue(value) {
  if (Array.isArray(value)) return `<span>${escapeHtml(value.join(", "))}</span>`;
  if (typeof value === "boolean") return `<span>${value ? "true" : "false"}</span>`;
  if (value === null || value === undefined || value === "") return '<span class="muted">-</span>';
  return `<span>${escapeHtml(value)}</span>`;
}

function formatDateDDMMYYYY(value) {
  if (!value) return "";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return String(value);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function renderExtensionTable() {
  const rows = filteredRows;
  const headers = ["Email", "Role", "Expire Date", "Max Devices"];
  tableHead.innerHTML = `<tr><th>No.</th>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}<th>Action</th></tr>`;

  if (!rows.length) {
    tableBody.innerHTML = `<tr><td colspan="6" class="muted">Không có dữ liệu.</td></tr>`;
    return;
  }

  const grouped = rows.reduce((acc, row) => {
    const key = String(row.extentions_name || "(No Extension Name)").trim() || "(No Extension Name)";
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(row);
    return acc;
  }, new Map());

  let runningIndex = 0;
  tableBody.innerHTML = [...grouped.entries()]
    .map(([groupName, groupRows]) => {
      const groupHeader = `
        <tr class="users-role-group-row">
          <td colspan="6" class="users-role-group-cell">
            <span class="users-role-group-title">${escapeHtml(groupName)}</span>
            <span class="users-role-group-count">${groupRows.length}</span>
          </td>
        </tr>
      `;

      const rowsMarkup = groupRows
        .map((row) => {
          runningIndex += 1;
          const rowKey = buildRowKey(activeTable, row);
          const isEditing = editingRowKey === rowKey;

          const emailCell = isEditing
            ? `
              <div class="cell-actions">
                ${renderValueEditor(activeTable, "active", Boolean(row.active))}
                ${renderValueEditor(activeTable, "email", row.email)}
              </div>
            `
            : `
              <div class="cell-actions">
                <input class="cell-check" type="checkbox" disabled ${row.active ? "checked" : ""}>
                ${renderReadOnlyValue(row.email)}
              </div>
            `;
          const roleCell = isEditing
            ? renderValueEditor(activeTable, "role", row.role)
            : renderReadOnlyValue(row.role);
          const expireCell = isEditing
            ? renderValueEditor(activeTable, "expire_date", row.expire_date)
            : renderReadOnlyValue(formatDateDDMMYYYY(row.expire_date));
          const maxDevicesCell = isEditing
            ? renderValueEditor(activeTable, "max_active_devices", row.max_active_devices)
            : renderReadOnlyValue(row.max_active_devices);

          const actions = isEditing
            ? `<div class="cell-actions"><button class="row-btn" data-cancel-row="${escapeHtml(rowKey)}" type="button">x</button><button class="row-btn save" data-save-row="${escapeHtml(rowKey)}" type="button">Lưu</button></div>`
            : `<div class="cell-actions"><button class="row-btn" data-edit-row="${escapeHtml(rowKey)}" type="button" aria-label="Sửa" title="Sửa">✎</button></div>`;

          return `
            <tr data-row-key="${escapeHtml(rowKey)}">
              <td>${runningIndex}</td>
              <td>${emailCell}</td>
              <td>${roleCell}</td>
              <td>${expireCell}</td>
              <td>${maxDevicesCell}</td>
              <td>${actions}</td>
            </tr>
          `;
        })
        .join("");

      return `${groupHeader}${rowsMarkup}`;
    })
    .join("");
}

function renderTable() {
  if (activeTable === "extension_user") {
    renderExtensionTable();
    return;
  }

  const rows = filteredRows;
  const columns = inferColumns(rows);

  renderTableHead(columns);

  if (!rows.length) {
    tableBody.innerHTML = `<tr><td colspan="${columns.length + 2}" class="muted">Không có dữ liệu.</td></tr>`;
    return;
  }

  tableBody.innerHTML = rows
    .map((row, index) => {
      const rowKey = buildRowKey(activeTable, row);
      const isEditing = editingRowKey === rowKey;

      const cells = columns
        .map((col) => {
          const value = row[col];
          return `<td>${isEditing ? renderValueEditor(activeTable, col, value) : renderReadOnlyValue(value)}</td>`;
        })
        .join("");

      const actions = isEditing
        ? `<div class="cell-actions"><button class="row-btn" data-cancel-row="${escapeHtml(rowKey)}" type="button">x</button><button class="row-btn save" data-save-row="${escapeHtml(rowKey)}" type="button">Lưu</button></div>`
        : `<div class="cell-actions"><button class="row-btn" data-edit-row="${escapeHtml(rowKey)}" type="button">Sửa</button></div>`;

      return `<tr data-row-key="${escapeHtml(rowKey)}"><td>${index + 1}</td>${cells}<td>${actions}</td></tr>`;
    })
    .join("");
}

async function refreshActiveTable() {
  setStatus(`Đang tải ${activeTable}...`);
  const rows = await loadTableRows(activeTable);
  rowsByTable[activeTable] = rows;
  filteredRows = getRowsWithSearch(rows, searchInput.value);
  editingRowKey = null;
  renderTable();
  setStatus(`Đã tải ${filteredRows.length}/${rows.length} dòng từ ${activeTable}.`);
}

function findOriginalRowByKey(rowKey) {
  return (rowsByTable[activeTable] || []).find((row) => buildRowKey(activeTable, row) === rowKey) || null;
}

function buildUpdatePayload(rowElement, originalRow) {
  const payload = {};
  const editableFields = TABLES[activeTable].editableFields;

  Object.keys(originalRow).forEach((field) => {
    if (!editableFields.has(field)) return;

    const input = rowElement.querySelector(`[data-field="${CSS.escape(field)}"]`);
    if (!(input instanceof HTMLInputElement)) return;

    if (input.type === "checkbox") {
      payload[field] = input.checked;
      return;
    }

    const raw = input.value.trim();
    if (["max_active_devices", "active_devices"].includes(field)) {
      payload[field] = raw === "" ? null : Number(raw);
      return;
    }

    payload[field] = raw;
  });

  return payload;
}

async function saveRow(rowKey) {
  const rowElement = tableBody.querySelector(`[data-row-key="${CSS.escape(rowKey)}"]`);
  if (!(rowElement instanceof HTMLTableRowElement)) return;

  const originalRow = findOriginalRowByKey(rowKey);
  if (!originalRow) throw new Error("Không tìm thấy dữ liệu gốc của dòng.");

  const keyFields = pickKeyFields(activeTable, originalRow);
  if (!keyFields.length) throw new Error("Không xác định được khóa dòng để cập nhật.");

  const payload = buildUpdatePayload(rowElement, originalRow);
  if (!Object.keys(payload).length) {
    editingRowKey = null;
    renderTable();
    return;
  }

  let query = client.from(activeTable).update(payload);
  keyFields.forEach((key) => {
    query = query.eq(key, originalRow[key]);
  });

  const { error } = await query;
  if (error) throw error;
}

function switchTab(tableName) {
  activeTable = tableName;
  tabButtons.forEach((btn) => {
    const selected = btn.dataset.table === tableName;
    btn.classList.toggle("is-active", selected);
    btn.setAttribute("aria-selected", selected ? "true" : "false");
  });
}

refreshBtn.addEventListener("click", async () => {
  try {
    await refreshActiveTable();
  } catch (error) {
    setStatus(`Tải thất bại: ${error.message || error}`);
  }
});

searchInput.addEventListener("input", () => {
  filteredRows = getRowsWithSearch(rowsByTable[activeTable] || [], searchInput.value);
  renderTable();
});

tabButtons.forEach((btn) => {
  btn.addEventListener("click", async () => {
    const nextTable = btn.dataset.table;
    if (!nextTable || nextTable === activeTable) return;
    switchTab(nextTable);

    try {
      if (!rowsByTable[nextTable].length) {
        await refreshActiveTable();
      } else {
        filteredRows = getRowsWithSearch(rowsByTable[nextTable] || [], searchInput.value);
        editingRowKey = null;
        renderTable();
        setStatus(`Đã tải sẵn ${filteredRows.length}/${rowsByTable[nextTable].length} dòng từ ${nextTable}.`);
      }
    } catch (error) {
      setStatus(`Không tải được ${nextTable}: ${error.message || error}`);
      tableBody.innerHTML = `<tr><td colspan="2" class="muted">${escapeHtml(error.message || String(error))}</td></tr>`;
    }
  });
});

tableBody.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const editBtn = target.closest("[data-edit-row]");
  if (editBtn instanceof HTMLElement) {
    editingRowKey = editBtn.dataset.editRow || null;
    renderTable();
    return;
  }

  const cancelBtn = target.closest("[data-cancel-row]");
  if (cancelBtn instanceof HTMLElement) {
    editingRowKey = null;
    renderTable();
    return;
  }

  const saveBtn = target.closest("[data-save-row]");
  if (!(saveBtn instanceof HTMLElement)) return;

  try {
    setStatus("Đang lưu dữ liệu...");
    await saveRow(saveBtn.dataset.saveRow || "");
    await refreshActiveTable();
    setStatus("Đã lưu thành công.");
  } catch (error) {
    setStatus(`Lưu thất bại: ${error.message || error}`);
  }
});

(async () => {
  switchTab("extension_user");
  try {
    await refreshActiveTable();
  } catch (error) {
    setStatus(`Khởi tạo thất bại: ${error.message || error}`);
    tableBody.innerHTML = `<tr><td colspan="2" class="muted">${escapeHtml(error.message || String(error))}</td></tr>`;
  }
})();

