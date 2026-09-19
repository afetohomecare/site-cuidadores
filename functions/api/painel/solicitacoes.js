import { jsonResp } from '../../_lib/http.js';
import { headersSupabase, supabaseOk, tabelaAusente, colunaAusente } from '../../_lib/supabase.js';
import { validarCuidadora } from '../../_lib/auth.js';

function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || '—';
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!supabaseOk(env)) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }

  const cuidadora = await validarCuidadora(env, request, 'id');
  if (!cuidadora) {
    return jsonResp({ error: 'Não autenticado.' }, 401);
  }

  try {
    const visResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/solicitacoes_visiveis?cuidador_id=eq.' +
      encodeURIComponent(cuidadora.id) +
      '&select=solicitacao_id,via,criado_em&order=criado_em.desc',
      { headers: headersSupabase(env) }
    );
    if (!visResp.ok) {
      const visTxt = await visResp.text();
      console.error('Erro listar solicitacoes_visiveis:', visResp.status, visTxt);
      if (tabelaAusente(visTxt) || colunaAusente(visTxt)) {
        console.error('Painel: rode sql/solicitacoes_atendimento.sql no SQL Editor do Supabase.');
        return jsonResp({ ok: true, solicitacoes: [] }, 200);
      }
      return jsonResp({ error: 'Falha ao listar solicitações.' }, 502);
    }
    const visiveis = await visResp.json();
    if (!visiveis || visiveis.length === 0) {
      return jsonResp({ ok: true, solicitacoes: [] }, 200);
    }

    const ids = visiveis.map(function (v) { return v.solicitacao_id; }).filter(Boolean);
    const listaResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/solicitacoes_atendimento?id=in.(' +
      ids.map(function (id) { return encodeURIComponent(id); }).join(',') +
      ')&select=id,nome_solicitante,whatsapp,email,bairro,necessidades,complemento,paciente_primeiro_nome,paciente_idade,paciente_sexo,info_paciente,periodos,criado_em,status&order=criado_em.desc',
      { headers: headersSupabase(env) }
    );
    if (!listaResp.ok) {
      const listaTxt = await listaResp.text();
      console.error('Erro listar solicitacoes_atendimento:', listaResp.status, listaTxt);
      if (tabelaAusente(listaTxt) || colunaAusente(listaTxt)) {
        console.error('Painel: rode sql/solicitacoes_atendimento.sql no SQL Editor do Supabase.');
        return jsonResp({ ok: true, solicitacoes: [] }, 200);
      }
      return jsonResp({ error: 'Falha ao carregar pedidos.' }, 502);
    }
    const linhas = await listaResp.json();
    const viaPorId = {};
    visiveis.forEach(function (v) { viaPorId[v.solicitacao_id] = v.via; });

    const solicitacoes = (linhas || []).map(function (s) {
      const n = String(s.whatsapp || '').replace(/\D/g, '');
      let wa = n;
      if (wa.length === 10 || wa.length === 11) wa = '55' + wa;
      return {
        id: s.id,
        via: viaPorId[s.id] || 'perfil',
        nomeFamilia: primeiroNome(s.nome_solicitante),
        whatsapp: s.whatsapp,
        waUrl: wa ? ('https://wa.me/' + wa) : null,
        email: s.email || null,
        bairro: s.bairro,
        necessidades: s.necessidades || [],
        complemento: s.complemento,
        pacienteNome: s.paciente_primeiro_nome,
        pacienteIdade: s.paciente_idade,
        pacienteSexo: s.paciente_sexo,
        infoPaciente: s.info_paciente,
        periodos: Array.isArray(s.periodos) ? s.periodos : [],
        criadoEm: s.criado_em,
        status: s.status
      };
    });

    return jsonResp({ ok: true, solicitacoes: solicitacoes }, 200);
  } catch (err) {
    console.error('Erro painel solicitações:', err);
    return jsonResp({ error: 'Falha no processamento.' }, 500);
  }
}
