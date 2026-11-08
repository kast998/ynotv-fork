#!/bin/bash
# Download mpv binaries for Tauri sidecar
# Run this script from the repository root

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TAURI_BIN_DIR="$REPO_ROOT/packages/app/src-tauri/bin"

mkdir -p "$TAURI_BIN_DIR"

# Detect OS and Architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    echo "Downloading mpv for Windows (Tauri Sidecar)..."
    TARGET="x86_64-pc-windows-msvc"
    
    # Fetch recent shinchiro builds; a just-published release can have assets
    # that 404 for a while, so fall back to older releases until one downloads.
    TEMP_DIR=$(mktemp -d)
    MPV_URLS=$(curl -s "https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases?per_page=6" \
      | grep -o '"browser_download_url": *"[^"]*mpv-x86_64-[0-9][^"]*\.7z"' \
      | cut -d '"' -f 4)
    OK=""
    for MPV_URL in $MPV_URLS; do
      echo "URL: $MPV_URL"
      rm -f "$TEMP_DIR/mpv.7z"
      if curl -fL --retry 3 -o "$TEMP_DIR/mpv.7z" "$MPV_URL" && [ "$(wc -c < "$TEMP_DIR/mpv.7z")" -gt 1000000 ]; then
        OK=1
        break
      fi
      echo "Download failed, trying an older build..."
    done
    if [ -z "$OK" ]; then
      echo "Failed to download MPV from any recent release"
      exit 1
    fi

    # Extract
    7z x "$TEMP_DIR/mpv.7z" -o"$TEMP_DIR/mpv-extract" -y

    # Move and Rename for Tauri Sidecar
    cp "$TEMP_DIR/mpv-extract/mpv.exe" "$TAURI_BIN_DIR/mpv-$TARGET.exe"
    cp "$TEMP_DIR/mpv-extract/"*.dll "$TAURI_BIN_DIR/" 2>/dev/null || true

    # Copy yt-dlp / youtube-dl if bundled with mpv (needed for YouTube playback)
    cp "$TEMP_DIR/mpv-extract/yt-dlp.exe" "$TAURI_BIN_DIR/" 2>/dev/null || true
    cp "$TEMP_DIR/mpv-extract/youtube-dl.exe" "$TAURI_BIN_DIR/" 2>/dev/null || true

    # Bundle the Vulkan loader (vulkan-1.dll). The shinchiro mpv.exe statically
    # imports vulkan-1.dll, so Windows' loader requires it to be present even
    # when mpv would fall back to d3d11/opengl. On machines without a Vulkan
    # runtime installed, mpv.exe fails with "vulkan-1.dll was not found".
    # Sourced from the official LunarG Vulkan Runtime (Apache-2.0, see the
    # VulkanRT-License.txt copied alongside).
    echo "Downloading Vulkan runtime loader (vulkan-1.dll)..."
    VULKAN_RT_URL="https://sdk.lunarg.com/sdk/download/latest/windows/vulkan-runtime-components.zip"
    if curl -fsSL -o "$TEMP_DIR/vulkan-runtime.zip" "$VULKAN_RT_URL" \
      && 7z e -r "$TEMP_DIR/vulkan-runtime.zip" -o"$TEMP_DIR/vulkan-extract" "*/x64/vulkan-1.dll" "VulkanRT-License.txt" -y \
      && cp "$TEMP_DIR/vulkan-extract/vulkan-1.dll" "$TAURI_BIN_DIR/vulkan-1.dll"; then
      cp "$TEMP_DIR/vulkan-extract/VulkanRT-License.txt" "$TAURI_BIN_DIR/VulkanRT-License.txt" 2>/dev/null || true
    else
      # LunarG link gone: take the same Khronos loader from MSYS2's package.
      echo "LunarG runtime unavailable, using MSYS2 vulkan-loader instead"
      VL_PKG=$(curl -fsSL https://repo.msys2.org/mingw/mingw64/ | grep -o 'mingw-w64-x86_64-vulkan-loader-[^"]*any\.pkg\.tar\.zst' | sort -uV | tail -1)
      if [ -n "$VL_PKG" ] && curl -fsSL -o "$TEMP_DIR/vl.tar.zst" "https://repo.msys2.org/mingw/mingw64/$VL_PKG" \
        && mkdir -p "$TEMP_DIR/vl" && (tar --zstd -xf "$TEMP_DIR/vl.tar.zst" -C "$TEMP_DIR/vl" 2>/dev/null || zstd -dc "$TEMP_DIR/vl.tar.zst" | tar -xf - -C "$TEMP_DIR/vl"); then
        cp "$TEMP_DIR/vl/mingw64/bin/vulkan-1.dll" "$TAURI_BIN_DIR/vulkan-1.dll"
      elif [ -f /c/Windows/System32/vulkan-1.dll ]; then
        cp /c/Windows/System32/vulkan-1.dll "$TAURI_BIN_DIR/vulkan-1.dll"
      else
        echo "WARNING: could not bundle vulkan-1.dll"
      fi
    fi
    if [ ! -f "$TAURI_BIN_DIR/VulkanRT-License.txt" ]; then
      printf '%s\n' "vulkan-1.dll: Khronos Vulkan Loader (https://github.com/KhronosGroup/Vulkan-Loader)" "Licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0" > "$TAURI_BIN_DIR/VulkanRT-License.txt"
    fi
    rm -rf "$TEMP_DIR"

    # Download latest yt-dlp explicitly (ensures it's named for Tauri externalBin)
    echo "Downloading yt-dlp for Windows..."
    YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    curl -L -o "$TAURI_BIN_DIR/yt-dlp-$TARGET.exe" "$YTDLP_URL" || echo "Warning: Failed to download yt-dlp"
    echo "mpv for Windows (Tauri) setup at $TAURI_BIN_DIR/mpv-$TARGET.exe"
    ;;

  Darwin)
    echo "Downloading mpv for macOS..."
    # Determine Arch
    if [ "$ARCH" = "arm64" ]; then
      TARGET="aarch64-apple-darwin"
      # Stolendata builds for Apple Silicon
      MPV_URL="https://laboratory.stolendata.net/~djinn/mpv_osx/mpv-latest.tar.gz"
    else
      TARGET="x86_64-apple-darwin"
      # Need x86_64 build source, usually Homebrew or other
      echo "Warning: Automated x86_64 download not fully implemented, using placeholder."
      exit 1
    fi

    MPV_TARGET="$TAURI_BIN_DIR/mpv-$TARGET"
    MPV_LIB_TARGET="$TAURI_BIN_DIR/mpv-lib"
    if [ -x "$MPV_TARGET" ] && [ -d "$MPV_LIB_TARGET" ]; then
        echo "mpv for macOS is already prepared at $MPV_TARGET"
    else
        echo "URL: $MPV_URL"
        TEMP_DIR=$(mktemp -d)
        trap 'rm -rf "$TEMP_DIR"' EXIT
        curl -fL -o "$TEMP_DIR/mpv.tar.gz" "$MPV_URL"

        tar -xzf "$TEMP_DIR/mpv.tar.gz" -C "$TEMP_DIR"

        # The standalone mpv executable uses libraries located at
        # @executable_path/lib, so both pieces must be included in the app.
        MPV_APP=$(find "$TEMP_DIR" -maxdepth 2 -name "*.app" -type d | head -1)
        if [ -n "$MPV_APP" ] && [ -d "$MPV_APP/Contents/MacOS/lib" ]; then
            cp "$MPV_APP/Contents/MacOS/mpv" "$MPV_TARGET"
            rm -rf "$MPV_LIB_TARGET"
            cp -R "$MPV_APP/Contents/MacOS/lib" "$MPV_LIB_TARGET"
            chmod +x "$MPV_TARGET"
            echo "mpv for macOS setup at $MPV_TARGET"
        else
            echo "Failed to find a complete mpv.app in download"
            exit 1
        fi
        rm -rf "$TEMP_DIR"
        trap - EXIT
    fi

    # Download latest yt-dlp explicitly
    YTDLP_TARGET="$TAURI_BIN_DIR/yt-dlp-$TARGET"
    if [ -x "$YTDLP_TARGET" ]; then
        echo "yt-dlp for macOS is already prepared at $YTDLP_TARGET"
    else
        echo "Downloading yt-dlp for macOS..."
        YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
        curl -fL -o "$YTDLP_TARGET" "$YTDLP_URL"
        chmod +x "$YTDLP_TARGET"
    fi
    ;;

  Linux)
    echo "Setting up mpv for Linux..."
    TARGET="x86_64-unknown-linux-gnu"
    
    # Linux: Use system mpv (distribution packages are the standard way)
    # Static mpv builds for Linux are unreliable, so we rely on the user
    # having mpv installed via their package manager
    if command -v mpv &> /dev/null; then
        echo "Using system mpv: $(command -v mpv)"
        # Create a wrapper script that calls the system mpv
        # Tauri sidecars need to be in the bin directory
        cat > "$TAURI_BIN_DIR/mpv-$TARGET" << 'EOF'
#!/bin/bash
# Wrapper script to use system mpv
exec /usr/bin/mpv "$@"
EOF
        chmod +x "$TAURI_BIN_DIR/mpv-$TARGET"
        echo "mpv wrapper for Linux setup at $TAURI_BIN_DIR/mpv-$TARGET"
    else
        echo "ERROR: mpv not found in system PATH"
        echo "Please install mpv using your package manager:"
        echo "  Ubuntu/Debian: sudo apt install mpv"
        echo "  Fedora: sudo dnf install mpv"
        echo "  Arch: sudo pacman -S mpv"
        exit 1
    fi

    # Download latest yt-dlp explicitly
    echo "Downloading yt-dlp for Linux..."
    YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    curl -L -o "$TAURI_BIN_DIR/yt-dlp-$TARGET" "$YTDLP_URL" && chmod +x "$TAURI_BIN_DIR/yt-dlp-$TARGET" || echo "Warning: Failed to download yt-dlp"
    ;;

  *)
    echo "Unknown platform: $OS"
    exit 1
    ;;
esac

echo "MPV download complete for $OS"
