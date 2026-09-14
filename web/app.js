import {spreadFromSlider, spreadToSlider} from './config.js';
import {requestModelPersistence} from './model-cache.js';
import {createViewer} from './viewer.js';
import {WIDTH,HEIGHT,pointAt,pointCloud,sphereLines,depthLevelCurves,grabLevelCurveLines,selectDetections,depthRange,cloudBounds} from './geometry.js';
const $=id=>document.getElementById(id);
let viewer=null, worker=null, job=0, rgba=null, depth=null, candidates=null, range=null, bounds=null, cloudVertices=null;
let selected=[], sourceName='', depthMs=0, detectorMs=0, busy=false, debugMode=false;
let baseLines=new Float32Array(), currentGrabs=[];
let lastGrad=null, lastRotated=null, lastCenters=null;
const photo=$('photo').getContext('2d'),depthCanvas=$('depth').getContext('2d');
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function controls(running){busy=running;$('file').disabled=running;$('example').disabled=running;$('cancel').hidden=!running;}
function stage(id,state){$(`stage-${id}`).className=state;}
function rebuild(updateCloud=true) {
  if(!depth||!rgba) return;
  const spread=spreadFromSlider($('spread').value), threshold=Number($('threshold').value);
  if(updateCloud) {
    const cloud=pointCloud(depth,rgba,spread,1,debugMode ? lastRotated : null, lastCenters);
    range=cloud.range;
    cloudVertices=cloud.vertices;
    bounds=cloudBounds(cloud.vertices, cloud.stride);
    if(viewer) {
      viewer.setCloud(cloud.vertices, cloud.stride);
      viewer.setDepthMap(depth, range[0], range[1], spread);
      viewer.setSpread(spread);
      if (lastGrad && lastRotated) {
        viewer.setCurvature?.(lastGrad, lastRotated);
      }
    }
    $('point-count').textContent=`${(cloud.vertices.length/cloud.stride).toLocaleString()} POINTS`;
  }
  const allLines=[];
  selected=candidates?selectDetections(candidates,threshold):[];
  if(viewer&&$('outlines').checked&&selected.length) {
    const outlines=sphereLines(selected,depth,range,spread);
    for(let i=0;i<outlines.length;i++) allLines.push(outlines[i]);
  }
  baseLines=new Float32Array(allLines);
  updateLines();
  photo.putImageData(new ImageData(rgba,WIDTH,HEIGHT),0,0);
  photo.strokeStyle='#ffcc66';photo.lineWidth=2;
  photo.font='bold 15px system-ui';
  if($('outlines').checked) for(const d of selected){
    photo.strokeRect(d.x0,d.y0,d.x1-d.x0,d.y1-d.y0);
    photo.fillStyle='#ffcc66';photo.fillText(`#${d.id+1}  ${d.score.toFixed(3)}`,Math.max(2,d.x0),Math.max(17,d.y0-6));
  }
  $('results').replaceChildren();
  if(candidates) {
    $('result-heading').textContent=`${selected.length} sphere candidate${selected.length===1?'':'s'}`;
    if(!selected.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.textContent='No candidates meet the current score threshold.';tr.append(td);$('results').append(tr);}
    for(const d of selected){
      const tr=document.createElement('tr');
      for(const value of [`#${d.id+1}`,d.score.toFixed(4),`${((d.x0+d.x1)/2).toFixed(1)}, ${((d.y0+d.y1)/2).toFixed(1)}`,(((d.x1-d.x0)+(d.y1-d.y0))/4).toFixed(1),...[d.centerDepth,d.depthScale].map(v=>Number.isFinite(v)?v.toPrecision(5):'—')]){
        const td=document.createElement('td');td.textContent=value;tr.append(td);
      }
      $('results').append(tr);
    }
  }
}
function paintDepth() {
  range=depthRange(depth);
  const image=depthCanvas.createImageData(WIDTH,HEIGHT),[lo,hi]=range;
  for(let i=0;i<depth.length;i++){
    const t=Math.max(0,Math.min(1,(depth[i]-lo)/Math.max(1e-6,hi-lo)));
    image.data[i*4]=Math.round(25+230*t);
    image.data[i*4+1]=Math.round(30+200*Math.sqrt(t));
    image.data[i*4+2]=Math.round(90+90*(1-t));image.data[i*4+3]=255;
  }
  depthCanvas.putImageData(image,0,0);
}
function startWorker(){
  void requestModelPersistence();
  if(worker) return;
  worker=new Worker(new URL('./inference-worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
    if(data.id!==job) return;
    try {
      if(data.type==='progress'){
        status(data.message);if(data.stage==='detecting')stage('detect','active');
      } else if(data.type==='depth'){
        depth=data.depth;depthMs=data.elapsed;
        stage('depth','done');paintDepth();rebuild();stage('cloud','done');
        $('timing').textContent=`Depth ${(depthMs/1000).toFixed(2)} s`;
      } else if(data.type==='result'){
        candidates=data.candidates;detectorMs=data.elapsed;rebuild(false);stage('detect','done');
        $('download').disabled=false;controls(false);
        status('Finished. Explore the cloud or adjust the score threshold.');
        $('timing').textContent=`Depth ${(depthMs/1000).toFixed(2)} s · Detector ${(detectorMs/1000).toFixed(2)} s`;
      } else if(data.type==='curvature'){
        lastGrad=data.grad;
        lastRotated=data.rotated;
        lastCenters=data.centers;
        viewer?.setCurvature?.(lastGrad, lastRotated);
        rebuild(true);
        updateLines();
      } else if(data.type==='error'){controls(false);status(data.message,true);if(depth)$('result-heading').textContent='Depth ready · detector did not complete';}
    }catch(error){controls(false);status(error.message,true);}
  };
  worker.onerror=event=>{controls(false);status(event.message||'Inference worker failed. Reload to retry.',true);worker?.terminate();worker=null;};
}
async function analyze(blob,name,isExample=false){
  if(busy) return;
  controls(true);const currentJob=++job;
  sourceName=name;rgba=null;depth=null;candidates=null;selected=[];bounds=null;cloudVertices=null;
  $('download').disabled=true;$('timing').textContent='';$('result-heading').textContent='Analyzing photo';
  $('results').replaceChildren();$('point-count').textContent='WAITING FOR DEPTH';
  for(const id of ['depth','cloud','detect'])stage(id,'');
  viewer?.clear();depthCanvas.clearRect(0,0,WIDTH,HEIGHT);photo.clearRect(0,0,WIDTH,HEIGHT);
  try {
    if(blob.size>100*1024*1024)throw new Error('Choose an image smaller than 100 MB.');
    status('Decoding the photo…');
    const bitmap=await createImageBitmap(blob,{imageOrientation:'from-image'});
    try {
      if(currentJob!==job)return;
      const scale=Math.max(WIDTH/bitmap.width,HEIGHT/bitmap.height);
      const cropWidth=WIDTH/scale,cropHeight=HEIGHT/scale;
      photo.imageSmoothingEnabled=true;photo.imageSmoothingQuality='high';
      photo.drawImage(bitmap,(bitmap.width-cropWidth)/2,(bitmap.height-cropHeight)/2,cropWidth,cropHeight,0,0,WIDTH,HEIGHT);
    } finally {bitmap.close();}
    rgba=photo.getImageData(0,0,WIDTH,HEIGHT).data;
    lastGrad=null;lastRotated=null;lastCenters=null;
    $('filename').textContent=`${name} · center crop ${WIDTH} × ${HEIGHT} · processed locally`;
    const isExampleImage = isExample || name === 'Example photo' || name === 'example.jpg';
    stage('depth','active');startWorker();worker.postMessage({id:currentJob,type:'infer',rgba,debug:debugMode,isExample:isExampleImage});
  } catch(error){if(currentJob!==job)return;controls(false);status(`Could not analyze this image: ${error.message}. Try a JPEG or PNG.`,true);}
}
$('file').addEventListener('change',()=>{const file=$('file').files[0];if(file)analyze(file,file.name);$('file').value='';});
async function loadExample(){
  if(busy)return;
  try{const response=await fetch(new URL('./models/example.jpg', import.meta.url));if(!response.ok)throw new Error('Example missing; run sh scripts/build_pipeline.sh');await analyze(await response.blob(),'Example photo',true);}
  catch(error){status(error.message,true);}
}
$('example').addEventListener('click',()=>void loadExample());
$('cancel').addEventListener('click',()=>{++job;worker?.terminate();worker=null;controls(false);for(const el of document.querySelectorAll('.stages .active'))el.classList.remove('active');status('Canceled. Choose another image to start again.');$('result-heading').textContent=depth?'Depth ready · detection canceled':'Canceled';});
function handlePixelSelect(canvasEl, e) {
  if (!debugMode || !depth || !range) return;
  const rect = canvasEl.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) * (WIDTH / rect.width));
  const y = Math.floor((e.clientY - rect.top) * (HEIGHT / rect.height));
  if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) {
    const d = depth[y * WIDTH + x];
    if (Number.isFinite(d) && d > 0) {
      const spread = spreadFromSlider($('spread').value);
      const pt = pointAt(x, y, d, range, spread);
      currentGrabs = [pt];
      updateLines();
    }
  }
}
$('depth').addEventListener('click', e => handlePixelSelect($('depth'), e));
$('photo').addEventListener('click', e => handlePixelSelect($('photo'), e));
function updateLines() {
  if(!viewer) return;
  if(!debugMode || currentGrabs.length !== 1 || !depth || !range) {
    viewer.setLines(baseLines);
    return;
  }
  const spread=spreadFromSlider($('spread').value);
  const grabLines=grabLevelCurveLines(depth,range,spread,currentGrabs,lastGrad,lastRotated);
  if(!grabLines.length) {
    viewer.setLines(baseLines);
    return;
  }
  const combined=new Float32Array(baseLines.length+grabLines.length);
  combined.set(baseLines,0);
  combined.set(grabLines,baseLines.length);
  viewer.setLines(combined);
}
for(const id of ['spread','threshold']){
  const el=$(id);
  if(!el)continue;
  el.addEventListener('input',()=>{
    const value=id==='spread'?spreadFromSlider(el.value):Number(el.value);
    $(`${id}-value`).value=value.toFixed(2);
    if(id==='spread')el.setAttribute('aria-valuetext',`${value.toFixed(2)}×`);
    rebuild(id==='spread');
  });
}
$('outlines').addEventListener('change',()=>rebuild(false));
$('reset').addEventListener('click',()=>viewer?.reset());
$('download').addEventListener('click',()=>{
  if(!candidates)return;
  const result={source:sourceName,analysisCrop:{width:WIDTH,height:HEIGHT,mode:'center'},
    depthModel:'Depth Anything V2 Small',detector:'sphere-detector StableHLO / IREE VMVX',
    scoreThreshold:Number($('threshold').value),iouThreshold:0.75,
    detections:selected,rawCandidates:Array.from(candidates),
    timingsMs:{depth:depthMs,detector:detectorMs},
    note:'Scores are not calibrated probabilities. Wireframes show base fitted depth profiles without RMSE skew correction; display coordinates are not metric.'};
  const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='sphere-results.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
const configDialog=$('config-dialog'), configControls=document.querySelector('.controls');
const configHome=document.createComment('configuration controls');
configControls.before(configHome);
function showConfig() {
  const stage=$('scene').parentElement;
  if(configDialog.open || !(stage.classList.contains('viewport-fullscreen') || document.fullscreenElement===stage))return;
  configDialog.prepend(configControls);
  configDialog.showModal();
}
$('config-open').addEventListener('click',showConfig);
$('config-close').addEventListener('click',()=>configDialog.close());
configDialog.addEventListener('close',()=>configHome.after(configControls));
document.addEventListener('fullscreenchange',()=>{
  if(configDialog.open && document.fullscreenElement!==$('scene').parentElement)configDialog.close();
});
try {
  viewer=await createViewer($('scene'),$('enter'),$('viewer-status'), {
    getConfig: () => ({
      spread: spreadFromSlider($('spread').value),
      threshold: Number($('threshold').value),
      outlines: $('outlines').checked
    }),
    setConfig: (key,value) => {
      if(key==='outlines') { $('outlines').checked=value; rebuild(false); }
      else {
        $(key).value=key==='spread'?spreadToSlider(value):value;
        $(key).dispatchEvent(new Event('input'));
      }
    },
    onGrabMove: grabs => {
      currentGrabs = grabs;
      updateLines();
    },
    onDebug: () => {
      debugMode = !debugMode;
      viewer?.setDebug(debugMode);
      status(debugMode ? 'Debug: level curve tracks active grab' : 'Debug mode off');
      if (debugMode && !lastRotated && depth && worker) {
        worker.postMessage({ id: job, type: 'curvature', depth });
      }
      rebuild(true);
    },
    showConfig,
  });
  if(depth)rebuild();
  else void loadExample();
}
catch(error){$('viewer-status').textContent=`3D view unavailable: ${error.message}`;}
