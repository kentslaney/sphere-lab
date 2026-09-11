import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import create from '../runtime/generated/sphere_runtime.mjs';
import {selectDetections} from '../web/geometry.js';

test('compiled detector recovers a known sphere and survives repeated invocations',async()=>{
  const m=await create();
  const graph=await readFile(new URL('../models/sphere-detector.vmfb',import.meta.url));
  const inputBytes=await readFile(new URL('./generated/synthetic-depth.bin',import.meta.url));
  const reference=JSON.parse(await readFile(new URL('./generated/detector-reference.json',import.meta.url),'utf8'));
  const graphPtr=m._malloc(graph.length),input=m._malloc(inputBytes.length),out=m._malloc(224);
  try {
    m.HEAPU8.set(graph,graphPtr);assert.equal(m._sphere_init(graphPtr,graph.length),0,m.UTF8ToString(m._sphere_error()));
    m.HEAPU8.set(inputBytes,input);let first;
    for(let run=0;run<2;run++){
      assert.equal(m._sphere_run(input,inputBytes.length/4,out),0,m.UTF8ToString(m._sphere_error()));
      const values=m.HEAPF32.slice(out/4,out/4+56);
      assert.ok(values.every(Number.isFinite));
      const best=selectDetections(values,.1)[0];assert.ok(best);
      assert.ok(Math.abs((best.x0+best.x1)/2-259)<1);
      assert.ok(Math.abs((best.y0+best.y1)/2-196)<1);
      assert.ok(Math.abs((best.x1-best.x0)/2-65)<1);
      assert.ok(Math.abs(best.centerDepth-3)<0.05);
      assert.ok(Math.abs(best.depthScale-80)<3);
      if(first)assert.deepEqual(values,first);first=values;
      // Reduction/rounding order is backend-dependent. Validate location and
      // report score drift rather than claiming bitwise JAX equivalence.
      const native=reference.iree[0];
      assert.ok(Math.abs((best.x0+best.x1)/2-(native[2]+native[4])/2)<1);
      assert.ok(Math.abs(best.centerDepth-native[5])<0.01);
      assert.ok(Math.abs(best.depthScale-native[6])<1);
      console.log('Wasm best score',best.score,'native IREE',native[0],'JAX',reference.jax[0][0]);
    }
    assert.notEqual(m._sphere_run(input,1,out),0);
    assert.match(m.UTF8ToString(m._sphere_error()),/392x518/);
  }finally{m._sphere_close();m._free(graphPtr);m._free(input);m._free(out);}
});
