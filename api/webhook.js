export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const event = req.body;
    console.log('WEBHOOK RAW:', JSON.stringify(event).slice(0, 2000));

    // Creem sends event_type at top level or nested
    const eventType = event.event_type || event.type || event.eventType || '';
    console.log('EVENT TYPE:', eventType);

    // Try multiple paths to find customer email
    const customer = event.data?.customer || event.object?.customer || event.customer || {};
    const subscription = event.data?.subscription || event.object?.subscription || event.subscription || {};
    const order = event.data?.order || event.object?.order || event.order || {};
    const email = customer.email || event.data?.email || event.email || order.customer_email || '';
    console.log('EMAIL:', email);
    console.log('CUSTOMER:', JSON.stringify(customer).slice(0, 500));

    if (!email) {
      console.log('NO EMAIL FOUND - skipping');
      return res.status(200).json({ ok: true, skipped: 'no email', keys: Object.keys(event) });
    }

    const SUPA_URL = 'https://tzmbybwytfpaqaajwumz.supabase.co';
    const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

    const headers = { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' };

    // Grant access events
    if (['checkout.completed', 'subscription.active', 'subscription.paid', 'subscription_created', 'subscription_updated'].includes(eventType)) {
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
        console.log('UPDATED subscription for', email);
      } else {
        await fetch(SUPA_URL + '/rest/v1/subscriptions', {
          method: 'POST', headers, body: JSON.stringify(body)
        });
        console.log('CREATED subscription for', email);
      }
      return res.status(200).json({ ok: true, action: 'activated', email });
    }

    // Revoke access events
    if (['subscription.canceled', 'subscription.expired', 'subscription_cancelled', 'subscription_expired'].includes(eventType)) {
      await fetch(SUPA_URL + '/rest/v1/subscriptions?email=eq.' + encodeURIComponent(email), {
        method: 'PATCH', headers,
        body: JSON.stringify({ status: 'inactive', updated_at: new Date().toISOString() })
      });
      console.log('DEACTIVATED subscription for', email);
      return res.status(200).json({ ok: true, action: 'deactivated', email });
    }

    console.log('IGNORED event type:', eventType);
    return res.status(200).json({ ok: true, ignored: eventType });
  } catch (e) {
    console.error('WEBHOOK ERROR:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
