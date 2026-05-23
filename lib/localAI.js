const TIMEOUT_MS = 10_000;

function abortAfter(ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(timer) };
}

async function askOllama(systemPrompt, userPrompt) {
  const { signal, clear } = abortAfter(TIMEOUT_MS);
  try {
    const res = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || 'gemma4',
        system: systemPrompt,
        prompt: userPrompt,
        stream: false,
        format: 'json',
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return JSON.parse(data.response);
  } catch {
    return null;
  } finally {
    clear();
  }
}

async function askGoogleAI(systemPrompt, userPrompt) {
  const url = `${process.env.GEMMA_API_URL}?key=${process.env.GEMMA_API_KEY}`;
  const { signal, clear } = abortAfter(TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  } finally {
    clear();
  }
}

// ask(systemPrompt, userPrompt) → JSON object | null
// null 반환 시 호출부에서 해당 사이클 스킵 (서비스 중단 없음)
async function ask(systemPrompt, userPrompt) {
  if (process.env.DISABLE_AI === 'true') return null;

  if (process.env.OLLAMA_URL) {
    return askOllama(systemPrompt, userPrompt);
  }

  if (process.env.GEMMA_API_KEY && process.env.GEMMA_API_URL) {
    return askGoogleAI(systemPrompt, userPrompt);
  }

  return null;
}

module.exports = { ask };
