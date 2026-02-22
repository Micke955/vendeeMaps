import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import {
  getStoredCollapsibleSections,
  initCollapsibleSections,
} from "../../ui/lib/collapsible-sections.js";

const STORAGE_KEY = "vendee.collapsibleSections";

function createDom() {
  return new JSDOM(
    `<!doctype html>
    <html>
      <body>
        <div class="collapsible-section" data-collapsible="history">
          <button class="section-toggle" aria-expanded="true" type="button"></button>
          <div class="collapsible-content"></div>
        </div>
        <div class="collapsible-section" data-collapsible="legend">
          <button class="section-toggle" aria-expanded="true" type="button"></button>
          <div class="collapsible-content"></div>
        </div>
      </body>
    </html>`,
    { url: "http://localhost" }
  );
}

describe("collapsible sections", () => {
  let dom;
  let documentRef;
  let storage;

  beforeEach(() => {
    dom = createDom();
    documentRef = dom.window.document;
    storage = dom.window.localStorage;
    storage.clear();
  });

  it("replie toutes les sections au premier chargement", () => {
    initCollapsibleSections(documentRef, {
      storage,
      storageKey: STORAGE_KEY,
      defaultCollapsed: true,
    });

    const sections = [...documentRef.querySelectorAll(".collapsible-section")];
    sections.forEach((section) => {
      expect(section.classList.contains("is-collapsed")).toBe(true);
      const toggle = section.querySelector(".section-toggle");
      expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    });
  });

  it("respecte l'etat stocke en localStorage", () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ history: false, legend: true })
    );

    initCollapsibleSections(documentRef, {
      storage,
      storageKey: STORAGE_KEY,
      defaultCollapsed: true,
    });

    const history = documentRef.querySelector('[data-collapsible="history"]');
    const legend = documentRef.querySelector('[data-collapsible="legend"]');
    expect(history?.classList.contains("is-collapsed")).toBe(false);
    expect(
      history?.querySelector(".section-toggle")?.getAttribute("aria-expanded")
    ).toBe("true");
    expect(legend?.classList.contains("is-collapsed")).toBe(true);
    expect(
      legend?.querySelector(".section-toggle")?.getAttribute("aria-expanded")
    ).toBe("false");
  });

  it("persiste le toggle utilisateur et met a jour aria-expanded", () => {
    initCollapsibleSections(documentRef, {
      storage,
      storageKey: STORAGE_KEY,
      defaultCollapsed: true,
    });

    const history = documentRef.querySelector('[data-collapsible="history"]');
    const toggle = history?.querySelector(".section-toggle");
    expect(history?.classList.contains("is-collapsed")).toBe(true);
    toggle?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

    expect(history?.classList.contains("is-collapsed")).toBe(false);
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(getStoredCollapsibleSections(storage, STORAGE_KEY)).toEqual({
      history: false,
    });
  });
});
