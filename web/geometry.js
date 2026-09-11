export const WIDTH = 518, HEIGHT = 392;
export const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

export function normalizeImage(rgba, width = WIDTH, height = HEIGHT) {
  if (rgba.length !== width * height * 4) throw new Error('Image dimensions do not match pixels.');
  const n = width * height, data = new Float32Array(n * 3);
  for (let i = 0; i < n; ++i)
    for (let c = 0; c < 3; ++c) data[c*n+i] = (rgba[4*i+c] / 255 - MEAN[c]) / STD[c];
  return data;
}

// Half-pixel bilinear resize, preserving floating-point model values.
export function resizeDepth(input, width, height, outWidth = WIDTH, outHeight = HEIGHT) {
  if (input.length !== width * height) throw new Error('Unexpected depth output dimensions.');
  if (width === outWidth && height === outHeight) return Float32Array.from(input);
  const out = new Float32Array(outWidth * outHeight);
  for (let y=0; y<outHeight; ++y) {
    const sy = Math.max(0, Math.min(height-1, (y+0.5)*height/outHeight-0.5));
    const y0 = Math.floor(sy), y1 = Math.min(y0+1,height-1), fy=sy-y0;
    for (let x=0; x<outWidth; ++x) {
      const sx = Math.max(0, Math.min(width-1, (x+0.5)*width/outWidth-0.5));
      const x0=Math.floor(sx), x1=Math.min(x0+1,width-1), fx=sx-x0;
      out[y*outWidth+x] = (input[y0*width+x0]*(1-fx)+input[y0*width+x1]*fx)*(1-fy)
        +(input[y1*width+x0]*(1-fx)+input[y1*width+x1]*fx)*fy;
    }
  }
  return out;
}

export function depthRange(depth) {
  const valid = Array.from(depth).filter(v => Number.isFinite(v) && v>0).sort((a,b)=>a-b);
  if (valid.length < depth.length * 0.9) throw new Error('Depth model returned too many invalid samples.');
  return [valid[Math.floor(valid.length*0.02)],valid[Math.floor(valid.length*0.98)]];
}

