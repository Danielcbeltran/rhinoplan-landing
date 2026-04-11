export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const event = req.body;
    const eventName = event?.meta?.event_name;

    if (eventName === 'subscription_created' || eventName === 'subscription_updated') {
      const attrs = event?.data?.attributes;
      const email = attrs?.user_email;
      const status = attrs?.status === 'active' ? 'active' : 'inactive';
      const customerId = String(event?.data?.id || '');
      const subscriptionId = String(attrs?.first_subscription_item?.subscription_id || event?.data?.id || '');
      const userId = event?.meta?.custom_data?.user_id;

      if (!email) return res.status(400).json({ error: 'No email' });

      const SUPA_URL = 'https://tzmbybwytfpaqaajwumz.supabase.co';
      const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

      // Check if subscription exists for this email
      const checkRes = await fetch(`${SUPA_URL}/rest/v1/subscriptions?email=eq.${encodeURIComponent(email)}`, {
        headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
      });
      const existing = await checkRes.json();

      if (existing && existing.length > 0) {
        // Update
        await fetch(`${SUPA_URL}/rest/v1/subscriptions?email=eq.${encodeURIComponent(email)}`, {
          method: 'PATCH',
          headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ status, lemon_customer_id: customerId, lemon_subscription_id: subscriptionId, updated_at: new Date().toISOString(), ...(userId ? { user_id: userId } : {}) })
        });
      } else {
        // Insert
        await fetch(`${SUPA_URL}/rest/v1/subscriptions`, {
          method: 'POST',
          headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ email, status, lemon_customer_id: customerId, lemon_subscription_id: subscriptionId, ...(userId ? { user_id: userId } : {}) })
        });
      }

      return res.status(200).json({ ok: true });
    }

    if (eventName === 'subscription_cancelled' || eventName === 'subscription_expired') {
      const email = event?.data?.attributes?.user_email;
      if (email) {
        const SUPA_URL = 'https://tzmbybwytfpaqaajwumz.supabase.co';
        const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
        await fetch(`${SUPA_URL}/rest/v1/subscriptions?email=eq.${encodeURIComponent(email)}`, {
          method: 'PATCH',
          headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ status: 'inactive', updated_at: new Date().toISOString() })
        });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true, ignored: eventName });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
