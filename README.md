# Code AI Mobile v0.8

IDE mobile com assistente de IA integrado. Este build evolui o projeto
de uma interface demonstrativa para uma IDE funcional: editor real
(CodeMirror 6), detecção real de erros, sistema de arquivos com
persistência em IndexedDB, exportação/importação de projetos em ZIP,
preview funcional e um assistente de IA que faz chamadas reais (com
sua própria chave de API). Veja "O que funciona de verdade" abaixo —
nada aqui está marcado como pronto se for só uma simulação visual.

## Como executar

```bash
cd code-ai-mobile
npm start
```

Abre em `http://localhost:5173`. Não há passo de build: os módulos
JS são carregados como ESM direto do navegador, e bibliotecas de
terceiros (CodeMirror 6, acorn, JSZip) vêm de CDN (`esm.sh` e
`cdnjs.cloudflare.com`) — por isso é necessário estar **online** para
o app funcionar.

⚠️ **Não testado em navegador real neste momento**: este código foi
escrito num ambiente sem acesso à internet, então as importações via
CDN não puderam ser executadas/verificadas aqui. Teste no seu
dispositivo; se aparecer erro de versões conflitantes do CodeMirror
no console (algo como "Cannot use two instances of..."), me avise
para eu fixar versões compatíveis nos imports de `js/editor.js`.

## Correção importante do Preview — v0.7

O Preview agora monta um sistema de arquivos virtual para o projeto. Isso significa que referências locais como `css/style.css`, `js/app.js`, imagens, fontes, `@import`, `url()`, `import/export` de JavaScript e `import()` são resolvidas a partir da árvore do Explorer antes de o código ser executado no iframe. Assim, arquivos separados continuam funcionando juntos sem depender de o navegador conseguir acessar fisicamente a pasta do projeto.

Também foi corrigida a importação de arquivos binários comuns pelo ZIP (imagens, fontes, áudio e vídeo), preservando-os como `data:` URLs para uso no Preview.

## O que funciona de verdade

- **Editor (CodeMirror 6)**: syntax highlighting real para HTML/CSS/JS/JSON,
  numeração de linhas, autocomplete, indentação automática, seleção,
  busca e substituição (painel nativo do CodeMirror), atalhos de
  teclado (Ctrl+S salva, Ctrl+F busca, etc. via teclado físico).
- **Detecção de erros**: JS usa o parser `acorn` de verdade (erros de
  sintaxe reais) + heurística de variável possivelmente não definida
  (aviso, não erro — não é escopo completo tipo ESLint). HTML usa um
  verificador de balanceamento de tags escrito à mão. CSS verifica
  chaves balanceadas e propriedades desconhecidas contra uma lista de
  propriedades CSS reais. Painel "Problemas" navega até a linha/coluna
  ao tocar.
- **Explorer**: criar/renomear/excluir arquivo e pasta, estrutura
  hierárquica real, ícones por tipo, menu de contexto (toque longo ou
  botão direito), confirmação antes de excluir.
- **Persistência**: tudo (projetos, pastas, arquivos, configurações,
  histórico básico de versões) fica em **IndexedDB**, não em
  localStorage nem em memória. Autosave com debounce configurável,
  indicador de alterações não salvas, confirmação ao sair da página
  com alterações pendentes, múltiplos projetos com seletor.
- **Salvar como / Download / Exportar ZIP**: baixa arquivo único ou o
  projeto inteiro em `.zip`. Em navegadores Chromium (majoritariamente
  desktop) usa a File System Access API para um seletor de local real;
  nos demais, cai para download comum (é o único mecanismo universal
  em navegador — não existe "escolher pasta" padrão em todo navegador
  mobile).
- **Importar projeto**: lê um `.zip`, recria a árvore de
  pastas/arquivos e abre o projeto.
- **Preview**: roda o projeto num `<iframe sandbox>` isolado, com
  console capturado (mensagens `console.log/warn/error` e erros de
  runtime aparecem no painel Console), reload manual e tela cheia.
- **Terminal**: painel real de interface, mas **deixa explícito que é
  simulado** — só executa `ls`, `cat <arquivo>`, `run`, `clear`,
  `help` sobre os dados do próprio projeto. Não existe (nem poderia
  existir só com frontend estático) execução de comandos de SO reais.
  A função `connectRemote(url)` em `js/terminal.js` já está pronta
  para plugar um backend real via WebSocket no futuro.
- **IA**: chamadas reais de API (Anthropic ou qualquer endpoint
  compatível com OpenAI), no modelo "traga sua própria chave" —
  configurada em Configurações → Assistente de IA, guardada só no
  IndexedDB local. Envia código selecionado/arquivo atual/problemas
  detectados/mensagem do usuário como contexto; quando a resposta
  inclui um bloco de código, aparece um botão "Aplicar ao arquivo
  atual" (pede confirmação antes de sobrescrever).

## O que está preparado mas não está ativo

