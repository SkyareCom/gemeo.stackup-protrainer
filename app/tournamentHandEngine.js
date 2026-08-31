// ---------- MOTOR DE MÃO DO SIMULADOR DE TORNEIO (Fase 2a — baralho + avaliador) ----------
// Módulo próprio e isolado do resto do app — não importa nada de Trainer.jsx. A única coisa
// que cruza com o motor de mão normal do treino é o ESQUEMA de RNG (mulberry32 + hash de string,
// mesmo algoritmo) e o formato de carta ({ v, s } — v=valor 2-14, s=naipe), pra manter
// consistência de qualidade de aleatoriedade e compatibilidade de dados em toda a base. As
// SEMENTES (seeds) usadas aqui sempre carregam um prefixo "TOURNEY|" que não existe em nenhuma
// semente do gerador de treino normal — isso garante, por construção, que uma mão do simulador
// de torneio nunca seja bit-a-bit idêntica a uma mão já sorteada no treino comum, mesmo usando
// o mesmo algoritmo de números pseudoaleatórios.

// ---- RNG determinístico (mesmo algoritmo usado no resto do app) ----
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function tournamentRng(seedStr) {
  return mulberry32(hashStr(`TOURNEY|${seedStr}`));
}

// ---- Baralho real (52 cartas, sem reposição) ----
const SUITS = ["♠", "♥", "♦", "♣"];
const RANK_VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; // 11=J, 12=Q, 13=K, 14=A
const RANK_LABEL = { 11: "J", 12: "Q", 13: "K", 14: "A" };
function rankLabel(v) { return RANK_LABEL[v] || String(v); }

function createDeck() {
  const deck = [];
  for (const s of SUITS) for (const v of RANK_VALUES) deck.push({ v, s });
  return deck;
}

// Fisher-Yates com o RNG fornecido — determinístico dado o mesmo rng.
function shuffleDeck(deck, rng) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// Distribui `count` mãos de `cardsPerHand` cartas + `boardSize` cartas de board, todas do MESMO
// baralho embaralhado — nunca duas cartas iguais em jogo ao mesmo tempo (sem reposição real).
// Distribui `count` mãos de `cardsPerHand` cartas + `boardSize` cartas de board, todas do MESMO
// baralho embaralhado — nunca duas cartas iguais em jogo ao mesmo tempo (sem reposição real).
//
// heroSeatIndex/heroCardsOverride (opcionais): permitem "encomendar" as duas cartas exatas do
// herói (vindas do banco geral de spots do app — ver integração na tela) em vez de deixá-las
// puramente aleatórias. As cartas encomendadas são removidas de onde caírem no baralho embaralhado
// ANTES de distribuir o resto — garante que nunca duplicam com o que sai pros outros jogadores ou
// pro board, mesmo vindo de fora do sorteio normal.
function dealTable({ seatCount, cardsPerHand = 2, boardSize = 5, rng, heroSeatIndex = null, heroCardsOverride = null }) {
  let deck = shuffleDeck(createDeck(), rng);
  if (heroCardsOverride && heroSeatIndex !== null) {
    deck = deck.filter((c) => !heroCardsOverride.some((hc) => hc.v === c.v && hc.s === c.s));
  }
  let cursor = 0;
  const hands = [];
  for (let seat = 0; seat < seatCount; seat++) {
    if (heroCardsOverride && seat === heroSeatIndex) { hands.push(heroCardsOverride); continue; }
    hands.push(deck.slice(cursor, cursor + cardsPerHand));
    cursor += cardsPerHand;
  }
  const board = deck.slice(cursor, cursor + boardSize);
  cursor += boardSize;
  return { hands, board, remainingDeck: deck.slice(cursor) };
}

// ---- Avaliador de mãos (melhor combinação de 5 cartas entre até 7) ----
// Categorias, da mais forte pra mais fraca (índice = força da categoria).
const HAND_CATEGORIES = [
  "CARTA_ALTA", "PAR", "DOIS_PARES", "TRINCA", "SEQUENCIA",
  "FLUSH", "FULL_HOUSE", "QUADRA", "STRAIGHT_FLUSH",
];

function combinations(arr, k) {
  const results = [];
  const combo = [];
  function go(start) {
    if (combo.length === k) { results.push([...combo]); return; }
    for (let i = start; i < arr.length; i++) { combo.push(arr[i]); go(i + 1); combo.pop(); }
  }
  go(0);
  return results;
}

