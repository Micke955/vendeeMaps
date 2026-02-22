import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  normalizeUserName,
  normalizeRemoteCommuneDoc,
  communeDocEquals,
  diffCommuneState,
  createUserIdentityBlock,
} from "./lib/state-utils.js";
import {
  createInitialState,
  LOCK_TTL_MS,
  HISTORY_ACTIVE_WINDOW_DAYS,
  ACTIVE_USER_STORAGE_KEY,
  THEME_STORAGE_KEY,
  PANEL_LAYOUT_STORAGE_KEY,
  COLLAPSIBLE_SECTIONS_STORAGE_KEY,
} from "./lib/ui-state.js";
import {
  getStoredPanelLayout,
  applyPanelLayout,
  initCollapsibleSections,
} from "./lib/panels.js";
import { initMapInteractions } from "./lib/map-interactions.js";
import { createFirestoreSync } from "./lib/firestore-sync.js";
import { applySyncStatus } from "./lib/sync-status.js";
import { initActionsMenu } from "./lib/actions-menu.js";
import {
  getFirestore,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  setDoc,
  deleteDoc,
  runTransaction,
  deleteField,
  serverTimestamp,
  collection,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";

const SVG_PATH = "./Carte_des_communes_de_la_Vendée.svg";

const sectorColors = {
  1: "#e34a4a", // Nord
  2: "#f08d49", // Nord-Est
  3: "#f3d14a", // Est
  4: "#5fd35f", // Sud-Est
  5: "#38c9c9", // Sud
  6: "#3d7cff", // Sud-Ouest
  7: "#6a5bd5", // Ouest
  8: "#b04ce0", // Nord-Ouest
  9: "#c2c8d6", // Centre
};

const sectorLabels = {
  1: "Nord",
  2: "Nord-Est",
  3: "Est",
  4: "Sud-Est",
  5: "Sud",
  6: "Sud-Ouest",
  7: "Ouest",
  8: "Nord-Ouest",
  9: "Centre",
};

// Remplace ces valeurs par celles de ton projet Firebase
const firebaseConfig = {
  apiKey: "AIzaSyD2jWztVtW64lLm0tEJuI_ER1ibd8_8vY8",
  authDomain: "plume-du-temps.firebaseapp.com",
  projectId: "plume-du-temps",
  storageBucket: "plume-du-temps.firebasestorage.app",
  messagingSenderId: "1082937100904",
  appId: "1:1082937100904:web:044fd26feb2139f23e89dd",
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);
const metaDocRef = doc(db, "vendee", "state");
const communesColRef = collection(db, "vendee_communes");
const presenceColRef = collection(db, "vendee_presence");
const historyColRef = collection(db, "vendee_history");
const usersColRef = collection(db, "vendee_users");
const state = createInitialState();

const mapContainer = document.getElementById("mapContainer");
const sectorSelect = document.getElementById("sectorSelect");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const searchSuggestions = document.getElementById("searchSuggestions");
const exportPdfMapBtn = document.getElementById("exportPdfMapBtn");
const exportPdfReportBtn = document.getElementById("exportPdfReportBtn");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const resetBtn = document.getElementById("resetBtn");
const tooltip = document.getElementById("tooltip");
const syncStatus = document.getElementById("syncStatus");
const lockStatus = document.getElementById("lockStatus");
const currentUserBadge = document.getElementById("currentUserBadge");
const themeToggle = document.getElementById("themeToggle");
const userNameInput = document.getElementById("userNameInput");
const addUserBtn = document.getElementById("addUserBtn");
const anchorInput = document.getElementById("anchorInput");
const anchorSuggestions = document.getElementById("anchorSuggestions");
const usersList = document.getElementById("usersList");
const connectedUsersList = document.getElementById("connectedUsers");
const userCountsList = document.getElementById("userCountsList");
const activeUserSelect = document.getElementById("activeUserSelect");
const filterSectorSelect = document.getElementById("filterSectorSelect");
const filterUserSelect = document.getElementById("filterUserSelect");
const filterDemarcheSelect = document.getElementById("filterDemarcheSelect");
const usersQuickChips = document.getElementById("usersQuickChips");
const historyQuickChips = document.getElementById("historyQuickChips");
const statsQuickChips = document.getElementById("statsQuickChips");
const filtersActiveBadge = document.getElementById("filtersActiveBadge");
const historyList = document.getElementById("historyList");
const statsSummary = document.getElementById("statsSummary");
const statsSectorList = document.getElementById("statsSectorList");
const statsUserProgress = document.getElementById("statsUserProgress");
const sectorRequiredBadge = document.getElementById("sectorRequiredBadge");
const resetViewBtn = document.getElementById("resetViewBtn");
const toggleLeftPanelBtn = document.getElementById("toggleLeftPanelBtn");
const toggleRightPanelBtn = document.getElementById("toggleRightPanelBtn");
const actionsMore = document.querySelector(".actions-more");

const infoName = document.getElementById("infoName");
const infoInsee = document.getElementById("infoInsee");
const infoSector = document.getElementById("infoSector");
const infoDistance = document.getElementById("infoDistance");
const infoDemarche = document.getElementById("infoDemarche");
const infoCollab = document.getElementById("infoCollab");
const toggleDemarcheBtn = document.getElementById("toggleDemarcheBtn");
const clearDemarchesBtn = document.getElementById("clearDemarchesBtn");
const communeContextMenu = document.getElementById("communeContextMenu");
const contextToggleDemarche = document.getElementById("contextToggleDemarche");
const topSelectedBlock = document.querySelector(".top-selected");

let contextMenuTarget = null;
let firestoreSync = null;

function setCurrentCommune(el) {
  if (state.current && state.current !== el) {
    state.current.classList.remove("selected");
  }
  state.current = el || null;
  if (state.current) {
    state.current.classList.add("selected");
  }
}

function findCommuneFromTarget(target) {
  let node = target;
  while (node) {
    if (node.classList && node.classList.contains("commune")) return node;
    node = node.parentNode;
  }
  return null;
}

function findCommuneAtPoint(clientX, clientY) {
  if (!document.elementsFromPoint) return null;
  const stack = document.elementsFromPoint(clientX, clientY) || [];
  for (const el of stack) {
    const communeEl = findCommuneFromTarget(el);
    if (communeEl) return communeEl;
  }
  return null;
}

function resolveCommuneFromEvent(event) {
  return (
    findCommuneFromTarget(event.target) ||
    findCommuneAtPoint(event.clientX, event.clientY) ||
    state.current ||
    null
  );
}

function normalizeName(value) {
  return value.trim().toUpperCase();
}

function normalizeSearch(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .toUpperCase()
    .trim();
}

function parseId(id) {
  const match = id.match(/^(\d{5})\s+(.+)$/);
  if (!match) return null;
  return { code: match[1], name: match[2] };
}

function createUserId() {
  return `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function createHistoryId() {
  return `h_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeUserEntry(raw, fallbackId = "") {
  if (!raw || typeof raw !== "object") return null;
  const name = normalizeUserName(raw.name || "");
  const sectors = Array.isArray(raw.sectors)
    ? raw.sectors
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 9)
    : [];
  if (!name || !sectors.length) return null;
  return {
    _id: fallbackId || (typeof raw._id === "string" && raw._id ? raw._id : createUserId()),
    name,
    sectors: [...new Set(sectors)].sort((a, b) => a - b),
    anchorCode: typeof raw.anchorCode === "string" ? raw.anchorCode : "",
    anchorName: typeof raw.anchorName === "string" ? raw.anchorName : "",
    anchorLat: Number.isFinite(raw.anchorLat) ? Number(raw.anchorLat) : undefined,
    anchorLon: Number.isFinite(raw.anchorLon) ? Number(raw.anchorLon) : undefined,
  };
}

function usersFromUsersById(usersById) {
  if (!usersById || typeof usersById !== "object") return [];
  return Object.entries(usersById)
    .map(([id, raw]) => normalizeUserEntry(raw, id))
    .filter(Boolean);
}

function serializeUsersById(users) {
  const result = {};
  users.forEach((rawUser) => {
    const user = normalizeUserEntry(rawUser, rawUser && rawUser._id ? rawUser._id : "");
    if (!user || !user._id) return;
    const payload = {
      name: user.name,
      sectors: user.sectors,
    };
    if (user.anchorCode) payload.anchorCode = user.anchorCode;
    if (user.anchorName) payload.anchorName = user.anchorName;
    if (Number.isFinite(user.anchorLat)) payload.anchorLat = user.anchorLat;
    if (Number.isFinite(user.anchorLon)) payload.anchorLon = user.anchorLon;
    result[user._id] = payload;
  });
  return result;
}

function normalizeHistoryEntry(raw, fallbackId = "") {
  if (!raw || typeof raw !== "object") return null;
  const time = typeof raw.time === "string" ? raw.time.trim() : "";
  const user = typeof raw.user === "string" ? raw.user.trim() : "";
  const action = typeof raw.action === "string" ? raw.action.trim() : "";
  if (!action) return null;
  const createdAtMsRaw =
    Number.isFinite(raw.clientCreatedAt) ? Number(raw.clientCreatedAt) :
    Number.isFinite(raw.createdAtMs) ? Number(raw.createdAtMs) :
    (raw.createdAt && typeof raw.createdAt.toMillis === "function"
      ? raw.createdAt.toMillis()
      : NaN);
  return {
    _id: fallbackId || (typeof raw._id === "string" && raw._id ? raw._id : createHistoryId()),
    time: time || "—",
    user: user || "Systeme",
    action,
    createdAtMs: Number.isFinite(createdAtMsRaw) ? createdAtMsRaw : undefined,
  };
}

function historyFromHistoryById(historyById) {
  if (!historyById || typeof historyById !== "object") return [];
  return Object.entries(historyById)
    .map(([id, raw]) => normalizeHistoryEntry(raw, id))
    .filter(Boolean)
    .sort((a, b) => historySortValue(b) - historySortValue(a));
}

function serializeHistoryById(history) {
  const result = {};
  history.forEach((rawEntry) => {
    const entry = normalizeHistoryEntry(rawEntry, rawEntry && rawEntry._id ? rawEntry._id : "");
    if (!entry || !entry._id) return;
    result[entry._id] = {
      time: entry.time,
      user: entry.user,
      action: entry.action,
    };
  });
  return result;
}

function historySortValue(entry) {
  if (entry && Number.isFinite(entry.createdAtMs)) return Number(entry.createdAtMs);
  const id = entry && typeof entry._id === "string" ? entry._id : "";
  const match = id.match(/^h_(\d{13})_/);
  if (match) return Number(match[1]);
  return 0;
}

function getHistoryWindowStartDate() {
  return new Date(Date.now() - HISTORY_ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

function rebuildHistoryList() {
  state.history = Object.values(state.historyById)
    .filter(Boolean)
    .sort((a, b) => historySortValue(b) - historySortValue(a));
}

function clonePlainData(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepEqualData(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqualData(a[i], b[i])) return false;
    }
    return true;
  }

  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqualData(a[key], b[key])) return false;
    }
    return true;
  }

  return false;
}

