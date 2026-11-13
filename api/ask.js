// GIW 2026 학회 비서 - AI 프록시 (Vercel Serverless Function)
// API 키는 Vercel 환경변수 ANTHROPIC_API_KEY 에만 있으므로 방문자에게 노출되지 않는다.

const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 1000;
const MAX_QUESTION = 500;
const MAX_CONTEXT = 24000;
const MAX_TURNS = 12;
const RATE_LIMIT = 10;    // IP당 분당
const DAILY_CAP = 1500;   // 전체 하루 (비용 안전장치)

const hits = new Map();
let dayKey = '', dayCount = 0;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ answer: 'POST만 받습니다.' });

  const ip = (req.headers['x-forwarded-for'] || 'anon').split(',')[0].trim();
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  if (arr.length > RATE_LIMIT) return res.status(429).json({ answer: '질문이 너무 빨라요. 잠시 후 다시 시도해주세요.' });

  const today = new Date().toISOString().slice(0, 10);
  if (dayKey !== today) { dayKey = today; dayCount = 0; }
  if (++dayCount > DAILY_CAP) return res.status(429).json({ answer: '오늘 사용량이 많아 쉬는 중이에요. 검색 탭을 이용해주세요.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const question = String(body.question || '').slice(0, MAX_QUESTION);
  const context = String(body.context || '').slice(0, MAX_CONTEXT);
  const system = String(body.system || '') ||
    '너는 BIOINFO/GIW ISCB-Asia 2026 학회(2026년 11월 17-20일, 연세대학교) 안내 비서야. 주어진 학회 데이터에만 근거해 한국어로 간결히 답하고, 모르면 모른다고 해.';
  const rawMsgs = Array.isArray(body.messages) ? body.messages : null;
  const messages = (rawMsgs && rawMsgs.length)
    ? rawMsgs.slice(-12)
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
        .map(m => ({ role: m.role, content: String(m.content).slice(0, MAX_CONTEXT) }))
    : [{ role: 'user', content: `학회 데이터:\n${context}\n\n질문: ${question}` }];
  if (!messages.length || messages[0].role !== 'user')
    return res.status(400).json({ answer: '질문이 비었어요.' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL, max_tokens: MAX_TOKENS, system, messages,
      }),
    });
    const j = await r.json();
    return res.status(200).json({ answer: j?.content?.[0]?.text || j?.error?.message || '답을 만들지 못했어요.' });
  } catch (e) {
    return res.status(500).json({ answer: '서버 오류: ' + String(e).slice(0, 120) });
  }
}
