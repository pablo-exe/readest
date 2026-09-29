import type { WebDAVSettings } from '@/types/settings';
import { listDirectory, type WebDAVEntry } from '@/services/sync/providers/webdav/client';

export interface WebDAVCatalog {
  entries: WebDAVEntry[];
}

export function webDAVLibraryRoot(settings: WebDAVSettings): string {
  return `/${(settings.rootPath || '/').split('/').filter(Boolean).join('/')}`;
}

function isLibraryPath(path: string, root: string): boolean {
  const prefix = root === '/' ? '/' : `${root}/`;
  const reserved = `${root === '/' ? '' : root}/Readest`;
  return (
    path.startsWith(prefix) &&
    path !== root &&
    path !== reserved &&
    !path.startsWith(`${reserved}/`) &&
    !path
      .split('/')
      .some((part) => part === '..' || part === '.' || part.includes('\\') || part.includes('\0'))
  );
}

/** Fetch only the selected folder. Never download EPUB bytes or traverse sidecars. */
export async function listWebDAVLibraryFolder(
  settings: WebDAVSettings,
  directory: string,
  signal?: AbortSignal,
): Promise<WebDAVCatalog> {
  const root = webDAVLibraryRoot(settings);
  if (directory !== root && !isLibraryPath(directory, root))
    throw new Error('Invalid library folder');
  signal?.throwIfAborted();
  const entries = await listDirectory(settings, directory, true);
  signal?.throwIfAborted();
  const unique = new Map<string, WebDAVEntry>();
  for (const entry of entries) {
    const path = entry.path.replace(/\/+$/, '');
    const parent = path.slice(0, path.lastIndexOf('/')) || '/';
    if (parent !== directory || !isLibraryPath(path, root)) continue;
    if (entry.isDirectory || /\.epub$/i.test(entry.name)) unique.set(path, { ...entry, path });
  }
  return {
    entries: [...unique.values()].sort(
      (a, b) =>
        Number(b.isDirectory) - Number(a.isDirectory) ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    ),
  };
}
