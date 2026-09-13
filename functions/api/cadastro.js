// functions/api/cadastro.js
// Versão: 2026-09-13 — com log detalhado de erro da foto

const AIRTABLE_BASE = 'apphAWeT91l1dMWM5';
const AIRTABLE_TABLE = 'Cuidadores';

export async function onRequest(context) {
  const AIRTABLE_API_KEY = context.env.AIRTABLE_API_KEY;

  if (context.request.method !== "POST") {
    return new Response("Método não permitido", { status: 405 });
  }

  try {
    const formData = await context.request.formData();

    const nome = (formData.get("nome") || "").trim();
    const whatsapp = (formData.get("whatsapp") || "").trim();
    const cpf = (formData.get("cpf") || "").trim();
    const bio = (formData.get("bio") || "").trim();
    const motivacao = (formData.get("motivacao") || "").trim();
    const especialidade = (formData.get("profissao") || "").trim();
    const coren = (formData.get("coren") || "").trim();
    const experiencia = (formData.get("experiencia") || "").trim();
    const bairrosStr = (formData.get("bairros") || "").trim();
    const valorPlantao = (formData.get("valor_plantao") || "").trim();
    const turno = (formData.get("turno") || "").trim();
    const subespecialidades = (formData.get("subespecialidades") || "").trim();
    const cursos = (formData.get("cursos") || "").trim();
    const indicadoPor = (formData.get("indicadoPor") || "").trim();
    const plano = (formData.get("plano") || "gratis").toLowerCase();
    const foto = formData.get("foto");

    if (!nome || !whatsapp || !cpf) {
      return jsonResp({ error: "Campos obrigatórios ausentes." }, 400);
    }

    const cpfLimpo = cpf.replace(/\D/g, '');
    const whatsLimpo = whatsapp.replace(/\D/g, '');

    let statusPagamento = 'Gratuito';
    let planoProfissional = false;
    let planoDestaque = false;

    if (plano === 'profissional') {
      statusPagamento = 'AguardandoPagamento';
      planoProfissional = true;
    } else if (plano === 'destaque') {
      statusPagamento = 'AguardandoPagamento';
      planoDestaque = true;
    }

    // ========== 1. BUSCAR SE JÁ EXISTE ==========
    const formula = `OR({CPF}="${escapeFormula(cpfLimpo)}", {WhatsApp}="${escapeFormula(whatsLimpo)}")`;
    const listUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;

    const listResp = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });
    const listData = await listResp.json();

    let registroExistente = null;
    if (listData.records && listData.records.length > 0) {
      registroExistente = listData.records[0];
    }

    // ========== 2. MONTA OS CAMPOS ==========
    const bairrosArray = bairrosStr.split('|').map(function(b) { return b.trim(); }).filter(function(b) { return b; });
    const bairroPrincipal = bairrosArray[0] || '';

    const campos = {
      Nome: nome,
      WhatsApp: whatsapp,
      WhatsAppAgencia: whatsapp,
      CPF: cpf,
      Apresentacao: bio,
      Motivacao: motivacao,
      Especialidade: especialidade,
      Experiencia: experiencia,
      Bairro: bairroPrincipal,
      Bairros: bairrosStr,
      Preco: parseFloat(valorPlantao) || 0,
      ValorPlantao: parseFloat(valorPlantao) || 0,
      Turno: turno,
      Cursos: cursos,
      StatusPagamento: statusPagamento,
      Aprovada: false,
      Disponivel: true,
      PlanoProfissional: planoProfissional,
      PlanoDestaque: planoDestaque
    };

    if (coren) campos.COREN = coren;

    const subsArray = subespecialidades.split(' | ').filter(function(s) { return s; });
    if (subsArray.length > 0) campos.Subespecialidades = subsArray;

    if (indicadoPor) campos.IndicadoPor = indicadoPor;

    // ========== 3. CRIA OU ATUALIZA ==========
    let recordId;
    let foiCriado = false;
    let respostaAirtable;

    if (registroExistente) {
      recordId = registroExistente.id;
      const updateUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}/${recordId}`;

      const updateResp = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: campos, typecast: true })
      });
      respostaAirtable = await updateResp.json();

      if (!updateResp.ok) {
        console.error('Airtable PATCH erro:', JSON.stringify(respostaAirtable));
        return jsonResp({
          error: 'Falha ao atualizar no Airtable',
          detalhe: respostaAirtable
        }, 502);
      }
    } else {
      const createUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}`;

      const createResp = await fetch(createUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: campos, typecast: true })
      });
      respostaAirtable = await createResp.json();

      if (!createResp.ok) {
        console.error('Airtable POST erro:', JSON.stringify(respostaAirtable));
        return jsonResp({
          error: 'Falha ao criar no Airtable',
          detalhe: respostaAirtable
        }, 502);
      }

      recordId = respostaAirtable.id;
      foiCriado = true;
    }

    // ========== 4. UPLOAD DA FOTO (com log detalhado) ==========
    let fotoEnviada = false;
    let fotoErro = null;

    if (foto && foto.size > 0 && recordId) {
      try {
        await subirFotoAirtable(AIRTABLE_API_KEY, recordId, foto);
        fotoEnviada = true;
      } catch (err) {
        fotoErro = String(err && err.message ? err.message : err);
        console.error("Erro ao subir foto:", fotoErro);
      }
    } else {
      fotoErro = !foto ? 'Campo foto vazio'
               : !recordId ? 'recordId não foi criado'
               : 'Arquivo com tamanho 0';
    }

    // ========== 5. NOTIFICA TELEGRAM ==========
    await notificarTelegram(context, {
      titulo: foiCriado
        ? (plano === 'gratis' ? "💜 Novo cadastro GRÁTIS" : "🎉 Novo cadastro " + plano.toUpperCase())
        : (plano === 'gratis' ? "💜 Cadastro GRÁTIS atualizado" : "🎉 Cadastro " + plano.toUpperCase() + " atualizado"),
      nome: nome,
      whatsapp: whatsapp,
      cpf: cpf,
      profissao: especialidade,
      plano: plano,
      bio: bio,
      subespecialidades: subespecialidades,
      indicadoPor: indicadoPor,
      recordId: recordId,
      fotoEnviada: fotoEnviada,
      fotoErro: fotoErro
    });

    return jsonResp({
      ok: true,
      recordId: recordId,
      criado: foiCriado,
      fotoEnviada: fotoEnviada,
      fotoErro: fotoErro,
      precisaPagar: (plano === 'profissional' || plano === 'destaque')
    }, 200);

  } catch (err) {
    console.error("Erro cadastro:", err);
    return jsonResp({
      ok: false,
      error: 'Falha no processamento',
      detalhe: String(err && err.message ? err.message : err)
    }, 500);
  }
}

