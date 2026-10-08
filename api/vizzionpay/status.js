// -----------------------------------------------------------------
// CAKTO: CONSULTA DE PEDIDO (provedor preferencial)
// -----------------------------------------------------------------
const CAKTO_CLIENT_ID = process.env.CAKTO_CLIENT_ID || '';
const CAKTO_CLIENT_SECRET = process.env.CAKTO_CLIENT_SECRET || '';
const CAKTO_OFFER_ID = (process.env.CAKTO_OFFER_ID || '').trim();
const CAKTO_CONFIGURADO = Boolean(CAKTO_CLIENT_ID && CAKTO_CLIENT_SECRET && CAKTO_OFFER_ID);

let caktoToken = null;
let caktoTokenExpiraEm = 0;

function montarErroCakto(status, detalhe) {
  const motivo = typeof detalhe === 'string' ? detalhe : (detalhe && detalhe.detail) || '';
  if (status === 401) {
    return 'Credenciais da Cakto inválidas. Confira CAKTO_CLIENT_ID e CAKTO_CLIENT_SECRET nas variáveis de ambiente.';
  }
  if (status === 403) {
    return 'A chave da API Cakto não tem permissão para consultar pedidos. No painel Cakto, em Integrações > Cakto API, ative os escopos '
      + 'read, write, payments e orders.' + (motivo ? ' (' + motivo + ')' : '');
  }
  if (status === 404) {
    return 'Pedido não encontrado na Cakto.';
  }
  return motivo || 'Não foi possível consultar o pedido na Cakto. (HTTP ' + status + ')';
}

async function obterTokenCakto() {
  if (caktoToken && Date.now() < caktoTokenExpiraEm) {
    return caktoToken;
  }

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
    const erro = new Error(montarErroCakto(resposta.status, dados));
    erro.status = resposta.status === 401 ? 401 : 502;
    throw erro;
  }

  caktoToken = dados.access_token;
  caktoTokenExpiraEm = Date.now() + (Math.max(60, (Number(dados.expires_in) || 3600) - 300) * 1000);
  return caktoToken;
}

async function consultarStatusCakto(identifier) {
  const token = await obterTokenCakto();
  const resposta = await fetch('https://api.cakto.com.br/public_api/orders/' + encodeURIComponent(identifier) + '/', {
    headers: { Authorization: 'Bearer ' + token }
  });

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    const erro = new Error(montarErroCakto(resposta.status, dados));
    erro.status = resposta.status >= 400 && resposta.status < 500 ? resposta.status : 502;
    throw erro;
  }

  const status = dados.status || '';
  return {
    ...dados,
    status: status || 'waiting_payment',
    transactionStatus: status === 'paid' ? 'PAID' : String(status || 'PENDING').toUpperCase()
  };
}

export default async function handler(req, res) {
  // Configuração CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const publicKey = process.env.VIZZIONPAY_PUBLIC_KEY;
  const secretKey = process.env.VIZZIONPAY_SECRET_KEY;
  const identifier = String(req.query?.identifier || '').trim();

  if (!identifier || identifier.length > 120) {
    return res.status(400).json({ error: 'Identificador inválido.' });
  }

  if (!CAKTO_CONFIGURADO && (!publicKey || !secretKey)) {
    return res.status(503).json({ error: 'Nenhum gateway de pagamento configurado no servidor.' });
  }

  if (CAKTO_CONFIGURADO) {
    try {
      const pedido = await consultarStatusCakto(identifier);
      return res.status(200).json(pedido);
    } catch (error) {
      console.error('Cakto status error:', error instanceof Error ? error.message : 'unknown');
      const status = error.status || 502;
      return res.status(status >= 400 && status < 500 ? status : 502).json({ error: error.message, provider: 'cakto' });
    }
  }

  try {
    const url = new URL('https://app.vizzionpay.com.br/api/v1/gateway/transactions');
    url.searchParams.set('clientIdentifier', identifier);

    const response = await fetch(url, {
      headers: {
        'x-public-key': publicKey,
        'x-secret-key': secretKey
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('VizzionPay transaction query failed:', response.status, data);
      const detalhe = typeof data.details === 'string' ? data.details : (data.details && typeof data.details.error === 'string' ? data.details.error : '');
      const inativo = data.errorCode === 'FORBIDDEN' || /n[aã]o est[áa] ativo/i.test(detalhe);
      const msg = inativo
        ? 'Sua conta VizzionPay ainda não está ativa. Ative o cadastro no painel da VizzionPay. (' + (detalhe || data.message || '') + ')'
        : (detalhe ? `${data.message} - ${detalhe}` : (data.message || 'Não foi possível consultar o pagamento.'));
      return res.status(response.status >= 400 && response.status < 500 ? response.status : 502)
        .json({ error: msg, gatewayStatus: response.status, gatewayCode: data.errorCode || null });
    }

    const interno = data && typeof data.data === 'object' && data.data !== null ? data.data : null;
    return res.status(200).json(interno ? Object.assign({}, data, interno) : data);
  } catch (error) {
    console.error('VizzionPay status error:', error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ error: 'Erro interno ao consultar o pagamento.' });
  }
}
