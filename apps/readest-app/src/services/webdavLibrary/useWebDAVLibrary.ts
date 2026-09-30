import { useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { isTauriAppPlatform } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';
import { reconcileWebDAVLibrary } from './reconcile';
import { getActiveFileSyncBackends } from '@/services/sync/cloudSyncProvider';
import { WEB_DAV_SCAN_FINISHED, useWebDAVSyncProgress } from './syncProgress';

/** App entry, reconnect and foreground refresh; no network work in the shelf. */
export function useWebDAVLibrary() {
  const { envConfig } = useEnv();
  const settings = useSettingsStore((state) => state.settings.webdav);
  const loaded = useLibraryStore((state) => state.libraryLoaded);
  const _ = useTranslation();
  const translate = useRef(_);
  translate.current = _;
  useEffect(() => {
    if (!loaded || !isTauriAppPlatform() || !settings?.serverUrl || !settings.username) return;
    const controller = new AbortController();
    let running = false;
    let lastScan = 0;
    const scan = async () => {
      if (
        running ||
        controller.signal.aborted ||
        navigator.onLine === false ||
        Date.now() - lastScan < 30_000
      )
        return;
      running = true;
      lastScan = Date.now();
      const tracker = useWebDAVSyncProgress.getState();
      const syncEnabled = getActiveFileSyncBackends(useSettingsStore.getState().settings).includes(
        'webdav',
      );
      const version = tracker.beginScan(syncEnabled);
      try {
        const app = await envConfig.getAppService();
        const result = await reconcileWebDAVLibrary(app, settings, controller.signal, (progress) =>
          tracker.updateScan(version, progress),
        );
        if (controller.signal.aborted) {
          tracker.finishScan(version, false);
          return;
        }
        tracker.finishScan(version, !result.failedDirectories.length && !result.failedBooks.length);
        // Always sync after discovery, even when no books changed. A pass that
        // raced the scan cannot certify the newly discovered server state.
        if (syncEnabled) void eventDispatcher.dispatch(WEB_DAV_SCAN_FINISHED);
        if (
          !controller.signal.aborted &&
          (result.failedDirectories.length || result.failedBooks.length)
        ) {
          eventDispatcher.dispatch('toast', {
            type: 'error',
            message: translate.current(
              'Some WebDAV books or folders could not be read. Your existing library has been preserved.',
            ),
          });
        }
      } catch {
        tracker.finishScan(version, false);
        // Offline/auth failures preserve the previous shelf and its local cache.
      } finally {
        running = false;
      }
    };
    const foreground = () => {
      if (document.visibilityState === 'visible') void scan();
    };
    const reconnect = () => {
      lastScan = 0;
      void scan();
    };
    void scan();
    window.addEventListener('online', reconnect);
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      controller.abort();
      window.removeEventListener('online', reconnect);
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [
    loaded,
    envConfig,
    settings?.serverUrl,
    settings?.username,
    settings?.password,
    settings?.rootPath,
  ]);
}
