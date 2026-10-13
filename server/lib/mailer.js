const nodemailer = require('nodemailer');
const config = require('../config');

const transport = config.smtp.url ? nodemailer.createTransport(config.smtp.url) : null;

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Envia um e-mail transacional com um botão de ação. Sem SMTP configurado (dev),
 * o link é impresso no log do servidor.
 */
async function sendActionEmail({ to, subject, intro, action, url }) {
  if (!transport) {
    console.log(`[mail] (SMTP não configurado) Para: ${to} | ${subject}\n       ${url}`);
    return;
  }
  await transport.sendMail({
    from: config.smtp.from,
    to,
    subject,
    text: `${intro}\n\n${action}: ${url}\n\nSe não foi você, ignore este e-mail.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px">
  <h2 style="margin:0 0 16px">♪ Sound</h2>
  <p>${escape(intro)}</p>
  <p style="margin:24px 0"><a href="${escape(url)}" style="background:#1ed760;color:#000;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">${escape(action)}</a></p>
  <p style="color:#666;font-size:13px">Se não foi você, ignore este e-mail.</p>
</div>`,
  });
}

module.exports = { sendActionEmail, mailEnabled: Boolean(transport) };
