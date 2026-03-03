// Vercel Serverless Function — obsługa formularza kontaktowego
// Zgłoszenia są logowane w Vercel Logs (vercel.com → projekt → Logs)

import { createHash } from 'crypto';

const PIXEL_ID = '856179134049541';

function sha256(value) {
  if (!value) return null;
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function normalizePhone(phone) {
  // Remove spaces, dashes; ensure starts with country code
  let clean = phone.replace(/[\s\-\(\)]/g, '');
  if (clean.startsWith('0')) clean = '48' + clean.slice(1);
  if (!clean.startsWith('+') && !clean.startsWith('48')) clean = '48' + clean;
  clean = clean.replace('+', '');
  return clean;
}

async function sendCAPI({ name, phone, eventId, fbc, fbp, userAgent, ip, sourceUrl }) {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) {
    console.log('META_CAPI_TOKEN not set, skipping CAPI');
    return;
  }

  const userData = {
    ph: [sha256(normalizePhone(phone))],
    fn: [sha256(name)],
    client_user_agent: userAgent,
    client_ip_address: ip,
  };
  if (fbc) userData.fbc = fbc;
  if (fbp) userData.fbp = fbp;

  const payload = {
    data: [{
      event_name: 'Contact',
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      event_source_url: sourceUrl || 'https://jakdlasiebie.com',
      user_data: userData,
    }],
    // TODO: usunąć po testach
    test_event_code: 'TEST65235',
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${PIXEL_ID}/events?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    const result = await res.json();
    console.log('CAPI response:', JSON.stringify(result));
  } catch (err) {
    console.error('CAPI error:', err);
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, phone, timestamp, source, token, event_id, fbc, fbp } = req.body;

    // Turnstile verification (soft-fail: log but don't block real leads)
    let turnstileOk = false;
    try {
      if (token) {
        const params = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token });
        const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        const verify = await verifyRes.json();
        turnstileOk = verify.success;
        if (!verify.success) console.log('Turnstile fail:', JSON.stringify(verify));
      }
    } catch (err) {
      console.error('Turnstile error:', err);
    }

    // Walidacja
    if (!name || !phone) {
      return res.status(400).json({ error: 'Imię i telefon są wymagane' });
    }

    const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
    if (!/^\+?\d{7,15}$/.test(cleanPhone)) {
      return res.status(400).json({ error: 'Nieprawidłowy numer telefonu' });
    }

    const lead = {
      name: name.trim(),
      phone: phone.trim(),
      timestamp: timestamp || new Date().toISOString(),
      source: source || 'landing',
    };

    // Log do Vercel Logs — widoczne w dashboardzie
    console.log('=== NOWY LEAD ===');
    console.log(JSON.stringify(lead, null, 2));
    console.log('=================');

    // Telegram Bot — powiadomienie o nowym leadzie
    const date = new Date(lead.timestamp).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
    const badge = turnstileOk ? '' : ' [!]';
    const tgText = `${date} — nowy lead${badge}!\n\n${lead.name}\n${lead.phone}`;
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: tgText,
        parse_mode: 'Markdown',
      }),
    });

    // Meta Conversions API — server-side event
    sendCAPI({
      name: lead.name,
      phone: lead.phone,
      eventId: event_id,
      fbc,
      fbp,
      userAgent: req.headers['user-agent'],
      ip: req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress,
      sourceUrl: req.headers['referer'],
    });

    return res.status(200).json({ success: true, message: 'Dziękujemy! Odezwiemy się wkrótce.' });
  } catch (error) {
    console.error('Błąd:', error);
    return res.status(500).json({ error: 'Wewnętrzny błąd serwera' });
  }
}
