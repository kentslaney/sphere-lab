import {createViewer} from './viewer.js';
import {WIDTH,HEIGHT,pointCloud,sphereLines,selectDetections,depthRange,cloudBounds} from './geometry.js';
const $=id=>document.getElementById(id);
let viewer=null, worker=null, job=0, rgba=null, depth=null, candidates=null, range=null, bounds=null, cloudVertices=null;
let selected=[], sourceName='', depthMs=0, detectorMs=0, busy=false;
const photo=$('photo').getContext('2d'),depthCanvas=$('depth').getContext('2d');
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function controls(running){busy=running;$('file').disabled=running;$('example').disabled=running;$('cancel').hidden=!running;}
function stage(id,state){$(`stage-${id}`).className=state;}
function rebuild(updateCloud=true) {
  if(!depth||!rgba) return;
  const spread=Number($('spread').value), threshold=Number($('threshold').value);
  if(updateCloud) {
    const cloud=pointCloud(depth,rgba,spread);
    range=cloud.range;
    cloudVertices=cloud.vertices;
    bounds=cloudBounds(cloud.vertices);
    if(viewer)viewer.setCloud(cloud.vertices);
    $('point-count').textContent=`${(cloud.vertices.length/6).toLocaleString()} POINTS`;
  }
  const allLines=[];
  selected=candidates?selectDetections(candidates,threshold):[];
  if(viewer&&$('outlines').checked&&selected.length) {
    const outlines=sphereLines(selected,depth,range,spread);
    for(let i=0;i<outlines.length;i++) allLines.push(outlines[i]);
  }
  if(viewer)viewer.setLines(new Float32Array(allLines));
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
      } else if(data.type==='error'){controls(false);status(data.message,true);if(depth)$('result-heading').textContent='Depth ready · detector did not complete';}
    }catch(error){controls(false);status(error.message,true);}
  };
  worker.onerror=event=>{controls(false);status(event.message||'Inference worker failed. Reload to retry.',true);worker?.terminate();worker=null;};
}
async function analyze(blob,name){
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
    $('filename').textContent=`${name} · center crop ${WIDTH} × ${HEIGHT} · processed locally`;
    stage('depth','active');startWorker();worker.postMessage({id:currentJob,type:'infer',rgba});
  } catch(error){if(currentJob!==job)return;controls(false);status(`Could not analyze this image: ${error.message}. Try a JPEG or PNG.`,true);}
}
$('file').addEventListener('change',()=>{const file=$('file').files[0];if(file)analyze(file,file.name);$('file').value='';});
$('example').addEventListener('click',async()=>{
  if(busy)return;
  try{const response=await fetch(new URL('./models/example.jpg', import.meta.url));if(!response.ok)throw new Error('Example missing; run sh scripts/build_pipeline.sh');await analyze(await response.blob(),'Example photo');}
  catch(error){status(error.message,true);}
});
$('cancel').addEventListener('click',()=>{++job;worker?.terminate();worker=null;controls(false);for(const el of document.querySelectorAll('.stages .active'))el.classList.remove('active');status('Canceled. Choose another image to start again.');$('result-heading').textContent=depth?'Depth ready · detection canceled':'Canceled';});
for(const id of ['spread','threshold'])$(''+id).addEventListener('input',()=>{
  $(`${id}-value`).value=Number($(id).value).toFixed(2);rebuild(id==='spread');
});
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
try {
  viewer=await createViewer($('scene'),$('enter'),$('viewer-status'));
  if(depth)rebuild();
}
catch(error){$('viewer-status').textContent=`3D view unavailable: ${error.message}`;}
