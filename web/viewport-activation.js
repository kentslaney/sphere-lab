// Keep page scrolling available until a deliberate click activates a coarse
// pointer viewport. Fullscreen is requested from that click, before any await.
export function attachViewportActivation(canvas, exitButton, clearPointers, enabled = () => true, report = console.error) {
  const stage = canvas.parentElement;
  const document = canvas.ownerDocument, window = document.defaultView;
  const finePointer = window.matchMedia('(any-pointer: fine)');
  let viewportActive = false, nativeFullscreen = false;
  const acceptsInput = () => enabled() && !document.querySelector('dialog[open]') && (finePointer.matches || viewportActive);
  const updateInputMode = () => {
    canvas.style.touchAction = finePointer.matches || viewportActive ? 'none' : 'auto';
    stage.classList.toggle('needs-activation', !finePointer.matches && !viewportActive);
    canvas.setAttribute('aria-label', !finePointer.matches && !viewportActive ? 'Tap to open point cloud full screen' : 'Interactive colored point cloud');
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
    if (!finePointer.matches && !viewportActive && enabled()) void activateViewport();
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
  finePointer.addEventListener('change', () => { clearPointers(); updateInputMode(); });
  updateInputMode();

  return acceptsInput;
}
