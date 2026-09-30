import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { useWebDAVLibrary } from '@/services/webdavLibrary/useWebDAVLibrary';

const mocks = vi.hoisted(() => ({
  loaded: false,
  reconcile: vi.fn(),
  toast: vi.fn(),
  getAppService: vi.fn(),
}));
const settings = {
  serverUrl: 'https://example.test',
  username: 'u',
  password: 'p',
  rootPath: '/Collection',
  enabled: true,
};
const envConfig = { getAppService: mocks.getAppService };
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig }) }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: (select: (s: { libraryLoaded: boolean }) => unknown) =>
    select({ libraryLoaded: mocks.loaded }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (select: (s: { settings: { webdav: typeof settings } }) => unknown) =>
    select({ settings: { webdav: settings } }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: mocks.toast } }));
vi.mock('@/services/webdavLibrary/reconcile', () => ({ reconcileWebDAVLibrary: mocks.reconcile }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loaded = false;
  mocks.getAppService.mockResolvedValue({});
  mocks.reconcile.mockResolvedValue({ failedBooks: [], failedDirectories: [] });
});

test('waits for the persisted library, scans on startup, and retries when connectivity returns', async () => {
  const hook = renderHook(() => useWebDAVLibrary());
  expect(mocks.reconcile).not.toHaveBeenCalled();
  mocks.loaded = true;
  hook.rerender();
  await waitFor(() => expect(mocks.reconcile).toHaveBeenCalledTimes(1));
  await act(async () => {
    window.dispatchEvent(new Event('online'));
  });
  await waitFor(() => expect(mocks.reconcile).toHaveBeenCalledTimes(2));
  hook.unmount();
  window.dispatchEvent(new Event('online'));
  expect(mocks.reconcile).toHaveBeenCalledTimes(2);
});

test('aborts a scan on leaving the library and reports partial scans', async () => {
  mocks.loaded = true;
  mocks.reconcile.mockResolvedValue({ failedBooks: ['/Collection/a.epub'], failedDirectories: [] });
  const hook = renderHook(() => useWebDAVLibrary());
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1));
  const signal = mocks.reconcile.mock.calls[0]?.[2] as AbortSignal;
  hook.unmount();
  expect(signal.aborted).toBe(true);
});
