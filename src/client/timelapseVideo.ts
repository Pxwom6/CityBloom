/**
 * Making a timelapse video (M45): a view's stored frames played evenly through game time at 30 frames
 * a second, each cross-fading between the frames either side, with the chosen overlays (the city's
 * name, the date, its population, its milestones and disasters) and optional music, encoded as an MP4
 * with H.264 video: the format that plays on iPhones, Android phones and in group chats, and in
 * Chrome, Edge and Safari. WebCodecs encodes it much faster than real time (Chrome and Edge 94+,
 * Safari 16.4+); where it can't, `MediaRecorder` records it as it plays (MP4 if offered, else WebM).
 * The first and last frames, overlays on, come back as pictures too.
 */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { renderTimelapseMusic } from '../audio/timelapseMusic';
import { dateOf, monthLabel } from '../sim/time';
import type { FrameRecord } from './timelapseStore';
import { TIMELAPSE, frameMix } from './timelapseThin';

export interface TimelapseOverlays {
  name: boolean;
  date: boolean;
  population: boolean;
  events: boolean;
}

export interface TimelapseVideoOptions {
  frames: FrameRecord[];
  seconds: number;
  cityName: string;
  overlays: TimelapseOverlays;
  /** Milestones and disasters from the city's history, labelled. */
  events: { tick: number; label: string }[];
  music: boolean;
  onProgress?: (share: number) => void;
}

export interface TimelapseVideo {
  blob: Blob;
  type: string;
  ext: 'mp4' | 'webm';
  first: Blob;
  last: Blob;
  seconds: number;
  frames: number;
  /** How it was made: WebCodecs' H.264, or MediaRecorder's own. */
  how: string;
  audio: 'aac' | 'opus' | null;
}

const W = TIMELAPSE.width;
const H = TIMELAPSE.height;
const FPS = TIMELAPSE.fps;
/** H.264 profiles to try, the most widely played first (Baseline 3.1 takes 1280×720 at 30). */
const AVC = ['avc1.42001f', 'avc1.4d001f', 'avc1.640028'];
const VIDEO_BITRATE = 3_000_000;
/** How long a milestone or disaster's caption stays up (s of video). */
const CAPTION_S = 2.5;

export interface VideoSupport {
  /** WebCodecs with this H.264 profile, or MediaRecorder with this type, or nothing. */
  video: { kind: 'webcodecs'; codec: string } | { kind: 'recorder'; type: string } | null;
  /** Music's codec, where the video can carry it. */
  audio: 'aac' | 'opus' | null;
}

/** What this browser can make: probed once. */
export async function videoSupport(): Promise<VideoSupport> {
  let video: VideoSupport['video'] = null;
  if (typeof VideoEncoder !== 'undefined')
    for (const codec of AVC) {
      const ok = await VideoEncoder.isConfigSupported({
        codec,
        width: W,
        height: H,
        bitrate: VIDEO_BITRATE,
        framerate: FPS,
      }).catch(() => ({ supported: false }));
      if (ok.supported) {
        video = { kind: 'webcodecs', codec };
        break;
      }
    }
  if (!video && typeof MediaRecorder !== 'undefined') {
    const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    if (type) video = { kind: 'recorder', type };
  }
  let audio: VideoSupport['audio'] = null;
  if (video?.kind === 'webcodecs' && typeof AudioEncoder !== 'undefined')
    for (const codec of ['aac', 'opus'] as const) {
      const ok = await AudioEncoder.isConfigSupported({
        codec: codec === 'aac' ? 'mp4a.40.2' : 'opus',
        sampleRate: 48_000,
        numberOfChannels: 2,
        bitrate: 128_000,
      }).catch(() => ({ supported: false }));
      if (ok.supported) {
        audio = codec;
        break;
      }
    }
  // MediaRecorder carries the music it hears (an AudioContext's stream) in whatever it records.
  if (video?.kind === 'recorder') audio = video.type.includes('webm') ? 'opus' : 'aac';
  return { video, audio };
}

/** The overlay for a moment of the video. */
export function overlayText(
  o: TimelapseOverlays,
  cityName: string,
  tick: number,
  population: number,
  caption: string | null,
): { name: string | null; date: string | null; population: string | null; caption: string | null } {
  return {
    name: o.name ? cityName : null,
    date: o.date ? monthLabel(dateOf(tick).totalMonths) : null,
    population: o.population ? `${Math.round(population).toLocaleString('en-US')} residents` : null,
    caption: o.events ? caption : null,
  };
}

