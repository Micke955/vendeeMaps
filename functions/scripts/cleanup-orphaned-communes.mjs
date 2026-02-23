import admin from "firebase-admin";

function parseArgs(argv) {
  const args = { apply: false, projectId: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--apply") {
      args.apply = true;
      continue;
    }
    if (value === "--project" && i + 1 < argv.length) {
      args.projectId = String(argv[i + 1] || "").trim();
      i += 1;
    }
  }
  return args;
}

function hasSector(data) {
  return !!(data && typeof data.sector === "string" && data.sector.trim());
}

function hasOwner(data) {
  return !!(data && typeof data.owner === "string" && data.owner.trim());
}

async function run() {
  const { apply, projectId } = parseArgs(process.argv.slice(2));

  if (!admin.apps.length) {
    const options = {};
    if (projectId) options.projectId = projectId;
    admin.initializeApp(options);
  }

  const db = admin.firestore();
  const fieldDelete = admin.firestore.FieldValue.delete();
  const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
  const collectionRef = db.collection("vendee_communes");

  let cursor = null;
  let scanned = 0;
  let candidates = 0;
  let pendingUpdates = 0;
  let totalUpdated = 0;
  const sampleIds = [];

  while (true) {
    let query = collectionRef.orderBy(admin.firestore.FieldPath.documentId()).limit(500);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    if (snap.empty) break;

    const batch = db.batch();

    snap.docs.forEach((docSnap) => {
      scanned += 1;
      const data = docSnap.data() || {};
      if (!hasSector(data) || hasOwner(data)) return;

      candidates += 1;
      if (sampleIds.length < 15) sampleIds.push(docSnap.id);
      if (!apply) return;

      batch.update(docSnap.ref, {
        sector: fieldDelete,
        owner: fieldDelete,
        demarche: fieldDelete,
        updatedBy: "system-cleanup",
        updatedAt: serverTimestamp,
      });
      pendingUpdates += 1;
    });

    if (apply && pendingUpdates > 0) {
      await batch.commit();
      totalUpdated += pendingUpdates;
      pendingUpdates = 0;
    }

    cursor = snap.docs[snap.docs.length - 1];
  }

  console.log(`[cleanup] scanned: ${scanned}`);
  console.log(`[cleanup] orphaned (sector without owner): ${candidates}`);
  if (sampleIds.length) {
    console.log(`[cleanup] sample ids: ${sampleIds.join(", ")}`);
  }

  if (!apply) {
    console.log("[cleanup] dry-run complete. Re-run with --apply to write changes.");
  } else {
    console.log(`[cleanup] apply complete. updated: ${totalUpdated}`);
  }
}

run().catch((err) => {
  console.error("[cleanup] failed:", err);
  process.exitCode = 1;
});
