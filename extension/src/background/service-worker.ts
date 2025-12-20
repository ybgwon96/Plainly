import { apiClient } from '@shared/api-client';
import { storage } from '@shared/storage';
import type {
  Message,
  TranslationResponse,
  TranslationStatus,
  LanguageCode
} from '@shared/types';

interface TranslatePayload {
  texts: string[];
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
}

chrome.runtime.onMessage.addListener(
  (
    message: Message,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: TranslationResponse | TranslationStatus | { enabled: boolean }) => void
  ) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      });

    return true;
  }
);

async function handleMessage(
  message: Message,
  _sender: chrome.runtime.MessageSender
): Promise<TranslationResponse | TranslationStatus | { enabled: boolean }> {
  switch (message.type) {
    case 'TRANSLATE_TEXT':
      return handleTranslate(message.payload as TranslatePayload);

    case 'GET_STATUS':
      return getStatus();

    case 'TOGGLE_TRANSLATION':
      return toggleTranslation();

    case 'UPDATE_SETTINGS':
      await storage.updateSettings(message.payload as Partial<TranslatePayload>);
      return { success: true };

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

async function handleTranslate(payload: TranslatePayload): Promise<TranslationResponse> {
  const { texts, sourceLang, targetLang } = payload;

  if (!texts || texts.length === 0) {
    return { success: true, data: [] };
  }

  try {
    const data = await apiClient.translate(texts, sourceLang, targetLang);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Translation failed'
    };
  }
}

async function getStatus(): Promise<TranslationStatus> {
  const settings = await storage.getSettings();
  return {
    isTranslated: false,
    count: 0,
    autoTranslate: settings.autoTranslate
  };
}

async function toggleTranslation(): Promise<{ enabled: boolean }> {
  const settings = await storage.getSettings();
  const newAutoTranslate = !settings.autoTranslate;
  await storage.updateSettings({ autoTranslate: newAutoTranslate });
  return { enabled: newAutoTranslate };
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    storage.updateSettings({
      sourceLang: 'en',
      targetLang: 'ko',
      autoTranslate: false
    });
  }

  chrome.contextMenus.create({
    id: 'translate-selection',
    title: '"%s" 번역하기',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'translate-selection' && info.selectionText && tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'TRANSLATE_SELECTION',
      payload: { text: info.selectionText }
    });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (command === 'toggle-translation') {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_TRANSLATION' });
  }

  if (command === 'translate-selection') {
    chrome.tabs.sendMessage(tab.id, { type: 'TRANSLATE_SELECTION_SHORTCUT' });
  }
});