function levenshteinDistance(a, b, maxDistance = 2) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    let minRow = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
      curr.push(value);
      if (value < minRow) minRow = value;
    }
    if (minRow > maxDistance) return maxDistance + 1;
    prev = curr;
  }
  return prev[b.length];
}

function setSector(el, sector, options = { save: true }) {
  if (!sector) {
    el.removeAttribute("data-sector");
    const originalStyleFill = el.getAttribute("data-original-style-fill") || "";
    if (originalStyleFill) {
      el.style.fill = originalStyleFill;
    } else {
      el.style.removeProperty("fill");
    }
    if (options.save) scheduleSave();
    return;
  }

  el.setAttribute("data-sector", sector);
  el.style.fill = sectorColors[sector] || sectorColors[1];
  if (options.save) scheduleSave();
}

function setOwner(el, owner, options = { save: true }) {
  if (!owner) {
    el.removeAttribute("data-owner");
  } else {
    el.setAttribute("data-owner", owner);
  }
  if (options.save) scheduleSave();
}

function isDemarche(el) {
  return el.getAttribute("data-demarche") === "1";
}

function setDemarche(el, value, by = "", at = "", options = { save: true }) {
  if (!value) {
    el.removeAttribute("data-demarche");
    el.removeAttribute("data-demarche-by");
    el.removeAttribute("data-demarche-at");
    el.classList.remove("demarchee");
  } else {
    el.setAttribute("data-demarche", "1");
    el.setAttribute("data-demarche-by", by || "");
    el.setAttribute("data-demarche-at", at || String(Date.now()));
    el.classList.add("demarchee");
  }
  if (options.save) scheduleSave();
}

function updateDemarcheButton() {
  if (!toggleDemarcheBtn) return;
  const activeUser = getActiveUserName();
  const el = state.current;

  if (!el || !activeUser) {
    toggleDemarcheBtn.disabled = true;
    toggleDemarcheBtn.textContent = "Marquer démarchée";
    return;
  }

  const demarchee = isDemarche(el);
  const by = el.getAttribute("data-demarche-by") || "";

  toggleDemarcheBtn.disabled = false;
  if (!demarchee) {
    toggleDemarcheBtn.textContent = "Marquer démarchée";
  } else if (!by || by === activeUser) {
    toggleDemarcheBtn.textContent = "Retirer démarchée";
  } else {
    toggleDemarcheBtn.textContent = `Retirer démarchée (${by})`;
  }
}

function updateInfo(el) {
  if (!el) {
    infoName.textContent = "Sélectionne une commune sur la carte";
    infoName.classList.add("is-empty");
    if (topSelectedBlock) topSelectedBlock.classList.add("is-empty");
    infoInsee.textContent = "INSEE: —";
    infoSector.textContent = "Secteur: —";
    if (infoDistance) infoDistance.textContent = "Distance: —";
    if (infoDemarche) infoDemarche.textContent = "Démarchée: —";
    if (infoCollab) infoCollab.textContent = "Collaboration: —";
    updateDemarcheButton();
    return;
  }

  infoName.textContent = el.getAttribute("data-name") || "—";
  infoName.classList.remove("is-empty");
  if (topSelectedBlock) topSelectedBlock.classList.remove("is-empty");
  infoInsee.textContent = `INSEE: ${el.getAttribute("data-code") || "—"}`;
  const sector = el.getAttribute("data-sector") || "—";
  if (sector === "—") {
    infoSector.textContent = "Secteur: —";
  } else {
    infoSector.textContent = `Secteur: ${sectorLabels[sector] || sector}`;
  }
  if (infoDistance) {
    const activeUser = getActiveUserName();
    const user = state.users.find((u) => u.name === activeUser);
    const anchor = user ? getUserAnchor(user) : null;
    const code = el.getAttribute("data-code") || "";
    const entry = state.byCodeEntry.get(code);
    if (anchor && entry && entry.geo) {
      infoDistance.textContent = `Distance: ${formatKm(haversineKm(anchor, entry.geo))}`;
    } else {
      infoDistance.textContent = "Distance: —";
    }
  }

  if (infoDemarche) {
    const demarchee = isDemarche(el);
    if (!demarchee) {
      infoDemarche.textContent = "Démarchée: Non";
    } else {
      const by = el.getAttribute("data-demarche-by") || "—";
      infoDemarche.textContent = `Démarchée: Oui (${by})`;
    }
  }
  if (infoCollab) {
    infoCollab.textContent = getSelectedCommuneCollabText(el);
  }
  updateDemarcheButton();
}

function getActiveUserName() {
  return (activeUserSelect && activeUserSelect.value) || "";
}

function getFilterDescriptor() {
  const sectorFilter = filterSectorSelect ? filterSectorSelect.value : "all";
  const userFilter = filterUserSelect ? filterUserSelect.value : "all";
  const demarcheFilter = filterDemarcheSelect ? filterDemarcheSelect.value : "all";
  const labels = [];
  if (sectorFilter !== "all") {
    labels.push(`Secteur: ${sectorLabels[sectorFilter] || sectorFilter}`);
  }
  if (userFilter !== "all") {
    labels.push(`Utilisateur: ${userFilter}`);
  }
  if (demarcheFilter === "yes") {
    labels.push("Démarchées");
  } else if (demarcheFilter === "no") {
    labels.push("Non démarchées");
  }
  return labels.length ? labels.join(" | ") : "Aucun filtre";
}

function getCurrentSummary() {
  const total = state.communes.length;
  let assigned = 0;
  let demarched = 0;
  state.communes.forEach((entry) => {
    if (entry.element.getAttribute("data-sector")) assigned += 1;
    if (isDemarche(entry.element)) demarched += 1;
  });
  const assignedPct = total ? Math.round((assigned / total) * 100) : 0;
  const demarchedPct = total ? Math.round((demarched / total) * 100) : 0;
  return {
    total,
    assigned,
    assignedPct,
    demarched,
    demarchedPct,
  };
}

function getLockEntry(code) {
  const lock = state.locks[code];
  if (!lock) return null;
  if (!lock.at || Date.now() - lock.at > LOCK_TTL_MS) return null;
  return lock;
}

function clearExpiredLocks(options = { save: false }) {
  let changed = false;
  const now = Date.now();
  Object.entries(state.locks).forEach(([code, lock]) => {
    if (!lock || !lock.at || now - lock.at > LOCK_TTL_MS) {
      delete state.locks[code];
      changed = true;
    }
  });
  if (changed && options.save) scheduleSave();
}

function applyLockVisuals() {
  const activeUser = getActiveUserName();
  clearExpiredLocks();
  const lockedByOthers = [];
  state.communes.forEach((entry) => {
    const lock = getLockEntry(entry.code);
    const lockedByOther =
      !!lock && lock.by && lock.by !== activeUser;
    entry.element.classList.toggle("locked-by-other", lockedByOther);
    if (lockedByOther) {
      const label = `${entry.name} (${entry.code})`;
      lockedByOthers.push({ by: lock.by, label, at: lock.at });
    }
  });
  renderLockStatus(lockedByOthers);
  if (state.current) updateInfo(state.current);
}

function renderLockStatus(lockedByOthers) {
  if (!lockStatus) return;
  const items = Array.isArray(lockedByOthers) ? lockedByOthers : [];
  if (!items.length) {
    lockStatus.classList.add("hidden");
    lockStatus.textContent = "";
    return;
  }
  const shown = items
    .slice(0, 3)
    .map((item) => `${item.by} édite ${item.label} (${formatRelativeAge(item.at)})`);
  const suffix = items.length > 3 ? ` (+${items.length - 3})` : "";
  lockStatus.textContent = `Conflits potentiels: ${shown.join(" | ")}${suffix}`;
  lockStatus.classList.remove("hidden");
}

function lockCommuneForActiveUser(el, options = { save: true }) {
  const activeUser = getActiveUserName();
  if (!el || !activeUser) return true;
  clearExpiredLocks({ save: false });
  const code = el.getAttribute("data-code") || "";
  if (!code) return true;
  const lock = getLockEntry(code);
  if (lock && lock.by && lock.by !== activeUser) {
    setSyncStatus(`Commune en édition par ${lock.by}`, "error");
    applyLockVisuals();
    return false;
  }
  state.locks[code] = { by: activeUser, at: Date.now() };
  applyLockVisuals();
  if (options.save) scheduleSave();
  return true;
}

function releaseLockForCode(code, options = { save: true }) {
  if (!code) return;
  const activeUser = getActiveUserName();
  const lock = state.locks[code];
  if (!lock || (lock.by && activeUser && lock.by !== activeUser)) return;
  delete state.locks[code];
  applyLockVisuals();
  if (options.save) scheduleSave();
}

function captureCommuneSnapshot(el) {
  if (!el) return null;
  return {
    code: el.getAttribute("data-code") || "",
    sector: el.getAttribute("data-sector") || "",
    owner: el.getAttribute("data-owner") || "",
    demarche: isDemarche(el),
    demarcheBy: el.getAttribute("data-demarche-by") || "",
    demarcheAt: el.getAttribute("data-demarche-at") || "",
  };
}

function applyCommuneSnapshot(snapshot) {
  if (!snapshot || !snapshot.code) return;
  const el = state.byCode.get(snapshot.code);
  if (!el) return;
  setSector(el, snapshot.sector || "", { save: false });
  setOwner(el, snapshot.owner || "", { save: false });
  setDemarche(
    el,
    !!snapshot.demarche,
    snapshot.demarcheBy || "",
    snapshot.demarcheAt || "",
    { save: false }
  );
}

function updateUndoRedoButtons() {
  if (undoBtn) undoBtn.disabled = !state.undoStack.length;
  if (redoBtn) redoBtn.disabled = !state.redoStack.length;
  const hasUndo = !!state.undoStack.length;
  const hasRedo = !!state.redoStack.length;
  const promote = hasUndo ? "undo" : hasRedo ? "redo" : "export";

  if (exportPdfMapBtn) {
    exportPdfMapBtn.classList.toggle("primary", promote === "export");
    exportPdfMapBtn.classList.toggle("ghost", promote !== "export");
  }
  if (undoBtn) {
    undoBtn.classList.toggle("primary", promote === "undo");
    undoBtn.classList.toggle("ghost", promote !== "undo");
  }
  if (redoBtn) {
    redoBtn.classList.toggle("primary", promote === "redo");
    redoBtn.classList.toggle("ghost", promote !== "redo");
  }
}

function recordAction(action) {
  if (!action || !Array.isArray(action.changes) || !action.changes.length) return;
  state.undoStack.push({
    label: action.label || "Action",
    user: action.user || getActiveUserName() || "Systeme",
    time: action.time || new Date().toLocaleTimeString(),
    changes: action.changes,
  });
  if (state.undoStack.length > 80) state.undoStack.shift();
  state.redoStack = [];
  updateUndoRedoButtons();
}

function applyAction(action, direction) {
  if (!action || !Array.isArray(action.changes)) return;
  const target = direction === "undo" ? "before" : "after";
  action.changes.forEach((change) => {
    applyCommuneSnapshot(change[target]);
  });
  applyFilters();
  renderUserCounts();
  renderDashboard();
  if (state.current) updateInfo(state.current);
  applyLockVisuals();
  scheduleSave();
}

