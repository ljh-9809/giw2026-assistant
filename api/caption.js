// 실시간 자막 수집 저장소 (방+날짜별 Blob 파일에 누적)
import { put, head } from '@vercel/blob';

const ROOMS = { centennial:1, grandballroom:1, choiyoung:1 };

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

// 커지는 중간 자막(앞부분이 같은 줄)은 마지막 것만 남긴다
function collapse(lines){
  const out = [];
  for (const l of lines){
    const p = out.length ? out[out.length - 1] : null;
    if (p && p.k === l.k){
      if (l.s.startsWith(p.s)) { out[out.length - 1] = l; continue; }
      if (p.s.startsWith(l.s)) { continue; }
    }
    out.push(l);
  }
  return out;
}

function pathOf(room, date){ return "live/" + room + "-" + date + ".json"; }
async function readAll(pathname){
  try {
    const meta = await head(pathname, { token: process.env.BLOB_READ_WRITE_TOKEN });
    const r = await fetch(meta.downloadUrl || meta.url, { headers: { authorization: 'Bearer ' + process.env.BLOB_READ_WRITE_TOKEN } });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.lines) ? j.lines : [];
  } catch (e) { return []; }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const room = String((req.method === 'GET' ? req.query.room : body.room) || '').toLowerCase();
  const date = String((req.method === 'GET' ? req.query.date : body.date) || '').slice(0, 10);
  if (!ROOMS[room] || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'room/date' });
  const pathname = pathOf(room, date);

  if (req.method === 'GET'){
    const lines = collapse(await readAll(pathname));
    return res.status(200).json({ room, date, count: lines.length, lines });
  }
  if (req.method === 'POST'){
    const incoming = Array.isArray(body.lines) ? body.lines : [];
    if (!incoming.length) return res.status(200).json({ ok: true, added: 0 });
    const prev = await readAll(pathname);
    const seen = {};
    prev.forEach(function(l){ seen[l.t + '|' + l.s] = 1; });
    const add = [];
    incoming.forEach(function(l){
      if (!l || typeof l.s !== 'string') return;
      const t = String(l.t || '').slice(0, 8);
      const s = l.s.slice(0, 600).trim();
      if (!s || seen[t + '|' + s]) return;
      seen[t + '|' + s] = 1;
      const rec = { t: t, s: s, k: l.k === 'ko' ? 'ko' : 'en' };
      if (typeof l.ko === 'string' && l.ko.trim() && l.ko.trim() !== s) rec.ko = l.ko.trim().slice(0, 600);
      add.push(rec);
    });
    if (!add.length) return res.status(200).json({ ok: true, added: 0, total: prev.length });
    const merged = collapse(prev.concat(add)).slice(-6000);
    await put(pathname, JSON.stringify({ room: room, date: date, lines: merged, updated: Date.now() }), {
      access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return res.status(200).json({ ok: true, added: add.length, total: merged.length });
  }
  return res.status(405).json({ error: 'method' });
}
