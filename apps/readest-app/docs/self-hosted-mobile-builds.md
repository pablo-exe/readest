# Self-hosted mobile builds

The fork workflows build an ARM64 Android debug APK and an unsigned iOS IPA
from `codex/ios-selfhosted-ipa` (push or manual workflow dispatch). Neither
workflow deploys to a device. Download the packages from Actions artifacts.

## Book icon

`data/icons/readest-book.png` is the source. Keep generation inside the workflows
instead of committing all resized icons.

- iOS: the first `tauri icon` invocation produces independent release references
  under `src-tauri/icons/ios`. On a clean checkout `tauri ios init` seeds the
  generated asset catalog with its bundled default logo. Run `tauri icon` again
  after initialization to overwrite that catalog. Validate the packaged icons
  against `icons/ios`, not the generated catalog: comparing with the catalog
  alone previously accepted the wrong logo. The validator covers compiled
  iPhone and iPad PNGs and exports an iPhone icon preview alongside the IPA.
- Android: initialize, restore tracked project customizations, then generate
  icons. Restoring after generation revives the old adaptive/monochrome launcher
  declaration. With the book PNG source there is no monochrome layer; the
  generated launcher uses the book foreground.

On 2026-10-01 the pinned CLI 2.11.4 was used in a temporary Linux workspace:
all 18 generated iOS catalog PNGs matched the independent book references,
and Android's generated adaptive launcher referenced the book foreground.
Final package validation runs on the corresponding CI runners.

## Cargo downloads

The iOS run at commit `0a4afc53f` failed downloading the crates.io index entry
for `miniz_oxide`, before Rust compilation. The workflow now caches the root
Cargo workspace, fetches locked iOS dependencies before Xcode, allows 180-second
HTTP requests and five network retries, and disables HTTP/2 multiplexing.
These settings improve tolerance of network failures; they cannot guarantee
registry availability. Dependency versions remain controlled by `Cargo.lock`.

## Recovery

Only a successfully validated IPA is published as `readest-ios-selfhosted-unsigned`.
The unvalidated build and icon references are retained for three days as
`readest-ios-candidate-unvalidated`, so a validator failure does not discard
half an hour of compilation. A failed icon comparison also retains normalized
PNG previews as `readest-ios-icon-diagnostics` and logs the dimensions and
channel differences. Rust cache is saved even if package validation fails.

At `edc2531a3`, Android built and uploaded successfully. iOS compiled, but the
strict comparison failed for `AppIcon76x76@2x~ipad.png`. The cause of that pixel
mismatch remains pending until the new diagnostics are available; do not relax
the comparison without examining the packaged image and release reference.

 Fix or retry the relevant workflow, preserving
the icon generation order and package validation. To roll back build changes,
revert the workflow/validator commit and build the chosen source revision;
there is no server data migration involved.
