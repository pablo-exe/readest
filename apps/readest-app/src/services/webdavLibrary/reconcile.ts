import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import type { WebDAVSettings } from '@/types/settings';
import type { WebDAVEntry } from '@/services/sync/providers/webdav/client';
import { useLibraryStore } from '@/store/libraryStore';
import { md5Fingerprint } from '@/utils/md5';
import { scanWebDAVLibrary } from './catalog';
import { addWebDAVBook } from './bookSource';
import { getWebDAVLibraryId, getWebDAVRoot } from './identity';
import { isWebDAVRemoteBook } from './remoteBook';

interface IndexedSource {
  hash: string;
  etag?: string;
  size?: number;
  lastModified?: string;
}

function readIndex(key: string): Record<string, IndexedSource> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([path, row]) =>
          path.startsWith('/') && row && typeof row === 'object' && typeof row.hash === 'string',
      ),
    );
  } catch {
    return {};
  }
}

function unchanged(row: IndexedSource, entry: WebDAVEntry): boolean {
  if (entry.etag) return row.etag === entry.etag && row.size === entry.size;
  return (
    entry.size !== undefined &&
    !!entry.lastModified &&
    row.size === entry.size &&
    row.lastModified === entry.lastModified
  );
}

/** One reconciliation at a time, including Strict Mode remounts and reconnects. */
let pending: Promise<unknown> = Promise.resolve();
export function reconcileWebDAVLibrary(
  app: AppService,
  settings: WebDAVSettings,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
) {
  const run = pending.catch(() => {}).then(() => reconcile(app, settings, signal, onProgress));
  pending = run;
  return run;
}

async function reconcile(
  app: AppService,
  settings: WebDAVSettings,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
) {
  signal?.throwIfAborted();
  if (!useLibraryStore.getState().libraryLoaded) {
    useLibraryStore.getState().setLibrary(await app.loadLibraryBooks());
  }
  const catalog = await scanWebDAVLibrary(settings, signal, (progress) =>
    onProgress?.(progress * 0.4),
  );
  signal?.throwIfAborted();
  const libraryId = getWebDAVLibraryId(settings);
  const key = `readest:webdav-catalog:v1:${libraryId}`;
  const index = readIndex(key);
  const present = new Map<string, string>();
  const failedBooks: string[] = [];
  let completed = 0;
  const checkpoint = () => {
    try {
      localStorage.setItem(key, JSON.stringify(index));
    } catch {
      // This index only avoids repeated metadata reads; the library and
      // sidecars have already been saved by the existing importer.
    }
  };
  // Serial imports share upstream's importer/store safely; the catalog walker
  // already bounds directory concurrency. Checkpoint completed metadata only.
  for (const entry of catalog.entries) {
    signal?.throwIfAborted();
    try {
      const state = useLibraryStore.getState();
      const previous = index[entry.path];
      let book = previous && state.library.find((b) => b.hash === previous.hash && !b.deletedAt);
      if (!book || !previous || !unchanged(previous, entry)) {
        book = (await addWebDAVBook(app, settings, entry, [...state.library], signal)).book;
      }
      signal?.throwIfAborted();
      present.set(entry.path, book.hash);
      index[entry.path] = {
        hash: book.hash,
        etag: entry.etag,
        size: entry.size,
        lastModified: entry.lastModified,
      };
      if ((completed + 1) % 20 === 0) checkpoint();
    } catch {
      signal?.throwIfAborted();
      failedBooks.push(entry.path);
      // Keep the last good version if a replacement cannot yet be imported.
      const previous = index[entry.path];
      if (previous) present.set(entry.path, previous.hash);
    }
    onProgress?.(0.4 + (++completed / Math.max(1, catalog.entries.length)) * 0.6);
  }
  checkpoint();
  signal?.throwIfAborted();
  const root = getWebDAVRoot(settings);
  const prefix = root === '/' ? '/' : `${root}/`;
  const paths = new Set(catalog.entries.map((entry) => entry.path));
  const blocked = (path: string) =>
    catalog.failedDirectories.some((dir) => path === dir || path.startsWith(`${dir}/`));
  const byHash = new Map<string, string[]>();
  for (const [path, hash] of present) {
    const candidates = byHash.get(hash) ?? [];
    candidates.push(path);
    byHash.set(hash, candidates);
  }
  let changed = false;
  const state = useLibraryStore.getState();
  const library = state.library.map((book): Book => {
    if (
      !isWebDAVRemoteBook(book) ||
      book.deletedAt ||
      (book.remoteSource.libraryId && book.remoteSource.libraryId !== libraryId) ||
      !book.remoteSource.path.startsWith(prefix)
    )
      return book;
    // Readest has one row per content hash. Prefer its existing path when the
    // server has duplicate copies; otherwise choose a deterministic live path.
    const candidates = byHash.get(book.hash) ?? [];
    const path = candidates.includes(book.remoteSource.path)
      ? book.remoteSource.path
      : candidates[0];
    if (
      !path &&
      (blocked(book.remoteSource.path) ||
        (paths.has(book.remoteSource.path) && failedBooks.includes(book.remoteSource.path)))
    )
      return book;
    const missing = !path;
    const groupName = path
      ? path.slice(prefix.length).split('/').slice(0, -1).join('/') || undefined
      : book.groupName;
    const sourceChanged =
      book.remoteSource.path !== (path ?? book.remoteSource.path) ||
      !!book.remoteSource.missing !== missing ||
      book.remoteSource.libraryId !== libraryId;
    const groupChanged =
      !!path &&
      (book.groupName !== groupName ||
        book.groupId !== (groupName ? md5Fingerprint(groupName) : undefined));
    if (!sourceChanged && !groupChanged) return book;
    changed = true;
    const now = Math.max(
      Date.now(),
      (book.updatedAt ?? 0) + 1,
      book.remoteSource.updatedAt + 1,
      (book.groupUpdatedAt ?? 0) + 1,
    );
    return {
      ...book,
      updatedAt: now,
      remoteSource: {
        ...book.remoteSource,
        path: path ?? book.remoteSource.path,
        libraryId,
        missing,
        updatedAt: sourceChanged ? now : book.remoteSource.updatedAt,
      },
      ...(groupChanged
        ? {
            groupName,
            groupId: groupName ? md5Fingerprint(groupName) : undefined,
            groupUpdatedAt: now,
          }
        : {}),
    };
  });
  if (changed) {
    state.setLibrary(library);
    await app.saveLibraryBooks(library);
  }
  return { ...catalog, failedBooks };
}
