function safeReadJson(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

export function getStoredCollapsibleSections(storage, storageKey) {
  if (!storage || !storageKey) return {};
  try {
    return safeReadJson(storage.getItem(storageKey));
  } catch (err) {
    return {};
  }
}

export function persistCollapsibleSectionState(
  storage,
  storageKey,
  sectionName,
  isCollapsed
) {
  if (!storage || !storageKey || !sectionName) return;
  const current = getStoredCollapsibleSections(storage, storageKey);
  current[sectionName] = !!isCollapsed;
  storage.setItem(storageKey, JSON.stringify(current));
}

export function setCollapsibleSectionState(sectionEl, isCollapsed) {
  if (!sectionEl) return;
  sectionEl.classList.toggle("is-collapsed", !!isCollapsed);
  const toggleBtn = sectionEl.querySelector(".section-toggle");
  if (toggleBtn) {
    toggleBtn.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
  }
}

export function initCollapsibleSections(documentRef, options = {}) {
  if (!documentRef) return;
  const {
    storage = null,
    storageKey = "",
    defaultCollapsed = true,
  } = options;
  const stored = getStoredCollapsibleSections(storage, storageKey);

  documentRef
    .querySelectorAll(".collapsible-section[data-collapsible]")
    .forEach((sectionEl) => {
      const sectionName = sectionEl.getAttribute("data-collapsible") || "";
      if (!sectionName) return;
      const hasStored = Object.prototype.hasOwnProperty.call(stored, sectionName);
      const initialCollapsed = hasStored ? !!stored[sectionName] : !!defaultCollapsed;
      setCollapsibleSectionState(sectionEl, initialCollapsed);
      const toggleBtn = sectionEl.querySelector(".section-toggle");
      if (!toggleBtn) return;
      toggleBtn.addEventListener("click", () => {
        const nextCollapsed = !sectionEl.classList.contains("is-collapsed");
        setCollapsibleSectionState(sectionEl, nextCollapsed);
        persistCollapsibleSectionState(
          storage,
          storageKey,
          sectionName,
          nextCollapsed
        );
      });
    });
}
