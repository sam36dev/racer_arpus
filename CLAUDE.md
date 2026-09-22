# CLAUDE.md

Guia pra trabalhar neste repo. Projeto pequeno, sem build e sem testes — leia as regras antes de mexer na lógica do jogo.

## O que é

Racer Arpus é um painel web que acompanha uma corrida de **tabuleiro física** (o app não é o jogo: fichas, dinheiro e tabuleiro são reais). Ele controla o que dá trabalho no papel: combustível, desgaste de pneu, nível do turbo, multas e voltas.

Três telas:

- [index.html](public/index.html) — criar corrida ou entrar com o código.
- [master.html](public/master.html) — painel do mestre: vê todos os pilotos e age por qualquer um (multa, reparar/penalizar pneu, subir turbo, +1 volta). Quem cria a corrida também joga.
- [player.html](public/player.html) — painel do piloto: rola o dado, abastece, troca pneu, fecha volta, e vê o último número que cada adversário tirou.

## Stack e arquitetura

- Node + Express ([server.js](server.js)) servindo `/api/*` e os estáticos de [public/](public/).
- Firestore via firebase-admin ([src/db.js](src/db.js)). **Toda escrita passa pelo backend** (Admin SDK). [firestore.rules](firestore.rules) deixa só leitura pública — o front nunca escreve direto.
- Frontend sem framework e **sem bundler**: HTML + JS puro, ES modules importando o SDK do Firebase via URL do gstatic.
- Tempo real: o front assina `onSnapshot` nos docs de `games/{id}`, `players` e `fines`. As ações vão por `fetch` POST; a atualização da tela vem do snapshot, não da resposta.
- Deploy na Vercel: [api/index.js](api/index.js) reexporta o app Express inteiro e [vercel.json](vercel.json) reescreve `/api/*` pra ele.

### Modelo no Firestore

```
games/{gameId}          name, status (lobby|finished), totalLaps, winnerPlayerId
  players/{playerId}    name, color, userId, diceType, turboPosition,
                        fuelCurrent, tireBrand, tireLevel, tireRollsUsed,
                        eliminated, laps, lastRoll { value, diceType, at },
                        lastCard { cardId, name, icon, description, at },
                        + campos de efeitos continuos das cartas da sorte, so presentes
                        quando ativos: tireWearMultiplier, diceLock, tanqueFuradoActive,
                        d12TempActive, watching { targetPlayerId, targetName,
                        targetDiceType, seenValues[], triggered } (ver ACTIVE_EFFECTS)
  fines/{fineId}        playerId, amount, reason
  luckCards/{logId}     playerId, cardId, name, icon, description, appliedAt
users/{username}        displayName, passwordHash, wins, racesPlayed,
                        lapsCompleted, timesEliminated, finesReceived
  achievements/{id}     unlockedAt, grantedBy ('auto' ou username do admin)
```

`gameId` e `playerId` são nanoid(8); o id do usuário **é** o username normalizado (minúsculo).

## Regras do jogo

Os números de balanceamento ficam todos em [src/constants.js](src/constants.js) — mexa lá, não espalhado no código.

- **Combustível**: tanque de 40. Consumo por rolagem = `dado/6` (40 rolagens no d6, 30 no d8, 20 no d12) — **exceto d4, confirmado em 0,5** (2 rolagens = 1 unidade), via `FUEL_CONSUMPTION_OVERRIDES` em [src/constants.js](src/constants.js). Tanque vazio **bloqueia** a rolagem. Abastecer é +1 por clique (não enche de uma vez).
- **Pneu**: trilha de nível 10→0 (as 10 bolinhas do cartão físico). A marca define de quantas em quantas rolagens cai um nível: Pirelli 20, Continental 25, Michelin 30. Nível 7-10 sem penalidade, 5-6 limita a d4, 1-4 limita a d2, **0 elimina o piloto** (bloqueia rolagem pra sempre).
- **Turbo**: cada upgrade avança 1 posição; posição ≥8 vira d8, ≥12 vira d12.
- **Pneu gasto sempre vence o turbo** — é isso que `effectiveDice()` faz. Um d12 com pneu nível 3 rola d2.
- **Voltas**: 10 pra terminar. A primeira a chegar marca `status: 'finished'` e vira `winnerPlayerId`. Completar volta **gasta 1 nível de pneu** (pode eliminar se zerar) — mesma lógica de `damageTire()`, só que embutida em `completeLap()`.
- Reparar pneu (+1 nível) e trocar de marca (reseta pro 10) são livres no app — o custo é físico, na mesa.

