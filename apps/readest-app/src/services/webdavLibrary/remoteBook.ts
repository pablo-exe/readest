import type { Book } from '@/types/book';

/** True when a book's content is addressed by a WebDAV path instead of a local file. */
export const isWebDAVRemoteBook = (
  book: Book | null | undefined,
): book is Book & { remoteSource: NonNullable<Book['remoteSource']> } =>
  book?.remoteSource?.provider === 'webdav';

/** Source references and their sidecars belong exclusively to their provider. */
export const canSyncBookWithBackend = (book: Book, backend: string): boolean =>
  !isWebDAVRemoteBook(book) || backend === 'webdav';

export const filterBooksForBackend = (books: Book[], backend: string): Book[] =>
  backend === 'webdav' ? books : books.filter((book) => canSyncBookWithBackend(book, backend));

/** Absence in an older client is never a request to clear a source reference. */
export const mergeWebDAVSource = (local: Book, remote: Book): Book['remoteSource'] => {
  const localSource = local.remoteSource;
  const remoteSource = remote.remoteSource;
  if (!localSource) return remoteSource;
  if (!remoteSource) return localSource;
  return (remoteSource.updatedAt ?? 0) > (localSource.updatedAt ?? 0) ? remoteSource : localSource;
};

/** Missing sources stay in the index to preserve their notes, but leave the shelf. */
export const isWebDAVBookMissing = (book: Book): boolean =>
  isWebDAVRemoteBook(book) && book.remoteSource.missing === true;
