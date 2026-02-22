export function initActionsMenu(documentRef, detailsElement) {
  if (!documentRef || !detailsElement) return () => {};
  const summary = detailsElement.querySelector("summary");
  if (!summary) return () => {};

  const setExpanded = () => {
    summary.setAttribute("aria-expanded", detailsElement.open ? "true" : "false");
  };

  const closeMenu = () => {
    detailsElement.open = false;
    setExpanded();
  };

  setExpanded();

  const onToggle = () => {
    setExpanded();
  };
  const onDocClick = (event) => {
    if (!detailsElement.open) return;
    if (detailsElement.contains(event.target)) return;
    closeMenu();
  };
  const onKeyDown = (event) => {
    if (event.key !== "Escape" || !detailsElement.open) return;
    closeMenu();
  };

  detailsElement.addEventListener("toggle", onToggle);
  documentRef.addEventListener("click", onDocClick);
  documentRef.addEventListener("keydown", onKeyDown);

  return () => {
    detailsElement.removeEventListener("toggle", onToggle);
    documentRef.removeEventListener("click", onDocClick);
    documentRef.removeEventListener("keydown", onKeyDown);
  };
}
