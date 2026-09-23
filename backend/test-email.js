const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

console.log('--- Testing Gmail SMTP Connection ---');
console.log('SMTP_USER:', process.env.SMTP_USER);
const rawPass = process.env.SMTP_PASS || '';
const cleanPass = rawPass.replace(/\s+/g, '');
console.log('App Password clean character count:', cleanPass.length);

const port = parseInt(process.env.SMTP_PORT, 10) || 587;
const secure = process.env.SMTP_SECURE === 'true' || port === 465;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: port,
  secure: secure,
  auth: {
    user: (process.env.SMTP_USER || '').trim(),
    pass: cleanPass
  },
  tls: {
    rejectUnauthorized: false
  }
});

transporter.verify((err, success) => {
  if (err) {
    console.error('❌ SMTP VERIFICATION FAILED:', err.message);
    if (err.response) {
      console.error('Server response:', err.response);
    }
  } else {
    console.log('✓ SMTP VERIFICATION SUCCESS! Gmail SMTP credentials are valid and ready.');
  }
  process.exit(err ? 1 : 0);
});
