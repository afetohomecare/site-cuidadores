import { jsonResp } from '../../_lib/http.js';
import { headersSupabase, supabaseOk, tabelaAusente, colunaAusente } from '../../_lib/supabase.js';
import { validarAdmin, idSeguro } from '../../_lib/auth.js';

function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || '—';
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await validarAdmin(env, request);
  if (!auth.ok) return jsonResp({ error: auth.motivo }, 401);
  if (!supabaseOk(env)) return jsonResp({ error: 'Configuração ausente.' }, 500);

  try {
    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/solicitacoes_atendimento?select=id,cuidador_id,nome_solicitante,whatsapp,email,bairro,necessidades,complemento,paciente_primeiro_nome,paciente_idade,paciente_sexo,info_paciente,periodos,encaminhar_outras,status,criado_em&order=criado_em.desc&limit=80',
      { headers: headersSupabase(env) }
    );
    if (!resp.ok) {
      const txt = await resp.text();
      console.error('Erro admin listar solicitações:', resp.status, txt);
      if (tabelaAusente(txt) || colunaAusente(txt)) {
        console.error('Admin: rode sql/solicitacoes_atendimento.sql no SQL Editor do Supabase.');
        return jsonResp({ ok: true, pedidos: [] }, 200);
      }
      return jsonResp({ error: 'Falha ao listar.' }, 502);
    }
    const linhas = await resp.json();
    const ids = {};
    (linhas || []).forEach(function (s) { if (s.cuidador_id) ids[s.cuidador_id] = true; });
    const nomes = {};
    const idList = Object.keys(ids);
    if (idList.length > 0) {
      const nResp = await fetch(
        env.SUPABASE_URL + '/rest/v1/cuidadores?id=in.(' + idList.join(',') + ')&select=id,nome',
        { headers: headersSupabase(env) }
      );
      if (nResp.ok) {
        const cs = await nResp.json();
        (cs || []).forEach(function (c) { nomes[c.id] = c.nome; });
      }
    }

    const pedidos = (linhas || []).map(function (s) {
      const n = String(s.whatsapp || '').replace(/\D/g, '');
      let wa = n;
      if (wa.length === 10 || wa.length === 11) wa = '55' + wa;
      return {
        id: s.id,
        cuidadorId: s.cuidador_id,
        perfilNome: nomes[s.cuidador_id] || '—',
        nomeSolicitante: s.nome_solicitante,
        nomeFamiliaCurto: primeiroNome(s.nome_solicitante),
        whatsapp: s.whatsapp,
        waUrl: wa ? ('https://wa.me/' + wa) : null,
        email: s.email,
        bairro: s.bairro,
        necessidades: s.necessidades || [],
        complemento: s.complemento,
        pacienteNome: s.paciente_primeiro_nome,
        pacienteIdade: s.paciente_idade,
        pacienteSexo: s.paciente_sexo,
        infoPaciente: s.info_paciente,
        periodos: s.periodos || [],
        encaminharOutras: !!s.encaminhar_outras,
        status: s.status,
        criadoEm: s.criado_em
      };
    });

    return jsonResp({ ok: true, pedidos: pedidos }, 200);
  } catch (err) {
    console.error('Erro admin solicitações:', err);
    return jsonResp({ error: 'Falha no processamento.' }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await validarAdmin(env, request);
  if (!auth.ok) return jsonResp({ error: auth.motivo }, 401);
  if (!supabaseOk(env)) return jsonResp({ error: 'Configuração ausente.' }, 500);

  try {
    const body = await request.json();
    const solicitacaoId = idSeguro(body.solicitacaoId);
    if (!solicitacaoId) return jsonResp({ error: 'Pedido inválido.' }, 400);

    const sResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/solicitacoes_atendimento?id=eq.' + encodeURIComponent(solicitacaoId) +
      '&select=id,cuidador_id,bairro,encaminhar_outras&limit=1',
      { headers: headersSupabase(env) }
    );
    if (!sResp.ok) return jsonResp({ error: 'Falha ao ler o pedido.' }, 502);
    const sl = await sResp.json();
    const s = sl && sl[0];
    if (!s) return jsonResp({ error: 'Pedido não encontrado.' }, 404);
    if (!s.encaminhar_outras) {
      return jsonResp({ error: 'A família não autorizou o encaminhamento.' }, 403);
    }

    const bairro = s.bairro;
    const hoje = new Date().toISOString();
    const filtroBairro = 'or=(bairro.eq.' + encodeURIComponent(bairro) +
      ',bairros.cs.' + encodeURIComponent('{"' + bairro + '"}') + ')';
    const cResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?' + filtroBairro +
      '&aprovada=eq.true&status_pagamento=eq.Pago&plano_valido_ate=gte.' + hoje +
      '&id=neq.' + encodeURIComponent(s.cuidador_id) +
      '&select=id,nome,bairros,bairro&limit=40',
      { headers: headersSupabase(env) }
    );
    if (!cResp.ok) {
      console.error('Erro buscar por bairro:', await cResp.text());
      return jsonResp({ error: 'Falha ao buscar profissionais do bairro.' }, 502);
    }
    const candidatas = await cResp.json();
    let enviadas = 0;
    for (let i = 0; i < (candidatas || []).length; i++) {
      const c = candidatas[i];
      const vis = await fetch(env.SUPABASE_URL + '/rest/v1/solicitacoes_visiveis', {
        method: 'POST',
        headers: headersSupabase(env, true, false),
        body: JSON.stringify({
          solicitacao_id: solicitacaoId,
          cuidador_id: c.id,
          via: 'encaminhamento'
        })
      });
      if (vis.ok || vis.status === 409) enviadas++;
    }

    await fetch(
      env.SUPABASE_URL + '/rest/v1/solicitacoes_atendimento?id=eq.' + encodeURIComponent(solicitacaoId),
      {
        method: 'PATCH',
        headers: headersSupabase(env, true, false),
        body: JSON.stringify({ status: 'encaminhada' })
      }
    );

    return jsonResp({
      ok: true,
      enviadas: enviadas,
      mensagem: enviadas
        ? 'Pedido enviado para ' + enviadas + ' profissional(is) que atuam em ' + bairro + '.'
        : 'Nenhuma outra profissional encontrada nesse bairro agora.'
    }, 200);
  } catch (err) {
    console.error('Erro encaminhar:', err);
    return jsonResp({ error: 'Falha no processamento.' }, 500);
  }
}
