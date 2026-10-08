// -----------------------------------------------------------------
// LEITURA DA RESPOSTA DO GATEWAY (formatos aceitos)
// -----------------------------------------------------------------
function eCodigoPix(valor) {
  return typeof valor === 'string' && (valor.startsWith('000201') || valor.includes('br.gov.bcb.pix'));
}

function normalizarImagemPix(valor) {
  if (typeof valor !== 'string' || !valor) return null;
  if (valor.startsWith('data:')) return valor;
  if (valor.startsWith('http')) return valor;
  return 'data:image/png;base64,' + valor;
}

function normalizarRespostaGateway(data) {
  const resultado = { code: null, image: null, expiresAt: null, identifier: null, transactionId: null, status: null };
  const raizes = [data, data && data.data].filter(o => o && typeof o === 'object');

  for (const raiz of raizes) {
    resultado.identifier = resultado.identifier
      || raiz.identifier || raiz.clientIdentifier || raiz.externalId || raiz.reference || null;
    resultado.transactionId = resultado.transactionId
      || raiz.transactionId || raiz.transaction_id || raiz.chargeId || (typeof raiz.id === 'string' ? raiz.id : null) || null;
    resultado.status = resultado.status || raiz.status || raiz.transactionStatus || null;

    const pix = raiz.pix && typeof raiz.pix === 'object' ? raiz.pix : null;
    const candidatos = pix
      ? [pix.code, pix.copy_paste, pix.copiaECola, pix.qr_code, pix.qrCode, pix.payload, pix.text, pix.pix_code]
      : [raiz.qr_code, raiz.copy_paste, raiz.copiaECola, raiz.pixCode, raiz.payload];

    if (!resultado.code) {
      for (const candidato of candidatos) {
        if (eCodigoPix(candidato)) { resultado.code = candidato; break; }
      }
    }
    if (!resultado.image) {
      const imagem = (pix && (pix.image || pix.qr_code_base64 || pix.base64 || pix.imageBase64))
        || raiz.qr_code_base64 || raiz.image || raiz.qrCodeImage || null;
      resultado.image = normalizarImagemPix(imagem);
    }
    if (!resultado.expiresAt) {
      resultado.expiresAt = (pix && (pix.expiresAt || pix.expires_at)) || raiz.expiresAt || raiz.expires_at || null;
    }
    if (resultado.code) break;
  }

  return resultado;
}

// -----------------------------------------------------------------
// CAKTO: PROVEDOR PREFERENCIAL DE PAGAMENTO
// -----------------------------------------------------------------
const CAKTO_CLIENT_ID = process.env.CAKTO_CLIENT_ID || '';
const CAKTO_CLIENT_SECRET = process.env.CAKTO_CLIENT_SECRET || '';
const CAKTO_OFFER_ID = (process.env.CAKTO_OFFER_ID || '').trim();
const CAKTO_PIX_EXPIRES_IN = Number(process.env.CAKTO_PIX_EXPIRES_IN) >= 60
  ? Number(process.env.CAKTO_PIX_EXPIRES_IN)
  : 900;
// Mapa de preços: CAKTO_OFFERS=97:8kbynaf,98:6o5u8xe,...
const CAKTO_OFFERS = String(process.env.CAKTO_OFFERS || '')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean)
  .map(item => {
    const [valor, id] = item.split(':');
    return { valor: Number(valor), id: String(id || '').trim() };
  })
  .filter(item => item.id && Number.isFinite(item.valor));
const CAKTO_CONFIGURADO = Boolean(CAKTO_CLIENT_ID && CAKTO_CLIENT_SECRET && (CAKTO_OFFER_ID || CAKTO_OFFERS.length));

// A Cakto cobra sempre o preço da oferta, então escolhe a mais próxima do valor da tela.
function escolherOfertaCakto(valor) {
  if (!CAKTO_OFFERS.length) return CAKTO_OFFER_ID;
  const alvo = Number(valor);
  if (!Number.isFinite(alvo)) return CAKTO_OFFERS[0].id;
  let melhor = CAKTO_OFFERS[0];
  for (const opcao of CAKTO_OFFERS) {
    if (Math.abs(opcao.valor - alvo) < Math.abs(melhor.valor - alvo)) melhor = opcao;
  }
  return melhor.id;
}

let caktoToken = null;
let caktoTokenExpiraEm = 0;

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

