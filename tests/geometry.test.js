import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeImage,resizeDepth,selectDetections,pointCloud,pointAt,displayZ,WIDTH,HEIGHT} from '../web/geometry.js';
test('RGB normalization is NCHW and uses ImageNet values',()=>{
  const out=normalizeImage(new Uint8ClampedArray([255,0,128,255,0,255,0,255]),2,1);
  assert.equal(out.length,6);
  assert.ok(Math.abs(out[0]-(1-.485)/.229)<1e-6);
  assert.ok(Math.abs(out[2]-(0-.456)/.224)<1e-6);
  assert.ok(Math.abs(out[3]-(1-.456)/.224)<1e-6);
});
test('bilinear depth resize preserves constant maps and averages center',()=>{
  assert.deepEqual([...resizeDepth(new Float32Array([1,2,3,4]),2,2,1,1)],[2.5]);
  assert.deepEqual([...resizeDepth(new Float32Array([4]),1,1,2,2)],[4,4,4,4]);
});
test('NMS removes overlapping duplicates, invalid candidates, and low scores',()=>{
  const raw=new Float32Array([.9,10,20,30,40,.8,11,21,31,41,.7,80,90,100,110,.01,1,1,2,2,NaN,1,1,2,2]);
  const out=selectDetections(raw,.1,.5);assert.deepEqual(out.map(d=>d.id),[0,2]);
});
test('larger inverse depth places a point nearer and projection centers correctly',()=>{
  assert.ok(displayZ(10,[1,10])<displayZ(1,[1,10]));
  const p=pointAt((WIDTH-1)/2,(HEIGHT-1)/2,5,[1,10]);assert.equal(p[0],0);assert.equal(p[1],0);
});
test('point cloud skips invalid values and retains normalized colors',()=>{
  const d=new Float32Array(WIDTH*HEIGHT).fill(1),rgba=new Uint8ClampedArray(WIDTH*HEIGHT*4).fill(255);
  d[0]=NaN;const {vertices}=pointCloud(d,rgba,1,2);
  assert.equal(vertices.length,(Math.ceil(WIDTH/2)*Math.ceil(HEIGHT/2)-1)*6);
  assert.ok(vertices.every(Number.isFinite));assert.equal(vertices[3],1);
});
