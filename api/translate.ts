import type { VercelRequest, VercelResponse } from '@vercel/node';

type LanguageCode = 'en' | 'ko' | 'ja' | 'zh' | 'es' | 'fr' | 'de';

interface TranslationRequest {
  texts: string[];
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
}

interface TranslatedText {
  original: string;
  translated: string;
}

interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface DeepSeekResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const LANG_NAMES: Record<LanguageCode, string> = {
  en: 'English',
  ko: 'Korean',
  ja: 'Japanese',
  zh: 'Chinese',
  es: 'Spanish',
  fr: 'French',
  de: 'German'
};

async function translateWithDeepSeek(
  texts: string[],
  sourceLang: string,
  targetLang: string
): Promise<string[]> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not configured');
  }

  const systemPrompt = `You are a professional translator. Translate the following texts from ${LANG_NAMES[sourceLang]} to ${LANG_NAMES[targetLang]}.

Rules:
1. Maintain the original meaning and tone
2. Keep proper nouns, technical terms, and code as-is when appropriate
3. Preserve formatting (newlines, punctuation)
4. Return ONLY a JSON object with a "translations" array containing translated strings in the same order

Example input: ["Hello", "World"]
Example output: {"translations": ["안녕하세요", "세계"]}`;

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(texts) }
      ] as DeepSeekMessage[],
      temperature: 0.1,
      max_tokens: 4096,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
  }

  const data: DeepSeekResponse = await response.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error('Empty response from DeepSeek');
  }

  const parsed = JSON.parse(content);
  return parsed.translations || [];
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { texts, sourceLang, targetLang } = req.body as TranslationRequest;

    if (!Array.isArray(texts) || texts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'texts array is required'
      });
    }

    if (texts.length > 50) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 50 texts per request'
      });
    }

    if (!sourceLang || !targetLang) {
      return res.status(400).json({
        success: false,
        error: 'sourceLang and targetLang are required'
      });
    }

    const translations = await translateWithDeepSeek(texts, sourceLang, targetLang);

    const data: TranslatedText[] = texts.map((original, index) => ({
      original,
      translated: translations[index] || original
    }));

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message
    });
  }
}
