// Upload a video from the web admin.
//
// 1. Prepare it in the browser (Mediabunny + the browser's own video encoder):
//    - already a web-ready 1080p H.264 MP4/MOV  -> repackaged so it starts playing instantly (no quality loss)
//    - anything else the browser can decode     -> converted to 1080p H.264 + AAC
//    - ProRes and other formats browsers can't read -> a clear message to use the desktop app instead
// 2. Upload it in chunks to the upload service (upload.matthewfregnan.com), which checks the same
//    GitHub token the admin signs in with and writes straight into the video storage.

const MEDIABUNNY = 'https://cdn.jsdelivr.net/npm/mediabunny@1.65.2/dist/bundles/mediabunny.min.mjs';
export const UPLOAD_ENDPOINT = 'https://upload.matthewfregnan.com';
const CHUNK = 20 * 1024 * 1024;           // R2 needs parts of at least 5 MB (except the last)
const MAX_SIZE = 1024 * 1024 * 1024;      // keep things sensible for a browser tab
const VIDEO_TYPES = /\.(mp4|mov|m4v|webm|mkv)$/i;

let mb;
const lib = async () => (mb ||= await import(MEDIABUNNY));

export class UploadError extends Error {}

export const looksLikeVideo = file => file && (file.type.startsWith('video/') || VIDEO_TYPES.test(file.name));

/** Make a web-ready MP4 Blob from `file`. onProgress(fraction 0..1, label). */
export async function prepare(file, onProgress) {
  if (file.size > MAX_SIZE) throw new UploadError('That file is over 1 GB. Use the desktop app for very large masters.');
  const { Input, Output, Conversion, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS } = await lib();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let video;
  try {
    video = await input.getPrimaryVideoTrack();
  } catch {
    throw new UploadError("This browser can't read that file. Try an MP4 or MOV export, or use the desktop app.");
  }
  if (!video) throw new UploadError('That file has no video in it.');
  const audio = await input.getPrimaryAudioTrack();
  const w = video.displayWidth;
  const h = video.displayHeight;
  const tooBig = Math.max(w, h) > 1920 || Math.min(w, h) > 1080;
  const webReady = video.codec === 'avc' && !tooBig;

  const videoOptions = webReady ? {} : {
    codec: 'avc',
    bitrate: 8_000_000,
    forceTranscode: true,
    ...(tooBig ? (w >= h ? { width: 1920 } : { height: 1920 }) : {}),
  };
  const audioOptions = !audio || audio.codec === 'aac' ? {} : { codec: 'aac', bitrate: 192_000 };

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const conversion = await Conversion.init({ input, output, video: videoOptions, audio: audioOptions, showWarnings: false });
  if (!conversion.isValid) {
    const prores = video.codec === 'prores';
    throw new UploadError(prores
      ? "Browsers can't read ProRes. Upload this one with the desktop app (it converts ProRes), or export an H.264 MP4."
      : "This browser can't convert that video. Try exporting an H.264 MP4, or use the desktop app.");
  }
  const label = webReady ? 'Preparing (no re-encode needed)' : `Converting ${w}×${h} ${video.codec} to 1080p`;
  conversion.onProgress = p => onProgress(p, label);
  onProgress(0, label);
  await conversion.execute();
  return new Blob([output.target.buffer], { type: 'video/mp4' });
}

async function call(endpoint, token, method, path, body, headers = {}) {
  let res;
  try {
    res = await fetch(`${endpoint}${path}`, {
      method, body, headers: { Authorization: `Bearer ${token}`, ...headers },
    });
  } catch {
    throw new UploadError("Couldn't reach the upload service. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new UploadError(data.error || `Upload service error (${res.status})`);
  return data;
}

/** Upload `blob` to the video storage at `key` ("category/project.mp4"); returns the public address. */
export async function upload(blob, key, { token, endpoint = UPLOAD_ENDPOINT, onProgress, signal }) {
  const q = `?key=${encodeURIComponent(key)}`;
  const { uploadId } = await call(endpoint, token, 'POST', `/uploads${q}`);
  const parts = [];
  try {
    for (let i = 0, n = 1; i < blob.size; i += CHUNK, n++) {
      if (signal?.aborted) throw new UploadError('Upload cancelled.');
      const part = await call(endpoint, token, 'PUT', `/uploads/${uploadId}/${n}${q}`, blob.slice(i, i + CHUNK));
      parts.push({ partNumber: part.partNumber, etag: part.etag });
      onProgress?.(Math.min(1, (i + CHUNK) / blob.size));
    }
    const done = await call(endpoint, token, 'POST', `/uploads/${uploadId}/complete${q}`, JSON.stringify({ parts }),
      { 'Content-Type': 'application/json' });
    return done.url;
  } catch (e) {
    call(endpoint, token, 'DELETE', `/uploads/${uploadId}${q}`).catch(() => {});
    throw e;
  }
}
