import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import {
  normalizeUserName,
  normalizeRemoteCommuneDoc,
  communeDocEquals,
  diffCommuneState,
  createUserIdentityBlock,
} from "../../ui/lib/state-utils.js";

describe("state-utils sanitization", () => {
  it("normalise un nom utilisateur", () => {
    expect(normalizeUserName("  élise d'Ártois !!  ")).toBe("Elise dArtois");
  });

  it("limite la taille à 40 caractères", () => {
    const longName = "a".repeat(100);
    expect(normalizeUserName(longName)).toHaveLength(40);
  });

  it("retourne vide si rien d'utile", () => {
    expect(normalizeUserName("   !!!   ")).toBe("");
  });
});

describe("state-utils merge logic", () => {
  it("normalise un document commune distant valide", () => {
    const normalized = normalizeRemoteCommuneDoc({
      sector: "3",
      owner: "Alice",
      demarche: { by: "Alice", at: "1700000000" },
    });
    expect(normalized).toEqual({
      sector: "3",
      owner: "Alice",
      demarcheBy: "Alice",
      demarcheAt: "1700000000",
    });
  });

  it("rejette un document commune vide", () => {
    expect(normalizeRemoteCommuneDoc({ sector: "X" })).toBeNull();
  });

  it("compare correctement deux états commune", () => {
    const a = { sector: "1", owner: "A", demarcheBy: "", demarcheAt: "" };
    const b = { sector: "1", owner: "A", demarcheBy: "", demarcheAt: "" };
    expect(communeDocEquals(a, b)).toBe(true);
    expect(communeDocEquals(a, null)).toBe(false);
  });

  it("produit un diff minimal set/delete", () => {
    const remote = new Map([
      ["85001", { sector: "1", owner: "A", demarcheBy: "", demarcheAt: "" }],
      ["85002", { sector: "2", owner: "B", demarcheBy: "", demarcheAt: "" }],
    ]);
    const desired = new Map([
      ["85001", { sector: "1", owner: "A", demarcheBy: "", demarcheAt: "" }], // identique
      ["85003", { sector: "3", owner: "C", demarcheBy: "", demarcheAt: "" }], // nouveau
    ]);
    const ops = diffCommuneState(remote, desired);
    expect(ops).toHaveLength(2);
    expect(ops).toEqual(
      expect.arrayContaining([
        { type: "delete", code: "85002" },
        {
          type: "set",
          code: "85003",
          data: { sector: "3", owner: "C", demarcheBy: "", demarcheAt: "" },
        },
      ])
    );
  });
});

describe("state-utils rendering safety", () => {
  it("utilise textContent pour éviter l'injection HTML", () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const block = createUserIdentityBlock(
      dom.window.document,
      "<img src=x onerror=alert(1)>",
      "<b>secteur</b>"
    );
    expect(block.querySelector(".user-name")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(block.querySelector(".user-name")?.innerHTML).toBe("&lt;img src=x onerror=alert(1)&gt;");
    expect(block.querySelector(".user-sectors-text")?.textContent).toBe("<b>secteur</b>");
  });
});