// Avalia exatamente 5 cartas. Retorna um array comparável: [categoria, kicker1, kicker2, ...] —
// duas mãos comparam-se posição a posição (maior primeiro desempata), igual ao desempate real
// de pôquer.
function evaluate5(cards) {
  const values = cards.map((c) => c.v).sort((a, b) => b - a);
  const suitCounts = {};
  for (const c of cards) suitCounts[c.s] = (suitCounts[c.s] || 0) + 1;
  const isFlush = Object.values(suitCounts).some((n) => n === 5);

  const countByValue = {};
  for (const v of values) countByValue[v] = (countByValue[v] || 0) + 1;
  const groups = Object.entries(countByValue)
    .map(([v, n]) => [Number(v), n])
    .sort((a, b) => (b[1] - a[1]) || (b[0] - a[0])); // por quantidade, depois por valor

  // Sequência: trata também a "roda" (A-2-3-4-5, onde o Ás vale como 1).
  const uniqueDesc = [...new Set(values)];
  let straightHigh = null;
  for (let i = 0; i <= uniqueDesc.length - 5; i++) {
    if (uniqueDesc[i] - uniqueDesc[i + 4] === 4) { straightHigh = uniqueDesc[i]; break; }
  }
  if (straightHigh === null && uniqueDesc.includes(14) && [5, 4, 3, 2].every((v) => uniqueDesc.includes(v))) {
    straightHigh = 5; // roda: 5-4-3-2-A, o 5 é a carta mais alta pra desempate
  }

  const isStraight = straightHigh !== null;
  if (isStraight && isFlush) return [8, straightHigh];
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
  if (isFlush) return [5, ...values];
  if (isStraight) return [4, straightHigh];
  if (groups[0][1] === 3) return [3, groups[0][0], ...groups.slice(1).map((g) => g[0])];
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    return [2, ...pairs, groups[2][0]];
  }
  if (groups[0][1] === 2) return [1, groups[0][0], ...groups.slice(1).map((g) => g[0])];
  return [0, ...values];
}

