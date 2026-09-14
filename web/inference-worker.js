import {loadCachedDepth} from './model-cache.js';
import * as ort from './vendor/onnxruntime/ort.webgpu.min.mjs';
import {WIDTH,HEIGHT,normalizeImage,resizeDepth,parseFloat32Tiff} from './geometry.js';
let depthSession, runtime, graphPointer;
let depthModelBytes = null;
let depthProvider = 'webgpu';
ort.env.wasm.wasmPaths = new URL('./vendor/onnxruntime/',import.meta.url).href;
ort.env.wasm.numThreads=1;
ort.env.wasm.proxy=false;
const progress=(id,stage,message)=>postMessage({id,type:'progress',stage,message});
async function fetchFile(url,id,label) {
  const response=await fetch(url);
  if(!response.ok) throw new Error(`${label}: HTTP ${response.status}. Run sh scripts/build_pipeline.sh.`);
  const total=Number(response.headers.get('content-length'));
  if(!response.body) return new Uint8Array(await response.arrayBuffer());
  const chunks=[];let received=0,last=0;
  const reader=response.body.getReader();
  for(;;) {
    const {value,done}=await reader.read();if(done) break;
    chunks.push(value);received+=value.length;
    if(performance.now()-last>250) {
      progress(id,'loading',`${label}: ${Math.round(received/1048576)}${total?` / ${Math.round(total/1048576)}`:''} MB`);last=performance.now();
    }
  }
  const bytes=new Uint8Array(received);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes;
}
async function loadDepth(id) {
  if(depthSession) return;
  if(!depthModelBytes) {
    const url = new URL('./models/depth-anything-v2-small.onnx',import.meta.url);
    depthModelBytes = await loadCachedDepth(url, () => fetchFile(url,id,'Depth Anything V2 Small'));
  }
  if(navigator.gpu) {
    try {
      progress(id,'loading','Creating ONNX WebGPU session…');
      depthSession = await ort.InferenceSession.create(depthModelBytes,{executionProviders:['webgpu'],graphOptimizationLevel:'all'});
      depthProvider = 'webgpu';
      return;
    } catch(gpuError) {
      console.warn('WebGPU session creation failed, falling back to WASM:', gpuError);
      progress(id,'loading','WebGPU out of memory. Falling back to CPU…');
    }
  }
  progress(id,'loading','Creating ONNX WASM session…');
  depthSession = await ort.InferenceSession.create(depthModelBytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
  depthProvider = 'wasm';
}
async function loadDetector(id) {
  if(runtime) return;
  progress(id,'detecting','Loading sphere-detector Wasm runtime…');
  const {default:createRuntime}=await import('./runtime/generated/sphere_runtime.mjs');
  const loaded=await createRuntime({
    locateFile: name => new URL(`./runtime/generated/${name}`, import.meta.url).href,
    print:()=>{},printErr:message=>console.warn(message),
  });
  const graph=await fetchFile(new URL('./models/sphere-detector.vmfb',import.meta.url),id,'Sphere detector');
  const ptr=loaded._malloc(graph.length);
  if(!ptr) throw new Error('Could not allocate detector graph memory.');
  loaded.HEAPU8.set(graph,ptr);
  if(loaded._sphere_init(ptr,graph.length)) {
    const message=loaded.UTF8ToString(loaded._sphere_error());loaded._free(ptr);throw new Error(message);
  }
  runtime=loaded;graphPointer=ptr;
}
let busy=false;
onmessage=async ({data:{id,type,rgba,depth:provided,debug,isExample}})=>{
  if(busy){postMessage({id,type:'error',message:'Inference is already running.'});return;}
  busy=true;
  try {
    if(type==='curvature') {
      const depth=provided;
      if(!(depth instanceof Float32Array)||depth.length!==WIDTH*HEIGHT) throw new Error('Detector requires a 392×518 float32 depth map.');
      if(!depth.every(x=>Number.isFinite(x)&&x>0)) throw new Error('Depth contains invalid or zero values; detection cannot run reliably.');
      await loadDetector(id);
      progress(id,'detecting','Computing depth curvature on Wasm CPU…');
      const start=performance.now();
      const input=runtime._malloc(depth.byteLength);
      const grad=runtime._malloc(WIDTH*HEIGHT*2*4);
      const rotated=runtime._malloc(WIDTH*HEIGHT*4*4);
      const centers=runtime._malloc(WIDTH*HEIGHT*3*4);
      if(!input||!grad||!rotated||!centers){
        if(input) runtime._free(input);
        if(grad) runtime._free(grad);
        if(rotated) runtime._free(rotated);
        if(centers) runtime._free(centers);
        throw new Error('Curvature memory allocation failed.');
      }
      try {
        const disparity = new Float32Array(depth.length);
        for (let i = 0; i < depth.length; i++) disparity[i] = 1.0 / Math.max(1e-6, depth[i]);
        runtime.HEAPF32.set(disparity, input / 4);
        if (runtime._sphere_run_curvature(input, disparity.length, grad, rotated)) throw new Error(runtime.UTF8ToString(runtime._sphere_error()));
        let centersValues = null;
        if (runtime._sphere_run_centers(input, disparity.length, centers) === 0) {
          centersValues = runtime.HEAPF32.slice(centers / 4, centers / 4 + WIDTH * HEIGHT * 3);
        }
        const gradValues = runtime.HEAPF32.slice(grad / 4, grad / 4 + WIDTH * HEIGHT * 2);
        const rotatedValues = runtime.HEAPF32.slice(rotated / 4, rotated / 4 + WIDTH * HEIGHT * 4);
        const transfer = [gradValues.buffer, rotatedValues.buffer];
        if (centersValues) transfer.push(centersValues.buffer);
        postMessage({ id, type: 'curvature', grad: gradValues, rotated: rotatedValues, centers: centersValues, elapsed: performance.now() - start }, transfer);
        return;
      } finally {
        runtime._free(input);
        runtime._free(grad);
        runtime._free(rotated);
        runtime._free(centers);
      }
    }
    let depth=provided;
    if(type==='infer') {
      let cached=false;
      if(isExample) {
        try {
          progress(id,'depth','Loading cached depth for example image…');
          const start=performance.now();
          const tiffUrl=new URL('./models/example-depth.tiff',import.meta.url);
          const res=await fetch(tiffUrl);
          if(res.ok) {
            const buf=await res.arrayBuffer();
            const parsed=parseFloat32Tiff(new Uint8Array(buf));
            for(let i=0;i<parsed.length;i++) if(parsed[i]<=0)parsed[i]=1e-6;
            depth=parsed;
            cached=true;
            postMessage({id,type:'depth',depth,elapsed:performance.now()-start});
          }
        } catch(cacheErr) {
          console.warn('Could not load example depth cache, falling back to model:', cacheErr);
        }
      }
      if(!cached) {
        await loadDepth(id);
        progress(id,'depth',depthProvider==='webgpu' ? 'Estimating depth on WebGPU…' : 'Estimating depth on CPU (WASM)…');
        const start=performance.now();
        const input=new ort.Tensor('float32',normalizeImage(rgba),[1,3,HEIGHT,WIDTH]);
        let outputs;
        try {
          try {
            outputs=await depthSession.run({[depthSession.inputNames[0]]:input});
          } catch(runError) {
            if(depthProvider==='webgpu' && depthModelBytes) {
              console.warn('Depth inference failed on WebGPU, falling back to WASM:', runError);
              progress(id,'depth','WebGPU memory limit hit. Retrying on CPU (WASM)…');
              try { depthSession?.release?.(); } catch(_) {}
              depthSession = await ort.InferenceSession.create(depthModelBytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
              depthProvider = 'wasm';
              outputs=await depthSession.run({[depthSession.inputNames[0]]:input});
            } else {
              throw runError;
            }
          }
          const result=outputs[depthSession.outputNames[0]];
          const values=await result.getData();
          const [h,w]=result.dims.slice(-2);
          const disp=resizeDepth(values,w,h);
          depth = new Float32Array(disp.length);
          for(let i=0;i<disp.length;i++) depth[i] = 1.0 / Math.max(1e-6, disp[i]);
        } finally { input.dispose();if(outputs) Object.values(outputs).forEach(t=>t.dispose()); }
        postMessage({id,type:'depth',depth,elapsed:performance.now()-start});
      }
    }
    if(!(depth instanceof Float32Array)||depth.length!==WIDTH*HEIGHT) throw new Error('Detector requires a 392×518 float32 depth map.');
    // The graph itself converts inverse depth to depth; compute disparity for detector.
    if(!depth.every(x=>Number.isFinite(x)&&x>0)) throw new Error('Depth contains invalid or zero values; detection cannot run reliably.');
    await loadDetector(id);
    progress(id,'detecting','Running sphere-detector graph on Wasm CPU…');
    const start=performance.now();
    const input=runtime._malloc(depth.byteLength),output=runtime._malloc(56*4);
    if(!input||!output){if(input)runtime._free(input);if(output)runtime._free(output);throw new Error('Detector memory allocation failed.');}
    try {
      const disparity = new Float32Array(depth.length);
      for (let i = 0; i < depth.length; i++) disparity[i] = 1.0 / Math.max(1e-6, depth[i]);
      runtime.HEAPF32.set(disparity,input/4);
      if(runtime._sphere_run(input,disparity.length,output)) throw new Error(runtime.UTF8ToString(runtime._sphere_error()));
      const candidates=runtime.HEAPF32.slice(output/4,output/4+56);
      postMessage({id,type:'result',candidates,elapsed:performance.now()-start},[candidates.buffer]);

      if(debug) {
        const grad=runtime._malloc(WIDTH*HEIGHT*2*4);
        const rotated=runtime._malloc(WIDTH*HEIGHT*4*4);
        const centers=runtime._malloc(WIDTH*HEIGHT*3*4);
        if(grad && rotated && centers) {
          try {
            if(runtime._sphere_run_curvature(input,disparity.length,grad,rotated)===0) {
              let centersValues = null;
              if (runtime._sphere_run_centers(input, disparity.length, centers) === 0) {
                centersValues = runtime.HEAPF32.slice(centers / 4, centers / 4 + WIDTH * HEIGHT * 3);
              }
              const gradValues=runtime.HEAPF32.slice(grad/4,grad/4+WIDTH*HEIGHT*2);
              const rotatedValues=runtime.HEAPF32.slice(rotated/4,rotated/4+WIDTH*HEIGHT*4);
              const transfer = [gradValues.buffer, rotatedValues.buffer];
              if (centersValues) transfer.push(centersValues.buffer);
              postMessage({id,type:'curvature',grad:gradValues,rotated:rotatedValues,centers:centersValues,elapsed:performance.now()-start},transfer);
            }
          } finally {
            runtime._free(grad);
            runtime._free(rotated);
            runtime._free(centers);
          }
        }
      }
    } finally {runtime._free(input);runtime._free(output);}
  } catch(error) {
    console.error(error);
    postMessage({id,type:'error',message:error.message||String(error)});
  } finally {busy=false;}
};
