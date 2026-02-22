export function createFirestoreSync({
  state,
  auth,
  db,
  refs,
  firestoreApi,
  authApi,
  helpers,
}) {
  const {
    metaDocRef,
    communesColRef,
    historyColRef,
    usersColRef,
  } = refs;

  const {
    onSnapshot,
    query,
    where,
    orderBy,
    limit,
    startAfter,
    getDocs,
    runTransaction,
    doc,
    setDoc,
    deleteDoc,
    serverTimestamp,
    deleteField,
  } = firestoreApi;

  const { signInAnonymously, onAuthStateChanged } = authApi;

  const {
    setSyncStatus,
    updateCurrentUserBadge,
    initPresence,
    initLockHeartbeat,
    applyLockVisuals,
    initPresenceListener,
    applyRemoteCommuneChanges,
    applyRemoteMetaState,
    scheduleSave,
    updateUndoRedoButtons,
    getHistoryWindowStartDate,
    applyHistorySnapshot,
    normalizeUserEntry,
    normalizeHistoryEntry,
    rebuildHistoryList,
    renderUsers,
    updateInfo,
    applyFilters,
    clonePlainData,
    serializeUsersById,
    deepEqualData,
  } = helpers;

  function initHistoryListener() {
    if (state.historyUnsub) state.historyUnsub();
    state.historyById = {};
    state.history = [];
    state.historyCursor = null;
    state.historyHasMore = true;
    state.historyLoadingMore = false;
    helpers.renderHistory();

    const historyQuery = query(
      historyColRef,
      where("createdAt", ">=", getHistoryWindowStartDate()),
      orderBy("createdAt", "desc"),
      limit(state.historyPageSize)
    );
    state.historyUnsub = onSnapshot(
      historyQuery,
      (snapshot) => {
        applyHistorySnapshot(snapshot);
      },
      (err) => {
        console.error("Firebase history snapshot error:", err);
        setSyncStatus("Erreur synchro historique", "error");
      }
    );
  }

  function initUsersListener() {
    state.remoteUsersState = new Map();
    state.usersUnsub = onSnapshot(
      usersColRef,
      (snapshot) => {
        state.isApplyingRemote = true;
        snapshot.docChanges().forEach((change) => {
          if (change.doc.metadata.hasPendingWrites) return;
          const userId = change.doc.id;
          if (change.type === "removed") {
            state.remoteUsersState.delete(userId);
            return;
          }
          const normalized = normalizeUserEntry(change.doc.data() || {}, userId);
          if (!normalized) return;
          state.remoteUsersState.set(userId, normalized);
        });
        state.users = Array.from(state.remoteUsersState.values());
        renderUsers();
        if (state.current) updateInfo(state.current);
        state.isApplyingRemote = false;
        applyFilters();
      },
      (err) => {
        console.error("Firebase users snapshot error:", err);
        setSyncStatus("Erreur synchro utilisateurs", "error");
      }
    );
  }

  function initRealtime() {
    signInAnonymously(auth).catch((err) => {
      console.error("Firebase auth error:", err);
      setSyncStatus("Auth Firebase refusée", "error");
    });

    onAuthStateChanged(auth, (user) => {
      if (!user) return;
      state.authReady = true;
      setSyncStatus("Connecté", "ok");
      updateCurrentUserBadge();
      initPresence();
      initLockHeartbeat();
      if (state.collabRefreshTimer) clearInterval(state.collabRefreshTimer);
      state.collabRefreshTimer = setInterval(() => {
        applyLockVisuals();
      }, 10000);
      initPresenceListener();
      initHistoryListener();

      if (state.metaUnsub) state.metaUnsub();
      if (state.communesUnsub) state.communesUnsub();
      if (state.usersUnsub) state.usersUnsub();
      initUsersListener();

      state.communesUnsub = onSnapshot(
        communesColRef,
        (snapshot) => {
          applyRemoteCommuneChanges(snapshot);
          state.remoteReady = true;
          if (state.pendingSave) scheduleSave();
        },
        (err) => {
          console.error("Firebase communes snapshot error:", err);
          setSyncStatus("Erreur synchro communes", "error");
        }
      );

      state.metaUnsub = onSnapshot(
        metaDocRef,
        (snapshot) => {
          if (!snapshot.exists()) {
            state.remoteMetaVersion = 0;
            state.remoteReady = true;
            if (state.pendingSave) scheduleSave();
            return;
          }
          if (snapshot.metadata.hasPendingWrites) {
            return;
          }
          const incoming = snapshot.data() || {};
          if (
            state.lastWriteId &&
            incoming.clientWriteId !== state.lastWriteId &&
            (incoming.clientUpdatedAt || 0) < state.lastWriteAt
          ) {
            return;
          }
          const isOwnWrite =
            !!incoming.clientWriteId && incoming.clientWriteId === state.lastWriteId;
          if (isOwnWrite) {
            state.lastWriteId = null;
          }
          applyRemoteMetaState(incoming);
          state.remoteReady = true;
          if (state.pendingSave) scheduleSave();
          if (state.syncStatusTimer) clearTimeout(state.syncStatusTimer);
          if (isOwnWrite) {
            setSyncStatus("Synchronisé", "ok");
          } else {
            state.undoStack = [];
            state.redoStack = [];
            updateUndoRedoButtons();
            setSyncStatus("Mise a jour distante recue", "ok");
            state.syncStatusTimer = setTimeout(() => {
              setSyncStatus("Synchronisé", "ok");
            }, 1800);
          }
        },
        (err) => {
          console.error("Firebase meta snapshot error:", err);
          setSyncStatus("Erreur de synchro", "error");
        }
      );
    });
  }

  async function saveMetaState() {
    const writeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    state.lastWriteId = writeId;
    state.lastWriteAt = Date.now();
    const locks = clonePlainData(state.locks);
    const expectedVersion = Number.isInteger(state.remoteMetaVersion)
      ? state.remoteMetaVersion
      : 0;
    let committedVersion = expectedVersion;
    try {
      await runTransaction(db, async (tx) => {
        const snapshot = await tx.get(metaDocRef);
        const current = snapshot.exists() ? (snapshot.data() || {}) : {};
        const currentVersion =
          Number.isInteger(current.version) && current.version >= 0
            ? current.version
            : 0;
        if (currentVersion !== expectedVersion) {
          const conflict = new Error("stale-version");
          conflict.code = "conflict-version";
          throw conflict;
        }
        committedVersion = currentVersion + 1;
        tx.set(
          metaDocRef,
          {
            locks,
            usersById: deleteField(),
            historyById: deleteField(),
            updatedAt: serverTimestamp(),
            clientUpdatedAt: state.lastWriteAt,
            clientWriteId: writeId,
            version: committedVersion,
          },
          { merge: true }
        );
      });
    } catch (err) {
      const code = err && err.code ? String(err.code) : "";
      const message = err && err.message ? String(err.message) : "";
      if (code === "conflict-version" || message.includes("stale-version")) {
        const conflict = new Error("Version distante modifiee");
        conflict.code = "conflict-version";
        throw conflict;
      }
      throw err;
    }
    state.remoteLocks = clonePlainData(locks);
    state.remoteMetaVersion = committedVersion;
  }

  async function saveUsersState() {
    const desired = new Map(Object.entries(serializeUsersById(state.users)));
    const operations = [];
    const ids = new Set([
      ...Array.from(state.remoteUsersState.keys()),
      ...Array.from(desired.keys()),
    ]);

    ids.forEach((id) => {
      const remote = state.remoteUsersState.get(id) || null;
      const local = desired.get(id) || null;
      if (!local && remote) {
        operations.push({ type: "delete", id });
        return;
      }
      if (local && !remote) {
        operations.push({ type: "set", id, data: local });
        return;
      }
      if (local && remote && !deepEqualData(local, serializeUsersById([remote])[id])) {
        operations.push({ type: "set", id, data: local });
      }
    });

    if (!operations.length) return { writes: 0 };
    for (const op of operations) {
      const ref = doc(usersColRef, op.id);
      if (op.type === "delete") {
        await deleteDoc(ref);
      } else {
        await setDoc(ref, op.data);
      }
    }
    return { writes: operations.length };
  }

  async function loadMoreHistory() {
    if (!state.authReady || state.historyLoadingMore || !state.historyHasMore || !state.historyCursor) {
      return;
    }
    state.historyLoadingMore = true;
    helpers.renderHistory();
    try {
      const olderQuery = query(
        historyColRef,
        where("createdAt", ">=", getHistoryWindowStartDate()),
        orderBy("createdAt", "desc"),
        startAfter(state.historyCursor),
        limit(state.historyPageSize)
      );
      const snapshot = await getDocs(olderQuery);
      if (snapshot.docs.length) {
        state.historyCursor = snapshot.docs[snapshot.docs.length - 1];
        snapshot.docs.forEach((docSnap) => {
          const normalized = normalizeHistoryEntry(docSnap.data() || {}, docSnap.id);
          if (normalized) state.historyById[docSnap.id] = normalized;
        });
        rebuildHistoryList();
      }
      state.historyHasMore = snapshot.docs.length >= state.historyPageSize;
    } finally {
      state.historyLoadingMore = false;
      helpers.renderHistory();
    }
  }

  return {
    initRealtime,
    saveMetaState,
    saveUsersState,
    loadMoreHistory,
  };
}
