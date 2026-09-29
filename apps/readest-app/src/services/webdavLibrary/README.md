# WebDAV source library (fork extension)

## User flow

Configure the existing WebDAV integration with the library URL and root folder.
The URL may already point to the books folder; no directory name is assumed or
appended. Open **Main menu → WebDAV Library** once configured (the + action also
remains available). Browse folders and subfolders, or search entries in the current
folder. Select an EPUB to read it directly. Refresh reloads the current folder.
The reserved `<root>/Readest` sidecar directory is excluded.

Listing uses PROPFIND only. Selecting a new book imports metadata, a cover and
configuration, then opens the reader. It does not persist the EPUB in Books or
upload it into Readest's sync directory. Known books open without reimporting.
Metadata for unread books is represented by the filename; listing does not parse
every EPUB or fetch every cover. The existing integration explorer remains usable
for other files and for explicit downloads.

Reading prefers HTTP byte ranges. A server that does not support ranges falls
back to a unique native Cache file that is removed on close. Cache is temporary,
so this flow requires a connection. Source hashes detect replaced EPUB files.
The feature supports the existing single WebDAV account configuration in Tauri
(desktop, Android and iOS). It is not an offline-download or multi-account system.

## Isolation and rebase seams

- `catalog.ts`: one metadata request per visited folder, configured-root validation,
  direct-child filtering, deduplication and cancellation checks. No global state or
  reader imports. Failed folders display an error with retry and parent navigation.
- `WebDAVLibraryDialog.tsx`: folder navigation, search, virtualized rows, and lazy
  book registration. Reader navigation comes from the existing library page callback.
- `WebDAVLibraryMenuItem.tsx`: configured-account visibility and permanent menu
  action. The original SettingsMenu mounts this adapter and forwards the callback.
- `bookSource.ts`: authenticated content access, range validation, temporary native
  fallback, content identity and metadata-only registration. Credentials are read
  from existing settings and never embedded in the source reference or index.
- `remoteBook.ts`: pure identification, backend eligibility and source merge
  policies for generic sync and reader consumers. No runtime imports.
- `WebDAVRemoteBookAction.tsx`: explorer button, import state and notifications;
  the original explorer only mounts this adapter.
- `Book.remoteSource`: additive wire-compatible source reference. The path is
  decoded and relative to serverUrl, including a leading slash. Source clocks are
  merged separately from the book metadata clock. No wire schema migration.

The original library menu/header/page only forward an optional action and host
the dialog. The existing WebDAV client adds an optional decoded-path argument
for safely following its own decoded entries (including literal `%20` names).

Generic book resolution opens a linked source through this adapter. The existing
importer receives `saveBook: false` and `matchByMetadata: false`; other imports
retain their defaults. Generic file sync preserves source references and discovers
source-only index rows without requiring a binary. Automatic and manual sync
entrypoints exclude linked books from other providers. Native Readest Cloud
metadata, progress, notes and transfers exclude source-linked books. WebDAV
sidecars still use the existing engine and conflict handling.

Reader close evicts streamed book data synchronously, then closes the captured old
file asynchronously. New reads therefore cannot reuse a closed file or lose their
cache when an older close completes. Registration merges the selected book into
the current shelf, avoiding replacement with a stale network-request snapshot.

See [REBASE.md](./REBASE.md) for the integration map, invariants and post-rebase
checks. Boundary tests keep transport/UI entrypoints restricted to their adapters.

## Verification

Regression tests cover folder navigation, unreadable folders, cancellation,
path encoding, range authentication, truncated ranges, fallback cleanup,
temporary-name limits, concurrent library changes, source-only sync discovery,
manual provider isolation, rapid reader reopening and the catalog read flow.

Run from the application directory:

```text
pnpm test --run src/__tests__/services/webdav-library-catalog.test.ts src/__tests__/services/webdav-library-source.test.ts src/__tests__/components/webdav-library-dialog.test.tsx src/__tests__/components/settings/fileSyncFormSyncNow.test.tsx src/__tests__/services/sync/file src/__tests__/store/reader-store.test.ts
pnpm lint
pnpm test:browser src/__tests__/components/webdav-library-dialog.browser.test.tsx
```

Native HTTP/Cache behavior also needs verification against a real WebDAV server
on each target device. Unit mocks verify the contract, not the native transport.
The browser checks exercise the real dialog and virtualized list at desktop and
mobile sizes, including e-ink mode, with a simulated 1,000-book catalog.
