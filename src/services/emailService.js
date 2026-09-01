const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

async function getSmtpConfig() {
  try {
    const SystemSettings = require('../database/models/SystemSettings');
    const settings = await SystemSettings.getByPrefix('smtp.');
    const host = settings['smtp.host'] || process.env.SMTP_HOST;
    const port = parseInt(settings['smtp.port'] || process.env.SMTP_PORT) || 587;
    const user = settings['smtp.user'] || process.env.SMTP_USER;
    const pass = settings['smtp.pass'] || process.env.SMTP_PASS;
    const from = settings['smtp.from'] || process.env.SMTP_FROM || user;
    return { host, port, user, pass, from };
  } catch {
    // DB not available yet (e.g. during startup), fall back to env
    return {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM || process.env.SMTP_USER
    };
  }
}

async function sendEmail({ to, subject, html }) {
  const { host, port, user, pass, from } = await getSmtpConfig();

  if (!host || !user || !pass) {
    logger.warn('SMTP not configured, skipping email', { to, subject });
    return false;
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  try {
    await transport.sendMail({ from, to, subject, html });
    logger.info('Email sent', { to, subject });
    return true;
  } catch (error) {
    logger.error('Failed to send email', { to, subject, error: error.message });
    return false;
  }
}

module.exports = { sendEmail, getSmtpConfig };
