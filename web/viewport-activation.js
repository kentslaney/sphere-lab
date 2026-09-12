// Keep page scrolling available until a deliberate click activates a coarse
// pointer viewport. Fullscreen is requested from that click, before any await.
export function attachViewportActivation(canvas, exitButton, clearPointers, enabled = () => true, report = console.error) {
  const stage = canvas.parentElement;
  const document = canvas.ownerDocument, window = document.defaultView;
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  let viewportActive = false, nativeFullscreen = false;
  const acceptsInput = () => enabled() && !document.querySelector('dialog[open]') && (!coarsePointer.matches || viewportActive);
  const updateInputMode = () => {
    canvas.style.touchAction = !coarsePointer.matches || viewportActive ? 'none' : 'auto';
    stage.classList.toggle('needs-activation', coarsePointer.matches && !viewportActive);
    canvas.setAttribute('aria-label', coarsePointer.matches && !viewportActive ? 'Tap to open point cloud full screen' : 'Interactive colored point cloud');
  };
  const leaveViewport = () => {
    viewportActive = false; nativeFullscreen = false; clearPointers();
    stage.classList.remove('viewport-fullscreen'); document.body.classList.remove('viewport-expanded');
    exitButton.hidden = true; updateInputMode();
  };
  const activateViewport = async () => {
    viewportActive = true; clearPointers();
    stage.classList.add('viewport-fullscreen'); document.body.classList.add('viewport-expanded');
    exitButton.hidden = false; updateInputMode();
    try {
      // Called directly by click to preserve fullscreen's user activation.
      if (stage.requestFullscreen) { await stage.requestFullscreen(); nativeFullscreen = document.fullscreenElement === stage; }
    } catch (_) { /* Keep a viewport-filling fallback where native fullscreen is unavailable. */ }
  };
  canvas.addEventListener('click', () => {
    if (coarsePointer.matches && !viewportActive && enabled()) void activateViewport();
  });
  exitButton.addEventListener('click', async () => {
    if (document.fullscreenElement === stage) await document.exitFullscreen().catch(report);
    leaveViewport();
  });
  document.addEventListener('fullscreenchange', () => {
    clearPointers();
    if (document.fullscreenElement === stage) nativeFullscreen = true;
    else if (nativeFullscreen) leaveViewport();
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && viewportActive && !document.fullscreenElement && !document.querySelector('dialog[open]')) leaveViewport();
  });
  window.addEventListener('blur', clearPointers);
  window.addEventListener('resize', clearPointers);
  coarsePointer.addEventListener('change', () => { clearPointers(); updateInputMode(); });
  updateInputMode();

  return acceptsInput;
}
