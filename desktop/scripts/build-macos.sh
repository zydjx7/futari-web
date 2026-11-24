#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { echo "请在 macOS 上运行。"; exit 2; }
cd "$(dirname "$0")/../.."
case "${1:-$(uname -m)}" in
  --universal) archs=(aarch64-apple-darwin x86_64-apple-darwin);;
  arm64|aarch64-apple-darwin) archs=(aarch64-apple-darwin);;
  x86_64|x86_64-apple-darwin) archs=(x86_64-apple-darwin);;
  *) echo "用法：$0 [--universal|aarch64-apple-darwin|x86_64-apple-darwin]"; exit 2;;
esac
export MACOSX_DEPLOYMENT_TARGET=12.0
export CARGO_TARGET_DIR="$PWD/desktop/build/cargo"
icons=desktop/src-tauri/icons
dist="$PWD/desktop/dist"
mkdir -p "$dist"
scratch="$(mktemp -d "$dist/.macos.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
if [[ ! -f "$icons/icon.icns" ]]; then
  iconset="$scratch/FUTARI.iconset"; mkdir -p "$iconset"
  for side in 16 32 128 256 512; do
    sips -z "$side" "$side" "$icons/icon.png" --out "$iconset/icon_${side}x${side}.png" >/dev/null
    sips -z "$((side*2))" "$((side*2))" "$icons/icon.png" --out "$iconset/icon_${side}x${side}@2x.png" >/dev/null
  done
  iconutil -c icns "$iconset" -o "$scratch/icon.icns"
  cp "$scratch/icon.icns" "$icons/icon.icns"
fi
node desktop/scripts/prepare.mjs
bins=()
for target in "${archs[@]}"; do
  rustup target add "$target"
  cargo build --locked --release --features cloud-sync --target "$target" --manifest-path desktop/src-tauri/Cargo.toml
  bins+=("$CARGO_TARGET_DIR/$target/release/futari-desktop")
done
package="$scratch/package"
app="$package/FUTARI Desktop.app"
contents="$app/Contents"
mkdir -p "$contents/MacOS" "$contents/Resources/scenes/snow-forest"
exe="$contents/MacOS/futari-desktop"
if (( ${#bins[@]} == 2 )); then lipo -create "${bins[@]}" -output "$exe"; else cp "${bins[0]}" "$exe"; fi
chmod 755 "$exe"
cp "$icons/icon.icns" "$contents/Resources/"
for part in bg.webp fg.webp scene.json; do cp "desktop/scenes/snow-forest/$part" "$contents/Resources/scenes/snow-forest/"; done
cp desktop/src-tauri/Info.plist "$contents/Info.plist"
version="$(node -p "require('./desktop/src-tauri/tauri.conf.json').version")"
plutil -replace CFBundleShortVersionString -string "$version" "$contents/Info.plist"
plutil -replace CFBundleVersion -string "$version" "$contents/Info.plist"
plutil -lint "$contents/Info.plist"
codesign --force --sign - --identifier app.futari.desktop "$app"
codesign --verify --strict --verbose=2 "$app"
lipo -archs "$exe"
cp desktop/使用说明-macOS.txt "$package/"
archive=FUTARI-Desktop-macOS.zip
(cd "$package"; /usr/bin/zip -q -r -X "$scratch/$archive" 'FUTARI Desktop.app' '使用说明-macOS.txt')
unzip -tq "$scratch/$archive"
mv -f "$scratch/$archive" "$dist/$archive"
echo "$dist/$archive"
