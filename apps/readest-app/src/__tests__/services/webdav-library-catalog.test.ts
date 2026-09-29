import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { WebDAVEntry } from '@/services/sync/providers/webdav/client';
import { listWebDAVLibraryFolder } from '@/services/webdavLibrary/catalog';

const listDirectory = vi.hoisted(() => vi.fn());
vi.mock('@/services/sync/providers/webdav/client', () => ({ listDirectory }));
const settings = {
  serverUrl: 'https://example.test/dav',
  username: 'u',
  password: 'p',
  rootPath: '/books',
  enabled: true,
};
const entry = (path: string, isDirectory = false): WebDAVEntry => ({
  path,
  name: path.split('/').pop()!,
  isDirectory,
});
beforeEach(() => {
  listDirectory.mockReset();
});

describe('WebDAV library catalog', () => {
  test('loads only direct folders and EPUBs, excluding sidecars, escapes and duplicates', async () => {
    listDirectory.mockResolvedValue([
      entry('/books/Readest', true),
      entry('/books/Readest/hidden.epub'),
      entry('/books/Authors', true),
      entry('/books/Authors/deep.epub'),
      entry('/books/A.epub'),
      entry('/books/A.epub'),
      entry('/books/ignore.pdf'),
      entry('/outside/book.epub'),
      entry('/books/..', true),
    ]);
    const result = await listWebDAVLibraryFolder(settings, '/books');
    expect(result.entries.map((book) => book.path)).toEqual(['/books/Authors', '/books/A.epub']);
    expect(listDirectory).toHaveBeenCalledTimes(1);
    expect(listDirectory).toHaveBeenCalledWith(settings, '/books', true);
  });

  test('rejects navigation outside the configured root or into sidecars before requesting', async () => {
    for (const path of [
      '/outside',
      '/books/Readest',
      '/books/Readest/nested',
      '/books/../outside',
    ]) {
      await expect(listWebDAVLibraryFolder(settings, path)).rejects.toThrow(
        'Invalid library folder',
      );
    }
    expect(listDirectory).not.toHaveBeenCalled();
  });
  test('scans a server URL already pointing at Libros without appending Libros again', async () => {
    const direct = {
      ...settings,
      serverUrl: 'https://example.test/files/home/resources/Libros/',
      rootPath: '/',
    };
    listDirectory.mockImplementation(async (_settings, path: string) => {
      if (path === '/') return [entry('/Author', true), entry('/Readest', true)];
      if (path === '/Author') return [entry('/Author/Book.epub')];
      throw new Error('Directory not found');
    });
    const result = await listWebDAVLibraryFolder(direct, '/');
    expect(result.entries.map((book) => book.path)).toEqual(['/Author']);
    expect(listDirectory.mock.calls.map((call) => call[1])).toEqual(['/']);
  });

  test.each([
    '/resources/Libros',
    '/resources/Collection',
  ])('lists configured folder %s directly', async (rootPath) => {
    const direct = { ...settings, rootPath };
    listDirectory.mockImplementation(async (_settings, path: string) => {
      if (path === direct.rootPath) return [entry(`${path}/Book.epub`)];
      throw new Error('Directory not found');
    });
    expect((await listWebDAVLibraryFolder(direct, direct.rootPath)).entries).toHaveLength(1);
    expect(listDirectory.mock.calls[0]?.[1]).toBe(direct.rootPath);
  });
  test('propagates root failure and stops a cancelled scan', async () => {
    listDirectory.mockRejectedValue(new Error('offline'));
    await expect(listWebDAVLibraryFolder(settings, settings.rootPath)).rejects.toThrow('offline');
    const controller = new AbortController();
    controller.abort();
    await expect(
      listWebDAVLibraryFolder(settings, settings.rootPath, controller.signal),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
