#!/usr/bin/env python3
"""Download the pinned wgpu crate, verify it, and apply our WebXR patch."""
import hashlib
import pathlib
import shutil
import subprocess
import tarfile
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
VERSION = '30.0.1'
SHA256 = '527ccdf43dd5b2e8676eed9984ce00e2bbb0a1b85b70c1969dcb6cd2eb55ab9e'
CACHE = ROOT / '.build-deps'
PATCH = ROOT / 'patches' / f'wgpu-{VERSION}-xr-compatible.patch'


def prepare():
    CACHE.mkdir(exist_ok=True)
    archive = CACHE / f'wgpu-{VERSION}.crate'
    with tempfile.TemporaryDirectory(prefix='wgpu-setup-', dir=CACHE) as temporary:
        staging = pathlib.Path(temporary)
        if not archive.exists():
            download = staging / 'download.crate'
            subprocess.run([
                'curl', '--fail', '--location', '--retry', '3',
                f'https://static.crates.io/crates/wgpu/wgpu-{VERSION}.crate',
                '--output', str(download),
            ], check=True)
        else:
            download = archive
        if hashlib.sha256(download.read_bytes()).hexdigest() != SHA256:
            raise RuntimeError(f'wgpu {VERSION} checksum mismatch: {download}')
        if download != archive:
            download.replace(archive)
        with tarfile.open(archive) as crate:
            crate.extractall(staging, filter='data')
        source = staging / f'wgpu-{VERSION}'
        subprocess.run(['patch', '--batch', '--forward', '-p1', '-i', str(PATCH)],
                       cwd=source, check=True)
        # Replace only after download, verification and patching all succeed.
        target = CACHE / 'wgpu'
        if target.exists():
            shutil.rmtree(target)
        source.replace(target)
    print(f'Prepared wgpu {VERSION} with WebXR patch.')


if __name__ == '__main__':
    prepare()
