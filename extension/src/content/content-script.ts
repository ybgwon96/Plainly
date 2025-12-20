import { textExtractor, type TextNodeInfo } from './text-extractor';
import { domTranslator } from './dom-translator';
import { translationCache } from './translation-cache';
import { storage } from '@shared/storage';
import { MAX_TEXTS_PER_REQUEST, MAX_CONCURRENT_REQUESTS } from '@shared/constants';
import type { LanguageCode, TranslatedText } from '@shared/types';

class PlainlyContentScript {
  private isEnabled = false;
  private observer: MutationObserver | null = null;
  private shadowObservers: MutationObserver[] = [];
  private settings: { sourceLang: LanguageCode; targetLang: LanguageCode } = {
    sourceLang: 'en',
    targetLang: 'ko'
  };
  private translatingNodes = new Set<Text>();
  private tooltip: HTMLDivElement | null = null;
  private currentDomain: string = '';

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    const settings = await storage.getSettings();
    this.settings.sourceLang = settings.sourceLang;
    this.settings.targetLang = settings.targetLang;
    this.currentDomain = window.location.hostname;

    const domainAutoTranslate = await storage.getDomainAutoTranslate(this.currentDomain);

    if (domainAutoTranslate) {
      await this.enable();
    }

    this.listenForMessages();
    this.listenForStorageChanges();
    this.createTooltip();
  }

  private listenForMessages(): void {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'TOGGLE_TRANSLATION') {
        this.toggle().then(async () => {
          await storage.setDomainAutoTranslate(this.currentDomain, this.isEnabled);
          sendResponse({ enabled: this.isEnabled });
        });
        return true;
      }

      if (message.type === 'GET_STATUS') {
        const status = domTranslator.getStatus();
        sendResponse({
          ...status,
          autoTranslate: this.isEnabled
        });
        return true;
      }

      if (message.type === 'TRANSLATE_SELECTION') {
        const text = message.payload?.text;
        if (text) {
          this.translateSelection(text);
        }
        return false;
      }

      if (message.type === 'TRANSLATE_SELECTION_SHORTCUT') {
        const selection = window.getSelection()?.toString().trim();
        if (selection) {
          this.translateSelection(selection);
        }
        return false;
      }

      return false;
    });
  }

  private listenForStorageChanges(): void {
    storage.onChanged((changes) => {
      if (changes.settings?.newValue) {
        const newSettings = changes.settings.newValue;
        this.settings.sourceLang = newSettings.sourceLang;
        this.settings.targetLang = newSettings.targetLang;
      }
    });
  }

  async enable(): Promise<void> {
    if (this.isEnabled) return;

    this.isEnabled = true;
    await this.translateVisibleContent();
    this.observeDomChanges();
  }

  disable(): void {
    if (!this.isEnabled) return;

    this.isEnabled = false;
    this.observer?.disconnect();
    this.observer = null;
    this.shadowObservers.forEach((obs) => obs.disconnect());
    this.shadowObservers = [];
    domTranslator.restoreOriginal();
  }

  async toggle(): Promise<void> {
    if (this.isEnabled) {
      this.disable();
    } else {
      await this.enable();
    }
  }

  private isInViewport(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    return (
      rect.top < window.innerHeight &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.right > 0
    );
  }

  private sortByViewport(nodes: TextNodeInfo[]): TextNodeInfo[] {
    return [...nodes].sort((a, b) => {
      const aVisible = this.isInViewport(a.parentElement) ? 1 : 0;
      const bVisible = this.isInViewport(b.parentElement) ? 1 : 0;
      return bVisible - aVisible;
    });
  }

  private async translateVisibleContent(): Promise<void> {
    const textNodes = textExtractor.extractTextNodes(document.body);
    if (textNodes.length === 0) return;

    const sortedNodes = this.sortByViewport(textNodes);
    await this.translateNodesParallel(sortedNodes);
  }

  private async translateNodesParallel(textNodes: TextNodeInfo[]): Promise<void> {
    const newNodes = textNodes.filter((n) => {
      if (this.translatingNodes.has(n.node)) return false;
      return textExtractor.isSourceLanguage(n.originalText, this.settings.sourceLang);
    });
    if (newNodes.length === 0) return;

    newNodes.forEach((n) => this.translatingNodes.add(n.node));

    try {
      const texts = newNodes.map((n) => n.originalText);

      const { cached, uncached } = translationCache.getMultiple(
        texts,
        this.settings.sourceLang,
        this.settings.targetLang
      );

      if (cached.size > 0) {
        const cachedNodes: TextNodeInfo[] = [];
        const cachedResults: TranslatedText[] = [];

        cached.forEach((translated, index) => {
          cachedNodes.push(newNodes[index]);
          cachedResults.push({ original: texts[index], translated });
        });

        if (this.isEnabled) {
          domTranslator.applyTranslations(cachedNodes, cachedResults);
        }
      }

      if (uncached.length > 0) {
        const batches: Array<{ indices: Array<{ index: number; text: string }>; nodes: TextNodeInfo[] }> = [];

        for (let i = 0; i < uncached.length; i += MAX_TEXTS_PER_REQUEST) {
          const batchIndices = uncached.slice(i, i + MAX_TEXTS_PER_REQUEST);
          const batchNodes = batchIndices.map((u) => newNodes[u.index]);
          batches.push({ indices: batchIndices, nodes: batchNodes });
        }

        const translateBatch = async (batch: typeof batches[0]) => {
          const batchTexts = batch.indices.map((u) => u.text);

          const response = await chrome.runtime.sendMessage({
            type: 'TRANSLATE_TEXT',
            payload: {
              texts: batchTexts,
              sourceLang: this.settings.sourceLang,
              targetLang: this.settings.targetLang
            }
          });

          if (response?.success && response.data) {
            const results: TranslatedText[] = response.data;

            results.forEach((result: TranslatedText) => {
              translationCache.set(
                result.original,
                result.translated,
                this.settings.sourceLang,
                this.settings.targetLang
              );
            });

            if (this.isEnabled) {
              domTranslator.applyTranslations(batch.nodes, results);
            }
          }
        };

        for (let i = 0; i < batches.length; i += MAX_CONCURRENT_REQUESTS) {
          const concurrentBatches = batches.slice(i, i + MAX_CONCURRENT_REQUESTS);
          await Promise.all(concurrentBatches.map(translateBatch));
        }
      }
    } finally {
      newNodes.forEach((n) => this.translatingNodes.delete(n.node));
    }
  }

  private observeDomChanges(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
    this.shadowObservers.forEach((obs) => obs.disconnect());
    this.shadowObservers = [];

    let debounceTimer: number | null = null;
    const pendingNodes: (Element | ShadowRoot)[] = [];

    const handleMutations = (mutations: MutationRecord[]) => {
      if (!this.isEnabled) return;

      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            pendingNodes.push(element);

            if (element.shadowRoot) {
              this.observeShadowRoot(element.shadowRoot, handleMutations);
              pendingNodes.push(element.shadowRoot);
            }

            element.querySelectorAll('*').forEach((child) => {
              if (child.shadowRoot) {
                this.observeShadowRoot(child.shadowRoot, handleMutations);
                pendingNodes.push(child.shadowRoot);
              }
            });
          }
        });
      });

      if (pendingNodes.length > 0 && !debounceTimer) {
        debounceTimer = window.setTimeout(() => {
          const nodesToProcess = [...pendingNodes];
          pendingNodes.length = 0;
          debounceTimer = null;

          nodesToProcess.forEach((node) => {
            const textNodes = textExtractor.extractTextNodes(node);
            if (textNodes.length > 0) {
              this.translateNodesParallel(textNodes);
            }
          });
        }, 100);
      }
    };

    this.observer = new MutationObserver(handleMutations);

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    this.observeExistingShadowRoots(handleMutations);
  }

  private observeShadowRoot(
    shadowRoot: ShadowRoot,
    callback: (mutations: MutationRecord[]) => void
  ): void {
    const observer = new MutationObserver(callback);
    observer.observe(shadowRoot, {
      childList: true,
      subtree: true
    });
    this.shadowObservers.push(observer);
  }

  private observeExistingShadowRoots(
    callback: (mutations: MutationRecord[]) => void
  ): void {
    document.body.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) {
        this.observeShadowRoot(el.shadowRoot, callback);
      }
    });
  }

  private createTooltip(): void {
    this.tooltip = document.createElement('div');
    this.tooltip.id = 'plainly-tooltip';
    this.tooltip.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      max-width: 400px;
      padding: 12px 16px;
      background: #1a1a1a;
      color: #f5f5f5;
      border-radius: 8px;
      font-size: 14px;
      line-height: 1.5;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      display: none;
      word-wrap: break-word;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;
    document.body.appendChild(this.tooltip);

    document.addEventListener('click', (e) => {
      if (this.tooltip && !this.tooltip.contains(e.target as Node)) {
        this.hideTooltip();
      }
    });
  }

  private showTooltip(text: string): void {
    if (!this.tooltip) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      this.tooltip.style.top = '20px';
      this.tooltip.style.right = '20px';
      this.tooltip.style.left = 'auto';
    } else {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      let top = rect.bottom + 10;
      let left = rect.left;

      if (top + 100 > window.innerHeight) {
        top = rect.top - 10 - 50;
      }
      if (left + 400 > window.innerWidth) {
        left = window.innerWidth - 420;
      }

      this.tooltip.style.top = `${top}px`;
      this.tooltip.style.left = `${Math.max(10, left)}px`;
      this.tooltip.style.right = 'auto';
    }

    this.tooltip.textContent = text;
    this.tooltip.style.display = 'block';
  }

  private hideTooltip(): void {
    if (this.tooltip) {
      this.tooltip.style.display = 'none';
    }
  }

  private async translateSelection(text: string): Promise<void> {
    this.showTooltip('번역 중...');

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
        this.showTooltip(response.data[0].translated);
      } else {
        this.showTooltip('번역 실패');
      }
    } catch {
      this.showTooltip('번역 중 오류 발생');
    }
  }
}

new PlainlyContentScript();
