/**
 * Utilidades de NUP (Número Único de Protocolo, padrão federal) compartilhadas
 * entre servidor e cliente.
 *
 * Estrutura de um NUP de 17 dígitos: PPPPP.SSSSSS/AAAA-DD
 *   PPPPP  = prefixo da unidade protocolizadora (5 dígitos)
 *   SSSSSS = sequencial do protocolo (6 dígitos)
 *   AAAA   = ano (4 dígitos)
 *   DD     = dígitos verificadores (2)
 * NUPs antigos podem circular sem DV (15 dígitos). Processos ANM de antes da
 * digitalização podem estar no SEI sob OUTRO prefixo (unidades de distrito do
 * DNPM) e, portanto, outro DV — o sequencial+ano é o que identifica o processo.
 */

export interface NupEstruturado {
  /** Dígitos completos (15 ou 17) */
  digits: string;
  /** Prefixo da unidade protocolizadora (5 dígitos) */
  prefixo: string;
  /** Sequencial do protocolo (6 dígitos) */
  sequencial: string;
  /** Ano (4 dígitos) */
  ano: string;
  /** Dígitos verificadores (2), null em NUP de 15 dígitos */
  dv: string | null;
}

/**
 * Decompõe um NUP (formatado ou só dígitos) nos campos estruturais.
 * Aceita apenas 15 ou 17 dígitos — outros comprimentos não têm estrutura
 * conhecida e retornam null.
 */
export function parseNupEstruturado(input: string | null | undefined): NupEstruturado | null {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length !== 15 && digits.length !== 17) return null;
  return {
    digits,
    prefixo: digits.slice(0, 5),
    sequencial: digits.slice(5, 11),
    ano: digits.slice(11, 15),
    dv: digits.length === 17 ? digits.slice(15) : null,
  };
}

/** Um dígito verificador: pesos (len+1)→2 da esquerda p/ direita, 11−(soma mod 11), 10→0 e 11→1. */
function calcDigitoNup(nums: string): number {
  let soma = 0;
  for (let i = 0; i < nums.length; i++) {
    soma += Number(nums[i]) * (nums.length + 1 - i);
  }
  const d = 11 - (soma % 11);
  if (d === 10) return 0;
  if (d === 11) return 1;
  return d;
}

/**
 * Valida os dígitos verificadores de um NUP de 17 dígitos (algoritmo federal:
 * DV1 sobre os 15 dígitos base, DV2 sobre base+DV1). Calibrado com NUPs reais
 * da ANM: 48054.832070/2024-14 e 48405.850722/2012-23.
 * Retorna null quando não há exatamente 17 dígitos (nada a validar).
 */
export function validateNupDv(input: string | null | undefined): { valido: boolean; dvEsperado: string } | null {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length !== 17) return null;
  const base = digits.slice(0, 15);
  const dv1 = calcDigitoNup(base);
  const dv2 = calcDigitoNup(base + String(dv1));
  const dvEsperado = `${dv1}${dv2}`;
  return { valido: digits.slice(15) === dvEsperado, dvEsperado };
}