function montarErroCakto(status, detalhe) {
  const motivo = montarMotivoCakto(detalhe);
  if (status === 401) {
    return 'Credenciais da Cakto inválidas. Confira CAKTO_CLIENT_ID e CAKTO_CLIENT_SECRET nas variáveis de ambiente.';
  }
  if (status === 403) {
    return 'A chave da API Cakto não tem permissão para criar cobranças. No painel Cakto, em Integrações > Cakto API, ative os escopos '
      + 'read, write, payments e orders. Confirme também se sua conta Cakto Banking está ativa, principal do produtor e com abertura concluída.'
      + (motivo ? ' (' + motivo + ')' : '');
  }
  if (status === 400) {
    return 'A Cakto recusou os dados da cobrança' + (motivo ? ': ' + motivo : '.');
  }
  return motivo || 'Não foi possível criar a cobrança na Cakto. (HTTP ' + status + ')';
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

function montarTelefoneCakto(telefone) {
  const digitos = String(telefone || '').replace(/\D/g, '');
  if (digitos.length >= 10 && digitos.length <= 11) return '55' + digitos;
  return digitos || '';
}

async function criarPixCakto(entrada) {
  const token = await obterTokenCakto();
  const documento = String(entrada.document || '').replace(/\D/g, '');

  const corpo = {
    paymentMethod: 'pix',
    customer: {
      name: entrada.name,
      email: entrada.email,
      phone: montarTelefoneCakto(entrada.phone),
      fingerprint: 'fp-' + entrada.identifier
    },
    items: [{ offerId: escolherOfertaCakto(entrada.amount), quantity: 1, offerType: 'main' }],
    pixExpiresIn: CAKTO_PIX_EXPIRES_IN,
    metadata: { sck: entrada.identifier }
  };

  if (documento.length === 11) {
    corpo.customer.docType = 'cpf';
    corpo.customer.docNumber = documento;
  } else if (documento.length === 14) {
    corpo.customer.docType = 'cnpj';
    corpo.customer.docNumber = documento;
  }

  // Endereço só vai pra Cakto se vier completo: a API exige cidade, UF e CEP.
  // O formulário atual coleta apenas rua e número, então nesse caso não enviamos.
  const endereco = entrada.address && typeof entrada.address === 'object' ? entrada.address : null;
  if (endereco && endereco.street && endereco.city && endereco.state && endereco.zipcode) {
    corpo.address = {
      country: 'BR',
      street: String(endereco.street).slice(0, 255),
      number: String(endereco.number || '').slice(0, 32),
      neighborhood: String(endereco.neighborhood || '').slice(0, 255),
      city: String(endereco.city).slice(0, 255),
      state: String(endereco.state).slice(0, 64),
      zipcode: String(endereco.zipcode).slice(0, 16)
    };
  }

  const resposta = await fetch('https://api.cakto.com.br/public_api/payments/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      'X-Idempotency-Key': entrada.identifier
    },
    body: JSON.stringify(corpo)
  });

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    console.error('Falha na Cakto:', resposta.status, dados);
    const erro = new Error(montarErroCakto(resposta.status, dados));
    erro.status = resposta.status >= 400 && resposta.status < 500 ? resposta.status : 502;
    throw erro;
  }

  console.log('Cakto resposta PIX:', JSON.stringify(dados).slice(0, 800));

  const pix = dados.pix && typeof dados.pix === 'object' ? dados.pix : {};
  const codigo = pix.qrCode || pix.copy_paste || pix.code || dados.qrCode || null;

  if (!codigo) {
    const erro = new Error('A Cakto criou o pedido, mas não devolveu o código PIX. Resposta: ' + JSON.stringify(dados).slice(0, 300));
    erro.status = 502;
    throw erro;
  }

  const precoProduto = Number(dados.baseAmount);
  const totalCobrado = Number(dados.amount);
  const taxaServico = Number.isFinite(precoProduto) && Number.isFinite(totalCobrado)
    ? Math.round((totalCobrado - precoProduto) * 100) / 100
    : 0;

  return {
    provider: 'cakto',
    identifier: dados.id || entrada.identifier,
    transactionId: dados.id || null,
    refId: dados.refId || null,
    status: dados.status || 'waiting_payment',
    transactionStatus: dados.status === 'paid' ? 'PAID' : 'PENDING',
    baseAmount: Number.isFinite(precoProduto) ? precoProduto : (Number(entrada.amount) || null),
    serviceFee: taxaServico,
    total: Number.isFinite(totalCobrado) ? totalCobrado : null,
    pix: {
      code: codigo,
      image: 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(codigo),
      expiresAt: pix.expirationDate || pix.expiresAt || pix.expiration_date || null
    }
  };
}

