// ============================================================
// AFETO — API: cadastro de cuidadora
// ------------------------------------------------------------
// Fluxo:
//   1. Recebe o formulário (FormData)
//   2. Verifica se CPF ou WhatsApp já existem na tabela cuidadores
//      • Se sim → UPDATE
//      • Se não → INSERT
//   3. Se vier foto, sobe pro Supabase Storage (bucket "fotos")
//   4. Atualiza o registro com a URL pública da foto
//   5. Notifica o Telegram
//
// Devolve o UUID do registro (usado depois no checkout e no link
// do perfil: perfil.html?id=<uuid>)
// ============================================================

const BUCKET_FOTOS = 'fotos';

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return jsonResp({ error: 'Método não permitido' }, 405);
  }

  const { env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }

  try {
    const form = await context.request.formData();

    // ---------- 1. LÊ CAMPOS DO FORMULÁRIO ----------
    const nome           = campo(form, 'nome');
    const whatsapp       = campo(form, 'whatsapp');
    const cpf            = campo(form, 'cpf');
    const bio            = campo(form, 'bio');
    const motivacao      = campo(form, 'motivacao');
    const especialidade  = campo(form, 'profissao');
    const coren          = campo(form, 'coren');
    const experiencia    = campo(form, 'experiencia');
    const bairrosStr     = campo(form, 'bairros');
    const valorPlantao   = campo(form, 'valor_plantao');
    const turno          = campo(form, 'turno');
    const subespecialStr = campo(form, 'subespecialidades');
    const cursosStr      = campo(form, 'cursos');
    const indicadoPor    = campo(form, 'indicadoPor');
    const plano          = (campo(form, 'plano') || 'gratis').toLowerCase();
    const foto           = form.get('foto');

    if (!nome || !whatsapp || !cpf) {
      return jsonResp({ error: 'Campos obrigatórios ausentes.' }, 400);
    }

    const cpfLimpo   = cpf.replace(/\D/g, '');
    const whatsLimpo = whatsapp.replace(/\D/g, '');

    // ---------- 2. DEFINE STATUS INICIAL PELO PLANO ----------
    let statusPagamento   = 'Gratuito';
    let planoProfissional = false;
    let planoDestaque     = false;

    if (plano === 'profissional') {
      statusPagamento   = 'AguardandoPagamento';
      planoProfissional = true;
    } else if (plano === 'destaque') {
      statusPagamento = 'AguardandoPagamento';
      planoDestaque   = true;
    }

    // ---------- 3. MONTA O OBJETO PRA GRAVAR ----------
    const bairrosArray = bairrosStr
      .split('|')
      .map(function (b) { return b.trim(); })
      .filter(function (b) { return b; });

    const bairroPrincipal = bairrosArray[0] || '';

    const subsArray = subespecialStr
      .split('|')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s; });

    const cursosArray = cursosStr
      .split(/\n|;/)
      .map(function (c) { return c.trim(); })
      .filter(function (c) { return c; });

    const campos = {
      nome:               nome,
      whatsapp:           whatsapp,
      whatsapp_agencia:   whatsapp,
      cpf:                cpf,
      apresentacao:       bio,
      motivacao:          motivacao,
      especialidade:      especialidade,
      experiencia:        experiencia,
      bairro:             bairroPrincipal,
      bairros:            bairrosArray,
      preco:              String(valorPlantao || ''),
      turno:              turno,
      cursos:             cursosArray,
      subespecialidades:  subsArray,
      indicado_por:       indicadoPor || null,
      status_pagamento:   statusPagamento,
      aprovada:           false,
      disponivel:         true,
      plano_profissional: planoProfissional,
      plano_destaque:     planoDestaque
    };

    if (coren) campos.coren = coren;

    // ---------- 4. PROCURA REGISTRO EXISTENTE (CPF ou WhatsApp) ----------
    const filtro = 'or=(cpf.eq.' + encodeURIComponent(cpfLimpo) + ',whatsapp.eq.' + encodeURIComponent(whatsLimpo) + ')';
    const buscaUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?select=id&' + filtro + '&limit=1';

    const buscaResp = await fetch(buscaUrl, {
      headers: headersSupabase(env)
    });

    if (!buscaResp.ok) {
      const txt = await buscaResp.text();
      console.error('Erro ao buscar existente:', buscaResp.status, txt);
      return jsonResp({ error: 'Falha ao consultar banco', detalhe: txt.substring(0, 300) }, 502);
    }

    const encontrados = await buscaResp.json();
    const registroExistente = encontrados.length > 0 ? encontrados[0].id : null;

    // ---------- 5. INSERE OU ATUALIZA ----------
    let cuidadorId;
    let foiCriado = false;

    if (registroExistente) {
      // UPDATE
      cuidadorId = registroExistente;

      const updateUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId;
      const updateResp = await fetch(updateUrl, {
        method: 'PATCH',
        headers: headersSupabase(env, true),
        body: JSON.stringify(campos)
      });

      if (!updateResp.ok) {
        const txt = await updateResp.text();
        console.error('Erro UPDATE:', updateResp.status, txt);
        return jsonResp({ error: 'Falha ao atualizar', detalhe: txt.substring(0, 300) }, 502);
      }
    } else {
      // INSERT
      const insertResp = await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores', {
        method: 'POST',
        headers: headersSupabase(env, true, true),
        body: JSON.stringify(campos)
      });

      if (!insertResp.ok) {
        const txt = await insertResp.text();
        console.error('Erro INSERT:', insertResp.status, txt);
        return jsonResp({ error: 'Falha ao criar cadastro', detalhe: txt.substring(0, 300) }, 502);
      }

      const criados = await insertResp.json();
      if (!criados || !criados[0] || !criados[0].id) {
        return jsonResp({ error: 'Banco não retornou o id do cadastro' }, 502);
      }
      cuidadorId = criados[0].id;
      foiCriado = true;
    }

    // ---------- 6. UPLOAD DA FOTO (SE HOUVER) ----------
    let fotoEnviada = false;
    let fotoErro = null;
    let fotoUrl = null;

    if (foto && foto.size > 0) {
      try {
        const nomeArquivo = cuidadorId + '.jpg';
        const caminho = BUCKET_FOTOS + '/' + nomeArquivo;

        const buffer = await foto.arrayBuffer();

        const uploadUrl = env.SUPABASE_URL + '/storage/v1/object/' + caminho;
        const uploadResp = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
            'Content-Type': foto.type || 'image/jpeg',
            'x-upsert': 'true'
          },
          body: buffer
        });

        if (!uploadResp.ok) {
          const txt = await uploadResp.text();
          throw new Error('[' + uploadResp.status + '] ' + txt.substring(0, 200));
        }

        // Monta URL pública da foto
        fotoUrl = env.SUPABASE_URL + '/storage/v1/object/public/' + caminho;

        // Atualiza o registro com a URL da foto
        const patchUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId;
        const patchResp = await fetch(patchUrl, {
          method: 'PATCH',
          headers: headersSupabase(env, true),
          body: JSON.stringify({ foto_url: fotoUrl })
        });

        if (!patchResp.ok) {
          const txt = await patchResp.text();
          console.error('Erro ao gravar foto_url:', patchResp.status, txt);
        } else {
          fotoEnviada = true;
        }
      } catch (err) {
        fotoErro = String(err && err.message ? err.message : err);
        console.error('Erro upload foto:', fotoErro);
      }
    } else {
      fotoErro = 'Sem arquivo de foto';
    }

    // ---------- 7. LINK DO PERFIL ----------
    const linkPerfil = 'https://afetocuidadores.pages.dev/perfil.html?id=' + cuidadorId;

    // ---------- 8. TELEGRAM ----------
    await notificarTelegram(env, {
      titulo: foiCriado
        ? (plano === 'gratis' ? '💜 Novo cadastro GRÁTIS' : '🎉 Novo cadastro ' + plano.toUpperCase())
        : (plano === 'gratis' ? '💜 Cadastro GRÁTIS atualizado' : '🎉 Cadastro ' + plano.toUpperCase() + ' atualizado'),
      nome: nome,
      whatsapp: whatsapp,
      cpf: cpf,
      profissao: especialidade,
      plano: plano,
      bio: bio,
      subespecialidades: subespecialStr,
      indicadoPor: indicadoPor,
      linkPerfil: linkPerfil,
      fotoEnviada: fotoEnviada,
      fotoErro: fotoErro
    });

    // ---------- 9. RESPOSTA ----------
    return jsonResp({
      ok: true,
      recordId: cuidadorId,
      criado: foiCriado,
      linkPerfil: linkPerfil,
      fotoEnviada: fotoEnviada,
      fotoErro: fotoErro,
      precisaPagar: (plano === 'profissional' || plano === 'destaque')
    }, 200);

  } catch (err) {
    console.error('Erro cadastro:', err);
    return jsonResp({
      ok: false,
      error: 'Falha no processamento',
      detalhe: String(err && err.message ? err.message : err)
    }, 500);
  }
}

