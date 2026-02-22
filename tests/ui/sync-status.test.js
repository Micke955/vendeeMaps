import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { applySyncStatus } from "../../ui/lib/sync-status.js";

describe("sync status badge", () => {
  it("applique pending/ok/error avec texte", () => {
    const dom = new JSDOM(`<!doctype html><div id="syncStatus"></div>`);
    const el = dom.window.document.getElementById("syncStatus");

    applySyncStatus(el, "En cours…", "pending");
    expect(el?.textContent).toBe("En cours…");
    expect(el?.classList.contains("pending")).toBe(true);

    applySyncStatus(el, "Synchronisé", "ok");
    expect(el?.classList.contains("pending")).toBe(false);
    expect(el?.classList.contains("ok")).toBe(true);

    applySyncStatus(el, "Erreur de synchro", "error");
    expect(el?.classList.contains("ok")).toBe(false);
    expect(el?.classList.contains("error")).toBe(true);
  });
});
