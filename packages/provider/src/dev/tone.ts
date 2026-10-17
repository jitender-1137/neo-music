/** Generates a mono 16-bit PCM WAV sine tone with a gentle fade, entirely in memory. */
const cache = new Map<string, Uint8Array>();

export function makeToneWav(freq: number, seconds: number, sampleRate = 22050): Uint8Array {
  const key = `${freq}:${seconds}:${sampleRate}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const n = Math.floor(seconds * sampleRate);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * 2, true);
  const fade = sampleRate * 0.3;
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / fade, (n - i) / fade);
    v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.25 * env * 32767, true);
  }
  const out = new Uint8Array(buf);
  cache.set(key, out);
  return out;
}
