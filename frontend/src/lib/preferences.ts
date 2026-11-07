// Local preferences only. No Gemini key or document contents are stored here.
export type Theme = 'dark' | 'light';
export type MotionPreference = 'system' | 'reduced' | 'full';

export interface Preferences {
  theme: Theme;
  motion: MotionPreference;
  topK: number;
}

const KEYS = {
  theme: 'constellation:theme',
  motion: 'constellation:motion',
  topK: 'constellation:top-k',
} as const;

function read(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function save(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* App still works without storage. */ }
}

export function initialPreferences(): Preferences {
  const theme = read(KEYS.theme);
  const motion = read(KEYS.motion);
  const candidate = Number(read(KEYS.topK));
  return {
    theme: theme === 'dark' || theme === 'light'
      ? theme
      : window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    motion: motion === 'reduced' || motion === 'full' ? motion : 'system',
    topK: Number.isInteger(candidate) && candidate >= 2 && candidate <= 8 ? candidate : 5,
  };
}

export function persistPreferences(preferences: Preferences): void {
  save(KEYS.theme, preferences.theme);
  save(KEYS.motion, preferences.motion);
  save(KEYS.topK, String(preferences.topK));
}
