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

    const gradPtr = m._malloc(392 * 518 * 2 * 4);
    const rotatedPtr = m._malloc(392 * 518 * 4 * 4);
    try {
      assert.equal(m._sphere_run_curvature(input, inputBytes.length / 4, gradPtr, rotatedPtr), 0, m.UTF8ToString(m._sphere_error()));
      const gradValues = m.HEAPF32.slice(gradPtr / 4, gradPtr / 4 + 392 * 518 * 2);
      const rotatedValues = m.HEAPF32.slice(rotatedPtr / 4, rotatedPtr / 4 + 392 * 518 * 4);
      assert.equal(gradValues.length, 392 * 518 * 2);
      assert.equal(rotatedValues.length, 392 * 518 * 4);
      assert.ok(gradValues.every(Number.isFinite));
      assert.ok(rotatedValues.every(Number.isFinite));
    } finally {
      m._free(gradPtr);
      m._free(rotatedPtr);
    }

    const centersPtr = m._malloc(392 * 518 * 3 * 4);
    try {
      assert.equal(m._sphere_run_centers(input, inputBytes.length / 4, centersPtr), 0, m.UTF8ToString(m._sphere_error()));
      const centersValues = m.HEAPF32.slice(centersPtr / 4, centersPtr / 4 + 392 * 518 * 3);
      assert.equal(centersValues.length, 392 * 518 * 3);
      // Center of synthetic sphere: y=196, x=289
      const idx = (196 * 518 + 289) * 3;
      const xc = centersValues[idx], yc = centersValues[idx + 1], zc = centersValues[idx + 2];
      assert.ok(Math.abs(xc - 259) < 1.0);
      assert.ok(Math.abs(yc - 196) < 1.0);
      assert.ok(Math.abs(zc - 3.0) < 0.1);
      // Flat background point outside sphere (e.g. y=10, x=10) is non-convex -> NaN
      const bgIdx = (10 * 518 + 10) * 3;
      assert.ok(Number.isNaN(centersValues[bgIdx]));
    } finally {
      m._free(centersPtr);
    }
  }finally{m._sphere_close();m._free(graphPtr);m._free(input);m._free(out);}
});
