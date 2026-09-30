'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { MdMenuBook, MdRefresh, MdSearch } from 'react-icons/md';
import Dialog from '@/components/Dialog';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { Book } from '@/types/book';
import type { WebDAVEntry } from '@/services/sync/providers/webdav/client';
import { addWebDAVBook } from './bookSource';
import { scanWebDAVLibrary, type WebDAVCatalog } from './catalog';
import { isWebDAVRemoteBook } from './remoteBook';

interface Props {
  onClose: () => void;
  onOpenBook: (book: Book) => void;
}

/** The catalog stays separate from Readest's local shelf until a book is opened. */
export function WebDAVLibraryDialog({ onClose, onOpenBook }: Props) {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const settings = useSettingsStore((state) => state.settings.webdav);
  const library = useLibraryStore((state) => state.library);
  const [catalog, setCatalog] = useState<WebDAVCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  const openingRef = useRef(false);
  const configured = !!settings?.serverUrl && !!settings.username;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setCatalog(null);
    setError(false);
    if (!configured || !settings) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    void scanWebDAVLibrary(settings, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setCatalog(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    configured,
    settings?.serverUrl,
    settings?.username,
    settings?.password,
    settings?.rootPath,
    revision,
  ]);

  const booksByPath = useMemo(
    () =>
      new Map(
        library
          .filter((book) => !book.deletedAt && isWebDAVRemoteBook(book))
          .map((book) => [book.remoteSource!.path, book]),
      ),
    [library],
  );
  const entries = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return (catalog?.entries ?? []).filter((entry) => {
      const book = booksByPath.get(entry.path);
      return (
        !search ||
        `${entry.name} ${entry.path} ${book?.title ?? ''} ${book?.author ?? ''}`
          .toLocaleLowerCase()
          .includes(search)
      );
    });
  }, [catalog, query, booksByPath]);

  const openBook = useCallback(
    async (entry: WebDAVEntry) => {
      if (!settings || openingRef.current) return;
      openingRef.current = true;
      setOpening(entry.path);
      setError(false);
      try {
        let book = booksByPath.get(entry.path);
        if (!book) {
          const appService = await envConfig.getAppService();
          const state = useLibraryStore.getState();
          const books = state.libraryLoaded
            ? [...state.library]
            : await appService.loadLibraryBooks();
          book = (await addWebDAVBook(appService, settings, entry, books)).book;
        }
        if (mounted.current) onOpenBook(book);
      } catch {
        if (mounted.current) setError(true);
      } finally {
        openingRef.current = false;
        if (mounted.current) setOpening(null);
      }
    },
    [settings, booksByPath, envConfig, onOpenBook],
  );

  return (
    <Dialog
      isOpen
      title={_('WebDAV Library')}
      onClose={onClose}
      boxClassName='w-full sm:h-[85dvh]! sm:w-3/4! sm:max-w-4xl!'
      contentClassName='flex min-h-0 flex-1 flex-col overflow-hidden! px-0!'
    >
      <div className='flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4'>
        {!configured ? (
          <p>{_('Configure WebDAV in Settings → Integrations to browse your library.')}</p>
        ) : (
          <>
            <p className='text-sm'>
              {_('All EPUB books in Libros and its subfolders. Select a book to read it.')}
            </p>
            <div className='flex items-center gap-2'>
              <label className='input eink-bordered flex flex-1 items-center gap-2'>
                <MdSearch aria-hidden className='h-5 w-5' />
                <input
                  type='search'
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label={_('Search books')}
                  placeholder={_('Search books')}
                  className='min-w-0 grow'
                />
              </label>
              <button
                type='button'
                className='btn btn-ghost btn-circle touch-target'
                aria-label={_('Refresh')}
                disabled={loading || !!opening}
                onClick={() => setRevision((value) => value + 1)}
              >
                <MdRefresh aria-hidden className='h-6 w-6' />
              </button>
            </div>
            {error && (
              <div
                role='alert'
                className='eink-bordered border-base-300 rounded-lg border p-3 text-sm'
              >
                {catalog
                  ? _('Unable to open this WebDAV book. Check your connection and try again.')
                  : _(
                      'Unable to load the WebDAV library. Check your connection and the Libros folder, then refresh.',
                    )}
              </div>
            )}
            {!!catalog?.failedDirectories.length && (
              <p role='alert' className='text-sm'>
                {_('Some folders could not be read. Refresh to retry; this list is incomplete.')}
              </p>
            )}
            {loading ? (
              <p role='status'>{_('Loading WebDAV library…')}</p>
            ) : (
              <>
                {catalog && (
                  <p role='status' className='text-sm'>
                    {_('{{count}} book(s)', { count: entries.length })}
                  </p>
                )}
                {catalog && !entries.length && (
                  <p>{query ? _('No books found') : _('No EPUB books found in Libros.')}</p>
                )}
                {!!entries.length && (
                  <Virtuoso
                    style={{ flex: 1, minHeight: 0 }}
                    data={entries}
                    computeItemKey={(_index, entry) => entry.path}
                    itemContent={(_index, entry) => {
                      const book = booksByPath.get(entry.path);
                      const title = book?.title || entry.name.replace(/\.epub$/i, '');
                      return (
                        <button
                          type='button'
                          disabled={!!opening}
                          onClick={() => void openBook(entry)}
                          aria-label={_('Open {{title}}', { title })}
                          className='eink-bordered border-base-200 hover:bg-base-200 focus-visible:ring-base-content/15 flex min-h-16 w-full items-center gap-3 border-b px-3 py-3 text-start transition-colors focus-visible:ring-2'
                        >
                          <MdMenuBook aria-hidden className='h-7 w-7 shrink-0' />
                          <span className='min-w-0 flex-1'>
                            <span className='block truncate font-medium'>{title}</span>
                            <span className='block truncate text-sm'>
                              {book?.author || entry.path}
                            </span>
                          </span>
                          <span className='shrink-0 text-sm'>
                            {opening === entry.path ? _('Opening…') : _('Read')}
                          </span>
                        </button>
                      );
                    }}
                  />
                )}
              </>
            )}
            {opening && (
              <p role='status' className='text-sm'>
                {_('Opening book from WebDAV…')}
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
