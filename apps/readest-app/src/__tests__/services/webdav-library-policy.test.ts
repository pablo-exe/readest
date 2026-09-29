import { expect, test } from 'vitest';
import type { Book } from '@/types/book';
import {
  canSyncBookWithBackend,
  filterBooksForBackend,
  mergeWebDAVSource,
} from '@/services/webdavLibrary/remoteBook';

const local = { hash: 'local' } as Book;
const linked = {
  hash: 'linked',
  remoteSource: { provider: 'webdav', path: '/Libros/a.epub', updatedAt: 10 },
} as Book;

test('source-linked rows, including tombstones, belong only to the WebDAV channel', () => {
  const deleted = { ...linked, deletedAt: 20 };
  const books = [local, linked, deleted];
  expect(filterBooksForBackend(books, 'webdav')).toBe(books);
  for (const backend of ['readest', 'gdrive', 's3', 'onedrive', 'icloud']) {
    expect(filterBooksForBackend(books, backend)).toEqual([local]);
    expect(canSyncBookWithBackend(linked, backend)).toBe(false);
    expect(canSyncBookWithBackend(local, backend)).toBe(true);
  }
});

test('an absent source never erases an existing source, and its own clock selects updates', () => {
  expect(mergeWebDAVSource(linked, local)).toBe(linked.remoteSource);
  expect(mergeWebDAVSource(local, linked)).toBe(linked.remoteSource);
  const newer = {
    ...linked,
    updatedAt: 1,
    remoteSource: { ...linked.remoteSource!, path: '/Libros/moved.epub', updatedAt: 11 },
  };
  expect(mergeWebDAVSource(linked, newer)).toBe(newer.remoteSource);
  expect(mergeWebDAVSource(newer, linked)).toBe(newer.remoteSource);
});
