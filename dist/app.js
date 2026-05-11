const client = window.supabaseClient;

const TABLES = {
  extension_user: {
    name: "extension_user",
    editableFields: new Set(["extentions_name", "role", "active", "expire_date", "max_active_devices"]),
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
let columnWidths = {};
const COLUMN_WIDTHS_KEY = "user-management:column-widths";

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

function getColumnWidth(tableName, columnKey) {
  return columnWidths?.[tableName]?.[columnKey] || "";
}

function setColumnWidth(tableName, columnKey, widthPx) {
  if (!columnWidths[tableName]) columnWidths[tableName] = {};
  columnWidths[tableName][columnKey] = Math.max(60, Math.round(widthPx));
  try {
    window.localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(columnWidths));
  } catch (_) {}
}

function loadColumnWidths() {
  try {
    const raw = window.localStorage.getItem(COLUMN_WIDTHS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      columnWidths = parsed;
    }
  } catch (_) {}
}

function getCellStyle(tableName, columnKey) {
  const width = getColumnWidth(tableName, columnKey);
  return width ? ` style="width:${width}px; min-width:${width}px;"` : "";
}

function renderTableHead(columns) {
  tableHead.innerHTML = `<tr>${columns
    .map((col, index) => {
      const style = getCellStyle(activeTable, col.key);
      return `<th data-col-key="${escapeHtml(col.key)}" data-col-index="${index}"${style}><span>${escapeHtml(
        col.label
      )}</span><span class="col-resizer" aria-hidden="true"></span></th>`;
    })
    .join("")}</tr>`;
  bindColumnResize();
}

function bindColumnResize() {
  const handles = tableHead.querySelectorAll(".col-resizer");
  handles.forEach((handle) => {
    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const th = event.target.closest("th");
      if (!(th instanceof HTMLTableCellElement)) return;
      const columnKey = th.dataset.colKey || "";
      if (!columnKey) return;
      const startX = event.clientX;
      const startWidth = th.getBoundingClientRect().width;

      const onMouseMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const nextWidth = startWidth + delta;
        setColumnWidth(activeTable, columnKey, nextWidth);
        th.style.width = `${Math.max(60, Math.round(nextWidth))}px`;
        th.style.minWidth = `${Math.max(60, Math.round(nextWidth))}px`;
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        renderTable();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  });
}

function getRoleOptions(tableName) {
  const defaults = ["user", "admin"];
  const values = (rowsByTable[tableName] || [])
    .map((row) => String(row?.role || "").trim())
    .filter(Boolean);
  return [...new Set([...defaults, ...values])];
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

  if (field === "role") {
    const listId = `role-options-${tableName}`;
    const options = getRoleOptions(tableName)
      .map((item) => `<option value="${escapeHtml(item)}"></option>`)
      .join("");
    return `<input class="cell-input" type="text" list="${escapeHtml(listId)}" data-field="${escapeHtml(field)}" value="${escapeHtml(
      value ?? ""
    )}"><datalist id="${escapeHtml(listId)}">${options}</datalist>`;
  }

  if (field === "max_active_devices" || field === "active_devices") {
    const normalized = value === null || value === undefined || value === "" ? "" : parseInt(String(value), 10);
    return `<input class="cell-input" type="number" step="1" min="0" data-field="${escapeHtml(field)}" value="${escapeHtml(
      Number.isNaN(normalized) ? "" : normalized
    )}">`;
  }

  return `<input class="cell-input" type="text" data-field="${escapeHtml(field)}" value="${escapeHtml(value ?? "")}">`;
}

function renderReadOnlyValue(value) {
  if (Array.isArray(value)) return `<span>${escapeHtml(value.join(", "))}</span>`;
  if (typeof value === "boolean") return `<span>${value ? "true" : "false"}</span>`;
  if (value === null || value === undefined || value === "") return '<span class="muted">-</span>';
  return `<span>${escapeHtml(value)}</span>`;
}

function renderEditButton(rowKey) {
  return `<button class="row-icon-btn" data-edit-row="${escapeHtml(rowKey)}" type="button" aria-label="Sửa" title="Sửa"><img src="./icon/edit.png" alt="Sửa"></button>`;
}

function renderSaveButton(rowKey) {
  return `<button class="row-icon-btn save" data-save-row="${escapeHtml(rowKey)}" type="button" aria-label="Lưu" title="Lưu"><img src="./icon/save.png" alt="Lưu"></button>`;
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
  const columns = [
    { key: "__no", label: "No." },
    { key: "email", label: "Email" },
    { key: "role", label: "Role" },
    { key: "expire_date", label: "Expire Date" },
    { key: "max_active_devices", label: "Max Devices" }
  ];
  renderTableHead(columns);

  if (!rows.length) {
    tableBody.innerHTML = `<tr><td colspan="5" class="muted">Không có dữ liệu.</td></tr>`;
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
          <td colspan="5" class="users-role-group-cell">
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
                <button class="row-icon-btn is-active" data-cancel-row="${escapeHtml(rowKey)}" type="button" title="Hủy sửa">x</button>
                ${renderValueEditor(activeTable, "active", Boolean(row.active))}
                ${renderSaveButton(rowKey)}
                ${renderValueEditor(activeTable, "email", row.email)}
              </div>
            `
            : `
              <div class="phone-cell-container">${renderEditButton(rowKey)}<input class="cell-check" type="checkbox" disabled ${row.active ? "checked" : ""}>${renderReadOnlyValue(row.email)}</div>
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

          return `
            <tr data-row-key="${escapeHtml(rowKey)}">
              <td${getCellStyle(activeTable, "__no")}>${runningIndex}</td>
              <td${getCellStyle(activeTable, "email")}>${emailCell}</td>
              <td${getCellStyle(activeTable, "role")}>${roleCell}</td>
              <td${getCellStyle(activeTable, "expire_date")}>${expireCell}</td>
              <td${getCellStyle(activeTable, "max_active_devices")}>${maxDevicesCell}</td>
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
  const dataColumns = inferColumns(rows);
  const columns = [{ key: "__no", label: "No." }, ...dataColumns.map((col) => ({ key: col, label: col }))];
  renderTableHead(columns);

  if (!rows.length) {
    tableBody.innerHTML = `<tr><td colspan="${columns.length}" class="muted">Không có dữ liệu.</td></tr>`;
    return;
  }

  tableBody.innerHTML = rows
    .map((row, index) => {
      const rowKey = buildRowKey(activeTable, row);
      const isEditing = editingRowKey === rowKey;

      const actionColumn = dataColumns.includes("email") ? "email" : dataColumns[0];
      const cells = dataColumns
        .map((col) => {
          const value = row[col];
          if (isEditing && col === actionColumn) {
            return `<td${getCellStyle(activeTable, col)}><div class="cell-actions"><button class="row-icon-btn is-active" data-cancel-row="${escapeHtml(rowKey)}" type="button" title="Hủy sửa">x</button>${renderSaveButton(rowKey)}${renderValueEditor(activeTable, col, value)}</div></td>`;
          }
          if (!isEditing && col === actionColumn) {
            return `<td${getCellStyle(activeTable, col)}><div class="phone-cell-container">${renderEditButton(rowKey)}${renderReadOnlyValue(value)}</div></td>`;
          }
          return `<td${getCellStyle(activeTable, col)}>${isEditing ? renderValueEditor(activeTable, col, value) : renderReadOnlyValue(value)}</td>`;
        })
        .join("");
      return `<tr data-row-key="${escapeHtml(rowKey)}"><td${getCellStyle(activeTable, "__no")}>${index + 1}</td>${cells}</tr>`;
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
      if (raw === "") {
        payload[field] = null;
        return;
      }
      const intValue = Number.parseInt(raw, 10);
      if (!Number.isFinite(intValue)) {
        throw new Error(`${field} phải là số nguyên.`);
      }
      payload[field] = intValue;
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
  loadColumnWidths();
  switchTab("extension_user");
  try {
    await refreshActiveTable();
  } catch (error) {
    setStatus(`Khởi tạo thất bại: ${error.message || error}`);
    tableBody.innerHTML = `<tr><td colspan="2" class="muted">${escapeHtml(error.message || String(error))}</td></tr>`;
  }
})();

