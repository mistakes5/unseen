# Install the complete Mac app

The default installation is a prebuilt app, with Electron and the native Codex
CLI included. It needs no Node, npm, Homebrew, Xcode, source checkout, or OMP.
Model sign-in, speech/AI keys, course choice and recording permission belong to
each user and remain first-run setup steps.

## Download and open

Download [Install-Classroom-Copilot.zip](https://github.com/mistakes5/unseen/releases/latest/download/Install-Classroom-Copilot.zip),
unzip, and double-click **Install Classroom Copilot.command**. It chooses the
Mac architecture, downloads and verifies the full app, installs in the user’s
Applications folder, and opens it. The app itself is also available as separate
Apple Silicon and Intel ZIPs on the same release.

The downloadable installer is the same reviewed `install-mac.command` script
in the repository. Agents can fetch it, inspect it, then run it with Bash.
Use `--no-open` to install without launching, `--install-dir /absolute/folder`
for a different destination, or `--release classroom-v0.2.1` to select a release.
`--archive ZIP --checksum FILE` verifies and installs an already downloaded copy.

Updates leave user data alone and preserve the old app in a hidden backup folder
beside the destination. A running app is never killed or replaced. Quit normally
after your recording, then run the installer again. A failed download/checksum
does not change an installed app and never triggers a source build.

## First open

These initial releases are ad-hoc signed but not notarized. If macOS blocks a
download, inspect the release and use the normal **System Settings → Privacy &
Security** approval. The installer does not change macOS security settings.
Apple explains the remaining [Developer ID and notarization requirements](https://developer.apple.com/developer-id/).

The first-run wizard opens automatically. Sign in with your own Codex account
if needed, enter your own transcription/detection credentials in Providers,
and choose your own course profile. Access to the requested models depends on
your account. Do not copy someone else’s auth files or keys.

Choose **Profiles → Course folder…** for each profile you use. It enables local
transcript saving, writes dated raw/readable copies under that course folder,
and saves generated notes beside the course’s existing notes. No separate sync
service is needed for a fresh installation. An existing installed follower is
preserved. Stop asks **Create notes / Not now** before sending the whole day’s
same-profile speech to `gpt-6.1-sol` at low reasoning. Related Start/Stop fragments
are combined; unrelated topics and missing speech stay distinct.

## How releases are built

Maintainers run the tests, typecheck, and build once. `npm run release:runtime --
arm64` downloads the pinned official native Codex binary and verifies the published
SHA-256 before packaging; `npm run release:mac -- arm64` packages the full app and
produces its ZIP and checksum. Use `x64` for Intel. The binary’s LICENSE and NOTICE
are included. No account data, auth stores or user configuration is packaged.

The Classroom Mac Release workflow performs this on native Apple Silicon and
Intel GitHub runners when a `classroom-v*` tag is pushed. Assets remain a draft
until both architectures succeed. Consumers download the result and never run
those build steps. The historical reproduction guide is for developers, not
the install path.
