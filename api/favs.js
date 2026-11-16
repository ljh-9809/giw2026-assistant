// 즐겨찾기 서버 보관 (구글 ID 토큰으로 본인 확인 후 Vercel Blob에 저장)
import { put, head } from '@vercel/blob';

const CLIENT_ID = '630188203588-uhqak5l4ijnppgivhcur2ssmt4j73f34.apps.googleusercontent.com';
const verified = new Map();

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

async function subOf(token) {
  if (!token || token.length > 4000) return null;
  const hit = verified.get(token);
  if (hit && hit.exp > Date.now() / 1000) return hit.sub;
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token));
  if (!r.ok) return null;
  const j = await r.json();
  if (j.aud !== CLIENT_ID) return null;
  if (Number(j.exp) <= Date.now() / 1000) return null;
  if (verified.size > 500) verified.clear();
  verified.set(token, { sub: j.sub, exp: Number(j.exp) });
  return j.sub;
}

function pathOf(sub) {
  let h = 0;
  const s = 'giw2026' + sub;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
  return 'favs/' + sub.slice(-6) + '-' + h.toString(36) + '.json';
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const token = req.method === 'GET' ? String(req.query.token || '') : String(body.token || '');
  const sub = await subOf(token);
  if (!sub) return res.status(401).json({ error: 'login' });
  const pathname = pathOf(sub);

  if (req.method === 'GET') {
    try {
      const meta = await head(pathname, { token: process.env.BLOB_READ_WRITE_TOKEN });
      const r = await fetch(meta.downloadUrl || meta.url, { headers: { authorization: 'Bearer ' + process.env.BLOB_READ_WRITE_TOKEN } });
      if (!r.ok) return res.status(200).json({ marks: [], updated: 0 });
      const data = await r.json();
      return res.status(200).json({ marks: Array.isArray(data.marks) ? data.marks : [], updated: data.updated || 0 });
    } catch (e) {
      return res.status(200).json({ marks: [], updated: 0 });
    }
  }

  if (req.method === 'POST') {
    const marks = Array.isArray(body.marks) ? body.marks.filter(function(m){ return typeof m === 'string' && m.length < 20; }).slice(0, 400) : [];
    const payload = JSON.stringify({ marks: marks, updated: Date.now() });
    try {
      await put(pathname, payload, {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      return res.status(200).json({ ok: true, count: marks.length });
    } catch (e) {
      return res.status(500).json({ error: String(e).slice(0, 200) });
    }
  }
  return res.status(405).json({ error: 'method' });
}
