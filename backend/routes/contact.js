const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();

const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');

const fs = require('fs');
const dbFilePath = path.join(__dirname, '..', 'database.json');

// Save message persistently to database.json so messages are never lost
function saveMessageToDb(msg) {
  try {
    let data = { users: [], messages: [] };
    if (fs.existsSync(dbFilePath)) {
      const raw = fs.readFileSync(dbFilePath, 'utf8');
      data = JSON.parse(raw);
    }
    if (!Array.isArray(data.messages)) {
      data.messages = [];
    }
    data.messages.push(msg);
    fs.writeFileSync(dbFilePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[Persistent Message Saved] ID: ${msg.id} from ${msg.email}`);
  } catch (err) {
    console.error('[Database Save Notice]:', err.message);
  }
}

// In-memory OTP store: email -> { otp, expiresAt }
const otpStore = new Map();

// Contact messages store
const contactMessages = [];

// HTML escape helper to prevent email injection and XSS in email clients
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Sanitize email subject to prevent CRLF / email header injection
function sanitizeSubject(str) {
  if (!str) return '';
  return String(str).replace(/[\r\n]+/g, ' ').slice(0, 100).trim();
}

// Robust SMTP Dispatcher trying multiple Gmail transport options
async function sendMailWithFallback(mailOptions) {
  const smtpUser = (process.env.SMTP_USER || 'arpitdwivedi.bdl@gmail.com').trim();
  const rawPass = (process.env.SMTP_PASS || '').trim();
  const cleanPass = rawPass.replace(/\s+/g, '');

  if (!smtpUser || !cleanPass) {
    throw new Error('SMTP credentials (SMTP_USER / SMTP_PASS) are not configured in backend/.env');
  }

  let lastError = null;

  // 1. Try service: 'gmail' (Nodemailer recommended Gmail strategy)
  try {
    const t1 = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: smtpUser, pass: cleanPass },
      tls: { rejectUnauthorized: false }
    });
    const info = await t1.sendMail(mailOptions);
    console.log(`[SMTP Success via service 'gmail']: MessageId: ${info.messageId}`);
    return info;
  } catch (err1) {
    console.warn('[SMTP Strategy 1 (service: gmail) Notice]:', err1.message);
    lastError = err1;
  }

  // 2. Try host: smtp.gmail.com on port 465 (Direct SSL)
  try {
    const t2 = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: smtpUser, pass: cleanPass },
      tls: { rejectUnauthorized: false }
    });
    const info = await t2.sendMail(mailOptions);
    console.log(`[SMTP Success via port 465 SSL]: MessageId: ${info.messageId}`);
    return info;
  } catch (err2) {
    console.warn('[SMTP Strategy 2 (port 465 SSL) Notice]:', err2.message);
    lastError = err2;
  }

  // 3. Try host: smtp.gmail.com on port 587 (STARTTLS)
  try {
    const t3 = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: smtpUser, pass: cleanPass },
      tls: { rejectUnauthorized: false }
    });
    const info = await t3.sendMail(mailOptions);
    console.log(`[SMTP Success via port 587 TLS]: MessageId: ${info.messageId}`);
    return info;
  } catch (err3) {
    console.error('[SMTP Strategy 3 (port 587 TLS) Notice]:', err3.message);
    lastError = err3;
  }

  throw lastError;
}

// @route   POST /api/contact/send-otp
// @desc    Send real email verification OTP to user's email
// @access  Public
router.post('/send-otp', async (req, res) => {
  try {
    const { email, name } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }

    if (typeof email !== 'string' || email.length > 100) {
      return res.status(400).json({ success: false, message: 'Email address is too long.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    const safeName = typeof name === 'string' ? name.trim().slice(0, 100) : 'Visitor';
    const normalizedEmail = email.trim().toLowerCase();

    // Security: Rate Limiting (Cooldown of 60 seconds per email to prevent spam/abuse)
    const existing = otpStore.get(normalizedEmail);
    if (existing && existing.lastSentAt && (Date.now() - existing.lastSentAt) < 60000) {
      const waitSec = Math.ceil((60000 - (Date.now() - existing.lastSentAt)) / 1000);
      return res.status(429).json({ 
        success: false, 
        message: `Please wait ${waitSec} seconds before requesting another verification code.` 
      });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes expiry

    // Save in store with attempt counter and rate limit timestamp
    otpStore.set(normalizedEmail, { 
      otp: otpCode, 
      expiresAt, 
      attempts: 0,
      lastSentAt: Date.now() 
    });

    const mailOptions = {
      from: `"Arpit Dwivedi Portfolio" <${process.env.SMTP_USER || 'arpitdwivedi.bdl@gmail.com'}>`,
      to: normalizedEmail,
      replyTo: process.env.SMTP_USER || 'arpitdwivedi.bdl@gmail.com',
      subject: `Your Verification Code: ${otpCode} — Arpit Dwivedi Portfolio`,
      text: `Hello ${safeName},\n\nYour 6-digit email verification code is: ${otpCode}\n\nPlease enter this code on the portfolio website to verify your email and forward your message to Arpit Dwivedi.\n\nThis code expires in 10 minutes.\n\nBest regards,\nArpit Dwivedi\nPrayagraj, Uttar Pradesh\narpitdwivedi.bdl@gmail.com`,
      html: `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 10px; background: #ffffff; color: #1f2937;">
          <h2 style="color: #111827; margin-top: 0; font-size: 20px;">Arpit Dwivedi Portfolio</h2>
          <p>Hello <strong>${escapeHtml(safeName)}</strong>,</p>
          <p>Your 6-digit email verification code is:</p>
          <div style="font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #d97706; background: #fef3c7; padding: 14px 20px; border-radius: 8px; display: inline-block; margin: 12px 0;">
            ${otpCode}
          </div>
          <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">
            Please enter this code on the portfolio website to verify your email and forward your message to Arpit.
          </p>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 12px;">
            ⏱️ This code will expire in 10 minutes. Sent securely from Arpit Dwivedi Portfolio.
          </p>
        </div>
      `
    };

    const info = await sendMailWithFallback(mailOptions);
    console.log(`[Real Email Sent] Verification code delivered to ${normalizedEmail}. MessageId: ${info.messageId}`);

    res.json({
      success: true,
      message: `Verification code sent to ${normalizedEmail}! Please check your inbox or spam folder.`
    });
  } catch (err) {
    console.error('Send OTP error:', err.message);
    res.status(500).json({ 
      success: false, 
      message: `Failed to deliver verification code to ${req.body?.email || 'email'}: ${err.message}. Please check your Gmail App Password in backend/.env`
    });
  }
});

// @route   POST /api/contact/verify-otp
// @desc    Verify OTP code and submit contact message
// @access  Public
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp, name, message } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and verification code are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const record = otpStore.get(normalizedEmail);

    if (!record) {
      return res.status(400).json({ success: false, message: 'No verification code found for this email. Please request a new code.' });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(normalizedEmail);
      return res.status(400).json({ success: false, message: 'Verification code has expired. Please request a new code.' });
    }

    // Security: Brute-force protection (maximum 5 attempts per OTP code)
    record.attempts = (record.attempts || 0) + 1;
    if (record.attempts > 5) {
      otpStore.delete(normalizedEmail);
      return res.status(429).json({ 
        success: false, 
        message: 'Too many incorrect attempts. For security, this code has been invalidated. Please request a new code.' 
      });
    }

    if (record.otp !== otp.trim()) {
      const remaining = 5 - record.attempts;
      return res.status(400).json({ 
        success: false, 
        message: `Incorrect verification code. ${remaining > 0 ? `${remaining} attempts remaining.` : 'Please request a new code.'}` 
      });
    }

    // Clear OTP on success so it cannot be re-used
    otpStore.delete(normalizedEmail);

    const safeName = typeof name === 'string' ? name.trim().slice(0, 100) : 'Visitor';
    const safeMsg = typeof message === 'string' ? message.trim().slice(0, 5000) : '';

    // Record verified contact message
    const verifiedMessage = {
      id: Date.now(),
      name: safeName,
      email: normalizedEmail,
      message: safeMsg,
      verified: true,
      timestamp: new Date().toISOString()
    };
    contactMessages.push(verifiedMessage);
    saveMessageToDb(verifiedMessage);

    // Send email notification to Arpit Dwivedi with the verified message
    try {
      const mailOptions = {
        from: `"Portfolio Verified Contact" <${process.env.SMTP_USER || 'arpitdwivedi.bdl@gmail.com'}>`,
        to: process.env.ADMIN_EMAIL || process.env.SMTP_USER || 'arpitdwivedi.bdl@gmail.com',
        replyTo: normalizedEmail,
        subject: sanitizeSubject(`✉️ [Verified Contact] Message from ${safeName}`),
        html: `
          <div style="font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 550px; margin: 0 auto; padding: 24px; background: #15120F; color: #F2EAD8; border: 1px solid #33291d; border-radius: 12px;">
            <h2 style="color: #E8A33D; margin-top: 0;">New Verified Message Received</h2>
            <p style="color: #3ecf8e; font-weight: bold; margin-bottom: 12px;">✓ Email Verified via OTP (${escapeHtml(normalizedEmail)})</p>
            <p><strong>From:</strong> ${escapeHtml(safeName)} (&lt;${escapeHtml(normalizedEmail)}&gt;)</p>
            <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
            <div style="background: #1D1911; padding: 18px; border-radius: 8px; border: 1px solid #33291d; margin: 18px 0; color: #F2EAD8; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(safeMsg) || '(No message text)'}</div>
            <p style="color: #7F7663; font-size: 12px; margin-bottom: 0;">Sent via Arpit Dwivedi Portfolio Website (Verified Email)</p>
          </div>
        `
      };
      await sendMailWithFallback(mailOptions);
      console.log(`[Verified Message Delivered] Message from ${safeName} (${normalizedEmail}) sent to Arpit.`);
    } catch (mailErr) {
      console.warn('[Verified Message Mail Notice]:', mailErr.message);
    }

    res.json({
      success: true,
      message: 'Email verified successfully! Your message has been sent to Arpit Dwivedi.'
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ success: false, message: 'Server error during verification. Please try again.' });
  }
});

// @route   POST /api/contact/send-message
// @desc    Directly receive contact message and send notification to Arpit Dwivedi
// @access  Public
router.post('/send-message', async (req, res) => {
  try {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ success: false, message: 'Name, email, and message are required.' });
    }

    if (typeof email !== 'string' || email.length > 100) {
      return res.status(400).json({ success: false, message: 'Email address is too long.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    const safeName = typeof name === 'string' ? name.trim().slice(0, 100) : 'Visitor';
    const safeMsg = typeof message === 'string' ? message.trim().slice(0, 5000) : '';
    const normalizedEmail = email.trim().toLowerCase();

    // Store contact message in memory and persistent storage
    const newMessage = {
      id: Date.now(),
      name: safeName,
      email: normalizedEmail,
      message: safeMsg,
      timestamp: new Date().toISOString()
    };
    contactMessages.push(newMessage);
    saveMessageToDb(newMessage);

    // Send email notification to Arpit Dwivedi
    try {
      const mailOptions = {
        from: `"Portfolio Contact Form" <${process.env.SMTP_USER || 'arpitdwivedi.bdl@gmail.com'}>`,
        to: process.env.ADMIN_EMAIL || process.env.SMTP_USER || 'arpitdwivedi.bdl@gmail.com',
        replyTo: normalizedEmail,
        subject: sanitizeSubject(`✉️ New Contact Message from ${safeName} (${normalizedEmail})`),
        html: `
          <div style="font-family: 'Space Grotesk', Arial, sans-serif; max-width: 550px; margin: 0 auto; padding: 24px; background: #15120F; color: #F2EAD8; border: 1px solid #33291d; border-radius: 12px;">
            <h2 style="color: #E8A33D; margin-top: 0;">New Portfolio Message</h2>
            <p><strong>From:</strong> ${escapeHtml(safeName)} (&lt;${escapeHtml(normalizedEmail)}&gt;)</p>
            <p><strong>Reply-To:</strong> ${escapeHtml(normalizedEmail)}</p>
            <div style="background: #1D1911; padding: 16px; border-radius: 8px; border: 1px solid #33291d; margin: 16px 0; color: #F2EAD8; white-space: pre-wrap;">${escapeHtml(safeMsg)}</div>
            <p style="color: #7F7663; font-size: 12px; margin-bottom: 0;">Sent via Arpit Dwivedi Portfolio Website</p>
          </div>
        `
      };
      await sendMailWithFallback(mailOptions);
      console.log(`[Contact Message Delivered] Message from ${safeName} (${normalizedEmail}) sent to Arpit.`);
    } catch (mailErr) {
      console.warn('[Contact Message Mail Notice]: Saved message locally, email notice:', mailErr.message);
    }

    res.json({
      success: true,
      message: 'Message sent successfully to Arpit Dwivedi!'
    });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ success: false, message: 'Failed to send message. Please try again.' });
  }
});

module.exports = router;
