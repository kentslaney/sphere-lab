const status = document.querySelector('#status');
const button = document.querySelector('#enter');
const canvas = document.querySelector('#scene');
const identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
const report = error => {
  console.error(error);
  status.textContent = error.message || String(error);
};

try {
  if (!isSecureContext) throw new Error('Open this page over trusted HTTPS.');
  if (!navigator.gpu) throw new Error('WebGPU is unavailable. Use Safari on visionOS 26.2 or later.');
  const { default: init, Renderer } = await import('./pkg/cube_renderer.js');
  await init();
  const renderer = await Renderer.create();
  const device = renderer.gpu_device();
  const context = canvas.getContext('webgpu');
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  let session = null;
  let stopped = false;
  let depth = null;
  let previewFrame = 0;
  device.addEventListener('uncapturederror', event => {
    stopped = true;
    button.disabled = true;
    report(event.error);
    session?.end().catch(report);
  });
  device.lost.then(info => {
    stopped = true;
    button.disabled = true;
    report(new Error(`GPU device lost: ${info.message}. Reload the page.`));
    session?.end().catch(report);
  });

  function resize() {
    const ratio = Math.min(devicePixelRatio, 2);
    const width = Math.max(1, Math.min(device.limits.maxTextureDimension2D, Math.floor(innerWidth * ratio)));
    const height = Math.max(1, Math.min(device.limits.maxTextureDimension2D, Math.floor(innerHeight * ratio)));
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    if (canvas.width === width && canvas.height === height && depth) return;
    canvas.width = width;
    canvas.height = height;
    context.configure({ device, format: canvasFormat, alphaMode: 'opaque' });
    depth?.destroy();
    depth = device.createTexture({ size: [width, height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
  }

  function preview(time) {
    if (session || stopped) return;
    try {
      resize();
      renderer.set_format(canvasFormat);
      const f = 1 / Math.tan(65 * Math.PI / 360);
      const near = 0.05, far = 100;
      // WebGPU uses 0..1 clip depth, including projections from WebGPU XR sessions.
      const projection = new Float32Array([
        f / (canvas.width / canvas.height),0,0,0, 0,f,0,0,
        0,0,far/(near-far),-1, 0,0,far*near/(near-far),0,
      ]);
      renderer.draw(context.getCurrentTexture(), depth, 0,
        new Float32Array([0, 0, canvas.width, canvas.height]), projection, identity, time / 1000);
      previewFrame = requestAnimationFrame(preview);
    } catch (error) { stopped = true; report(error); }
  }
  previewFrame = requestAnimationFrame(preview);

  if (!navigator.xr || !globalThis.XRGPUBinding || !await navigator.xr.isSessionSupported('immersive-vr')) {
    status.textContent = 'Cube preview ready. Immersive WebGPU requires Safari on visionOS 26.2 or later.';
  } else {
    status.textContent = 'Select Enter VR to view the cube around you.';
    button.disabled = false;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        if (session) { await session.end(); return; }
        const active = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['webgpu'] });
        session = active;
        cancelAnimationFrame(previewFrame);
        active.addEventListener('end', () => {
          session = null;
          button.textContent = 'Enter VR';
          button.disabled = stopped;
          if (!stopped) {
            status.textContent = 'Ready to enter VR again.';
            previewFrame = requestAnimationFrame(preview);
          }
        });
        try {
          const binding = new XRGPUBinding(active, device);
          const format = binding.getPreferredColorFormat();
          renderer.set_format(format);
          const layer = binding.createProjectionLayer({ colorFormat: format, depthStencilFormat: 'depth24plus' });
          active.updateRenderState({ layers: [layer], depthNear: 0.05, depthFar: 100 });
          const space = await active.requestReferenceSpace('local');
          if (session !== active) return;
          button.textContent = 'Exit VR';
          status.textContent = 'Immersive VR is active.';
          function frame(time, xrFrame) {
            if (session !== active || stopped) return;
            try {
              const pose = xrFrame.getViewerPose(space);
              if (pose) {
                for (const view of pose.views) {
                  const image = binding.getViewSubImage(layer, view);
                  const descriptor = image.getViewDescriptor();
                  const vp = image.viewport;
                  renderer.draw(image.colorTexture, image.depthStencilTexture,
                    descriptor.baseArrayLayer ?? 0,
                    new Float32Array([vp.x, vp.y, vp.width, vp.height]),
                    view.projectionMatrix, view.transform.inverse.matrix, time / 1000);
                }
              }
              active.requestAnimationFrame(frame);
            } catch (error) {
              stopped = true;
              report(error);
              active.end().catch(report);
            }
          }
          active.requestAnimationFrame(frame);
        } catch (error) {
          await active.end();
          throw error;
        }
      } catch (error) { report(error); }
      finally { button.disabled = stopped; }
    });
  }
} catch (error) {
  report(error);
  button.disabled = true;
}
