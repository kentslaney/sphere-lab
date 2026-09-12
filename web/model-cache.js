// Keep in sync with scripts/prepare_depth.py; auth cookies are not cache keys.
export const DEPTH_SHA256 = 'afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c';
export async function requestModelPersistence(storage = globalThis.navigator?.storage) {
  try {
    return !!(await storage?.persisted?.() || await storage?.persist?.());
  } catch (error) {
    console.warn('Persistent model storage unavailable:', error);
    return false;
  }
}
export async function loadCachedDepth(url, download, cacheStorage = globalThis.caches) {
  let cache;
  const key = new URL(`./da2-${DEPTH_SHA256}.onnx`, url).href;
  try {
    cache = await cacheStorage?.open('sphere-depth-models-v1');
    const cached = await cache?.match(key);
    if (cached) return new Uint8Array(await cached.arrayBuffer());
  } catch (error) { console.warn('Model cache read failed:', error); }
  const bytes = await download();
  // Reject login HTML and incomplete/corrupt downloads before saving them.
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== DEPTH_SHA256) throw new Error('Depth model checksum mismatch. Sign in again or rebuild the model.');
  try { await cache?.put(key, new Response(bytes)); }
  catch (error) { console.warn('Model cache write failed:', error); }
  return bytes;
}
