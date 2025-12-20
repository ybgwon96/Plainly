export type LanguageCode = 'en' | 'ko' | 'ja' | 'zh' | 'es' | 'fr' | 'de';

export interface TranslationSettings {
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  autoTranslate: boolean;
}

export interface TranslatedText {
  original: string;
  translated: string;
}

export interface TranslationRequest {
  texts: string[];
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
}

export interface TranslationResponse {
  success: boolean;
  data?: TranslatedText[];
  error?: string;
}

export interface StorageSchema {
  settings: TranslationSettings;
  domainSettings: Record<string, {
    autoTranslate: boolean;
    lastTranslated: number;
  }>;
}

export type MessageType =
  | 'TRANSLATE_TEXT'
  | 'TOGGLE_TRANSLATION'
  | 'GET_STATUS'
  | 'UPDATE_SETTINGS'
  | 'TRANSLATE_SELECTION'
  | 'TRANSLATE_SELECTION_SHORTCUT';

export interface Message<T = unknown> {
  type: MessageType;
  payload?: T;
}

export interface TranslationStatus {
  isTranslated: boolean;
  count: number;
  autoTranslate: boolean;
}
