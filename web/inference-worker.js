import {loadCachedDepth} from './model-cache.js';
import * as ort from './vendor/onnxruntime/ort.webgpu.min.mjs';
import {WIDTH,HEIGHT,normalizeImage,resizeDepth} from './geometry.js';
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
onmessage=async ({data:{id,type,rgba,depth:provided}})=>{
  if(busy){postMessage({id,type:'error',message:'Inference is already running.'});return;}
  busy=true;
  try {
    let depth=provided;
    if(type==='infer') {
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
        depth=resizeDepth(values,w,h);
        // DA2's ReLU may produce zero at the farthest pixels. Keep positive
        // inverse depth for the detector's reciprocal, without rescaling it.
        for(let i=0;i<depth.length;i++) if(depth[i]===0)depth[i]=1e-6;
      } finally { input.dispose();if(outputs) Object.values(outputs).forEach(t=>t.dispose()); }
      postMessage({id,type:'depth',depth,elapsed:performance.now()-start});
    }
    if(!(depth instanceof Float32Array)||depth.length!==WIDTH*HEIGHT) throw new Error('Detector requires a 392×518 float32 depth map.');
    // The graph itself converts inverse depth to depth; do not invert it here.
    if(!depth.every(x=>Number.isFinite(x)&&x>0)) throw new Error('Depth contains invalid or zero values; detection cannot run reliably.');
    await loadDetector(id);
    progress(id,'detecting','Running sphere-detector graph on Wasm CPU…');
    const start=performance.now();
    const input=runtime._malloc(depth.byteLength),output=runtime._malloc(56*4);
    if(!input||!output){if(input)runtime._free(input);if(output)runtime._free(output);throw new Error('Detector memory allocation failed.');}
    try {
      runtime.HEAPF32.set(depth,input/4);
      if(runtime._sphere_run(input,depth.length,output)) throw new Error(runtime.UTF8ToString(runtime._sphere_error()));
      const candidates=runtime.HEAPF32.slice(output/4,output/4+56);
      postMessage({id,type:'result',candidates,elapsed:performance.now()-start},[candidates.buffer]);
    } finally {runtime._free(input);runtime._free(output);}
  } catch(error) {
    console.error(error);
    postMessage({id,type:'error',message:error.message||String(error)});
  } finally {busy=false;}
};
