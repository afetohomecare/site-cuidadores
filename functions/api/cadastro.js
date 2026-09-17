// ============================================================
// AFETO — API: cadastro de cuidadora
// ------------------------------------------------------------
// 🆕 Opção B: cria conta + senha JUNTO com o cadastro.
// 🛡️ BLOQUEIA segundo cadastro quando já existe auth_user_id.
// ============================================================

const BUCKET_FOTOS = 'fotos';

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

    const nome           = campo(form, 'nome');
    const whatsapp       = campo(form, 'whatsapp');
    const cpf            = campo(form, 'cpf');
    const senha          = campo(form, 'senha');
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
    const plano          = (campo(form, 'plano') || 'cadastro').toLowerCase();
    const foto           = form.get('foto');

    if (!nome || !whatsapp || !cpf) {
      return jsonResp({ error: 'Campos obrigatórios ausentes.' }, 400);
    }

    const cpfLimpo   = cpf.replace(/\D/g, '');
    const whatsLimpo = whatsapp.replace(/\D/g, '');

    if (cpfLimpo.length !== 11) {
      return jsonResp({ error: 'CPF inválido.' }, 400);
    }
    if (whatsLimpo.length < 10 || whatsLimpo.length > 11) {
      return jsonResp({ error: 'WhatsApp inválido.' }, 400);
    }
    if (!senha || senha.length < 8) {
      return jsonResp({ error: 'A senha precisa ter no mínimo 8 caracteres.' }, 400);
    }
    if (senha.length > 100) {
      return jsonResp({ error: 'A senha está longa demais.' }, 400);
    }

    if (foto && foto.size > 0) {
      if (foto.size > 5 * 1024 * 1024) {
        return jsonResp({ error: 'A foto precisa ter no máximo 5MB.' }, 400);
      }
      const tipoFoto = String(foto.type || '').toLowerCase();
      if (tipoFoto && tipoFoto.indexOf('image/') !== 0) {
        return jsonResp({ error: 'O arquivo da foto precisa ser uma imagem.' }, 400);
      }
    }

    // ---------- STATUS INICIAL PELO PLANO ----------
    let statusPagamento   = 'AguardandoPagamento';
    let planoCadastro     = false;
    let planoProfissional = false;
    let planoDestaque     = false;

    if (plano === 'profissional') planoProfissional = true;
    else if (plano === 'destaque') planoDestaque = true;
    else planoCadastro = true;

    // ---------- MONTA O OBJETO ----------
    const bairrosArray = bairrosStr
      .split('|').map(function (b) { return b.trim(); }).filter(function (b) { return b; });

    const bairroPrincipal = bairrosArray[0] || '';

    const subsArray = subespecialStr
      .split('|').map(function (s) { return s.trim(); }).filter(function (s) { return s; });

    const cursosArray = cursosStr
      .split(/\n|;/).map(function (c) { return c.trim(); }).filter(function (c) { return c; });

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
      plano_cadastro:     planoCadastro,
      plano_profissional: planoProfissional,
      plano_destaque:     planoDestaque
    };

    if (coren) campos.coren = coren;

    // ---------- PROCURA EXISTENTE ----------
    const filtro = 'or=(' +
      'cpf.eq.' + encodeURIComponent(cpfLimpo) + ',' +
      'cpf.eq.' + encodeURIComponent(cpf) + ',' +
      'whatsapp.eq.' + encodeURIComponent(whatsLimpo) +
    ')';

    const buscaUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?select=id,auth_user_id&' + filtro + '&limit=1';

    const buscaResp = await fetch(buscaUrl, { headers: headersSupabase(env) });

    if (!buscaResp.ok) {
      const txt = await buscaResp.text();
      console.error('Erro ao buscar existente:', buscaResp.status, txt);
      return jsonResp({ error: 'Falha ao consultar banco' }, 502);
    }

    const encontrados = await buscaResp.json();
    const registroExistente = encontrados.length > 0 ? encontrados[0] : null;

    // ---------- INSERE OU ATUALIZA ----------
    let cuidadorId;
    let foiCriado = false;
    let authUserId = null;

    if (registroExistente) {
      cuidadorId = registroExistente.id;
      authUserId = registroExistente.auth_user_id || null;

      // 🛡️ BLOQUEIO: se já existe conta criada (auth_user_id), não deixa recadastrar
      if (authUserId) {
        return jsonResp({
          error: 'Você já tem uma conta na Afeto. Faça login ou use "Esqueci minha senha".',
          codigo: 'CADASTRO_DUPLICADO',
          cpf: cpfLimpo
        }, 409);
      }

      // Cadastro antigo sem auth_user_id: permite completar (fluxo legado)
      const updateUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId);
      const updateResp = await fetch(updateUrl, {
        method: 'PATCH',
        headers: headersSupabase(env, true),
        body: JSON.stringify(campos)
      });

      if (!updateResp.ok) {
        const txt = await updateResp.text();
        console.error('Erro UPDATE:', updateResp.status, txt);
        return jsonResp({ error: 'Falha ao atualizar' }, 502);
      }
    } else {
      const insertResp = await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores', {
        method: 'POST',
        headers: headersSupabase(env, true, true),
        body: JSON.stringify(campos)
      });

      if (!insertResp.ok) {
        const txt = await insertResp.text();
        console.error('Erro INSERT:', insertResp.status, txt);

        if (txt.indexOf('duplicate key') !== -1 || txt.indexOf('already exists') !== -1) {
          const busca2 = await fetch(
            env.SUPABASE_URL + '/rest/v1/cuidadores?cpf=eq.' + encodeURIComponent(cpfLimpo) + '&select=id,auth_user_id&limit=1',
            { headers: headersSupabase(env) }
          );
          if (busca2.ok) {
            const linhas2 = await busca2.json();
            if (linhas2.length > 0) {
              // Se já tem auth, bloqueia também
              if (linhas2[0].auth_user_id) {
                return jsonResp({
                  error: 'Você já tem uma conta na Afeto. Faça login ou use "Esqueci minha senha".',
                  codigo: 'CADASTRO_DUPLICADO',
                  cpf: cpfLimpo
                }, 409);
              }
              cuidadorId = linhas2[0].id;
              authUserId = null;
              await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId), {
                method: 'PATCH',
                headers: headersSupabase(env, true),
                body: JSON.stringify(campos)
              });
            } else {
              return jsonResp({ error: 'Falha ao criar cadastro' }, 502);
            }
          } else {
            return jsonResp({ error: 'Falha ao criar cadastro' }, 502);
          }
        } else {
          return jsonResp({ error: 'Falha ao criar cadastro' }, 502);
        }
      } else {
        const criados = await insertResp.json();
        if (!criados || !criados[0] || !criados[0].id) {
          return jsonResp({ error: 'Banco não retornou o id do cadastro' }, 502);
        }
        cuidadorId = criados[0].id;
        foiCriado = true;
      }
    }

    // ============================================================
    // CRIA USUÁRIO NO SUPABASE AUTH (se tem senha e ainda não tem conta)
    // ============================================================
    let criouAuth = false;
    let authErro = null;

    if (!authUserId && cpfLimpo.length === 11) {
      try {
        const emailFake = cpfLimpo + '@afeto.app';

        const criarUserResp = await fetch(env.SUPABASE_URL + '/auth/v1/admin/users', {
          method: 'POST',
          headers: {
            'apikey': env.SUPABASE_SERVICE_KEY,
            'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: emailFake,
            password: senha,
            email_confirm: true,
            user_metadata: {
              cuidador_id: cuidadorId,
              nome: nome,
              role: 'cuidadora'
            }
          })
        });

        const criarUserData = await criarUserResp.json();
        const msgAuth = JSON.stringify(criarUserData || {}).toLowerCase();

        if (!criarUserResp.ok) {
          console.error('Erro criar user Auth:', criarUserResp.status, JSON.stringify(criarUserData));
          if (msgAuth.indexOf('already') !== -1 || msgAuth.indexOf('registered') !== -1 || criarUserResp.status === 422) {
            const existenteAuthId = await buscarAuthIdPorEmail(env, emailFake);
            if (existenteAuthId && cuidadorId) {
              await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId), {
                method: 'PATCH',
                headers: headersSupabase(env, true),
                body: JSON.stringify({ auth_user_id: existenteAuthId })
              });
            }
            return jsonResp({
              error: 'Você já tem uma conta na Afeto. Faça login ou use "Esqueci minha senha".',
              codigo: 'CADASTRO_DUPLICADO',
              cpf: cpfLimpo
            }, 409);
          }
          authErro = 'Não foi possível criar o acesso. Tente novamente.';
        } else if (!criarUserData.id) {
          authErro = 'Não foi possível criar o acesso. Tente novamente.';
        } else {
          authUserId = criarUserData.id;
          criouAuth = true;

          const vincularResp = await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId), {
            method: 'PATCH',
            headers: headersSupabase(env, true),
            body: JSON.stringify({
              auth_user_id: authUserId,
              senha_criada_em: new Date().toISOString()
            })
          });
          if (!vincularResp.ok) {
            console.error('Erro ao vincular auth_user_id:', vincularResp.status, await vincularResp.text());
            authUserId = null;
            criouAuth = false;
            authErro = 'Não foi possível vincular o acesso. Tente novamente.';
          }
        }
      } catch (err) {
        console.error('Erro criar auth user:', err);
        authErro = 'Não foi possível criar o acesso. Tente novamente.';
      }
    }

    if (!authUserId) {
      await notificarTelegram(env, {
        titulo: '⚠️ Cadastro sem conta de acesso',
        nome: nome,
        whatsapp: whatsapp,
        cpf: cpf,
        profissao: especialidade,
        plano: plano,
        authErro: authErro || 'auth_user_id ausente'
      });
      return jsonResp({
        ok: false,
        error: 'Não foi possível criar seu acesso. Tente novamente em alguns instantes. Se o problema continuar, fale com a Afeto.',
        codigo: 'CONTA_NAO_CRIADA'
      }, 503);
    }

    // ---------- UPLOAD DA FOTO ----------
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

        fotoUrl = env.SUPABASE_URL + '/storage/v1/object/public/' + caminho;

        const patchUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId);
        const patchResp = await fetch(patchUrl, {
          method: 'PATCH',
          headers: headersSupabase(env, true),
          body: JSON.stringify({ foto_url: fotoUrl })
        });

        if (!patchResp.ok) {
          console.error('Erro ao gravar foto_url:', await patchResp.text());
        } else {
          fotoEnviada = true;
        }
      } catch (err) {
        fotoErro = String(err && err.message ? err.message : err);
        console.error('Erro upload foto:', fotoErro);
      }
    }

    const linkPerfil = 'https://afetocuidadores.pages.dev/perfil.html?id=' + cuidadorId;

    await notificarTelegram(env, {
      titulo: foiCriado
        ? '💜 Novo cadastro ' + plano.toUpperCase()
        : '💜 Cadastro ' + plano.toUpperCase() + ' atualizado',
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
      fotoErro: fotoErro,
      criouAuth: criouAuth,
      authErro: authErro
    });

    return jsonResp({
      ok: true,
      recordId: cuidadorId,
      criado: foiCriado,
      linkPerfil: linkPerfil,
      fotoEnviada: fotoEnviada,
      criouAuth: true,
      precisaPagar: true
    }, 200);

  } catch (err) {
    console.error('Erro cadastro:', err);
    return jsonResp({
      ok: false,
      error: 'Falha no processamento'
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

async function buscarAuthIdPorEmail(env, email) {
  try {
    const resp = await fetch(
      env.SUPABASE_URL + '/auth/v1/admin/users?email=' + encodeURIComponent(email) + '&per_page=5',
      {
        headers: {
          'apikey': env.SUPABASE_SERVICE_KEY,
          'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY
        }
      }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const lista = Array.isArray(data) ? data : (data.users || []);
    const alvo = String(email).toLowerCase();
    for (let i = 0; i < lista.length; i++) {
      const u = lista[i];
      if (u && u.id && String(u.email || '').toLowerCase() === alvo) return u.id;
    }
    if (data && data.id && String(data.email || '').toLowerCase() === alvo) return data.id;
    return null;
  } catch (err) {
    console.error('Erro ao buscar usuário Auth:', err);
    return null;
  }
}

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

    const planoTexto = dados.plano === 'cadastro' ? 'Cadastro Básico'
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

    if (dados.criouAuth) {
      msg += '\n🔐 *Conta criada com senha ✅*\n';
    } else if (dados.authErro) {
      msg += '\n⚠️ *Erro ao criar conta:* ' + String(dados.authErro).substring(0, 150) + '\n';
    }

    if (dados.fotoEnviada === false && dados.fotoErro) {
      msg += '\n📸 *Foto:* ❌ falhou\n';
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