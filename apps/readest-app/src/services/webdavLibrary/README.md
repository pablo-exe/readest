# WebDAV source library (fork extension)

## User flow

Configure the existing WebDAV integration with its server URL and mounted root.
The root can have any name, including `/`; no `Libros/` convention is required.
On library startup, reconnect and foregrounding, the extension recursively scans
that root for EPUBs and registers them in Readest's ordinary homepage. It excludes
only the reserved `Readest/` sync directory immediately below the configured root.
Nested directories with the same name elsewhere remain ordinary source folders.

Original EPUBs stay in their server folders. Registration uses the existing
importer with `saveBook: false` and `matchByMetadata: false`: it saves metadata,
cover and config, then links the server source. Directory discovery uses PROPFIND;
initial metadata extraction reads each EPUB with authenticated HTTP ranges, or a
native temporary download on servers without range support. Startup is not blocked
and books appear progressively. The original integration explorer remains useful
for explicit file operations; the separate single-book catalog dialog was removed.

Folder paths relative to the mounted root become upstream groups/subgroups.
The server controls this grouping and source membership. Metadata edits, reading
progress and annotations still use upstream storage and WebDAV sidecar conflict
handling in `Readest/`, subject to the existing integration's enabled/sync toggles.
Configuring the mount is sufficient for discovery; it does not enable sync toggles.

## Reconciliation and preservation

`reconcile.ts` serializes scans and imports, waits for the persisted library and
merges into the live store rather than replacing an old snapshot. Its device-local
catalog uses server ETags, or size plus modification date, to skip unchanged
metadata. Without usable validators it rechecks content identity on each scan.
Completed metadata is checkpointed every 20 imports and at the end; an interrupted
initial scan can safely repeat a few metadata reads on the next launch.

A moved EPUB with the same Readest content hash keeps its existing book identity,
progress and annotations. Readest deduplicates identical content: copies in several
folders share one row; an already linked path is preferred when still present.
A replacement with a different hash registers as a new version. The former row is
marked `remoteSource.missing`, retained with its sidecars, and excluded from the
shelf. Confirmed removals behave the same way. No deletion tombstone or provider
file deletion is issued by discovery. Reappearing content reuses its saved state.
Annotations are not automatically transplanted to a different EPUB version.

A failed root scan leaves the existing library untouched. Failed subtrees and
failed imports retain their prior source rows and report an incomplete refresh.
Malformed/non-WebDAV XML is an error, never an empty catalog. XML entities in hrefs
are decoded once before URL escapes, including `&amp;`, numeric entities and
literal `%` names. A canceled scan cannot publish a reference after metadata import.

## Offline cache

Native desktop, Android and iOS reading stores a complete EPUB before opening it,
checks its length when the transfer provides one and checks the existing partial
MD5 content identity. This adds a full transfer on the first open of each book;
subsequent opens use the local file without contacting the server. Offline reading
is guaranteed only after the first download finishes successfully.

`cache.ts` keeps the five most recently opened books per mounted library. Open
handles are pinned: temporarily more than five files can exist while older books
are still open; eviction runs again on close. Interrupted/unpublished downloads
are disposable and cleaned on a subsequent cache open. Covers and configurations
are independent of this five-EPUB limit and are never evicted by the cache.

EPUB cache files live in the app's `Data/webdav-library/<mount-id>/`, outside synced
`Books/` and outside the OS-managed Cache directory. The localStorage manifest
`readest:webdav-cache:v1:<mount-id>` is published only after verification; the
catalog key is `readest:webdav-catalog:v1:<mount-id>`. Neither contains credentials.
Mount IDs hash server URL, username and root; passwords remain exclusively in the
existing settings. Clearing app storage loses the disposable cache/index, not the
server EPUBs. Restoring only sidecars requires a new scan; preserving offline cache
across device restoration also requires its local files and WebView storage.
Browser builds retain the prior remote-range reader; the automatic library and
persistent offline cache are supported on native apps.

## Isolation and validation

All discovery, reconciliation, startup and cache behavior lives in this folder.
The library page mounts one hook; upstream bookshelf/store filtering uses only the
pure `remoteBook.ts` policy. Content resolution uses the existing `bookSource.ts`
adapter. No reader, cards, groups or sync engine are copied.

From `apps/readest-app`:

```text
pnpm test --run src/__tests__/services/webdav-library src/__tests__/services/webdav-list-directory.test.ts src/__tests__/services/webdav-encode-path.test.ts src/__tests__/services/book-content-source.test.ts src/__tests__/services/sync/file src/__tests__/store/reader-store.test.ts src/__tests__/app/library
pnpm lint
pnpm test --run
```

Tests use synthetic entries/EPUB bytes and mocked native transport. They cover
arbitrary mount roots, reserved-directory exclusion, XML/URL encoding, incremental
scans, moves, replacements, incomplete scans, grouping, startup/reconnect,
cancellation, persisted offline reuse, verification, eviction and pinned handles.
Native filesystem/HTTP behavior still requires device checks on iOS and Android;
unit tests do not establish that an IPA/APK has been built or installed.

See [REBASE.md](./REBASE.md) for the upstream integration points and rollback.

## Local validation — 2026-09-30

Validated in an exported checkout with synthetic WebDAV responses and temporary
storage, without contacting the production server. The 33 feature tests passed,
including a project EPUB fixture through the actual importer and filesystem:
cover/config persisted, no managed EPUB, and cache reopening without network.
The broader affected-area run covered 677 tests; one unrelated novel-dialog test
hit its timeout under concurrent load and its complete 12-test file passed when
rerun alone. TypeScript and Biome lint passed without warnings.

The full suite ran 1,019 files: 12,057 tests passed, with 36 existing failures
reproduced against the pre-change checkout, plus the new malformed-XML regression
while its fix was being prepared. That regression passes with the final parser.
Three PDF suites additionally required generated vendor resources in the isolated
checkout; after `pnpm setup-vendors`, all 51 tests in those files passed. Remaining
baseline failures concern generated ZIP/Blob fixtures in documents, dictionaries
and novel conversion. The full suite is therefore not claimed entirely green.
No native IPA/APK build, device install or production deployment was performed.
