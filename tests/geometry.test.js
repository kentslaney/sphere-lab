import test from 'node:test';
import assert from 'node:assert/strict';
import {sphereLines,depthLevelCurves,depthFromZ,depthLevelCurveAt,closestPointOnSegments,smallSphereLines,grabLevelCurveLines,curvatureVectorLines,parseFloat32Tiff,normalizeImage,resizeDepth,selectDetections,pointCloud,pointAt,displayZ,WIDTH,HEIGHT,cloudBounds,computeViewportPinchScale} from '../web/geometry.js';
import {readFile} from 'node:fs/promises';
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
test('smaller depth places a point nearer and projection centers correctly',()=>{
  assert.ok(displayZ(1,[1,10])<displayZ(10,[1,10]));
  const p=pointAt((WIDTH-1)/2,(HEIGHT-1)/2,5,[1,10]);assert.equal(p[0],0);assert.equal(p[1],0);
});
test('point cloud skips invalid values and retains normalized colors',()=>{
  const d=new Float32Array(WIDTH*HEIGHT).fill(1),rgba=new Uint8ClampedArray(WIDTH*HEIGHT*4).fill(255);
  d[0]=NaN;const {vertices}=pointCloud(d,rgba,1,2);
  assert.equal(vertices.length,(Math.ceil(WIDTH/2)*Math.ceil(HEIGHT/2)-1)*6);
  assert.ok(vertices.every(Number.isFinite));assert.equal(vertices[3],1);
});

test('point cloud includes 4 rotated floats when curvature is provided',()=>{
  const d=new Float32Array(WIDTH*HEIGHT).fill(1),rgba=new Uint8ClampedArray(WIDTH*HEIGHT*4).fill(255);
  const rot=new Float32Array(WIDTH*HEIGHT*4).fill(0.5);
  d[0]=NaN;
  const {vertices}=pointCloud(d,rgba,1,2,rot);
  assert.equal(vertices.length,(Math.ceil(WIDTH/2)*Math.ceil(HEIGHT/2)-1)*10);
  assert.ok(vertices.every(Number.isFinite));
  assert.equal(vertices[6], 0.5);
  assert.equal(vertices[7], 0.5);
  assert.equal(vertices[8], 0.5);
  assert.equal(vertices[9], 0.5);

  const b = cloudBounds(vertices);
  assert.ok(Number.isFinite(b.minX));
  assert.ok(Number.isFinite(b.maxX));
});

test('fitted outlines use exported depth geometry rather than center-pixel depth',()=>{
  const detection={x0:194,y0:131,x1:324,y1:261,centerDepth:3,depthScale:80};
  const range=[2.0,4.0];
  const lines=sphereLines([detection],new Float32Array(WIDTH*HEIGHT).fill(NaN),range);
  assert.equal(lines.length,3*64*2*6);
  assert.ok(lines.every(Number.isFinite));
  const equator=pointAt(324,196,3,range);
  // Third great circle starts on the image's positive x axis.
  const start=2*64*2*6;
  for(let i=0;i<3;i++) assert.ok(Math.abs(lines[start+i]-equator[i])<1e-6);
  const offset=-(Math.sqrt(2)+Math.log(1+Math.sqrt(2)))/4;
  const apexDepth=3-Math.sqrt((65-offset)**2-offset**2)/80;
  const apex=pointAt(259,196,apexDepth,range);
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

test('computeViewportPinchScale calculates average depth and scales with camera distance',()=>{
  // A point in the bottom-left quadrant
  const points = new Float32Array([
    -0.5, -0.4, 0.0, 1, 1, 1,
  ]);
  const res1 = computeViewportPinchScale(points, {
    yaw: 0, pitch: 0, distance: 2.0, width: 800, height: 490
  });
  assert.ok(Number.isFinite(res1.avgDepth));
  assert.ok(Math.abs(res1.avgDepth - 2.0) < 0.1);
  assert.ok(res1.barWidthPx > 0);
  assert.ok(res1.realWorldDistance > 0);
  assert.ok(typeof res1.label === 'string');

  // Zoomed in closer: distance 1.0 m -> pxPerMeter should double
  const res2 = computeViewportPinchScale(points, {
    yaw: 0, pitch: 0, distance: 1.0, width: 800, height: 490
  });
  assert.ok(res2.pxPerMeter > res1.pxPerMeter);

  // Fallback with empty points
  const fallback = computeViewportPinchScale(null, { distance: 2.5 });
  assert.equal(fallback.avgDepth, 2.5);
  assert.ok(fallback.barWidthPx > 0);
});

test('maximum depth spread keeps near samples in front of the camera without collapsing to a point', () => {
  assert.equal(displayZ(1, [1, 10], 4), 0.06);
  const point = pointAt(0, 0, 1, [1, 10], 4);
  assert.ok(point.every(Number.isFinite));
  assert.ok(point[0] < 0); assert.ok(point[1] > 0);
  assert.ok(2 - point[2] > 0.05);
});

test('sphere wireframe is symmetric along the depth axis (not egg-shaped)', () => {
  const detection = { x0: 194, y0: 131, x1: 324, y1: 261, centerDepth: 3, depthScale: 80 };
  const range = [1.5, 4.5];
  const lines = sphereLines([detection], null, range);
  const center = pointAt(259, 196, 3, range);
  // Meridian 0 (axis 0): step 16 (p[2] = 1, near pole) and step 48 (p[2] = -1, far pole)
  const nearIdx = 16 * 2 * 6;
  const farIdx = 48 * 2 * 6;
  const nearZ = lines[nearIdx + 2];
  const farZ = lines[farIdx + 2];
  const centerZ = center[2];
  const deltaNear = Math.abs(nearZ - centerZ);
  const deltaFar = Math.abs(farZ - centerZ);
  assert.ok(deltaNear > 0.1);
  assert.ok(Math.abs(deltaNear - deltaFar) < 1e-6, `near ${deltaNear} vs far ${deltaFar}`);
});

test('depthLevelCurves generates valid 3D isocontour line segments', () => {
  assert.equal(depthLevelCurves(null, [1, 10]).length, 0);
  assert.equal(depthLevelCurves(new Float32Array(WIDTH * HEIGHT), [10, 1]).length, 0);
  assert.equal(depthLevelCurves(new Float32Array(WIDTH * HEIGHT), [1, 10], 1, 0).length, 0);

  // Gradient depth field from 1 to 5
  const depth = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      depth[y * WIDTH + x] = 1 + (x / WIDTH) * 4;
    }
  }

  const curves3 = depthLevelCurves(depth, [1, 5], 1, 3, 4);
  assert.ok(curves3.length > 0);
  assert.equal(curves3.length % 12, 0);
  assert.ok(curves3.every(Number.isFinite));

  const curves7 = depthLevelCurves(depth, [1, 5], 1, 7, 4);
  assert.ok(curves7.length > curves3.length);
  assert.equal(curves7.length % 12, 0);
  // Verify it stays safely within renderer limit
  assert.ok(curves7.length <= 2560 * 12);

  // Default 100 curves
  const curves100 = depthLevelCurves(depth, [1, 5]);
  assert.ok(curves100.length > curves7.length);
  assert.equal(curves100.length % 12, 0);
  assert.ok(curves100.length <= 65536 * 12);
});

