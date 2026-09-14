#!/bin/sh
# Builds the release .app/.dmg and re-signs the .app with a STABLE ad-hoc
# identifier.
#
# Why this exists: `tauri build` ad-hoc-signs the .app (`codesign --sign -`)
# without an explicit --identifier, so codesign auto-derives one from a hash
# of the binary. That hash changes on every single rebuild, which macOS
# Keychain treats as a different app — any Keychain item the previous build
# was granted access to (e.g. the Microsoft 365 refresh token) silently stops
# being readable by the next build. Re-signing with a fixed --identifier
# matching tauri.conf.json's `identifier` keeps the app's Keychain identity
# stable across rebuilds, so a Microsoft 365 connection survives updates.
set -e
cd "$(dirname "$0")/.."

npm run tauri build

APP="src-tauri/target/release/bundle/macos/MENA One.app"
codesign --force --deep --sign - --identifier com.menabig.tracker "$APP"
echo "Re-signed with stable identifier com.menabig.tracker"
codesign -dv "$APP"