function undoLastAction() {
  const action = state.undoStack.pop();
  if (!action) return;
  applyAction(action, "undo");
  state.redoStack.push(action);
  addHistory({
    time: new Date().toLocaleTimeString(),
    user: getActiveUserName() || "Systeme",
    action: `Annule: ${action.label}`,
  });
  updateUndoRedoButtons();
}

function redoLastAction() {
  const action = state.redoStack.pop();
  if (!action) return;
  applyAction(action, "redo");
  state.undoStack.push(action);
  addHistory({
    time: new Date().toLocaleTimeString(),
    user: getActiveUserName() || "Systeme",
    action: `Retablit: ${action.label}`,
  });
  updateUndoRedoButtons();
}

function updateCurrentUserBadge() {
  if (!currentUserBadge) return;
  if (!state.authReady) {
    currentUserBadge.classList.add("hidden");
    return;
  }
  const name = getActiveUserName();
  if (!name) {
    currentUserBadge.classList.add("hidden");
    return;
  }
  const nameEl = currentUserBadge.querySelector(".user-badge-name");
  if (nameEl) nameEl.textContent = name;
  currentUserBadge.classList.remove("hidden");
}

function addHistory(entry) {
  const normalized = normalizeHistoryEntry(entry || {});
  if (!normalized) return;
  state.historyById[normalized._id] = normalized;
  state.pendingHistoryWrites.push(normalized);
  rebuildHistoryList();
  renderHistory();
  if (state.authReady) scheduleSave();
}

function applyHistorySnapshot(snapshot) {
  snapshot.docChanges().forEach((change) => {
    const id = change.doc.id;
    if (change.type === "removed") {
      delete state.historyById[id];
      return;
    }
    const normalized = normalizeHistoryEntry(change.doc.data() || {}, id);
    if (!normalized) return;
    state.historyById[id] = normalized;
  });

  if (snapshot.docs.length) {
    state.historyCursor = snapshot.docs[snapshot.docs.length - 1];
    state.historyHasMore = snapshot.docs.length >= state.historyPageSize;
  } else {
    state.historyCursor = null;
    state.historyHasMore = false;
  }

  rebuildHistoryList();
  renderHistory();
}

async function loadMoreHistory() {
  return firestoreSync.loadMoreHistory();
}

function renderHistory() {
  if (!historyList) return;
  historyList.innerHTML = "";
  const filteredHistory = state.history.filter((item) => {
    if (state.historyQuickFilter === "all") return true;
    const user = (item && item.user ? String(item.user) : "").toLowerCase();
    const action = (item && item.action ? String(item.action) : "").toLowerCase();
    const isDemarcheAction = action.includes("demarch");
    if (state.historyQuickFilter === "demarche") {
      return isDemarcheAction;
    }
    if (state.historyQuickFilter === "affect") {
      return !isDemarcheAction && (
        action.includes("secteur") ||
        action.includes("affect") ||
        action.includes("attrib")
      );
    }
    if (state.historyQuickFilter === "system") {
      return user === "systeme" || user === "système";
    }
    return true;
  });
  if (!filteredHistory.length) {
    historyList.innerHTML = "<div class='hint'>Aucun événement.</div>";
  } else {
    filteredHistory.forEach((item) => {
      const el = document.createElement("div");
      el.className = "history-item";
      el.textContent = `${item.time} — ${item.user}: ${item.action}`;
      historyList.appendChild(el);
    });
  }

  if (!state.historyHasMore && !state.historyLoadingMore) return;
  const loadMoreBtn = document.createElement("button");
  loadMoreBtn.className = "btn small ghost";
  loadMoreBtn.type = "button";
  loadMoreBtn.textContent = state.historyLoadingMore ? "Chargement..." : "Charger plus";
  loadMoreBtn.disabled = state.historyLoadingMore;
  loadMoreBtn.setAttribute("aria-label", "Charger plus d'événements historiques");
  loadMoreBtn.addEventListener("click", () => {
    loadMoreHistory().catch((err) => {
      console.error("History pagination error:", err);
      setSyncStatus("Erreur de chargement historique", "error");
    });
  });
  historyList.appendChild(loadMoreBtn);
}

function getSelectedUserSectors() {
  const value = sectorSelect ? Number(sectorSelect.value) : NaN;
  if (Number.isNaN(value)) return [];
  return [value];
}

function getUsedSectors() {
  const used = new Set();
  state.users.forEach((user) => {
    user.sectors.forEach((sector) => used.add(Number(sector)));
  });
  return used;
}

function getActiveUserSectors() {
  const activeUser = getActiveUserName();
  if (!activeUser) return new Set();
  const user = state.users.find((u) => u.name === activeUser);
  return user ? new Set(user.sectors.map(String)) : new Set();
}

function updateSectorSelectAvailability() {
  if (!sectorSelect) return;
  const used = getUsedSectors();
  const allowed = getActiveUserSectors();
  [...sectorSelect.options].forEach((opt) => {
    const value = Number(opt.value);
    if (!value) return;
    if (!opt.dataset.originalText) {
      opt.dataset.originalText = opt.textContent;
    }
    const isUsed = used.has(value);
    const isAllowed = allowed.has(String(value));
    opt.disabled = isUsed && !isAllowed;
    opt.textContent = opt.dataset.originalText + (opt.disabled ? " (pris)" : "");
  });
}

function updateSectorRequiredBadge() {
  if (!sectorRequiredBadge || !sectorSelect) return;
  const isMissing = !sectorSelect.value;
  sectorRequiredBadge.classList.toggle("hidden", !isMissing);
}

function updateLegendActive() {
  const selected = sectorSelect ? sectorSelect.value : "";
  const rows = document.querySelectorAll(".legend-row[data-sector]");
  rows.forEach((row) => {
    row.classList.toggle("active", row.dataset.sector === selected);
  });
}

function sectorNamesFromIds(ids) {
  return ids.map((id) => sectorLabels[id] || String(id));
}

function applyMatrixPoint(x, y, matrix) {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

function getElementLonLat(el) {
  const transform =
    el.transform && el.transform.baseVal && el.transform.baseVal.numberOfItems
      ? el.transform.baseVal.consolidate().matrix
      : new DOMMatrix();
  const pointsAttr = el.getAttribute("points");
  if (pointsAttr) {
    const points = pointsAttr.trim().split(/\s+/);
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    points.forEach((pair) => {
      const [xRaw, yRaw] = pair.split(",");
      const x = Number.parseFloat(xRaw);
      const y = Number.parseFloat(yRaw);
      if (Number.isNaN(x) || Number.isNaN(y)) return;
      const p = applyMatrixPoint(x, y, transform);
      sumX += p.x;
      sumY += p.y;
      count += 1;
    });
    if (!count) return null;
    return { lon: sumX / count, lat: sumY / count };
  }

  let bbox;
  try {
    bbox = el.getBBox();
  } catch (err) {
    return null;
  }
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const p = applyMatrixPoint(cx, cy, transform);
  return { lon: p.x, lat: p.y };
}

function getUserAnchor(user) {
  if (user.anchorLat && user.anchorLon) {
    return { lat: user.anchorLat, lon: user.anchorLon };
  }
  if (user.anchorCode) {
    const entry = state.byCodeEntry.get(user.anchorCode);
    if (entry && entry.geo) return entry.geo;
  }
  return null;
}

function haversineKm(a, b) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatKm(value) {
  if (value === null || value === undefined) return "—";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} km`;
}

function asTimestampMs(value) {
  if (!value) return 0;
  if (Number.isFinite(value)) return Number(value);
  if (typeof value === "string") {
    const asNum = Number(value);
    if (Number.isFinite(asNum)) return asNum;
    const asDate = Date.parse(value);
    return Number.isNaN(asDate) ? 0 : asDate;
  }
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (
    value &&
    Number.isFinite(value.seconds) &&
    Number.isFinite(value.nanoseconds)
  ) {
    return Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds) / 1e6);
  }
  return 0;
}

function formatRelativeAge(timestampMs) {
  const ms = asTimestampMs(timestampMs);
  if (!ms) return "inconnu";
  const deltaSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (deltaSec < 5) return "à l'instant";
  if (deltaSec < 60) return `il y a ${deltaSec} sec`;
  const minutes = Math.floor(deltaSec / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}

function getSelectedCommuneCollabText(el) {
  if (!el) return "Collaboration: —";
  const activeUser = getActiveUserName();
  const code = el.getAttribute("data-code") || "";
  const lock = getLockEntry(code);
  const meta = state.remoteCommuneMeta.get(code) || null;
  const parts = [];

  if (lock && lock.by) {
    const actor = lock.by === activeUser ? "vous" : lock.by;
    parts.push(`Verrou: ${actor} (${formatRelativeAge(lock.at)})`);
  }
  if (meta && meta.updatedBy) {
    const actor = meta.updatedBy === activeUser ? "vous" : meta.updatedBy;
    parts.push(`Dernière modif: ${actor} (${formatRelativeAge(meta.updatedAtMs)})`);
  }

  if (!parts.length) return "Collaboration: aucune activité récente";
  return `Collaboration: ${parts.join(" · ")}`;
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  const bigint = parseInt(value, 16);
  if (Number.isNaN(bigint) || value.length !== 6) return { r: 0, g: 0, b: 0 };
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function getCommuneCountByUser() {
  const counts = new Map();
  state.communes.forEach((entry) => {
    const owner = entry.element.getAttribute("data-owner") || "";
    if (!owner) return;
    counts.set(owner, (counts.get(owner) || 0) + 1);
  });
  return counts;
}

function getDisplayUsers(communeCounts) {
  let users = state.users.slice();
  if (state.usersQuickView === "busy") {
    users = users.filter((user) => (communeCounts.get(user.name) || 0) > 0);
  } else if (state.usersQuickView === "idle") {
    users = users.filter((user) => (communeCounts.get(user.name) || 0) === 0);
  }
  if (state.usersQuickSort === "load") {
    users.sort((a, b) => {
      const countDelta = (communeCounts.get(b.name) || 0) - (communeCounts.get(a.name) || 0);
      if (countDelta !== 0) return countDelta;
      return a.name.localeCompare(b.name);
    });
    return users;
  }
  users.sort((a, b) => a.name.localeCompare(b.name));
  return users;
}

function setActiveChip(container, attrName, value) {
  if (!container) return;
  container.querySelectorAll(".chip-btn").forEach((btn) => {
    const isActive = btn.getAttribute(attrName) === value;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function renderUsers() {
  usersList.innerHTML = "";
  const storedActive = localStorage.getItem(ACTIVE_USER_STORAGE_KEY) || "";
  const communeCounts = getCommuneCountByUser();
  const displayUsers = getDisplayUsers(communeCounts);
  if (activeUserSelect) {
    const current = activeUserSelect.value;
    activeUserSelect.innerHTML = "<option value=''>—</option>";
    state.users.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((user) => {
      const opt = document.createElement("option");
      opt.value = user.name;
      opt.textContent = user.name;
      if (user.name === current || user.name === storedActive) opt.selected = true;
      activeUserSelect.appendChild(opt);
    });
    if (!current && storedActive) {
      activeUserSelect.value = storedActive;
    }
  }
  if (filterUserSelect) {
    const current = filterUserSelect.value;
    filterUserSelect.innerHTML = "<option value='all'>Tous</option>";
    state.users.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((user) => {
      const opt = document.createElement("option");
      opt.value = user.name;
      opt.textContent = user.name;
      if (user.name === current) opt.selected = true;
      filterUserSelect.appendChild(opt);
    });
  }
  if (!state.users.length) {
    usersList.innerHTML = "<div class='hint'>Aucun utilisateur.</div>";
    applyFilters();
    updateSectorSelectAvailability();
    updateSectorRequiredBadge();
    updateCurrentUserBadge();
    renderUserCounts(new Map());
    renderDashboard();
    return;
  }

  displayUsers.forEach((user) => {
    const item = document.createElement("div");
    item.className = "user-item";
    const sectorLabel = sectorNamesFromIds(user.sectors).join(", ");
    const communeCount = communeCounts.get(user.name) || 0;
    const communeText = communeCount === 1 ? "1 commune" : `${communeCount} communes`;
    const originalIndex = state.users.findIndex((u) => u.name === user.name);

    const left = createUserIdentityBlock(document, user.name, sectorLabel);

    const actions = document.createElement("div");
    actions.className = "user-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "btn small";
    editBtn.textContent = "Éditer";
    editBtn.title = "Modifier cet utilisateur";
    editBtn.setAttribute("aria-label", `Modifier l'utilisateur ${user.name}`);
    editBtn.addEventListener("click", () => editUser(originalIndex));

    const delBtn = document.createElement("button");
    delBtn.className = "btn small ghost";
    delBtn.textContent = "Supprimer";
    delBtn.title = "Supprimer cet utilisateur";
    delBtn.setAttribute("aria-label", `Supprimer l'utilisateur ${user.name}`);
    delBtn.addEventListener("click", () => deleteUser(originalIndex));

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    item.appendChild(left);
    item.appendChild(actions);
    usersList.appendChild(item);
  });

  applyFilters();
  updateCurrentUserBadge();
  updateSectorSelectAvailability();
  updateSectorRequiredBadge();
  renderUserCounts(communeCounts);
  renderDashboard();
}

