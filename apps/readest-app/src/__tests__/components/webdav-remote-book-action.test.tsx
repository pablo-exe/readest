import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { WebDAVRemoteBookAction } from '@/services/webdavLibrary/WebDAVRemoteBookAction';
const mocks = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@/services/webdavLibrary/bookSource', () => ({ addWebDAVBook: mocks.add }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: async () => ({ loadLibraryBooks: async () => [] }) },
  }),
}));
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => true,
}));
const settings = {
  serverUrl: 'https://example.test',
  rootPath: '/',
  username: 'u',
  password: 'p',
  enabled: true,
};
const entry = { name: 'Book.epub', path: '/Libros/Book.epub', isDirectory: false };
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

test('the isolated explorer action registers a book and prevents duplicate clicks while pending', async () => {
  let finish!: () => void;
  mocks.add.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ added: true, book: { title: 'Book' } });
      }),
  );
  render(<WebDAVRemoteBookAction settings={settings} entry={entry} />);
  const button = screen.getByRole('button', { name: 'Add as remote book' });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(mocks.add).toHaveBeenCalledTimes(1));
  expect(mocks.add.mock.calls[0]?.[2]).toEqual(entry);
  finish();
  await screen.findByRole('button', { name: 'Already added in this session' });
});

test('a failed registration remains retryable', async () => {
  mocks.add
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ added: true, book: { title: 'Book' } });
  render(<WebDAVRemoteBookAction settings={settings} entry={entry} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add as remote book' }));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Add as remote book' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add as remote book' }));
  await screen.findByRole('button', { name: 'Already added in this session' });
  expect(mocks.add).toHaveBeenCalledTimes(2);
});

test('directories and other formats have no remote EPUB action', () => {
  const { rerender } = render(
    <WebDAVRemoteBookAction settings={settings} entry={{ ...entry, isDirectory: true }} />,
  );
  expect(screen.queryByRole('button')).toBeNull();
  rerender(<WebDAVRemoteBookAction settings={settings} entry={{ ...entry, name: 'Book.pdf' }} />);
  expect(screen.queryByRole('button')).toBeNull();
});
