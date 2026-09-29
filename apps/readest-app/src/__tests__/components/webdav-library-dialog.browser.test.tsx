import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { page } from 'vitest/browser';
import type { Book } from '@/types/book';

const mocks = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? name)),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null, envConfig: { getAppService: async () => ({}) } }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));
vi.mock('@/services/webdavLibrary/bookSource', () => ({ addWebDAVBook: mocks.add }));
vi.mock('@/services/webdavLibrary/catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/webdavLibrary/catalog')>()),
  listWebDAVLibraryFolder: async (_settings: unknown, path: string) => ({
    entries:
      path === '/'
        ? [{ name: 'Authors', path: '/Authors', isDirectory: true }]
        : Array.from({ length: 1000 }, (_, index) => ({
            name: `Book ${index}.epub`,
            path: `/Authors/Book ${index}.epub`,
            isDirectory: false,
          })),
  }),
}));

const { WebDAVLibraryDialog } = await import('@/services/webdavLibrary/WebDAVLibraryDialog');
const { useSettingsStore } = await import('@/store/settingsStore');
const { useLibraryStore } = await import('@/store/libraryStore');
await import('@/styles/globals.css');
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-eink');
});

for (const [name, width, height, eink] of [
  ['desktop', 1200, 800, false],
  ['mobile eink', 390, 844, true],
] as const) {
  test(`catalog has a visible, virtualized, searchable reader action on ${name}`, async () => {
    await page.viewport(width, height);
    if (eink) document.documentElement.setAttribute('data-eink', 'true');
    useLibraryStore.getState().setLibrary([]);
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        webdav: {
          enabled: true,
          serverUrl: 'https://example.test',
          username: 'u',
          password: 'p',
          rootPath: '/',
        },
      },
    }));
    const onOpenBook = vi.fn();
    const book = { hash: 'book999', title: 'Book 999' } as Book;
    mocks.add.mockResolvedValue({ book });
    render(<WebDAVLibraryDialog onClose={vi.fn()} onOpenBook={onOpenBook} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open folder Authors' }));
    const first = await screen.findByRole('button', { name: 'Open Book 0' });
    await waitFor(() => expect(first.getBoundingClientRect().height).toBeGreaterThan(40));
    const rect = first.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.bottom).toBeLessThan(height);
    expect(rect.right).toBeLessThanOrEqual(width);
    expect(screen.getAllByRole('button', { name: /^Open Book/ }).length).toBeLessThan(100);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Book 999' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Open Book 999' }));
    await waitFor(() => expect(onOpenBook).toHaveBeenCalledWith(book));
  });
}
