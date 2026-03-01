// Vercel Serverless Function — obsługa formularza kontaktowego
// Zgłoszenia są logowane w Vercel Logs (vercel.com → projekt → Logs)
// Możesz dodać powiadomienia email/Telegram poniżej.

const LEADS_STORE = [];

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
    const { name, phone, timestamp, source } = req.body;

    // Walidacja
    if (!name || !phone) {
      return res.status(400).json({ error: 'Imię i telefon są wymagane' });
    }

    if (!/^[\d\s\+\-]{7,15}$/.test(phone.replace(/\s/g, ''))) {
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

    // --- OPCJA 1: Powiadomienie email przez Resend ---
    // Odkomentuj i ustaw RESEND_API_KEY w zmiennych środowiskowych Vercel
    /*
    if (process.env.RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Landing <onboarding@resend.dev>',
          to: ['twoj@email.pl'],
          subject: `Nowy lead: ${lead.name} — ${lead.phone}`,
          text: `Imię: ${lead.name}\nTelefon: ${lead.phone}\nCzas: ${lead.timestamp}\nŹródło: ${lead.source}`,
        }),
      });
    }
    */

    // Telegram Bot — powiadomienie o nowym leadzie
    const date = new Date(lead.timestamp).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
    const tgText = `${date} — nowy lead!\n\n${lead.name}\n${lead.phone}`;
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: tgText,
        parse_mode: 'Markdown',
      }),
    });

    return res.status(200).json({ success: true, message: 'Dziękujemy! Odezwiemy się wkrótce.' });
  } catch (error) {
    console.error('Błąd:', error);
    return res.status(500).json({ error: 'Wewnętrzny błąd serwera' });
  }
}
