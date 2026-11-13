/**
 * GIW 2026 학회 비서 - AI 프록시 (Cloudflare Workers)
 *
 * 하는 일: 브라우저에서 온 질문을 받아 Anthropic API로 넘기고 답만 돌려준다.
 *          API 키는 Worker secret에 있으므로 방문자에게 절대 노출되지 않는다.
 *
 * 배포 (Cloudflare 무료 플랜으로 충분):
 *   npm i -g wrangler
 *   wrangler login
 *   wrangler deploy                     # wrangler.toml 과 같은 폴더에서
 *   wrangler secret put ANTHROPIC_API_KEY   # 키 붙여넣기 (화면에 저장 안 됨)
 *
 * 배포되면 https://<이름>.<계정>.workers.dev 주소가 나온다.
 * 그 주소를 학회 페이지 → AI 질문 → "AI 연결 설정" → 프록시 엔드포인트에 넣으면 끝.
 *
 * 비용 가드:
 *  - 질문 길이/컨텍스트 길이 제한
 *  - 출력 토큰 상한
 *  - IP당 분당 호출 제한 (KV 없이 메모리 기반, 완벽하진 않지만 난사 방지용)
 *  - ALLOWED_ORIGINS 로 내 페이지에서만 호출 허용
 */

const ALLOWED_ORIGINS = [
  // 배포한 페이지 주소를 넣으세요. 비워두면 전부 허용.
  // 'https://<username>.github.io',
];
const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 1000;
const MAX_QUESTION = 500;
const MAX_CONTEXT = 24000;
const RATE_LIMIT = 12;      // IP당 분당 질문 수
const DAILY_CAP = 2000;     // 전체 하루 질문 수 상한 (비용 안전장치)

const hits = new Map();     // ip -> [timestamps]
let dayKey = '';
let dayCount = 0;

function cors(origin) {
  const ok = !ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? (origin || '*') : 'null',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > RATE_LIMIT;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const H = cors(origin);

    if (request.method === 'OPTIONS') return new Response(null, { headers: H });
    if (request.method !== 'POST')
      return new Response(JSON.stringify({ answer: 'POST로 {question, context} 를 보내주세요.' }),
        { status: 405, headers: { ...H, 'content-type': 'application/json' } });

    const ip = request.headers.get('CF-Connecting-IP') || 'anon';
    if (limited(ip))
      return new Response(JSON.stringify({ answer: '질문이 너무 빨라요. 잠시 후 다시 시도해주세요.' }),
        { status: 429, headers: { ...H, 'content-type': 'application/json' } });

    const today = new Date().toISOString().slice(0, 10);
    if (dayKey !== today) { dayKey = today; dayCount = 0; }
    if (++dayCount > DAILY_CAP)
      return new Response(JSON.stringify({ answer: '오늘 사용량이 많아 잠시 쉬고 있어요. 검색 탭을 이용해주세요.' }),
        { status: 429, headers: { ...H, 'content-type': 'application/json' } });

    let body;
    try { body = await request.json(); }
    catch { return new Response(JSON.stringify({ answer: '잘못된 요청' }), { status: 400, headers: { ...H, 'content-type': 'application/json' } }); }

    const question = String(body.question || '').slice(0, MAX_QUESTION);
    const context = String(body.context || '').slice(0, MAX_CONTEXT);
    const system = String(body.system || '')
      || '너는 BIOINFO/GIW ISCB-Asia 2026 학회(2026년 11월 17-20일, 연세대학교) 안내 비서야. 주어진 학회 데이터에만 근거해 한국어로 간결히 답하고, 모르면 모른다고 해.';

    if (!question) return new Response(JSON.stringify({ answer: '질문이 비었어요.' }),
      { status: 400, headers: { ...H, 'content-type': 'application/json' } });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: `학회 데이터:\n${context}\n\n질문: ${question}` }],
      }),
    });

    const j = await r.json();
    const answer = j?.content?.[0]?.text || j?.error?.message || '답을 만들지 못했어요.';
    return new Response(JSON.stringify({ answer }), {
      headers: { ...H, 'content-type': 'application/json; charset=utf-8' },
    });
  },
};