test('depthFromZ inverts displayZ across depth range and spread', () => {
  const range = [0.5, 4.0];
  for (const spread of [0.5, 1.0, 2.0]) {
    for (const d of [0.5, 1.0, 2.5, 4.0]) {
      const z = displayZ(d, range, spread);
      const pz = 2 - z;
      const recovered = depthFromZ(pz, range, spread);
      assert.ok(Math.abs(recovered - d) < 1e-4);
    }
  }
  assert.equal(depthFromZ(0, null), null);
  assert.equal(depthFromZ(0, [4, 1]), null);
});

test('closestPointOnSegments finds closest point on 3D line segments', () => {
  const segments = [
    [0, 0, 0,  1, 0, 0],
    [1, 0, 0,  1, 1, 0],
  ];
  // Point closest to first segment at x=0.4
  const pt1 = closestPointOnSegments(segments, [0.4, 0.5, 0]);
  assert.ok(Math.abs(pt1[0] - 0.4) < 1e-6);
  assert.ok(Math.abs(pt1[1] - 0) < 1e-6);
  assert.ok(Math.abs(pt1[2] - 0) < 1e-6);

  // Point closest to corner
  const pt2 = closestPointOnSegments(segments, [1.5, -0.5, 0]);
  assert.ok(Math.abs(pt2[0] - 1) < 1e-6);
  assert.ok(Math.abs(pt2[1] - 0) < 1e-6);

  // Fallbacks
  assert.equal(closestPointOnSegments([], [0, 0, 0]), null);
  assert.equal(closestPointOnSegments(segments, null), null);
});

test('smallSphereLines generates valid wireframe sphere line segments', () => {
  const center = [0.1, 0.2, 0.3];
  const lines = smallSphereLines(center, 0.02, [1, 0.85, 0.2], 16);
  assert.ok(lines.length > 0);
  assert.equal(lines.length % 12, 0);
  assert.ok(lines.every(Number.isFinite));
  assert.equal(smallSphereLines(null).length, 0);
});

test('grabLevelCurveLines draws level curve and marks closest point with small sphere', () => {
  const depth = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      depth[y * WIDTH + x] = 1 + (x / WIDTH) * 3;
    }
  }
  const range = [1, 4];
  const midZ = 2 - displayZ(2.5, range, 1);
  const grabPos = [0, 0, midZ];

  const lines = grabLevelCurveLines(depth, range, 1, [grabPos]);
  assert.ok(lines.length > 0);
  assert.equal(lines.length % 12, 0);
  assert.ok(lines.every(Number.isFinite));

  // Empty grabs returns empty Float32Array
  assert.equal(grabLevelCurveLines(depth, range, 1, []).length, 0);
  assert.equal(grabLevelCurveLines(null, range, 1, [grabPos]).length, 0);

  // Two grabs (double grab) must return empty Float32Array (no level curves!)
  const grabPos2 = [0.1, 0.1, midZ];
  assert.equal(grabLevelCurveLines(depth, range, 1, [grabPos, grabPos2]).length, 0);
});

