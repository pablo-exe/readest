import { describe, expect, test, vi } from 'vitest';
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

describe('WebDAV library catalog', () => {
  test('lists EPUBs recursively without reading book bytes or traversing outside Libros', async () => {
    listDirectory.mockImplementation(async (_settings, path: string) => {
      if (path === '/books/Libros')
        return [
          entry('/books/Libros/A.epub'),
          entry('/books/Libros/sub', true),
          entry('/books/Readest', true),
          entry('/books/Libros/../escape', true),
          entry('/books/Libros/ignore.pdf'),
        ];
      return [
        entry('/books/Libros/sub/B.EPUB'),
        entry('/books/Libros/sub', true),
        entry('/books/Libros/A.epub'),
      ];
    });
    const result = await scanWebDAVLibrary(settings);
    expect(result.entries.map((e) => e.name)).toEqual(['A.epub', 'B.EPUB']);
    expect(listDirectory.mock.calls.map((call) => call[1])).toEqual([
      '/books/Libros',
      '/books/Libros/sub',
    ]);
  });

  test('reports unreadable subfolders instead of silently claiming a complete library', async () => {
    listDirectory.mockImplementation(async (_settings, path: string) => {
      if (path === '/books/Libros')
        return [entry('/books/Libros/A.epub'), entry('/books/Libros/private', true)];
      throw new Error('permission denied');
    });
    const result = await scanWebDAVLibrary(settings);
    expect(result.failedDirectories).toEqual(['/books/Libros/private']);
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
