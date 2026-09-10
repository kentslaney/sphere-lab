#!/usr/bin/env python3
"""Export the actual sphere-detector JAX computation as StableHLO and IREE VMVX."""
import pathlib, sys, json, subprocess
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'sphere-detector/src'))
import jax
import jax.numpy as jnp
import numpy as np
from sphere_detector.detect import Raster
import iree.compiler as compiler

# Match Config's default landscape depth resolution, float32 for browser input.
HEIGHT, WIDTH = 392, 518
@jax.jit
def detect(relative_inverse_depth):
    confidence, bounds = Raster(None, relative_inverse_depth,
        resolution=(HEIGHT, WIDTH)).opt().predict()
    return jnp.concatenate((confidence[:, None], bounds), axis=1)

def main():
    output = ROOT / 'models'
    output.mkdir(exist_ok=True)
    sample = jax.ShapeDtypeStruct((HEIGHT, WIDTH), jnp.float32)
    lowered = detect.lower(sample)
    mlir = str(lowered.compiler_ir(dialect='stablehlo'))
    (output / 'sphere-detector.mlir').write_text(mlir)
    print(f'Exported {len(mlir):,} bytes StableHLO', flush=True)
    bytecode = compiler.compile_str(mlir, target_backends=['vmvx'], input_type='stablehlo',
        extra_args=['--iree-vm-target-index-bits=32', '--iree-stream-resource-max-allocation-size=1073741824'])
    (output / 'sphere-detector.vmfb').write_bytes(bytecode)
    (output / 'sphere-detector.json').write_text(json.dumps({
        'height': HEIGHT, 'width': WIDTH, 'candidates': 8,
        'input': 'relative inverse depth, float32 [height,width]',
        'output': '[8,5]: confidence, y_min, x_min, y_max, x_max',
        'entry': 'main', 'runtime': 'IREE VMVX',
        'sourceRevision': subprocess.check_output(['git','-C',str(ROOT/'sphere-detector'),'rev-parse','HEAD'],text=True).strip(),
    }, indent=2))
    print(f'Compiled {len(bytecode):,} bytes VMFB', flush=True)

if __name__ == '__main__': main()
