import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { AppService, FileSystem } from '@/types/system';
import type { Book } from '@/types/book';
import type { WebDAVEntry } from '@/services/sync/providers/webdav/client';
import type { WebDAVSettings } from '@/types/settings';
import { isTauriAppPlatform } from '@/services/environment';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { buildBasicAuthHeader } from '@/services/sync/providers/webdav/client';
import { RemoteFile } from '@/utils/file';
import { tauriDownload } from '@/utils/transfer';
import { partialMD5 } from '@/utils/md5';
import { isWebDAVRemoteBook } from './remoteBook';

const CACHE_PREFIX = 'webdav-remote-';

interface WebDAVBookFileHost {
  resolveCachePath(path: string): Promise<string>;
  openFile(path: string, base: 'Cache' | 'None', filename?: string): Promise<File>;
  removeFile(path: string, base: 'Cache' | 'None'): Promise<void>;
}

const normalizedPath = (path: string): string => {
  return `/${path.split('/').filter(Boolean).join('/')}`;
};

const isPathWithinRoot = (path: string, rootPath: string): boolean => {
  const root = normalizedPath(rootPath || '/');
  return root === '/' || path === root || path.startsWith(`${root}/`);
};

const validateWebDAVPath = (path: string, rootPath: string): string => {
  const normalized = normalizedPath(path);
  const root = normalizedPath(rootPath || '/');
  const reservedReadestPath = `${root === '/' ? '' : root}/Readest`;
  const segments = normalized.split('/').filter(Boolean);
  if (
    !segments.length ||
    segments.some(
      (part) => part === '.' || part === '..' || part.includes('\\') || part.includes('\0'),
    ) ||
    !isPathWithinRoot(normalized, rootPath) ||
    normalized === reservedReadestPath ||
    normalized.startsWith(`${reservedReadestPath}/`)
  ) {
    throw new Error('The WebDAV book path is outside the configured library root.');
  }
  return normalized;
};

const currentWebDAVSettings = (): WebDAVSettings | null => {
  const settings = useSettingsStore.getState().settings.webdav;
  if (!settings?.serverUrl || !settings.username) return null;
  return settings;
};

