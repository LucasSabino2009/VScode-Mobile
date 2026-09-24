/**
 * ai.js — Assistente de IA real (não simulado), no modelo "traga sua
 * própria chave": o usuário informa a chave de API em Configurações,
 * ela é salva apenas no IndexedDB local (nunca enviada para nenhum
 * servidor além do provedor de IA escolhido) e as chamadas saem
 * diretamente do navegador para a API do provedor.
 *
 * Suporta dois provedores:
 *  - "anthropic": chama https://api.anthropic.com/v1/messages
 *    diretamente do navegador usando o cabeçalho
 *    "anthropic-dangerous-direct-browser-access: true" (recurso da
 *    própria API da Anthropic para apps client-side).
 *  - "openai-compatible": qualquer endpoint compatível com
 *    /v1/chat/completions (OpenAI, ou um proxy próprio do usuário).
 *
 * IMPORTANTE — limitação real: guardar uma chave de API no navegador
 * (mesmo só localmente) nunca é 100% seguro em um dispositivo
 * compartilhado. Deixe isso claro para o usuário na tela de
 * Configurações. Para produção real, o recomendado é um backend que
 * guarda a chave e faz proxy das chamadas — isso não existe neste
 * projeto (é 100% frontend estático) e por isso não foi implementado
 * aqui; a arquitetura abaixo já isola tudo num único módulo para que
 * seja fácil trocar por chamadas a um backend no futuro.
 */

const ACTION_PROMPTS = {
  explicar: (ctx) => `Explique de forma clara e objetiva o que o código abaixo faz.\n\nArquivo: ${ctx.fileName}\n\n\`\`\`${ctx.lang}\n${ctx.code}\n\`\`\``,
  corrigir: (ctx) => `Corrija os problemas abaixo no arquivo ${ctx.fileName}. Responda com uma breve explicação e depois um bloco de código único com o conteúdo COMPLETO do arquivo já corrigido.\n\nProblemas detectados:\n${ctx.problemsText || "(nenhum detectado automaticamente, revise mesmo assim)"}\n\n\`\`\`${ctx.lang}\n${ctx.code}\n\`\`\``,
  melhorar: (ctx) => `Sugira melhorias de legibilidade, boas práticas e desempenho para o código abaixo. Responda com uma breve explicação e depois um bloco de código único com o conteúdo COMPLETO do arquivo já melhorado.\n\nArquivo: ${ctx.fileName}\n\n\`\`\`${ctx.lang}\n${ctx.code}\n\`\`\``,
  "encontrar bugs": (ctx) => `Analise o código abaixo em busca de bugs reais (não apenas estilo). Liste cada bug com a linha aproximada e o motivo.\n\nArquivo: ${ctx.fileName}\n\n\`\`\`${ctx.lang}\n${ctx.code}\n\`\`\``,
  gerar: (ctx) => `Com base neste pedido do usuário, gere o código necessário: "${ctx.userMessage}". Contexto do arquivo atual (${ctx.fileName}):\n\n\`\`\`${ctx.lang}\n${ctx.code}\n\`\`\``,
  documentar: (ctx) => `Adicione comentários/documentação clara ao código abaixo (sem mudar a lógica). Responda com o conteúdo COMPLETO do arquivo já documentado em um bloco de código.\n\nArquivo: ${ctx.fileName}\n\n\`\`\`${ctx.lang}\n${ctx.code}\n\`\`\``,
  ensinar: (ctx) => `Aja como um professor de programação. Explique os conceitos usados neste trecho de código de forma didática, para alguém aprendendo a programar.\n\nArquivo: ${ctx.fileName}\n\n\`\`\`${ctx.lang}\n${ctx.code}\n\`\`\``,
  refatorar: (ctx) => `Refatore o código abaixo mantendo o comportamento externo idêntico. Responda com uma breve explicação e depois um bloco de código único com o conteúdo COMPLETO já refatorado.\n\nArquivo: ${ctx.fileName}\n\n\`\`\`${ctx.lang}\n${ctx.code}\n\`\`\``,
};

export function buildActionPrompt(action, ctx) {
  const fn = ACTION_PROMPTS[action];
  return fn ? fn(ctx) : `${action}\n\nArquivo: ${ctx.fileName}\n\`\`\`${ctx.lang}\n${ctx.code}\n\`\`\``;
}

const SYSTEM_PROMPT = `Você é o assistente de IA integrado ao "Code AI Mobile", uma IDE para celular. Você recebe o código do arquivo atual, possivelmente um trecho selecionado, os problemas detectados pelo linter e informações do projeto. Responda em português do Brasil, de forma direta. Quando entregar código para substituir um arquivo inteiro, use um único bloco de código contendo o arquivo completo, sem comentários de "resto do código inalterado".`;

export async function askAI({ provider, apiKey, model, baseUrl, systemPrompt, userMessage, context }) {
  if (!apiKey) {
    throw new Error("Nenhuma chave de API configurada. Vá em Configurações → IA para adicionar sua chave.");
  }
  const fullUserMessage = context
    ? `${userMessage}\n\n--- Contexto ---\nArquivo: ${context.fileName || "(nenhum)"}\nLinguagem: ${context.lang || "-"}\nSeleção: ${context.selection ? "sim" : "não"}\nProblemas detectados: ${context.problemsText || "nenhum"}\n\nCódigo:\n\`\`\`${context.lang || ""}\n${context.code || ""}\n\`\`\``
    : userMessage;

  if (provider === "openai-compatible") {
    const res = await fetch(`${baseUrl || "https://api.openai.com"}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt || SYSTEM_PROMPT },
          { role: "user", content: fullUserMessage },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Erro da API (${res.status}): ${await safeText(res)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "(resposta vazia)";
  }

  // padrão: Anthropic
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-5",
      max_tokens: 2000,
      system: systemPrompt || SYSTEM_PROMPT,
      messages: [{ role: "user", content: fullUserMessage }],
    }),
  });
  if (!res.ok) throw new Error(`Erro da API (${res.status}): ${await safeText(res)}`);
  const data = await res.json();
  return (data.content || []).map((b) => b.text || "").join("\n") || "(resposta vazia)";
}

async function safeText(res) {
  try {
    const j = await res.json();
    return j.error?.message || JSON.stringify(j);
  } catch {
    return res.statusText;
  }
}

/** Extrai o primeiro bloco de código ```...``` de uma resposta da IA. */
export function extractCodeBlock(markdown) {
  const m = markdown.match(/```[a-zA-Z0-9]*\n([\s\S]*?)```/);
  return m ? m[1] : null;
}
