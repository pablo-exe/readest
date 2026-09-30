import type { WebDAVSettings } from '@/types/settings';
import { md5 } from '@/utils/md5';

export const getWebDAVRoot = (settings: WebDAVSettings): string =>
  `/${settings.rootPath.split('/').filter(Boolean).join('/')}`;

/** Device-local namespaces never contain credentials or change on password rotation. */
export const getWebDAVLibraryId = (settings: WebDAVSettings): string =>
  md5(
    JSON.stringify([
      settings.serverUrl.replace(/\/+$/, ''),
      settings.username,
      getWebDAVRoot(settings),
    ]),
  );
