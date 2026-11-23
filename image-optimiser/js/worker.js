// Image Optimiser by Delf Studio: runs the engine off the main thread so the page stays smooth.
import { optimise, JobError } from './engine.js';

self.onmessage = async (e) => {
  const { type, id, job, file, settings } = e.data;
  if (type !== 'job') return;
  try {
    const result = await optimise(file, settings, (attempt) => postMessage({ type: 'progress', id, job, attempt }));
    postMessage({ type: 'done', id, job, result });
  } catch (err) {
    postMessage({ type: 'error', id, job, code: err instanceof JobError ? err.code : 'failed' });
  }
};
