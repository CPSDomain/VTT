// Builds map blocks for the 1.7 art away from the screen's thread, so panning and animation never stall.
// Gets { id, sc, R, opts, x0, y0, n }, where sc holds just the squares and props around the block; sends back an ImageBitmap.
// The art modules load asynchronously (they fetch the catalog first), so jobs that arrive meanwhile wait in a queue.
let buildChunk = null;
const queue = [];

function run({ id, sc, R, opts, x0, y0, n }) {
  try {
    const c = buildChunk(sc, R, opts, x0, y0, n), bm = c.transferToImageBitmap();
    self.postMessage({ id, bm }, [bm]);
  } catch (err) { self.postMessage({ id, err: String((err && err.stack) || err) }); }
}

self.onmessage = (e) => { if (buildChunk) run(e.data); else queue.push(e.data); };

import('./art2.js').then((m) => { buildChunk = m.buildChunk; while (queue.length) run(queue.shift()); })
  .catch((err) => { const msg = String((err && err.stack) || err); while (queue.length) self.postMessage({ id: queue.shift().id, err: msg }); self.close(); });
