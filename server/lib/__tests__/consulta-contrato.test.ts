import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  provenienciaCnpj,
  cnpjVinculoConfirmado,
  montarIdentificadorCnpj,
  aplicarRebaixamento,
  termoEhProcessoAnm,
  classificarVinculoDiario,
  separarPublicacoesDiario,
  derivarMetaModulo,
  type MetaConsulta,
} from "../consulta-contrato";
import { utmSridFromLonLat, utmZoneFromLon } from "../utm";

describe("provenienciaCnpj — documento oficial vs resolução por nome", () => {
  it("SCM/TAH/DSProcesso/tah_dados_abertos são documento oficial", () => {
    for (const f of ["SCM", "TAH", "DSProcesso", "tah_dados_abertos"]) {
      assert.equal(provenienciaCnpj(f), "documento_oficial", f);
    }
  });
  it("CNPJA e métodos cnpja_* são resolução por nome", () => {
    for (const f of ["CNPJA", "cnpja_name_search_unique", "cnpja_matriz_ou_nome_exato", "smart_resolve"]) {
      assert.equal(provenienciaCnpj(f), "resolvido_por_nome", f);
    }
  });
  it("manual é cadastro do usuário; vazio/cache é desconhecida", () => {
    assert.equal(provenienciaCnpj("manual"), "cadastro_usuario");
    assert.equal(provenienciaCnpj(null), "desconhecida");
    assert.equal(provenienciaCnpj("cache"), "desconhecida");
  });
  it("vínculo confirmado: documento oficial e cadastro do usuário; não confirmado: nome/desconhecida", () => {
    assert.equal(cnpjVinculoConfirmado("documento_oficial"), true);
    assert.equal(cnpjVinculoConfirmado("cadastro_usuario"), true);
    assert.equal(cnpjVinculoConfirmado("resolvido_por_nome"), false);
    assert.equal(cnpjVinculoConfirmado("desconhecida"), false);
  });
  it("montarIdentificadorCnpj registra a origem crua", () => {
    const id = montarIdentificadorCnpj("11222333000181", "CNPJA");
    assert.equal(id.tipo, "cnpj");
    assert.equal(id.proveniencia, "resolvido_por_nome");
    assert.equal(id.origem, "CNPJA");
  });
});

describe("aplicarRebaixamento — registro sem identificador confirmado vira T3 rotulado", () => {
  it("rebaixa T1 → T3 preservando o original", () => {
    const meta: MetaConsulta = {
      estadoConsulta: "registro_existente",
      tierFonte: "T1",
      vinculoConfirmado: false,
      motivoVinculoNaoConfirmado: "CNPJ resolvido por nome via agregador",
    };
    const r = aplicarRebaixamento(meta);
    assert.equal(r.tierFonte, "T3");
    assert.equal(r.tierFonteOriginal, "T1");
    assert.match(r.rebaixadoMotivo!, /resolvido por nome/);
  });
  it("não mexe em vínculo confirmado", () => {
    const meta: MetaConsulta = { estadoConsulta: "registro_existente", tierFonte: "T1", vinculoConfirmado: true };
    assert.equal(aplicarRebaixamento(meta).tierFonte, "T1");
  });
});

describe("termoEhProcessoAnm — variantes do número casam, nome não", () => {
  it("casa as duas grafias contra o processo de referência", () => {
    assert.equal(termoEhProcessoAnm("886.371/2008", "886371/2008"), true);
    assert.equal(termoEhProcessoAnm("886371/2008", "886.371/2008"), true);
  });
  it("nome de titular nunca é termo de processo", () => {
    assert.equal(termoEhProcessoAnm("Mineração Aurora Ltda", "886371/2008"), false);
  });
  it("número de OUTRO processo não casa", () => {
    assert.equal(termoEhProcessoAnm("800.123/2010", "886371/2008"), false);
  });
  it("sem processo de referência aceita o padrão NNN.NNN/AAAA", () => {
    assert.equal(termoEhProcessoAnm("886.371/2008"), true);
    assert.equal(termoEhProcessoAnm("Aurora"), false);
  });
});

describe("classificarVinculoDiario / separarPublicacoesDiario", () => {
  const processo = "886.371/2008";
  it("payload novo com vinculo gravado é respeitado", () => {
    const pub = { vinculo: { por: "nome_titular", termo: "Aurora", confirmado: false } };
    const v = classificarVinculoDiario(pub, processo);
    assert.equal(v.confirmado, false);
    assert.equal(v.por, "nome_titular");
  });
  it("cache legado: deriva do termoBusca", () => {
    assert.equal(classificarVinculoDiario({ termoBusca: "886371/2008" }, processo).confirmado, true);
    assert.equal(classificarVinculoDiario({ termoBusca: "Mineração Aurora" }, processo).confirmado, false);
  });
  it("termosCasados múltiplos: basta um termo de processo para confirmar", () => {
    const pub = { termoBusca: "Mineração Aurora", termosCasados: ["Mineração Aurora", "886.371/2008"] };
    assert.equal(classificarVinculoDiario(pub, processo).confirmado, true);
  });
  it("publicação sem termo registrado é conservadoramente não confirmada", () => {
    const v = classificarVinculoDiario({}, processo);
    assert.equal(v.confirmado, false);
    assert.equal(v.por, "desconhecido");
  });
  it("separa confirmadas de não confirmadas", () => {
    const payload = {
      publicacoes: [
        { id: 1, termoBusca: "886.371/2008" },
        { id: 2, termoBusca: "Mineração Aurora Ltda" },
        { id: 3, vinculo: { por: "processo_anm", termo: "886371/2008", confirmado: true } },
      ],
    };
    const { confirmadas, naoConfirmadas } = separarPublicacoesDiario(payload, processo);
    assert.deepEqual(confirmadas.map((p: any) => p.id), [1, 3]);
    assert.deepEqual(naoConfirmadas.map((p: any) => p.id), [2]);
  });
});

