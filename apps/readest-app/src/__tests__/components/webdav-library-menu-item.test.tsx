import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useSettingsStore } from '@/store/settingsStore';
import { WebDAVLibraryMenuItem } from '@/services/webdavLibrary/WebDAVLibraryMenuItem';

vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/components/MenuItem', () => ({
  default: ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button onClick={onClick}>{label}</button>
  ),
}));
afterEach(cleanup);

test('permanent menu action appears once configured and opens the library directly', () => {
  useSettingsStore.setState((state) => ({
    settings: {
      ...state.settings,
      webdav: { serverUrl: '', username: '', password: '', rootPath: '/', enabled: false },
    },
  }));
  const onOpen = vi.fn();
  const onCloseMenu = vi.fn();
  render(<WebDAVLibraryMenuItem onOpen={onOpen} onCloseMenu={onCloseMenu} />);
  expect(screen.queryByRole('button')).toBeNull();
  act(() =>
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        webdav: {
          serverUrl: 'https://example.test',
          username: 'u',
          password: 'p',
          rootPath: '/',
          enabled: true,
        },
      },
    })),
  );
  fireEvent.click(screen.getByRole('button', { name: 'WebDAV Library' }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onCloseMenu).toHaveBeenCalledWith(false);
});
