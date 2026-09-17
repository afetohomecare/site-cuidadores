import { ehAdmin } from '../../_lib/auth.js';

// ============================================================
// AFETO — API Admin: números do dashboard
// ⭐ SEGURANÇA: só aceita user com role === 'admin'
// ============================================================

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

async function validarToken(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return false;

  const resp = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + token
    }
  });
  if (!resp.ok) return false;

  const user = await resp.json();

  if (!ehAdmin(user)) return false;

  return true;
}

function headersSupabase(env) {
  return {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Accept': 'application/json'
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!(await validarToken(env, request))) {
    return jsonResp({ error: 'Não autorizado' }, 401);
  }

  try {
    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?select=id,aprovada,status_pagamento,plano_profissional,plano_destaque,plano_valido_ate,bairro,criado_em,cupom_usado',
      { headers: headersSupabase(env) }
    );

    if (!resp.ok) return jsonResp({ error: 'Falha ao buscar dados' }, 502);
    const cuidadores = await resp.json();

    const agora = new Date();
    const em7dias = new Date(agora);
    em7dias.setDate(em7dias.getDate() + 7);

    let total = cuidadores.length;
    let pendentes = 0;
    let aprovadas = 0;
    let pagas = 0;
    let vencidas = 0;
    let vencendoEm7Dias = 0;
    let novasUltimos7Dias = 0;

    const contagemBairros = {};
    const contagemCupons = {};

    cuidadores.forEach(function(c) {
      const criadoEm = new Date(c.criado_em);

      if (c.aprovada === true) aprovadas++;
      else pendentes++;

      if (c.status_pagamento === 'Pago') pagas++;

      if (c.plano_valido_ate) {
        const vence = new Date(c.plano_valido_ate);
        if (vence < agora && (c.plano_profissional || c.plano_destaque)) vencidas++;
        else if (vence >= agora && vence <= em7dias) vencendoEm7Dias++;
      }

      const diffDias = (agora - criadoEm) / (1000 * 60 * 60 * 24);
      if (diffDias <= 7) novasUltimos7Dias++;

      if (c.bairro) contagemBairros[c.bairro] = (contagemBairros[c.bairro] || 0) + 1;
      if (c.cupom_usado) contagemCupons[c.cupom_usado] = (contagemCupons[c.cupom_usado] || 0) + 1;
    });

    const topBairros = Object.keys(contagemBairros)
      .map(function(k) { return { bairro: k, total: contagemBairros[k] }; })
      .sort(function(a, b) { return b.total - a.total; })
      .slice(0, 5);

    const topCupons = Object.keys(contagemCupons)
      .map(function(k) { return { cupom: k, total: contagemCupons[k] }; })
      .sort(function(a, b) { return b.total - a.total; })
      .slice(0, 5);

    const comPlanoPago = cuidadores.filter(function(c) {
      return c.plano_profissional || c.plano_destaque;
    }).length;
    const taxaConversao = comPlanoPago > 0
      ? Math.round((pagas / comPlanoPago) * 100)
      : 0;

    return jsonResp({
      ok: true,
      numeros: {
        total: total,
        aprovadas: aprovadas,
        pendentes: pendentes,
        pagas: pagas,
        vencidas: vencidas,
        vencendoEm7Dias: vencendoEm7Dias,
        novasUltimos7Dias: novasUltimos7Dias,
        taxaConversao: taxaConversao
      },
      topBairros: topBairros,
      topCupons: topCupons
    }, 200);

  } catch (err) {
    console.error('Erro stats:', err);
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}