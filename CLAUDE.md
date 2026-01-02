# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

Plainly는 DeepSeek API를 사용하는 웹 페이지 번역 Chrome Extension입니다. 두 개의 주요 컴포넌트로 구성됩니다:
- **Chrome Extension** (`extension/`): Vite + CRXJS로 빌드되는 MV3 확장 프로그램
- **Vercel Serverless API** (`api/`): DeepSeek API 프록시 서버

## 주요 명령어

```bash
# Extension 개발 (watch 모드)
npm run dev

# Extension 빌드
npm run build:extension

# Vercel API 배포
npm run deploy
```

Extension 개발 시 `extension/dist/` 폴더를 Chrome에 로드합니다.

## 아키텍처

### Extension 구조

```
extension/src/
├── background/service-worker.ts  # 메시지 핸들러, API 호출, 컨텍스트 메뉴
├── content/
│   ├── content-script.ts         # 페이지 번역 컨트롤러 (PlainlyContentScript)
│   ├── text-extractor.ts         # DOM 텍스트 노드 추출, 언어 감지
│   ├── dom-translator.ts         # 번역 적용/복원, 상태 관리
│   └── translation-cache.ts      # 메모리 캐시 (1000개, 24시간 TTL)
├── popup/                        # 팝업 UI
└── shared/
    ├── types.ts                  # 공유 타입 정의
    ├── constants.ts              # API URL, 설정 상수
    ├── api-client.ts             # Vercel API 클라이언트
    └── storage.ts                # chrome.storage.sync 래퍼
```

### 메시지 흐름

1. Content Script → Background (TRANSLATE_TEXT) → API Client → Vercel API → DeepSeek
2. Background는 `chrome.runtime.onMessage`로 수신, `apiClient.translate()` 호출
3. Content Script는 `MutationObserver`로 동적 콘텐츠 감지

### 주요 설정값 (constants.ts)

- `MAX_TEXTS_PER_REQUEST`: 4 (API 배치 크기)
- `MAX_CONCURRENT_REQUESTS`: 10 (동시 요청 수)
- `SKIP_TAGS`: SCRIPT, CODE, PRE 등 번역 제외 태그

### Path Alias

```typescript
// vite.config.ts에서 설정됨
'@shared' → 'src/shared'
```

## 키보드 단축키

- `⌥A` (Alt+A): 현재 페이지 번역 토글
- `⌥⇧A` (Alt+Shift+A): 선택 텍스트 번역

## 지원 언어

`LanguageCode` 타입: en, ko, ja, zh, es, fr, de
