import { Injectable } from '@angular/core';

export type ThemePreference = 'light' | 'system' | 'dark';
const STORAGE_KEY = 'sigcotacao.theme';

function storedPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch { return 'system'; }
}

export function applyInitialTheme(preference = storedPreference()): void {
  const dark = preference === 'dark' || (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  preference: ThemePreference = storedPreference();

  constructor() {
    applyInitialTheme(this.preference);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (this.preference === 'system') applyInitialTheme('system');
    });
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        this.preference = storedPreference();
        applyInitialTheme(this.preference);
      }
    });
  }

  setPreference(preference: ThemePreference): void {
    this.preference = preference;
    try {
      if (preference === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, preference);
    } catch { /* O tema também funciona quando o armazenamento está indisponível. */ }
    applyInitialTheme(preference);
  }
}