export default async function handler(req, res) {
  // Configuração CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-public-key, x-secret-key'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  // A VizzionPay bloqueia (403) callbackUrl local (localhost/127.0.0.1)
  // ou não-HTTPS. Só enviamos a URL de notificação quando ela for pública.
  function montarCallbackUrl(host, protocolo) {
    const hostCompleto = String(host || '').trim();
    if (!hostCompleto) return null;
    const hostname = hostCompleto.split(':')[0].toLowerCase();
    const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1';
    if (local) return null;
    if (String(protocolo || '').toLowerCase() !== 'https') return null;
    return `https://${hostCompleto}/api/vizzionpay/callback`;
  }

  function montarErroGateway(status, data) {
    const codigo = (data && data.errorCode) || '';
    const detalhe = data && typeof data.details === 'string'
      ? data.details
      : (data && data.details && typeof data.details.error === 'string' ? data.details.error : '');
    const base = (data && data.message) || 'Não foi possível criar o PIX no gateway.';

    if (codigo === 'GATEWAY_INVALID_CREDENTIALS') {
      return 'Credenciais da VizzionPay inválidas. Confira VIZZIONPAY_PUBLIC_KEY e VIZZIONPAY_SECRET_KEY nas variáveis de ambiente.';
    }
    if (codigo === 'FORBIDDEN' || /n[aã]o est[áa] ativo/i.test(detalhe)) {
      return 'Sua conta VizzionPay ainda não está ativa para vender. Ative o cadastro no painel da VizzionPay e tente novamente. (' + (detalhe || base) + ')';
    }
    if (codigo === 'GATEWAY_INVALID_DATA' && data && Array.isArray(data.details)) {
      return 'Dados enviados ao gateway recusados: ' + data.details.map(d => d.path ? d.path.join('.') + ': ' + d.message : d.message).join('; ');
    }
    if (detalhe) return base + ' - ' + detalhe;
    if (data && data.message) return base;
    return base + ' (HTTP ' + status + ')';
  }

  const publicKey = process.env.VIZZIONPAY_PUBLIC_KEY;
  const secretKey = process.env.VIZZIONPAY_SECRET_KEY;

  if (!CAKTO_CONFIGURADO && (!publicKey || !secretKey)) {
    return res.status(503).json({
      error: 'Nenhum gateway de pagamento configurado. Configure CAKTO_CLIENT_ID, CAKTO_CLIENT_SECRET e CAKTO_OFFER_ID ou VIZZIONPAY_PUBLIC_KEY e VIZZIONPAY_SECRET_KEY.'
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const amount = Number(body.amount);
    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim();
    const document = String(body.document || '').replace(/\D/g, '');
    let email = String(body.email || '').trim();

    // Fallback de email caso o formulário não envie
    if (!email || !email.includes('@')) {
      const docClean = document || 'cliente';
      email = `cliente_${docClean}@pagamento.com`;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Valor do pedido inválido.' });
    }
    if (name.length < 3 || phone.length < 8) {
      return res.status(400).json({ error: 'Dados do cliente incompletos.' });
    }

    const identifier = 'gas-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

    // Provedor Cakto (preferencial quando configurado nas variáveis de ambiente)
    if (CAKTO_CONFIGURADO) {
      try {
        const cobranca = await criarPixCakto({
          identifier,
          amount,
          name,
          email,
          phone,
          document,
          address: body.address
        });
        return res.status(200).json(cobranca);
      } catch (err) {
        console.error('Erro ao criar PIX na Cakto:', err.message);
        const status = err.status || 502;
        return res.status(status >= 400 && status < 500 ? status : 502).json({ error: err.message, provider: 'cakto' });
      }
    }

    const host = String(req.headers.host || '').trim();
    const protocolo = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'https';
    const callbackUrl = montarCallbackUrl(host, protocolo);

    const payload = {
      identifier,
      amount: Number(amount.toFixed(2)),
      client: {
        name,
        email,
        phone
      },
      products: Array.isArray(body.products) && body.products.length > 0 ? body.products.slice(0, 50) : [{
        id: 'gas-delivery',
        name: 'Gás de cozinha',
        quantity: 1,
        price: Number(amount.toFixed(2)),
        physical: true
      }],
      metadata: {
        provider: 'Gás do Povo',
        orderId: identifier
      }
    };

    if (document.length === 11 || document.length === 14) {
      payload.client.document = document;
    }
    if (callbackUrl) payload.callbackUrl = callbackUrl;

    const response = await fetch('https://app.vizzionpay.com.br/api/v1/gateway/pix/receive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-public-key': publicKey,
        'x-secret-key': secretKey
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('VizzionPay create PIX failed:', response.status, data);
      const msgErro = montarErroGateway(response.status, data);
      return res.status(response.status >= 400 && response.status < 500 ? response.status : 502)
        .json({ error: msgErro, gatewayStatus: response.status, gatewayCode: data.errorCode || null });
    }

    console.log('VizzionPay resposta PIX:', JSON.stringify(data).slice(0, 800));
    const pix = normalizarRespostaGateway(data);

    if (!pix.code) {
      return res.status(502).json({
        error: 'O gateway VizzionPay aceitou a cobrança, mas não devolveu o código PIX. Resposta: ' + JSON.stringify(data).slice(0, 300),
        gatewayStatus: response.status,
        gatewayCode: data.errorCode || null
      });
    }

    return res.status(200).json({
      identifier,
      transactionId: pix.transactionId,
      status: pix.status || 'PENDING',
      transactionStatus: pix.status || 'PENDING',
      pix: {
        code: pix.code,
        image: pix.image || null,
        expiresAt: pix.expiresAt || null
      }
    });
  } catch (error) {
    console.error('Create PIX error:', error instanceof Error ? error.message : 'unknown');
    if (error && error.status && error.message) {
      return res.status(error.status).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Erro interno ao criar o pagamento.' });
  }
}
