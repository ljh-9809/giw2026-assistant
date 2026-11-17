// GIW 2026 학회 비서 - AI 프록시 (Vercel Edge, 스트리밍)
// API 키는 Vercel 환경변수 ANTHROPIC_API_KEY 에만 있으므로 방문자에게 노출되지 않는다.
export const config = { runtime: 'edge' };

const MODEL = 'claude-sonnet-5-5';
const MAX_TOKENS = 1800;
const MAX_QUESTION = 500;
const MAX_CONTEXT = 16000;
const IP_LIMIT = 40;    // IP당 분당 (학회 공용 와이파이는 여러 명이 같은 IP를 쓴다)
const CID_LIMIT = 10;   // 브라우저당 분당
const DAILY_CAP = 900;  // 전체 하루

const ipHits = new Map();
const cidHits = new Map();
let dayKey = '', dayCount = 0;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function tooFast(store, key, limit) {
  const now = Date.now();
  const arr = (store.get(key) || []).filter((t) => now - t < 60000);
  arr.push(now);
  store.set(key, arr);
  if (store.size > 5000) store.clear();
  return arr.length > limit;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ answer: 'POST만 받습니다.' }, 405);

  let body = {};
  try { body = await req.json(); } catch (e) { body = {}; }

  const ip = (req.headers.get('x-forwarded-for') || 'anon').split(',')[0].trim();
  const cid = String(body.cid || '').slice(0, 24) || ip;
  if (tooFast(cidHits, cid, CID_LIMIT) || tooFast(ipHits, ip, IP_LIMIT))
    return json({ answer: '질문이 너무 빨라요. 잠시 후 다시 시도해주세요.' }, 429);

  const today = new Date().toISOString().slice(0, 10);
  if (dayKey !== today) { dayKey = today; dayCount = 0; }
  if (++dayCount > DAILY_CAP)
    return json({ answer: '오늘 사용량이 많아 쉬는 중이에요. 프로그램 검색 탭을 이용해주세요.' }, 429);

  const question = String(body.question || '').slice(0, MAX_QUESTION);
  const context = String(body.context || '').slice(0, MAX_CONTEXT);
  const system = String(body.system || '') ||
    '너는 BIOINFO/GIW ISCB-Asia 2026 학회(2026년 11월 17-20일, 연세대학교) 안내 비서야. 주어진 학회 데이터에만 근거해 한국어로 간결히 답하고, 모르면 모른다고 해.';
  const rawMsgs = Array.isArray(body.messages) ? body.messages : null;
  const messages = (rawMsgs && rawMsgs.length)
    ? rawMsgs.slice(-12)
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
        .map((m) => ({ role: m.role, content: String(m.content).slice(0, MAX_CONTEXT) }))
    : [{ role: 'user', content: '학회 데이터:\n' + context + '\n\n질문: ' + question }];
  if (!messages.length || messages[0].role !== 'user') return json({ answer: '질문이 비었어요.' }, 400);

  const wantStream = body.stream !== false;
  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages, stream: wantStream }),
    });
  } catch (e) {
    return json({ answer: '서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요.' }, 502);
  }

  if (!upstream.ok) {
    let msg = '답을 만들지 못했어요.';
    try { const j = await upstream.json(); msg = (j && j.error && j.error.message) || msg; } catch (e) {}
    return json({ answer: msg }, 200);
  }

  if (!wantStream) {
    const j = await upstream.json();
    return json({ answer: (j && j.content && j.content[0] && j.content[0].text) || '답을 만들지 못했어요.' });
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = '';
  const transform = new TransformStream({
    transform(chunk, controller) {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line.indexOf('data:') !== 0) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const ev = JSON.parse(payload);
          if (ev.type === 'content_block_delta' && ev.delta && typeof ev.delta.text === 'string')
            controller.enqueue(encoder.encode(ev.delta.text));
        } catch (e) {}
      }
    },
  });

  return new Response(upstream.body.pipeThrough(transform), {
    headers: {
      ...CORS,
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
