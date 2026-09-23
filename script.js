  // scroll-reveal
  const revealEls = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if(e.isIntersecting){ e.target.classList.add('in-view'); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  revealEls.forEach(el => io.observe(el));

  // active nav dot tracking
  const navDots = document.querySelectorAll('.side-nav a');
  const sections = [...navDots]
    .filter(a => a.getAttribute('href').startsWith('#'))
    .map(a => document.querySelector(a.getAttribute('href')));
  const navIo = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        const id = '#' + entry.target.id;
        navDots.forEach(a => a.classList.toggle('active', a.getAttribute('href') === id));
      }
    });
  }, { threshold: 0.5 });
  sections.forEach(s => { if(s) navIo.observe(s); });

  // ---------- Email Verification & Typo Detection ----------
  // To send REAL 6-digit OTP codes directly to user's email inbox:
  // 1. Create a free account at https://www.emailjs.com/
  // 2. Add an Email Service (e.g. Gmail) -> get SERVICE_ID
  // 3. Create an Email Template with {{to_email}} and {{otp_code}} -> get TEMPLATE_ID
  // 4. Get your PUBLIC_KEY from Account Settings and replace below:
  const EMAILJS_PUBLIC_KEY = "GJXhUSDb9jdD9SCaJ"; // EmailJS Public Key
  const EMAILJS_SERVICE_ID = "service_ptgdbyn"; // EmailJS Service ID
  const EMAILJS_TEMPLATE_ID = "template_xrhj8hc"; // EmailJS Template ID

  if (typeof emailjs !== 'undefined' && EMAILJS_PUBLIC_KEY) {
    emailjs.init(EMAILJS_PUBLIC_KEY);
  }

  const emailInput = document.getElementById('email');
  const verifyBadge = document.getElementById('email-verify-badge');
  const emailHint = document.getElementById('email-hint');
  const form = document.getElementById('contact-form');
  const statusEl = document.getElementById('form-status');

  // OTP Modal Elements
  const otpModal = document.getElementById('otp-modal');
  const closeModalBtn = document.getElementById('close-modal-btn');
  const modalUserEmail = document.getElementById('modal-user-email');
  const otpInputs = document.querySelectorAll('.otp-input');
  const verifyOtpBtn = document.getElementById('verify-otp-btn');
  const resendOtpBtn = document.getElementById('resend-otp-btn');
  const resendTimerEl = document.getElementById('resend-timer');
  const otpStatusMsg = document.getElementById('otp-status');

  let currentOTP = null;
  let isEmailVerified = false;
  let verifiedEmailAddress = '';
  let resendCountdown = 30;
  let resendInterval = null;

  // Common domain typo map
  const domainTypos = {
    'gmal.com': 'gmail.com',
    'gmaill.com': 'gmail.com',
    'gamil.com': 'gmail.com',
    'gmial.com': 'gmail.com',
    'gmai.com': 'gmail.com',
    'yaho.com': 'yahoo.com',
    'yahooo.com': 'yahoo.com',
    'hotmai.com': 'hotmail.com',
    'hotmial.com': 'hotmail.com',
    'outlok.com': 'outlook.com',
    'outloo.com': 'outlook.com'
  };

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  function validateEmailLive() {
    const value = emailInput.value.trim();

    if (isEmailVerified && value === verifiedEmailAddress) {
      verifyBadge.className = 'verify-badge verified';
      verifyBadge.textContent = '🔒 Verified';
      emailHint.innerHTML = '';
      return true;
    }

    // Reset verification status if email changed
    if (isEmailVerified && value !== verifiedEmailAddress) {
      isEmailVerified = false;
    }

    if (!value) {
      verifyBadge.className = 'verify-badge';
      verifyBadge.textContent = '';
      emailHint.innerHTML = '';
      return false;
    }

    const isValid = emailRegex.test(value);
    if (!isValid) {
      verifyBadge.className = 'verify-badge invalid';
      verifyBadge.textContent = '✗ Invalid email';
      emailHint.style.color = 'var(--rust)';
      emailHint.textContent = 'Please enter a valid email (e.g. name@domain.com)';
      return false;
    }

    // Check for domain typos
    const parts = value.split('@');
    const domain = parts[1] ? parts[1].toLowerCase() : '';
    if (domainTypos[domain]) {
      const suggestedEmail = parts[0] + '@' + domainTypos[domain];
      verifyBadge.className = 'verify-badge valid';
      verifyBadge.textContent = '✓ Format ok';
      emailHint.style.color = 'var(--amber)';
      emailHint.innerHTML = `Did you mean <button type="button" class="typo-btn" id="apply-typo-fix">${suggestedEmail}</button>?`;

      const typoBtn = document.getElementById('apply-typo-fix');
      if (typoBtn) {
        typoBtn.addEventListener('click', () => {
          emailInput.value = suggestedEmail;
          validateEmailLive();
        });
      }
      return true;
    }

    verifyBadge.className = 'verify-badge valid';
    verifyBadge.textContent = '✓ Format ok';
    emailHint.style.color = 'var(--moss)';
    emailHint.textContent = 'Valid email address format.';
    return true;
  }

  emailInput.addEventListener('input', validateEmailLive);

  // ---------- OTP Generation & Real Email Dispatch Functions ----------
  let verificationProvider = 'backend';
  let clientOtpCode = null;

  function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  function getApiUrl(endpoint) {
    if (window.location.protocol === 'file:' || !window.location.hostname || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      if (window.location.port !== '5000') {
        return `http://localhost:5000${endpoint}`;
      }
    }
    return endpoint;
  }

  async function dispatchOTPEmail(email, name) {
    otpStatusMsg.textContent = `✉️ Sending 6-digit verification code to ${email}...`;
    otpStatusMsg.className = 'otp-status-msg';
    verifyOtpBtn.disabled = true;

    // Reset OTP inputs
    otpInputs.forEach(inp => {
      inp.value = '';
      inp.classList.remove('error');
    });

    const API_URL = getApiUrl('/api/contact/send-otp');
    let backendOffline = false;
    let backendErrorMessage = '';
    let emailjsErrorMessage = '';

    // 1. Try Backend API first (sends real email via Nodemailer SMTP with App Password)
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        verificationProvider = 'backend';
        clientOtpCode = null;
        otpStatusMsg.innerHTML = `✓ 6-digit code sent to ${email}!<br/><span style="font-size: 13px; color: var(--amber, #E8A33D);">📧 Please check your <strong>Inbox &amp; Spam folder</strong>.</span>`;
        otpStatusMsg.className = 'otp-status-msg';
        verifyOtpBtn.disabled = false;
        startResendTimer();

        if (otpInputs[0]) otpInputs[0].focus();
        return;
      } else {
        backendErrorMessage = data.message || 'Server cannot deliver email';
        console.warn('[Backend Notice]:', backendErrorMessage);
      }
    } catch (backendErr) {
      backendOffline = true;
      console.warn('[Backend Offline]: Backend server on port 5000 is not running.', backendErr);
    }

    // 2. Fallback to EmailJS (direct browser-to-inbox dispatch)
    if (typeof emailjs !== 'undefined' && EMAILJS_PUBLIC_KEY) {
      try {
        const generatedCode = generateOTP();
        const result = await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
          to_name: name || "Visitor",
          from_name: "Arpit Dwivedi",
          to_email: email,
          user_email: email,
          recipient_email: email,
          recipient: email,
          email: email,
          send_to: email,
          reply_to: email,
          otp_code: generatedCode,
          passcode: generatedCode,
          code: generatedCode,
          message: `Your 6-digit verification code to connect with Arpit Dwivedi is ${generatedCode}`
        });
        console.log('[EmailJS Sent Success]:', result);
        verificationProvider = 'emailjs';
        clientOtpCode = generatedCode;
        otpStatusMsg.innerHTML = `✓ 6-digit code sent to ${email}!<br/><span style="font-size: 13px; color: var(--amber, #E8A33D);">⚠️ Please check your <strong>Inbox and Spam / Junk folder</strong>.</span>`;
        otpStatusMsg.className = 'otp-status-msg';
        verifyOtpBtn.disabled = false;
        startResendTimer();
        if (otpInputs[0]) otpInputs[0].focus();
        return;
      } catch (emailjsErr) {
        console.error('[EmailJS Error]:', emailjsErr);
        emailjsErrorMessage = emailjsErr?.text || emailjsErr?.message || 'EmailJS service error';
      }
    }

    // 3. Inform user of email delivery issue and allow resend
    verificationProvider = null;
    verifyOtpBtn.disabled = true;

    const errorDetail = backendErrorMessage || emailjsErrorMessage || 'Please verify your internet connection or try a different email address.';
    otpStatusMsg.innerHTML = `❌ Unable to deliver verification code to <strong>${email}</strong>.<br/>` +
      `<span style="color: var(--rust, #e05252); font-size: 13px; display: block; margin: 6px 0;">${errorDetail}</span>` +
      `<span style="color: var(--sand, #F2EAD8); font-size: 13px;">Please make sure the backend server is running and click <strong>Resend Code</strong> below.</span>`;
    otpStatusMsg.className = 'otp-status-msg error';
  }

  function startResendTimer() {
    resendCountdown = 30;
    resendOtpBtn.disabled = true;
    resendTimerEl.textContent = `(${resendCountdown}s)`;
    clearInterval(resendInterval);

    resendInterval = setInterval(() => {
      resendCountdown--;
      if (resendCountdown <= 0) {
        clearInterval(resendInterval);
        resendOtpBtn.disabled = false;
        resendTimerEl.textContent = '';
      } else {
        resendTimerEl.textContent = `(${resendCountdown}s)`;
      }
    }, 1000);
  }

  function openOTPModal(email, name) {
    modalUserEmail.textContent = email;

    otpInputs.forEach(input => {
      input.value = '';
      input.classList.remove('error');
    });

    otpModal.classList.add('active');
    otpModal.setAttribute('aria-hidden', 'false');

    dispatchOTPEmail(email, name);
  }

  function closeOTPModal() {
    otpModal.classList.remove('active');
    otpModal.setAttribute('aria-hidden', 'true');
    clearInterval(resendInterval);
  }

  if (closeModalBtn) closeModalBtn.addEventListener('click', closeOTPModal);
  if (otpModal) {
    otpModal.addEventListener('click', (e) => {
      if (e.target === otpModal) closeOTPModal();
    });
  }

  // Handle OTP Inputs auto-advance & keyboard navigation
  otpInputs.forEach((input, idx) => {
    input.addEventListener('input', (e) => {
      const val = e.target.value.replace(/[^0-9]/g, '');
      e.target.value = val;
      e.target.classList.remove('error');

      if (val && idx < otpInputs.length - 1) {
        otpInputs[idx + 1].focus();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && idx > 0) {
        otpInputs[idx - 1].focus();
      }
    });

    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '');
      if (pasteData) {
        const digits = pasteData.slice(0, 6).split('');
        digits.forEach((digit, i) => {
          if (otpInputs[i]) otpInputs[i].value = digit;
        });
        const focusIdx = Math.min(digits.length, otpInputs.length - 1);
        if (otpInputs[focusIdx]) otpInputs[focusIdx].focus();
      }
    });
  });

  const skipOtpSendBtn = document.getElementById('skip-otp-send-btn');
  if (skipOtpSendBtn) {
    skipOtpSendBtn.addEventListener('click', async () => {
      closeOTPModal();
      await dispatchFormMessage();
    });
  }

  if (resendOtpBtn) {
    resendOtpBtn.addEventListener('click', () => {
      if (resendCountdown > 0) return;
      const userEmail = emailInput.value.trim();
      const userName = document.getElementById('name').value.trim();
      dispatchOTPEmail(userEmail, userName);
    });
  }

  // Verify OTP button handler
  if (verifyOtpBtn) {
    verifyOtpBtn.addEventListener('click', async () => {
      const enteredOTP = Array.from(otpInputs).map(inp => inp.value).join('');
      const userEmail = emailInput.value.trim();
      const userName = document.getElementById('name').value.trim();
      const userMsg = document.getElementById('message').value.trim();

      if (enteredOTP.length < 6) {
        otpStatusMsg.textContent = 'Please enter all 6 digits of the code.';
        otpStatusMsg.className = 'otp-status-msg error';
        return;
      }

      verifyOtpBtn.disabled = true;
      otpStatusMsg.textContent = 'Verifying code...';
      otpStatusMsg.className = 'otp-status-msg';

      // 1. Verify via Backend API
      if (verificationProvider === 'backend') {
        const API_URL = getApiUrl('/api/contact/verify-otp');

        try {
          const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userEmail, otp: enteredOTP, name: userName, message: userMsg })
          });
          const data = await res.json();
          verifyOtpBtn.disabled = false;

          if (res.ok && data.success) {
            isEmailVerified = true;
            verifiedEmailAddress = userEmail;
            otpStatusMsg.textContent = '✓ Email verified! Message sent successfully.';
            otpStatusMsg.className = 'otp-status-msg';

            setTimeout(() => {
              closeOTPModal();
              validateEmailLive();
              statusEl.classList.remove('error');
              statusEl.style.color = 'var(--moss)';
              statusEl.textContent = `✓ Thank you ${userName}! Your email (${userEmail}) was verified and your message has been delivered to arpitdwivedi.bdl@gmail.com.`;
              form.reset();
            }, 600);
          } else {
            otpStatusMsg.textContent = data.message || 'Incorrect verification code. Please check your email and try again.';
            otpStatusMsg.className = 'otp-status-msg error';
            otpInputs.forEach(inp => inp.classList.add('error'));
          }
        } catch (err) {
          verifyOtpBtn.disabled = false;
          otpStatusMsg.textContent = 'Verification server error. Please check your connection and try again.';
          otpStatusMsg.className = 'otp-status-msg error';
        }
        return;
      }

      // 2. Verify via EmailJS Client Code
      if (verificationProvider === 'emailjs') {
        verifyOtpBtn.disabled = false;
        if (clientOtpCode && enteredOTP === clientOtpCode) {
          isEmailVerified = true;
          verifiedEmailAddress = userEmail;
          otpStatusMsg.textContent = '✓ Email verified! Sending your message...';
          otpStatusMsg.className = 'otp-status-msg';

          setTimeout(async () => {
            closeOTPModal();
            validateEmailLive();
            await dispatchFormMessage();
          }, 600);
        } else {
          otpStatusMsg.textContent = 'Incorrect verification code. Please check your email and try again.';
          otpStatusMsg.className = 'otp-status-msg error';
          otpInputs.forEach(inp => inp.classList.add('error'));
        }
        return;
      }

      // Fallback
      verifyOtpBtn.disabled = false;
      otpStatusMsg.textContent = 'Session expired. Please click Resend Code.';
      otpStatusMsg.className = 'otp-status-msg error';
    });
  }

  // Message dispatch function (Sends contact message directly to arpitdwivedi.bdl@gmail.com)
  async function dispatchFormMessage() {
    const nameInput = document.getElementById('name');
    const messageInput = document.getElementById('message');
    const submitBtn = document.getElementById('submit-btn');

    const name = nameInput ? nameInput.value.trim() : '';
    const email = emailInput ? emailInput.value.trim() : '';
    const message = messageInput ? messageInput.value.trim() : '';

    if (!name || !email || !message) {
      statusEl.textContent = 'Please fill in all fields before sending.';
      statusEl.classList.add('error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Forwarding message to Arpit...';
    }

    statusEl.classList.remove('error');
    statusEl.style.color = 'var(--moss, #3ecf8e)';
    statusEl.textContent = 'Forwarding message to arpitdwivedi.bdl@gmail.com...';

    const API_URL = getApiUrl('/api/contact/send-message');
    let sent = false;

    // 1. Send via Backend API route (/api/contact/send-message)
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message, verified: isEmailVerified })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        sent = true;
        statusEl.textContent = `✓ Thank you ${name}! Your message has been forwarded successfully to Arpit Dwivedi (arpitdwivedi.bdl@gmail.com).`;
      }
    } catch (err) {
      console.warn('Backend contact API notice:', err);
    }

    // 2. If backend was unreachable, deliver via EmailJS directly to Arpit
    if (!sent && typeof emailjs !== 'undefined' && EMAILJS_PUBLIC_KEY) {
      try {
        await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
          to_name: "Arpit Dwivedi",
          from_name: name,
          to_email: "arpitdwivedi.bdl@gmail.com",
          recipient_email: "arpitdwivedi.bdl@gmail.com",
          user_email: email,
          from_email: email,
          reply_to: email,
          email: email,
          message: message,
          verified_status: isEmailVerified ? "Verified Contact" : "Direct Contact"
        });
        sent = true;
        statusEl.textContent = `✓ Thank you ${name}! Your message has been forwarded successfully to Arpit Dwivedi (arpitdwivedi.bdl@gmail.com).`;
      } catch (emailjsErr) {
        console.warn('EmailJS delivery notice:', emailjsErr);
      }
    }

    // 3. Ultra-reliable mailto fallback if both services are offline
    if (!sent) {
      const mailtoSubject = encodeURIComponent(`Portfolio Message from ${name}`);
      const mailtoBody = encodeURIComponent(`From: ${name} (${email})\n\nMessage:\n${message}`);
      statusEl.innerHTML = `✓ Message ready! If email service was busy, <a href="mailto:arpitdwivedi.bdl@gmail.com?subject=${mailtoSubject}&body=${mailtoBody}" style="color: var(--amber, #E8A33D); text-decoration: underline; font-weight: bold;">Click here to forward directly via your email app</a>.`;
    }

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send message';
    }

    form.reset();
  }

  // Contact Form Submit Handler
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    const nameInput = document.getElementById('name');
    const messageInput = document.getElementById('message');

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const message = messageInput.value.trim();

    if (!name || !email || !message) {
      statusEl.textContent = 'Please fill in all fields.';
      statusEl.classList.add('error');
      return;
    }

    if (!validateEmailLive()) {
      statusEl.textContent = 'Please provide a valid email address.';
      statusEl.classList.add('error');
      return;
    }

    // Before sending the message, verify the email by sending a 6-digit OTP code to the user's mail
    if (isEmailVerified && email === verifiedEmailAddress) {
      await dispatchFormMessage();
    } else {
      openOTPModal(email, name);
    }
  });