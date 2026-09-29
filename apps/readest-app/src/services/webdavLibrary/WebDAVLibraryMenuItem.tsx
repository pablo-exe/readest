import { MdMenuBook } from 'react-icons/md';
import MenuItem from '@/components/MenuItem';
import { useTranslation } from '@/hooks/useTranslation';
import { isTauriAppPlatform } from '@/services/environment';
import { useSettingsStore } from '@/store/settingsStore';

/** Keeps account visibility and the fork's menu action outside the original menu. */
export function WebDAVLibraryMenuItem({
  onOpen,
  onCloseMenu,
}: {
  onOpen?: () => void;
  onCloseMenu?: (open: boolean) => void;
}) {
  const _ = useTranslation();
  const settings = useSettingsStore((state) => state.settings.webdav);
  if (!isTauriAppPlatform() || !settings?.serverUrl || !settings.username || !onOpen) return null;
  return (
    <MenuItem
      label={_('WebDAV Library')}
      Icon={MdMenuBook}
      onClick={() => {
        onCloseMenu?.(false);
        onOpen();
      }}
    />
  );
}
