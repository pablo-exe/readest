import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test } from 'vitest';

const root = join(process.cwd(), 'src');
const feature = 'services/webdavLibrary/';
const prefix = '@/services/webdavLibrary/';
const adapters: Record<string, string[]> = {
  bookSource: ['services/bookContent.ts', 'services/bookService.ts'],
  WebDAVLibraryDialog: ['app/library/page.tsx'],
  WebDAVLibraryMenuItem: ['app/library/components/SettingsMenu.tsx'],
  WebDAVRemoteBookAction: ['components/settings/integrations/WebDAVBrowsePane.tsx'],
};

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__') return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function imports(path: string) {
  return [
    ...readFileSync(path, 'utf8').matchAll(
      /\bimport\s+(type\s+)?(?:[^;]*?\bfrom\s*)?['"]([^'"]+)['"]/g,
    ),
  ].map((match) => ({ module: match[2]!, typeOnly: !!match[1] }));
}

test('core consumers use explicit feature adapters; transport and UI cannot spread into new callsites', () => {
  const violations: string[] = [];
  for (const path of files(root)) {
    const name = relative(root, path).replaceAll('\\', '/');
    if (name.startsWith(feature)) continue;
    for (const { module } of imports(path)) {
      if (!module.startsWith(prefix)) continue;
      const entrypoint = module.slice(prefix.length);
      // The pure policy module has no runtime dependencies and is safe anywhere.
      if (entrypoint === 'remoteBook') continue;
      if (!adapters[entrypoint]?.includes(name)) violations.push(`${name}: ${module}`);
    }
  }
  expect(violations).toEqual([]);
});

test('sync policies have no runtime imports, and the extension does not depend on route implementations', () => {
  const violations: string[] = [];
  for (const path of files(join(root, feature))) {
    for (const { module, typeOnly } of imports(path)) {
      if (path.endsWith('remoteBook.ts') && !typeOnly) violations.push(module);
      if (
        module.startsWith('@/app/') ||
        module === '@/services/bookService' ||
        module === '@/services/sync/file/engine' ||
        module === '@/services/sync/file/merge'
      )
        violations.push(module);
    }
  }
  expect(violations).toEqual([]);
});
