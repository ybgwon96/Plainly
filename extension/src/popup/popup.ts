import { storage } from '@shared/storage';
import { DEBOUNCE_DELAY } from '@shared/constants';
import type { TranslationSettings, LanguageCode } from '@shared/types';

class PopupController {
  private elements!: {
    toggleBtn: HTMLButtonElement;
    sourceText: HTMLTextAreaElement;
    translatedText: HTMLDivElement;
    sourceLang: HTMLSelectElement;
    targetLang: HTMLSelectElement;
    swapLang: HTMLButtonElement;
    clearInput: HTMLButtonElement;
    copyResult: HTMLButtonElement;
    domainAutoTranslate: HTMLInputElement;
    currentDomain: HTMLSpanElement;
  };
  private debounceTimer: number | null = null;
  private settings!: TranslationSettings;
  private currentDomain: string = '';

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    this.elements = this.getElements();
    await this.loadSettings();
    await this.loadDomainSettings();
    this.setupEventListeners();
    this.updateUI();
  }

  private async loadDomainSettings(): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        const url = new URL(tab.url);
        this.currentDomain = url.hostname;
      }
    } catch {
      this.currentDomain = '';
    }
  }

  private getElements() {
    return {
      toggleBtn: document.getElementById('toggle-translate') as HTMLButtonElement,
      sourceText: document.getElementById('source-text') as HTMLTextAreaElement,
      translatedText: document.getElementById('translated-text') as HTMLDivElement,
      sourceLang: document.getElementById('source-lang') as HTMLSelectElement,
      targetLang: document.getElementById('target-lang') as HTMLSelectElement,
      swapLang: document.getElementById('swap-lang') as HTMLButtonElement,
      clearInput: document.getElementById('clear-input') as HTMLButtonElement,
      copyResult: document.getElementById('copy-result') as HTMLButtonElement,
      domainAutoTranslate: document.getElementById('domain-auto-translate') as HTMLInputElement,
      currentDomain: document.getElementById('current-domain') as HTMLSpanElement
    };
  }

  private async loadSettings(): Promise<void> {
    this.settings = await storage.getSettings();
  }

  private setupEventListeners(): void {
    this.elements.toggleBtn.addEventListener('click', () => this.togglePageTranslation());
    this.elements.sourceText.addEventListener('input', () => this.handleInputChange());
    this.elements.swapLang.addEventListener('click', () => this.swapLanguages());
    this.elements.clearInput.addEventListener('click', () => this.clearInput());
    this.elements.copyResult.addEventListener('click', () => this.copyResult());
    this.elements.sourceLang.addEventListener('change', () => this.handleLanguageChange());
    this.elements.targetLang.addEventListener('change', () => this.handleLanguageChange());
    this.elements.domainAutoTranslate.addEventListener('change', () => this.toggleDomainAutoTranslate());
  }

  private async toggleDomainAutoTranslate(): Promise<void> {
    if (!this.currentDomain) return;

    const newValue = this.elements.domainAutoTranslate.checked;
    await storage.setDomainAutoTranslate(this.currentDomain, newValue);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_TRANSLATION' });
    }
  }

  private async handleLanguageChange(): Promise<void> {
    this.settings.sourceLang = this.elements.sourceLang.value as LanguageCode;
    this.settings.targetLang = this.elements.targetLang.value as LanguageCode;

    await storage.updateSettings({
      sourceLang: this.settings.sourceLang,
      targetLang: this.settings.targetLang
    });

    if (this.elements.sourceText.value.trim()) {
      this.translateInput();
    }
  }

  private async togglePageTranslation(): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      const response = await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_TRANSLATION' });
      const isActive = response?.enabled ?? false;

      this.elements.toggleBtn.classList.toggle('active', isActive);
      this.elements.domainAutoTranslate.checked = isActive;
    } catch {
      const currentChecked = this.elements.domainAutoTranslate.checked;
      const newValue = !currentChecked;
      this.elements.toggleBtn.classList.toggle('active', newValue);
      this.elements.domainAutoTranslate.checked = newValue;
      if (this.currentDomain) {
        await storage.setDomainAutoTranslate(this.currentDomain, newValue);
      }
    }
  }

  private handleInputChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      this.translateInput();
    }, DEBOUNCE_DELAY);
  }

  private async translateInput(): Promise<void> {
    const text = this.elements.sourceText.value.trim();

    if (!text) {
      this.showPlaceholder();
      return;
    }

    this.elements.translatedText.classList.add('loading');
    this.elements.translatedText.innerHTML = '<span class="placeholder">번역 중...</span>';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_TEXT',
        payload: {
          texts: [text],
          sourceLang: this.settings.sourceLang,
          targetLang: this.settings.targetLang
        }
      });

      if (response?.success && response.data?.[0]) {
        this.elements.translatedText.textContent = response.data[0].translated;
      } else {
        this.elements.translatedText.innerHTML =
          '<span class="placeholder">번역 중 오류가 발생했습니다</span>';
      }
    } catch (error) {
      this.elements.translatedText.innerHTML =
        '<span class="placeholder">번역 서비스에 연결할 수 없습니다</span>';
    } finally {
      this.elements.translatedText.classList.remove('loading');
    }
  }

  private async swapLanguages(): Promise<void> {
    this.elements.swapLang.classList.add('spinning');

    [this.settings.sourceLang, this.settings.targetLang] =
      [this.settings.targetLang, this.settings.sourceLang];

    await storage.updateSettings({
      sourceLang: this.settings.sourceLang,
      targetLang: this.settings.targetLang
    });

    this.updateLanguageSelects();

    setTimeout(() => {
      this.elements.swapLang.classList.remove('spinning');
    }, 300);

    if (this.elements.sourceText.value.trim()) {
      this.translateInput();
    }
  }

  private clearInput(): void {
    this.elements.sourceText.value = '';
    this.showPlaceholder();
    this.elements.sourceText.focus();
  }

  private showPlaceholder(): void {
    this.elements.translatedText.innerHTML =
      '<span class="placeholder">번역 결과가 여기에 표시됩니다</span>';
  }

  private async copyResult(): Promise<void> {
    const text = this.elements.translatedText.textContent;
    const hasPlaceholder = this.elements.translatedText.querySelector('.placeholder');

    if (text && !hasPlaceholder) {
      await navigator.clipboard.writeText(text);
      this.elements.copyResult.classList.add('copied');

      setTimeout(() => {
        this.elements.copyResult.classList.remove('copied');
      }, 1000);
    }
  }

  private async updateUI(): Promise<void> {
    this.updateLanguageSelects();
    await this.updateDomainUI();
  }

  private updateLanguageSelects(): void {
    this.elements.sourceLang.value = this.settings.sourceLang;
    this.elements.targetLang.value = this.settings.targetLang;
  }

  private async updateDomainUI(): Promise<void> {
    if (this.currentDomain) {
      this.elements.currentDomain.textContent = this.currentDomain;
      const autoTranslate = await storage.getDomainAutoTranslate(this.currentDomain);
      this.elements.domainAutoTranslate.checked = autoTranslate;
      this.elements.toggleBtn.classList.toggle('active', autoTranslate);
    } else {
      this.elements.currentDomain.textContent = '알 수 없음';
      this.elements.domainAutoTranslate.disabled = true;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
