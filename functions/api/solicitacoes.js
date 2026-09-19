import { jsonResp } from '../_lib/http.js';
import {
  headersSupabase,
  supabaseOk,
  tabelaAusente,
  colunaAusente,
  nomeColunaAusente,
  erroPermissao,
  erroTipoDados
} from '../_lib/supabase.js';
import { ehUuid, filtroPerfilPorRef, refPerfilSegura } from '../_lib/slug.js';
import { HABILIDADES, BAIRROS, MIN_HORAS_DIA, MAX_PERIODOS, TEXTO_SUGESTAO_CUIDADOS } from '../_lib/catalogo.js';
import { verificarTurnstile, ipDoPedido, hashIp } from '../_lib/turnstile.js';

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || '';
}

function normalizarHora(valor) {
  const m = String(valor || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = m[1].length === 1 ? '0' + m[1] : m[1];
  return h + ':' + m[2];
}

function horasDoPeriodo(inicio, fim) {
  const a = String(inicio || '').split(':');
  const b = String(fim || '').split(':');
  if (a.length < 2 || b.length < 2) return 0;
  const minA = parseInt(a[0], 10) * 60 + parseInt(a[1], 10);
  const minB = parseInt(b[0], 10) * 60 + parseInt(b[1], 10);
  if (isNaN(minA) || isNaN(minB) || minB <= minA) return 0;
  return (minB - minA) / 60;
}

function hojeIsoSP() {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

function validarPeriodos(lista) {
  if (lista == null || lista === '') {
    return { ok: true, periodos: [] };
  }
  if (!Array.isArray(lista)) {
    return { ok: false, erro: 'Agenda inválida.' };
  }
  if (lista.length === 0) {
    return { ok: true, periodos: [] };
  }
  if (lista.length > MAX_PERIODOS) {
    return { ok: false, erro: 'Escolha no máximo ' + MAX_PERIODOS + ' períodos.' };
  }
  const hoje = hojeIsoSP();
  const vistos = {};
  const limpos = [];
  for (let i = 0; i < lista.length; i++) {
    const p = lista[i] || {};
    const data = String(p.data || '').trim();
    const inicio = normalizarHora(p.inicio);
    const fim = normalizarHora(p.fim);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return { ok: false, erro: 'Data inválida na agenda.' };
    }
    if (!inicio || !fim) {
      return { ok: false, erro: 'Horário inválido na agenda.' };
    }
    if (data < hoje) {
      return { ok: false, erro: 'Não é possível pedir datas que já passaram.' };
    }
    const horas = horasDoPeriodo(inicio, fim);
    if (horas < MIN_HORAS_DIA) {
      return { ok: false, erro: 'O período mínimo é de ' + MIN_HORAS_DIA + ' horas por dia.' };
    }
    if (vistos[data + inicio + fim]) continue;
    vistos[data + inicio + fim] = true;
    limpos.push({ data: data, inicio: inicio, fim: fim });
  }
  return { ok: true, periodos: limpos };
}

const MSG_NAO_CONFIGURADO = 'O pedido de atendimento ainda não está configurado. Tente de novo em instantes.';
const MSG_FALHA_ENVIO = 'Não foi possível enviar agora. Tente de novo em instantes.';
const SQL_SOLICITACOES = 'sql/solicitacoes_atendimento.sql';

const SELECTS_PERFIL = [
  'id,nome,whatsapp,whatsapp_agencia',
  'id,nome,whatsapp',
  'id,nome'
];

function logErroSupabase(contexto, status, txt) {
  console.error(contexto, status, txt);
  if (tabelaAusente(txt)) {
    console.error(
      'Causa: tabela ausente no Supabase. Rode ' + SQL_SOLICITACOES + ' no SQL Editor.'
    );
  } else if (colunaAusente(txt)) {
    const col = nomeColunaAusente(txt);
    console.error(
      'Causa: coluna ausente' + (col ? ' (' + col + ')' : '') +
      '. Rode ' + SQL_SOLICITACOES + ' (ou o ALTER correspondente) no SQL Editor.'
    );
  } else if (erroPermissao(status, txt)) {
    console.error(
      'Causa: permissão/RLS. Confirme SUPABASE_SERVICE_KEY (service_role) e rode o bloco GRANT/POLICY de ' +
      SQL_SOLICITACOES + '.'
    );
  } else if (erroTipoDados(txt)) {
    console.error('Causa: tipo/CHECK/FK no insert (periodos jsonb, necessidades text[], NOT NULL).');
  }
}

function slugColunaAusenteNoFiltro(ref, texto) {
  if (ehUuid(ref)) return false;
  const t = String(texto || '').toLowerCase();
  return colunaAusente(t) && t.indexOf('slug') !== -1;
}

function parseJsonSeguro(texto) {
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch (e) {
    return null;
  }
}

async function postJson(env, path, body, querRetorno) {
  const resp = await fetch(env.SUPABASE_URL + '/rest/v1/' + path, {
    method: 'POST',
    headers: headersSupabase(env, true, querRetorno),
    body: JSON.stringify(body)
  });
  const txt = await resp.text();
  return { ok: resp.ok, status: resp.status, txt: txt, json: parseJsonSeguro(txt) };
}

async function patchJson(env, path, body) {
  const resp = await fetch(env.SUPABASE_URL + '/rest/v1/' + path, {
    method: 'PATCH',
    headers: headersSupabase(env, true, false),
    body: JSON.stringify(body)
  });
  const txt = await resp.text();
  return { ok: resp.ok, status: resp.status, txt: txt };
}

function linhaDoInsert(json) {
  if (!json) return null;
  if (Array.isArray(json)) return json[0] || null;
  if (json.id) return json;
  return null;
}

async function buscarPerfilAtivo(env, ref) {
  const hoje = new Date().toISOString();
  const filtrosBase = [
    'aprovada=eq.true',
    'status_pagamento=eq.Pago',
    'plano_valido_ate=gte.' + hoje,
    'limit=1'
  ];

  let ultimoStatus = 0;
  let ultimoTxt = '';

  for (let i = 0; i < SELECTS_PERFIL.length; i++) {
    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?' +
      [filtroPerfilPorRef(ref)].concat(filtrosBase).concat(['select=' + SELECTS_PERFIL[i]]).join('&'),
      { headers: headersSupabase(env) }
    );
    const txt = await resp.text();
    if (resp.ok) {
      return { ok: true, json: parseJsonSeguro(txt) };
    }

    ultimoStatus = resp.status;
    ultimoTxt = txt;

    if (slugColunaAusenteNoFiltro(ref, ultimoTxt)) {
      return {
        ok: false,
        perfilInexistente: true,
        slugColunaAusente: true,
        status: ultimoStatus,
        txt: ultimoTxt
      };
    }
    if (!colunaAusente(ultimoTxt)) break;
  }

  return { ok: false, status: ultimoStatus, txt: ultimoTxt };
}

