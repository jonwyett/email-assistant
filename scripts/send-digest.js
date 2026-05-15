'use strict';

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { loadConfig } = require('../src/config');

const REPORTS_DIR = path.join(__dirname, '../data/reports');

function resolveReportPath(target) {
  if (target) {
    const byName = path.join(REPORTS_DIR, target.endsWith('.txt') ? target : `${target}-digest.txt`);
    if (fs.existsSync(byName)) return byName;
    throw new Error(`No digest file found: ${byName}`);
  }

  const files = fs.readdirSync(REPORTS_DIR)
    .filter(f => f.endsWith('-digest.txt'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(REPORTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) throw new Error('No digest files found in data/reports/. Run npm run digest first.');
  return path.join(REPORTS_DIR, files[0].name);
}

async function sendDigest(target) {
  const config = loadConfig();
  const reportPath = resolveReportPath(target);
  const reportName = path.basename(reportPath);

  const { smtp, reportTo } = config;

  if (!smtp.user || !smtp.password) {
    throw new Error('SMTP credentials must be set in config.json (smtp.user / smtp.password) or .env (SMTP_USER / SMTP_PASSWORD)');
  }
  if (!reportTo) {
    throw new Error('report_to must be set in config.json or REPORT_TO in .env');
  }

  const body = fs.readFileSync(reportPath, 'utf8');
  const subject = body.split('\n')[0] || `Email Digest — ${reportName}`;

  const transporter = nodemailer.createTransport({
    host:   smtp.host,
    port:   smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.password },
  });

  console.log(`Verifying SMTP connection to ${smtp.host}:${smtp.port}...`);
  await transporter.verify();
  console.log('SMTP OK\n');

  await transporter.sendMail({
    from:    smtp.user,
    to:      reportTo,
    subject,
    text:    body,
  });

  console.log(`Sent "${subject}" → ${reportTo}`);
}

module.exports = { sendDigest };

if (require.main === module) {
  const target = process.argv[2] || null;
  sendDigest(target).catch(err => {
    console.error('Send failed:', err.message);
    process.exit(1);
  });
}
