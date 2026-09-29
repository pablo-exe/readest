import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { WebDAVEntry } from '@/services/sync/providers/webdav/client';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { WebDAVLibraryDialog } from '@/services/webdavLibrary/WebDAVLibraryDialog';

const mocks = vi.hoisted(() => ({ scan: vi.fn(), add: vi.fn(), load: vi.fn(async () => []) }));
vi.mock('@/services/webdavLibrary/catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/webdavLibrary/catalog')>()),
  listWebDAVLibraryFolder: mocks.scan,
}));
vi.mock('@/services/webdavLibrary/bookSource', () => ({ addWebDAVBook: mocks.add }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? name)),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { getAppService: async () => ({ loadLibraryBooks: mocks.load }) } }),
}));
vi.mock('@/components/Dialog', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div role='dialog'>{children}</div>,
}));
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: WebDAVEntry[];
    itemContent: (index: number, entry: WebDAVEntry) => React.ReactNode;
  }) => (
    <div>
      {data.map((entry, index) => (
        <div key={entry.path}>{itemContent(index, entry)}</div>
      ))}
    </div>
  ),
}));

const entries = ['Alpha', 'Beta'].map((name) => ({
  name: `${name}.epub`,
  path: `/Libros/${name}.epub`,
  isDirectory: false,
}));
beforeEach(() => {
  vi.clearAllMocks();
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
  mocks.scan.mockResolvedValue({ entries });
});
afterEach(cleanup);

test('shows every catalog entry without importing, searches, and imports only the selected book', async () => {
  const onOpenBook = vi.fn();
  const book = { hash: 'alpha', title: 'Alpha' } as Book;
  mocks.add.mockResolvedValue({ book });
  render(<WebDAVLibraryDialog onClose={vi.fn()} onOpenBook={onOpenBook} />);
  await screen.findByRole('button', { name: 'Open Alpha' });
  expect(screen.getByRole('button', { name: 'Open Beta' })).toBeDefined();
  expect(mocks.add).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Alpha' } });
  expect(screen.queryByRole('button', { name: 'Open Beta' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open Alpha' }));
  await waitFor(() => expect(onOpenBook).toHaveBeenCalledWith(book));
  expect(mocks.add).toHaveBeenCalledTimes(1);
  expect(mocks.add.mock.calls[0]?.[2]).toEqual(entries[0]);
});

test('reopens a known source directly without reimporting it', async () => {
  const book = {
    hash: 'alpha',
    title: 'Alpha',
    remoteSource: { provider: 'webdav', path: '/Libros/Alpha.epub', updatedAt: 1 },
  } as Book;
  useLibraryStore.getState().setLibrary([book]);
  const onOpenBook = vi.fn();
  render(<WebDAVLibraryDialog onClose={vi.fn()} onOpenBook={onOpenBook} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open Alpha' }));
  await waitFor(() => expect(onOpenBook).toHaveBeenCalledWith(book));
  expect(mocks.add).not.toHaveBeenCalled();
});

test('offers refresh after a listing failure', async () => {
  mocks.scan.mockRejectedValueOnce(new Error('offline'));
  render(<WebDAVLibraryDialog onClose={vi.fn()} onOpenBook={vi.fn()} />);
  expect(await screen.findByRole('alert')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByRole('button', { name: 'Open Alpha' });
  expect(screen.queryByRole('alert')).toBeNull();
});

test('navigates folders and back without registering books', async () => {
  mocks.scan.mockImplementation(async (_settings, path: string) => ({
    entries: path === '/' ? [{ name: 'Authors', path: '/Authors', isDirectory: true }] : entries,
  }));
  render(<WebDAVLibraryDialog onClose={vi.fn()} onOpenBook={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open folder Authors' }));
  await screen.findByRole('button', { name: 'Open Alpha' });
  expect(mocks.scan.mock.calls.at(-1)?.[1]).toBe('/Authors');
  expect(mocks.add).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  await screen.findByRole('button', { name: 'Open folder Authors' });
  expect(mocks.scan.mock.calls.at(-1)?.[1]).toBe('/');
});