- **OneDrive**: a integração usa MSAL.js (Authorization Code + PKCE) e
  Microsoft Graph API de verdade — código completo em
  `js/onedrive.js` — mas fica **inativa** até você registrar um app na
  Microsoft Entra ID e colar o Client ID em `ONEDRIVE_CONFIG.clientId`.
  Isso não pode ser feito por mim (exige sua conta Azure). Passo a
  passo completo nos comentários do topo de `js/onedrive.js`.
  Nenhuma senha da Microsoft passa por este app em momento algum — o
  login é sempre a página oficial da Microsoft.
- **Sincronização com OneDrive** (detectar conflito local × nuvem):
  ainda não tem interface própria; só faz sentido construir depois que
  o passo acima estiver configurado e testado por você.
- **Git / controle de versão, Debug, Extensões**: só existem como
  botões na Activity Bar que avisam "ainda não implementado" — não
  fingem nenhuma funcionalidade.

## Limitações conhecidas

- Assets binários precisam estar presentes no projeto/importados pelo ZIP para serem exibidos; o Preview converte os formatos comuns para `data:` URLs.
- A detecção de "variável não definida" em JS é heurística (baseada
  em nomes coletados na AST inteira do arquivo), não em escopo real —
  por isso é aviso, não erro. Um linter completo (tipo ESLint no
  navegador) é um passo futuro possível.
- Guardar a chave de API de IA no IndexedDB do navegador não é seguro
  em dispositivo compartilhado — é um tradeoff inerente a um app 100%
  frontend, sem backend próprio para guardar segredos.
- Terminal e Sincronização precisam de um backend real para deixarem
  de ser parciais — arquitetura pronta, serviço não existe.

## Estrutura de pastas

```
code-ai-mobile/
├── index.html
├── css/style.css
├── js/
│   ├── main.js         # bootstrap e orquestração de toda a UI
│   ├── db.js            # IndexedDB (projetos, arquivos, settings, histórico)
│   ├── editor.js         # CodeMirror 6
│   ├── lint.js            # detecção real de erros (acorn + verificadores HTML/CSS)
│   ├── explorer.js         # árvore de arquivos e CRUD
│   ├── preview.js           # montagem do documento de preview
│   ├── zip.js                 # exportar/importar .zip
│   ├── ai.js                   # chamadas reais à API de IA
│   ├── onedrive.js              # MSAL + Microsoft Graph (requer configuração)
│   ├── terminal.js               # terminal simulado + hook para backend real
│   ├── settings.js                # valores padrão de configuração
│   └── icons.js                    # ícones SVG inline
├── assets/imagens/
├── package.json
└── README.md
```

## Verificações realizadas

- `npm test` executa testes de fumaça e a checagem de sintaxe de todos os módulos JavaScript.
- O projeto usa ESM explicitamente (`"type": "module"`), eliminando o aviso de reparsing do Node causado por módulos sem tipo declarado.
- O editor não marca um arquivo como alterado apenas por abri-lo: carregamentos programáticos do documento são separados das edições do usuário.
- Autocomplete pode ser ativado/desativado pelas Configurações e o tamanho/altura das linhas são aplicados ao CodeMirror.
- O linter JS evita avisos falsos para propriedades de objetos, propriedades de `objeto.metodo`, chaves de métodos e identificadores declarados em outros arquivos. `== null`/`!= null` é permitido.
- O linter HTML cobre DOCTYPE, viewport, `alt`, IDs duplicados e referências locais ausentes, além de ignorar conteúdo de `script`, `style` e comentários durante o balanceamento.
- O linter CSS detecta chaves desbalanceadas, propriedades desconhecidas, valores vazios e algumas declarações sem `;`.
- `clear` agora funciona no terminal simulado.

## Próximos passos recomendados

1. Testar no dispositivo real e resolver qualquer conflito de versão
   do CodeMirror 6 via CDN (ver aviso no topo deste README).
2. Registrar o app OneDrive na Microsoft Entra ID e validar o fluxo de
   login/leitura/gravação de arquivos.
3. Decidir se vale a pena um backend leve (mesmo que serverless) para:
   guardar a chave de IA com mais segurança, oferecer um terminal e
   execução de código real, e servir como proxy de sincronização.
4. Evoluir a heurística de lint JS para um linter real completo (ex:
   empacotar uma versão browser do ESLint) se a precisão atual não for
   suficiente.


## Preview v0.8

O Preview agora usa URLs `blob:` para os arquivos JavaScript locais. Isso preserva o comportamento nativo de ES Modules e permite usar normalmente:

```html
<script type="module" src="js/main.js"></script>
```

Imports relativos como `./config.js`, `../utils/helpers.js` e imports dinâmicos locais também são resolvidos para os arquivos do projeto. CSS, imagens, fontes e mídia locais continuam sendo resolvidos pelo sistema de arquivos virtual.


## Preview v0.9 — CSS no sandbox mobile

- CSS local ligado por `<link rel="stylesheet">` é incorporado como `<style>` no documento de preview.
- `@import` e `url(...)` locais continuam sendo resolvidos.
- Assets de texto locais usados pelo CSS são convertidos para `data:` URLs; imagens/fontes importadas do ZIP que já são `data:` continuam assim.
- O preview continua usando `blob:` apenas para módulos JavaScript, onde URLs hierárquicas são necessárias para imports relativos.
- Também são reprocessados blocos `<style>` inline.
