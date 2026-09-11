import test from 'node:test';
import assert from 'node:assert/strict';
import {sphereLines,normalizeImage,resizeDepth,selectDetections,pointCloud,pointAt,displayZ,WIDTH,HEIGHT,cloudBounds,scaleBarLines} from '../web/geometry.js';
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
  const raw=new Float32Array([.9,10,20,30,40,3,80,.8,11,21,31,41,3,80,.7,80,90,100,110,3,80,.01,1,1,2,2,3,80,NaN,1,1,2,2,3,80]);
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

test('fitted outlines use exported depth geometry rather than center-pixel depth',()=>{
  const detection={x0:194,y0:131,x1:324,y1:261,centerDepth:3,depthScale:80};
  const range=[0.2,0.5];
  const lines=sphereLines([detection],new Float32Array(WIDTH*HEIGHT).fill(NaN),range);
  assert.equal(lines.length,3*64*2*6);
  assert.ok(lines.every(Number.isFinite));
  const equator=pointAt(324,196,1/3,range);
  // Third great circle starts on the image's positive x axis.
  const start=2*64*2*6;
  for(let i=0;i<3;i++) assert.ok(Math.abs(lines[start+i]-equator[i])<1e-6);
  const offset=-(Math.sqrt(2)+Math.log(1+Math.sqrt(2)))/4;
  const apexDepth=3-Math.sqrt((65-offset)**2-offset**2)/80;
  const apex=pointAt(259,196,1/apexDepth,range);
  const apexStart=48*2*6; // negative depth pole of the first meridian
  for(let i=0;i<3;i++) assert.ok(Math.abs(lines[apexStart+i]-apex[i])<1e-6);
  assert.notDeepEqual(lines,sphereLines([{...detection,depthScale:40}],null,range));
  assert.equal(sphereLines([{...detection,depthScale:NaN}],null,range).length,0);
});

test('cloudBounds correctly computes bounding box and handles fallback',()=>{
  const sample = new Float32Array([
    -0.4, -0.3, 0.1, 1, 1, 1,
     0.6,  0.5, 0.9, 1, 1, 1,
    -0.1,  0.2, 0.4, 1, 1, 1,
  ]);
  const b = cloudBounds(sample);
  assert.ok(Math.abs(b.minX - (-0.4)) < 1e-6);
  assert.ok(Math.abs(b.maxX - 0.6) < 1e-6);
  assert.ok(Math.abs(b.minY - (-0.3)) < 1e-6);
  assert.ok(Math.abs(b.maxY - 0.5) < 1e-6);
  assert.ok(Math.abs(b.minZ - 0.1) < 1e-6);
  assert.ok(Math.abs(b.maxZ - 0.9) < 1e-6);

  const fallback = cloudBounds(null);
  assert.equal(fallback.minX, -0.5);
  assert.equal(fallback.maxX, 0.5);
});

test('scaleBarLines produces map-style single axis scale bar with calibrated length and ticks',()=>{
  const bounds = { minX: -0.5, maxX: 0.5, minY: -0.4, maxY: 0.6, minZ: -0.2, maxZ: 0.8 };
  const lines = scaleBarLines(bounds, 0.5, 5);
  assert.ok(lines.length > 0);
  assert.equal(lines.length % 12, 0);
  assert.ok(lines.every(Number.isFinite));

  // First line is the baseline
  const startX = lines[0], baseY = lines[1], baseZ = lines[2];
  const endX = lines[6];
  assert.ok(Math.abs((endX - startX) - 0.5) < 1e-6);
  assert.ok(Math.abs(baseY - (-0.4 - 0.08)) < 1e-6);
  assert.ok(Math.abs(baseZ - (0.8 + 0.02)) < 1e-6);

  // Baseline is centered horizontally on the cloud bounds
  assert.ok(Math.abs((startX + endX) / 2 - (bounds.minX + bounds.maxX) / 2) < 1e-6);
});
