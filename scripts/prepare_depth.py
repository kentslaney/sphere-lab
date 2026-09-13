#!/usr/bin/env python3
"""Fetch a revision- and digest-pinned ONNX model; prepare the bundled example."""
import hashlib, pathlib, subprocess, tempfile
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener
ROOT=pathlib.Path(__file__).resolve().parent.parent
REVISION='4472b7362082ad9968fee890ca0f1e5aca36b93d'
SHA256='afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c'
URL=f'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/{REVISION}/onnx/model.onnx'

def export_depths(model_path, image_path, output_dir):
    import onnxruntime as ort
    import numpy as np

    im = Image.open(image_path).convert('RGB')
    W, H = 518, 392
    scale = max(W / im.width, H / im.height)
    cw, ch = W / scale, H / scale
    left = (im.width - cw) / 2
    top = (im.height - ch) / 2
    cropped = im.crop((left, top, left + cw, top + ch)).resize((W, H), Image.Resampling.BILINEAR)

    # ImageNet normalization matching web/geometry.js
    arr = np.array(cropped).astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    normed = (arr - mean) / std
    inp = np.transpose(normed, (2, 0, 1))[None, ...]

    session = ort.InferenceSession(str(model_path))
    out = session.run(None, {session.get_inputs()[0].name: inp})[0]
    pred = out[0]
    if pred.ndim == 3 and pred.shape[0] == 1:
        pred = pred[0]

    # DA2 output is relative inverse depth (disparity)
    disparity = np.maximum(pred, 1e-6).astype(np.float32)
    depth = (1.0 / disparity).astype(np.float32)

    # Apple preferred format for grayscale depth results:
    # 32-bit floating point (kCVPixelFormatType_DepthFloat32), single-channel, Photometric BlackIsZero, SampleFormat IEEEFP
    depth_tiff = output_dir / 'example-depth.tiff'
    Image.fromarray(depth).save(depth_tiff, format='TIFF')

    disparity_tiff = output_dir / 'example-disparity.tiff'
    Image.fromarray(disparity).save(disparity_tiff, format='TIFF')

    print(f'Exported depth TIFF: {depth_tiff} (32-bit float, {W}x{H})')
    print(f'Exported disparity TIFF: {disparity_tiff} (32-bit float, {W}x{H})')

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
    example_jpg = output/'example.jpg'
    ImageOps.fit(image,(1036,784),Image.Resampling.LANCZOS).save(example_jpg,quality=92)
    print('Depth model verified; example prepared.')
    export_depths(model, example_jpg, output)

if __name__=='__main__':main()
