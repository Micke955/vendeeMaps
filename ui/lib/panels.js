import { initCollapsibleSections as initCollapsibleSectionsUI } from "./collapsible-sections.js";

export function getStoredPanelLayout(storage, storageKey) {
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return { leftCollapsed: false, rightCollapsed: false };
    const parsed = JSON.parse(raw);
    return {
      leftCollapsed: !!parsed.leftCollapsed,
      rightCollapsed: !!parsed.rightCollapsed,
    };
  } catch (err) {
    return { leftCollapsed: false, rightCollapsed: false };
  }
}

export function updatePanelToggleButtons(body, leftButton, rightButton) {
  if (leftButton) {
    const collapsed = body.classList.contains("collapse-left");
    leftButton.textContent = collapsed ? "Afficher gauche" : "Masquer gauche";
  }
  if (rightButton) {
    const collapsed = body.classList.contains("collapse-right");
    rightButton.textContent = collapsed ? "Afficher droite" : "Masquer droite";
  }
}

export function applyPanelLayout({
  layout,
  persist = false,
  body,
  leftButton,
  rightButton,
  storage,
  storageKey,
}) {
  const leftCollapsed = !!(layout && layout.leftCollapsed);
  const rightCollapsed = !!(layout && layout.rightCollapsed);
  body.classList.toggle("collapse-left", leftCollapsed);
  body.classList.toggle("collapse-right", rightCollapsed);
  updatePanelToggleButtons(body, leftButton, rightButton);
  if (persist) {
    storage.setItem(
      storageKey,
      JSON.stringify({ leftCollapsed, rightCollapsed })
    );
  }
}

export function initCollapsibleSections(documentRef, options) {
  initCollapsibleSectionsUI(documentRef, options);
}
