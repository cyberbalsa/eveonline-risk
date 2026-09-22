const KEY = 'eve-warfront-audio-v1';
let config = { muted: false, volume: .28 };
try { const saved = JSON.parse(localStorage.getItem(KEY)); if (saved) config = { muted: !!saved.muted, volume: Math.max(0, Math.min(1, Number(saved.volume) || 0)) }; } catch {}
const clips = new Map();
export function audioSettings() { return { ...config }; }
export function setAudio(settings) {
  config = { ...config, ...settings };
  try { localStorage.setItem(KEY, JSON.stringify(config)); } catch {}
  for (const clip of clips.values()) { clip.volume = config.volume; if (config.muted) clip.pause(); }
}
export function sound(name) {
  if (config.muted || document.hidden || config.volume === 0) return;
  try {
    if (!clips.has(name)) clips.set(name, new Audio(new URL(`./assets/sounds/${name}.mp3`, import.meta.url).href));
    const clip = clips.get(name); clip.currentTime = 0; clip.volume = config.volume;
    clip.play().catch(() => {});
  } catch { /* Unavailable audio never interrupts rules. */ }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) for (const clip of clips.values()) clip.pause(); });
