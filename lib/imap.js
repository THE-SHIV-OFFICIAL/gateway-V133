// Reads payment alert emails from the owner's Gmail via IMAP and matches them to pending orders.
const { ImapFlow } = require('imapflow');
const cfg = require('./config');

function makeClient() {
  const c = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: cfg.GMAIL_USER, pass: cfg.GMAIL_APP_PASSWORD },
    logger: false, disableCompression: true, disableAutoIdle: true,
    connectionTimeout: 30000, greetingTimeout: 20000, socketTimeout: 90000,
  });
  // FIX: without this listener a dropped socket crashes the whole server.
  c.on('error', e => console.error('IMAP connection error:', e.code || '', e.message));
  return c;
}
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

async function testLogin() {
  if (!cfg.GMAIL_USER || !cfg.GMAIL_APP_PASSWORD) return { ok: false, error: 'Gmail not configured' };
  const c = makeClient();
  try { await withTimeout(c.connect(), 40000, 'IMAP connect timeout'); await c.logout().catch(() => {}); return { ok: true }; }
  catch (e) { try { c.close(); } catch {} return { ok: false, error: e.responseText || e.message }; }
}

/**
 * Returns recent messages since `since` as { uid, text } (subject + plain body, lowercased).
 */
async function fetchRecent(since) {
  const c = makeClient();
  const out = [];
  try { await withTimeout(c.connect(), 40000, 'IMAP connect timeout'); }
  catch (e) { try { c.close(); } catch {} throw e; }
  try {
    const lock = await c.getMailboxLock('INBOX');
    try {
      const uids = await c.search({ since }, { uid: true });
      const list = (uids || []).slice(-200);
      if (list.length) {
        for await (const m of c.fetch(list, { uid: true, envelope: true, source: { maxLength: 60000 } }, { uid: true })) {
          const raw = m.source ? m.source.toString('utf8') : '';
          const text = decode(raw);
          out.push({ uid: m.uid, msgId: m.envelope?.messageId || String(m.uid), subject: m.envelope?.subject || '', text: ((m.envelope?.subject || '') + ' ' + text).toLowerCase() });
        }
      }
    } finally { lock.release(); }
  } finally { await withTimeout(c.logout(), 10000, 'logout timeout').catch(() => { try { c.close(); } catch {} }); }
  return out;
}

// Light decoder for quoted-printable / base64 parts so amounts & order IDs are searchable.
function decode(raw) {
  let s = raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const b64 = raw.match(/Content-Transfer-Encoding:\s*base64\s*\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/gi) || [];
  for (const blk of b64) {
    const data = blk.split(/\r?\n\r?\n/)[1] || '';
    try { s += ' ' + Buffer.from(data.replace(/\s+/g, ''), 'base64').toString('utf8'); } catch {}
  }
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#8377;|&#x20b9;/gi, ' ').replace(/\s+/g, ' ');
}

/** Does the email text contain this exact amount (e.g. 1.90 or 1.9) or the order ID? */
function matches(mailText, order) {
  if (mailText.includes(order.orderId.toLowerCase())) return true;
  const a1 = order.payAmount.toFixed(2);
  const a2 = String(parseFloat(order.payAmount.toFixed(2)));
  const amounts = Array.from(new Set([a1, a2])).map(x => x.replace('.', '\\.'));
  const re = new RegExp(`(₹|rs\\.?|inr|amount|received|credited|paid)[^0-9]{0,15}(${amounts.join('|')})(?![0-9])`, 'i');
  return re.test(mailText);
}

module.exports = { testLogin, fetchRecent, matches };