/** The caption on screen at game tick `t`: the latest event within `span` ticks before it. */
export function captionAt(events: { tick: number; label: string }[], t: number, span: number): string | null {
  let best: { tick: number; label: string } | null = null;
  for (const e of events) if (e.tick <= t && t - e.tick <= span && (!best || e.tick >= best.tick)) best = e;
  return best?.label ?? null;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function plate(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = 'rgba(20, 28, 24, 0.55)';
  const r = h / 3;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

function drawOverlays(ctx: Ctx, t: ReturnType<typeof overlayText>): void {
  const pad = Math.round(H * 0.035);
  ctx.textBaseline = 'middle';
  const font = (px: number, bold = false) =>
    `${bold ? '700' : '500'} ${Math.round(px)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  // The name and date top-left, the population top-right, a caption along the bottom.
  if (t.name || t.date) {
    const lines: [string, string][] = [];
    if (t.name) lines.push([t.name, font(H * 0.06, true)]);
    if (t.date) lines.push([t.date, font(H * 0.04)]);
    let w = 0;
    for (const [s, f] of lines) {
      ctx.font = f;
      w = Math.max(w, ctx.measureText(s).width);
    }
    const lh = H * 0.07;
    plate(ctx, pad, pad, w + pad * 1.4, lh * lines.length + pad * 0.4);
    ctx.fillStyle = '#fff';
    lines.forEach(([s, f], k) => {
      ctx.font = f;
      ctx.fillText(s, pad * 1.7, pad + pad * 0.2 + lh * (k + 0.5));
    });
  }
  if (t.population) {
    ctx.font = font(H * 0.045, true);
    const w = ctx.measureText(t.population).width;
    plate(ctx, W - pad - w - pad * 1.4, pad, w + pad * 1.4, H * 0.075);
    ctx.fillStyle = '#fff';
    ctx.fillText(t.population, W - pad - w - pad * 0.7, pad + H * 0.0375);
  }
  if (t.caption) {
    ctx.font = font(H * 0.045, true);
    const w = ctx.measureText(t.caption).width;
    plate(ctx, (W - w) / 2 - pad, H - pad - H * 0.085, w + pad * 2, H * 0.085);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(t.caption, (W - w) / 2, H - pad - H * 0.0425);
  }
}

/** Decoded frames, the two in use and the next kept. */
class Frames {
  private cache = new Map<number, ImageBitmap>();
  constructor(private frames: FrameRecord[]) {}
  async get(i: number): Promise<ImageBitmap> {
    let b = this.cache.get(i);
    if (!b) {
      b = await createImageBitmap(this.frames[i]!.blob);
      this.cache.set(i, b);
      // Only the frames around the one in use are kept.
      for (const [k, v] of this.cache)
        if (k < i - 1) {
          v.close();
          this.cache.delete(k);
        }
    }
    return b;
  }
  close(): void {
    for (const v of this.cache.values()) v.close();
    this.cache.clear();
  }
}

/** Draw video frame `i` of `n` onto `ctx`. */
async function drawFrame(ctx: Ctx, frames: Frames, o: TimelapseVideoOptions, i: number, n: number) {
  const ticks = o.frames.map((f) => f.tick);
  const { a, b, mix } = frameMix(ticks, i, n);
  ctx.globalAlpha = 1;
  ctx.drawImage(await frames.get(a), 0, 0, W, H);
  if (b !== a && mix > 0) {
    ctx.globalAlpha = mix;
    ctx.drawImage(await frames.get(b), 0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  const fa = o.frames[a]!;
  const fb = o.frames[b]!;
  const tick = fa.tick + (fb.tick - fa.tick) * mix;
  const pop = fa.population + (fb.population - fa.population) * mix;
  const span = ((ticks[ticks.length - 1]! - ticks[0]!) * CAPTION_S) / o.seconds;
  drawOverlays(ctx, overlayText(o.overlays, o.cityName, tick, pop, captionAt(o.events, tick, span)));
}

function canvas(): { c: OffscreenCanvas | HTMLCanvasElement; ctx: Ctx } {
  const c =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : document.createElement('canvas');
  c.width = W;
  c.height = H;
  return { c, ctx: c.getContext('2d') as Ctx };
}

async function picture(c: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('No picture'))), 'image/jpeg', 0.9),
  );
}

const yieldToPage = () => new Promise((r) => setTimeout(r, 0));

/** Make the video. */
export async function makeTimelapseVideo(o: TimelapseVideoOptions): Promise<TimelapseVideo> {
  if (o.frames.length < 2) throw new Error('The timelapse needs a few frames first');
  const support = await videoSupport();
  if (!support.video) throw new Error('This browser can’t make videos');
  const n = Math.round(o.seconds * FPS);
  const frames = new Frames(o.frames);
  try {
    // The first and last frames as pictures.
    const pic = canvas();
    await drawFrame(pic.ctx, frames, o, 0, n);
    const first = await picture(pic.c);
    await drawFrame(pic.ctx, frames, o, n - 1, n);
    const last = await picture(pic.c);
    const music = o.music && support.audio ? await renderTimelapseMusic(o.seconds) : null;
    if (support.video.kind === 'webcodecs')
      return {
        ...(await encodeWebCodecs(o, frames, n, support.video.codec, music, support.audio)),
        first,
        last,
      };
    return { ...(await recordRealTime(o, frames, n, support.video.type, music)), first, last };
  } finally {
    frames.close();
  }
}

async function encodeWebCodecs(
  o: TimelapseVideoOptions,
  frames: Frames,
  n: number,
  codec: string,
  music: AudioBuffer | null,
  audio: 'aac' | 'opus' | null,
): Promise<Omit<TimelapseVideo, 'first' | 'last'>> {
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H, frameRate: FPS },
    ...(music && audio ? { audio: { codec: audio, numberOfChannels: 2, sampleRate: music.sampleRate } } : {}),
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let failed: Error | null = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failed = e instanceof Error ? e : new Error(String(e))),
  });
  enc.configure({
    codec,
    width: W,
    height: H,
    bitrate: VIDEO_BITRATE,
    framerate: FPS,
    avc: { format: 'avc' },
  });
  const { c, ctx } = canvas();
  for (let i = 0; i < n; i++) {
    if (failed) throw failed;
    await drawFrame(ctx, frames, o, i, n);
    const vf = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    // A key frame every two seconds.
    enc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
    vf.close();
    while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
    if (i % 15 === 0) {
      o.onProgress?.((i / n) * (music ? 0.9 : 1));
      await yieldToPage();
    }
  }
  await enc.flush();
  enc.close();
  if (failed) throw failed;
  if (music && audio) await encodeAudio(muxer, music, audio);
  muxer.finalize();
  o.onProgress?.(1);
  return {
    blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }),
    type: 'video/mp4',
    ext: 'mp4',
    seconds: o.seconds,
    frames: n,
    how: `WebCodecs ${codec}`,
    audio: music ? audio : null,
  };
}

async function encodeAudio(muxer: Muxer<ArrayBufferTarget>, buf: AudioBuffer, codec: 'aac' | 'opus') {
  let failed: Error | null = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => (failed = e instanceof Error ? e : new Error(String(e))),
  });
  enc.configure({
    codec: codec === 'aac' ? 'mp4a.40.2' : 'opus',
    sampleRate: buf.sampleRate,
    numberOfChannels: 2,
    bitrate: 128_000,
  });
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  const step = 4800;
  for (let s = 0; s < buf.length; s += step) {
    const len = Math.min(step, buf.length - s);
    const data = new Float32Array(len * 2);
    data.set(l.subarray(s, s + len), 0);
    data.set(r.subarray(s, s + len), len);
    const ad = new AudioData({
      format: 'f32-planar',
      sampleRate: buf.sampleRate,
      numberOfFrames: len,
      numberOfChannels: 2,
      timestamp: Math.round((s * 1e6) / buf.sampleRate),
      data,
    });
    enc.encode(ad);
    ad.close();
  }
  await enc.flush();
  enc.close();
  if (failed) throw failed;
}

/** Where WebCodecs can't: the frames played on a canvas at their pace, and recorded as they play. */
async function recordRealTime(
  o: TimelapseVideoOptions,
  frames: Frames,
  n: number,
  type: string,
  music: AudioBuffer | null,
): Promise<Omit<TimelapseVideo, 'first' | 'last'>> {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const stream = c.captureStream(FPS);
  let audioCtx: AudioContext | null = null;
  if (music) {
    audioCtx = new AudioContext({ sampleRate: music.sampleRate });
    const src = audioCtx.createBufferSource();
    src.buffer = music;
    const dest = audioCtx.createMediaStreamDestination();
    src.connect(dest);
    for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
    src.start();
  }
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: VIDEO_BITRATE });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  await drawFrame(ctx, frames, o, 0, n);
  rec.start(1000);
  const start = performance.now();
  for (let i = 0; i < n; i++) {
    const due = start + (i * 1000) / FPS;
    const wait = due - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    await drawFrame(ctx, frames, o, i, n);
    if (i % 15 === 0) o.onProgress?.(i / n);
  }
  rec.stop();
  await stopped;
  await audioCtx?.close();
  o.onProgress?.(1);
  const mp4 = type.startsWith('video/mp4');
  return {
    blob: new Blob(parts, { type: mp4 ? 'video/mp4' : 'video/webm' }),
    type: mp4 ? 'video/mp4' : 'video/webm',
    ext: mp4 ? 'mp4' : 'webm',
    seconds: o.seconds,
    frames: n,
    how: `MediaRecorder ${type}`,
    audio: music ? (mp4 ? 'aac' : 'opus') : null,
  };
}
