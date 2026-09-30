import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { NodeAppService } from '@/services/nodeAppService';
import { reconcileWebDAVLibrary } from '@/services/webdavLibrary/reconcile';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getConfigFilename, getCoverFilename, getLocalBookFilename } from '@/utils/book';

const transport = vi.hoisted(() => ({ fetch: vi.fn(), download: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: transport.fetch }));
vi.mock('@/utils/transfer', async (original) => ({
  ...(await original<typeof import('@/utils/transfer')>()),
  tauriDownload: transport.download,
}));
vi.mock('@/services/environment', async (original) => ({
  ...(await original<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => true,
}));

let temporary: string | undefined;
afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
  vi.restoreAllMocks();
});

test('real EPUB registration persists sidecars, preserves the source, and reopens a cached book offline', async () => {
  // A project fixture, never a personal book or a production service volume.
  const bytes = readFileSync(resolve('src/__tests__/fixtures/data/sample-alice.epub'));
  temporary = await mkdtemp(join(tmpdir(), 'readest-webdav-fixture-'));
  const app = new NodeAppService(temporary);
  await app.init();
  vi.spyOn(app, 'generateCoverImageUrl').mockResolvedValue('');
  localStorage.clear();
  useLibraryStore.setState({ library: [], libraryLoaded: true });
  const settings = {
    serverUrl: 'https://example.test',
    username: 'u',
    password: 'p',
    rootPath: '/Collection',
    enabled: true,
  };
  useSettingsStore.setState((state) => ({ settings: { ...state.settings, webdav: settings } }));
  const path = '/Collection/Fiction/Alice & Friends.epub';
  transport.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    if (init.method === 'PROPFIND') {
      const href = url.endsWith('/Fiction')
        ? '/Collection/Fiction/Alice%20%26%20Friends.epub'
        : '/Collection/Fiction/';
      const resource = url.endsWith('/Fiction') ? '' : '<D:collection/>';
      return new Response(
        `<D:multistatus xmlns:D="DAV:"><D:response><D:href>${href}</D:href><D:propstat><D:prop><D:resourcetype>${resource}</D:resourcetype><D:getetag>&quot;v1&quot;</D:getetag><D:getcontentlength>${bytes.length}</D:getcontentlength></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`,
        { status: 207 },
      );
    }
    expect(url).toBe('https://example.test/Collection/Fiction/Alice%20%26%20Friends.epub');
    const range = new Headers(init.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/);
    if (!range) return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
    const start = Number(range[1]);
    const end = Math.min(Number(range[2]), bytes.length - 1);
    return new Response(bytes.subarray(start, end + 1), {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${bytes.length}` },
    });
  });
  transport.download.mockImplementation(async (url: string, absolute: string) => {
    expect(url).toBe('https://example.test/Collection/Fiction/Alice%20%26%20Friends.epub');
    await writeFile(absolute, bytes);
    return { 'content-length': String(bytes.length) };
  });
  const report = await reconcileWebDAVLibrary(app, settings);
  expect(report.failedBooks).toEqual([]);
  const book = useLibraryStore.getState().visibleLibrary[0]!;
  expect(book).toMatchObject({ groupName: 'Fiction', remoteSource: { path } });
  expect(book.title).toContain('Alice');
  expect(await app.exists(getConfigFilename(book), 'Books')).toBe(true);
  expect(await app.exists(getCoverFilename(book), 'Books')).toBe(true);
  expect(await app.exists(getLocalBookFilename(book), 'Books')).toBe(false);
  const content = await app.loadBookContent(book);
  await (content.file as File & { close: () => Promise<void> }).close();
  transport.fetch.mockRejectedValue(new Error('offline'));
  transport.download.mockRejectedValue(new Error('offline'));
  const reopened = await app.loadBookContent(book);
  expect(reopened.file.size).toBe(bytes.length);
  await (reopened.file as File & { close: () => Promise<void> }).close();
  expect(transport.download).toHaveBeenCalledTimes(1);
  expect((await readdir(temporary)).length).toBeGreaterThan(0);
}, 30_000);