function renderUserCounts(communeCounts = getCommuneCountByUser()) {
  if (!userCountsList) return;
  userCountsList.innerHTML = "";
  const displayUsers = getDisplayUsers(communeCounts);
  if (!displayUsers.length) {
    userCountsList.innerHTML = "<div class='hint'>Aucun utilisateur.</div>";
    return;
  }
  displayUsers.forEach((user) => {
    const sectorLabel = sectorNamesFromIds(user.sectors).join(", ");
    const communeCount = communeCounts.get(user.name) || 0;
    const communeText = communeCount === 1 ? "1 commune" : `${communeCount} communes`;
    const anchor = getUserAnchor(user);
    let distanceText = "Ancrage manquant";
    const anchorText = user.anchorName ? `Ancrage : ${user.anchorName}` : "";
    if (anchor) {
      const owned = state.communes.filter(
        (entry) =>
          entry.element.getAttribute("data-owner") === user.name && entry.geo
      );
      if (owned.length) {
        let north = owned[0];
        let south = owned[0];
        let east = owned[0];
        let west = owned[0];
        owned.forEach((entry) => {
          if (entry.geo.lat > north.geo.lat) north = entry;
          if (entry.geo.lat < south.geo.lat) south = entry;
          if (entry.geo.lon > east.geo.lon) east = entry;
          if (entry.geo.lon < west.geo.lon) west = entry;
        });
        distanceText =
          `N ${formatKm(haversineKm(anchor, north.geo))} · ` +
          `S ${formatKm(haversineKm(anchor, south.geo))} · ` +
          `E ${formatKm(haversineKm(anchor, east.geo))} · ` +
          `O ${formatKm(haversineKm(anchor, west.geo))}`;
      } else {
        distanceText = "Aucune commune";
      }
    }
    const item = document.createElement("div");
    item.className = "user-item";
    const nameEl = document.createElement("div");
    nameEl.className = "user-name";
    nameEl.textContent = user.name;
    const sectorsEl = document.createElement("div");
    sectorsEl.className = "user-sectors-text";
    sectorsEl.textContent = `${sectorLabel} · ${communeText}`;
    item.appendChild(nameEl);
    item.appendChild(sectorsEl);
    if (anchorText) {
      const anchorEl = document.createElement("div");
      anchorEl.className = "user-meta";
      anchorEl.textContent = anchorText;
      item.appendChild(anchorEl);
    }
    const distanceEl = document.createElement("div");
    distanceEl.className = "user-meta";
    distanceEl.textContent = distanceText;
    item.appendChild(distanceEl);
    userCountsList.appendChild(item);
  });
}

function renderDashboard() {
  if (!statsSummary || !statsSectorList || !statsUserProgress) return;
  const summary = getCurrentSummary();
  const activeLocks = Object.keys(state.locks).filter((code) => getLockEntry(code)).length;
  statsSummary.innerHTML =
    `<div class="stats-chip"><strong>${summary.assigned}/${summary.total}</strong>Affectées (${summary.assignedPct}%)</div>` +
    `<div class="stats-chip"><strong>${summary.demarched}</strong>Démarchées (${summary.demarchedPct}%)</div>` +
    `<div class="stats-chip"><strong>${state.users.length}</strong>Utilisateurs</div>` +
    `<div class="stats-chip"><strong>${activeLocks}</strong>Verrous actifs</div>`;

  const sectorCounts = {};
  state.communes.forEach((entry) => {
    const sector = entry.element.getAttribute("data-sector");
    if (!sector) return;
    sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
  });
  statsSectorList.innerHTML = "";
  Object.keys(sectorLabels).forEach((sectorId) => {
    const count = sectorCounts[sectorId] || 0;
    const pct = summary.total ? Math.round((count / summary.total) * 100) : 0;
    const row = document.createElement("div");
    row.className = "stats-row";
    row.innerHTML =
      `${sectorLabels[sectorId]}: ${count}` +
      `<div class="stats-track"><div class="stats-fill" style="width:${pct}%;background:${sectorColors[sectorId] || "#999"}"></div></div>`;
    statsSectorList.appendChild(row);
  });

  const countsByUser = getCommuneCountByUser();
  statsUserProgress.innerHTML = "";
  const displayUsers = getDisplayUsers(countsByUser);
  if (!displayUsers.length) {
    statsUserProgress.innerHTML = "<div class='hint'>Aucun utilisateur.</div>";
    return;
  }
  const usersForStats = state.statsQuickView === "top5"
    ? displayUsers.slice().sort((a, b) => {
      const countDelta = (countsByUser.get(b.name) || 0) - (countsByUser.get(a.name) || 0);
      if (countDelta !== 0) return countDelta;
      return a.name.localeCompare(b.name);
    }).slice(0, 5)
    : displayUsers;
  const maxCount = Math.max(1, ...usersForStats.map((user) => countsByUser.get(user.name) || 0));
  usersForStats.forEach((user) => {
      const count = countsByUser.get(user.name) || 0;
      const pct = Math.round((count / maxCount) * 100);
      const row = document.createElement("div");
      row.className = "stats-row";
      row.textContent = `${user.name}: ${count}`;
      const track = document.createElement("div");
      track.className = "stats-track";
      const fill = document.createElement("div");
      fill.className = "stats-fill";
      fill.style.width = `${pct}%`;
      fill.style.background = "#6a5bd5";
      track.appendChild(fill);
      row.appendChild(track);
      statsUserProgress.appendChild(row);
    });
}

function renderConnectedUsers() {
  if (!connectedUsersList) return;
  connectedUsersList.innerHTML = "";
  if (!state.connectedUsers.length) {
    connectedUsersList.innerHTML = "<div class='hint'>Aucun.</div>";
    return;
  }
  state.connectedUsers.forEach((user) => {
    const item = document.createElement("div");
    item.className = "user-item";
    const nameEl = document.createElement("span");
    nameEl.className = "user-name";
    nameEl.textContent = user.name;
    item.appendChild(nameEl);
    connectedUsersList.appendChild(item);
  });
}

function addUser() {
  const name = normalizeUserName(userNameInput.value || "");
  if (!name) {
    setSyncStatus("Nom utilisateur obligatoire", "error");
    return;
  }
  const sectors = getSelectedUserSectors();
  if (!sectors.length) {
    setSyncStatus("Selectionner un secteur", "error");
    return;
  }
  if (getUsedSectors().has(sectors[0])) {
    setSyncStatus("Secteur deja utilise", "error");
    return;
  }
  const anchorValue = (anchorInput && anchorInput.value) || "";
  if (!anchorValue.trim()) {
    setSyncStatus("Commune d'ancrage obligatoire", "error");
    return;
  }
  const anchorEl = findCommune(anchorValue);
  if (!anchorEl) {
    setSyncStatus("Commune d'ancrage introuvable", "error");
    return;
  }
  const anchorCode = anchorEl.getAttribute("data-code") || "";
  const anchorName = anchorEl.getAttribute("data-name") || "";
  const anchorEntry = state.byCodeEntry.get(anchorCode);
  if (!anchorEntry || !anchorEntry.geo) {
    setSyncStatus("Coordonnees d'ancrage indisponibles", "error");
    return;
  }

  state.users.push({
    _id: createUserId(),
    name,
    sectors: [...new Set(sectors)].sort((a, b) => a - b),
    anchorCode,
    anchorName,
    anchorLat: anchorEntry.geo.lat,
    anchorLon: anchorEntry.geo.lon,
  });
  userNameInput.value = "";
  if (anchorInput) anchorInput.value = "";
  if (anchorSuggestions) anchorSuggestions.classList.add("hidden");
  renderUsers();
  scheduleSave();
}

function editUser(index) {
  const user = state.users[index];
  if (!user) return;
  const newName = prompt("Nom utilisateur :", user.name);
  if (newName === null) return;
  const sanitizedName = normalizeUserName(newName);
  if (!sanitizedName) {
    setSyncStatus("Nom utilisateur invalide", "error");
    return;
  }
  const sectorsRaw = prompt(
    "Secteurs (séparés par des virgules). Ex: Nord,Ouest",
    sectorNamesFromIds(user.sectors).join(",")
  );
  if (sectorsRaw === null) return;

  const sectors = sectorsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => {
      const entry = Object.entries(sectorLabels).find(
        ([, name]) => name.toLowerCase() === label.toLowerCase()
      );
      return entry ? Number(entry[0]) : null;
    })
    .filter((v) => v !== null);

  if (!sectors.length) return;

  user.name = sanitizedName;
  user.sectors = [...new Set(sectors)].sort((a, b) => a - b);
  renderUsers();
  scheduleSave();
}

function deleteUser(index) {
  state.users.splice(index, 1);
  renderUsers();
  scheduleSave();
}


function focusCommune(el) {
  if (!el) return;
}

