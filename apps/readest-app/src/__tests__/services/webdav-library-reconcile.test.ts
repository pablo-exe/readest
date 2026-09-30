import { beforeEach, expect, test, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { WebDAVEntry } from '@/services/sync/providers/webdav/client';
import { createBookFilter } from '@/app/library/utils/libraryUtils';
import { useLibraryStore } from '@/store/libraryStore';
import { reconcileWebDAVLibrary } from '@/services/webdavLibrary/reconcile';
import { getWebDAVLibraryId } from '@/services/webdavLibrary/identity';

const mocks = vi.hoisted(() => ({ scan: vi.fn(), add: vi.fn() }));
vi.mock('@/services/webdavLibrary/catalog', () => ({ scanWebDAVLibrary: mocks.scan }));
vi.mock('@/services/webdavLibrary/bookSource', () => ({ addWebDAVBook: mocks.add }));
const settings = {
  serverUrl: 'https://example.test/dav',
  username: 'u',
  password: 'p',
  rootPath: '/Collection',
  enabled: true,
};
const app = { saveLibraryBooks: vi.fn(async () => {}) } as unknown as AppService;
const entry = (path: string, etag = 'v1'): WebDAVEntry => ({
  path,
  name: path.split('/').pop()!,
  isDirectory: false,
  etag,
  size: 20,
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  useLibraryStore.setState({ library: [], libraryLoaded: true });
  mocks.add.mockImplementation(async (_app, _settings, source: WebDAVEntry) => {
    const hash = source.etag === 'v2' ? 'new-hash' : 'book-hash';
    const existing = useLibraryStore.getState().library.find((b) => b.hash === hash);
    const book = {
      ...existing,
      hash,
      title: 'Title',
      format: 'EPUB',
      remoteSource: {
        provider: 'webdav',
        path: source.path,
        libraryId: getWebDAVLibraryId(settings),
        updatedAt: 1,
      },
    } as Book;
    useLibraryStore
      .getState()
      .setLibrary([...useLibraryStore.getState().library.filter((b) => b.hash !== hash), book]);
    return { book, added: !existing, sourceUpdated: true };
  });
});

test('registers real books, applies nested groups and skips unchanged metadata on the next launch', async () => {
  mocks.scan.mockResolvedValue({
    entries: [entry('/Collection/Fiction/Fantasy/a.epub')],
    failedDirectories: [],
  });
  await reconcileWebDAVLibrary(app, settings);
  expect(useLibraryStore.getState().library[0]?.groupName).toBe('Fiction/Fantasy');
  expect(mocks.add).toHaveBeenCalledTimes(1);
  await reconcileWebDAVLibrary(app, settings);
  expect(mocks.add).toHaveBeenCalledTimes(1);
  const book = useLibraryStore.getState().library[0]!;
  useLibraryStore
    .getState()
    .setLibrary([{ ...book, groupName: 'Manual', groupUpdatedAt: Date.now() }]);
  await reconcileWebDAVLibrary(app, settings);
  expect(useLibraryStore.getState().library[0]?.groupName).toBe('Fiction/Fantasy');
});

test('detects a move by content identity and preserves progress', async () => {
  mocks.scan.mockResolvedValue({ entries: [entry('/Collection/A/a.epub')], failedDirectories: [] });
  await reconcileWebDAVLibrary(app, settings);
  const book = useLibraryStore.getState().library[0]!;
  useLibraryStore.getState().setLibrary([{ ...book, progress: [10, 100] }]);
  mocks.scan.mockResolvedValue({ entries: [entry('/Collection/B/a.epub')], failedDirectories: [] });
  await reconcileWebDAVLibrary(app, settings);
  expect(useLibraryStore.getState().library).toHaveLength(1);
  expect(useLibraryStore.getState().library[0]).toMatchObject({
    groupName: 'B',
    progress: [10, 100],
    remoteSource: { path: '/Collection/B/a.epub' },
  });
});

test('retains replaced and removed configurations without issuing deletion tombstones', async () => {
  const path = '/Collection/a.epub';
  mocks.scan.mockResolvedValue({ entries: [entry(path)], failedDirectories: [] });
  await reconcileWebDAVLibrary(app, settings);
  mocks.scan.mockResolvedValue({ entries: [entry(path, 'v2')], failedDirectories: [] });
  await reconcileWebDAVLibrary(app, settings);
  expect(useLibraryStore.getState().library.find((b) => b.hash === 'book-hash')).toMatchObject({
    remoteSource: { missing: true },
  });
  expect(
    useLibraryStore.getState().library.every((b) => !b.deletedAt && !b.fileSyncDeletionRequestedAt),
  ).toBe(true);
  mocks.scan.mockResolvedValue({ entries: [], failedDirectories: [] });
  await reconcileWebDAVLibrary(app, settings);
  expect(useLibraryStore.getState().visibleLibrary).toEqual([]);
  expect(useLibraryStore.getState().library.filter(createBookFilter(null))).toEqual([]);
  expect(useLibraryStore.getState().library).toHaveLength(2);
});

test('a failed scan, inaccessible subtree or failed replacement never hides existing books', async () => {
  mocks.scan.mockResolvedValue({
    entries: [entry('/Collection/Private/a.epub')],
    failedDirectories: [],
  });
  await reconcileWebDAVLibrary(app, settings);
  mocks.scan.mockRejectedValueOnce(new Error('offline'));
  await expect(reconcileWebDAVLibrary(app, settings)).rejects.toThrow('offline');
  mocks.scan.mockResolvedValue({ entries: [], failedDirectories: ['/Collection/Private'] });
  await reconcileWebDAVLibrary(app, settings);
  expect(useLibraryStore.getState().library[0]?.remoteSource?.missing).not.toBe(true);
  mocks.scan.mockResolvedValue({
    entries: [entry('/Collection/Private/a.epub', 'v2')],
    failedDirectories: [],
  });
  mocks.add.mockRejectedValueOnce(new Error('truncated epub'));
  const result = await reconcileWebDAVLibrary(app, settings);
  expect(result.failedBooks).toHaveLength(1);
  expect(useLibraryStore.getState().library[0]?.remoteSource?.missing).not.toBe(true);
});

test('restores a reappearing book and isolates another mount', async () => {
  mocks.scan.mockResolvedValue({ entries: [entry('/Collection/a.epub')], failedDirectories: [] });
  await reconcileWebDAVLibrary(app, settings);
  mocks.scan.mockResolvedValue({ entries: [], failedDirectories: [] });
  await reconcileWebDAVLibrary(app, settings);
  mocks.scan.mockResolvedValue({ entries: [entry('/Collection/a.epub')], failedDirectories: [] });
  await reconcileWebDAVLibrary(app, settings);
  expect(useLibraryStore.getState().visibleLibrary).toHaveLength(1);
  await reconcileWebDAVLibrary(app, { ...settings, serverUrl: 'https://other.test' });
  expect(useLibraryStore.getState().library[0]?.remoteSource?.missing).not.toBe(true);
});