// ============================================================
// HELPERS
// ============================================================
function campo(form, nome) {
  const v = form.get(nome);
  return v ? String(v).trim() : '';
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

// Monta os headers pra chamar o Supabase (PostgREST)
function headersSupabase(env, temBody, querRetorno) {
  const h = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Accept': 'application/json'
  };
  if (temBody) h['Content-Type'] = 'application/json';
  if (querRetorno) h['Prefer'] = 'return=representation';
  return h;
}

// ============================================================
// NOTIFICAÇÃO TELEGRAM
// ============================================================
async function notificarTelegram(env, dados) {
  try {
    const token = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const agora = new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const planoTexto = dados.plano === 'gratis' ? 'Grátis'
                     : dados.plano === 'profissional' ? 'Profissional'
                     : dados.plano === 'destaque' ? 'Destaque' : dados.plano;

    let msg = '*' + dados.titulo + '*\n\n';
    if (dados.nome) msg += '👤 *Nome:* ' + dados.nome + '\n';
    if (dados.whatsapp) msg += '📱 *WhatsApp:* ' + dados.whatsapp + '\n';
    if (dados.cpf) msg += '🆔 *CPF:* ' + dados.cpf + '\n';
    if (dados.profissao) msg += '💼 *Atuação:* ' + dados.profissao + '\n';
    if (dados.plano) msg += '⭐ *Plano:* ' + planoTexto + '\n';
    if (dados.bio) msg += '\n📝 *Bio:* ' + dados.bio.substring(0, 180) + (dados.bio.length > 180 ? '...' : '') + '\n';
    if (dados.subespecialidades) msg += '\n🏷️ *Especialidades:* ' + dados.subespecialidades + '\n';
    if (dados.indicadoPor) msg += '\n🎁 *Indicada por:* ' + dados.indicadoPor + '\n';

    if (dados.linkPerfil) {
      msg += '\n🔗 *Link do perfil:*\n' + dados.linkPerfil + '\n';
    }

    if (dados.fotoEnviada === false && dados.fotoErro) {
      msg += '\n📸 *Foto:* ❌ falhou\n';
      msg += '⚠️ *Erro:* ' + String(dados.fotoErro).substring(0, 200) + '\n';
    }

    msg += '\n🕒 ' + agora;

    await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });
  } catch (e) {
    console.error('Telegram:', e);
  }
}