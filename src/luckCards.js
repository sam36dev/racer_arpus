'use strict';

// Catalogo das cartas da sorte do baralho fisico, mandadas pelo usuario aos poucos.
// So tem aqui o que ja foi confirmado - nao inventar carta nova sem o usuario mandar.
//
// effect.type define o que activateCard() faz automaticamente no jogador:
//   'fuel'         -> soma effect.value ao combustivel atual (negativo desconta)
//   'tire'         -> soma effect.value ao nivel do pneu (negativo desgasta e pode eliminar)
//   'tireBrand'    -> troca a marca do pneu de graca (reseta nivel ao maximo), effect.value = marca
//   'turbo'        -> soma effect.value a posicao do turbo (negativo reduz o dado)
//   'laps'         -> soma effect.value as voltas completas (pode fazer o jogador vencer a corrida)
//   'fine'         -> aplica uma multa de effect.value, com o nome da carta como motivo
//   'none'         -> so anuncia a carta pro jogador, sem mexer em nenhum stat
//                     (usado quando o efeito e narrativo e o mestre resolve na mesa)
//   'statusOn'     -> liga um efeito CONTINUO (effect.field / effect.value), que fica valendo
//                     ate o mestre desligar (ou transferir) manualmente - ver ACTIVE_EFFECTS.
//                     Regras especiais de cada campo (dobra desgaste, trava dado, etc) ficam
//                     hardcoded em rollDice() (src/gameLogic.js), o catalogo so liga o campo.
//   'watchOpponent'-> liga o efeito 'watching' escolhendo um ALVO na hora de ativar (o mestre
//                     manda targetPlayerId no POST /activate-card). Ver ACTIVE_EFFECTS.watching.
const CATALOG = [
  {
    id: 'pneu-remold',
    name: 'Pneu Remold',
    description: 'Cada gasto de pneu sera dobrado, ate o mestre desativar o efeito.',
    icon: '🔥',
    effect: { type: 'statusOn', field: 'tireWearMultiplier', value: 2 },
  },
  {
    id: 'dois-consertos-de-pneus',
    name: '2 Consertos de Pneus',
    description: 'Ganhe 2 consertos de pneu de graca (sobe 2 niveis).',
    icon: '🔧',
    effect: { type: 'tire', value: 2 },
  },
  {
    id: 'kit-gas',
    name: 'Kit Gas',
    description:
      'Seu dado vira D2 ate cair na oficina (mestre remove) ou ate voce cair na mesma casa ' +
      'de outro jogador e repassar a zica pra ele (mestre transfere).',
    icon: '🧯',
    effect: { type: 'statusOn', field: 'diceLock', value: 2 },
  },
  {
    id: 'gasolina',
    name: 'Gasolina',
    description: 'Mais 6 litros de gasolina.',
    icon: '⛽',
    effect: { type: 'fuel', value: 6 },
  },
  {
    id: 'tanque-furado',
    name: 'Tanque Furado',
    description: 'Sempre que voce tirar 6 no dado (qualquer dado), perde mais 1 litro de gasolina. Vale ate o mestre desativar.',
    icon: '🕳️',
    effect: { type: 'statusOn', field: 'tanqueFuradoActive', value: true },
  },
  {
    id: 'd12-temporario',
    name: 'D12 Temporario',
    description:
      'Voce passa a rolar D12, gastando so 1 litro por rolagem, ate tirar 12 - ai o efeito acaba ' +
      'e voce volta a rolar com o dado normal do seu turbo (sem perder progresso).',
    icon: '🎰',
    effect: { type: 'statusOn', field: 'd12TempActive', value: true },
  },
  {
    id: 'transmissao-sequencial',
    name: 'Transmissao Sequencial',
    description:
      'Escolha um oponente pra observar. Quando ele tirar todos os numeros possiveis do dado ' +
      'atual dele (sem repetir), aparece "troque de lugar!" na tela dele. Se o dado dele mudar ' +
      'no meio do caminho, a contagem reinicia. Ao fechar o aviso, a carta se desativa sozinha.',
    icon: '📡',
    effect: { type: 'watchOpponent' },
  },
];

// Efeitos CONTINUOS que uma carta pode ligar no jogador (effect.type 'statusOn' ou
// 'watchOpponent' - ver CATALOG acima). `field` e o campo gravado direto no doc do jogador
// (players/{id}); enquanto ele estiver fora do `default`, o efeito conta como ativo e aparece
// no painel do mestre (e na tela do proprio jogador) com botao de remover. Nao tem prazo
// automatico previsto aqui - o mestre desliga (clearEffect), transfere (transferEffect, se
// `transferable`) ou a propria logica do jogo desliga sozinha (ver rollDice em gameLogic.js
// pro D12 Temporario e pra Transmissao Sequencial).
// `label` e uma funcao (value) => texto, pra poder mostrar dado/numeros/nome dinamicamente.
const ACTIVE_EFFECTS = {
  tireWearMultiplier: {
    label: () => 'Desgaste de pneu dobrado',
    default: 1,
    transferable: false,
  },
  diceLock: {
    label: (value) => `Dado travado em D${value}`,
    default: null,
    transferable: true,
  },
  tanqueFuradoActive: {
    label: () => 'Tanque furado: -1 litro extra ao tirar 6',
    default: false,
    transferable: false,
  },
  d12TempActive: {
    label: () => 'D12 temporario (1 litro/rolagem, acaba ao tirar 12)',
    default: false,
    transferable: false,
  },
  watching: {
    label: (value) => `Observando ${value.targetName} (${(value.seenValues || []).length}/${value.targetDiceType})`,
    default: null,
    transferable: false,
  },
};

function catalog() {
  return CATALOG;
}

function findById(id) {
  return CATALOG.find((c) => c.id === id);
}

// Acha a carta que liga um determinado efeito continuo - usado pra anunciar (lastCard/log)
// quando o efeito e transferido pra outro jogador, reaproveitando nome/icone/descricao da carta.
function findByEffectField(field) {
  return CATALOG.find((c) => c.effect.type === 'statusOn' && c.effect.field === field);
}

function activeEffectFields() {
  return Object.keys(ACTIVE_EFFECTS);
}

function getActiveEffect(field) {
  return ACTIVE_EFFECTS[field] || null;
}

module.exports = {
  catalog,
  findById,
  findByEffectField,
  activeEffectFields,
  getActiveEffect,
};
