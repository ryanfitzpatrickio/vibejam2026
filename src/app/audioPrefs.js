const AUDIO_PREFS_KEY = 'mouse-trouble-audio-prefs';

export function readAudioPrefs() {
  try {
    const raw = window.localStorage?.getItem(AUDIO_PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      musicMuted: !!parsed?.musicMuted,
      sfxMuted: !!parsed?.sfxMuted,
    };
  } catch {
    return { musicMuted: false, sfxMuted: false };
  }
}

export function writeAudioPrefs(prefs) {
  try {
    window.localStorage?.setItem(AUDIO_PREFS_KEY, JSON.stringify({
      musicMuted: !!prefs.musicMuted,
      sfxMuted: !!prefs.sfxMuted,
    }));
  } catch {
    // Local storage may be unavailable in private contexts.
  }
}
