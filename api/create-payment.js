// Cria a cobrança no Mercado Pago (Checkout Pro). Os preços vêm de public/catalog.json,
// nunca do navegador, para ninguém conseguir alterar o valor do pedido.
const catalog = require('../public/catalog.json');

const money = (n) => Math.round(Number(n) * 100) / 100;
const clean = (s, max = 120) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'Pagamento ainda não configurado na loja.' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || !Array.isArray(b.items) || !b.items.length || b.items.length > 30) {
    return res.status(400).json({ error: 'Sacola inválida.' });
  }

  const items = [];
  let subtotal = 0;
  for (const it of b.items) {
    const p = catalog.products.find((x) => x.id === it.id);
    const qty = parseInt(it.qty, 10);
    if (!p || !(qty >= 1 && qty <= 20)) return res.status(400).json({ error: 'Produto indisponível na sacola.' });
    const size = clean(it.size, 20);
    items.push({
      id: p.id,
      title: clean(p.name + (size ? ' (' + size + ')' : ''), 200),
      quantity: qty,
      unit_price: money(p.price),
      currency_id: 'BRL',
    });
    subtotal += money(p.price) * qty;
  }

  const shipKey = b.shipKey === 'exp' ? 'exp' : 'eco';
  const shipPrice = money(shipKey === 'exp' ? catalog.settings.shipExp : catalog.settings.shipEco);
  items.push({
    id: 'frete-' + shipKey,
    title: shipKey === 'exp' ? 'Frete Expresso internacional (7 a 12 dias)' : 'Frete Econômico internacional (15 a 30 dias)',
    quantity: 1,
    unit_price: shipPrice,
    currency_id: 'BRL',
  });

  const c = b.contact || {};
  const a = b.address || {};
  const email = clean(c.email, 120);
  if (!/^\S+@\S+\.\S+$/.test(email) || clean(c.name).length < 3) {
    return res.status(400).json({ error: 'Confira nome e e-mail.' });
  }
  const digits = clean(c.phone, 30).replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  const number = 'IST-' + Date.now().toString(36).toUpperCase().slice(-6);
  const base = (process.env.SITE_URL || 'https://' + (req.headers['x-forwarded-host'] || req.headers.host)).replace(/\/$/, '');
  const total = money(subtotal + shipPrice);

  const pref = {
    items,
    payer: {
      name: clean(c.name),
      email,
      phone: { area_code: digits.slice(0, 2), number: digits.slice(2) },
      address: { zip_code: clean(a.cep, 9).replace(/\D/g, ''), street_name: clean(a.street), street_number: clean(a.num, 10) },
    },
    back_urls: {
      success: base + '/?retorno=sucesso&pedido=' + number,
      pending: base + '/?retorno=pendente&pedido=' + number,
      failure: base + '/?retorno=falha&pedido=' + number,
    },
    auto_return: 'approved',
    external_reference: number,
    notification_url: base + '/api/webhook',
    payment_methods: { installments: 12 },
    statement_descriptor: 'THAISHOP',
    metadata: {
      pedido: number,
      envio: shipKey,
      cliente: clean(c.name),
      telefone: digits,
      endereco: [a.street, a.num, a.comp, a.bairro, a.city + '/' + a.uf, 'CEP ' + a.cep].map((x) => clean(x, 80)).join(', '),
    },
  };

  try {
    const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(pref),
    });
    const j = await r.json();
    if (!r.ok || !j.init_point) {
      console.error('Mercado Pago recusou a preferência', r.status, JSON.stringify(j).slice(0, 500));
      return res.status(502).json({ error: 'Não foi possível iniciar o pagamento. Tente novamente ou peça pelo WhatsApp.' });
    }
    // Chave de teste (TEST-...) usa sandbox_init_point.
    const link = token.startsWith('TEST-') && j.sandbox_init_point ? j.sandbox_init_point : j.init_point;
    return res.status(200).json({ number, total, init_point: link });
  } catch (e) {
    console.error('Falha ao falar com o Mercado Pago', e);
    return res.status(502).json({ error: 'Mercado Pago indisponível no momento. Tente novamente.' });
  }
};
