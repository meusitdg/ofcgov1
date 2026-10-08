// Adapta handlers estilo Vercel (req, res) ao formato das Netlify Functions.
function montarReq(event) {
  const url = new URL(event.rawUrl || event.url || 'https://example.com' + (event.path || '/'));

  const query = {};
  const consulta = event.queryStringParameters || {};
  for (const chave of Object.keys(consulta)) {
    if (consulta[chave] !== undefined && consulta[chave] !== null) query[chave] = consulta[chave];
  }
  url.searchParams.forEach((valor, chave) => {
    if (!(chave in query)) query[chave] = valor;
  });

  const headers = {};
  for (const chave of Object.keys(event.headers || {})) {
    headers[String(chave).toLowerCase()] = event.headers[chave];
  }
  if (!headers.host) headers.host = url.host;
  if (!headers['x-forwarded-proto']) headers['x-forwarded-proto'] = 'https';

  let body = event.body || '';
  if (event.isBase64Encoded && body) {
    body = Buffer.from(body, 'base64').toString('utf8');
  }

  const contentType = String(headers['content-type'] || '');
  if (typeof body === 'string' && body.trim()) {
    const pareceJson = /application\/json/i.test(contentType) || (!contentType && body.trim().charAt(0) === '{');
    if (pareceJson) {
      try { body = JSON.parse(body); } catch (e) { /* mantém como texto */ }
    }
  }

  return { method: event.httpMethod || 'GET', headers, query, body };
}

function montarRes() {
  const headers = {};
  let statusCode = 200;
  let corpo = '';

  const res = {
    setHeader(nome, valor) { headers[nome] = String(valor); return res; },
    getHeader(nome) { return headers[nome]; },
    removeHeader(nome) { delete headers[nome]; },
    status(codigo) { statusCode = codigo; return res; },
    json(objeto) {
      corpo = JSON.stringify(objeto);
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json; charset=utf-8';
      return res;
    },
    end(texto) {
      if (texto !== undefined && texto !== null) corpo = String(texto);
      return res;
    },
    write() { return true; },
    writeHead(codigo, cabecalhos) {
      statusCode = codigo;
      if (cabecalhos) {
        for (const chave of Object.keys(cabecalhos)) headers[chave] = String(cabecalhos[chave]);
      }
      return res;
    },
    resultado() {
      return { statusCode, headers, body: corpo, isBase64Encoded: false };
    }
  };

  return res;
}

async function executar(event, handler) {
  const req = montarReq(event);
  const res = montarRes();
  await handler(req, res);
  return res.resultado();
}

function carregarHandler(modulo) {
  return typeof modulo === 'function' ? modulo : (modulo && modulo.default);
}

module.exports = { executar, carregarHandler };
