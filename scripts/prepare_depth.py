#!/usr/bin/env python3
"""Fetch a revision- and digest-pinned ONNX model; prepare the bundled example."""
import hashlib, pathlib, subprocess, tempfile
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener
ROOT=pathlib.Path(__file__).resolve().parent.parent
REVISION='4472b7362082ad9968fee890ca0f1e5aca36b93d'
SHA256='afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c'
URL=f'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/{REVISION}/onnx/model.onnx'

def main():
    output=ROOT/'models';output.mkdir(exist_ok=True)
    model=output/'depth-anything-v2-small.onnx'
    if not model.exists():
        with tempfile.TemporaryDirectory(dir=output) as temporary:
            download=pathlib.Path(temporary)/'model.onnx'
            subprocess.run(['curl','--fail','--location','--retry','3',URL,'--output',str(download)],check=True)
            if hashlib.sha256(download.read_bytes()).hexdigest()!=SHA256:
                raise RuntimeError('Depth model checksum mismatch')
            download.replace(model)
    if hashlib.sha256(model.read_bytes()).hexdigest()!=SHA256:
        raise RuntimeError('Existing depth model checksum mismatch; remove it to download again')
    register_heif_opener()
    image=ImageOps.exif_transpose(Image.open(ROOT/'sphere-detector/assets/examples/IMG_0004.HEIC')).convert('RGB')
    ImageOps.fit(image,(1036,784),Image.Resampling.LANCZOS).save(output/'example.jpg',quality=92)
    print('Depth model verified; example prepared.')
if __name__=='__main__':main()
