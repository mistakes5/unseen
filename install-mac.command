#!/bin/bash
# Download the complete app; this installer never builds source or installs tools.
set -euo pipefail
install_dir="$HOME/Applications"
release="latest"
launch_app=1
local_archive=""
local_checksum=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-open) launch_app=0; shift ;;
    --install-dir) install_dir="$2"; shift 2 ;;
    --release) release="$2"; shift 2 ;;
    --archive) local_archive="$2"; shift 2 ;;
    --checksum) local_checksum="$2"; shift 2 ;;
    *) echo "Usage: $0 [--no-open] [--install-dir DIR] [--release TAG] [--archive ZIP --checksum FILE]" >&2; exit 2 ;;
  esac
done
if [ "$(uname -s)" != "Darwin" ]; then echo 'This installer is for macOS.' >&2; exit 1; fi
case "$install_dir" in /*) ;; *) echo 'Installation folder must be an absolute path.' >&2; exit 1 ;; esac
case "$release" in *[!a-zA-Z0-9._-]*) echo 'Invalid release tag.' >&2; exit 1 ;; esac
arch="x64"
if [ "$(uname -m)" = "arm64" ] || [ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || true)" = "1" ]; then arch="arm64"; fi
asset="Classroom-Copilot-mac-${arch}.zip"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/classroom-install.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
if [ -n "$local_archive" ]; then
  if [ -z "$local_checksum" ]; then echo '--archive requires --checksum.' >&2; exit 2; fi
  cp "$local_archive" "$work_dir/$asset"
  cp "$local_checksum" "$work_dir/$asset.sha256"
else
  base="https://github.com/mistakes5/unseen/releases/latest/download"
  if [ "$release" != "latest" ]; then base="https://github.com/mistakes5/unseen/releases/download/$release"; fi
  echo "Downloading the complete Classroom Copilot app for $arch…"
  /usr/bin/curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 20 --max-time 600 "$base/$asset" -o "$work_dir/$asset"
  /usr/bin/curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 20 --max-time 60 "$base/$asset.sha256" -o "$work_dir/$asset.sha256"
fi
expected="$(awk 'NR==1 {print $1}' "$work_dir/$asset.sha256")"
actual="$(/usr/bin/shasum -a 256 "$work_dir/$asset" | awk '{print $1}')"
if ! [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || [ "$expected" != "$actual" ]; then echo 'Download checksum failed. Nothing was installed.' >&2; exit 1; fi
if /usr/bin/unzip -Z1 "$work_dir/$asset" | /usr/bin/awk '/(^\/|(^|\/)\.\.(\/|$))/ {bad=1} !/^(Classroom Copilot[.]app(\/|$)|__MACOSX(\/|$))/ {bad=1} END {exit !bad}'; then
  echo 'Unexpected archive contents. Nothing was installed.' >&2; exit 1
fi
/usr/bin/ditto -x -k "$work_dir/$asset" "$work_dir/extracted"
source_app="$work_dir/extracted/Classroom Copilot.app"
bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$source_app/Contents/Info.plist")"
if [ "$bundle_id" != 'local.classroom.copilot' ]; then echo 'Unexpected application ID.' >&2; exit 1; fi
/usr/bin/codesign --verify --deep --strict "$source_app"
machine="arm64"; if [ "$arch" = 'x64' ]; then machine='x86_64'; fi
if ! /usr/bin/file -b "$source_app/Contents/MacOS/Classroom Copilot" | /usr/bin/grep -q "$machine"; then echo 'Application architecture does not match this Mac.' >&2; exit 1; fi
mkdir -p "$install_dir"
destination="$install_dir/Classroom Copilot.app"
if [ -L "$destination" ]; then echo 'Refusing to replace an application symlink.' >&2; exit 1; fi
if [ -e "$destination" ] && /usr/bin/pgrep -x 'Classroom Copilot' >/dev/null; then
  echo 'Classroom Copilot is running. Stop your recording and quit the app before updating. Nothing was replaced.' >&2; exit 1
fi
staged="$install_dir/.Classroom-Copilot-install-$$.app"
/usr/bin/ditto "$source_app" "$staged"
backup=""
if [ -e "$destination" ]; then
  backup="$install_dir/.Classroom-Copilot-backup-$(date -u +%Y%m%dT%H%M%SZ)-$$.app"
  mv "$destination" "$backup"
fi
if ! mv "$staged" "$destination"; then
  if [ -n "$backup" ]; then mv "$backup" "$destination"; fi
  echo 'Installation failed; the previous app was restored.' >&2; exit 1
fi
echo "Installed: $destination"
if [ -n "$backup" ]; then echo "Previous app preserved: $backup"; fi
echo 'Your existing settings, credentials, recordings, and notes were not changed.'
if [ "$launch_app" = 1 ]; then
  if ! /usr/bin/open "$destination"; then
    echo 'The app is installed. If macOS blocks first launch, review it in System Settings → Privacy & Security. The installer does not change Gatekeeper or quarantine settings.' >&2
    exit 1
  fi
  echo 'Launch requested. Complete first-run setup in Classroom Copilot; recording starts only when you press Start.'
fi
