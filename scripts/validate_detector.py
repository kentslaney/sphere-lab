#!/usr/bin/env python3
"""Generate exact-input reference data and report cross-backend detector drift."""
import json, pathlib, sys
import numpy as np
import iree.runtime as rt
from export_detector import detect, HEIGHT, WIDTH
ROOT=pathlib.Path(__file__).resolve().parent.parent
out=ROOT/'tests/generated';out.mkdir(exist_ok=True)
y,x=np.mgrid[:HEIGHT,:WIDTH]
r2=(x-WIDTH/2)**2+(y-HEIGHT/2)**2
z=np.where(r2<65**2,3-np.sqrt(np.maximum(0,65**2-r2))/80,4).astype(np.float32)
d=(1/z).astype(np.float32)
d.tofile(out/'synthetic-depth.bin')
expected=np.asarray(detect(d))
config=rt.Config('local-sync')
module=rt.VmModule.copy_buffer(config.vm_instance,(ROOT/'models/sphere-detector.vmfb').read_bytes())
ctx=rt.SystemContext(config=config);ctx.add_vm_module(module)
result=ctx.modules[module.name].main(d)
actual=np.array(result.to_host(),copy=True)
# The symmetric fixture causes tied candidates; compare geometric recovery and
# report score drift instead of hiding it behind a permissive score tolerance.
for name,values in [('JAX',expected),('IREE',actual)]:
    best=values[0]; center=(best[1:3]+best[3:5])/2;radius=np.mean(best[3:5]-best[1:3])/2
    np.testing.assert_allclose(center,[HEIGHT/2,WIDTH/2],atol=1)
    np.testing.assert_allclose(radius,65,atol=1)
    assert best[0]>0.1
    print(name,'center',center,'radius',radius,'score',best[0])
report={'jax':expected.tolist(),'iree':actual.tolist(),
        'topScoreDifference':float(abs(expected[0,0]-actual[0,0])),
        'note':'Candidate score/order can differ across floating-point backends; do not treat scores as calibrated probabilities.'}
(out/'detector-reference.json').write_text(json.dumps(report,indent=2))
del result,ctx,module,config
print('Synthetic sphere recovered by both backends; references saved.')
