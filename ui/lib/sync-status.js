export function applySyncStatus(target, text, type) {
  if (!target) return;
  target.textContent = text;
  target.classList.remove("ok", "error", "pending");
  if (type) target.classList.add(type);
}
