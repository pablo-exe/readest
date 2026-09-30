import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { WebDAVEntry } from '@/services/sync/providers/webdav/client';
import { scanWebDAVLibrary } from '@/services/webdavLibrary/catalog';

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

beforeEach(() => vi.clearAllMocks());

describe('WebDAV library catalog', () => {
  test('lists EPUBs recursively without reading book bytes or traversing outside the configured root', async () => {
    listDirectory.mockImplementation(async (_settings, path: string) => {
      if (path === '/books')
        return [
          entry('/books/Collection/A.epub'),
          entry('/books/Collection/sub', true),
          entry('/outside', true),
          entry('/books/Readest/hidden.epub'),
          entry('/books/Readest', true),
          entry('/books/Collection/../escape', true),
          entry('/books/Collection/ignore.pdf'),
        ];
      return [
        entry('/books/Collection/sub/B.EPUB'),
        entry('/books/Collection/sub', true),
        entry('/books/Collection/A.epub'),
      ];
    });
    const result = await scanWebDAVLibrary(settings);
    expect(result.entries.map((e) => e.name)).toEqual(['A.epub', 'B.EPUB']);
    expect(listDirectory.mock.calls.map((call) => call[1])).toEqual([
      '/books',
      '/books/Collection/sub',
    ]);
  });

  test('reports unreadable subfolders instead of silently claiming a complete library', async () => {
    listDirectory.mockImplementation(async (_settings, path: string) => {
      if (path === '/books')
        return [entry('/books/Collection/A.epub'), entry('/books/Collection/private', true)];
      throw new Error('permission denied');
    });
    const result = await scanWebDAVLibrary(settings);
    expect(result.failedDirectories).toEqual(['/books/Collection/private']);
    expect(result.entries).toHaveLength(1);
  });

  test('propagates root failure and stops a cancelled scan', async () => {
    listDirectory.mockRejectedValue(new Error('offline'));
    await expect(scanWebDAVLibrary(settings)).rejects.toThrow('offline');
    const controller = new AbortController();
    controller.abort();
    await expect(scanWebDAVLibrary(settings, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

test('accepts the mount root itself and excludes only its reserved sync folder', async () => {
  listDirectory.mockImplementation(async (_settings, path: string) =>
    path === '/'
      ? [
          entry('/root.epub'),
          entry('/Readest', true),
          entry('/Readest/hidden.epub'),
          entry('/Other/Readest', true),
        ]
      : [entry('/Other/Readest/visible.epub')],
  );
  const result = await scanWebDAVLibrary({ ...settings, rootPath: '/' });
  expect(result.entries.map((e) => e.path)).toEqual(['/root.epub', '/Other/Readest/visible.epub']);
  expect(listDirectory.mock.calls.some((call) => call[1] === '/Readest')).toBe(false);
});
