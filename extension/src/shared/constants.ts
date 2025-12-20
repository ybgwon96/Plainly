import type { LanguageCode, TranslationSettings } from './types';

export const API_URL = 'https://plainly-translator.vercel.app/api/translate';

export const DEFAULT_SETTINGS: TranslationSettings = {
  sourceLang: 'en',
  targetLang: 'ko',
  autoTranslate: false
};

export const LANGUAGE_NAMES: Record<LanguageCode, { code: string; name: string; native: string }> = {
  en: { code: 'EN', name: 'English', native: 'English' },
  ko: { code: 'KO', name: 'Korean', native: '한국어' },
  ja: { code: 'JA', name: 'Japanese', native: '日本語' },
  zh: { code: 'ZH', name: 'Chinese', native: '中文' },
  es: { code: 'ES', name: 'Spanish', native: 'Español' },
  fr: { code: 'FR', name: 'French', native: 'Français' },
  de: { code: 'DE', name: 'German', native: 'Deutsch' }
};

export const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT',
  'EMBED', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'CODE',
  'PRE', 'KBD', 'VAR', 'SAMP', 'TEXTAREA', 'INPUT'
]);

export const MIN_TEXT_LENGTH = 2;
export const MAX_TEXT_LENGTH = 5000;
export const MAX_TEXTS_PER_REQUEST = 8;
export const MAX_CONCURRENT_REQUESTS = 6;
export const DEBOUNCE_DELAY = 300;