function handleCommuneClick(el) {
  setCurrentCommune(el);
  updateInfo(el);

  const activeUser = getActiveUserName();
  if (!activeUser) {
    setSyncStatus("Commune sélectionnée (choisir un utilisateur actif)", "error");
    return;
  }
  const sector = sectorSelect.value;
  if (!sector) {
    // Commune is selected; sector assignment is optional.
    setSyncStatus("Commune sélectionnée", "ok");
    return;
  }
  const currentSector = el.getAttribute("data-sector") || "";
  const currentOwner = el.getAttribute("data-owner") || "";
  const isOwnedByOther = currentOwner && currentOwner !== activeUser;
  const shouldClear =
    currentSector &&
    currentSector === sector &&
    (!currentOwner || currentOwner === activeUser);

  if (isOwnedByOther) {
    setSyncStatus(`Attribuée à ${currentOwner}`, "error");
    return;
  }
  if (!lockCommuneForActiveUser(el)) return;

  const before = captureCommuneSnapshot(el);

  if (shouldClear) {
    setSector(el, "", { save: false });
    setOwner(el, "", { save: false });
    scheduleSave();
  } else {
    setSector(el, sector, { save: false });
    setOwner(el, activeUser || "", { save: false });
    scheduleSave();
  }
  renderUserCounts();
  renderDashboard();
  const after = captureCommuneSnapshot(el);
  if (before && after) {
    recordAction({
      label: shouldClear
        ? `Retire ${el.getAttribute("data-name")}`
        : `Affecte ${el.getAttribute("data-name")}`,
      changes: [{ before, after }],
      user: activeUser,
    });
  }
  if (activeUser) {
    addHistory({
      time: new Date().toLocaleTimeString(),
      user: activeUser,
      action: shouldClear
        ? `Retire ${el.getAttribute("data-name")}`
        : `Secteur ${sectorLabels[sector] || sector} sur ${el.getAttribute("data-name")}`,
    });
    scheduleSave();
  }
}

function toggleCurrentDemarche() {
  const el = state.current;
  if (!el) {
    setSyncStatus("Selectionner une commune", "error");
    return;
  }
  const activeUser = getActiveUserName();
  if (!activeUser) {
    setSyncStatus("Choisir un utilisateur actif", "error");
    return;
  }
  if (!lockCommuneForActiveUser(el)) return;
  const before = captureCommuneSnapshot(el);

  const demarchee = isDemarche(el);
  const by = el.getAttribute("data-demarche-by") || "";

  const communeName = el.getAttribute("data-name") || "";
  if (demarchee) {
    setDemarche(el, false, "", "", { save: false });
    addHistory({
      time: new Date().toLocaleTimeString(),
      user: activeUser,
      action: by
        ? `Retire demarchee sur ${communeName} (marquee par ${by})`
        : `Retire demarchee sur ${communeName}`,
    });
  } else {
    setDemarche(el, true, activeUser, String(Date.now()), { save: false });
    addHistory({
      time: new Date().toLocaleTimeString(),
      user: activeUser,
      action: `Marque demarchee sur ${communeName}`,
    });
  }
  updateInfo(el);
  applyFilters();
  renderUserCounts();
  renderDashboard();
  const after = captureCommuneSnapshot(el);
  if (before && after) {
    recordAction({
      label: `Demarchage ${communeName}`,
      changes: [{ before, after }],
      user: activeUser,
    });
  }
  scheduleSave();
}

function hideContextMenu() {
  if (!communeContextMenu) return;
  communeContextMenu.classList.add("hidden");
  contextMenuTarget = null;
}

function showContextMenuForCommune(el, clientX, clientY) {
  if (!communeContextMenu || !contextToggleDemarche) return;
  contextMenuTarget = el;
  state.current = el;
  updateInfo(el);

  contextToggleDemarche.textContent = isDemarche(el)
    ? "Retirer démarchée"
    : "Marquer démarchée";

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  communeContextMenu.classList.remove("hidden");
  const menuRect = communeContextMenu.getBoundingClientRect();
  const x = Math.min(clientX, vw - menuRect.width - 8);
  const y = Math.min(clientY, vh - menuRect.height - 8);
  communeContextMenu.style.left = `${Math.max(8, x)}px`;
  communeContextMenu.style.top = `${Math.max(8, y)}px`;
}

function clearAllDemarches() {
  const activeUser = getActiveUserName() || "Systeme";
  const marked = state.communes.filter((entry) => isDemarche(entry.element));
  if (!marked.length) {
    setSyncStatus("Aucune commune demarchee", "ok");
    return;
  }
  const ok = confirm(
    `Retirer le statut demarchee sur ${marked.length} communes ?`
  );
  if (!ok) return;

  const changes = [];
  marked.forEach((entry) =>
  {
    if (!lockCommuneForActiveUser(entry.element, { save: false })) return;
    const before = captureCommuneSnapshot(entry.element);
    setDemarche(entry.element, false, "", "", { save: false });
    const after = captureCommuneSnapshot(entry.element);
    if (before && after) changes.push({ before, after });
  });
  const updatedCount = changes.length;
  addHistory({
    time: new Date().toLocaleTimeString(),
    user: activeUser,
    action: `Retire demarchee sur ${updatedCount} communes`,
  });
  recordAction({
    label: "Reset demarchage",
    changes,
    user: activeUser,
  });
  if (state.current) updateInfo(state.current);
  applyFilters();
  renderUserCounts();
  renderDashboard();
  scheduleSave();
}

function bindCommune(el, data) {
  el.classList.add("commune");
  el.setAttribute("data-code", data.code);
  el.setAttribute("data-name", data.name);
  el.setAttribute("data-name-upper", normalizeName(data.name));
  el.setAttribute("data-tooltip", `${data.name} (${data.code})`);

  if (!el.hasAttribute("data-original-fill")) {
    const originalStyleFill = el.style.fill || "";
    el.setAttribute("data-original-style-fill", originalStyleFill);
  }

  // Click handled via SVG event delegation to avoid pointer capture issues.
}

function applyFilters() {
  const sectorFilter = filterSectorSelect ? filterSectorSelect.value : "all";
  const userFilter = filterUserSelect ? filterUserSelect.value : "all";
  const demarcheFilter = filterDemarcheSelect ? filterDemarcheSelect.value : "all";
  let allowedSectors = null;

  if (userFilter !== "all") {
    const user = state.users.find((u) => u.name === userFilter);
    if (user) allowedSectors = new Set(user.sectors.map(String));
  }

  state.communes.forEach((entry) => {
    const sector = entry.element.getAttribute("data-sector") || "";
    const demarchee = isDemarche(entry.element);
    let visible = true;
    if (sectorFilter !== "all") {
      visible = sector === sectorFilter;
    }
    if (visible && allowedSectors) {
      visible = allowedSectors.has(sector);
    }
    if (visible && demarcheFilter === "yes") {
      visible = demarchee;
    }
    if (visible && demarcheFilter === "no") {
      visible = !demarchee;
    }
    entry.element.classList.toggle("filtered-out", !visible);
  });

  if (filtersActiveBadge) {
    const labels = [];
    if (sectorFilter !== "all") {
      labels.push(`Secteur: ${sectorLabels[sectorFilter] || sectorFilter}`);
    }
    if (userFilter !== "all") {
      labels.push(`Utilisateur: ${userFilter}`);
    }
    if (demarcheFilter === "yes") {
      labels.push("Démarchées");
    } else if (demarcheFilter === "no") {
      labels.push("Non démarchées");
    }
    if (!labels.length) {
      filtersActiveBadge.classList.add("hidden");
      filtersActiveBadge.textContent = "";
    } else {
      filtersActiveBadge.textContent = `Filtres actifs: ${labels.join(" · ")}`;
      filtersActiveBadge.classList.remove("hidden");
    }
  }
}

function getVisibleCommuneEntries() {
  return state.communes.filter(
    (entry) => !entry.element.classList.contains("filtered-out")
  );
}

async function buildIndex(elements) {
  state.communes = [];
  state.byName.clear();
  state.bySearch.clear();
  state.byCode.clear();
  state.byCodeEntry.clear();

  const chunkSize = 280;
  const total = elements.length || 1;
  for (let i = 0; i < elements.length; i += chunkSize) {
    const chunk = elements.slice(i, i + chunkSize);
    chunk.forEach((el) => {
      const id = el.id || "";
      const parsed = parseId(id);
      if (!parsed) return;

      bindCommune(el, parsed);
    const geo = getElementLonLat(el);

    const entry = {
      code: parsed.code,
      name: parsed.name,
      nameUpper: normalizeName(parsed.name),
      nameSearch: normalizeSearch(parsed.name),
      element: el,
      geo,
    };
    state.communes.push(entry);
    state.byName.set(entry.nameUpper, el);
    state.bySearch.set(entry.nameSearch, el);
      state.byCode.set(entry.code, el);
      state.byCodeEntry.set(entry.code, entry);
    });
    if (i + chunkSize < elements.length) {
      const pct = Math.round(((i + chunk.length) / total) * 100);
      setSyncStatus(`Préparation carte… ${pct}%`);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }
  renderDashboard();
  applyLockVisuals();
}

function findCommune(query) {
  const raw = query.trim();
  if (!raw) return null;
  const normalized = normalizeSearch(raw);

  const parsed = parseId(raw);
  if (parsed) {
    const byName = state.bySearch.get(normalizeSearch(parsed.name));
    if (byName) return byName;
    const byCode = state.byCode.get(parsed.code);
    if (byCode) return byCode;
  }

  if (/^\d{5}$/.test(raw)) {
    return state.byCode.get(raw) || null;
  }

  const exact = state.bySearch.get(normalized);
  if (exact) return exact;

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const entry of state.communes) {
    const nameNorm = entry.nameSearch || normalizeSearch(entry.name);
    if (!nameNorm) continue;
    const distance = levenshteinDistance(normalized, nameNorm, 3);
    const includesBonus =
      nameNorm.includes(normalized) || normalized.includes(nameNorm) ? -1 : 0;
    const score = distance + includesBonus;
    if (score < bestScore) {
      bestScore = score;
      best = entry.element;
    }
  }
  if (bestScore <= 2) return best;
  return null;
}

function renderSuggestions(query) {
  if (!searchSuggestions) return;
  const raw = query.trim();
  if (raw.length < 3) {
    searchSuggestions.classList.add("hidden");
    searchSuggestions.innerHTML = "";
    return;
  }

  const q = normalizeSearch(raw);
  const matches = state.communes
    .filter(
      (entry) =>
        (entry.nameSearch || normalizeSearch(entry.name)).includes(q) ||
        entry.code.includes(q)
    )
    .slice(0, 12);

  if (!matches.length) {
    searchSuggestions.innerHTML = "<div class='suggestion-item empty'>Aucun résultat</div>";
    searchSuggestions.classList.remove("hidden");
    return;
  }

  searchSuggestions.innerHTML = "";
  matches.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "suggestion-item";
    item.textContent = `${entry.name} (${entry.code})`;
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      searchInput.value = entry.name;
      searchSuggestions.classList.add("hidden");
      searchBtn.click();
    });
    searchSuggestions.appendChild(item);
  });
  searchSuggestions.classList.remove("hidden");
}

