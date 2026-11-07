import { useEffect, useState } from 'react';
import { initialPreferences, persistPreferences, type Preferences } from '../lib/preferences';

// Theme and motion settings are shared by all upcoming modules.
export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(initialPreferences);
  const [osReducedMotion, setOsReducedMotion] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setOsReducedMotion(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', preferences.theme === 'dark');
    root.dataset.theme = preferences.theme;
    const reduced = preferences.motion === 'reduced' || (preferences.motion === 'system' && osReducedMotion);
    root.dataset.motion = reduced ? 'reduced' : 'full';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', preferences.theme === 'dark' ? '#05060D' : '#F7F6FB');
    persistPreferences(preferences);
  }, [preferences, osReducedMotion]);

  const reducedMotion = preferences.motion === 'reduced' || (preferences.motion === 'system' && osReducedMotion);
  return { preferences, setPreferences, reducedMotion };
}
