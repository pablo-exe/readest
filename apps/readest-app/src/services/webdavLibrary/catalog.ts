import { getWebDAVRoot } from './identity';
import type { WebDAVSettings } from '@/types/settings';
import { listDirectory, type WebDAVEntry } from '@/services/sync/providers/webdav/client';

export interface WebDAVCatalog {
  entries: WebDAVEntry[];
  failedDirectories: string[];
}

/** Metadata-only walk. Never scans Readest's sidecars or downloads EPUB bytes. */
export async function scanWebDAVLibrary(
  settings: WebDAVSettings,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<WebDAVCatalog> {
  const libraryRoot = getWebDAVRoot(settings);
  const prefix = libraryRoot === '/' ? '/' : `${libraryRoot}/`;
  const syncRoot = `${libraryRoot === '/' ? '' : libraryRoot}/Readest`;
  const pending = [libraryRoot];
  const visited = new Set<string>(pending);
  const books = new Map<string, WebDAVEntry>();
  const failedDirectories: string[] = [];
  let completed = 0;
  while (pending.length) {
    signal?.throwIfAborted();
    const batch = pending.splice(0, 4);
    const results = await Promise.allSettled(
      batch.map((path) => listDirectory(settings, path, true)),
    );
    signal?.throwIfAborted();
    for (const [index, result] of results.entries()) {
      const directory = batch[index]!;
      if (result.status === 'rejected') {
        if (directory === libraryRoot) throw result.reason;
        failedDirectories.push(directory);
        continue;
      }
      for (const entry of result.value) {
        const path = entry.path.replace(/\/+$/, '');
        if (
          !path.startsWith(prefix) ||
          path === syncRoot ||
          path.startsWith(`${syncRoot}/`) ||
          path
            .split('/')
            .some(
              (part) => part === '..' || part === '.' || part.includes('\\') || part.includes('\0'),
            )
        )
          continue;
        if (entry.isDirectory) {
          if (!visited.has(path)) {
            visited.add(path);
            pending.push(path);
          }
        } else if (/\.epub$/i.test(entry.name)) {
          books.set(path, { ...entry, path });
        }
      }
    }
    completed += batch.length;
    onProgress?.(completed / visited.size);
  }
  return {
    entries: [...books.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    ),
    failedDirectories,
  };
}
