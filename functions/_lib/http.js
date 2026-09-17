// Respostas JSON padrão das APIs da Afeto.

export function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export function metodoNaoPermitido() {
  return jsonResp({ error: 'Método não permitido' }, 405);
}
