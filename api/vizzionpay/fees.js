// Taxas cobradas do comprador pela Cakto (ex.: "Taxa de serviço" de R$ 0,99).
// O site usa este valor para mostrar o total real antes de gerar o PIX.
const CAKTO_CLIENT_ID = process.env.CAKTO_CLIENT_ID || '';
const CAKTO_CLIENT_SECRET = process.env.CAKTO_CLIENT_SECRET || '';
const CAKTO_OFFER_ID = (process.env.CAKTO_OFFER_ID || '').trim();
const CAKTO_CONFIGURADO = Boolean(CAKTO_CLIENT_ID && CAKTO_CLIENT_SECRET && CAKTO_OFFER_ID);

function montarMotivoCakto(detalhe) {
  if (typeof detalhe === 'string') return detalhe;
  if (!detalhe || typeof detalhe !== 'object') return '';
  if (typeof detalhe.detail === 'string') return detalhe.detail;
  const partes = [];
  for (const campo of Object.keys(detalhe)) {
    const valor = detalhe[campo];
    const texto = Array.isArray(valor) ? valor.join(' ')
      : (valor && typeof valor === 'object' ? JSON.stringify(valor) : String(valor));
    partes.push(campo + ': ' + texto);
  }
  return partes.join(' | ');
}

let caktoToken = null;
let caktoTokenExpiraEm = 0;

async function obterTokenCakto() {
  if (caktoToken && Date.now() < caktoTokenExpiraEm) return caktoToken;

  const resposta = await fetch('https://api.cakto.com.br/public_api/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CAKTO_CLIENT_ID,
      client_secret: CAKTO_CLIENT_SECRET
    }).toString()
  });

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok || !dados.access_token) {
    const erro = new Error(montarMotivoCakto(dados) || 'Falha ao autenticar na Cakto.');
    erro.status = resposta.status === 401 ? 401 : 502;
    throw erro;
  }

  caktoToken = dados.access_token;
  caktoTokenExpiraEm = Date.now() + (Math.max(60, (Number(dados.expires_in) || 3600) - 300) * 1000);
  return caktoToken;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });

  if (!CAKTO_CONFIGURADO) {
    return res.status(200).json({ serviceFee: 0, customerFees: [] });
  }

  try {
    const token = await obterTokenCakto();
    const resposta = await fetch('https://api.cakto.com.br/public_api/fees/', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const dados = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      return res.status(resposta.status >= 400 && resposta.status < 500 ? resposta.status : 502)
        .json({ error: montarMotivoCakto(dados) || 'Não foi possível consultar as taxas da Cakto.', provider: 'cakto' });
    }

    const lista = Array.isArray(dados.customerFees) ? dados.customerFees : [];
    const serviceFee = Math.round(lista.reduce((soma, taxa) => soma + (Number(taxa.amount) || 0), 0) * 100) / 100;

    return res.status(200).json({ serviceFee, customerFees: lista });
  } catch (error) {
    console.error('Cakto fees error:', error instanceof Error ? error.message : 'unknown');
    const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 502;
    return res.status(status).json({ error: error.message, provider: 'cakto' });
  }
}
