// api/webhook.js — Creem → Supabase (rhinoplan-landing)
// Verifica la firma HMAC-SHA256 de Creem y activa/desactiva Pro.
// Vincula por metadata.user_id (preferido) con fallback a email.
//
// Variables de entorno requeridas en Vercel (rhinoplan-landing):
//   SUPABASE_SERVICE_KEY  — service_role key de Supabase
//   CREEM_WEBHOOK_SECRET  — Creem → Developers → Webhooks → tu webhook → Secret

import crypto from 'crypto';

// Desactivar el body parser de Vercel: necesitamos el body CRUDO
// para verificar la firma (si se parsea primero, la firma no coincide).
export const config = {
  api: { bodyParser: false },
};

const SUPA_URL = 'https://tzmbybwytfpaqaajwumz.supabase.co';

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const computed = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

async function supa(path, options = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1) Verificar firma ANTES de procesar nada
  const rawBody = await readRawBody(req);
  const signature = req.headers['creem-signature'];
  if (!verifySignature(rawBody, signature, process.env.CREEM_WEBHOOK_SECRET)) {
    console.error('WEBHOOK: invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  try {
    const eventType = event?.eventType || event?.type || event?.event_type || '';
    const obj = event?.object || event?.data || {};

    // Extraer datos comunes del payload de Creem
    const customer = obj?.customer || {};
    const subscription = obj?.subscription || obj || {};
    const metadata = obj?.metadata || subscription?.metadata || {};
    const email = (customer?.email || obj?.customer_email || '').toLowerCase();
    const userId = metadata?.user_id || null;
    const customerId = customer?.id || obj?.customer_id || '';
    const subscriptionId = subscription?.id || obj?.subscription_id || obj?.id || '';

    console.log('WEBHOOK event:', eventType, '| user_id:', userId, '| email:', email);

    const GRANT = ['checkout.completed', 'subscription.active', 'subscription.paid'];
    const REVOKE = ['subscription.canceled', 'subscription.expired'];

    if (!GRANT.includes(eventType) && !REVOKE.includes(eventType)) {
      console.log('WEBHOOK ignored event:', eventType);
      return res.status(200).json({ ok: true, ignored: eventType });
    }

    const newStatus = GRANT.includes(eventType) ? 'active' : 'inactive';

    // 2) Buscar la fila a actualizar: primero por user_id, luego por email
    let filter = null;
    if (userId) {
      const byUser = await supa(`subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=id`);
      if (byUser?.length) filter = `user_id=eq.${encodeURIComponent(userId)}`;
    }
    if (!filter && email) {
      const byEmail = await supa(`subscriptions?email=eq.${encodeURIComponent(email)}&select=id`);
      if (byEmail?.length) filter = `email=eq.${encodeURIComponent(email)}`;
    }

    const row = {
      status: newStatus,
      provider_customer_id: String(customerId || ''),
      provider_subscription_id: String(subscriptionId || ''),
      updated_at: new Date().toISOString(),
      ...(userId ? { user_id: userId } : {}),
      ...(email ? { email } : {}),
    };

    if (filter) {
      await supa(`subscriptions?${filter}`, {
        method: 'PATCH',
        body: JSON.stringify(row),
      });
      console.log('WEBHOOK updated:', newStatus, filter);
    } else if (newStatus === 'active') {
      if (!userId && !email) {
        console.error('WEBHOOK: grant event without user_id or email — cannot link');
        return res.status(200).json({ ok: false, error: 'No identity in payload' });
      }
      await supa('subscriptions', {
        method: 'POST',
        body: JSON.stringify(row),
      });
      console.log('WEBHOOK created:', email || userId);
    } else {
      // Revoke para alguien sin fila: nada que hacer
      console.log('WEBHOOK revoke with no matching row, skipping');
    }

    return res.status(200).json({ ok: true, action: newStatus });
  } catch (e) {
    console.error('WEBHOOK ERROR:', e.message);
    // 500 hace que Creem reintente (30s, 1m, 5m, 1h)
    return res.status(500).json({ error: e.message });
  }
}
