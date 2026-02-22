import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { initActionsMenu } from "../../ui/lib/actions-menu.js";

function createDom() {
  return new JSDOM(
    `<!doctype html>
    <html>
      <body>
        <details class="actions-more">
          <summary class="btn ghost" aria-label="Afficher les actions secondaires">Plus</summary>
          <div class="actions-more-menu">
            <button id="exportPdfReportBtn" type="button">Exporter rapport</button>
            <button id="exportCsvBtn" type="button">Exporter CSV</button>
            <button id="resetBtn" type="button">Reset</button>
          </div>
        </details>
        <button id="outside" type="button">Outside</button>
      </body>
    </html>`,
    { url: "http://localhost" }
  );
}

describe("actions menu", () => {
  it("initialise aria-expanded et expose les actions secondaires", () => {
    const dom = createDom();
    const documentRef = dom.window.document;
    const details = documentRef.querySelector(".actions-more");
    const dispose = initActionsMenu(documentRef, details);

    const summary = details?.querySelector("summary");
    expect(summary?.getAttribute("aria-expanded")).toBe("false");
    expect(details?.querySelector("#exportPdfReportBtn")).toBeTruthy();
    expect(details?.querySelector("#exportCsvBtn")).toBeTruthy();
    expect(details?.querySelector("#resetBtn")).toBeTruthy();

    dispose();
  });

  it("ferme le menu sur Escape et clic extérieur", () => {
    const dom = createDom();
    const documentRef = dom.window.document;
    const details = documentRef.querySelector(".actions-more");
    const summary = details?.querySelector("summary");
    initActionsMenu(documentRef, details);

    details.open = true;
    details.dispatchEvent(new dom.window.Event("toggle"));
    expect(summary?.getAttribute("aria-expanded")).toBe("true");

    documentRef.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
    expect(details.open).toBe(false);
    expect(summary?.getAttribute("aria-expanded")).toBe("false");

    details.open = true;
    details.dispatchEvent(new dom.window.Event("toggle"));
    documentRef
      .getElementById("outside")
      ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    expect(details.open).toBe(false);
    expect(summary?.getAttribute("aria-expanded")).toBe("false");
  });
});