test('curvatureVectorLines plots normalized gradient direction and rotated diagonal vector', () => {
  const grad = new Float32Array(WIDTH * HEIGHT * 2);
  const rotated = new Float32Array(WIDTH * HEIGHT * 4);

  // Set uniform gradient pointing right: gy = 0, gx = 2.0 -> normalized is [gx: 1, gy: 0]
  // In 3D: [gx: 1, -gy: 0, 0] = [1, 0, 0]
  // Set rotated diagonals: da2 = 3.0, db2 = 4.0 -> diagNorm = 5.0 -> w0 = 0.6, w1 = 0.8
  // b0 = [gx: 1, gy: 0], b1 = [gy: 0, -gx: -1] -> [0, 1] in image
  // v2_x = w0 * 1 + w1 * 0 = 0.6
  // v2_y = w0 * 0 - w1 * 1 = -0.8
  // In 3D: [v2_x, -v2_y, 0] = [0.6, 0.8, 0]
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    grad[i * 2] = 0; // gy
    grad[i * 2 + 1] = 2.0; // gx
    rotated[i * 4] = 3.0; // da2
    rotated[i * 4 + 1] = 0.0;
    rotated[i * 4 + 2] = 0.0;
    rotated[i * 4 + 3] = 4.0; // db2
  }

  const range = [1, 4];
  const closestPoint = [0, 0, 2 - displayZ(2.5, range, 1)];
  const lines = curvatureVectorLines(closestPoint, grad, rotated, 0.08);

  assert.ok(lines.length > 0);
  // Two arrows: each has 1 stem + 2 barbs = 3 lines = 6 vertices * 6 floats = 36 floats per arrow.
  // 2 arrows = 72 floats.
  assert.equal(lines.length, 72);
  assert.ok(lines.every(Number.isFinite));

  // Verify first arrow color (emerald green: 0.2, 1.0, 0.3)
  assert.ok(Math.abs(lines[3] - 0.2) < 1e-4);
  assert.ok(Math.abs(lines[4] - 1.0) < 1e-4);
  assert.ok(Math.abs(lines[5] - 0.3) < 1e-4);

  // Tip of gradient arrow: start + len * [1, 0, 0]
  assert.ok(Math.abs(lines[6] - (closestPoint[0] + 0.08)) < 1e-4);
  assert.ok(Math.abs(lines[7] - closestPoint[1]) < 1e-4);
  assert.ok(Math.abs(lines[8] - closestPoint[2]) < 1e-4);

  // Verify second arrow color (magenta: 1.0, 0.25, 0.75)
  assert.ok(Math.abs(lines[39] - 1.0) < 1e-4);
  assert.ok(Math.abs(lines[40] - 0.25) < 1e-4);
  assert.ok(Math.abs(lines[41] - 0.75) < 1e-4);

  // Tip of rotated diagonal arrow: start + len * [0.6, 0.8, 0]
  assert.ok(Math.abs(lines[42] - (closestPoint[0] + 0.08 * 0.6)) < 1e-4);
  assert.ok(Math.abs(lines[43] - (closestPoint[1] + 0.08 * 0.8)) < 1e-4);
  assert.ok(Math.abs(lines[44] - closestPoint[2]) < 1e-4);

  // grabLevelCurveLines with curvature data includes the 72 vector floats
  const depthField = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      depthField[y * WIDTH + x] = 1 + (x / WIDTH) * 3;
    }
  }
  const baseLines = grabLevelCurveLines(depthField, range, 1, [closestPoint]);
  assert.ok(baseLines.length > 0);
  const withCurvature = grabLevelCurveLines(depthField, range, 1, [closestPoint], grad, rotated);
  assert.equal(withCurvature.length, baseLines.length + 72);
});

test('parseFloat32Tiff correctly decodes 32-bit float grayscale TIFF depth and disparity cache', async () => {
  const depthBuffer = await readFile(new URL('../models/example-depth.tiff', import.meta.url));
  const disparityBuffer = await readFile(new URL('../models/example-disparity.tiff', import.meta.url));

  const depthFloats = parseFloat32Tiff(depthBuffer);
  const disparityFloats = parseFloat32Tiff(disparityBuffer);

  assert.equal(depthFloats.length, WIDTH * HEIGHT);
  assert.equal(disparityFloats.length, WIDTH * HEIGHT);

  assert.ok(depthFloats.every(v => Number.isFinite(v) && v > 0));
  assert.ok(disparityFloats.every(v => Number.isFinite(v) && v > 0));

  // Verify reciprocity: disparity ≈ 1 / depth
  for (let i = 0; i < 100; i++) {
    assert.ok(Math.abs(depthFloats[i] * disparityFloats[i] - 1.0) < 1e-4);
  }
});

