#!/usr/bin/env python3
"""Copy browser runtime assets into the self-contained web document root."""
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent

def stage_web():
    files = [
        'models/depth-anything-v2-small.onnx',
        'models/sphere-detector.vmfb',
        'models/example.jpg',
        'models/example-depth.tiff',
        'models/example-disparity.tiff',
        'runtime/generated/sphere_runtime.mjs',
        'runtime/generated/sphere_runtime.wasm',
    ]
    ort = ROOT / 'node_modules/onnxruntime-web/dist'
    if not ort.is_dir() or any(not (ROOT / name).is_file() for name in files):
        raise RuntimeError('Browser assets are missing. Run sh scripts/build_pipeline.sh first.')
    pairs = [(ROOT / name, ROOT / 'web' / name) for name in files]
    pairs += [(p, ROOT / 'web/vendor/onnxruntime' / p.name) for p in ort.iterdir() if p.is_file()]
    for notice in ('LICENSE', 'LICENSE.txt', 'ThirdPartyNotices.txt', 'README.md'):
        source = ort.parent / notice
        if source.is_file():
            pairs.append((source, ROOT / 'web/vendor/onnxruntime' / notice))
    for source, target in pairs:
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or source.stat().st_mtime_ns != target.stat().st_mtime_ns or source.stat().st_size != target.stat().st_size:
            shutil.copy2(source, target)

if __name__ == '__main__':
    stage_web()
    print('Browser assets staged in web/.')
