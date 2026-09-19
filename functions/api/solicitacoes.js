import { jsonResp } from '../_lib/http.js';
import { headersSupabase, supabaseOk } from '../_lib/supabase.js';
import { ehUuid, filtroPerfilPorRef, refPerfilSegura } from '../_lib/slug.js';
import { HABILIDADES, BAIRROS, MIN_HORAS_DIA, MAX_PERIODOS, TEXTO_SUGESTAO_CUIDADOS } from '../_lib/catalogo.js';
import { verificarTurnstile, ipDoPedido, hashIp } from '../_lib/turnstile.js';

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || '';
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

function validarPeriodos(lista) {
  if (!Array.isArray(lista) || lista.length === 0) {
    return { ok: false, erro: 'Escolha pelo menos um período de atendimento.' };
  }
  if (lista.length > MAX_PERIODOS) {
    return { ok: false, erro: 'Escolha no máximo ' + MAX_PERIODOS + ' períodos.' };
  }
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const vistos = {};
  const limpos = [];
  for (let i = 0; i < lista.length; i++) {
    const p = lista[i] || {};
    const data = String(p.data || '').trim();
    const inicio = String(p.inicio || '').trim();
    const fim = String(p.fim || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return { ok: false, erro: 'Data inválida na agenda.' };
    }
    if (!/^\d{2}:\d{2}$/.test(inicio) || !/^\d{2}:\d{2}$/.test(fim)) {
      return { ok: false, erro: 'Horário inválido na agenda.' };
    }
    const dia = new Date(data + 'T00:00:00');
    if (dia < hoje) {
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

function colunaAusente(texto) {
  const t = String(texto || '').toLowerCase();
  return t.indexOf('does not exist') !== -1
    || t.indexOf('schema cache') !== -1
    || t.indexOf('column') !== -1
    || t.indexOf('42703') !== -1
    || t.indexOf('pgrst204') !== -1;
}

async function buscarPerfilAtivo(env, ref) {
  const hoje = new Date().toISOString();
  const selects = [
    'id,nome,whatsapp,whatsapp_agencia',
    'id,nome,whatsapp'
  ];
  const filtros = [
    filtroPerfilPorRef(ref),
    'aprovada=eq.true',
    'status_pagamento=eq.Pago',
    'plano_valido_ate=gte.' + hoje,
    'limit=1'
  ];

  let ultimoStatus = 0;
  let ultimoTxt = '';
  for (let i = 0; i < selects.length; i++) {
    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?' +
      filtros.concat(['select=' + selects[i]]).join('&'),
      { headers: headersSupabase(env) }
    );
    if (resp.ok) return { ok: true, resp: resp };
    ultimoStatus = resp.status;
    ultimoTxt = await resp.text();
    if (!colunaAusente(ultimoTxt)) break;
  }

  return { ok: false, status: ultimoStatus, txt: ultimoTxt };
}

function urlWhatsFamilia(cuidadora, nomeSolicitante) {
  const n = String(cuidadora.whatsapp || cuidadora.whatsapp_agencia || '').replace(/\D/g, '');
  if (!n) return null;
  let num = n;
  if (num.length === 10 || num.length === 11) num = '55' + num;
  const primeiro = primeiroNome(cuidadora.nome) || 'profissional';
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
    const umMinutoAtras = new Date(Date.now() - 60 * 1000).toISOString();
    const rateResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/solicitacoes_atendimento?ip_hash=eq.' + encodeURIComponent(ipHash) +
      '&criado_em=gte.' + encodeURIComponent(umMinutoAtras) + '&select=id',
      { headers: headersSupabase(env) }
    );
    if (rateResp.ok) {
      const recentes = await rateResp.json();
      if (recentes && recentes.length >= 3) {
        return jsonResp({ error: 'Aguarde um instante antes de enviar outro pedido.' }, 429);
      }
    }

    const perfilBusca = await buscarPerfilAtivo(env, ref);
    if (!perfilBusca.ok) {
      console.error('Erro buscar perfil solicitação:', perfilBusca.status, perfilBusca.txt);
      if (!ehUuid(ref) && colunaAusente(perfilBusca.txt)) {
        return jsonResp({ error: 'Profissional não encontrada.' }, 404);
      }
      return jsonResp({ error: 'Não foi possível enviar agora. Tente de novo em instantes.' }, 502);
    }
    const perfis = await perfilBusca.resp.json();
    const cuidadora = perfis && perfis[0];
    if (!cuidadora || !cuidadora.id) {
      return jsonResp({ error: 'Profissional não encontrada.' }, 404);
    }
    const cuidadorId = cuidadora.id;

    const insertResp = await fetch(env.SUPABASE_URL + '/rest/v1/solicitacoes_atendimento', {
      method: 'POST',
      headers: headersSupabase(env, true, true),
      body: JSON.stringify({
        cuidador_id: cuidadorId,
        nome_solicitante: nomeSolicitante,
        whatsapp: whatsLimpo,
        email: email || null,
        bairro: bairro,
        necessidades: necLimpas,
        complemento: complemento || null,
        paciente_primeiro_nome: pacienteNome,
        paciente_idade: idadeNum,
        paciente_sexo: pacienteSexo,
        info_paciente: infoPaciente || null,
        periodos: agenda.periodos,
        encaminhar_outras: encaminharOutras,
        ip_hash: ipHash,
        status: 'nova'
      })
    });

    if (!insertResp.ok) {
      const txt = await insertResp.text();
      console.error('Erro insert solicitação:', insertResp.status, txt);
      return jsonResp({ error: 'Não foi possível enviar agora. Tente de novo em instantes.' }, 502);
    }

    const criadas = await insertResp.json();
    const solicitacao = criadas && criadas[0];
    if (solicitacao && solicitacao.id) {
      await fetch(env.SUPABASE_URL + '/rest/v1/solicitacoes_visiveis', {
        method: 'POST',
        headers: headersSupabase(env, true, false),
        body: JSON.stringify({
          solicitacao_id: solicitacao.id,
          cuidador_id: cuidadorId,
          via: 'perfil'
        })
      });
    }

    await notificarTelegram(env, {
      cuidadora: cuidadora,
      nomeSolicitante: nomeSolicitante,
      whatsapp: whatsLimpo,
      bairro: bairro,
      encaminharOutras: encaminharOutras,
      pacienteNome: pacienteNome
    });

    return jsonResp({
      ok: true,
      waUrl: urlWhatsFamilia(cuidadora, nomeSolicitante),
      nomeProfissional: primeiroNome(cuidadora.nome)
    }, 200);
  } catch (err) {
    console.error('Erro solicitação:', err);
    return jsonResp({ error: 'Falha no processamento.' }, 500);
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
      '👩‍⚕️ <b>Perfil:</b> ' + (dados.cuidadora.nome || '—') + '\n' +
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