async function inserirSolicitacao(env, minimo) {
  const tentativas = [Object.assign({}, minimo)];
  if (Object.prototype.hasOwnProperty.call(minimo, 'necessidades')) {
    const semNec = Object.assign({}, minimo);
    delete semNec.necessidades;
    tentativas.push(semNec);
  }

  let ultimo = { ok: false, status: 0, txt: '' };

  for (let i = 0; i < tentativas.length; i++) {
    const r = await postJson(env, 'solicitacoes_atendimento', tentativas[i], 'minimal');
    if (r.ok) {
      return { ok: true, id: null, linha: null };
    }

    ultimo = r;
    logErroSupabase('Erro insert solicitação:', r.status, r.txt);

    if (tabelaAusente(r.txt)) {
      return { ok: false, tabelaAusente: true, status: r.status, txt: r.txt };
    }
    if (erroPermissao(r.status, r.txt)) {
      return { ok: false, permissao: true, status: r.status, txt: r.txt };
    }
    if (!colunaAusente(r.txt) && !erroTipoDados(r.txt)) {
      return { ok: false, status: r.status, txt: r.txt };
    }
  }

  if (tabelaAusente(ultimo.txt)) {
    return { ok: false, tabelaAusente: true, status: ultimo.status, txt: ultimo.txt };
  }
  if (colunaAusente(ultimo.txt)) {
    return { ok: false, colunaAusente: true, status: ultimo.status, txt: ultimo.txt };
  }
  return { ok: false, status: ultimo.status, txt: ultimo.txt };
}

