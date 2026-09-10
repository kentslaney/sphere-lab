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
  for(let i=0;i<raw.length;i+=5) {
    const [score,y0,x0,y1,x1]=raw.slice(i,i+5);
    if (![score,y0,x0,y1,x1].every(Number.isFinite)||score<threshold||y1<=y0||x1<=x0) continue;
    // Invalid or wholly outside candidates are not useful detections.
    if(x1<0||y1<0||x0>=WIDTH||y0>=HEIGHT) continue;
    candidates.push({id:i/5,score,x0,y0,x1,y1});
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
    const ix=Math.max(0,Math.min(WIDTH-1,Math.round(x))),iy=Math.max(0,Math.min(HEIGHT-1,Math.round(y)));
    const sample=depth[iy*WIDTH+ix];
    if(!Number.isFinite(sample)||sample<=0) continue;
    const center=pointAt(x,y,sample,range,spread);
    const z=displayZ(sample,range,spread), focal=WIDTH/(2*Math.tan(Math.PI/6));
    const radius=((d.x1-d.x0)+(d.y1-d.y0))/4*z/focal;
    // Display annotation only: center-depth placement is not a fitted 3D sphere.
    for(let axis=0;axis<3;axis++) for(let i=0;i<64;i++) for(const a of [i/64*Math.PI*2,(i+1)/64*Math.PI*2]) {
      const p=[...center];p[(axis+1)%3]+=Math.cos(a)*radius;p[(axis+2)%3]+=Math.sin(a)*radius;
      out.push(...p,1,0.7,0.2);
    }
  }
  return new Float32Array(out);
}
