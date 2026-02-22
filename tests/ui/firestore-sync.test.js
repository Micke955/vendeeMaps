import { describe, it, expect, vi } from "vitest";
import { createFirestoreSync } from "../../ui/lib/firestore-sync.js";

function createBase() {
  const state = {
    authReady: false,
    pendingSave: false,
    remoteReady: false,
    collabRefreshTimer: null,
    historyUnsub: null,
    communesUnsub: null,
    usersUnsub: null,
    metaUnsub: null,
    remoteMetaVersion: 0,
    lastWriteId: null,
    lastWriteAt: 0,
    syncStatusTimer: null,
    undoStack: [1],
    redoStack: [2],
    historyById: {},
    history: [],
    historyCursor: { id: "cursor-0" },
    historyHasMore: true,
    historyLoadingMore: false,
    historyPageSize: 2,
    remoteUsersState: new Map(),
    users: [],
    current: null,
    isApplyingRemote: false,
    locks: {},
  };

  const auth = {};
  const db = {};
  const refs = {
    metaDocRef: { key: "meta" },
    communesColRef: { key: "communes" },
    historyColRef: { key: "history" },
    usersColRef: { key: "users" },
  };

  const listeners = new Map();
  const firestoreApi = {
    onSnapshot: vi.fn((ref, onNext) => {
      listeners.set(ref.key, onNext);
      return vi.fn();
    }),
    query: vi.fn((...args) => ({ args })),
    where: vi.fn((...args) => ({ type: "where", args })),
    orderBy: vi.fn((...args) => ({ type: "orderBy", args })),
    limit: vi.fn((v) => ({ type: "limit", value: v })),
    startAfter: vi.fn((cursor) => ({ type: "startAfter", cursor })),
    getDocs: vi.fn(async () => ({ docs: [] })),
    runTransaction: vi.fn(),
    doc: vi.fn(),
    setDoc: vi.fn(),
    deleteDoc: vi.fn(),
    serverTimestamp: vi.fn(() => ({ ts: true })),
    deleteField: vi.fn(() => ({ del: true })),
  };

  const authApi = {
    signInAnonymously: vi.fn(() => Promise.resolve()),
    onAuthStateChanged: vi.fn((_authRef, cb) => cb({ uid: "uid-1" })),
  };

  const helpers = {
    setSyncStatus: vi.fn(),
    updateCurrentUserBadge: vi.fn(),
    initPresence: vi.fn(),
    initLockHeartbeat: vi.fn(),
    applyLockVisuals: vi.fn(),
    initPresenceListener: vi.fn(),
    applyRemoteCommuneChanges: vi.fn(),
    applyRemoteMetaState: vi.fn(),
    scheduleSave: vi.fn(),
    updateUndoRedoButtons: vi.fn(),
    getHistoryWindowStartDate: vi.fn(() => new Date("2026-01-01T00:00:00Z")),
    applyHistorySnapshot: vi.fn(),
    normalizeUserEntry: vi.fn(),
    normalizeHistoryEntry: vi.fn((raw, id) => ({ _id: id, ...raw })),
    rebuildHistoryList: vi.fn(),
    renderUsers: vi.fn(),
    updateInfo: vi.fn(),
    applyFilters: vi.fn(),
    clonePlainData: vi.fn((v) => JSON.parse(JSON.stringify(v || {}))),
    serializeUsersById: vi.fn(() => ({})),
    deepEqualData: vi.fn(() => true),
    renderHistory: vi.fn(),
  };

  return { state, auth, db, refs, firestoreApi, authApi, helpers, listeners };
}

describe("firestore-sync integration", () => {
  it("propage les verrous entrants via le flux realtime meta", async () => {
    const ctx = createBase();
    const sync = createFirestoreSync(ctx);

    sync.initRealtime();
    await Promise.resolve();

    const metaListener = ctx.listeners.get("meta");
    expect(metaListener).toBeTypeOf("function");
    metaListener({
      exists: () => true,
      metadata: { hasPendingWrites: false },
      data: () => ({
        locks: { "85034": { by: "Elodie", at: 1700000000000 } },
        clientWriteId: "remote-write",
        clientUpdatedAt: 1700000000000,
      }),
    });

    expect(ctx.helpers.applyRemoteMetaState).toHaveBeenCalledWith(
      expect.objectContaining({
        locks: { "85034": { by: "Elodie", at: 1700000000000 } },
      })
    );
    expect(ctx.helpers.setSyncStatus).toHaveBeenCalledWith("Connecté", "ok");
  });

  it("charge une page historique suivante avec startAfter", async () => {
    const ctx = createBase();
    ctx.state.authReady = true;
    ctx.state.historyCursor = { id: "cursor-a" };
    ctx.state.historyHasMore = true;
    ctx.state.historyPageSize = 2;

    const d1 = { id: "h1", data: () => ({ time: "t1", user: "A", action: "x" }) };
    const d2 = { id: "h2", data: () => ({ time: "t2", user: "B", action: "y" }) };
    ctx.firestoreApi.getDocs.mockResolvedValueOnce({ docs: [d1, d2] });

    const sync = createFirestoreSync(ctx);
    await sync.loadMoreHistory();

    expect(ctx.firestoreApi.startAfter).toHaveBeenCalledWith({ id: "cursor-a" });
    expect(ctx.state.historyById.h1).toEqual(expect.objectContaining({ _id: "h1" }));
    expect(ctx.state.historyById.h2).toEqual(expect.objectContaining({ _id: "h2" }));
    expect(ctx.state.historyCursor).toBe(d2);
    expect(ctx.state.historyHasMore).toBe(true);
    expect(ctx.helpers.rebuildHistoryList).toHaveBeenCalledTimes(1);
    expect(ctx.helpers.renderHistory).toHaveBeenCalledTimes(2);
  });
});
