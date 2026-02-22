import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

let testEnv;
const AUTH_UID = "uid-test-1";

describe("Firestore rules", () => {
  beforeAll(async () => {
    const rules = readFileSync(resolve("ui/firestore.rules"), "utf8");
    testEnv = await initializeTestEnvironment({
      projectId: "demo-vendee-maps",
      firestore: {
        rules,
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it("autorise un write meta valide pour utilisateur authentifié", async () => {
    const ctx = testEnv.authenticatedContext(AUTH_UID);
    const db = ctx.firestore();
    await assertSucceeds(
      setDoc(doc(db, "vendee", "state"), {
        historyById: {
          "h_1700000000000_abcd12": { user: "Alice", action: "test", time: "10:00:00" },
        },
        locks: { "85001": { by: "Alice", at: 1700000000000 } },
        version: 1,
        updatedAt: new Date(),
        clientUpdatedAt: 1700000000000,
        clientWriteId: "write-1",
      })
    );
  });

  it("refuse un champ interdit dans meta", async () => {
    const ctx = testEnv.authenticatedContext(AUTH_UID);
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "vendee", "state"), {
        sectors: { "85001": "1" },
        clientUpdatedAt: 1700000000000,
        clientWriteId: "write-1",
      })
    );
  });

  it("refuse une version meta invalide", async () => {
    const ctx = testEnv.authenticatedContext(AUTH_UID);
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "vendee", "state"), {
        locks: {},
        version: -1,
        clientUpdatedAt: 1700000000000,
        clientWriteId: "write-1",
      })
    );
  });

  it("autorise un document commune valide", async () => {
    const ctx = testEnv.authenticatedContext(AUTH_UID);
    const db = ctx.firestore();
    await assertSucceeds(
      setDoc(doc(db, "vendee_communes", "85001"), {
        sector: "1",
        owner: "Alice",
        demarche: { by: "Alice", at: "1700000000000" },
        updatedAt: new Date(),
        updatedBy: "Alice",
      })
    );
  });

  it("autorise un document utilisateur valide", async () => {
    const ctx = testEnv.authenticatedContext(AUTH_UID);
    const db = ctx.firestore();
    await assertSucceeds(
      setDoc(doc(db, "vendee_users", "u_abc12345"), {
        name: "Alice",
        sectors: [1, 2],
        anchorCode: "85001",
        anchorName: "La Roche-sur-Yon",
        anchorLat: 46.67,
        anchorLon: -1.43,
      })
    );
  });

  it("refuse un document utilisateur invalide", async () => {
    const ctx = testEnv.authenticatedContext(AUTH_UID);
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "vendee_users", "bad-id"), {
        name: "",
        sectors: [12],
      })
    );
  });

  it("autorise un event historique valide", async () => {
    const ctx = testEnv.authenticatedContext(AUTH_UID);
    const db = ctx.firestore();
    await assertSucceeds(
      setDoc(doc(db, "vendee_history", "h_1700000000000_abcd12"), {
        time: "10:00:00",
        user: "Alice",
        action: "Affectation",
        createdAt: new Date(),
        clientCreatedAt: 1700000000000,
      })
    );
  });

  it("refuse un event historique invalide", async () => {
    const ctx = testEnv.authenticatedContext(AUTH_UID);
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "vendee_history", "bad-id"), {
        action: "Affectation",
        createdAt: new Date(),
      })
    );
  });

  it("refuse un document commune invalide (sector hors 1..9)", async () => {
    const ctx = testEnv.authenticatedContext(AUTH_UID);
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "vendee_communes", "85001"), {
        sector: "12",
        owner: "Alice",
        updatedAt: new Date(),
        updatedBy: "Alice",
      })
    );
  });

  it("refuse un code commune invalide", async () => {
    const ctx = testEnv.authenticatedContext(AUTH_UID);
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "vendee_communes", "ABC"), {
        sector: "1",
        updatedAt: new Date(),
        updatedBy: "Alice",
      })
    );
  });

  it("presence: autorise écriture sur son uid et refuse sur un autre", async () => {
    const mine = testEnv.authenticatedContext(AUTH_UID);
    const mineDb = mine.firestore();
    await assertSucceeds(
      setDoc(doc(mineDb, "vendee_presence", AUTH_UID), {
        name: "Mine",
        lastSeen: new Date(),
      })
    );

    const other = testEnv.authenticatedContext("uid-other");
    const otherDb = other.firestore();
    await assertFails(
      setDoc(doc(otherDb, "vendee_presence", AUTH_UID), {
        name: "Hack",
        lastSeen: new Date(),
      })
    );
  });

  it("profile: autorise création/maj sur son uid", async () => {
    const mine = testEnv.authenticatedContext(AUTH_UID);
    const mineDb = mine.firestore();
    await assertSucceeds(
      setDoc(doc(mineDb, "vendee_profiles", AUTH_UID), {
        displayName: "Micka",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    );
  });

  it("profile: refuse écriture sur un autre uid", async () => {
    const mine = testEnv.authenticatedContext(AUTH_UID);
    const mineDb = mine.firestore();
    await assertFails(
      setDoc(doc(mineDb, "vendee_profiles", "uid-test-2"), {
        displayName: "Hack",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    );
  });

  it("refuse lecture anonyme", async () => {
    const anon = testEnv.unauthenticatedContext();
    const db = anon.firestore();
    await assertFails(getDoc(doc(db, "vendee", "state")));
  });

  it("autorise lecture authentifiée", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "vendee", "state"), {
        historyById: {},
        locks: {},
        version: 1,
        updatedAt: new Date(),
        clientUpdatedAt: 1700000000000,
        clientWriteId: "seed-1",
      });
    });
    const authed = testEnv.authenticatedContext(AUTH_UID);
    await expect(assertSucceeds(getDoc(doc(authed.firestore(), "vendee", "state")))).resolves.toBeDefined();
  });

  it("refuse lecture utilisateur non autorisé", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "vendee", "state"), {
        historyById: {},
        locks: {},
        version: 1,
        updatedAt: new Date(),
        clientUpdatedAt: 1700000000000,
        clientWriteId: "seed-2",
      });
    });
    const authed = testEnv.authenticatedContext("uid-not-allowed");
    await assertFails(getDoc(doc(authed.firestore(), "vendee", "state")));
  });
});
