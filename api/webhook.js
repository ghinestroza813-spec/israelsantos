// Recebe o aviso do Mercado Pago quando um pagamento muda de status.
// Sempre responde 200 para o Mercado Pago não ficar reenviando.
// Se RESEND_API_KEY e NOTIFY_EMAIL estiverem configurados, envia um e-mail a cada pagamento aprovado.
module.exports = async (req, res) => {
  try {
    const token = process.env.MP_ACCESS_TOKEN;
    const q = req.query || {};
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const type = body.type || q.type || q.topic;
    const id = (body.data && body.data.id) || q['data.id'] || q.id;
    if (token && id && String(type).includes('payment')) {
      const r = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(id), {
        headers: { Authorization: 'Bearer ' + token },
      });
      const p = await r.json();
      console.log('Pagamento', id, p.status, p.external_reference, p.transaction_amount);
      if (p.status === 'approved' && process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL) {
        const m = p.metadata || {};
        const text = [
          'Pagamento aprovado',
          'Pedido: ' + p.external_reference,
          'Valor: R$ ' + Number(p.transaction_amount).toFixed(2).replace('.', ','),
          'Forma: ' + (p.payment_type_id || '') + ' ' + (p.installments > 1 ? p.installments + 'x' : ''),
          'Cliente: ' + (m.cliente || '') + ' | ' + ((p.payer && p.payer.email) || '') + ' | ' + (m.telefone || ''),
          'Envio: ' + (m.envio === 'exp' ? 'Expresso' : 'Econômico'),
          'Endereço: ' + (m.endereco || ''),
          'Itens: ' + ((p.additional_info && p.additional_info.items) || []).map((i) => i.quantity + 'x ' + i.title).join('; '),
        ].join('\n');
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: process.env.MAIL_FROM || 'Thaishop <onboarding@resend.dev>',
            to: [process.env.NOTIFY_EMAIL],
            subject: 'Pedido pago ' + p.external_reference,
            text,
          }),
        });
      }
    }
  } catch (e) {
    console.error('webhook', e);
  }
  res.status(200).json({ ok: true });
};