describe("derivarMetaModulo — três estados a partir de payloads legados", () => {
  it("payload ausente = não consultada", () => {
    assert.equal(derivarMetaModulo("anmCfem", null).estadoConsulta, "nao_consultada");
  });
  it("disponivel=false ou erro = não consultada (falha ≠ sem registro)", () => {
    assert.equal(derivarMetaModulo("anmDou", { disponivel: false }).estadoConsulta, "nao_consultada");
    assert.equal(derivarMetaModulo("sigefParcelas", { erro: "timeout" }).estadoConsulta, "nao_consultada");
  });
  it("DOU legado: só publicação com vínculo confirmado conta como registro", () => {
    const soNome = { disponivel: true, publicacoes: [{ termoBusca: "Mineração Aurora" }] };
    assert.equal(derivarMetaModulo("anmDou", soNome, "886371/2008").estadoConsulta, "consultada_sem_registro");
    const comProcesso = { disponivel: true, publicacoes: [{ termoBusca: "886.371/2008" }] };
    assert.equal(derivarMetaModulo("anmDou", comProcesso, "886371/2008").estadoConsulta, "registro_existente");
  });
  it("payload novo com estadoConsulta explícito é respeitado", () => {
    const meta = derivarMetaModulo("anmCfem", { estadoConsulta: "consultada_sem_registro", tierFonte: "T1", janelaCobertura: "anos 2004–2025" });
    assert.equal(meta.estadoConsulta, "consultada_sem_registro");
    assert.equal(meta.janelaCobertura, "anos 2004–2025");
  });
  it("tier padrão por módulo: DOU é T2, TAH é T1", () => {
    assert.equal(derivarMetaModulo("anmDou", null).tierFonte, "T2");
    assert.equal(derivarMetaModulo("anmTah", null).tierFonte, "T1");
  });
});

describe("utm — zona derivada da longitude/latitude", () => {
  it("zonas do Brasil: Acre 19S, Brasília 23S, Fernando de Noronha 25S", () => {
    assert.equal(utmSridFromLonLat(-70.5, -8.0), 32719);
    assert.equal(utmSridFromLonLat(-47.9, -15.8), 32723);
    assert.equal(utmSridFromLonLat(-32.4, -3.85), 32725);
  });
  it("hemisfério norte (Roraima) usa 326xx", () => {
    assert.equal(utmSridFromLonLat(-60.7, 2.8), 32620);
  });
  it("zona é limitada a 1–60", () => {
    assert.equal(utmZoneFromLon(-180), 1);
    assert.equal(utmZoneFromLon(179.99), 60);
  });
});

import { cnpjValido } from "../consulta-contrato";

describe("situacaoRegistro obrigatória no contrato", () => {
  it("derivação legada e payload novo sem situação emitem o campo", () => {
    assert.equal(derivarMetaModulo("anmTah", null).situacaoRegistro, null);
    const comProcesso = { publicacoes: [{ termoBusca: "886.371/2008" }] };
    assert.equal(derivarMetaModulo("anmDou", comProcesso, "886371/2008").situacaoRegistro, "indeterminada");
    const soNome = { publicacoes: [{ termoBusca: "Empresa X" }] };
    assert.equal(derivarMetaModulo("anmDou", soNome, "886371/2008").situacaoRegistro, null);
    // payload novo com registro e sem situação explícita ⇒ indeterminada
    assert.equal(
      derivarMetaModulo("anmCfem", { estadoConsulta: "registro_existente", tierFonte: "T1" }).situacaoRegistro,
      "indeterminada",
    );
    // fonte que informa situação é respeitada
    assert.equal(
      derivarMetaModulo("anmCertidoesTitular", { estadoConsulta: "registro_existente", situacaoRegistro: "aberta", tierFonte: "T1" }).situacaoRegistro,
      "aberta",
    );
  });
});

describe("cnpjValido — dígitos verificadores", () => {
  it("aceita CNPJ válido e rejeita repetidos, checksum errado, curto e nulo", () => {
    assert.equal(cnpjValido("11.222.333/0001-81"), true);
    assert.equal(cnpjValido("11222333000181"), true);
    assert.equal(cnpjValido("11111111111111"), false);
    assert.equal(cnpjValido("11222333000182"), false);
    assert.equal(cnpjValido("123"), false);
    assert.equal(cnpjValido(null), false);
  });
});
