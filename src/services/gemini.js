// Thin wrapper around the Gemini REST API (no SDK needed, Node 18+ fetch).
// Every call has a 10 s timeout (AI-07); callers catch AIError and fall back.
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT_MS = 10000;
const DIMS = 768;
const CATEGORIES = ['Painting', 'Digital', 'Sculpture', 'Photography', 'Illustration', 'Mixed Media'];

class AIError extends Error {}

const genModel = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const embModel = () => process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-2';

async function call(path, body) {
  if (!process.env.GEMINI_API_KEY) throw new AIError('AI is not configured on the server');
  let res;
  try {
    res = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new AIError(e.name === 'TimeoutError' ? 'The AI service took too long to respond' : 'Could not reach the AI service');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[gemini]', res.status, data.error?.message);
    throw new AIError(res.status === 429 ? 'AI rate limit reached, try again in a minute' : 'The AI service returned an error');
  }
  return data;
}

// Only fetch images from hosts we expect (stops the server being used to probe internal URLs).
const hostAllowed = (u) => {
  const allowed = (process.env.AI_IMAGE_HOSTS || 'ibb.co,picsum.photos').split(',').map((h) => h.trim());
  try {
    const { protocol, hostname } = new URL(u);
    return /^https?:$/.test(protocol) && allowed.some((h) => hostname === h || hostname.endsWith('.' + h));
  } catch { return false; }
};

async function loadImage(url) {
  if (!hostAllowed(url)) throw new AIError('This image host is not supported for AI features');
  let res;
  try { res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }); }
  catch { throw new AIError('Could not download the image'); }
  if (!res.ok) throw new AIError('Could not download the image');
  const mime = (res.headers.get('content-type') || '').split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) throw new AIError('Image is too large for AI (max 8 MB)');
  return { mime, data: buf.toString('base64') };
}

const normalise = (v) => {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
};
const readVector = (d) => normalise(d.embedding?.values || d.embeddings?.[0]?.values || (() => { throw new AIError('Empty embedding'); })());

async function embedText(text) {
  const d = await call(`models/${embModel()}:embedContent`, {
    content: { parts: [{ text }] }, output_dimensionality: DIMS,
  });
  return readVector(d);
}

async function embedImage(url) {
  const img = await loadImage(url);
  if (!['image/png', 'image/jpeg'].includes(img.mime)) throw new AIError('AI search supports PNG and JPEG images only');
  const d = await call(`models/${embModel()}:embedContent`, {
    content: { parts: [{ inline_data: { mime_type: img.mime, data: img.data } }] }, output_dimensionality: DIMS,
  });
  return readVector(d);
}

const parseJSON = (d) => {
  const t = d.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  try { return JSON.parse(t.replace(/^```json|```$/g, '').trim()); } catch { throw new AIError('AI returned an unreadable answer'); }
};

// F1: image -> listing metadata (always a suggestion, never saved automatically)
async function analyzeImage(url) {
  const img = await loadImage(url);
  const d = await call(`models/${genModel()}:generateContent`, {
    contents: [{ parts: [
      { text: `You help an artist list an artwork for sale. Look at the image and reply with JSON only:
{"title": short evocative title (max 6 words), "tags": 5 to 8 lowercase tags (style, mood, colours, subject), "category": one of ${JSON.stringify(CATEGORIES)}, "description": 2-3 sentences describing what is visible, in plain language}
Describe only what you can see. Do not claim who made it or how it was made.` },
      { inline_data: { mime_type: img.mime, data: img.data } },
    ] }],
    generationConfig: { responseMimeType: 'application/json' },
  });
  const j = parseJSON(d);
  return {
    title: String(j.title || '').slice(0, 80),
    tags: [...new Set((j.tags || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean))].slice(0, 8),
    category: CATEGORIES.includes(j.category) ? j.category : 'Mixed Media',
    description: String(j.description || '').slice(0, 600),
  };
}

// F4: the range comes from real neighbour prices; the LLM only explains it.
async function explainPrice(meta, neighbours, low, high) {
  const list = neighbours.map((n) => `- "${n.title}" (${n.category}) $${n.price}`).join('\n');
  try {
    const d = await call(`models/${genModel()}:generateContent`, {
      contents: [{ parts: [{ text: `A new artwork "${meta.title || 'untitled'}" (${meta.category || 'unknown'}) is being listed. Similar listed works:\n${list}\nSuggested range: $${low}-$${high}. In 2 short sentences, explain why this range fits, referring only to the works above. JSON only: {"reason": "..."}` }] }],
      generationConfig: { responseMimeType: 'application/json' },
    });
    return String(parseJSON(d).reason || '');
  } catch {
    return `Based on ${neighbours.length} visually similar listed works priced between $${Math.min(...neighbours.map((n) => n.price))} and $${Math.max(...neighbours.map((n) => n.price))}.`;
  }
}

module.exports = { AIError, embedText, embedImage, analyzeImage, explainPrice, CATEGORIES };
