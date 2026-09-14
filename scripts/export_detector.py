#!/usr/bin/env python3
"""Export the actual sphere-detector JAX computation as StableHLO and IREE VMVX."""
import pathlib, sys, json, subprocess, re
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
    rays = Raster(None, relative_inverse_depth,
        resolution=(HEIGHT, WIDTH)).opt()
    surface = rays.surface
    # Extend the browser graph without changing the upstream detector API.
    return jnp.concatenate((surface.confidence[:, None], surface.bounds,
        surface.center_2nd[:, None], rays.w[:, None]), axis=1)[surface.order]

@jax.jit
def curvature(relative_inverse_depth):
    raster = Raster(None, relative_inverse_depth, resolution=(HEIGHT, WIDTH))
    depth = raster.depth
    return depth.grad, depth.rotated

@jax.jit
def centers(relative_inverse_depth):
    raster = Raster(None, relative_inverse_depth, resolution=(HEIGHT, WIDTH))
    depth = raster.depth
    da2 = depth.rotated[..., 0, 0]
    db2 = depth.rotated[..., 1, 1]
    diff = da2 - db2
    norm2 = depth.grad[..., 0]**2 + depth.grad[..., 1]**2
    valid = jnp.logical_and(depth.convex, diff > 1e-6)
    valid = jnp.logical_and(valid, db2 > 1e-6)
    scat_x = jnp.where(valid, depth.centers[..., 1], jnp.nan)
    scat_y = jnp.where(valid, depth.centers[..., 0], jnp.nan)
    dz = jnp.where(valid, norm2 / jnp.maximum(1e-6, diff), jnp.nan)
    zc = jnp.where(valid, depth.depth + dz, jnp.nan)
    return jnp.stack((scat_x, scat_y, zc), axis=-1)

def prepare_submodule(m, prefix, func_name):
    private_funcs = re.findall(r'func\.func\s+private\s+(@\w+)', m)
    for pf in sorted(private_funcs, key=len, reverse=True):
        new_name = prefix + pf[1:]
        m = re.sub(re.escape(pf) + r'\b', new_name, m)
    m = re.sub(r'func\.func\s+public\s+@main\b', f'func.func public @{func_name}', m)
    first_func = m.find('func.func')
    last_brace = m.rfind('}')
    return m[first_func:last_brace].strip()

def main():
    output = ROOT / 'models'
    output.mkdir(exist_ok=True)
    sample = jax.ShapeDtypeStruct((HEIGHT, WIDTH), jnp.float32)

    m1 = str(detect.lower(sample).compiler_ir(dialect='stablehlo'))
    m2 = str(curvature.lower(sample).compiler_ir(dialect='stablehlo'))
    m3 = str(centers.lower(sample).compiler_ir(dialect='stablehlo'))

    m2_body = prepare_submodule(m2, '@_curv_', 'curvature')
    m3_body = prepare_submodule(m3, '@_cent_', 'centers')

    last_brace_m1 = m1.rfind('}')
    mlir = m1[:last_brace_m1] + '\n\n' + m2_body + '\n\n' + m3_body + '\n}\n'

    (output / 'sphere-detector.mlir').write_text(mlir)
    print(f'Exported {len(mlir):,} bytes StableHLO with @main, @curvature, @centers', flush=True)
    bytecode = compiler.compile_str(mlir, target_backends=['vmvx'], input_type='stablehlo',
        extra_args=['--iree-vm-target-index-bits=32', '--iree-stream-resource-max-allocation-size=1073741824'])
    (output / 'sphere-detector.vmfb').write_bytes(bytecode)
    (output / 'sphere-detector.json').write_text(json.dumps({
        'height': HEIGHT, 'width': WIDTH, 'candidates': 8,
        'input': 'relative inverse depth, float32 [height,width]',
        'output': '[8,7]: confidence, y_min, x_min, y_max, x_max, center_depth, depth_scale',
        'entries': {
            'main': 'candidates [8,7]',
            'curvature': 'grad [392,518,2], rotated [392,518,2,2]',
            'centers': 'centers_3d [392,518,3]'
        },
        'entry': 'main', 'runtime': 'IREE VMVX',
        'sourceRevision': subprocess.check_output(['git','-C',str(ROOT/'sphere-detector'),'rev-parse','HEAD'],text=True).strip(),
    }, indent=2))
    print(f'Compiled {len(bytecode):,} bytes VMFB', flush=True)

if __name__ == '__main__': main()
