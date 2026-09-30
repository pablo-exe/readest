import { File as NodeFile } from 'node:buffer';
import { beforeEach, expect, test, vi } from 'vitest';
import type { FileSystem } from '@/types/system';
import type { Book } from '@/types/book';
import { openCachedWebDAVBook } from '@/services/webdavLibrary/cache';

vi.mock('@/utils/md5', async (original) => ({
  ...(await original<typeof import('@/utils/md5')>()),
  partialMD5: async (file: File) => file.text(),
}));
const settings = {
  serverUrl: 'https://example.test',
  username: 'u',
  password: 'p',
  rootPath: '/',
  enabled: true,
};
const files = new Map<string, File>();
const remove = vi.fn(async (path: string) => {
  files.delete(path);
});
const fs = {
  getPrefix: async () => '/data',
  createDir: async () => {},
  readDir: async (dir: string) =>
    [...files.keys()]
      .filter((p) => p.startsWith(`${dir}/`))
      .map((p) => ({ path: p.split('/').pop()!, size: 1 })),
  exists: async (path: string) => files.has(path),
  openFile: async (path: string) => {
    if (!files.has(path)) throw new Error('missing');
    return new NodeFile([await files.get(path)!.text()], 'cached.epub') as unknown as File;
  },
  removeFile: remove,
} as unknown as FileSystem;
const book = (hash: string) =>
  ({ hash, remoteSource: { provider: 'webdav', path: `/${hash}.epub`, updatedAt: 1 } }) as Book;
const download = vi.fn(async (absolute: string, hash: string) => {
  files.set(
    absolute.replace('/data/', ''),
    new NodeFile([hash], `${hash}.epub`) as unknown as File,
  );
});
const open = (hash: string) =>
  openCachedWebDAVBook(fs, book(hash), settings, (absolute) => download(absolute, hash));
const close = (file: File) => (file as File & { close: () => Promise<void> }).close();

beforeEach(() => {
  localStorage.clear();
  files.clear();
  vi.clearAllMocks();
});

test('reopens a completed EPUB offline after closing it', async () => {
  await close(await open('one'));
  download.mockRejectedValueOnce(new Error('offline'));
  const file = await open('one');
  expect(await file.text()).toBe('one');
  expect(download).toHaveBeenCalledTimes(1);
  await close(file);
  download.mockReset();
  download.mockImplementation(async (absolute, hash) => {
    files.set(
      absolute.replace('/data/', ''),
      new NodeFile([hash], `${hash}.epub`) as unknown as File,
    );
  });
});

test('keeps the five most recently opened books and never evicts an open handle', async () => {
  const held = await open('one');
  for (const hash of ['two', 'three', 'four', 'five', 'six']) await close(await open(hash));
  expect([...files.keys()].some((p) => p.includes('/one-'))).toBe(true);
  await close(held);
  expect(files.size).toBe(5);
  expect([...files.keys()].some((p) => p.includes('/one-'))).toBe(false);
  await close(await open('two'));
  await close(await open('seven'));
  expect([...files.keys()].some((p) => p.includes('/two-'))).toBe(true);
  expect([...files.keys()].some((p) => p.includes('/three-'))).toBe(false);
});

test('partial or changed downloads never become available offline', async () => {
  await expect(
    openCachedWebDAVBook(fs, book('expected'), settings, async (absolute) => {
      files.set(
        absolute.replace('/data/', ''),
        new NodeFile(['changed'], 'a.epub') as unknown as File,
      );
    }),
  ).rejects.toThrow('changed');
  expect(files.size).toBe(0);
});

test('uses the persisted cache after a fresh module load and isolates server identities', async () => {
  await close(await open('restart'));
  vi.resetModules();
  const fresh = await import('@/services/webdavLibrary/cache');
  const offline = vi.fn(async () => {
    throw new Error('offline');
  });
  await close(await fresh.openCachedWebDAVBook(fs, book('restart'), settings, offline));
  expect(offline).not.toHaveBeenCalled();
  await expect(
    fresh.openCachedWebDAVBook(
      fs,
      book('restart'),
      { ...settings, serverUrl: 'https://other.test' },
      offline,
    ),
  ).rejects.toThrow('offline');
});

test('rejects a truncated download even when sampled content matches', async () => {
  await expect(
    openCachedWebDAVBook(fs, book('short'), settings, async (absolute) => {
      files.set(
        absolute.replace('/data/', ''),
        new NodeFile(['short'], 'a.epub') as unknown as File,
      );
      return 100;
    }),
  ).rejects.toThrow('incomplete');
  expect(files.size).toBe(0);
});