export const buildWebDAVBookUrl = (settings: WebDAVSettings, sourcePath: string): string => {
  const path = validateWebDAVPath(sourcePath, settings.rootPath || '/');
  const base = settings.serverUrl.replace(/\/+$/, '');
  // remoteSource.path is stored decoded, so percent characters in real file
  // names are escaped instead of being mistaken for existing URL escapes.
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${base}${encoded}`;
};

export const getWebDAVBookRequest = (
  book: Book,
): { path: string; url: string; fetcher: typeof fetch } | null => {
  if (!isWebDAVRemoteBook(book)) return null;
  const settings = currentWebDAVSettings();
  if (!settings) return null;
  try {
    const path = validateWebDAVPath(book.remoteSource.path, settings.rootPath || '/');
    return {
      path,
      url: buildWebDAVBookUrl(settings, path),
      fetcher: createWebDAVBookFetcher(settings, path),
    };
  } catch {
    return null;
  }
};

export const createWebDAVBookFetcher = (
  settings: WebDAVSettings,
  sourcePath: string,
): typeof fetch => {
  const url = new URL(buildWebDAVBookUrl(settings, sourcePath));
  const fetcher: typeof fetch = async (input, init) => {
    const requestUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (new URL(requestUrl).origin !== url.origin) {
      throw new Error('Refusing to send WebDAV credentials to another server.');
    }
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set('Authorization', buildBasicAuthHeader(settings.username, settings.password));
    const fetchFn = isTauriAppPlatform() ? tauriFetch : window.fetch.bind(window);
    const response = await fetchFn(input, { ...init, headers });
    const range = headers.get('range');
    if (!range) return response;
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return response;
    }
    if (
      response.status !== 206 ||
      !isValidContentRange(range, response.headers.get('content-range'))
    ) {
      await response.body?.cancel().catch(() => {});
      throw new WebDAVRangeUnsupportedError();
    }
    return response;
  };
  return fetcher;
};

class WebDAVRangeUnsupportedError extends Error {
  constructor() {
    super('The WebDAV server does not provide valid byte ranges.');
    this.name = 'WebDAVRangeUnsupportedError';
  }
}

const isValidContentRange = (requestedRange: string, header: string | null): boolean => {
  const requested = requestedRange.match(/^bytes=(\d+)-(\d+)$/);
  const returned = header?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if (!requested || !returned) return false;
  const requestedStart = Number(requested[1]);
  const requestedEnd = Number(requested[2]);
  const returnedStart = Number(returned[1]);
  const returnedEnd = Number(returned[2]);
  const total = Number(returned[3]);
  return (
    returnedStart === requestedStart &&
    returnedEnd >= returnedStart &&
    returnedEnd === Math.min(requestedEnd, total - 1) &&
    total > returnedEnd
  );
};

const isRangeUnsupported = (error: unknown): boolean =>
  error instanceof WebDAVRangeUnsupportedError;

const downloadToCache = async (
  host: WebDAVBookFileHost,
  settings: WebDAVSettings,
  sourcePath: string,
  filename: string,
  hash?: string,
): Promise<File> => {
  const cleanedName = filename.replaceAll(/[/\\:*?"<>|]/g, '_');
  const extension = cleanedName.match(/\.[^./\\]+$/)?.[0] ?? '';
  const stem = extension ? cleanedName.slice(0, -extension.length) : cleanedName;
  const safeName =
    `${stem.slice(0, Math.max(1, 140 - extension.length))}${extension}` || 'book.epub';
  const cacheName = `${CACHE_PREFIX}${hash ? `${hash}-` : ''}${crypto.randomUUID()}-${safeName}`;
  const absolutePath = await host.resolveCachePath(cacheName);
  try {
    await tauriDownload(
      buildWebDAVBookUrl(settings, sourcePath),
      absolutePath,
      undefined,
      { Authorization: buildBasicAuthHeader(settings.username, settings.password) },
      undefined,
      true,
    );
  } catch (error) {
    try {
      await host.removeFile(cacheName, 'Cache');
    } catch {
      // Remove a partial download when possible; Cache is OS-managed storage.
    }
    throw error;
  }
  let file: File;
  try {
    file = await host.openFile(cacheName, 'Cache', safeName);
  } catch (error) {
    try {
      await host.removeFile(cacheName, 'Cache');
    } catch {
      // Cache cleanup is best-effort; Cache is OS-managed storage.
    }
    throw error;
  }
  const closable = file as File & { close?: () => Promise<void> };
  const originalClose = closable.close?.bind(file);
  Object.defineProperty(closable, 'close', {
    configurable: true,
    value: async () => {
      try {
        await originalClose?.();
      } finally {
        try {
          await host.removeFile(cacheName, 'Cache');
        } catch {
          // Cache cleanup is best-effort; Cache is OS-managed storage.
        }
      }
    },
  });
  return file;
};

/** Open a WebDAV source by HTTP Range, falling back to an ephemeral Cache file. */
const openWebDAVSourceFile = async (
  host: WebDAVBookFileHost,
  settings: WebDAVSettings,
  sourcePath: string,
  filename: string,
  expectedHash?: string,
): Promise<File> => {
  const url = buildWebDAVBookUrl(settings, sourcePath);
  const fetcher = createWebDAVBookFetcher(settings, sourcePath);
  const remoteFile = new RemoteFile(url, filename, 'application/epub+zip', Date.now(), fetcher);
  try {
    await remoteFile._open_with_range();
    if (expectedHash) {
      const actualHash = await partialMD5(remoteFile);
      if (actualHash !== expectedHash) {
        throw new Error('This WebDAV file has changed. Add it again to import the new version.');
      }
    }
    return remoteFile;
  } catch (error) {
    await remoteFile.close().catch(() => {});
    if (!isRangeUnsupported(error)) throw error;
  }

  if (!isTauriAppPlatform()) {
    throw new Error('This WebDAV server does not support byte ranges in this app.');
  }
  const cachedFile = await downloadToCache(host, settings, sourcePath, filename, expectedHash);
  try {
    if (expectedHash) {
      const actualHash = await partialMD5(cachedFile);
      if (actualHash !== expectedHash) {
        throw new Error('This WebDAV file has changed. Add it again to import the new version.');
      }
    }
  } catch (error) {
    await (cachedFile as File & { close?: () => Promise<void> }).close?.();
    throw error;
  }
  return cachedFile;
};

/** Open a linked book and verify its bytes against the stored content hash. */
export const openWebDAVBookFile = async (fs: FileSystem, book: Book): Promise<File> => {
  if (!isWebDAVRemoteBook(book)) throw new Error('Book has no WebDAV source.');
  const settings = currentWebDAVSettings();
  if (!settings) throw new Error('Connect to WebDAV to open this book.');
  const sourcePath = validateWebDAVPath(book.remoteSource.path, settings.rootPath || '/');
  const filename = sourcePath.split('/').pop() || `${book.hash}.epub`;
  return openWebDAVSourceFile(
    {
      resolveCachePath: async (path) => fs.resolvePath(path, 'Cache').fp,
      openFile: (path, base, name) => fs.openFile(path, base, name),
      removeFile: (path, base) => fs.removeFile(path, base),
    },
    settings,
    sourcePath,
    filename,
    book.hash,
  );
};

export interface AddWebDAVBookResult {
  book: Book;
  added: boolean;
  sourceUpdated: boolean;
}

const saveLinkedBook = async (appService: AppService, book: Book, snapshot: Book[]) => {
  const state = useLibraryStore.getState();
  const current = state.libraryLoaded ? state.library : snapshot;
  const merged = [...new Map([...current, book].map((row) => [row.hash, row])).values()];
  // Publish before awaiting disk I/O, as libraryStore.updateBooks does. Never
  // replace the live shelf with the snapshot taken before network requests.
  state.setLibrary(merged);
  await appService.saveLibraryBooks(merged);
};

/** Import only metadata and sidecars; the source EPUB remains on WebDAV. */
export const addWebDAVBook = async (
  appService: AppService,
  settings: WebDAVSettings,
  entry: WebDAVEntry,
  books: Book[],
): Promise<AddWebDAVBookResult> => {
  if (entry.isDirectory || !/\.epub$/i.test(entry.name)) {
    throw new Error('Only EPUB files can be added as remote books.');
  }
  const sourcePath = validateWebDAVPath(entry.path, settings.rootPath || '/');
  const remoteFile = await openWebDAVSourceFile(
    {
      resolveCachePath: (path) => appService.resolveFilePath(path, 'Cache'),
      openFile: (path, base) => appService.openFile(path, base),
      removeFile: (path, base) => appService.deleteFile(path, base),
    },
    settings,
    sourcePath,
    entry.name,
  );
  try {
    const hash = await partialMD5(remoteFile);
    const state = useLibraryStore.getState();
    const currentBooks = state.libraryLoaded ? state.library : books;
    const existing = currentBooks.find((book) => book.hash === hash && !book.deletedAt);
    if (existing) {
      if (isWebDAVRemoteBook(existing)) {
        const changed = existing.remoteSource.path !== sourcePath;
        if (changed) {
          const now = Math.max(Date.now(), (existing.remoteSource.updatedAt ?? 0) + 1);
          existing.remoteSource = { provider: 'webdav', path: sourcePath, updatedAt: now };
          existing.updatedAt = now;
          existing.uploadedAt = null;
          existing.downloadedAt = null;
          await saveLinkedBook(appService, existing, books);
        }
        return { book: existing, added: false, sourceUpdated: changed };
      }
      return { book: existing, added: false, sourceUpdated: false };
    }

    const book = await appService.importBook(remoteFile, books, {
      saveBook: false,
      matchByMetadata: false,
    });
    if (!book) throw new Error('Import returned no book.');
    book.remoteSource = { provider: 'webdav', path: sourcePath, updatedAt: Date.now() };
    book.filePath = undefined;
    book.url = undefined;
    book.uploadedAt = null;
    book.downloadedAt = null;
    await saveLinkedBook(appService, book, books);
    return { book, added: true, sourceUpdated: false };
  } finally {
    await (remoteFile as File & { close?: () => Promise<void> }).close?.().catch(() => {});
  }
};
