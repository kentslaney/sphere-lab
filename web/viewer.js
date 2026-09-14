import { attachViewportActivation } from './viewport-activation.js';
import { raycastDistance, solveTouchCamera, wheelTranslation } from './viewport-navigation.js';
import { XRConfig } from './config.js';
import { menuPixels, menuVertices, menuHeight, MENU_WIDTH, MENU_HEIGHT, getMenuItems } from './xr-menu.js';
import { grabFeedbackVertices, buildDebugSphereVertices } from './xr-feedback.js';
import { CloudGrab, attachCloudGrab, rotate } from './xr-grab.js';

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

export async function createViewer(canvas, button, status, options = {}) {
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
    let worldPoints = null, worldDirty = true;
    let modelOffset = [0, 0, 0], modelScale = 1, modelRotation = [0, 0, 0, 1];
    let debugMode = false;
    const config = new XRConfig(options.getConfig ?? (() => ({ spread: 1, threshold: 0.1, outlines: true })), options.setConfig ?? (() => {}));

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
      modelOffset = [...grab.position]; modelScale = grab.scale; modelRotation = [...grab.rotation]; worldDirty = true;
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
      status.textContent = 'Drag to look · Scroll sideways or forward · Touch: tap to expand, then drag or pinch.';
    } else {
      status.textContent = 'Drag to look · Scroll sideways or forward · VR: pinch to grab, quick double pinch for config.';
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
            config.close(); renderer.set_menu(new Float32Array());
            renderer.set_hud(new Float32Array());
            renderer.set_grab_feedback(new Float32Array());
            renderer.clear_grab_level_curve?.();
            renderer.set_center_animation?.(0.0);
            centersActive = false;
            centerAnimT = 0.0;
            options.onGrabMove?.([]);
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
            let menuSelection = '', menuOrigin = [0, 0, -1], configTexture = '';
            let configWasOpen = false;
            let lastClosestModel = null;
            let isSelected = false;
            let centersActive = false;
            let centerAnimT = 0.0;
            let lastAnimTime = 0;

            const updateGrab = attachCloudGrab(active, space, grab, applyGrab, (markers, meta = {}) => {
              const isSingleDebugGrab = Boolean(meta.isSingleDebugGrab && markers.length === 1);
              isSelected = Boolean(meta.isPointSelected);
              let closestPointWorld = null;

              if (isSingleDebugGrab) {
                const m = markers[0];
                const dx = (m.position[0] - grab.position[0]) / grab.scale;
                const dy = (m.position[1] - grab.position[1]) / grab.scale;
                const dz = (m.position[2] - grab.position[2]) / grab.scale;
                const qInv = [-grab.rotation[0], -grab.rotation[1], -grab.rotation[2], grab.rotation[3]];
                const modelPos = rotate(qInv, [dx, dy, dz]);

                const closestModel = renderer.update_grab_level_curve(modelPos[0], modelPos[1], modelPos[2]);
                if (closestModel && closestModel.length >= 3) {
                  lastClosestModel = [...closestModel];
                  const scaledPt = [closestModel[0] * grab.scale, closestModel[1] * grab.scale, closestModel[2] * grab.scale];
                  const rotPt = rotate(grab.rotation, scaledPt);
                  closestPointWorld = [rotPt[0] + grab.position[0], rotPt[1] + grab.position[1], rotPt[2] + grab.position[2]];
                }
              } else if (isSelected && lastClosestModel) {
                renderer.update_grab_level_curve(lastClosestModel[0], lastClosestModel[1], lastClosestModel[2]);
                const scaledPt = [lastClosestModel[0] * grab.scale, lastClosestModel[1] * grab.scale, lastClosestModel[2] * grab.scale];
                const rotPt = rotate(grab.rotation, scaledPt);
                closestPointWorld = [rotPt[0] + grab.position[0], rotPt[1] + grab.position[1], rotPt[2] + grab.position[2]];
              } else {
                renderer.clear_grab_level_curve();
                if (!meta.isPendingPause) {
                  lastClosestModel = null;
                }
              }

              const feedback = grabFeedbackVertices(markers, currentViewerPos, closestPointWorld, isSingleDebugGrab, isSelected);
              renderer.set_grab_feedback(feedback);
            }, menu => {
              if (!menu) { renderer.set_menu(new Float32Array()); return; }
              const items = getMenuItems(debugMode, centersActive);
              const disabled = centersActive ? [1] : [];
              const menuKey = `${menu.selected}_${debugMode}_${centersActive}`;
              const height = menuHeight(items);
              if (menuKey !== menuSelection) {
                renderer.set_menu_texture(menuPixels(menu.selected, items, '', disabled), MENU_WIDTH, height);
                menuSelection = menuKey;
              }
              menuOrigin = [...menu.origin];
              renderer.set_menu(menuVertices(menu.origin, currentViewerPos, height, items.length - 1));
            }, selected => {
              if (selected === 0) {
                const dx = currentViewerPos[0] - menuOrigin[0], dz = currentViewerPos[2] - menuOrigin[2];
                const length = Math.hypot(dx, dz);
                config.open(menuOrigin, length > 1e-5 ? [dz / length, 0, -dx / length] : [1, 0, 0]);
                configTexture = ''; menuSelection = '';
              } else if (selected === 1) {
                if (!centersActive) options.onDebug?.();
              } else if (selected === 2) {
                centersActive = !centersActive;
                menuSelection = '';
              }
            }, config, () => debugMode);
            function frame(time, xrFrame) {
              if (session !== active || stopped) return;
              // Request next frame at the start so visionOS compositor watchdog never times out
              active.requestAnimationFrame(frame);
              try {
                if (lastAnimTime > 0) {
                  const dt = Math.min(0.1, (time - lastAnimTime) / 1000);
                  const targetT = centersActive ? 1.0 : 0.0;
                  if (centerAnimT !== targetT) {
                    const speed = 1.0 / 0.8;
                    if (targetT > centerAnimT) {
                      centerAnimT = Math.min(targetT, centerAnimT + speed * dt);
                    } else {
                      centerAnimT = Math.max(targetT, centerAnimT - speed * dt);
                    }
                    renderer.set_center_animation(centerAnimT);
                  }
                }
                lastAnimTime = time;
                const viewerPose = xrFrame.getViewerPose(space);
                if (viewerPose) {
                  const p = viewerPose.transform.position;
                  currentViewerPos = [p.x, p.y, p.z];
                }
                updateGrab(xrFrame, time);
                if (config.isOpen) {
                  const items = config.items(), hint = 'Hover to choose · Grab and slide left/right';
                  const key = JSON.stringify([items, config.selected]);
                  const height = menuHeight(items, hint);
                  if (key !== configTexture) {
                    renderer.set_menu_texture(menuPixels(config.selected, items, hint), MENU_WIDTH, height);
                    configTexture = key;
                  }
                  renderer.set_menu(menuVertices(config.origin, currentViewerPos, height, 3, config.right));
                } else if (configWasOpen) renderer.set_menu(new Float32Array());
                configWasOpen = config.isOpen;
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
      if (worldDirty) {
        worldPoints = cloudPoints && new Float32Array(cloudPoints.length);
        for (let i = 0; i < (cloudPoints?.length ?? 0); i += 6) {
          const p = rotate(modelRotation, Array.from(cloudPoints.subarray(i, i + 3), v => v * modelScale));
          worldPoints.set(p.map((v, j) => v + modelOffset[j]), i);
        }
        worldDirty = false;
      }
      return raycastDistance(worldPoints, camPos, rayDir, getCameraVectors().forward, canvasH, fFov);
    }

    const touches = new Map();
    const clearPointers = () => { touches.clear(); drag = null; renderer.set_grab_feedback(new Float32Array()); options.onGrabMove?.([]); };
    const acceptsInput = attachViewportActivation(canvas, document.getElementById('viewport-exit'), clearPointers, () => !session && !stopped, report);

    canvas.addEventListener('pointerdown', event => {
      if (!acceptsInput() || (event.pointerType === 'mouse' && event.button !== 0)) return;
      if (event.pointerType !== 'touch' && (drag || touches.size)) return;
      canvas.setPointerCapture(event.pointerId);
      const { worldRay, h, fFov } = getRaycast(event.clientX, event.clientY);
      const dist = resolveRaycastDistance(worldRay, h, fFov);
      const targetPoint = [
        camPos[0] + dist * worldRay[0],
        camPos[1] + dist * worldRay[1],
        camPos[2] + dist * worldRay[2]
      ];

      if (event.pointerType === 'touch') {
        touches.set(event.pointerId, { point: targetPoint, clientX: event.clientX, clientY: event.clientY });
        drag = null;
        return;
      }

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
        pointerId: event.pointerId,
        targetPoint,
        targetAzimuth,
        targetElevation
      };
      options.onGrabMove?.([targetPoint]);
    });

    canvas.addEventListener('pointermove', event => {
      if (!acceptsInput()) return;
      if (touches.has(event.pointerId)) {
        const touch = touches.get(event.pointerId);
        touch.clientX = event.clientX; touch.clientY = event.clientY;
        camPos = solveTouchCamera(camPos, getCameraVectors(), [...touches.values()].map(t => ({
          point: t.point, ray: getRaycast(t.clientX, t.clientY).worldRay,
        })));
        notifyPose();
        options.onGrabMove?.([...touches.values()].map(t => t.point));
        return;
      }
      if (!drag || drag.pointerId !== event.pointerId) return;
      const { normCamRay } = getRaycast(event.clientX, event.clientY);
      const camAlphaX = Math.atan2(-normCamRay[0], -normCamRay[2]);
      const camAlphaY = Math.asin(Math.max(-1, Math.min(1, normCamRay[1])));

      yaw = drag.targetAzimuth - camAlphaX;
      pitch = Math.max(-1.4, Math.min(1.4, drag.targetElevation - camAlphaY));
      notifyPose();
      options.onGrabMove?.([drag.targetPoint]);
    });

    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, event => {
        touches.delete(event.pointerId);
        if (drag?.pointerId === event.pointerId) { drag = null; renderer.set_grab_feedback(new Float32Array()); }
        if (!touches.size && !drag) options.onGrabMove?.([]);
      });
    }
    canvas.addEventListener('contextmenu', event => {
      const stage = canvas.parentElement;
      if (!acceptsInput() || !(stage.classList.contains('viewport-fullscreen') || document.fullscreenElement === stage)) return;
      event.preventDefault(); clearPointers(); options.showConfig?.();
    });

    canvas.addEventListener('wheel', event => {
      if (!acceptsInput() || touches.size || drag) return;
      event.preventDefault();
      const delta = wheelTranslation(event, getCameraVectors(), canvas.clientHeight);
      camPos = camPos.map((v, i) => v + delta[i]);
      notifyPose();
    }, { passive: false });

    return {
      setCloud: points => {
        cloudPoints = points; worldDirty = true; clearPointers();
        renderer.set_cloud(points);
      },
      setLines: lines => renderer.set_lines(lines),
      setHud: vertices => renderer.set_hud(vertices),
      reset: () => {
        clearPointers(); config.close(); renderer.set_menu(new Float32Array());
        modelOffset = [0, 0, 0]; modelScale = 1; modelRotation = [0, 0, 0, 1]; worldDirty = true;
        camPos = [0, 0, 2];
        yaw = 0;
        pitch = 0;
        drag = null;
        grab.reset();
        renderer.set_pose(0, 0, 0);
        renderer.set_grab(0, 0, 0, 1);
        renderer.set_grab_rotation(new Float32Array(modelRotation));
        renderer.clear_grab_level_curve?.();
        renderer.set_grab_feedback(new Float32Array());
        renderer.set_hud(new Float32Array());
        notifyPose();
      },
      clear: () => {
        clearPointers(); config.close(); renderer.set_menu(new Float32Array());
        cloudPoints = null; worldPoints = null; worldDirty = true;
        renderer.set_cloud(new Float32Array());
        renderer.set_lines(new Float32Array());
        renderer.set_hud(new Float32Array());
        renderer.clear_grab_level_curve?.();
        renderer.set_grab_feedback(new Float32Array());
        renderer.set_center_animation?.(0.0);
      },
      getCamera: getCameraState,
      setDebug: enabled => {
        debugMode = Boolean(enabled);
        if (!debugMode) {
          renderer.clear_grab_level_curve?.();
          renderer.set_grab_feedback(new Float32Array());
        }
      },
      setDepthMap: (depth, minDepth, maxDepth, spread) => {
        renderer.set_depth_map(depth, minDepth, maxDepth, spread);
      },
      setCurvature: (grad, rotated) => {
        renderer.set_curvature?.(grad, rotated);
      },
      setSpread: spread => {
        renderer.set_spread(spread);
      },
      setCenterAnimation: t => renderer.set_center_animation?.(t),
      getRenderer: () => renderer,
      triggerDebug: () => options.onDebug?.(),
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