// Compara dois arrays de avaliação posição a posição. Retorna >0 se a>b, <0 se a<b, 0 se empate
// exato (split pot).
function compareEval(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Avalia entre 5 e 7 cartas (mão + board), testando todas as combinações de 5 e ficando com a
// melhor. Retorna { category, categoryLabel, evalArray } — evalArray é o que compareEval usa.
function evaluateBestHand(cards) {
  if (cards.length < 5) throw new Error("evaluateBestHand precisa de pelo menos 5 cartas");
  let best = null;
  for (const combo of combinations(cards, 5)) {
    const evalArray = evaluate5(combo);
    if (!best || compareEval(evalArray, best) > 0) best = evalArray;
  }
  return { category: best[0], categoryLabel: HAND_CATEGORIES[best[0]], evalArray: best };
}

// Compara diretamente dois conjuntos de 5-7 cartas (uso comum: mão de dois jogadores + o mesmo
// board). Retorna >0 se cardsA vence, <0 se cardsB vence, 0 se empate (split pot).
function compareHands(cardsA, cardsB) {
  return compareEval(evaluateBestHand(cardsA).evalArray, evaluateBestHand(cardsB).evalArray);
}

// ---------- FASE 2b — força de mão pré-flop + decisão dos adversários ----------
// Heurística própria (não reaproveita a tabela de 169 mãos do treino normal — motor isolado por
// escolha). Pontuação simples e conhecida: carta mais alta pesa mais, par ganha bônus forte,
// naipe igual soma pontos, e a distância entre as cartas (gap) penaliza, com exceção pra
// conectores baixos (mais valiosos multiway/pós-flop do que a pontuação bruta sugeriria).
function startingHandScore(cardA, cardB) {
  const hi = Math.max(cardA.v, cardB.v), lo = Math.min(cardA.v, cardB.v);
  const isPair = cardA.v === cardB.v;
  const isSuited = cardA.s === cardB.s;
  const gap = isPair ? 0 : hi - lo - 1; // 0 = conectada (ex: 98), 1 = um buraco (ex: 97), etc.
  let score = hi + (isPair ? Math.max(hi * 2.3, 8) : 0);
  if (isSuited) score += 2;
  if (!isPair) {
    if (gap === 0) score += 1;
    else if (gap === 1) score += 0.5;
    else score -= gap * 1.2;
    if (hi === 14) score += 1; // Ás de qualquer kicker carrega equity de nut extra
  }
  return score;
}

// Tabela de percentil pré-computada pras 169 combinações de tipo de mão (13x13 — pares na
// diagonal, suited acima, offsuit abaixo). Percentil 0 = melhor mão possível (AA), 100 = pior
// (72o) — mesma convenção "menor é melhor" usada no resto do app, calculada aqui de forma
// independente a partir da heurística acima.
const RANKS_DESC = [14,13,12,11,10,9,8,7,6,5,4,3,2];
function buildHandTypePercentileTable() {
  const scored = [];
  for (let i = 0; i < RANKS_DESC.length; i++) {
    for (let j = 0; j < RANKS_DESC.length; j++) {
      const a = RANKS_DESC[i], b = RANKS_DESC[j];
      if (i === j) { scored.push({ key: `${rankLabel(a)}${rankLabel(a)}`, score: startingHandScore({ v: a, s: "♠" }, { v: a, s: "♥" }) }); continue; }
      if (i < j) scored.push({ key: `${rankLabel(a)}${rankLabel(b)}s`, score: startingHandScore({ v: a, s: "♠" }, { v: b, s: "♠" }) });
      else scored.push({ key: `${rankLabel(b)}${rankLabel(a)}o`, score: startingHandScore({ v: a, s: "♠" }, { v: b, s: "♥" }) });
    }
  }
  scored.sort((x, y) => y.score - x.score); // maior pontuação primeiro (melhor mão primeiro)
  const table = {};
  scored.forEach((entry, index) => { table[entry.key] = +(((index + 0.5) / scored.length) * 100).toFixed(2); });
  return table;
}
const HAND_TYPE_PERCENTILE = buildHandTypePercentileTable();

function handTypeKey(cardA, cardB) {
  const hi = cardA.v >= cardB.v ? cardA : cardB, lo = cardA.v >= cardB.v ? cardB : cardA;
  if (hi.v === lo.v) return `${rankLabel(hi.v)}${rankLabel(hi.v)}`;
  return `${rankLabel(hi.v)}${rankLabel(lo.v)}${hi.s === lo.s ? "s" : "o"}`;
}

// Percentil real (0=AA, 100=72o) de duas cartas — é a função pública usada pela IA e, depois,
// pela geração da mão do herói.
function handPercentile(cardA, cardB) {
  return HAND_TYPE_PERCENTILE[handTypeKey(cardA, cardB)];
}

// Abertura (RFI) por posição — quanto mais cedo a posição, mais apertado o range. Calibrado de
// forma independente (não é a mesma tabela do treino normal), mas na mesma ordem de grandeza de
// frequências reais publicamente conhecidas de torneio ~100bb.
const POSITION_RFI_PERCENTILE = { UTG: 15, UTG1: 17, MP: 20, MP1: 23, LJ: 27, HJ: 32, CO: 38, BTN: 50, SB: 45 };
// Defesa contra um raise: call e 3-bet, em pontos de percentil (quanto menor, mais apertado).
const FACING_RAISE_CALL_PERCENTILE = { UTG: 12, UTG1: 14, MP: 16, MP1: 18, LJ: 20, HJ: 23, CO: 27, BTN: 32, SB: 22, BB: 30 };
const FACING_RAISE_3BET_PERCENTILE = { UTG: 4, UTG1: 5, MP: 6, MP1: 7, LJ: 8, HJ: 9, CO: 10, BTN: 13, SB: 11, BB: 9 };
// Abaixo dessa profundidade de stack (em BB), o adversário para de fazer jogadas "normais" (open
// pequeno, call, 3-bet pequeno) e passa a jogar shove-or-fold — dinâmica real de torneio quando o
// stack fica raso demais pra qualquer outra linha fazer sentido.
const SHOVE_OR_FOLD_STACK_BB = 12;
// Range de shove por posição quando raso — mais largo que o range de open normal, porque não tem
// mais jogo pós-flop pra proteger.
const SHOVE_PERCENTILE = { UTG: 18, UTG1: 20, MP: 24, MP1: 28, LJ: 32, HJ: 38, CO: 46, BTN: 62, SB: 55, BB: 40 };

// Decide a ação de UM adversário nesta rodada pré-flop. `facing` é "NONE" (ninguém abriu ainda),
// "RAISE" (alguém já abriu) ou "3BET" (já teve um 3-bet). `canRaise` (default true) — falso só
// no caso da regra do raise incompleto (ver canPlayerRaise): quando não pode subir, uma mão que
// subiria vira CALL em vez disso (continua na mão, só não pode reabrir a aposta). Retorna
// { action, raiseToBB? }.
function decideVillainPreflopAction({ position, percentile, facing, stackBB, canRaise = true, rng }) {
  if (stackBB <= SHOVE_OR_FOLD_STACK_BB) {
    const shoveTh = SHOVE_PERCENTILE[position] ?? 30;
    if (percentile > shoveTh) return { action: "FOLD" };
    return canRaise ? { action: "SHOVE", raiseToBB: stackBB } : { action: "CALL" };
  }
  if (facing === "NONE") {
    const openTh = POSITION_RFI_PERCENTILE[position] ?? 20;
    if (percentile > openTh) return { action: "FOLD" };
    const raiseToBB = +(2.2 + (1 - percentile / openTh) * 0.8).toFixed(1); // mãos mais fortes abrem um pouco maior
    return canRaise ? { action: "RAISE", raiseToBB } : { action: "CALL" };
  }
  if (facing === "RAISE") {
    const threebetTh = FACING_RAISE_3BET_PERCENTILE[position] ?? 8;
    const callTh = FACING_RAISE_CALL_PERCENTILE[position] ?? 15;
    if (percentile <= threebetTh) return canRaise ? { action: "RAISE", raiseToBB: +(7 + rng() * 2).toFixed(1) } : { action: "CALL" };
    if (percentile <= callTh) return { action: "CALL" };
    return { action: "FOLD" };
  }
  // facing === "3BET": só continua com mãos bem fortes (4-bet ou call), o resto foldou.
  const fourbetTh = Math.max(2, (FACING_RAISE_3BET_PERCENTILE[position] ?? 8) * 0.4);
  const callTh = (FACING_RAISE_3BET_PERCENTILE[position] ?? 8) * 0.9;
  if (percentile <= fourbetTh) return canRaise ? { action: "RAISE", raiseToBB: +(16 + rng() * 4).toFixed(1) } : { action: "CALL" };
  if (percentile <= callTh) return { action: "CALL" };
  return { action: "FOLD" };
}

// Limiar de percentil relevante pra ESTA decisão específica — reaproveita exatamente as mesmas
// tabelas usadas pela IA dos adversários (nenhuma tabela nova, nenhuma régua diferente pro
// herói). É a distância até esse número que vira a "severidade" de um erro.
function relevantPreflopThreshold(position, facing, stackBB) {
  if (stackBB <= SHOVE_OR_FOLD_STACK_BB) return SHOVE_PERCENTILE[position] ?? 30;
  if (facing === "NONE") return POSITION_RFI_PERCENTILE[position] ?? 20;
  if (facing === "RAISE") return FACING_RAISE_CALL_PERCENTILE[position] ?? 15;
  return (FACING_RAISE_3BET_PERCENTILE[position] ?? 8) * 0.9;
}

// Avalia se a decisão do HERÓI bate com o que a mesma régua da IA (decideVillainPreflopAction)
// diria nessa exata situação — posição, força de mão, o que está em jogo e profundidade de
// stack. Não inventa uma régua mais dura ou mais fácil pro herói: é literalmente a mesma usada
// pra julgar os adversários. `rng` fixo em 0.5 pro veredito não variar sozinho de uma chamada
// pra outra (só o TAMANHO de raise/3-bet da IA usa rng, nunca a categoria fold/call/raise).
//
// A "punição" por decisões ruins não é um número arbitrário somado aqui — ela é só a
// consequência real de jogar mais mãos fracas/largas do que devia: mais equity perdida em
// showdown de verdade (evaluateBestHand), mais chance de precisar de rebuy, mais chance de ser
// eliminado. Esta função só CLASSIFICA a decisão pra poder mostrar o efeito disso ao jogador
// no resumo final — quem pune de verdade é o próprio jogo (mão real, avaliador real).
function evaluateHeroPreflopDecision({ position, percentile, facing, stackBB, heroAction }) {
  const baseline = decideVillainPreflopAction({ position, percentile, facing, stackBB, rng: () => 0.5 });
  const normalize = (a) => (a === "SHOVE" ? "RAISE" : a); // pra fins de categoria, shove conta como "jogar", igual raise
  const correct = normalize(heroAction) === normalize(baseline.action);
  const threshold = relevantPreflopThreshold(position, facing, stackBB);
  const severity = correct ? 0 : +Math.abs(percentile - threshold).toFixed(1);
  const mistakeType = correct ? null : (normalize(baseline.action) === "FOLD" ? "JOGOU_DEMAIS" : "FOLDOU_DEMAIS");
  return { correct, baselineAction: baseline.action, heroAction, threshold, severity, mistakeType };
}

// ---------- FASE 2c/2d — mesa do herói jogando uma mão pré-flop completa ----------
// Escopo desta etapa: rodada de aposta PRÉ-FLOP completa e correta (fold/call/raise/shove reais
// entre todos os jogadores da mesa, respeitando stack de cada um). Se a mão termina com só um
// jogador restante, ele leva o pote sem showdown (todo mundo foldou). Se sobra mais de um
// jogador depois do pré-flop, o board sai inteiro de uma vez e resolve no showdown por equity —
// apostas turno a turno no pós-flop (flop/turn/river) ficam pra uma etapa seguinte; isso já
// cobre a maioria das decisões reais de torneio, onde grande parte dos confrontos vira all-in
// ainda no pré-flop.

// Ordem de ação pré-flop (o primeiro da lista age primeiro); BTN/SB/BB sempre por último, nessa
// ordem — é assim que se decide qual posição cada assento ocupa conforme a mesa encolhe.
const POSITIONS_9MAX_ORDER = ["UTG", "UTG1", "MP", "LJ", "HJ", "CO", "BTN", "SB", "BB"];

function positionsForTableSize(tableSize) {
  const size = Math.max(2, Math.min(9, tableSize));
  if (size === 2) return ["SB", "BB"]; // heads-up: o BTN é o mesmo assento do SB
  return POSITIONS_9MAX_ORDER.slice(POSITIONS_9MAX_ORDER.length - size);
}

// Descobre a posição de um assento nesta mão, a partir do assento (índice já compactado, sem
// buracos — 0..tableSize-1) e do índice do BTN nessa mesma numeração compactada. Reduz a
// diferença direto módulo o tamanho ATUAL da mesa — nunca módulo 9 primeiro, porque isso dá
// resultado errado (colisão de posições) sempre que a mesa não tem exatamente 9 assentos, que é
// exatamente o caso da mesa final encolhendo (bug real encontrado testando o balanceamento).
function heroPositionFromSeats(heroSeat, btnSeat, tableSize) {
  const positions = positionsForTableSize(tableSize);
  const n = positions.length;
  if (n === 2) return heroSeat === btnSeat ? "SB" : "BB";
  const offsetFromBtn = (((heroSeat - btnSeat) % n) + n) % n;
  const btnIdx = positions.indexOf("BTN");
  return positions[(btnIdx + offsetFromBtn) % n];
}

function sumArray(arr) { return arr.reduce((a, b) => a + b, 0); }

// ---- Cursor retomável: a mesma lógica acima, mas pausável exatamente na vez do herói ----
// Motivo de existir: numa tela de verdade, o herói pode decidir mais de uma vez na mesma mão
// (ex: abre e depois enfrenta um 3-bet) e cada decisão vem de um clique — que é assíncrono. A
// versão síncrona acima (heroDecisionPolicy chamada e resolvida na hora) não dá pra usar direto
// numa UI real. O cursor guarda todo o estado mutável da rodada num objeto só, permitindo rodar
// os vilões automaticamente até a vez do herói, devolver o controle pra UI, e retomar de onde
// parou quando a decisão chegar (function `applyHeroDecision` + `stepPreflopRound` de novo).
function createPreflopRoundCursor({ positions, stacksBB, percentileBySeat, heroIndex, rng }) {
  const n = positions.length;
  const folded = new Array(n).fill(false);
  const committedBB = new Array(n).fill(0);
  const sbIdx = positions.indexOf("SB"), bbIdx = positions.indexOf("BB");
  const btnIdx = positions.indexOf("BTN");
  const effectiveStacksBB = [...stacksBB];
  let anteBB = 0;
  if (btnIdx >= 0) { anteBB = Math.min(1, effectiveStacksBB[btnIdx]); effectiveStacksBB[btnIdx] -= anteBB; }
  const post = (idx, amt) => { committedBB[idx] = Math.min(effectiveStacksBB[idx], amt); };
  post(sbIdx, 0.5);
  post(bbIdx, 1);
  return {
    positions, n, percentileBySeat, heroIndex, rng, folded, committedBB, effectiveStacksBB,
    btnIdx, anteBB, currentBetBB: committedBB[bbIdx], order: positions.map((_, i) => i),
    actedSinceRaise: new Set(), history: [], ptr: 0, guard: 0, done: false, finalResult: null,
    // Regra do raise incompleto: um all-in que NÃO alcança o tamanho mínimo de raise exigido
    // (menor que o último incremento de raise) não reabre a ação pra quem já agiu nesta rodada —
    // eles só podem pagar ou foldar, não voltar a subir. Um all-in que alcança ou supera o
    // mínimo reabre normalmente. minRaiseIncrement começa em 1 BB (o próprio BB já define o
    // primeiro incremento mínimo pra um open completo).
    minRaiseIncrement: 1,
    lastRaiseWasComplete: true,
  };
}

// Pode este jogador subir a aposta agora? Só falso no caso específico da regra acima: o último
// aumento foi um all-in incompleto E este jogador já tinha agido desde o último aumento
// completo (então já "gastou" a vez dele de reagir a um aumento de verdade).
function canPlayerRaise(cursor, idx) {
  return cursor.lastRaiseWasComplete || !cursor.actedSinceRaise.has(idx);
}

function activeCountInCursor(cursor) { return cursor.order.filter((i) => !cursor.folded[i]).length; }

function finalizePreflopRound(cursor) {
  const potBB = sumArray(cursor.committedBB) + cursor.anteBB;
  const survivors = cursor.order.filter((i) => !cursor.folded[i]);
  const totalContributedBB = cursor.committedBB.map((v, i) => v + (i === cursor.btnIdx ? cursor.anteBB : 0));
  cursor.done = true;
  cursor.finalResult = { folded: cursor.folded, committedBB: cursor.committedBB, totalContributedBB, potBB, survivors, history: cursor.history, heroFolded: cursor.folded[cursor.heroIndex] };
  return cursor.finalResult;
}

function facingLevelFor(cursor) { return cursor.currentBetBB <= 1 ? "NONE" : cursor.currentBetBB <= 3.5 ? "RAISE" : "3BET"; }

function applyPreflopAction(cursor, idx, decision) {
  // Guarda o contexto da decisão (percentil da mão, o que estava em jogo) junto no histórico —
  // é isso que permite avaliar depois se a decisão do herói foi boa ou ruim, comparando contra a
  // mesma régua usada pelos adversários (ver evaluateHeroPreflopDecision), sem precisar duplicar
  // lógica nem re-simular nada.
  const meta = { facing: facingLevelFor(cursor), stackBB: cursor.effectiveStacksBB[idx], percentile: cursor.percentileBySeat[idx] };
  if (decision.action === "FOLD") { cursor.folded[idx] = true; cursor.history.push({ idx, position: cursor.positions[idx], action: "FOLD", ...meta }); return; }
  // Defesa: se por algum motivo a decisão pedir pra subir quando a regra do raise incompleto
  // não permite (ver canPlayerRaise), rebaixa pra CALL — protege a corretude mesmo se quem
  // decidiu (IA ou a tela) não tiver checado a regra antes de responder.
  const wantsToRaise = decision.action !== "CALL";
  if (wantsToRaise && !canPlayerRaise(cursor, idx)) {
    cursor.committedBB[idx] = Math.min(cursor.effectiveStacksBB[idx], cursor.currentBetBB);
    cursor.history.push({ idx, position: cursor.positions[idx], action: "CALL", toBB: cursor.committedBB[idx], ...meta });
    cursor.actedSinceRaise.add(idx);
    return;
  }
  if (decision.action === "CALL") { cursor.committedBB[idx] = Math.min(cursor.effectiveStacksBB[idx], cursor.currentBetBB); cursor.history.push({ idx, position: cursor.positions[idx], action: "CALL", toBB: cursor.committedBB[idx], ...meta }); cursor.actedSinceRaise.add(idx); return; }
  const raiseTo = (() => {
    // O menor raise "completo" permitido agora é sempre a aposta atual + o incremento mínimo
    // vigente (nunca o valor da última aposta ficar menor que isso, exceto quando o stack não
    // alcança — aí vira um all-in incompleto de verdade, tratado abaixo). Isso substitui a
    // heurística antiga (+0,5bb / 15% a mais) por um cálculo exato, e resolve por definição o
    // cabo de guerra de re-raise em incrementos mínimos: qualquer raise completo já nasce no
    // tamanho mínimo LEGAL, nunca menor que a aposta atual.
    const minLegalRaise = cursor.currentBetBB + cursor.minRaiseIncrement;
    const intended = decision.raiseToBB || minLegalRaise;
    let proposed = Math.min(cursor.effectiveStacksBB[idx], Math.max(intended, minLegalRaise));
    // Regra separada: um raise nunca pode deixar menos de 1bb no stack — vira shove nesse caso.
    if (cursor.effectiveStacksBB[idx] - proposed < 1) proposed = cursor.effectiveStacksBB[idx];
    return proposed;
  })();
  cursor.committedBB[idx] = raiseTo;
  if (raiseTo > cursor.currentBetBB) {
    const increment = raiseTo - cursor.currentBetBB;
    const isCompleteRaise = increment >= cursor.minRaiseIncrement - 1e-9;
    cursor.currentBetBB = raiseTo;
    if (isCompleteRaise) {
      // Raise de verdade (ou all-in que alcança o mínimo): reabre a ação pra todo mundo, e o
      // tamanho desse aumento vira a nova régua mínima pro próximo re-raise.
      cursor.minRaiseIncrement = increment;
      cursor.actedSinceRaise = new Set([idx]);
      cursor.lastRaiseWasComplete = true;
    } else {
      // All-in incompleto (menor que o mínimo exigido): vira o novo valor a igualar pra todo
      // mundo, mas NÃO reabre a ação pra quem já tinha agido — eles só podem pagar ou foldar a
      // partir daqui, não subir de novo (regra real do pôquer).
      cursor.actedSinceRaise.add(idx);
      cursor.lastRaiseWasComplete = false;
    }
  } else {
    cursor.actedSinceRaise.add(idx);
  }
  cursor.history.push({ idx, position: cursor.positions[idx], action: decision.action, toBB: raiseTo, ...meta });
}

// Roda os vilões automaticamente até a vez do herói ou o fim da rodada. Retorna
// { status: "awaiting_hero", context } (a UI mostra a decisão e chama applyPreflopAction +
// stepPreflopRound de novo pra continuar) ou { status: "done", result }.
function stepPreflopRound(cursor) {
  if (cursor.done) return { status: "done", result: cursor.finalResult };
  while (cursor.guard++ < 300) {
    if (activeCountInCursor(cursor) <= 1) return { status: "done", result: finalizePreflopRound(cursor) };
    const idx = cursor.order[cursor.ptr % cursor.n];
    cursor.ptr++;
    if (cursor.folded[idx]) continue;
    const stackLeft = cursor.effectiveStacksBB[idx] - cursor.committedBB[idx];
    const toCall = cursor.currentBetBB - cursor.committedBB[idx];
    if (stackLeft <= 0) { cursor.actedSinceRaise.add(idx); if ([...cursor.actedSinceRaise].filter((i) => !cursor.folded[i]).length >= activeCountInCursor(cursor)) return { status: "done", result: finalizePreflopRound(cursor) }; continue; }
    if (toCall <= 0 && cursor.actedSinceRaise.has(idx)) return { status: "done", result: finalizePreflopRound(cursor) };

    const facing = cursor.currentBetBB <= 1 ? "NONE" : cursor.currentBetBB <= 3.5 ? "RAISE" : "3BET";
    const canRaise = canPlayerRaise(cursor, idx);
    if (idx === cursor.heroIndex) {
      return {
        status: "awaiting_hero",
        context: { seatIndex: idx, position: cursor.positions[idx], facing, toCallBB: Math.max(0, toCall), potBB: sumArray(cursor.committedBB) + cursor.anteBB, currentBetBB: cursor.currentBetBB, stackBB: cursor.effectiveStacksBB[idx], percentile: cursor.percentileBySeat[idx], canRaise },
      };
    }
    const decision = decideVillainPreflopAction({ position: cursor.positions[idx], percentile: cursor.percentileBySeat[idx], facing, stackBB: cursor.effectiveStacksBB[idx], canRaise, rng: cursor.rng });
    applyPreflopAction(cursor, idx, decision);
  }
  return { status: "done", result: finalizePreflopRound(cursor) }; // guarda de segurança (não deveria bater em uso normal)
}

// Aplica a decisão do herói (vinda da UI, ou da política síncrona nos testes) e já continua a
// rodada — chamar de novo se o retorno pedir mais uma decisão do herói (ação reaberta).
function applyHeroDecision(cursor, decision) {
  applyPreflopAction(cursor, cursor.heroIndex, decision);
  return stepPreflopRound(cursor);
}

// Roda a rodada de aposta pré-flop inteira de forma síncrona (usa o cursor por baixo, mas
// resolve tudo de uma vez) — mantém o comportamento e a assinatura originais desta função pra
// nenhum teste/uso existente precisar mudar. `heroDecisionPolicy` é chamada toda vez que a ação
// chega no herói (pode ser mais de uma, se a ação reabrir).
function runPreflopBettingRound({ positions, stacksBB, percentileBySeat, heroIndex, heroDecisionPolicy, rng }) {
  const cursor = createPreflopRoundCursor({ positions, stacksBB, percentileBySeat, heroIndex, rng });
  let step = stepPreflopRound(cursor);
  while (step.status === "awaiting_hero") {
    const decision = heroDecisionPolicy(step.context);
    step = applyHeroDecision(cursor, decision);
  }
  return step.result;
}

// Reparte o pote em camadas de main/side pot a partir de quanto cada assento contribuiu no
// total (dead money de quem foldou continua financiando a camada que alcançou, mas só quem
// ainda está na mão pode ganhá-la). Sem isso, um multi-shove com stacks efetivos DIFERENTES
// premiava quem tinha a mão mais forte com o pote inteiro, mesmo que parte dele só tivesse sido
// colocada por outros dois stacks mais fundos entre si — ficha que nunca poderia ser dele. Mesma
// lógica de camadas já usada na tela (ver calculateSidePots em Trainer.jsx), adaptada aqui pra
// decidir vencedor por força de mão em vez de só exibir o valor.
function splitPotIntoLayers(totalContributedBB, survivors) {
  const contributions = totalContributedBB
    .map((amount, idx) => ({ idx, amount: Math.max(0, Number(amount) || 0) }))
    .filter((c) => c.amount > 0);
  const levels = [...new Set(contributions.map((c) => c.amount))].sort((a, b) => a - b);
  const layers = [];
  let previousLevel = 0;
  for (const level of levels) {
    const funding = contributions.filter((c) => c.amount >= level);
    const amount = (level - previousLevel) * funding.length;
    previousLevel = level;
    if (amount <= 1e-9) continue;
    // Quando só um contribuinte alcança este nível, a camada nem é disputada — ele é o único
    // "elegível" e a fatia inteira volta pra ele, exatamente como uma aposta não paga (uncalled
    // bet) é devolvida na régua real do pôquer.
    const eligible = funding.map((c) => c.idx).filter((idx) => survivors.includes(idx));
    layers.push({ amount, eligible });
  }
  return layers;
}

// Transforma o resultado bruto da rodada (quem sobrou, quanto cada um apostou) no resultado
// final da mão (showdown ou vitória sem showdown) — extraído à parte pra ser reaproveitado tanto
// pelo playHeroHand síncrono quanto pelo par retomável begin/resumeTableHandDecision (Fase 4).
function finalizeHeroHandResult({ positions, heroIndex, heroPosition, hands, board, round }) {
  const heroContributedBB = round.totalContributedBB[heroIndex];
  // Todo mundo começa "perdendo" exatamente o que colocou; cada camada de pote ganha soma de
  // volta só pra quem a venceu — a soma final bate exatamente com round.potBB por construção
  // (splitPotIntoLayers particiona o total contribuído sem sobrar nem faltar ficha nenhuma).
  const perSeatDeltaBB = totalContributedBBArray(positions, round);

  if (round.survivors.length === 1) {
    const winnerIdx = round.survivors[0];
    perSeatDeltaBB[winnerIdx] += round.potBB;
    const heroWon = winnerIdx === heroIndex;
    return {
      heroPosition, heroCards: hands[heroIndex], board: [], involved: !round.heroFolded && heroContributedBB > 1,
      wentToShowdown: false, heroWon, heroChipDeltaBB: perSeatDeltaBB[heroIndex], potBB: round.potBB, history: round.history,
      perSeatChipDeltaBB: positions.map((position, idx) => ({ position, chipDeltaBB: perSeatDeltaBB[idx] })),
    };
  }

  const evalByIdx = new Map(round.survivors.map((idx) => [idx, evaluateBestHand([...hands[idx], ...board]).evalArray]));
  const bestAmong = (candidateIdxs) => {
    let best = evalByIdx.get(candidateIdxs[0]);
    let winners = [candidateIdxs[0]];
    for (const idx of candidateIdxs.slice(1)) {
      const cmp = compareEval(evalByIdx.get(idx), best);
      if (cmp > 0) { best = evalByIdx.get(idx); winners = [idx]; }
      else if (cmp === 0) winners.push(idx);
    }
    return winners;
  };

  let winnerIdx = null, heroWon = false, heroSplit = false, deadMoneyBB = 0;
  for (const layer of splitPotIntoLayers(round.totalContributedBB, round.survivors)) {
    if (layer.eligible.length === 0) { deadMoneyBB += layer.amount; continue; } // ver nota em splitPotIntoLayers — não deveria disparar em uso normal
    const winners = bestAmong(layer.eligible);
    const share = layer.amount / winners.length;
    winners.forEach((idx) => {
      perSeatDeltaBB[idx] += share;
      if (idx === heroIndex) { heroWon = true; if (winners.length > 1) heroSplit = true; }
    });
    // Camada relatada como "o" vencedor = a primeira (o main pot, sempre a camada de menor nível
    // e a que todo sobrevivente disputa) — side pots subsequentes não sobrescrevem esse valor.
    if (winnerIdx === null) winnerIdx = winners[0];
  }
  if (deadMoneyBB > 1e-9) {
    // Salvaguarda: nenhuma camada deveria ficar sem elegível em uso normal, mas se acontecer a
    // ficha não pode sumir — vai pra melhor mão entre todos os sobreviventes.
    const winners = bestAmong(round.survivors);
    const share = deadMoneyBB / winners.length;
    winners.forEach((idx) => { perSeatDeltaBB[idx] += share; if (idx === heroIndex) heroWon = true; });
  }

  const heroInShowdown = round.survivors.includes(heroIndex);
  return {
    heroPosition, heroCards: hands[heroIndex], board, involved: !round.heroFolded && heroContributedBB > 1,
    wentToShowdown: heroInShowdown, heroWon, heroSplit, heroChipDeltaBB: perSeatDeltaBB[heroIndex], potBB: round.potBB,
    winnerIdx, history: round.history,
    perSeatChipDeltaBB: positions.map((position, idx) => ({ position, chipDeltaBB: perSeatDeltaBB[idx] })),
  };
}
function totalContributedBBArray(positions, round) {
  return positions.map((_, idx) => -Number(round.totalContributedBB[idx] || 0));
}

// Monta e joga uma mão completa na mesa do herói: sorteia cartas reais (nunca repetidas — usa
// dealTable), roda o pré-flop de verdade, e se sobrar mais de um jogador, resolve o board
// inteiro no showdown. `heroStackBB`/`villainStackHintBB` vêm de fora (o motor de torneio da
// Fase 1 não é importado aqui — ver decisão de arquitetura desta fase).
function playHeroHand({ heroSeat, btnSeat, tableSize, heroStackBB, villainStackHintBB, stacksBBOverride, heroCardsOverride, heroDecisionPolicy, seedStr }) {
  const rng = tournamentRng(seedStr);
  const positions = positionsForTableSize(tableSize);
  const n = positions.length;
  const heroPosition = heroPositionFromSeats(heroSeat, btnSeat, tableSize);
  const heroIndex = positions.indexOf(heroPosition);

  const { hands, board } = dealTable({ seatCount: n, boardSize: 5, rng, heroSeatIndex: heroIndex, heroCardsOverride });
  const stacksBB = positions.map((_, i) => {
    if (i === heroIndex) return heroStackBB;
    if (stacksBBOverride) return stacksBBOverride[i];
    return Math.max(3, +((villainStackHintBB) * (0.5 + rng() * 1.5)).toFixed(1));
  });
  const percentileBySeat = hands.map((cards) => handPercentile(cards[0], cards[1]));

  const round = runPreflopBettingRound({ positions, stacksBB, percentileBySeat, heroIndex, heroDecisionPolicy, rng });
  return finalizeHeroHandResult({ positions, heroIndex, heroPosition, hands, board, round });
}

// ---- Par retomável: começa a mão e pausa exatamente na decisão do herói (pra UI de verdade) ----
// beginHeroHand faz tudo que playHeroHand faz ANTES da rodada de aposta (sorteia cartas, monta
// stacks) e já avança os vilões automaticamente até a vez do herói. Guarda tudo que precisa pra
// continuar depois (positions/heroIndex/hands/board/cursor) dentro do próprio retorno — a UI só
// precisa guardar esse objeto e devolver pra resumeHeroHandDecision quando o herói clicar.
function beginHeroHand({ heroSeat, btnSeat, tableSize, heroStackBB, villainStackHintBB, stacksBBOverride, heroCardsOverride, seedStr }) {
  const rng = tournamentRng(seedStr);
  const positions = positionsForTableSize(tableSize);
  const n = positions.length;
  const heroPosition = heroPositionFromSeats(heroSeat, btnSeat, tableSize);
  const heroIndex = positions.indexOf(heroPosition);

  const { hands, board } = dealTable({ seatCount: n, boardSize: 5, rng, heroSeatIndex: heroIndex, heroCardsOverride });
  const stacksBB = positions.map((_, i) => {
    if (i === heroIndex) return heroStackBB;
    if (stacksBBOverride) return stacksBBOverride[i];
    return Math.max(3, +((villainStackHintBB) * (0.5 + rng() * 1.5)).toFixed(1));
  });
  const percentileBySeat = hands.map((cards) => handPercentile(cards[0], cards[1]));
  const cursor = createPreflopRoundCursor({ positions, stacksBB, percentileBySeat, heroIndex, rng });
  const step = stepPreflopRound(cursor);
  const session = { positions, heroIndex, heroPosition, hands, board, cursor };

  if (step.status === "done") return { status: "done", result: finalizeHeroHandResult({ positions, heroIndex, heroPosition, hands, board, round: step.result }) };
  // A UI usa isso pra mostrar a decisão de verdade: as cartas do herói já estão sorteadas
  // (session.hands[heroIndex]), o resto ainda não precisa ser revelado.
  return { status: "awaiting_hero", context: step.context, heroCards: hands[heroIndex], session };
}

// Continua uma mão pausada por beginHeroHand (ou por uma chamada anterior desta função, se a
// ação reabrir e o herói precisar decidir de novo). Recebe a decisão real (do clique da UI).
function resumeHeroHandDecision(session, decision) {
  const step = applyHeroDecision(session.cursor, decision);
  if (step.status === "done") {
    return { status: "done", result: finalizeHeroHandResult({ positions: session.positions, heroIndex: session.heroIndex, heroPosition: session.heroPosition, hands: session.hands, board: session.board, round: step.result }) };
  }
  return { status: "awaiting_hero", context: step.context, heroCards: session.hands[session.heroIndex], session };
}

export {
  hashStr, mulberry32, tournamentRng,
  SUITS, RANK_VALUES, rankLabel,
  createDeck, shuffleDeck, dealTable,
  HAND_CATEGORIES, evaluate5, evaluateBestHand, compareHands, compareEval,
  startingHandScore, HAND_TYPE_PERCENTILE, handTypeKey, handPercentile,
  POSITION_RFI_PERCENTILE, FACING_RAISE_CALL_PERCENTILE, FACING_RAISE_3BET_PERCENTILE,
  SHOVE_OR_FOLD_STACK_BB, SHOVE_PERCENTILE, decideVillainPreflopAction,
  relevantPreflopThreshold, evaluateHeroPreflopDecision,
  POSITIONS_9MAX_ORDER, positionsForTableSize, heroPositionFromSeats,
  runPreflopBettingRound, playHeroHand,
  createPreflopRoundCursor, stepPreflopRound, applyHeroDecision, canPlayerRaise,
  finalizeHeroHandResult, splitPotIntoLayers, beginHeroHand, resumeHeroHandDecision,
};