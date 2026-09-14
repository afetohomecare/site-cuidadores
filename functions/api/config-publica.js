// ============================================================
// AFETO — API pública: preços para o site
// ------------------------------------------------------------
// Sem auth. Devolve apenas preços que aparecem na vitrine.
// Cache curto (30s) para não sobrecarregar o Supabase.
// ============================================================

const CHAVES_PUBLICAS = ['preco_cadastro', 'preco_profissional', 'preco_destaque'];

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração ausente' }, 500);
  }

  try {
    const listaChaves = CHAVES_PUBLICAS.map(function(c) { return '"' + c + '"'; }).join(',');
    const url = env.SUPABASE_URL + '/rest/v1/config?chave=in.(' + listaChaves + ')&select=chave,valor';

    const resp = await fetch(url, {
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
        'Accept': 'application/json'
      }
    });

    if (!resp.ok) {
      console.error('Erro ao ler config pública:', resp.status);
      return jsonResp({ error: 'Falha ao ler config' }, 502);
    }

    const linhas = await resp.json();
    const precos = {};

    linhas.forEach(function(l) {
      const v = parseFloat(l.valor);
      if (!isNaN(v)) precos[l.chave] = v;
    });

    return new Response(JSON.stringify({ ok: true, precos: precos }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=30, s-maxage=30'
      }
    });

  } catch (err) {
    console.error('Erro config-publica:', err);
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}