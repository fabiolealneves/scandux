# Physique Pro

App pessoal de acompanhamento de medidas, evolução corporal, rotina, nutrição (proteína do dia), fotos comparáveis e leitura de treino do Hevy. PWA (instala no celular), tema claro/escuro, dados no Google Sheets via Apps Script.

**Versão:** 2.5.0 · **Cache:** 20260917-5

---

## Estrutura (tudo na raiz — sem subpastas)

```
index.html            → casca do app
app.js                → toda a lógica
app.css               → estilos + tema claro/escuro
sw.js                 → service worker (PWA/offline/cache)
manifest.webmanifest  → PWA
icon.svg              → ícone do app
version.json          → versão publicada
Codigo.gs             → backend (vai no Google Apps Script, NÃO na Vercel)
```

O que roda no site são os arquivos da **raiz**. Não existe pasta `v2/` — os caminhos apontam para `/`. Isso é de propósito: você sobe tudo na raiz do repositório e pronto.

---

## 1) Publicar o site (Vercel)

1. Crie o repositório novo no GitHub e suba **todos os arquivos acima na raiz** (menos o `Codigo.gs`, que também pode ficar aqui como referência, mas não é usado pela Vercel).
2. Na Vercel: **Add New → Project → Import** o repositório.
3. Framework Preset: **Other** (é site estático). Build Command: vazio. Output Directory: vazio.
4. **Deploy**. A Vercel serve o `index.html` da raiz automaticamente.

Para confirmar que subiu a versão certa, abra `SEU-SITE/version.json` — deve mostrar `"version": "2.5.0-nutri-tema"`.

> **Cache do PWA:** se você já instalou o app antes e não vê a mudança, feche e reabra, ou reinstale o app. O `sw.js` já troca o cache a cada versão nova.

---

## 2) Backend (Google Apps Script + Google Sheets)

O app guarda os dados numa planilha, acessada por um Web App do Apps Script.

1. Abra a planilha (ou crie uma) → **Extensões → Apps Script**.
2. Cole o conteúdo de `Codigo.gs` no editor. **Salvar**.
3. Rode a função **`setupDatabase`** uma vez (menu de funções → Executar) e **autorize**. Isso cria/atualiza as abas e colunas (Medidas, Rotina com sono/humor/nutrição, Recuperacao, Prato, Scans, Perfil) **sem apagar dados existentes**.
4. **Implantar → Nova implantação → Tipo: App da Web**.
   - Executar como: **Eu**
   - Quem tem acesso: **Qualquer pessoa**
   - **Implantar** e copie a URL que termina em **`/exec`**.
5. No app (aba **Config**), cole essa URL em "URL do Apps Script" e **Salvar e testar**.

> Ao **atualizar** o `Codigo.gs` depois: cole a nova versão, salve, e **Implantar → Gerenciar implantações → Editar (lápis) → Versão: Nova versão → Implantar**. Sem esse passo, a URL continua servindo o código antigo.

---

## 3) Conectar o Hevy (importante — é aqui que costuma dar erro)

A chave do Hevy **NÃO vai dentro do código**. O código lê a chave de um cofre do Apps Script chamado *Script Properties*. Você guarda a chave lá, com o nome exato `HEVY_API_KEY`.

1. No editor do Apps Script: engrenagem **Configurações do projeto**.
2. Seção **Propriedades do script** → **Adicionar propriedade do script**.
3. **Propriedade (nome):** `HEVY_API_KEY`  ← exatamente isso, não mude
   **Valor:** a sua chave da API do Hevy
4. **Salvar propriedades do script**.
5. No app, aba Rotina → **Atualizar Hevy**.

**Erro comum (o que aconteceu antes):** trocar, dentro do `Codigo.gs`, o texto `getProperty('HEVY_API_KEY')` pela chave. Não faça isso — `getProperty(...)` recebe o **nome** da propriedade, não a chave. A linha correta é:

```js
function _hevyKey(){try{return String(PropertiesService.getScriptProperties().getProperty('HEVY_API_KEY')||'').trim();}catch(e){return'';}}
```

> **Segurança:** se a sua chave do Hevy já apareceu em texto (chat, prints, código), **revogue-a no Hevy e gere uma nova**. Guarde a nova só no Script Properties.

---

## 4) O que sincroniza e o que é local

- **Sincroniza entre celular e web (via Sheets):** medidas, rotina (incluindo sono, humor, água e a nutrição/proteína). Salvou num aparelho → aparece no outro depois de **Sincronizar**.
- **Fica só no aparelho:** as **fotos do Scan** (ficam no navegador do dispositivo) e a preferência de **tema** (claro/escuro).

---

## 5) Como atualizar a versão (evitar cache preso)

Ao mexer no `app.js` ou `app.css`, troque o número de versão em **três** lugares para o mesmo valor novo:

- `sw.js` → `CACHE` e as querystrings `?v=...`
- `index.html` → as querystrings `?v=...`
- `version.json` → campo `version`

Assim o service worker busca os arquivos novos em vez de servir do cache.
