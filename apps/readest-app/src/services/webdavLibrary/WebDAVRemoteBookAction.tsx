import clsx from 'clsx';
import { useRef, useState } from 'react';
import { MdCheck, MdLink } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { isTauriAppPlatform } from '@/services/environment';
import type { WebDAVSettings } from '@/types/settings';
import type { WebDAVEntry } from '@/services/sync/providers/webdav/client';
import { eventDispatcher } from '@/utils/event';
import { addWebDAVBook } from './bookSource';

/** Optional explorer action; all fork-specific state stays inside this component. */
export function WebDAVRemoteBookAction({
  settings,
  entry,
}: {
  settings: WebDAVSettings;
  entry: WebDAVEntry;
}) {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const [status, setStatus] = useState<'adding' | 'done' | 'error' | null>(null);
  const inFlight = useRef(false);
  if (entry.isDirectory || !/\.epub$/i.test(entry.name)) return null;

  const add = async () => {
    if (inFlight.current || status === 'done') return;
    if (!isTauriAppPlatform()) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Remote WebDAV books are only supported in the desktop and mobile apps.'),
      });
      return;
    }
    inFlight.current = true;
    setStatus('adding');
    try {
      const appService = await envConfig.getAppService();
      const { library, libraryLoaded } = useLibraryStore.getState();
      const books = libraryLoaded ? [...library] : await appService.loadLibraryBooks();
      const result = await addWebDAVBook(appService, settings, entry, books);
      setStatus('done');
      const message = result.added
        ? _('Added "{{title}}" as a remote WebDAV book.', {
            title: result.book.title || entry.name,
          })
        : result.sourceUpdated
          ? _('Updated the WebDAV source for "{{title}}".', {
              title: result.book.title || entry.name,
            })
          : _('"{{title}}" is already in your library.', {
              title: result.book.title || entry.name,
            });
      eventDispatcher.dispatch('toast', { type: 'info', message });
    } catch (error) {
      setStatus('error');
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to add "{{name}}": {{error}}', {
          name: entry.name,
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    } finally {
      inFlight.current = false;
    }
  };

  const label =
    status === 'done'
      ? _('Already added in this session')
      : status === 'adding'
        ? _('Adding remote book…')
        : _('Add as remote book');
  return (
    <button
      type='button'
      onClick={(event) => {
        event.stopPropagation();
        void add();
      }}
      disabled={status === 'adding' || status === 'done'}
      className={clsx(
        'btn btn-ghost btn-sm h-8 min-h-8 shrink-0 px-2',
        (status === 'adding' || status === 'done') && 'opacity-60',
      )}
      title={label}
      aria-label={label}
    >
      {status === 'adding' ? (
        <span className='loading loading-spinner loading-xs' />
      ) : status === 'done' ? (
        <MdCheck className='h-4 w-4' />
      ) : (
        <MdLink className='h-4 w-4' />
      )}
    </button>
  );
}