// Relative inverse depth becomes a bounded display distance, not metric depth.
export function displayZ(d, range, spread=1) {
  const t = Math.max(0, Math.min(1,(d-range[0])/Math.max(1e-6,range[1]-range[0])));
  return 2 + spread * (1/(0.45+1.55*t)-1);
}
export function pointAt(x,y,d,range,spread=1) {
  const z=displayZ(d,range,spread);
  const focal = WIDTH/(2*Math.tan(Math.PI/6)); // assumed 60° horizontal field of view
  return [(x-(WIDTH-1)/2)*z/focal, ((HEIGHT-1)/2-y)*z/focal, 2-z];
}
export function pointCloud(depth,rgba,spread=1,step=1) {
  if (depth.length!==WIDTH*HEIGHT || rgba.length!==WIDTH*HEIGHT*4) throw new Error('Invalid point cloud input.');
  const range=depthRange(depth), data=[];
  for (let y=0;y<HEIGHT;y+=step) for (let x=0;x<WIDTH;x+=step) {
    const i=y*WIDTH+x,d=depth[i];
    if (!Number.isFinite(d)||d<=0) continue;
    data.push(...pointAt(x,y,d,range,spread), rgba[i*4]/255,rgba[i*4+1]/255,rgba[i*4+2]/255);
  }
  return {vertices:new Float32Array(data),range};
}
export function selectDetections(raw, threshold=0.1, iouThreshold=0.75) {
  const candidates=[];
  for(let i=0;i<raw.length;i+=7) {
    const [score,y0,x0,y1,x1,centerDepth,depthScale]=raw.slice(i,i+7);
    if (![score,y0,x0,y1,x1].every(Number.isFinite)||score<threshold||y1<=y0||x1<=x0) continue;
    // Invalid or wholly outside candidates are not useful detections.
    if(x1<0||y1<0||x0>=WIDTH||y0>=HEIGHT) continue;
    candidates.push({id:i/7,score,x0,y0,x1,y1,centerDepth,depthScale});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const kept=[];
  for(const a of candidates) {
    if(kept.some(b=>{
      const intersection=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
      return intersection/((a.x1-a.x0)*(a.y1-a.y0)+(b.x1-b.x0)*(b.y1-b.y0)-intersection)>iouThreshold;
    })) continue;
    kept.push(a);
  }
  return kept;
}
export function sphereLines(detections,depth,range,spread=1) {
  const out=[];
  for(const d of detections) {
    const x=(d.x0+d.x1)/2,y=(d.y0+d.y1)/2;
    const {centerDepth,depthScale}=d;
    if(!Number.isFinite(centerDepth)||centerDepth<=0||!Number.isFinite(depthScale)||depthScale<=0) continue;
    const radius=((d.x1-d.x0)+(d.y1-d.y0))/4;
    // Match the radial sampling offset in Surface.surface. The RMSE also
    // applies a skew correction; these outlines show the base fitted profile.
    const offset=-(Math.sqrt(2)+Math.log(1+Math.sqrt(2)))/4;
    const fittedRadius=radius-offset;
    const point=(axis,a)=>{
      const p=[0,0,0];p[(axis+1)%3]=Math.cos(a);p[(axis+2)%3]=Math.sin(a);
      const rho=radius*Math.hypot(p[0],p[1]);
      const dz=Math.sign(p[2])*Math.sqrt(Math.max(0,fittedRadius**2-(rho-offset)**2))/depthScale;
      const z=centerDepth+dz;
      return z>0 ? pointAt(x+radius*p[0],y+radius*p[1],1/z,range,spread) : null;
    };
    for(let axis=0;axis<3;axis++) for(let i=0;i<64;i++) {
      const a=point(axis,i/64*Math.PI*2),b=point(axis,(i+1)/64*Math.PI*2);
      if(a&&b) out.push(...a,1,0.7,0.2,...b,1,0.7,0.2);
    }
  }
  return new Float32Array(out);
}

export function cloudBounds(vertices) {
  if (!vertices || vertices.length < 6) {
    return { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, minZ: -0.5, maxZ: 0.5 };
  }
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 6) {
    const x = vertices[i], y = vertices[i+1], z = vertices[i+2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) {
    return { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, minZ: -0.5, maxZ: 0.5 };
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

const STROKE_GLYPHS = {
  '0': [[0,0, 1,0], [1,0, 1,1], [1,1, 0,1], [0,1, 0,0]],
  '1': [[0.5,0, 0.5,1]],
  '2': [[0,1, 1,1], [1,1, 1,0.5], [1,0.5, 0,0.5], [0,0.5, 0,0], [0,0, 1,0]],
  '3': [[0,1, 1,1], [1,1, 1,0], [1,0, 0,0], [0,0.5, 1,0.5]],
  '4': [[0,1, 0,0.5], [0,0.5, 1,0.5], [1,1, 1,0]],
  '5': [[1,1, 0,1], [0,1, 0,0.5], [0,0.5, 1,0.5], [1,0.5, 1,0], [1,0, 0,0]],
  '6': [[1,1, 0,1], [0,1, 0,0], [0,0, 1,0], [1,0, 1,0.5], [1,0.5, 0,0.5]],
  '7': [[0,1, 1,1], [1,1, 0.3,0]],
  '8': [[0,0, 1,0], [1,0, 1,1], [1,1, 0,1], [0,1, 0,0], [0,0.5, 1,0.5]],
  '9': [[1,0.5, 0,0.5], [0,0.5, 0,1], [0,1, 1,1], [1,1, 1,0], [1,0, 0,0]],
  '.': [[0.3,0, 0.7,0], [0.5,-0.05, 0.5,0.05]],
  'm': [[0,0, 0,0.7], [0,0.7, 0.5,0.7], [0.5,0.7, 0.5,0], [0.5,0.7, 1,0.7], [1,0.7, 1,0]],
  'c': [[1,0.7, 0,0.7], [0,0.7, 0,0], [0,0, 1,0]],
  ' ': []
};

export function scaleBarLines(bounds, barLength = 0.5, divisions = 5) {
  const b = bounds || { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, minZ: -0.5, maxZ: 0.5 };
  const len = Number.isFinite(barLength) && barLength > 0 ? barLength : 0.5;
  const startX = (b.minX + b.maxX - len) / 2;
  const baseY = b.minY - 0.08;
  const baseZ = (Number.isFinite(b.maxZ) ? b.maxZ : 0) + 0.02;
  const color = [0.52, 0.87, 0.74]; // Teal (#84ddbd)
  const lines = [];

  const pushLine = (x1, y1, z1, x2, y2, z2) => {
    lines.push(x1, y1, z1, ...color, x2, y2, z2, ...color);
  };

  // Main horizontal baseline
  pushLine(startX, baseY, baseZ, startX + len, baseY, baseZ);

  // Vertical tick marks (map-style intervals)
  const step = len / divisions;
  for (let i = 0; i <= divisions; i++) {
    const x = startX + i * step;
    const isEnd = (i === 0 || i === divisions);
    const tickH = isEnd ? 0.03 : 0.018;
    pushLine(x, baseY, baseZ, x, baseY + tickH, baseZ);
  }

  // Draw vector-stroke text labels
  const drawText = (str, x, y, charH = 0.022, charW = 0.014, spacing = 0.004) => {
    let curX = x;
    for (const ch of str) {
      const glyph = STROKE_GLYPHS[ch];
      if (glyph) {
        for (const [gx1, gy1, gx2, gy2] of glyph) {
          pushLine(
            curX + gx1 * charW, y + gy1 * charH, baseZ,
            curX + gx2 * charW, y + gy2 * charH, baseZ
          );
        }
      }
      curX += charW + spacing;
    }
  };

  const measureText = (str, charW = 0.014, spacing = 0.004) => {
    return str.length * charW + Math.max(0, str.length - 1) * spacing;
  };

  const labelH = 0.022, labelW = 0.014, spacing = 0.004;
  // "0" above start tick
  const zeroW = measureText('0', labelW, spacing);
  drawText('0', startX - zeroW / 2, baseY + 0.035, labelH, labelW, spacing);

  // Calibrated length label (e.g. "0.5 m") above end tick
  const endLabel = `${len} m`;
  const endW = measureText(endLabel, labelW, spacing);
  drawText(endLabel, startX + len - endW / 2, baseY + 0.035, labelH, labelW, spacing);

  return new Float32Array(lines);
}

