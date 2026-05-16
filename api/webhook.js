export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const event = req.body;
    const eventType = event.event_type || event.type;
    const customer = event.object?.customer || event.customer || {};
    const subscription = event.object?.subscription || event.subscription || {};
    const email = customer.email;

    if (!email) return res.status(200).json({ ok: true, skipped: 'no email' });

    const SUPA_URL = 'https://tzmbybwytfpaqaajwumz.supabase.co';
    const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

    const headers = { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' };

    if (['checkout.completed', 'subscription.active', 'subscription.paid'].includes(eventType)) {
      const checkRes = await fetch(SUPA_URL + '/rest/v1/subscriptions?email=eq.' + encodeURIComponent(email), { headers });
      const existing = await checkRes.json();

      const body = {
        email,
        status: 'active',
        lemon_customer_id: customer.id || '',
        lemon_subscription_id: subscription.id || '',
        updated_at: new Date().toISOString()
      };

      if (existing && existing.length > 0) {
        await fetch(SUPA_URL + '/rest/v1/subscriptions?email=eq.' + encodeURIComponent(email), {
          method: 'PATCH', headers, body: JSON.stringify(body)
        });
      } else {
        await fetch(SUPA_URL + '/rest/v1/subscriptions', {
          method: 'POST', headers, body: JSON.stringify(body)
        });
      }
      return res.status(200).json({ ok: true });
    }

    if (['subscription.canceled', 'subscription.expired'].includes(eventType)) {
      await fetch(SUPA_URL + '/rest/v1/subscriptions?email=eq.' + encodeURIComponent(email), {
        method: 'PATCH', headers,
        body: JSON.stringify({ status: 'inactive', updated_at: new Date().toISOString() })
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true, ignored: eventType });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
