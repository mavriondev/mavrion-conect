const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/jspdf.es.min-CDRw2BAW.js","assets/index-DGd4-8aL.js","assets/index-DWj547BF.css"])))=>i.map(i=>d[i]);
import{u as w,r as y,j as t,B as P,h as D,_ as f}from"./index-DGd4-8aL.js";import{D as z}from"./download-BPeOuqGR.js";const c="#1a365d",C=`
  * { box-sizing: border-box; }
  .doc-page {
    width: 794px; background: #fff; padding: 64px 56px 72px;
    font-family: 'Georgia', 'Times New Roman', serif; color: #1a1a1a;
    line-height: 1.75; font-size: 13px;
  }
  .doc-cover {
    min-height: 500px; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center;
    border: 2px solid ${c}; padding: 80px 48px; margin-bottom: 48px;
  }
  .doc-cover h1 {
    font-size: 32px; font-weight: 700; color: ${c};
    margin: 0 0 8px; letter-spacing: -0.5px;
  }
  .doc-cover .subtitle {
    font-size: 16px; color: #4a5568; font-style: italic; margin-bottom: 32px;
  }
  .doc-cover .meta {
    font-size: 11px; color: #718096; line-height: 1.8;
  }
  .doc-section { margin-bottom: 36px; page-break-inside: avoid; }
  .doc-section h2 {
    font-size: 19px; font-weight: 700; color: ${c};
    border-bottom: 2px solid ${c}; padding-bottom: 6px;
    margin: 0 0 16px;
  }
  .doc-section h3 {
    font-size: 15px; font-weight: 700; color: #2d3748;
    margin: 20px 0 10px;
  }
  .doc-section p {
    margin: 0 0 12px; text-align: justify;
  }
  .doc-section ul, .doc-section ol {
    margin: 8px 0 14px; padding-left: 24px;
  }
  .doc-section li { margin-bottom: 5px; line-height: 1.7; }
  .doc-section li::marker { color: ${c}; }
  .doc-section strong { font-weight: 700; color: #1a202c; }
  .doc-section em { font-style: italic; color: #4a5568; }
  table.doc-table {
    width: 100%; border-collapse: collapse; margin: 12px 0 20px; font-size: 11.5px;
  }
  table.doc-table th {
    background: #edf2f7; padding: 8px 10px; text-align: left;
    font-weight: 700; border: 1px solid #cbd5e0; color: #2d3748; font-size: 11px;
  }
  table.doc-table td {
    padding: 6px 10px; border: 1px solid #e2e8f0; vertical-align: top;
  }
  table.doc-table tr:nth-child(even) td { background: #f7fafc; }
  .severity-red { color: #c53030; font-weight: 700; }
  .severity-yellow { color: #b7791f; font-weight: 700; }
  .severity-green { color: #276749; font-weight: 700; }
  .flow-box {
    background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 6px;
    padding: 16px 20px; margin: 12px 0 20px; font-family: 'Courier New', monospace;
    font-size: 12px; line-height: 2; color: #2d3748; white-space: pre-wrap;
  }
  .gap-card {
    border-left: 4px solid; padding: 12px 16px; margin: 12px 0;
    background: #f7fafc; border-radius: 0 6px 6px 0;
  }
  .gap-card.red { border-color: #c53030; }
  .gap-card.yellow { border-color: #d69e2e; }
  .gap-card.green { border-color: #38a169; }
  .gap-card .gap-title { font-weight: 700; margin-bottom: 4px; }
  .gap-card p { margin: 4px 0; font-size: 12px; }
`,h=new Date().toLocaleDateString("pt-BR",{day:"2-digit",month:"long",year:"numeric"});function b(){return`<style>${C}</style><div class="doc"><h1>Mavrion Connect — Arquitetura</h1><p>Atualizado em ${h}.</p><h2>Módulos ativos</h2><ul><li>Dashboard: indicadores de ativos e empresas.</li><li>Prospecção e empresas: consulta e cadastro de empresas.</li><li>Ativos: cadastro, documentos, mapas e enriquecimento.</li><li>Jazidas: ANM, SCM, SEI, SIGEF, geologia, restrições e pesquisa complementar.</li><li>Relatórios: visão dos cadastros e PDF técnico por ativo.</li><li>Configurações: usuários, conectores e acompanhamento de erros.</li></ul><h2>Fluxo de dados</h2><p>Interface → API autenticada → serviços públicos e Hub API → persistência dos resultados → catálogo de evidências e relatório determinístico.</p><h2>Documentos</h2><p>Arquivos de ativos e empresas são mantidos no armazenamento existente, com controle de acesso por organização.</p><h2>Preservação histórica</h2><p>As definições das tabelas legadas foram mantidas para preservar os dados existentes. Não há migração destrutiva nesta limpeza.</p></div>`}async function j(){const{default:l}=await f(async()=>{const{default:o}=await import("./jspdf.es.min-CDRw2BAW.js").then(e=>e.j);return{default:o}},__vite__mapDeps([0,1,2])),{default:s}=await f(async()=>{const{default:o}=await import("./html2canvas.esm-DXEQVQnt.js");return{default:o}},[]),a=document.createElement("div");a.style.cssText="position:fixed;top:-9999px;left:-9999px;z-index:-1;";const d=document.createElement("div");d.innerHTML=b(),a.appendChild(d),document.body.appendChild(a);const p=d.querySelector(".doc-page");if(!p){document.body.removeChild(a);return}try{const o=await s(p,{scale:2,useCORS:!0,backgroundColor:"#ffffff"}),e=new l({orientation:"portrait",unit:"mm",format:"a4"}),r=e.internal.pageSize.getWidth(),n=e.internal.pageSize.getHeight(),u=n/r*o.width;let m=0,g=0;for(;m<o.height;){const x=Math.min(u,o.height-m),i=document.createElement("canvas");i.width=o.width,i.height=x,i.getContext("2d").drawImage(o,0,m,i.width,x,0,0,i.width,x),g>0&&e.addPage();const v=x/i.width*r;e.addImage(i.toDataURL("image/png"),"PNG",0,0,r,v),e.setFontSize(7.5),e.setTextColor(160,160,160),e.setDrawColor(220,220,220),e.line(15,n-12,r-15,n-12),e.text("Mavrion Connect — Documento de Arquitetura",15,n-7),e.text(`Página ${g+1}`,r/2,n-7,{align:"center"}),e.text(h,r-15,n-7,{align:"right"}),m+=u,g++}e.save("Mavrion_Conect_Arquitetura.pdf")}finally{document.body.removeChild(a)}}function N(){const{toast:l}=w(),[s,a]=y.useState(!1),d=async()=>{a(!0);try{await j(),l({title:"PDF gerado com sucesso",description:"O download deve iniciar automaticamente."})}catch(p){l({title:"Erro ao gerar PDF",description:String(p),variant:"destructive"})}finally{a(!1)}};return t.jsxs("div",{className:"p-6 max-w-5xl mx-auto space-y-6",children:[t.jsxs("div",{className:"flex items-center justify-between",children:[t.jsxs("div",{children:[t.jsx("h1",{className:"text-2xl font-bold","data-testid":"text-arquitetura-title",children:"Documento de Arquitetura"}),t.jsx("p",{className:"text-sm text-muted-foreground",children:"Mapa completo de conexões entre módulos do Mavrion Connect"})]}),t.jsxs(P,{onClick:d,disabled:s,"data-testid":"btn-export-pdf",children:[s?t.jsx(D,{className:"w-4 h-4 mr-2 animate-spin"}):t.jsx(z,{className:"w-4 h-4 mr-2"}),s?"Gerando PDF...":"Exportar PDF"]})]}),t.jsx("div",{className:"bg-white rounded-xl border shadow-sm overflow-auto",children:t.jsx("div",{className:"mx-auto",style:{maxWidth:794},dangerouslySetInnerHTML:{__html:b()}})})]})}export{N as default};
