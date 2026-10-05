# GesTI

Aplicação de gestão de TI desenvolvida com React, Vite, Tailwind CSS e Motion. A interface usa uma paleta clara e quente, tipografia editorial, espaçamento amplo, interações discretas e imagens fotográficas.

Inclui painel operacional, central de chamados, controle de estoque, prestação de contas, cadastro da empresa, diretório da equipe e página institucional.

## Assistente interno de IA

O chat do GesTI usa a Edge Function `tigest-assistant` no Supabase e a API Gemini `generateContent` (modelo `gemini-3.5-flash-lite`). A função exige JWT, valida a associação da pessoa à empresa em cada solicitação e consulta somente os registros liberados pelas capacidades dessa pessoa. Não usa busca na web nem executa alterações no sistema.

Para habilitar respostas, configure o segredo `GEMINI_API_KEY` em **Supabase → Project Settings → Edge Functions → Secrets**. A chave fica no servidor e nunca deve ser adicionada ao frontend ou ao arquivo `.env.local`. O plano gratuito do Gemini tem limites e, segundo a documentação do Google, pode usar o conteúdo enviado para melhorar seus produtos; avalie isso antes de enviar dados empresariais reais.

## Compatibilidade do backend

A marca da interface e o nome do pacote foram atualizados para GesTI. O identificador legado da Edge Function `tigest-assistant` e as chaves locais `tigest-*` são mantidos para preservar a integração Supabase e os dados de instalações existentes.

## Executar localmente

```bash
npm install
npm run dev
```

## Recursos do protótipo

- Abertura e acompanhamento de chamados de suporte com prioridade automática, SLA por prioridade (Urgente 4 h · Alta 8 h · Baixa 40 h) e histórico completo de atendimentos.
- Cadastro de componentes de TI, níveis mínimos, movimentações de entrada e saída e exportação CSV.
- Registro de despesas e aprovação por perfil, com gráficos de custos.
- Emissão de notas fiscais com livro fiscal encadeado (controle anti caixa 2), numeração sequencial por série e baixa automática de estoque.
- Cadastro dos dados da empresa e pessoas nos níveis Admin, Dono da empresa, TI, Gerência, Supervisor e Funcionário, com permissões declarativas por perfil.
- Página institucional com informações e contatos da empresa.
- Persistência dos cadastros no armazenamento local do navegador, com backup/restauração em JSON e sincronização entre abas.
- Transições suaves entre telas, animações de entrada ao rolar, microinterações de hover e respeito à preferência de movimento reduzido.

## Arquitetura

```
src/
├── main.jsx            # bootstrap + ErrorBoundary global
├── App.jsx             # orquestrador: rotas (hash), permissões, modais
├── store.js            # "backend" local: orgs, sessão, logs, livro fiscal
├── hooks.js            # useSavedState (debounce + erro de quota), useTheme
├── toast.js            # contexto de notificações
├── utils.js            # constantes de domínio, formatação, exportação
├── shared.jsx          # primitivas de UI (Modal, Badge, toasts…)
├── AuthScreen.jsx      # login + cadastro de empresa
├── InvoicePage.jsx     # notas fiscais + livro fiscal
├── ExpenseCharts.jsx   # gráficos de custos (Recharts)
├── HtmlFunctions.jsx   # sidebar
└── pages/              # uma página por arquivo (lazy quando pesada)
```

- **Roteamento** por hash (`#/chamados`, `#/estoque`…) — F5 mantém a página.
- **Code splitting**: notas fiscais e Custos (Recharts) carregam sob demanda.
- **Error boundary por página**: erro pontual não derruba o app.

## Segurança e dados

- Senhas com **PBKDF2-SHA256** (WebCrypto, 210 mil iterações, salt aleatório por usuário); contas antigas migram automaticamente no primeiro login.
- Sessão expira após **12 horas**; bloqueio de força bruta no login (5 tentativas → 30 s de espera).
- Troca da própria senha e redefinição pela administração na aba Empresa.
- O armazenamento é local ao navegador por design (protótipo); erros de quota são sinalizados ao usuário em vez de silenciados.

## Qualidade

```bash
npm run lint   # Oxlint
npm test       # Vitest — funções puras: prioridade, validações, livro fiscal
npm run build  # build de produção
```

O CI (GitHub Actions) roda lint, testes e build em cada push e pull request.

## Comandos

- `npm run dev`: inicia o servidor de desenvolvimento.
- `npm run lint`: verifica o código com Oxlint.
- `npm test`: roda os testes unitários (Vitest).
- `npm run build`: gera os arquivos de produção em `dist/`.
- `npm run preview`: exibe localmente a versão de produção.