// ========== HELPERS ==========
function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

function escapeFormula(str) {
  return String(str || '').replace(/"/g, '\\"');
}

// ========== UPLOAD DA FOTO (COM LOG) ==========
async function subirFotoAirtable(apiKey, recordId, file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const tamanhoKB = Math.round(bytes.length / 1024);

  console.log('📸 Tentando subir foto:', tamanhoKB + 'KB, tipo:', file.type, 'nome:', file.name);

  // Codificação base64 robusta
  let binary = '';
  const chunkSize = 4096;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);

  console.log('📸 Base64 gerado:', Math.round(base64.length / 1024) + 'KB');

  const uploadUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}/${recordId}/Foto/uploadAttachment`;

  const resp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contentType: file.type || 'image/jpeg',
      filename: 'foto.jpg',
      file: base64
    })
  });

  if (!resp.ok) {
    const erro = await resp.text();
    console.error('📸 Upload falhou:', resp.status, erro.substring(0, 500));
    throw new Error(`[${resp.status}] ${erro.substring(0, 250)}`);
  }

  const respData = await resp.json();
  console.log('📸 Foto enviada:', JSON.stringify(respData).substring(0, 200));
  return true;
}

// ========== NOTIFICAÇÃO TELEGRAM ==========
async function notificarTelegram(context, dados) {
  try {
    const token = context.env.TELEGRAM_BOT_TOKEN;
    const chatId = context.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      console.log("Telegram não configurado");
      return;
    }

    const agora = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });

    const planoTexto = dados.plano === 'gratis' ? 'Grátis'
                     : dados.plano === 'profissional' ? 'Profissional'
                     : dados.plano === 'destaque' ? 'Destaque' : dados.plano;

    let msg = `*${dados.titulo}*\n\n`;
    msg += `👤 *Nome:* ${dados.nome}\n`;
    msg += `📱 *WhatsApp:* ${dados.whatsapp}\n`;
    if (dados.cpf) msg += `🆔 *CPF:* ${dados.cpf}\n`;
    if (dados.profissao) msg += `💼 *Atuação:* ${dados.profissao}\n`;
    msg += `⭐ *Plano:* ${planoTexto}\n`;
    if (dados.bio) msg += `\n📝 *Bio:* ${dados.bio.substring(0, 180)}${dados.bio.length > 180 ? '...' : ''}\n`;
    if (dados.subespecialidades) msg += `\n🏷️ *Especialidades:* ${dados.subespecialidades}\n`;
    if (dados.indicadoPor) msg += `\n🎁 *Indicada por:* ${dados.indicadoPor}\n`;

    // Foto com detalhe de erro
    if (dados.fotoEnviada !== undefined) {
      msg += `\n📸 *Foto:* ${dados.fotoEnviada ? '✅ enviada' : '❌ não enviada'}\n`;
      if (!dados.fotoEnviada && dados.fotoErro) {
        msg += `⚠️ *Erro:* ${String(dados.fotoErro).substring(0, 200)}\n`;
      }
    }

    msg += `\n🕒 ${agora}`;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: "Markdown",
        disable_web_page_preview: true
      })
    });
  } catch (e) {
    console.error("Telegram:", e);
  }
}