import type { FileSystem } from '@/types/system';
import type { Book } from '@/types/book';
import type { WebDAVSettings } from '@/types/settings';
import { partialMD5 } from '@/utils/md5';
import { getWebDAVLibraryId } from './identity';

const LIMIT = 5;
interface CachedBook {
  hash: string;
  path: string;
  used: number;
}
type ClosableFile = File & { close?: () => Promise<void> };
let queue: Promise<unknown> = Promise.resolve();
const pins = new Map<string, number>();

function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.catch(() => {}).then(task);
  queue = next;
  return next;
}

function readManifest(key: string, dir: string): CachedBook[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(
      (row): row is CachedBook =>
        row &&
        typeof row.hash === 'string' &&
        typeof row.path === 'string' &&
        row.path.startsWith(`${dir}/`) &&
        /^[\w-]+\.epub$/.test(row.path.slice(dir.length + 1)) &&
        typeof row.used === 'number',
    );
  } catch {
    return [];
  }
}

async function prune(fs: FileSystem, key: string, dir: string) {
  const rows = readManifest(key, dir).sort((a, b) => b.used - a.used);
  const kept: CachedBook[] = [];
  for (const [index, row] of rows.entries()) {
    if (index < LIMIT || pins.has(row.path)) {
      kept.push(row);
      continue;
    }
    try {
      await fs.removeFile(row.path, 'Data');
    } catch {
      if (await fs.exists(row.path, 'Data')) kept.push(row);
    }
  }
  localStorage.setItem(key, JSON.stringify(kept));
}

/** Complete, verified local EPUBs; never stored in the synced Books tree. */
export function openCachedWebDAVBook(
  fs: FileSystem,
  book: Book,
  settings: WebDAVSettings,
  download: (absolutePath: string) => Promise<number | void>,
): Promise<File> {
  return serial(async () => {
    if (!/^[\w-]+$/.test(book.hash)) throw new Error('Invalid WebDAV book identity.');
    const id = getWebDAVLibraryId(settings);
    const dir = `webdav-library/${id}`;
    const key = `readest:webdav-cache:v1:${id}`;
    await fs.createDir(dir, 'Data', true);
    let rows = readManifest(key, dir);
    // A crash can leave a completed or partial unpublished download. It is
    // disposable, never a sidecar or an original, and never trusted on reopen.
    const owned = new Set(rows.map((row) => row.path));
    for (const entry of await fs.readDir(dir, 'Data')) {
      const path = `${dir}/${entry.path}`;
      if (/^[\w-]+\.epub$/.test(entry.path) && !owned.has(path) && !pins.has(path)) {
        await fs.removeFile(path, 'Data').catch(() => {});
      }
    }
    let row = rows.find((candidate) => candidate.hash === book.hash);
    let file: ClosableFile | undefined;
    if (row && (await fs.exists(row.path, 'Data'))) {
      file = await fs.openFile(row.path, 'Data');
      if ((await partialMD5(file)) !== book.hash) {
        await file.close?.();
        file = undefined;
        await fs.removeFile(row.path, 'Data');
      }
    }
    if (!file) {
      const path = `${dir}/${book.hash}-${crypto.randomUUID()}.epub`;
      try {
        const prefix = await fs.getPrefix('Data');
        const size = await download(`${prefix.replace(/\/+$/, '')}/${path}`);
        file = await fs.openFile(path, 'Data');
        if (
          (typeof size === 'number' && file.size !== size) ||
          (await partialMD5(file)) !== book.hash
        ) {
          throw new Error(
            'This WebDAV file has changed or the download is incomplete. Refresh the library.',
          );
        }
        row = { hash: book.hash, path, used: 0 };
      } catch (error) {
        await file?.close?.().catch(() => {});
        await fs.removeFile(path, 'Data').catch(() => {});
        throw error;
      }
    }
    const ready = row!;
    const used = Math.max(Date.now(), ...rows.map((candidate) => candidate.used + 1));
    rows = [...rows.filter((candidate) => candidate.hash !== book.hash), { ...ready, used }];
    try {
      localStorage.setItem(key, JSON.stringify(rows));
    } catch (error) {
      await file.close?.();
      throw error;
    }
    pins.set(ready.path, (pins.get(ready.path) ?? 0) + 1);
    const originalClose = file.close?.bind(file);
    let closed = false;
    Object.defineProperty(file, 'close', {
      configurable: true,
      value: async () => {
        if (closed) return;
        closed = true;
        try {
          await originalClose?.();
        } finally {
          await serial(async () => {
            const count = (pins.get(ready.path) ?? 1) - 1;
            if (count) pins.set(ready.path, count);
            else pins.delete(ready.path);
            await prune(fs, key, dir);
          });
        }
      },
    });
    await prune(fs, key, dir);
    return file;
  });
}
