import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import type { Asset, Company } from "@shared/schema";

export default function RelatoriosPage() {
  const assets = useQuery<Asset[]>({ queryKey: ["/api/assets"], queryFn: () => apiRequest("GET", "/api/assets").then(r => r.json()) });
  const companies = useQuery<Company[]>({ queryKey: ["/api/companies"], queryFn: () => apiRequest("GET", "/api/companies").then(r => r.json()) });
  if (assets.isLoading || companies.isLoading) return <div className="p-6">Carregando relatórios…</div>;
  if (assets.isError || companies.isError) return <div className="p-6" role="alert">Não foi possível carregar os dados dos relatórios. <Button variant="outline" onClick={() => { assets.refetch(); companies.refetch(); }}>Tentar novamente</Button></div>;
  const rows = assets.data || [];
  const mines = rows.filter(a => a.type === "MINA");
  const types = Array.from(new Set(rows.map(a => a.type))).sort();
  const labels: Record<string, string> = { MINA: "Jazidas", TERRA: "Fazendas", AGRO: "Agronegócio", NEGOCIO: "Negócios", FII_CRI: "FII / CRI", DESENVOLVIMENTO: "Desenvolvimento" };
  return <div className="p-4 md:p-6 space-y-6">
    <div><h1 className="text-2xl font-semibold">Relatórios</h1><p className="text-sm text-muted-foreground">Resumo dos cadastros de ativos e empresas.</p></div>
    <div className="grid gap-4 sm:grid-cols-3">
      {[['Ativos cadastrados', rows.length], ['Jazidas cadastradas', mines.length], ['Empresas cadastradas', companies.data?.length || 0]].map(([label, value]) => <Card key={label}><CardHeader><CardTitle className="text-sm">{label}</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{value}</CardContent></Card>)}
    </div>
    <Card><CardHeader><CardTitle>Ativos por tipo</CardTitle></CardHeader><CardContent>
      {types.length === 0 ? <p>Nenhum ativo cadastrado.</p> : <table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2">Tipo</th><th>Quantidade</th><th>Área cadastrada (ha)</th></tr></thead><tbody>{types.map(type => { const list = rows.filter(a => a.type === type); const area = list.reduce((sum, a) => sum + (a.areaHa || 0), 0); return <tr key={type} className="border-b"><td className="py-3">{labels[type] || type}</td><td>{list.length}</td><td>{area.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td></tr>; })}</tbody></table>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Relatórios técnicos de jazidas</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">Abra uma jazida para consultar as evidências e exportar o relatório PDF do ativo.</p>{mines.length === 0 ? <p>Nenhuma jazida cadastrada.</p> : mines.map(a => <div key={a.id} className="flex items-center justify-between gap-3 border-b py-2"><span>{a.title}</span><Link href={"/ativos/" + a.id}><Button variant="outline" size="sm">Abrir jazida</Button></Link></div>)}</CardContent></Card>
  </div>;
}