async function completarSolicitacao(env, id, extras) {
  if (!id || !extras) return;
  const body = Object.assign({}, extras);
  const chaves = Object.keys(body);
  for (let n = 0; n < chaves.length + 1; n++) {
    if (Object.keys(body).length === 0) return;
    const r = await patchJson(env, 'solicitacoes_atendimento?id=eq.' + encodeURIComponent(id), body);
    if (r.ok) return;
    logErroSupabase('Patch opcionais da solicitação:', r.status, r.txt);
    if (!colunaAusente(r.txt) && !erroTipoDados(r.txt)) return;
    const col = nomeColunaAusente(r.txt);
    if (col && Object.prototype.hasOwnProperty.call(body, col)) {
      delete body[col];
      continue;
    }
    const ordem = ['periodos', 'ip_hash', 'info_paciente', 'paciente_sexo', 'paciente_idade', 'encaminhar_outras', 'email', 'complemento'];
    let removida = false;
    for (let i = 0; i < ordem.length; i++) {
      if (Object.prototype.hasOwnProperty.call(body, ordem[i])) {
        delete body[ordem[i]];
        removida = true;
        break;
      }
    }
    if (!removida) return;
  }
}

async function buscarIdRecemCriado(env, cuidadorId, whatsapp) {
  try {
    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/solicitacoes_atendimento?cuidador_id=eq.' + encodeURIComponent(cuidadorId) +
      '&whatsapp=eq.' + encodeURIComponent(whatsapp) +
      '&select=id&order=criado_em.desc&limit=1',
      { headers: headersSupabase(env) }
    );
    const txt = await resp.text();
    if (!resp.ok) return null;
    const json = parseJsonSeguro(txt);
    const linha = linhaDoInsert(json);
    return linha && linha.id ? linha.id : null;
  } catch (e) {
    return null;
  }
}

function urlWhatsFamilia(cuidadora, nomeSolicitante) {
  const n = String((cuidadora && (cuidadora.whatsapp || cuidadora.whatsapp_agencia)) || '').replace(/\D/g, '');
  if (!n) return null;
  let num = n;
  if (num.length === 10 || num.length === 11) num = '55' + num;
  const primeiro = primeiroNome(cuidadora && cuidadora.nome) || 'profissional';
  const quem = primeiroNome(nomeSolicitante) || 'uma família';
  const texto = 'Olá, ' + primeiro + '! Sou ' + quem + '. Acabei de enviar uma solicitação de atendimento pelo seu perfil na Afeto e gostaria de conversar.';
  return 'https://wa.me/' + num + '?text=' + encodeURIComponent(texto);
}

