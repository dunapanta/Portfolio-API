#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/.build/sprite-gen-package"
REVISION="34275ca5a9fc90d431c9790ae8eb20204f5d1d64"
SOURCE="$ROOT/.build/sprite-gen-source"
mkdir -p "$ROOT/.build"
if [ ! -d "$SOURCE/.git" ]; then
  git clone https://github.com/aldegad/sprite-gen.git "$SOURCE"
fi
git -C "$SOURCE" fetch --depth 1 origin "$REVISION"
git -C "$SOURCE" checkout --detach "$REVISION"
rm -rf "$BUILD"
mkdir -p "$BUILD"
WHEELS="$ROOT/.build/sprite-gen-wheels"
rm -rf "$WHEELS"
mkdir -p "$WHEELS"
python3 -m pip download --dest "$WHEELS" --platform manylinux_2_28_x86_64 \
  --python-version 313 --implementation cp --abi cp313 --only-binary=:all: \
  'pillow>=12.3.0,<13' 'numpy>=2.2.6,<3' --quiet
for wheel in "$WHEELS"/*.whl; do
  unzip -q -o "$wheel" -d "$BUILD"
done
cp -R "$SOURCE/sprite_gen" "$BUILD/sprite_gen"
cp "$ROOT/sprite_worker.py" "$BUILD/sprite_worker.py"
find "$BUILD" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$BUILD" -type f -name '*.pyc' -delete
cd "$BUILD"
rm -f "$ROOT/.build/sprite-gen-worker.zip"
zip -q -r "$ROOT/.build/sprite-gen-worker.zip" .
echo "Built $ROOT/.build/sprite-gen-worker.zip from sprite-gen $REVISION"