function renderAnchorSuggestions(query) {
  if (!anchorSuggestions) return;
  const raw = query.trim();
  if (raw.length < 3) {
    anchorSuggestions.classList.add("hidden");
    anchorSuggestions.innerHTML = "";
    return;
  }

  let matches = [];
  if (/^\d{5}$/.test(raw)) {
    const byCode = state.byCode.get(raw);
    if (byCode) {
      const entry = state.byCodeEntry.get(raw);
      if (entry) matches = [entry];
    }
  } else {
    const q = normalizeSearch(raw);
    matches = state.communes
      .filter(
        (entry) =>
          (entry.nameSearch || normalizeSearch(entry.name)).includes(q) ||
          entry.code.includes(q)
      )
      .slice(0, 12);
  }

  if (!matches.length) {
    anchorSuggestions.classList.add("hidden");
    anchorSuggestions.innerHTML = "";
    return;
  }

  anchorSuggestions.innerHTML = "";
  matches.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "suggestion-item";
    item.textContent = `${entry.name} (${entry.code})`;
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      if (anchorInput) anchorInput.value = entry.name;
      anchorSuggestions.classList.add("hidden");
    });
    anchorSuggestions.appendChild(item);
  });
  anchorSuggestions.classList.remove("hidden");
}

function exportCsv() {
  const summary = getCurrentSummary();
  const activeUser = getActiveUserName() || "—";
  const filterText = getFilterDescriptor();
  const visibleEntries = getVisibleCommuneEntries()
    .slice()
    .sort((a, b) => a.nameUpper.localeCompare(b.nameUpper));
  const rows = [[
    "meta",
    "value",
  ], [
    "exported_at",
    new Date().toLocaleString(),
  ], [
    "active_user",
    activeUser,
  ], [
    "filters",
    filterText,
  ], [
    "summary",
    `${summary.assigned}/${summary.total} affectees, ${summary.demarched} demarchees`,
  ], [], [
    "commune",
    "secteur",
    "proprietaire",
    "distance_km",
    "demarchee",
    "demarchee_par",
    "demarchee_at",
  ]];
  const userByName = new Map(state.users.map((u) => [u.name, u]));

  visibleEntries.forEach((entry) => {
    const sector = entry.element.getAttribute("data-sector") || "";
    const owner = entry.element.getAttribute("data-owner") || "";
    let distance = "";
    if (owner) {
      const user = userByName.get(owner);
      const anchor = user ? getUserAnchor(user) : null;
      if (anchor && entry.geo) {
        distance = formatKm(haversineKm(anchor, entry.geo));
      }
    }
    const demarchee = isDemarche(entry.element);
    const demarcheeBy = entry.element.getAttribute("data-demarche-by") || "";
    const demarcheeAt = entry.element.getAttribute("data-demarche-at") || "";
    rows.push([
      entry.name,
      sector,
      owner,
      distance,
      demarchee ? "oui" : "non",
      demarcheeBy,
      demarcheeAt,
    ]);
  });

  const csv = rows.map((r) => r.join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "secteurs.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  setSyncStatus("CSV exporté", "ok");
}

function getJsPdf() {
  const jspdf = window.jspdf;
  if (!jspdf || !jspdf.jsPDF) {
    setSyncStatus("jsPDF non charge", "error");
    return null;
  }
  return jspdf.jsPDF;
}

async function svgToPngDataUrl(svg) {
  const clone = svg.cloneNode(true);
  const originalByCode = new Map();
  svg.querySelectorAll(".commune").forEach((el) => {
    const code = el.getAttribute("data-code");
    if (code) originalByCode.set(code, el);
  });
  clone.querySelectorAll(".commune").forEach((el) => {
    const code = el.getAttribute("data-code");
    const orig = code ? originalByCode.get(code) : null;
    if (!orig) return;
    const fill = orig.style.fill || getComputedStyle(orig).fill;
    if (fill) {
      el.setAttribute("fill", fill);
      el.style.fill = fill;
    }
  });
  if (!clone.getAttribute("viewBox")) {
    const bbox = svg.getBBox();
    clone.setAttribute("viewBox", `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);
    clone.setAttribute("width", bbox.width);
    clone.setAttribute("height", bbox.height);
  }
  const serializer = new XMLSerializer();
  const svgText = serializer.serializeToString(clone);
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const image = new Image();
  const dataUrl = await new Promise((resolve, reject) => {
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width || svg.viewBox.baseVal.width || 1000;
      canvas.height = image.height || svg.viewBox.baseVal.height || 700;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
      URL.revokeObjectURL(url);
    };
    image.onerror = reject;
    image.src = url;
  });
  return dataUrl;
}

async function exportPdfMap() {
  const svg = mapContainer.querySelector("svg");
  if (!svg) return;
  const jsPDF = getJsPdf();
  if (!jsPDF) return;
  const pngData = await svgToPngDataUrl(svg);
  const img = new Image();
  await new Promise((resolve) => {
    img.onload = resolve;
    img.src = pngData;
  });
  const orientation = "landscape";
  const headerHeight = 78;
  const legendWidth = 170;
  const pdf = new jsPDF({
    orientation,
    unit: "px",
    format: [img.width + legendWidth, img.height + headerHeight],
  });
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, img.width + legendWidth, img.height + headerHeight, "F");
  pdf.setFontSize(18);
  pdf.text("Vendée — Carte des communes", 20, 32);
  pdf.setFontSize(10);
  pdf.text(new Date().toLocaleString(), 20, 48);
  pdf.text(`Utilisateur: ${getActiveUserName() || "—"}`, 220, 48);
  pdf.text(`Filtres: ${getFilterDescriptor()}`, 20, 62);
  pdf.addImage(pngData, "PNG", 0, headerHeight, img.width, img.height);

  const legendX = img.width + 16;
  let legendY = headerHeight + 24;
  pdf.setFontSize(12);
  pdf.text("Légende", legendX, legendY);
  legendY += 16;

  const entries = [
    { id: 1, label: "Nord" },
    { id: 2, label: "Nord-Est" },
    { id: 3, label: "Est" },
    { id: 4, label: "Sud-Est" },
    { id: 5, label: "Sud" },
    { id: 6, label: "Sud-Ouest" },
    { id: 7, label: "Ouest" },
    { id: 8, label: "Nord-Ouest" },
    { id: 9, label: "Centre" },
  ];

  pdf.setFontSize(10);
  entries.forEach((entry) => {
    const color = sectorColors[entry.id];
    const { r, g, b } = hexToRgb(color);
    pdf.setFillColor(r, g, b);
    pdf.circle(legendX + 6, legendY - 4, 4, "F");
    pdf.setTextColor(0, 0, 0);
    pdf.text(entry.label, legendX + 16, legendY);
    legendY += 16;
  });

  pdf.setTextColor(0, 0, 0);
  pdf.save("carte_vendee.pdf");
  setSyncStatus("PDF carte exporté", "ok");
}

function exportPdfReport() {
  const jsPDF = getJsPdf();
  if (!jsPDF) return Promise.resolve();
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const margin = 40;
  let y = margin;
  const lineHeight = 14;

  pdf.setFontSize(16);
  pdf.text("Vendée — Rapport", margin, y);
  y += lineHeight + 6;

  pdf.setFontSize(10);
  pdf.text(new Date().toLocaleString(), margin, y);
  y += lineHeight + 10;

  const summary = getCurrentSummary();
  pdf.text(`Utilisateur actif: ${getActiveUserName() || "—"}`, margin, y);
  y += lineHeight;
  pdf.text(`Filtres: ${getFilterDescriptor()}`, margin, y);
  y += lineHeight;
  pdf.text(
    `Résumé: ${summary.assigned}/${summary.total} affectées · ${summary.demarched} démarchées`,
    margin,
    y
  );
  y += lineHeight + 6;

  pdf.setFontSize(12);
  pdf.text("Utilisateurs", margin, y);
  y += lineHeight;

  const communeCounts = getCommuneCountByUser();
  state.users.forEach((user) => {
    const sectorLabel = sectorNamesFromIds(user.sectors).join(", ");
    const communeCount = communeCounts.get(user.name) || 0;
    const communeText = communeCount === 1 ? "1 commune" : `${communeCount} communes`;
    const anchorText = user.anchorName ? `Ancrage: ${user.anchorName}` : "Ancrage: —";
    pdf.setFontSize(10);
    pdf.text(`${user.name} — ${sectorLabel} — ${communeText}`, margin, y);
    y += lineHeight;
    pdf.text(anchorText, margin, y);
    y += lineHeight;

    if (y > 760) {
      pdf.addPage();
      y = margin;
    }
  });

  y += lineHeight;
  pdf.setFontSize(12);
  pdf.text("Communes", margin, y);
  y += lineHeight;

  const userByName = new Map(state.users.map((u) => [u.name, u]));
  const sorted = getVisibleCommuneEntries().slice().sort((a, b) =>
    a.nameUpper.localeCompare(b.nameUpper)
  );
  const filtered = sorted.filter((entry) => entry.element.getAttribute("data-sector"));
  pdf.setFontSize(9);
  const colX = {
    name: margin,
    sector: margin + 260,
    owner: margin + 340,
    dist: margin + 430,
  };
  pdf.setFontSize(10);
  pdf.text("Commune", colX.name, y);
  pdf.text("Secteur", colX.sector, y);
  pdf.text("Utilisateur", colX.owner, y);
  pdf.text("Distance", colX.dist, y);
  y += lineHeight;
  pdf.setLineWidth(0.5);
  pdf.line(margin, y - 8, 555, y - 8);
  pdf.setFontSize(9);
  filtered.forEach((entry) => {
    const sector = entry.element.getAttribute("data-sector") || "";
    const owner = entry.element.getAttribute("data-owner") || "";
    let distance = "";
    if (owner) {
      const user = userByName.get(owner);
      const anchor = user ? getUserAnchor(user) : null;
      if (anchor && entry.geo) {
        distance = formatKm(haversineKm(anchor, entry.geo));
      }
    }
    pdf.text(entry.name, colX.name, y);
    pdf.text(sector || "—", colX.sector, y);
    pdf.text(owner || "—", colX.owner, y);
    pdf.text(distance || "—", colX.dist, y);
    y += lineHeight;
    if (y > 800) {
      pdf.addPage();
      y = margin;
    }
  });

  pdf.save("rapport_vendee.pdf");
  setSyncStatus("PDF rapport exporté", "ok");
  return Promise.resolve();
}


function resetAll() {
  const changes = [];
  state.communes.forEach((entry) => {
    if (!lockCommuneForActiveUser(entry.element, { save: false })) return;
    const before = captureCommuneSnapshot(entry.element);
    setSector(entry.element, "", { save: false });
    setOwner(entry.element, "", { save: false });
    setDemarche(entry.element, false, "", "", { save: false });
    const after = captureCommuneSnapshot(entry.element);
    if (before && after) changes.push({ before, after });
  });
  recordAction({
    label: "Reset partiel communes",
    changes,
    user: getActiveUserName() || "Systeme",
  });
  setSyncStatus(`Reset partiel appliqué (${changes.length} communes)`, "ok");
  addHistory({
    time: new Date().toLocaleTimeString(),
    user: getActiveUserName() || "Systeme",
    action: "Reset partiel des communes",
  });
  renderHistory();
  renderUsers();
  renderUserCounts();
  renderDashboard();
  applyFilters();
  updateInfo(state.current);
  scheduleSave();
}

function readCurrentCommuneDoc(entry) {
  const sector = entry.element.getAttribute("data-sector") || "";
  const owner = entry.element.getAttribute("data-owner") || "";
  const demarcheBy = entry.element.getAttribute("data-demarche-by") || "";
  const demarcheAt = entry.element.getAttribute("data-demarche-at") || "";
  if (!sector && !owner && !demarcheBy) return null;
  return {
    sector,
    owner,
    demarcheBy,
    demarcheAt,
  };
}

function applyRemoteCommuneDoc(code, data) {
  const el = state.byCode.get(code);
  if (!el) return;
  if (!data) {
    setSector(el, "", { save: false });
    setOwner(el, "", { save: false });
    setDemarche(el, false, "", "", { save: false });
    return;
  }
  setSector(el, data.sector || "", { save: false });
  setOwner(el, data.owner || "", { save: false });
  setDemarche(el, !!data.demarcheBy, data.demarcheBy || "", data.demarcheAt || "", { save: false });
}

function extractRemoteCommuneMeta(data) {
  if (!data || typeof data !== "object") return null;
  const updatedBy = typeof data.updatedBy === "string" ? data.updatedBy.trim() : "";
  const updatedAtMs = asTimestampMs(data.updatedAt);
  if (!updatedBy && !updatedAtMs) return null;
  return { updatedBy, updatedAtMs };
}

function applyLegacyCommuneMaps(data) {
  if (!data || typeof data !== "object") return;
  state.communes.forEach((entry) => setSector(entry.element, "", { save: false }));
  state.communes.forEach((entry) => setOwner(entry.element, "", { save: false }));
  state.communes.forEach((entry) => setDemarche(entry.element, false, "", "", { save: false }));
  if (data.sectors && typeof data.sectors === "object") {
    Object.entries(data.sectors).forEach(([code, sector]) => {
      const el = state.byCode.get(code);
      if (el) setSector(el, String(sector), { save: false });
    });
  }
  if (data.owners && typeof data.owners === "object") {
    Object.entries(data.owners).forEach(([code, owner]) => {
      const el = state.byCode.get(code);
      if (el) setOwner(el, String(owner), { save: false });
    });
  }
  if (data.demarches && typeof data.demarches === "object") {
    Object.entries(data.demarches).forEach(([code, demarche]) => {
      const normalized = normalizeRemoteCommuneDoc({
        sector: "",
        owner: "",
        demarche,
      });
      const el = state.byCode.get(code);
      if (!el || !normalized || !normalized.demarcheBy) return;
      setDemarche(el, true, normalized.demarcheBy, normalized.demarcheAt, { save: false });
    });
  }
}

function applyRemoteMetaState(data) {
  if (!data) return;
  state.isApplyingRemote = true;
  let needsLegacyUsersMigrationSave = false;
  state.remoteMetaVersion =
    Number.isInteger(data.version) && data.version >= 0
      ? data.version
      : 0;

  if (
    !state.legacyUsersMigrated &&
    state.remoteUsersState.size === 0 &&
    data.usersById &&
    typeof data.usersById === "object" &&
    Object.keys(data.usersById).length
  ) {
    // Legacy migration path: bootstrap users collection from old meta.usersById.
    state.users = usersFromUsersById(data.usersById);
    state.legacyUsersMigrated = true;
    renderUsers();
    needsLegacyUsersMigrationSave = true;
  }
  state.locks = data.locks && typeof data.locks === "object" ? data.locks : {};
  clearExpiredLocks({ save: false });
  state.remoteLocks = clonePlainData(state.locks);

  if (
    state.remoteCommuneState.size === 0 &&
    (data.sectors || data.owners || data.demarches)
  ) {
    // Legacy fallback while migrating from single-document state.
    applyLegacyCommuneMaps(data);
  }

  renderUserCounts();
  renderDashboard();
  applyLockVisuals();
  if (state.current) updateInfo(state.current);

  state.isApplyingRemote = false;
  applyFilters();
  if (needsLegacyUsersMigrationSave) scheduleSave();
}

function applyRemoteCommuneChanges(snapshot) {
  state.hasCommuneSnapshot = true;
  state.isApplyingRemote = true;
  snapshot.docChanges().forEach((change) => {
    if (change.doc.metadata.hasPendingWrites) return;
    const code = change.doc.id;
    if (change.type === "removed") {
      state.remoteCommuneState.delete(code);
      state.remoteCommuneMeta.delete(code);
      applyRemoteCommuneDoc(code, null);
      return;
    }
    const raw = change.doc.data() || {};
    const normalized = normalizeRemoteCommuneDoc(raw);
    const meta = extractRemoteCommuneMeta(raw);
    if (meta) state.remoteCommuneMeta.set(code, meta);
    else state.remoteCommuneMeta.delete(code);
    if (normalized) {
      state.remoteCommuneState.set(code, normalized);
      applyRemoteCommuneDoc(code, normalized);
    } else {
      state.remoteCommuneState.delete(code);
      applyRemoteCommuneDoc(code, null);
    }
  });
  renderUserCounts();
  renderDashboard();
  applyLockVisuals();
  if (state.current) updateInfo(state.current);
  state.isApplyingRemote = false;
  applyFilters();
}

function initRealtime() {
  firestoreSync.initRealtime();
}

function updatePresence() {
  if (!auth.currentUser) return;
  const activeUser = getActiveUserName();
  const name = activeUser || "—";
  const presenceRef = doc(db, "vendee_presence", auth.currentUser.uid);
  setDoc(
    presenceRef,
    {
      name,
      lastSeen: serverTimestamp(),
    },
    { merge: true }
  ).catch((err) => {
    console.error("Presence update error:", err);
  });
}

function initPresence() {
  updatePresence();
  if (state.presenceTimer) clearInterval(state.presenceTimer);
  state.presenceTimer = setInterval(updatePresence, 20000);
  window.addEventListener("beforeunload", () => {
    updatePresence();
  });
}

function refreshCurrentLock() {
  const activeUser = getActiveUserName();
  const current = state.current;
  if (!activeUser || !current) return;
  const code = current.getAttribute("data-code") || "";
  if (!code) return;
  const lock = getLockEntry(code);
  if (!lock || lock.by !== activeUser) return;
  state.locks[code] = { by: activeUser, at: Date.now() };
  scheduleSave();
}

function initLockHeartbeat() {
  if (state.lockHeartbeatTimer) clearInterval(state.lockHeartbeatTimer);
  state.lockHeartbeatTimer = setInterval(refreshCurrentLock, 15000);
}

function initPresenceListener() {
  if (state.presenceUnsub) state.presenceUnsub();
  state.presenceUnsub = onSnapshot(presenceColRef, (snapshot) => {
    const now = Date.now();
    const connected = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const name = (data.name || "—").trim() || "—";
      const lastSeen = data.lastSeen && data.lastSeen.toMillis
        ? data.lastSeen.toMillis()
        : 0;
      if (lastSeen && now - lastSeen < 45000) {
        connected.push({ name, lastSeen });
      }
    });
    connected.sort((a, b) => a.name.localeCompare(b.name));
    state.connectedUsers = connected;
    renderConnectedUsers();
  });
}

function scheduleSave() {
  if (state.isApplyingRemote) return;
  state.pendingSave = true;
  if (!state.authReady) return;
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveState, 250);
  setSyncStatus("En cours…", "pending");
}

async function saveMetaState() {
  return firestoreSync.saveMetaState();
}

async function saveUsersState() {
  return firestoreSync.saveUsersState();
}

async function saveHistoryState() {
  if (!state.pendingHistoryWrites.length) return { writes: 0 };
  const queue = state.pendingHistoryWrites.slice();
  state.pendingHistoryWrites = [];
  let writes = 0;

  for (let i = 0; i < queue.length; i += 1) {
    const item = queue[i];
    const ref = doc(historyColRef, item._id);
    try {
      await setDoc(ref, {
        time: item.time,
        user: item.user,
        action: item.action,
        createdAt: serverTimestamp(),
        clientCreatedAt: historySortValue(item) || Date.now(),
      });
      writes += 1;
    } catch (err) {
      state.pendingHistoryWrites = queue.slice(i).concat(state.pendingHistoryWrites);
      throw err;
    }
  }
  return { writes };
}

async function saveCommunesState() {
  const desired = new Map();
  state.communes.forEach((entry) => {
    const current = readCurrentCommuneDoc(entry);
    if (current) desired.set(entry.code, current);
  });
  const operations = diffCommuneState(state.remoteCommuneState, desired);
  if (!operations.length) {
    return { writes: 0, assigned: desired.size };
  }
  const updatedBy = getActiveUserName() || "Systeme";
  const chunkSize = 450;
  for (let i = 0; i < operations.length; i += chunkSize) {
    const batch = writeBatch(db);
    const chunk = operations.slice(i, i + chunkSize);
    chunk.forEach((op) => {
      const ref = doc(communesColRef, op.code);
      if (op.type === "delete") {
        batch.delete(ref);
        return;
      }
      const payload = {
        updatedAt: serverTimestamp(),
        updatedBy,
      };
      if (op.data.sector) payload.sector = op.data.sector;
      if (op.data.owner) payload.owner = op.data.owner;
      if (op.data.demarcheBy) {
        payload.demarche = {
          by: op.data.demarcheBy,
          at: op.data.demarcheAt || String(Date.now()),
        };
      }
      batch.set(ref, payload);
    });
    await batch.commit();
  }
  return { writes: operations.length, assigned: desired.size };
}

async function saveState() {
  if (!state.authReady || state.isApplyingRemote) return;
  if (!state.remoteReady) {
    state.pendingSave = true;
    return;
  }
  state.pendingSave = false;
  clearExpiredLocks({ save: false });
  const demarchedCount = state.communes.reduce(
    (acc, entry) => acc + (isDemarche(entry.element) ? 1 : 0),
    0
  );
  setSyncStatus(
    `Sauvegarde… (${state.communes.length} communes, ${state.users.length} users, ${demarchedCount} demarchees)`
    ,
    "pending"
  );
  try {
    // Commit meta/version first to enforce optimistic concurrency before side writes.
    await saveMetaState();
    const [communesResult, usersResult, historyResult] = await Promise.all([
      saveCommunesState(),
      saveUsersState(),
      saveHistoryState(),
    ]);
    setSyncStatus(
      `Synchronisé (${communesResult.writes} commune, ${usersResult.writes} utilisateurs, ${historyResult.writes} historique)`,
      "ok"
    );
  } catch (err) {
    console.error("Firebase save error:", err);
    const code = err && err.code ? String(err.code) : "";
    if (code === "conflict-version") {
      setSyncStatus("Conflit detecte: donnees distantes modifiees, recharge et reessaie", "error");
      return;
    }
    const codeText = code ? ` (${code})` : "";
    setSyncStatus(`Erreur de synchro${codeText}`, "error");
  }
}

function bindUI() {
  initActionsMenu(document, actionsMore);
  initCollapsibleSections(document, {
    storage: localStorage,
    storageKey: COLLAPSIBLE_SECTIONS_STORAGE_KEY,
    defaultCollapsed: true,
  });
  if (themeToggle) {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY) || "light";
    const root = document.documentElement;
    document.body.classList.toggle("dark", storedTheme === "dark");
    root.classList.toggle("dark", storedTheme === "dark");
    themeToggle.checked = storedTheme === "dark";
    themeToggle.addEventListener("change", () => {
      const isDark = themeToggle.checked;
      document.body.classList.toggle("dark", isDark);
      root.classList.toggle("dark", isDark);
      localStorage.setItem(THEME_STORAGE_KEY, isDark ? "dark" : "light");
    });
  }

  sectorSelect.addEventListener("change", (event) => {
    state.selectedSector = event.target.value;
    updateSectorSelectAvailability();
    updateLegendActive();
    updateSectorRequiredBadge();
  });

  searchBtn.addEventListener("click", () => {
    const el = findCommune(searchInput.value);
    if (el) {
      setCurrentCommune(el);
      updateInfo(el);
      setSyncStatus("Commune sélectionnée", "ok");
      focusCommune(el);
    } else {
      setSyncStatus("Aucune commune trouvée", "error");
      renderSuggestions(searchInput.value);
    }
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchBtn.click();
    }
  });

  searchInput.addEventListener("input", () => {
    if (state.searchSuggestTimer) clearTimeout(state.searchSuggestTimer);
    state.searchSuggestTimer = setTimeout(() => {
      renderSuggestions(searchInput.value);
    }, 180);
  });

  if (anchorInput) {
    anchorInput.addEventListener("input", () => {
      renderAnchorSuggestions(anchorInput.value);
    });
  }

  document.addEventListener("click", (event) => {
    if (!searchSuggestions) return;
    const target = event.target;
    if (target === searchInput || searchSuggestions.contains(target)) return;
    searchSuggestions.classList.add("hidden");
  });
  document.addEventListener("click", (event) => {
    if (!anchorSuggestions) return;
    const target = event.target;
    if (target === anchorInput || anchorSuggestions.contains(target)) return;
    anchorSuggestions.classList.add("hidden");
  });
  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (!communeContextMenu || communeContextMenu.classList.contains("hidden")) return;
    const target = event.target;
    if (communeContextMenu.contains(target)) return;
    hideContextMenu();
  });

  if (exportPdfMapBtn) {
    exportPdfMapBtn.addEventListener("click", () => {
      exportPdfMap().catch((err) => console.error("PDF map error:", err));
    });
  }
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", exportCsv);
  }
  if (exportPdfReportBtn) {
    exportPdfReportBtn.addEventListener("click", () => {
      exportPdfReport().catch((err) => console.error("PDF report error:", err));
    });
  }
  if (undoBtn) undoBtn.addEventListener("click", undoLastAction);
  if (redoBtn) redoBtn.addEventListener("click", redoLastAction);

  resetBtn.addEventListener("click", () => {
    const ok = confirm(
      "Confirmation : reset partiel des communes (secteur/proprietaire/demarchee). Cette action est annulable. Continuer ?"
    );
    if (!ok) return;
    resetAll();
  });
  if (resetViewBtn) {
    resetViewBtn.addEventListener("click", () => {
      if (state.panZoom && typeof state.panZoom.resetView === "function") {
        state.panZoom.resetView();
        setSyncStatus("Vue reinitialisee", "ok");
      }
    });
  }

  addUserBtn.addEventListener("click", addUser);
  userNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addUser();
    }
  });

  if (activeUserSelect) {
    activeUserSelect.addEventListener("change", () => {
      localStorage.setItem(ACTIVE_USER_STORAGE_KEY, getActiveUserName());
      updatePresence();
      updateCurrentUserBadge();
      applyLockVisuals();
      const user = state.users.find((u) => u.name === getActiveUserName());
      if (!user || !user.sectors.length) {
        sectorSelect.value = "";
        state.selectedSector = "";
      }
      updateSectorSelectAvailability();
      updateLegendActive();
      updateSectorRequiredBadge();
      applyFilters();
      if (state.current) updateInfo(state.current);
      else updateDemarcheButton();
    });
  }
  if (filterSectorSelect) {
    filterSectorSelect.addEventListener("change", applyFilters);
  }
  if (filterUserSelect) {
    filterUserSelect.addEventListener("change", applyFilters);
  }
  if (filterDemarcheSelect) {
    filterDemarcheSelect.addEventListener("change", applyFilters);
  }
  if (usersQuickChips) {
    usersQuickChips.addEventListener("click", (event) => {
      const btn = event.target.closest(".chip-btn");
      if (!btn) return;
      const view = btn.getAttribute("data-user-view");
      const sort = btn.getAttribute("data-user-sort");
      if (view) state.usersQuickView = view;
      if (sort) state.usersQuickSort = sort;
      setActiveChip(usersQuickChips, "data-user-view", state.usersQuickView);
      setActiveChip(usersQuickChips, "data-user-sort", state.usersQuickSort);
      renderUsers();
    });
    setActiveChip(usersQuickChips, "data-user-view", state.usersQuickView);
    setActiveChip(usersQuickChips, "data-user-sort", state.usersQuickSort);
  }
  if (historyQuickChips) {
    historyQuickChips.addEventListener("click", (event) => {
      const btn = event.target.closest(".chip-btn");
      if (!btn) return;
      const filter = btn.getAttribute("data-history-filter");
      if (!filter) return;
      state.historyQuickFilter = filter;
      setActiveChip(historyQuickChips, "data-history-filter", state.historyQuickFilter);
      renderHistory();
    });
    setActiveChip(historyQuickChips, "data-history-filter", state.historyQuickFilter);
  }
  if (statsQuickChips) {
    statsQuickChips.addEventListener("click", (event) => {
      const btn = event.target.closest(".chip-btn");
      if (!btn) return;
      const view = btn.getAttribute("data-stats-view");
      if (!view) return;
      state.statsQuickView = view;
      setActiveChip(statsQuickChips, "data-stats-view", state.statsQuickView);
      renderDashboard();
    });
    setActiveChip(statsQuickChips, "data-stats-view", state.statsQuickView);
  }
  if (toggleDemarcheBtn) {
    toggleDemarcheBtn.addEventListener("click", toggleCurrentDemarche);
  }
  if (clearDemarchesBtn) {
    clearDemarchesBtn.addEventListener("click", clearAllDemarches);
  }
  if (contextToggleDemarche) {
    contextToggleDemarche.addEventListener("click", () => {
      if (contextMenuTarget) {
        setCurrentCommune(contextMenuTarget);
        updateInfo(contextMenuTarget);
      }
      toggleCurrentDemarche();
      hideContextMenu();
    });
  }

  applyPanelLayout({
    layout: getStoredPanelLayout(localStorage, PANEL_LAYOUT_STORAGE_KEY),
    persist: false,
    body: document.body,
    leftButton: toggleLeftPanelBtn,
    rightButton: toggleRightPanelBtn,
    storage: localStorage,
    storageKey: PANEL_LAYOUT_STORAGE_KEY,
  });
  if (toggleLeftPanelBtn) {
    toggleLeftPanelBtn.addEventListener("click", () => {
      const next = {
        leftCollapsed: !document.body.classList.contains("collapse-left"),
        rightCollapsed: document.body.classList.contains("collapse-right"),
      };
      applyPanelLayout({
        layout: next,
        persist: true,
        body: document.body,
        leftButton: toggleLeftPanelBtn,
        rightButton: toggleRightPanelBtn,
        storage: localStorage,
        storageKey: PANEL_LAYOUT_STORAGE_KEY,
      });
    });
  }
  if (toggleRightPanelBtn) {
    toggleRightPanelBtn.addEventListener("click", () => {
      const next = {
        leftCollapsed: document.body.classList.contains("collapse-left"),
        rightCollapsed: !document.body.classList.contains("collapse-right"),
      };
      applyPanelLayout({
        layout: next,
        persist: true,
        body: document.body,
        leftButton: toggleLeftPanelBtn,
        rightButton: toggleRightPanelBtn,
        storage: localStorage,
        storageKey: PANEL_LAYOUT_STORAGE_KEY,
      });
    });
  }

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undoLastAction();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redoLastAction();
      return;
    }
    if (event.key === "Escape") {
      hideContextMenu();
    }
    const tag = event.target.tagName || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

    if (event.key === "/") {
      event.preventDefault();
      if (searchInput) searchInput.focus();
      return;
    }
    if (event.key === "?") {
      event.preventDefault();
      setSyncStatus("Raccourcis: Ctrl/Cmd+Z annuler, Ctrl/Cmd+Y retablir, 1..9 secteur, / recherche", "ok");
      return;
    }

    if (/^[1-9]$/.test(event.key)) {
      sectorSelect.value = event.key;
      state.selectedSector = event.key;
    }
  });
  updateUndoRedoButtons();
}

function setSyncStatus(text, type) {
  applySyncStatus(syncStatus, text, type);
}

function initPanZoom(svg) {
  state.panZoom = initMapInteractions({
    svg,
    mapContainer,
    tooltip,
    findCommuneFromTarget,
    resolveCommuneFromEvent,
    showContextMenuForCommune,
    hideContextMenu,
    handleCommuneClick,
  });
}

async function loadSvg() {
  const response = await fetch(SVG_PATH);
  if (!response.ok) {
    mapContainer.innerHTML =
      "<div class='loading'>Impossible de charger le SVG.</div>";
    return;
  }

  const text = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) {
    mapContainer.innerHTML =
      "<div class='loading'>SVG introuvable.</div>";
    return;
  }

  mapContainer.innerHTML = "";
  mapContainer.appendChild(svg);
  state.svg = svg;

  const elements = svg.querySelectorAll("path, polygon, polyline");
  await buildIndex([...elements]);
  initPanZoom(svg);
  renderUsers();
  renderSuggestions(searchInput.value);
  initRealtime();
  applyFilters();
  updateLegendActive();
  updateSectorRequiredBadge();
  updateDemarcheButton();
  renderDashboard();
  updateUndoRedoButtons();
}

firestoreSync = createFirestoreSync({
  state,
  auth,
  db,
  refs: {
    metaDocRef,
    communesColRef,
    historyColRef,
    usersColRef,
  },
  firestoreApi: {
    onSnapshot,
    query,
    where,
    orderBy,
    limit,
    startAfter,
    getDocs,
    runTransaction,
    doc,
    setDoc,
    deleteDoc,
    serverTimestamp,
    deleteField,
  },
  authApi: {
    signInAnonymously,
    onAuthStateChanged,
  },
  helpers: {
    setSyncStatus,
    updateCurrentUserBadge,
    initPresence,
    initLockHeartbeat,
    applyLockVisuals,
    initPresenceListener,
    applyRemoteCommuneChanges,
    applyRemoteMetaState,
    scheduleSave,
    updateUndoRedoButtons,
    getHistoryWindowStartDate,
    applyHistorySnapshot,
    normalizeUserEntry,
    normalizeHistoryEntry,
    rebuildHistoryList,
    renderUsers,
    updateInfo,
    applyFilters,
    clonePlainData,
    serializeUsersById,
    deepEqualData,
    renderHistory,
  },
});

bindUI();
loadSvg();
