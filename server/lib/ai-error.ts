/**
 * Converte erros da OpenAI em mensagens claras para o usuário.
 * Retorna { status, message } apropriados para a resposta HTTP.
 */
export function mapAiError(error: any, fallback: string): { status: number; message: string } {
  const status = error?.status ?? error?.response?.status;
  const code = error?.code ?? error?.error?.code ?? error?.response?.data?.error?.code;
  const raw = String(error?.message || "");

  // Conta sem créditos / quota esgotada (código estruturado da OpenAI ou texto específico)
  if (code === "insufficient_quota" || /no credits remaining|insufficient_quota|exceeded your current quota/i.test(raw)) {
    return {
      status: 503,
      message: "IA temporariamente indisponível: a conta OpenAI está sem créditos. Avise o administrador para repor os créditos.",
    };
  }
  // Demais 429 = rate limit temporário da OpenAI (não é falta de créditos)
  if (status === 429) {
    return {
      status: 503,
      message: "IA temporariamente sobrecarregada (limite de requisições da OpenAI). Tente novamente em alguns instantes.",
    };
  }
  // Chave ausente (SDK lança "Missing credentials ... OPENAI_API_KEY" sem status HTTP)
  if (/missing credentials|apiKey.*(missing|not set)|OPENAI_API_KEY/i.test(raw)) {
    return {
      status: 503,
      message: "IA indisponível: chave da OpenAI não configurada no servidor. Avise o administrador.",
    };
  }
  // Chave inválida
  if (status === 401 || code === "invalid_api_key" || /invalid api key|incorrect api key/i.test(raw)) {
    return {
      status: 503,
      message: "IA indisponível: chave da OpenAI inválida. Avise o administrador.",
    };
  }
  return { status: 500, message: raw || fallback };
}