Regras marcadas como ASSUNÇÃO nos comentários (ex: o consumo proporcional ao dado) foram deduzidas, não confirmadas pelo cartão oficial. Se o usuário trouxer o número real, ajuste a constante e apague a nota.

## Cartas da sorte

O baralho é físico — o mestre tira a carta na mesa e ativa o efeito pelo painel do mestre, pra cada jogador. Catálogo em [src/luckCards.js](src/luckCards.js), **só com cartas reais** que o usuário mandou (nome + efeito) — nunca inventar carta nova aqui, mesmo pra "preencher" o catálogo; se faltar mapear um efeito, perguntar antes de adicionar. Cada carta tem `effect.type`, interpretado por `activateCard()` em [src/gameLogic.js](src/gameLogic.js):

- `fuel` / `tire` / `turbo` / `laps`: soma `effect.value` (pode ser negativo) reaproveitando `refuel`/`repairTire`+`damageTire`/`upgradeTurbo`/`completeLap` — essas funções agora aceitam um delta opcional (default 1) só por causa disso; as rotas HTTP normais continuam chamando sem delta.
- `tireBrand`: troca a marca de graça (`effect.value` = nome da marca).
- `fine`: aplica multa automática de `effect.value`, usando o nome da carta como motivo.
- `none`: só anuncia a carta (fica registrada e aparece pro jogador), sem mexer em stat nenhum — pra efeito resolvido na mesa.
- `statusOn`: liga um **efeito contínuo** (ver abaixo).
- `watchOpponent`: liga o efeito contínuo `watching`, mas precisa de um **alvo** escolhido na hora (outro jogador) — ver abaixo.

Cada ativação grava `lastCard` no jogador (o front reage em tempo real, com pop de revelação igual ao dado) e um registro em `luckCards/{id}` pro histórico no painel do mestre.

### Efeitos contínuos (`ACTIVE_EFFECTS`)

Algumas cartas não são "aplicou e acabou" — ficam ligadas até alguém desligar. Isso é um registro genérico em [src/luckCards.js](src/luckCards.js) (`ACTIVE_EFFECTS`): cada entrada é um campo salvo direto no doc do jogador (`players/{id}`), com `default` (valor de "desligado"), `label(value)` (texto dinâmico do badge) e `transferable` (se pode passar pra outro jogador). `serializePlayer()` monta `player.activeEffects` filtrando os campos que estão fora do default — isso alimenta o badge "⚡ Efeitos ativos" no painel do mestre (com botão ✕ Remover e, se `transferable`, ➜ Transferir) e os badges informativos na tela do próprio jogador. **Mudou algo em `ACTIVE_EFFECTS`? Espelhe em [game-calc.js](public/js/game-calc.js) também** (mesma regra do resto do arquivo).

