# Contrato da interface (`window.electronAPI`)

A interface (`index.html`, `style.css`, `renderer.js`) conversa com o app só por meio de `window.electronAPI`. No app oficial esse objeto vem do processo principal, que verifica a assinatura antes de qualquer operação com arquivos. Na pré-visualização ele vem de `dev/mock-api.js`, com dados de exemplo.

Esta lista existe para quem personaliza a interface saber o que está disponível. Ela não dá acesso à lógica do app: sem assinatura ativa, todas as funções marcadas com 🔒 respondem com o erro `LICENSE_REQUIRED`.

## App e conta

| Função | Retorno |
| --- | --- |
| `getAppInfo()` | `{ version, supportUrl, isPackaged, platform }` |
| `openExternal(url)` | Abre um link `https://` no navegador |
| `checkLicense()` | Estado da assinatura (veja abaixo) |
| `login({ email, password })` | Estado da assinatura |
| `logout()` | Estado da assinatura |
| `onLicenseState(callback)` | Avisa quando a assinatura muda; retorna função para cancelar |

Estado da assinatura:

```js
{
  valid: true,              // pode usar o app?
  reason: null,             // quando inválida: 'no_license', 'expired', 'no_plan',
                            // 'suspended', 'offline', 'clock', 'invalid_credentials'…
  role: 'user',             // 'user' ou 'admin'
  expiresAt: 1790000000000, // null = sem prazo
  email: 'aluno@exemplo.com',
  offline: false,           // true quando está usando a tolerância de 7 dias sem internet
  offlineUntil: null
}
```

## Biblioteca 🔒

| Função | Retorno |
| --- | --- |
| `loadLibrary()` | `{ courses, missing, progress }` |
| `pickCourseFolders()` | Lista de pastas escolhidas pelo usuário |
| `pickCover()` | `{ path, name, preview }` ou `null` |
| `saveCourse({ path, name, category, coverSourcePath, removeCover })` | `{ ok, course }` |
| `removeCourse(path)` | Progresso atualizado |

Curso:

```js
{
  id, path, registeredPath, name, displayName, category,
  coverUrl,                 // imagem da capa ou null
  seasons: [{
    id, name,               // "Módulo 1 / Parte A"
    episodes: [{ id, name, path, order, hasPdf, pdfUrl }],
    materials: [{ name, url }]
  }]
}
```

## Progresso, notas e preferências 🔒

| Função | O que faz |
| --- | --- |
| `saveProgress({ videoId, courseId, time, duration, completed })` | Salva onde o aluno parou |
| `setCompleted({ items: [{ videoId, courseId }], completed })` | Marca ou desmarca aulas como concluídas |
| `saveNotes(notes)` | Substitui a lista de notas |
| `setPreference(key, value)` | `playbackRate`, `volume`, `lessonsPanelHidden`, `lastPatchNotesVersion` |
| `prepareVideo(path, { forceStream })` | `{ mode: 'native' \| 'stream', url, duration }` |

## Temas

| Função | Retorno |
| --- | --- |
| `listThemes()` | `{ themes, active }` |
| `getTheme()` | `{ id, css }` |
| `setTheme(id)` | Tema ativo |
| `importTheme()` | `{ ok, themes, active }` |
| `removeTheme(id)` | `{ ok, themes, active }` |

## Atualizações

| Função | Retorno |
| --- | --- |
| `getUpdateState()` | `{ status, version, currentVersion, percent }` |
| `downloadAndInstallUpdate()` | Estado atualizado |
| `onUpdaterState(callback)` | Avisa mudanças no download |
