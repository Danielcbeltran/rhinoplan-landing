// api/checkout.js — Crea una checkout session de Creem vinculada al usuario (rhinoplan-landing)
// La app llama a este endpoint con el token de Supabase del usuario;
// aquí se valida el token, se crea el checkout con metadata.user_id
// y se devuelve la URL de pago.
//
// Variables de entorno requeridas en Vercel (rhinoplan-landing):
//   CREEM_API_KEY — Creem → Developers → API Keys
//
// Cambia TEST_MODE a false para producción.

const TEST_MODE = false;

const CREEM_API = TEST_MODE
  ? 'https://test-api.creem.io/v1/checkouts'
  : 'https://api.creem.io/v1/checkouts';

const PRODUCT_ID = TEST_MODE
  ? 'prod_2eCcODskMCdbcSKMVc5LXP' // producto de test
  : 'prod_77Edh860PtALnRskMGpnP'; // producto de producción

const SUPA_URL = 'https://tzmbybwytfpaqaajwumz.supabase.co';

// Orígenes permitidos para CORS (la app vive en otro dominio)
const ALLOWED_ORIGINS = [
  'https://app.rhinoplan.app',
  'https://rhinoplan.vercel.app',
  'https://rhinoplan.app',
  'https://www.rhinoplan.app',
];

function setCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1) Validar al usuario con su token de Supabase (no confiar en el body)
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing auth token' });

    const userRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        // La anon key es pública, está bien tenerla aquí.
        apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6bWJ5Ynd5dGZwYXFhYWp3dW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MTM2NDAsImV4cCI6MjA4ODI4OTY0MH0.6FqJRT7VaWp-k_tCV1a3PFiRmwXBUokXkvyBTZOVpcM',
      },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Invalid token' });
    const user = await userRes.json();
    if (!user?.id || !user?.email) {
      return res.status(401).json({ error: 'Invalid user' });
    }

    // 2) Crear checkout session en Creem con la identidad del usuario
    const checkoutRes = await fetch(CREEM_API, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.CREEM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        product_id: PRODUCT_ID,
        request_id: `${user.id}-${Date.now()}`, // idempotencia
        customer: { email: user.email },
        metadata: { user_id: user.id },
        success_url: 'https://app.rhinoplan.app/?upgrade=success',
      }),
    });

    const checkout = await checkoutRes.json();
    if (!checkoutRes.ok || !checkout?.checkout_url) {
      console.error('CHECKOUT ERROR:', JSON.stringify(checkout));
      return res.status(502).json({ error: 'Could not create checkout' });
    }

    return res.status(200).json({ url: checkout.checkout_url });
  } catch (e) {
    console.error('CHECKOUT ERROR:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
