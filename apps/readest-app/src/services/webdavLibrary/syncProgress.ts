import { create } from 'zustand';

type Status = 'idle' | 'pending' | 'running' | 'success' | 'error';
interface SyncProgressState {
  scan: Status;
  sync: Status;
  scanVersion: number;
  syncVersion: number;
  progress: number;
  beginScan: (syncEnabled: boolean) => number;
  updateScan: (version: number, progress: number) => void;
  finishScan: (version: number, success: boolean) => void;
  scheduleSync: () => void;
  beginSync: () => number;
  updateSync: (version: number, progress: number) => void;
  finishSync: (version: number, success: boolean) => void;
}

export const WEB_DAV_SCAN_FINISHED = 'webdav-library-scan-finished';

/** Process-local only: scheduling invalidates completion before the debounce fires. */
export const useWebDAVSyncProgress = create<SyncProgressState>((set, get) => ({
  scan: 'idle',
  sync: 'idle',
  scanVersion: 0,
  syncVersion: 0,
  progress: 0,
  beginScan: (syncEnabled) => {
    const version = get().scanVersion + 1;
    set((s) => ({
      scan: 'running',
      scanVersion: version,
      sync: syncEnabled ? 'pending' : 'idle',
      syncVersion: s.syncVersion + 1,
      progress: 0.02,
    }));
    return version;
  },
  updateScan: (version, progress) => {
    if (version !== get().scanVersion) return;
    set((s) => ({ progress: Math.max(s.progress, Math.min(0.65, progress * 0.65)) }));
  },
  finishScan: (version, success) => {
    if (version !== get().scanVersion) return;
    set((s) => ({
      scan: success ? 'success' : 'error',
      progress: success ? Math.max(s.progress, 0.65) : s.progress,
    }));
  },
  scheduleSync: () =>
    set((s) => ({
      sync: 'pending',
      syncVersion: s.syncVersion + 1,
      progress: s.sync === 'success' || s.sync === 'error' ? 0.02 : Math.max(0.02, s.progress),
    })),
  beginSync: () => {
    const version = get().syncVersion + 1;
    set((s) => ({
      sync: 'running',
      syncVersion: version,
      progress: s.sync === 'success' || s.sync === 'error' ? 0.02 : Math.max(0.02, s.progress),
    }));
    return version;
  },
  updateSync: (version, progress) => {
    if (version !== get().syncVersion) return;
    set((s) => ({ progress: Math.max(s.progress, 0.65 + Math.min(1, progress) * 0.3) }));
  },
  finishSync: (version, success) => {
    if (version !== get().syncVersion) return;
    set({ sync: success ? (get().scan === 'running' ? 'pending' : 'success') : 'error' });
  },
}));

export const isWebDAVSyncComplete = (state: SyncProgressState): boolean =>
  (state.scan === 'success' || state.sync === 'success') &&
  (state.scan === 'idle' || state.scan === 'success') &&
  (state.sync === 'idle' || state.sync === 'success');
