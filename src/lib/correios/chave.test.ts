import { afterEach, describe, expect, it, vi } from "vitest";
import { carregarChaves, dataValida, diasAte, somarDias } from "./chave";

// 09/11/2026 23:30 em Brasília = 10/11 02:30 UTC: ainda é dia 09 aqui.
const AGORA = new Date("2026-11-10T02:30:00Z");

describe("chave: prazos", () => {
  it("conta os dias no horário de Brasília", () => {
    expect(diasAte("2026-11-09", AGORA)).toBe(0);
    expect(diasAte("2026-11-12", AGORA)).toBe(3);
    expect(diasAte("2026-11-08", AGORA)).toBe(-1);
  });
  it("180 dias a partir de 09/11/2026 = 08/05/2027", () => {
    expect(somarDias("2026-11-09", 180)).toBe("2027-05-08");
    expect(diasAte("2027-05-08", AGORA)).toBe(180);
  });
  it("valida datas", () => {
    expect(dataValida("2027-05-08")).toBe(true);
    expect(dataValida("2027-02-30")).toBe(false);
    expect(dataValida("08/05/2027")).toBe(false);
    expect(dataValida(null)).toBe(false);
  });
});

describe("chave do ambiente: validade", () => {
  afterEach(() => vi.unstubAllEnvs());
  const adminCom = (paginas: unknown[][], total: number, erro: { code: string; message: string } | null = null) => {
    let i = 0;
    const q = {
      select: () => q,
      order: () => q,
      range: () => q,
      returns: async () => (erro ? { data: null, error: erro, count: null } : { data: paginas[i++] ?? [], error: null, count: total }),
    };
    return { from: () => q } as never;
  };
  const adminSemPainel = adminCom([[]], 0);

  it("sem CORREIOS_CHAVE_EXPIRA_EM a validade é desconhecida (null), não inventada", async () => {
    vi.stubEnv("CORREIOS_CHAVE_ACESSO", "x");
    vi.stubEnv("CORREIOS_CHAVE_EXPIRA_EM", "");
    const r = await carregarChaves(adminSemPainel);
    expect(r.ambiente?.expiraEm).toBeNull();
  });

  it("data no formato errado vira null", async () => {
    vi.stubEnv("CORREIOS_CHAVE_ACESSO", "x");
    vi.stubEnv("CORREIOS_CHAVE_EXPIRA_EM", "08/05/2027");
    expect((await carregarChaves(adminSemPainel)).ambiente?.expiraEm).toBeNull();
  });

  it("data válida é usada", async () => {
    vi.stubEnv("CORREIOS_CHAVE_ACESSO", "x");
    vi.stubEnv("CORREIOS_CHAVE_EXPIRA_EM", "2027-05-08");
    expect((await carregarChaves(adminSemPainel)).ambiente?.expiraEm).toBe("2027-05-08");
  });

  it("leitura de chaves cortada aborta em vez de cair na chave do ambiente", async () => {
    vi.stubEnv("CORREIOS_CHAVE_ACESSO", "x");
    await expect(carregarChaves(adminCom([[]], 1500))).rejects.toThrow(/incompleta/);
  });

  it("aviso em log quando a data vem no formato errado", async () => {
    vi.stubEnv("CORREIOS_CHAVE_ACESSO", "x");
    vi.stubEnv("CORREIOS_CHAVE_EXPIRA_EM", "08/05/2027");
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    await carregarChaves(adminSemPainel);
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining("CORREIOS_CHAVE_EXPIRA_EM inválida"));
    aviso.mockRestore();
  });

  it("erro de permissão ou timeout aborta; só tabela ausente cai no ambiente", async () => {
    vi.stubEnv("CORREIOS_CHAVE_ACESSO", "x");
    await expect(
      carregarChaves(adminCom([], 0, { code: "42501", message: "permission denied for table correios_config" })),
    ).rejects.toThrow(/permission/);
    await expect(
      carregarChaves(adminCom([], 0, { code: "57014", message: 'statement timeout on relation "correios_config"' })),
    ).rejects.toThrow(/timeout/);
    const r = await carregarChaves(adminCom([], 0, { code: "42P01", message: 'relation "correios_config" does not exist' }));
    expect(r.ambiente).not.toBeNull();
  });
});