Campos hoje:
- `tireWearMultiplier` (Pneu Remold): dobra o incremento de `tireRollsUsed` por rolagem, em `rollDice()`.
- `diceLock` (Kit Gás): trava o dado efetivo nesse valor, sobrepondo até o pneu — ver `effectiveDice()`. Transferível (`transferEffect()`) pra simular "cair na mesma casa e passar a zica".
- `tanqueFuradoActive` (Tanque Furado): tirou exatamente 6 no dado → desconta +1 litro extra, checado em `rollDice()`.
- `d12TempActive` (D12 Temporário): trava o dado em d12 (mesmo mecanismo do `diceLock`, mas campo separado — motivo diferente de terminar) e cobra combustível fixo (1/rolagem) em vez da fórmula normal. **Auto-desliga sozinho** quando o valor rolado é 12; `turboPosition`/`diceType` nunca são tocados, então o jogador simplesmente volta a rolar com o dado real do turbo dele (sem perder progresso).
- `watching` (Transmissão Sequencial): `{ targetPlayerId, targetName, targetDiceType, seenValues[], triggered }`. Toda vez que QUALQUER jogador rola (`rollDice()` → `updateWatchers()`), varre quem está observando esse roller (`where('watching.targetPlayerId', '==', ...)`), acumula números distintos vistos, reinicia se o dado do alvo mudou, e liga `triggered` quando todos os números do dado atual já saíram. O front do observador mostra um popup "troque de lugar"; fechar o popup chama `clear-effect` (mesmo endpoint que o mestre usa) e desliga o efeito — não existe endpoint dedicado pra isso de propósito.

Desligar manualmente é sempre `POST .../clear-effect { field }` (volta ao default). Transferir é `POST .../transfer-effect { toPlayerId, field }` — só funciona se `transferable: true` no registro.

Cartas novas o usuário manda aos poucos (nome + efeito); adiciona em `CATALOG` só depois que ele mandar. O motor de efeitos (instantâneos e contínuos) já está pronto pra maioria dos casos; efeito novo que não se encaixe nos tipos acima precisa de um campo novo em `ACTIVE_EFFECTS` + lógica dedicada em `rollDice()` (como os últimos quatro acima).

## ⚠️ game-calc.js espelha o backend

[public/js/game-calc.js](public/js/game-calc.js) é uma cópia manual, pro browser, das fórmulas de [src/constants.js](src/constants.js) e do `serializePlayer` de [src/gameLogic.js](src/gameLogic.js). Existe porque o front lê o Firestore cru pelo snapshot e precisa derivar os mesmos percentuais e penalidades sem chamar a API.

**Mudou constante ou fórmula no backend? Atualize os dois arquivos no mesmo commit.** Não há bundler pra compartilhar código, e divergência aqui faz a tela mostrar número diferente do que o servidor aplica.

## Contas, ranking e conquistas

- Login é usuário/senha sem email (app entre amigos): bcrypt + JWT de 90 dias, em [src/auth.js](src/auth.js). Token e username ficam no `localStorage` (`racer-token`, `racer-username`).
- Jogar sem conta funciona (`optionalAuth`), mas aí nada entra em ranking nem em conquistas — quem não tem `userId` não gera stats.
- Conquistas em [src/achievements.js](src/achievements.js): `auto` dispara por evento (`checkAutoAchievements(username, code)` chamado dentro do gameLogic) e `manual` só o admin concede. O catálogo atual é **placeholder** até chegar a lista real de troféus.
- Admin = username listado em `ADMIN_USERNAMES` no `.env`.

## Rodar

```bash
npm install
cp .env.example .env   # preencha as credenciais do Firebase Admin e o JWT_SECRET
npm run dev            # node --watch, http://localhost:3000
```

Não há testes nem linter. Pra validar mudança de regra, o caminho é rodar local e usar as telas.

## Convenções

- Código, comentários, mensagens de erro e UI em **português sem acentos** (o repo inteiro segue isso — `combustivel`, `nao encontrado`). Este CLAUDE.md é a exceção.
- Mensagens de commit em português, no imperativo, também sem acentos: `Aumenta tanque de combustivel para 40 rolagens (d6)`.
- Erros de domínio usam `GameError`/`AuthError` com `code`; o `wrap()` do Express traduz `*_NOT_FOUND` em 404 e o resto em 400.
- Botão que dispara requisição usa `busyClick()` — desabilita e mostra "..." enquanto está em voo. Importante por causa do cold start da Vercel, senão o usuário clica três vezes.
- `.env` tem credencial real e está no `.gitignore`. Nunca commite.
