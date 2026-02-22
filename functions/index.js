import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";

initializeApp();

const HISTORY_COLLECTION = "vendee_history";
const RETENTION_DAYS = 90;
const DELETE_BATCH_SIZE = 400;

function getCutoffDate() {
  return new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export const purgeOldVendeeHistory = onSchedule(
  {
    schedule: "every day 03:00",
    timeZone: "Europe/Paris",
    retryCount: 2,
    memory: "256MiB",
    timeoutSeconds: 540,
  },
  async () => {
    const db = getFirestore();
    const cutoff = getCutoffDate();
    let totalDeleted = 0;

    while (true) {
      const snapshot = await db
        .collection(HISTORY_COLLECTION)
        .where("createdAt", "<", cutoff)
        .limit(DELETE_BATCH_SIZE)
        .get();

      if (snapshot.empty) break;

      const batch = db.batch();
      snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
      await batch.commit();
      totalDeleted += snapshot.size;
    }

    logger.info("vendee_history retention purge completed", {
      retentionDays: RETENTION_DAYS,
      deletedDocs: totalDeleted,
      cutoffISO: cutoff.toISOString(),
    });
  }
);
