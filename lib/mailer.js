// Sends emails to users FROM the owner's Gmail (users never enter an app password).
const nodemailer = require('nodemailer');
const cfg = require('./config');
const transports = {};
// Try port 465 first, then 587 (STARTTLS) – some hosts block one of them.
function getTransport(port) {
  if (!cfg.GMAIL_USER || !cfg.GMAIL_APP_PASSWORD) return null;
  if (!transports[port]) transports[port] = nodemailer.createTransport({
    host: 'smtp.gmail.com', port, secure: port === 465, requireTLS: port === 587,
    auth: { user: cfg.GMAIL_USER, pass: cfg.GMAIL_APP_PASSWORD },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  });
  return transports[port];
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function layout(title, rows, footer = '') {
  const body = rows.map(([k, v]) => `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px">${esc(k)}</td><td style="padding:8px 0;text-align:right;font-weight:600;color:#111827;font-size:14px">${esc(v)}</td></tr>`).join('');
  return `<div style="background:#ffffff;padding:24px;font-family:Arial,sans-serif"><div style="max-width:520px;margin:auto;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
  <div style="background:#0b1020;padding:20px 24px;color:#7dd3fc;font-weight:800;letter-spacing:2px">${esc(cfg.BRAND)}</div>
  <div style="padding:24px"><h2 style="margin:0 0 16px;color:#111827">${esc(title)}</h2><table style="width:100%;border-collapse:collapse">${body}</table>${footer}
  <p style="margin-top:24px;color:#9ca3af;font-size:12px">Support: Telegram ${esc(cfg.SUPPORT_GROUP)} · Updates: ${esc(cfg.SUPPORT_CHANNEL)}<br/>© ${new Date().getFullYear()} ${esc(cfg.BRAND)} · by ${esc(cfg.OWNER)}</p></div></div></div>`;
}
async function send(to, subject, html, attachments) {
  if (!getTransport(465) || !to) return false;
  const msg = { from: `"${cfg.BRAND}" <${cfg.GMAIL_USER}>`, to, subject, html, ...(attachments ? { attachments } : {}) };
  let lastErr;
  for (const port of [465, 587]) {
    try { await getTransport(port).sendMail(msg); return true; }
    catch (e) { lastErr = e; }
  }
  console.error('Email send failed:', lastErr && lastErr.message);
  return false;
}
module.exports = { send, layout, esc };
