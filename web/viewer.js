import { grabFeedbackVertices, buildDebugSphereVertices } from './xr-feedback.js';
import { CloudGrab, attachCloudGrab } from './xr-grab.js';

async function loadWasmBytes(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url.pathname}`);
      return await res.arrayBuffer();
    } catch (err) {
      lastError = err;
      await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function createViewer(canvas, button, status) {
  const identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  const report = error => {
    console.error(error);
    status.textContent = error.message || String(error);
  };

  try {
    if (!isSecureContext) throw new Error('Open this page over trusted HTTPS.');
    if (!navigator.gpu) throw new Error('WebGPU is unavailable. Use Safari on visionOS 26.2 or later.');
    const { default: init, Renderer } = await import('./pkg/cube_renderer.js');
    const wasmBytes = await loadWasmBytes(new URL('./pkg/cube_renderer_bg.wasm', import.meta.url));
    await init({ module_or_path: wasmBytes });
    const renderer = await Renderer.create();
    const device = renderer.gpu_device();
    let context = canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    const grab = new CloudGrab();

    let camPos = [0, 0, 2];
    let yaw = 0, pitch = 0;
    let drag = null;
    let cloudPoints = null;

    renderer.set_pose(0, 0, 0);
    renderer.set_grab(0, 0, 0, 1);
    renderer.set_hud(new Float32Array());

    const getCameraVectors = () => {
      const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
      const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
      const forward = [-sinY * cosP, sinP, -cosY * cosP];
      const right = [cosY, 0, -sinY];
      const up = [sinY * sinP, cosP, cosY * sinP];
      return { forward, right, up };
    };

    const getViewMatrix = () => {
      const { forward, right, up } = getCameraVectors();
      const rx = right[0] * camPos[0] + right[1] * camPos[1] + right[2] * camPos[2];
      const uy = up[0] * camPos[0] + up[1] * camPos[1] + up[2] * camPos[2];
      const fz = -forward[0] * camPos[0] - forward[1] * camPos[1] - forward[2] * camPos[2];
      return new Float32Array([
        right[0], up[0], -forward[0], 0,
        right[1], up[1], -forward[1], 0,
        right[2], up[2], -forward[2], 0,
        -rx, -uy, -fz, 1
      ]);
    };

    const applyGrab = () => {
      renderer.set_grab(grab.position[0], grab.position[1], grab.position[2], grab.scale);
      renderer.set_grab_rotation(new Float32Array(grab.rotation));
    };

    const onPoseCallbacks = [];
    const getCameraState = () => ({
      yaw,
      pitch,
      distance: Math.hypot(...camPos),
      position: [...camPos],
      scale: grab.scale
    });
    const notifyPose = () => {
      const cam = getCameraState();
      for (const cb of onPoseCallbacks) cb(cam);
    };

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
      const width = Math.max(1, Math.min(device.limits.maxTextureDimension2D, Math.floor(canvas.clientWidth * ratio)));
      const height = Math.max(1, Math.min(device.limits.maxTextureDimension2D, Math.floor(canvas.clientHeight * ratio)));
      if (canvas.width === width && canvas.height === height && depth) return;
      canvas.width = width;
      canvas.height = height;
      if (!context) {
        context = canvas.getContext('webgpu');
      }
      if (context) {
        context.configure({ device, format: canvasFormat, alphaMode: 'opaque' });
      }
      depth?.destroy();
      depth = device.createTexture({ size: [width, height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }

    function preview(time) {
      if (session || stopped) return;
      try {
        resize();
        if (!context) {
          context = canvas.getContext('webgpu');
        }
        if (context) {
          renderer.set_format(canvasFormat);
          const f = 1 / Math.tan(65 * Math.PI / 360);
          const near = 0.05, far = 100;
          // WebGPU uses 0..1 clip depth, including projections from WebGPU XR sessions.
          const projection = new Float32Array([
            f / (canvas.width / canvas.height), 0, 0, 0,
            0, f, 0, 0,
            0, 0, far / (near - far), -1,
            0, 0, far * near / (near - far), 0,
          ]);
          const viewMatrix = getViewMatrix();
          renderer.draw(
            context.getCurrentTexture(), depth, 0,
            new Float32Array([0, 0, canvas.width, canvas.height]),
            projection, viewMatrix, time / 1000
          );
        }
        previewFrame = requestAnimationFrame(preview);
      } catch (error) {
        stopped = true;
        report(error);
      }
    }
    previewFrame = requestAnimationFrame(preview);

    let xrSupported = false;
    try {
      xrSupported = !!(navigator.xr && globalThis.XRGPUBinding && await navigator.xr.isSessionSupported('immersive-vr'));
    } catch (_) {
      xrSupported = false;
    }

    if (!xrSupported) {
      status.textContent = 'Drag to look · Scroll to move forward · VR requires a compatible headset.';
    } else {
      status.textContent = 'Drag to look · Scroll to move forward · VR: one pinch to move · Two pinches to scale.';
      button.disabled = false;
      let sessionStarting = false;
      button.addEventListener('click', async () => {
        if (sessionStarting) return;
        if (session) {
          button.disabled = true;
          try {
            await session.end();
          } catch (e) {
            report(e);
          } finally {
            button.disabled = stopped;
          }
          return;
        }

        sessionStarting = true;
        let sessionPromise;
        try {
          // On Apple Vision Pro (visionOS Safari), requestSession MUST be initiated synchronously in the user gesture.
          // Disabling the button before requestSession drops transient activation and causes "The operation is insecure".
          sessionPromise = navigator.xr.requestSession('immersive-vr', {
            requiredFeatures: ['local'],
            optionalFeatures: ['webgpu']
          });
        } catch (error) {
          sessionStarting = false;
          report(error);
          return;
        }

        button.disabled = true;
        try {
          const active = await sessionPromise;
          sessionStarting = false;
          session = active;
          if (previewFrame) cancelAnimationFrame(previewFrame);
          active.addEventListener('end', () => {
            session = null;
            button.textContent = 'Enter VR';
            button.disabled = stopped;
            renderer.set_hud(new Float32Array());
            renderer.set_grab_feedback(new Float32Array());
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
            status.textContent = 'VR: pinch and move to grab · Pinch with both hands and spread to scale.';
            grab.release();
            applyGrab();
            renderer.set_hud(new Float32Array());
            let currentViewerPos = [0, 0, 0];
            const updateGrab = attachCloudGrab(active, space, grab, applyGrab, markers => {
              const feedback = grabFeedbackVertices(markers, currentViewerPos);
              renderer.set_grab_feedback(feedback);
            });
            function frame(time, xrFrame) {
              if (session !== active || stopped) return;
              // Request next frame at the start so visionOS compositor watchdog never times out
              active.requestAnimationFrame(frame);
              try {
                const viewerPose = xrFrame.getViewerPose(space);
                if (viewerPose) {
                  const p = viewerPose.transform.position;
                  currentViewerPos = [p.x, p.y, p.z];
                }
                updateGrab(xrFrame, time);
                if (viewerPose) {
                  for (const view of viewerPose.views) {
                    const image = binding.getViewSubImage(layer, view);
                    if (!image || !image.colorTexture) continue;
                    let baseLayer = 0;
                    if (typeof image.getViewDescriptor === 'function') {
                      try {
                        const desc = image.getViewDescriptor();
                        if (desc && desc.baseArrayLayer !== undefined) baseLayer = desc.baseArrayLayer;
                      } catch (_) {}
                    }
                    const depthTexture = image.depthStencilTexture || depth;
                    const vp = image.viewport;
                    renderer.draw(
                      image.colorTexture, depthTexture,
                      baseLayer,
                      new Float32Array([vp.x, vp.y, vp.width, vp.height]),
                      view.projectionMatrix, view.transform.inverse.matrix, time / 1000
                    );
                  }
                }
              } catch (error) {
                console.error('XR frame render error:', error);
              }
            }
            active.requestAnimationFrame(frame);
          } catch (error) {
            try { await active.end(); } catch (_) {}
            throw error;
          }
        } catch (error) {
          report(error);
        } finally {
          sessionStarting = false;
          button.disabled = stopped;
        }
      });
    }

    function getRaycast(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      const aspect = w / h;
      const fFov = 1 / Math.tan(65 * Math.PI / 360);
      const nx = (2 * x / w) - 1;
      const ny = 1 - (2 * y / h);
      const camRay = [nx * aspect / fFov, ny / fFov, -1];
      const len = Math.hypot(...camRay);
      const normCamRay = camRay.map(v => v / len);
      const { forward, right, up } = getCameraVectors();
      const worldRay = [
        right[0] * normCamRay[0] + up[0] * normCamRay[1] - forward[0] * normCamRay[2],
        right[1] * normCamRay[0] + up[1] * normCamRay[1] - forward[1] * normCamRay[2],
        right[2] * normCamRay[0] + up[2] * normCamRay[1] - forward[2] * normCamRay[2]
      ];
      return { normCamRay, worldRay, x, y, w, h, aspect, fFov };
    }

    function resolveRaycastDistance(rayDir, canvasH, fFov) {
      const fallbackDist = 2.0;
      if (!cloudPoints || cloudPoints.length < 6) return fallbackDist;
      const pixelThreshold = 30;
      const angularThresh = pixelThreshold / (canvasH * fFov);
      const angularThreshSq = angularThresh * angularThresh;
      let bestT = -1;
      const step = cloudPoints.length > 300000 ? 12 : 6;
      for (let i = 0; i < cloudPoints.length; i += step) {
        const px = cloudPoints[i] - camPos[0];
        const py = cloudPoints[i + 1] - camPos[1];
        const pz = cloudPoints[i + 2] - camPos[2];
        const t = px * rayDir[0] + py * rayDir[1] + pz * rayDir[2];
        if (t < 0.05 || t > 50) continue;
        const perpSq = (px * px + py * py + pz * pz) - t * t;
        if (perpSq / (t * t) < angularThreshSq) {
          if (t < bestT || bestT < 0) {
            bestT = t;
          }
        }
      }
      return bestT > 0 ? bestT : fallbackDist;
    }

    canvas.addEventListener('pointerdown', event => {
      canvas.setPointerCapture(event.pointerId);
      const { normCamRay, worldRay, h, fFov } = getRaycast(event.clientX, event.clientY);
      const dist = resolveRaycastDistance(worldRay, h, fFov);
      const targetPoint = [
        camPos[0] + dist * worldRay[0],
        camPos[1] + dist * worldRay[1],
        camPos[2] + dist * worldRay[2]
      ];

      // Add a debug sphere at the distance where the raycast is being resolved
      const debugSphere = buildDebugSphereVertices(targetPoint, 0.04, [0.2, 0.9, 0.8], 0.75);
      renderer.set_grab_feedback(debugSphere);

      const vx = targetPoint[0] - camPos[0];
      const vy = targetPoint[1] - camPos[1];
      const vz = targetPoint[2] - camPos[2];
      const vLen = Math.hypot(vx, vy, vz);
      const targetAzimuth = Math.atan2(-vx / vLen, -vz / vLen);
      const targetElevation = Math.asin(Math.max(-1, Math.min(1, vy / vLen)));

      drag = {
        targetPoint,
        targetAzimuth,
        targetElevation
      };
    });

    canvas.addEventListener('pointermove', event => {
      if (!drag) return;
      const { normCamRay } = getRaycast(event.clientX, event.clientY);
      const camAlphaX = Math.atan2(-normCamRay[0], -normCamRay[2]);
      const camAlphaY = Math.asin(Math.max(-1, Math.min(1, normCamRay[1])));

      yaw = drag.targetAzimuth - camAlphaX;
      pitch = Math.max(-1.4, Math.min(1.4, drag.targetElevation - camAlphaY));
      notifyPose();
    });

    const endDrag = () => {
      if (drag) {
        drag = null;
        renderer.set_grab_feedback(new Float32Array());
      }
    };

    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, () => {
        drag = null;
        renderer.set_grab_feedback(new Float32Array());
      });
    }
    window.addEventListener('mouseup', endDrag);

    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      // Scroll moves forward along view gaze, not inwards
      const delta = -event.deltaY * 0.002;
      const { forward } = getCameraVectors();
      camPos[0] += forward[0] * delta;
      camPos[1] += forward[1] * delta;
      camPos[2] += forward[2] * delta;
      notifyPose();
    }, { passive: false });

    return {
      setCloud: points => {
        cloudPoints = points;
        renderer.set_cloud(points);
      },
      setLines: lines => renderer.set_lines(lines),
      setHud: vertices => renderer.set_hud(vertices),
      reset: () => {
        camPos = [0, 0, 2];
        yaw = 0;
        pitch = 0;
        drag = null;
        grab.reset();
        renderer.set_pose(0, 0, 0);
        renderer.set_grab(0, 0, 0, 1);
        renderer.set_grab_feedback(new Float32Array());
        renderer.set_hud(new Float32Array());
        notifyPose();
      },
      clear: () => {
        cloudPoints = null;
        renderer.set_cloud(new Float32Array());
        renderer.set_lines(new Float32Array());
        renderer.set_hud(new Float32Array());
        renderer.set_grab_feedback(new Float32Array());
      },
      getCamera: getCameraState,
      onPose: cb => {
        onPoseCallbacks.push(cb);
        cb(getCameraState());
      },
    };
  } catch (error) {
    report(error);
    button.disabled = true;
    throw error;
  }
}
