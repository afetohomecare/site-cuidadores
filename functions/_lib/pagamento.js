import { getAsaasConfig } from './asaas.js';

export function asaasDesativado(env) {
  const v = String(env.ASAAS_DESATIVADO || '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'sim' || v === 'on';
}

export function getMpAccessToken(env) {
  const ambiente = String(env.MP_AMBIENTE || env.MERCADOPAGO_AMBIENTE || 'producao').toLowerCase();
  const sandbox = ambiente === 'sandbox' || ambiente === 'test' || ambiente === 'teste';
  if (sandbox) {
    return env.MP_ACCESS_TOKEN_SANDBOX || env.MP_ACCESS_TOKEN || env.MERCADOPAGO_ACCESS_TOKEN || '';
  }
  return env.MP_ACCESS_TOKEN_PRODUCAO || env.MP_ACCESS_TOKEN || env.MERCADOPAGO_ACCESS_TOKEN || '';
}

export function getMpPublicKey(env) {
  const ambiente = String(env.MP_AMBIENTE || env.MERCADOPAGO_AMBIENTE || 'producao').toLowerCase();
  const sandbox = ambiente === 'sandbox' || ambiente === 'test' || ambiente === 'teste';
  if (sandbox) {
    return env.MP_PUBLIC_KEY_SANDBOX || env.MP_PUBLIC_KEY || '';
  }
  return env.MP_PUBLIC_KEY_PRODUCAO || env.MP_PUBLIC_KEY || '';
}

export function getMpWebhookSecret(env) {
  const ambiente = String(env.MP_AMBIENTE || env.MERCADOPAGO_AMBIENTE || 'producao').toLowerCase();
  const sandbox = ambiente === 'sandbox' || ambiente === 'test' || ambiente === 'teste';
  if (sandbox) {
    return env.MP_WEBHOOK_SECRET_SANDBOX || env.MP_WEBHOOK_SECRET || env.MERCADOPAGO_WEBHOOK_SECRET || '';
  }
  return env.MP_WEBHOOK_SECRET_PRODUCAO || env.MP_WEBHOOK_SECRET || env.MERCADOPAGO_WEBHOOK_SECRET || '';
}

export function asaasDisponivelParaNovos(env) {
  if (asaasDesativado(env)) return false;
  const asaas = getAsaasConfig(env);
  return !!asaas.apiKey;
}

export function fallbackAsaasAtivo(env) {
  const v = String(env.PAGAMENTO_FALLBACK_ASAAS || 'true').toLowerCase().trim();
  if (v === '0' || v === 'false' || v === 'nao' || v === 'não' || v === 'off') return false;
  return asaasDisponivelParaNovos(env);
}

export function gatewayAtivo(env) {
  const g = String(env.PAGAMENTO_GATEWAY || '').toLowerCase().trim();
  const mpOk = !!getMpAccessToken(env);
  const asaasOk = asaasDisponivelParaNovos(env);

  if (g === 'asaas') return asaasOk ? 'asaas' : (mpOk ? 'mercadopago' : 'asaas');
  if (g === 'mercadopago' || g === 'mercado_pago' || g === 'mp') {
    return mpOk ? 'mercadopago' : (asaasOk ? 'asaas' : 'mercadopago');
  }
  if (g === 'auto' && mpOk) return 'mercadopago';
  if (asaasDesativado(env) && mpOk) return 'mercadopago';
  return 'asaas';
}

export function emailPagador(cpfLimpo, cuidadorId) {
  const cpf = String(cpfLimpo || '').replace(/\D/g, '');
  if (cpf.length === 11) return cpf + '@afeto.app';
  const id = String(cuidadorId || 'cliente').replace(/[^a-zA-Z0-9]/g, '').slice(0, 18);
  return 'cuidadora.' + (id || 'afeto') + '@afeto.app';
}

export async function patchCuidador(env, cuidadorId, body) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !cuidadorId) return false;
  const resp = await fetch(
    env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId),
    {
      method: 'PATCH',
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );
  if (resp.ok) return true;

  const txt = await resp.text().catch(function () { return ''; });
  const semMp = Object.assign({}, body);
  let tirou = false;
  Object.keys(semMp).forEach(function (k) {
    if (k.indexOf('mp_') === 0) {
      delete semMp[k];
      tirou = true;
    }
  });
  if (!tirou || Object.keys(semMp).length === 0) {
    console.warn('Falha PATCH cuidador:', resp.status, txt);
    return false;
  }
  const retry = await fetch(
    env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId),
    {
      method: 'PATCH',
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(semMp)
    }
  );
  if (!retry.ok) {
    console.warn('Falha PATCH cuidador (sem colunas MP):', retry.status, await retry.text().catch(function () { return ''; }));
  }
  return retry.ok;
}
