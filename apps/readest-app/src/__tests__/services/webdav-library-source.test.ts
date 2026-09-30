import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import { useLibraryStore } from '@/store/libraryStore';
import {
  addWebDAVBook,
  buildWebDAVBookUrl,
  createWebDAVBookFetcher,
} from '@/services/webdavLibrary/bookSource';

const fetchMock = vi.hoisted(() => vi.fn());
const download = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: fetchMock }));
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => true,
}));
vi.mock('@/utils/transfer', () => ({ tauriDownload: download }));
vi.mock('@/utils/md5', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/md5')>()),
  partialMD5: async () => 'a'.repeat(32),
}));
const settings = {
  serverUrl: 'https://example.test/dav',
  username: 'u',
  password: 'p',
  rootPath: '/books',
  enabled: true,
};
const source = { name: 'test.epub', path: '/books/Libros/test.epub', isDirectory: false };

beforeEach(() => {
  vi.clearAllMocks();
  useLibraryStore.setState({ library: [], libraryLoaded: true });
});
afterEach(() => vi.restoreAllMocks());

describe('WebDAV remote source', () => {
  test('rejects truncated ranges rather than passing incomplete bytes to the EPUB reader', async () => {
    fetchMock.mockResolvedValue(
      new Response('short', { status: 206, headers: { 'Content-Range': 'bytes 0-3/2048' } }),
    );
    await expect(
      createWebDAVBookFetcher(settings, source.path)(buildWebDAVBookUrl(settings, source.path), {
        headers: { Range: 'bytes=0-1023' },
      }),
    ).rejects.toThrow('valid byte ranges');
  });

  test('metadata fallback filenames fit the filesystem limit and are unique per import', async () => {
    fetchMock.mockResolvedValue(new Response('no range', { status: 200 }));
    const paths: string[] = [];
    const app = {
      resolveFilePath: async (path: string) => {
        paths.push(path);
        return path;
      },
      openFile: async () => new File([], 'temp.epub'),
      deleteFile: async () => {},
      importBook: async () => ({ hash: 'a'.repeat(32), format: 'EPUB' }) as Book,
      saveLibraryBooks: async () => {},
    } as unknown as AppService;
    const entry = {
      ...source,
      name: `${'a'.repeat(240)}.epub`,
      path: `/books/${'a'.repeat(240)}.epub`,
    };
    await addWebDAVBook(app, settings, entry, []);
    await addWebDAVBook(app, settings, entry, []);
    expect(paths[0]).not.toEqual(paths[1]);
    expect(paths.every((path) => path.length <= 255)).toBe(true);
  });
  test('cancellation after metadata extraction never publishes a stale mount reference', async () => {
    fetchMock.mockResolvedValue(new Response('no range', { status: 200 }));
    const controller = new AbortController();
    const saveLibraryBooks = vi.fn(async () => {});
    const app = {
      resolveFilePath: async (path: string) => path,
      openFile: async () => new File([], 'temp.epub'),
      deleteFile: async () => {},
      importBook: async () => {
        controller.abort();
        return { hash: 'a'.repeat(32), format: 'EPUB' } as Book;
      },
      saveLibraryBooks,
    } as unknown as AppService;
    await expect(addWebDAVBook(app, settings, source, [], controller.signal)).rejects.toMatchObject(
      { name: 'AbortError' },
    );
    expect(saveLibraryBooks).not.toHaveBeenCalled();
    expect(useLibraryStore.getState().library).toEqual([]);
  });

  test('escapes decoded filenames and rejects sidecars and traversal', () => {
    expect(buildWebDAVBookUrl(settings, '/books/Libros/100%20 real.epub')).toBe(
      'https://example.test/dav/books/Libros/100%2520%20real.epub',
    );
    for (const path of ['/books/Readest/a.epub', '/books/Libros/../a.epub', '/else/a.epub']) {
      expect(() => buildWebDAVBookUrl(settings, path)).toThrow();
    }
  });

  test('authenticates range reads and refuses credentials for another origin', async () => {
    fetchMock.mockResolvedValue(
      new Response('data', { status: 206, headers: { 'Content-Range': 'bytes 0-3/4' } }),
    );
    const fetcher = createWebDAVBookFetcher(settings, source.path);
    await fetcher(buildWebDAVBookUrl(settings, source.path), {
      headers: { Range: 'bytes=0-1023' },
    });
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get('Authorization')).toBe(
      'Basic dTpw',
    );
    await expect(fetcher('https://else.test/test.epub')).rejects.toThrow('another server');
  });

  test('fallback imports metadata only, removes temporary bytes and preserves a concurrent library addition', async () => {
    fetchMock.mockResolvedValue(new Response('no range', { status: 200 }));
    const imported = { hash: 'a'.repeat(32), title: 'Source', format: 'EPUB' } as Book;
    const concurrent = { hash: 'other', title: 'Other' } as Book;
    const saveLibraryBooks = vi.fn(async (_books: Book[]) => {});
    const deleteFile = vi.fn(async () => {});
    const importBook = vi.fn(async (_file: File, books: Book[], _options: unknown) => {
      books.push(imported);
      useLibraryStore.getState().setLibrary([concurrent]);
      return imported;
    });
    const app = {
      resolveFilePath: async (path: string) => path,
      openFile: async () => new File(['epub'], 'test.epub'),
      deleteFile,
      importBook,
      saveLibraryBooks,
    } as unknown as AppService;
    const result = await addWebDAVBook(app, settings, source, []);
    expect(result.book.remoteSource).toEqual(
      expect.objectContaining({ path: source.path, provider: 'webdav' }),
    );
    expect(importBook.mock.calls[0]?.[2]).toEqual({ saveBook: false, matchByMetadata: false });
    expect(download).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalled();
    expect(
      useLibraryStore
        .getState()
        .library.map((book) => book.hash)
        .sort(),
    ).toEqual(['a'.repeat(32), 'other']);
    expect(saveLibraryBooks.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([concurrent, imported]),
    );
  });
});
