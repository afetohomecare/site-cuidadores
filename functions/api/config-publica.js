// ============================================================
// AFETO — API pública: preços para o site
// ------------------------------------------------------------
// Sem auth. Devolve apenas preços que aparecem na vitrine.
// Cache curto (10s) para o site refletir o painel admin rápido.
//
// Devolve preços da vitrine:
//   • preco_cadastro = Essencial anual no Pix
//   • preco_cadastro_cartao = Essencial anual no cartão (até 12x)
//   • preco_profissional / preco_destaque = oferta mensal no Pix
//   • preco_prof_pos / preco_destaque_pos = preço cheio riscado
//   • *_pos = preço cheio (riscado, "De R$ X por")
// ============================================================

const CHAVES_PUBLICAS = [
  'preco_cadastro',
  'preco_cadastro_cartao',
  'preco_profissional',
  'preco_destaque',
  'preco_cadastro_pos',
  'preco_cadastro_cartao_pos',
  'preco_prof_pos',
  'preco_destaque_pos'
];

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

    return new Response(JSON.stringify({
      ok: true,
      precos: precos,
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || null
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=10, s-maxage=10'
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