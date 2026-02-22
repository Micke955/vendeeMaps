export function normalizeUserName(value) {
  let raw = (value || "").trim();
  if (!raw) return "";
  raw = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  raw = raw.replace(/[^a-zA-Z0-9\s-]/g, "");
  raw = raw.replace(/\s+/g, " ").trim();
  if (!raw) return "";
  if (raw.length > 40) raw = raw.slice(0, 40).trim();
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function normalizeRemoteCommuneDoc(data) {
  if (!data || typeof data !== "object") return null;
  const sectorRaw =
    data.sector === undefined || data.sector === null
      ? ""
      : String(data.sector).trim();
  const ownerRaw =
    data.owner === undefined || data.owner === null
      ? ""
      : String(data.owner).trim();
  const demarche =
    data.demarche && typeof data.demarche === "object" ? data.demarche : null;
  const demarcheBy =
    demarche && demarche.by !== undefined && demarche.by !== null
      ? String(demarche.by).trim()
      : "";
  const demarcheAt =
    demarche && demarche.at !== undefined && demarche.at !== null
      ? String(demarche.at)
      : "";
  const sector = /^[1-9]$/.test(sectorRaw) ? sectorRaw : "";
  const owner = ownerRaw;
  if (!sector && !owner && !demarcheBy) return null;
  return {
    sector,
    owner,
    demarcheBy,
    demarcheAt,
  };
}

export function communeDocEquals(a, b) {
  const left = a || null;
  const right = b || null;
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    (left.sector || "") === (right.sector || "") &&
    (left.owner || "") === (right.owner || "") &&
    (left.demarcheBy || "") === (right.demarcheBy || "") &&
    (left.demarcheAt || "") === (right.demarcheAt || "")
  );
}

export function diffCommuneState(remoteState, desiredState) {
  const allCodes = new Set([...remoteState.keys(), ...desiredState.keys()]);
  const operations = [];
  allCodes.forEach((code) => {
    const before = remoteState.get(code) || null;
    const after = desiredState.get(code) || null;
    if (communeDocEquals(before, after)) return;
    if (!after) {
      operations.push({ type: "delete", code });
      return;
    }
    operations.push({ type: "set", code, data: after });
  });
  return operations;
}

export function createUserIdentityBlock(doc, name, subtitle = "") {
  const root = doc.createElement("div");
  const nameEl = doc.createElement("div");
  nameEl.className = "user-name";
  nameEl.textContent = name;
  root.appendChild(nameEl);
  if (subtitle) {
    const subtitleEl = doc.createElement("div");
    subtitleEl.className = "user-sectors-text";
    subtitleEl.textContent = subtitle;
    root.appendChild(subtitleEl);
  }
  return root;
}