export async function onRequestGet() {
  return jsonResp({
    ok: true,
    habilidades: HABILIDADES,
    bairros: BAIRROS,
    minHorasDia: MIN_HORAS_DIA,
    maxPeriodos: MAX_PERIODOS
  }, 200);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!supabaseOk(env)) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }

  let gravou = false;
  let waUrl = null;
  let nomeProfissional = '';

  try {
    const body = await request.json();
    if (body.website) {
      return jsonResp({ ok: true }, 200);
    }

    const ip = ipDoPedido(request);
    const turnstile = await verificarTurnstile(env, body.turnstileToken, ip);
    if (!turnstile.ok) {
      return jsonResp({ error: 'Confirme que você não é um robô e tente de novo.' }, 400);
    }

    const ref = refPerfilSegura(body.cuidadorId);
    if (!ref) {
      return jsonResp({ error: 'Perfil inválido.' }, 400);
    }

    const nomeSolicitante = String(body.nomeSolicitante || '').trim().substring(0, 80);
    const whatsLimpo = String(body.whatsapp || '').replace(/\D/g, '');
    const email = String(body.email || '').trim().substring(0, 120);
    const bairro = String(body.bairro || '').trim();
    const pacienteNome = primeiroNome(body.pacienteNome).substring(0, 40);
    const pacienteSexo = String(body.pacienteSexo || '').trim();
    const complementoBruto = String(body.complemento || '').trim().substring(0, 800);
    const complemento = (complementoBruto === TEXTO_SUGESTAO_CUIDADOS) ? '' : complementoBruto;
    const infoPaciente = String(body.infoPaciente || '').trim().substring(0, 800);
    const encaminharOutras = body.encaminharOutras === true;

    if (!nomeSolicitante || nomeSolicitante.length < 2) {
      return jsonResp({ error: 'Informe seu nome.' }, 400);
    }
    if (whatsLimpo.length < 10 || whatsLimpo.length > 11) {
      return jsonResp({ error: 'WhatsApp inválido.' }, 400);
    }
    if (email && !EMAIL_OK.test(email)) {
      return jsonResp({ error: 'E-mail inválido.' }, 400);
    }
    if (BAIRROS.indexOf(bairro) === -1) {
      return jsonResp({ error: 'Escolha um bairro da lista.' }, 400);
    }
    if (!pacienteNome) {
      return jsonResp({ error: 'Informe o primeiro nome de quem vai receber o cuidado.' }, 400);
    }

    const idadeNum = parseInt(body.pacienteIdade, 10);
    if (!idadeNum || idadeNum < 1 || idadeNum > 120) {
      return jsonResp({ error: 'Informe a idade da pessoa que vai receber o cuidado.' }, 400);
    }

    const sexos = ['Feminino', 'Masculino', 'Outro'];
    if (sexos.indexOf(pacienteSexo) === -1) {
      return jsonResp({ error: 'Informe o sexo da pessoa que vai receber o cuidado.' }, 400);
    }

    const necessidades = Array.isArray(body.necessidades) ? body.necessidades : [];
    const necLimpas = [];
    necessidades.forEach(function (n) {
      if (HABILIDADES.indexOf(n) !== -1 && necLimpas.indexOf(n) === -1) necLimpas.push(n);
    });
    if (necLimpas.length === 0 && !complemento) {
      return jsonResp({ error: 'Marque as necessidades ou descreva os cuidados especiais.' }, 400);
    }
    if (necLimpas.length > 10) {
      return jsonResp({ error: 'Marque no máximo 10 necessidades.' }, 400);
    }

    const agenda = validarPeriodos(body.periodos);
    if (!agenda.ok) return jsonResp({ error: agenda.erro }, 400);

    const ipHash = await hashIp(ip);
    try {
      const umMinutoAtras = new Date(Date.now() - 60 * 1000).toISOString();
      const rateResp = await fetch(
        env.SUPABASE_URL + '/rest/v1/solicitacoes_atendimento?ip_hash=eq.' + encodeURIComponent(ipHash) +
        '&criado_em=gte.' + encodeURIComponent(umMinutoAtras) + '&select=id',
        { headers: headersSupabase(env) }
      );
      const rateTxt = await rateResp.text();
      if (rateResp.ok) {
        const recentes = parseJsonSeguro(rateTxt);
        if (recentes && recentes.length >= 3) {
          return jsonResp({ error: 'Aguarde um instante antes de enviar outro pedido.' }, 429);
        }
      } else if (tabelaAusente(rateTxt) || colunaAusente(rateTxt) || erroPermissao(rateResp.status, rateTxt)) {
        logErroSupabase('Rate limit solicitações ignorado:', rateResp.status, rateTxt);
      }
    } catch (e) {
      console.error('Rate limit solicitações ignorado:', e);
    }

    const perfilBusca = await buscarPerfilAtivo(env, ref);
    let cuidadora = null;
    if (perfilBusca.ok) {
      const perfis = perfilBusca.json;
      cuidadora = perfis && perfis[0];
    } else {
      logErroSupabase('Erro buscar perfil solicitação:', perfilBusca.status, perfilBusca.txt);
    }

    const cuidadorId = (cuidadora && cuidadora.id) || (ehUuid(ref) ? ref : null);
    if (!cuidadorId) {
      if (perfilBusca.perfilInexistente || perfilBusca.slugColunaAusente || (!ehUuid(ref) && colunaAusente(perfilBusca.txt))) {
        return jsonResp({ error: 'Profissional não encontrada.' }, 404);
      }
      if (!perfilBusca.ok) {
        return jsonResp({ error: MSG_FALHA_ENVIO }, 502);
      }
      return jsonResp({ error: 'Profissional não encontrada.' }, 404);
    }

    const minimo = {
      cuidador_id: cuidadorId,
      nome_solicitante: nomeSolicitante,
      whatsapp: whatsLimpo,
      bairro: bairro,
      necessidades: necLimpas,
      paciente_primeiro_nome: pacienteNome,
      status: 'nova'
    };

    const extras = {
      email: email || null,
      complemento: complemento || null,
      paciente_idade: idadeNum,
      paciente_sexo: pacienteSexo,
      info_paciente: infoPaciente || null,
      periodos: agenda.periodos,
      encaminhar_outras: encaminharOutras,
      ip_hash: ipHash
    };

    const insert = await inserirSolicitacao(env, minimo);
    if (!insert.ok) {
      if (insert.tabelaAusente || insert.colunaAusente || insert.permissao) {
        return jsonResp({ error: MSG_NAO_CONFIGURADO }, 503);
      }
      return jsonResp({ error: MSG_FALHA_ENVIO }, 502);
    }

    gravou = true;
    waUrl = urlWhatsFamilia(cuidadora, nomeSolicitante);
    nomeProfissional = primeiroNome(cuidadora && cuidadora.nome);

    let solicitacaoId = insert.id;
    try {
      if (!solicitacaoId) {
        solicitacaoId = await buscarIdRecemCriado(env, cuidadorId, whatsLimpo);
      }
      if (solicitacaoId) {
        await completarSolicitacao(env, solicitacaoId, extras);
        const visResp = await fetch(env.SUPABASE_URL + '/rest/v1/solicitacoes_visiveis', {
          method: 'POST',
          headers: headersSupabase(env, true, false),
          body: JSON.stringify({
            solicitacao_id: solicitacaoId,
            cuidador_id: cuidadorId,
            via: 'perfil'
          })
        });
        if (!visResp.ok) {
          const visTxt = await visResp.text();
          logErroSupabase('Erro insert solicitacoes_visiveis:', visResp.status, visTxt);
        }
      }
    } catch (pos) {
      console.error('Pós-insert (visiveis/patch) ignorado:', pos);
    }

    const telegramJob = notificarTelegram(env, {
      cuidadora: cuidadora || { nome: '' },
      nomeSolicitante: nomeSolicitante,
      whatsapp: whatsLimpo,
      bairro: bairro,
      encaminharOutras: encaminharOutras,
      pacienteNome: pacienteNome
    }).catch(function (e) {
      console.error('Telegram solicitação:', e);
    });
    if (context.waitUntil) {
      context.waitUntil(telegramJob);
    } else {
      await Promise.race([
        telegramJob,
        new Promise(function (resolve) { setTimeout(resolve, 2000); })
      ]);
    }

    return jsonResp({
      ok: true,
      waUrl: waUrl,
      nomeProfissional: nomeProfissional
    }, 200);
  } catch (err) {
    console.error('Erro solicitação:', err);
    if (gravou) {
      return jsonResp({
        ok: true,
        waUrl: waUrl,
        nomeProfissional: nomeProfissional
      }, 200);
    }
    return jsonResp({ error: MSG_FALHA_ENVIO }, 500);
  }
}

async function notificarTelegram(env, dados) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const agora = new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    const msg =
      '💜 <b>Nova solicitação de atendimento</b>\n\n' +
      '👩‍⚕️ <b>Perfil:</b> ' + ((dados.cuidadora && dados.cuidadora.nome) || '—') + '\n' +
      '👤 <b>Família:</b> ' + dados.nomeSolicitante + '\n' +
      '📱 <b>WhatsApp:</b> ' + dados.whatsapp + '\n' +
      '📍 <b>Bairro:</b> ' + dados.bairro + '\n' +
      '🤍 <b>Paciente:</b> ' + dados.pacienteNome + '\n' +
      (dados.encaminharOutras ? '✅ Autorizou encaminhar a outras\n' : '⛔ Não autorizou encaminhar a outras\n') +
      '\n🕒 ' + agora;
    await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
  } catch (e) {
    console.error('Telegram solicitação:', e);
  }
}
