import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCachedDepth, requestModelPersistence} from '../web/model-cache.js';

test('cached model loads without contacting the restarted auth server', async () => {
  const bytes = new Uint8Array([1,2,3]);
  const storage = {open: async () => ({match: async () => new Response(bytes)})};
  const result = await loadCachedDepth(new URL('https://example.org/models/depth.onnx'), () => { throw Error('auth unavailable'); }, storage);
  assert.deepEqual(result, bytes);
});
test('requests persistence only when it is not already granted', async () => {
  let requests = 0;
  const storage = {persisted: async () => true, persist: async () => {requests++; return false;}};
  assert.equal(await requestModelPersistence(storage), true);
  assert.equal(requests, 0);
  storage.persisted = async () => false;
  assert.equal(await requestModelPersistence(storage), false);
  assert.equal(requests, 1);
});
test('login HTML is rejected instead of being cached as model weights', async () => {
  let writes = 0;
  const storage = {open: async () => ({match: async () => undefined, put: async () => writes++})};
  await assert.rejects(loadCachedDepth(new URL('https://example.org/model.onnx'), async () => new TextEncoder().encode('<html>Login</html>'), storage), /checksum mismatch/);
  assert.equal(writes, 0);
});
