// WhatsApp Sender - zero-dependency backend (Node 22+). Run: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

// ---- load .env ----
try {
  for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}
const E = process.env;
const PORT = +E.PORT || 3000;
const ADMIN_PASSWORD = E.ADMIN_PASSWORD || 'admin123';
const SECRET = E.APP_SECRET || 'change-me-secret';
const WA_TOKEN = E.WA_TOKEN, WA_PHONE_ID = E.WA_PHONE_ID;
const VERIFY_TOKEN = E.WEBHOOK_VERIFY_TOKEN || 'verify-me';
const APP_SECRET_META = E.META_APP_SECRET; // optional: validates webhook signatures
const MOCK = !(WA_TOKEN && WA_PHONE_ID);

// ---- db ----
const db = new DatabaseSync(E.DB_PATH || path.join(__dirname, 'data.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS contacts(id INTEGER PRIMARY KEY, name TEXT, phone TEXT UNIQUE, opted_in INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, contact_id INTEGER, phone TEXT, direction TEXT, kind TEXT, body TEXT, wa_id TEXT, status TEXT, error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_wa ON messages(wa_id);
`);

// ---- auth (HMAC token) ----
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const makeToken = () => { const exp = Date.now() + 7 * 864e5; return `${exp}.${sign(String(exp))}`; };
const okToken = (t) => { if (!t) return false; const [exp, sig] = t.split('.'); return +exp > Date.now() && sig === sign(exp); };

// ---- WhatsApp Cloud API ----
const normPhone = (p) => String(p).replace(/\D/g, '');
async function waSend(payload) {
  if (MOCK) return { messages: [{ id: 'mock_' + crypto.randomUUID() }] };
  const r = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'WhatsApp API error');
  return j;
}
const log = db.prepare('INSERT INTO messages(contact_id,phone,direction,kind,body,wa_id,status,error) VALUES(?,?,?,?,?,?,?,?)');

async function sendToContact(c, { type, text, template, language, params }) {
  const to = normPhone(c.phone);
  let payload, body;
  if (type === 'template') {
    const components = params?.length ? [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: String(t).replace('{name}', c.name || '') })) }] : [];
    payload = { to, type: 'template', template: { name: template, language: { code: language || 'en' }, components } };
    body = `[template:${template}] ${(params || []).join(' | ')}`;
  } else {
    const t = String(text).replaceAll('{name}', c.name || '');
    payload = { to, type: 'text', text: { body: t } };
    body = t;
  }
  try {
    const j = await waSend(payload);
    log.run(c.id, to, 'out', type, body, j.messages[0].id, 'sent', null);
    return { ok: true };
  } catch (e) {
    log.run(c.id, to, 'out', type, body, null, 'failed', e.message);
    return { ok: false, error: e.message };
  }
}

// ---- http helpers ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css' };
const readBody = (req) => new Promise((res) => { const a = []; req.on('data', (d) => a.push(d)); req.on('end', () => res(Buffer.concat(a))); });
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    // webhook (Meta)
    if (p === '/webhook') {
      if (req.method === 'GET') {
        if (url.searchParams.get('hub.verify_token') === VERIFY_TOKEN) { res.writeHead(200); return res.end(url.searchParams.get('hub.challenge')); }
        res.writeHead(403); return res.end();
      }
      const raw = await readBody(req);
      if (APP_SECRET_META) {
        const sig = req.headers['x-hub-signature-256'] || '';
        const exp = 'sha256=' + crypto.createHmac('sha256', APP_SECRET_META).update(raw).digest('hex');
        if (sig !== exp) { res.writeHead(401); return res.end(); }
      }
      const data = JSON.parse(raw.toString() || '{}');
      for (const en of data.entry || []) for (const ch of en.changes || []) {
        const v = ch.value || {};
        for (const s of v.statuses || []) db.prepare('UPDATE messages SET status=?, error=? WHERE wa_id=?').run(s.status, s.errors?.[0]?.title || null, s.id);
        for (const m of v.messages || []) {
          const c = db.prepare('SELECT * FROM contacts WHERE phone=?').get(m.from);
          const txt = m.text?.body || `[${m.type}]`;
          log.run(c?.id || null, m.from, 'in', m.type, txt, m.id, 'received', null);
          if (/^\s*stop\s*$/i.test(txt)) db.prepare('UPDATE contacts SET opted_in=0 WHERE phone=?').run(m.from);
        }
      }
      res.writeHead(200); return res.end('ok');
    }

    // API
    if (p.startsWith('/api/')) {
      if (p === '/api/login' && req.method === 'POST') {
        const b = JSON.parse((await readBody(req)).toString() || '{}');
        return b.password === ADMIN_PASSWORD ? send(res, 200, { token: makeToken(), mock: MOCK }) : send(res, 401, { error: 'Wrong password' });
      }
      if (!okToken((req.headers.authorization || '').replace('Bearer ', ''))) return send(res, 401, { error: 'Unauthorized' });
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : JSON.parse((await readBody(req)).toString() || '{}');

      if (p === '/api/contacts' && req.method === 'GET') return send(res, 200, db.prepare('SELECT * FROM contacts ORDER BY id DESC').all());
      if (p === '/api/contacts' && req.method === 'POST') {
        const list = Array.isArray(body) ? body : [body]; let n = 0;
        for (const c of list) {
          const ph = normPhone(c.phone || '');
          if (ph.length < 8) continue;
          db.prepare('INSERT OR IGNORE INTO contacts(name,phone) VALUES(?,?)').run(c.name || '', ph); n++;
        }
        return send(res, 200, { added: n });
      }
      let m;
      if ((m = p.match(/^\/api\/contacts\/(\d+)$/)) && req.method === 'DELETE') { db.prepare('DELETE FROM contacts WHERE id=?').run(+m[1]); return send(res, 200, { ok: true }); }

      if (p === '/api/send' && req.method === 'POST') {
        // body: {contactIds:[..]|"all", type:'text'|'template', text, template, language, params}
        let contacts = body.contactIds === 'all'
          ? db.prepare('SELECT * FROM contacts WHERE opted_in=1').all()
          : (body.contactIds || []).map((id) => db.prepare('SELECT * FROM contacts WHERE id=?').get(id)).filter(Boolean);
        contacts = contacts.filter((c) => c.opted_in);
        if (!contacts.length) return send(res, 400, { error: 'No opted-in contacts selected' });
        if (body.type === 'text' && !body.text) return send(res, 400, { error: 'Message empty' });
        if (body.type === 'template' && !body.template) return send(res, 400, { error: 'Template name required' });
        let sent = 0, failed = 0, lastError;
        for (const c of contacts) {
          const r = await sendToContact(c, body);
          r.ok ? sent++ : (failed++, lastError = r.error);
          await new Promise((r2) => setTimeout(r2, 100)); // gentle rate limit
        }
        return send(res, 200, { sent, failed, lastError });
      }
      if (p === '/api/messages' && req.method === 'GET') {
        const cid = url.searchParams.get('contact');
        const rows = cid
          ? db.prepare('SELECT * FROM messages WHERE contact_id=? ORDER BY id DESC LIMIT 200').all(+cid)
          : db.prepare('SELECT m.*, c.name FROM messages m LEFT JOIN contacts c ON c.id=m.contact_id ORDER BY m.id DESC LIMIT 200').all();
        return send(res, 200, rows);
      }
      return send(res, 404, { error: 'Not found' });
    }

    // static PWA
    let f = path.join(__dirname, 'public', p === '/' ? 'index.html' : p);
    if (!f.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(f)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`Running on http://localhost:${PORT}  ${MOCK ? '(MOCK mode - no WhatsApp credentials)' : '(LIVE)'}`));

