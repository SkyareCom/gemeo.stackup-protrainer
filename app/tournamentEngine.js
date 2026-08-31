// ---------- MOTOR DO SIMULADOR DE TORNEIO (FASE 1 — sem tela) ----------
// Reaproveita a mesma progressão de níveis já usada pelo restante do app (FASES, em
// Trainer.jsx): EARLY GAME (nível 1-8) até FT FINAL (nível 27-35), com blind/ante calculados
// exatamente pela mesma fórmula (bb = nivel*200, sb = nivel*100, ante = bb — "BB ante": só o
// botão paga, uma vez, valendo 1 BB pra mesa toda). As fases D1 RE-ENTRY/D1 BAGGING não entram
// aqui — são de outro cenário (multi-day), não da progressão Early Game → FT de um torneio único.
//
// Só a mesa do herói é simulada de verdade (9-max, mão a mão — ver Fase 2). O resto do campo é
// abstraído estatisticamente: sabemos quantos jogadores restam e o stack médio deles, não a mão
// de cada um. Quando alguém é eliminado NA MESA DO HERÓI, um jogador vindo desse campo abstrato
// senta no lugar (balanceamento), até restarem 9 ou menos jogadores no total — aí a mesa do
// herói *é* a mesa final de verdade, sem abstração nenhuma.

const TOURNAMENT_LEVEL_BANDS = [
  { key: "EARLY GAME", nivel: 1, nivelMax: 8 },
  { key: "MID GAME", nivel: 9, nivelMax: 14 },
  { key: "LATE GAME", nivel: 15, nivelMax: 18 },
  { key: "BOLHA ITM", nivel: 19, nivelMax: 22 },
  { key: "BOLHA FT", nivel: 23, nivelMax: 26 },
  { key: "FT FINAL", nivel: 27, nivelMax: 35 },
];
const TOURNAMENT_MAX_LEVEL = TOURNAMENT_LEVEL_BANDS[TOURNAMENT_LEVEL_BANDS.length - 1].nivelMax;

// Nível em que o add-on acontece (só existe em torneios REBUY) — cai dentro de MID GAME, mesmo
// nível pedido.
const ADDON_LEVEL = 12;
// Até que nível o jogador ainda pode fazer rebuy (comum: primeira metade do Dia 1 "early stage").
const REBUY_CUTOFF_LEVEL = 6;

const FIELD_SIZES = [50, 100, 200];
const STARTING_STACKS = [30000, 40000, 50000];
// Nível dura um número fixo de mãos jogadas pelo herói, não um tempo de relógio — mais previsível
// e mais rápido de terminar um torneio inteiro numa sessão de treino.
const HANDS_PER_LEVEL_OPTIONS = [30, 40, 50];
const ACTION_TIMER_SEC = 15;

function blindsForLevel(level) {
  const bb = level * 200;
  const sb = level * 100;
  return { sb, bb, ante: bb }; // BB ante: um único ante, do tamanho do BB, cobre a mesa toda.
}

function faseForLevel(level) {
  const band = TOURNAMENT_LEVEL_BANDS.find((b) => level >= b.nivel && level <= b.nivelMax);
  return (band || TOURNAMENT_LEVEL_BANDS[TOURNAMENT_LEVEL_BANDS.length - 1]).key;
}

// Quantas mãos o herói joga antes do nível subir — escolhido direto pelo jogador (30/40/50),
// sem depender de tempo de relógio.
function handsPerLevel(handsPerLevelConfig) {
  return handsPerLevelConfig;
}

// Limiar de ITM (premiação): ~15% do campo, arredondado, mínimo 1.
function computeItmThreshold(fieldSize) {
  return Math.max(1, Math.round(fieldSize * 0.15));
}

// Curva de premiação simplificada (percentual do prize pool por posição paga) — decrescente,
// mais concentrada no topo, comum em estruturas de MTT padrão. Não precisa ser exata: existe só
// pra dar noção de posição/prêmio relativo, não é um cálculo financeiro real.
function payoutPercentForRank(rank, itmThreshold) {
  if (rank > itmThreshold) return 0;
  const share = 1 - (rank - 1) / itmThreshold;
  return +(share * share).toFixed(4); // decrescimento quadrático: topo bem mais concentrado
}

function bountyPerPlayer(startingStack) {
  // Valor de bounty nominal por jogador — proporcional ao stack inicial (mesma lógica de
  // calibração usada no resto do app pra bounty/PKO).
  return Math.round(startingStack * 0.12);
}

function createTournamentConfig({
  fieldSize = 100,
  tournamentType = "NORMAL", // "NORMAL" | "BOUNTY"
  buyInMode = "FREEZEOUT", // "FREEZEOUT" | "REBUY"
  startingStack = 40000,
  handsPerLevelConfig = 40,
  takesAddOn = true, // só relevante se buyInMode === "REBUY"
} = {}) {
  if (!FIELD_SIZES.includes(fieldSize)) throw new Error(`fieldSize inválido: ${fieldSize}`);
  if (!STARTING_STACKS.includes(startingStack)) throw new Error(`startingStack inválido: ${startingStack}`);
  if (!HANDS_PER_LEVEL_OPTIONS.includes(handsPerLevelConfig)) throw new Error(`handsPerLevelConfig inválido: ${handsPerLevelConfig}`);
  if (!["NORMAL", "BOUNTY"].includes(tournamentType)) throw new Error(`tournamentType inválido: ${tournamentType}`);
  if (!["FREEZEOUT", "REBUY"].includes(buyInMode)) throw new Error(`buyInMode inválido: ${buyInMode}`);
  return { fieldSize, tournamentType, buyInMode, startingStack, handsPerLevelConfig, takesAddOn, actionTimerSec: ACTION_TIMER_SEC };
}

// BTN sorteado no início (posição 0-8 na mesa de 9), girando sequencialmente a cada mão — ver
// advanceHand.
function initTournament(config, rng) {
  const itmThreshold = computeItmThreshold(config.fieldSize);
  return {
    config,
    level: 1,
    handsIntoLevel: 0,
    handsPlayed: 0,
    fieldRemaining: config.fieldSize,
    // Pool total de fichas em jogo no campo abstrato inteiro (incluindo a mesa do herói) — só
    // muda com rebuy/add-on (injeção de fichas novas). É o invariante que os testes conferem.
    totalChipsInPlay: config.fieldSize * config.startingStack,
    heroStack: config.startingStack,
    heroBusted: false,
    heroRebuys: 0,
    heroAddOnUsed: false,
    heroBountyCollected: config.tournamentType === "BOUNTY" ? 0 : null,
    itmThreshold,
    btnSeat: Math.floor(rng() * 9),
    heroSeat: Math.floor(rng() * 9),
    finished: false,
    finishRank: null, // preenchido quando o herói sai do torneio (bust ou campeão)
    // Rastreio de qualidade de decisão — não é um número arbitrário de "punição": é só a soma
    // real do saldo de fichas (perdas e ganhos de verdade, do avaliador de mãos real) nas mãos
    // em que o herói tomou pelo menos uma decisão errada, separado do saldo nas mãos onde jogou
    // tudo certo. Usado no resumo final pra mostrar o efeito real de jogar bem ou mal.
    chipsFromGoodDecisions: 0,
    chipsFromMistakes: 0,
    // Mais granular: uma mão pode ter mais de uma decisão do herói (abriu, depois enfrentou um
    // 3-bet) — "mista" é quando pelo menos uma foi certa e pelo menos uma foi errada na mesma
    // mão, distinto de "errou tudo". chipsFromMistakes = chipsAllWrong + chipsMixed (mantido
    // pra não quebrar quem já lê esse campo).
    handsAllCorrect: 0,
    handsAllWrong: 0,
    handsMixed: 0,
    chipsAllWrong: 0,
    chipsMixed: 0,
    decisionsCount: 0,
    mistakesCount: 0,
    mistakeLog: [], // últimos erros relevantes, cap de tamanho — ver applyHandResult em tournamentTableEngine.js
    // Frequência de abertura por posição (quantas vezes o herói abriu o jogo — RFI — estando
    // naquela posição) e taxa de vitória, pro relatório final.
    openCountByPosition: {},
    handsInvolved: 0,
    handsWon: 0,
    showdownsSeen: 0,
    showdownsWon: 0,
    log: [],
  };
}

function currentFase(state) {
  return faseForLevel(state.level);
}
function currentBlinds(state) {
  return blindsForLevel(state.level);
}

// Curva de referência: fração do campo original que deveria restar em cada nível — calibrada
// pra bater com as próprias fases do app (ITM batendo perto do fim de LATE GAME/BOLHA ITM, mesa
// final se formando ao longo de BOLHA FT, campeão coroado ao fim de FT FINAL). Interpolada
// linearmente entre os pontos, e independente de quantas mãos por nível o jogador escolheu —
// a MESMA história (bolha no mesmo nível, mesa final no mesmo nível) acontece com 30, 40 ou 50
// mãos por nível; só a velocidade real de mãos jogadas muda.
const FIELD_DECAY_CHECKPOINTS = [
  { level: 1, frac: 1.0 },
  { level: 8, frac: 0.55 },
  { level: 14, frac: 0.28 },
  { level: 18, frac: 0.19 }, // bolha: ainda um pouco acima do limiar de ITM (~15%)
  { level: 22, frac: 0.13 }, // ITM confirmado (abaixo do limiar)
  { level: 26, frac: 0.09 }, // mesa final se formando
  { level: 35, frac: 0.01 }, // essencialmente 1 jogador (campeão) ao fim
];

function targetFieldFraction(levelProgress) {
  const points = FIELD_DECAY_CHECKPOINTS;
  if (levelProgress <= points[0].level) return points[0].frac;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (levelProgress >= a.level && levelProgress <= b.level) {
      const t = (levelProgress - a.level) / (b.level - a.level);
      return a.frac + (b.frac - a.frac) * t;
    }
  }
  // Além do último ponto (nível 35): a curva NUNCA pode travar num piso fixo — pra campos
  // grandes, "1% do campo" já é 2+ jogadores inteiros, e uma meta que empaca num número exato
  // faz o decaimento parar de vez (o torneio nunca chegaria a ter 1 campeão). Continua caindo,
  // com a mesma inclinação do último trecho da curva, até esbarrar em 0 — o suficiente pra
  // qualquer tamanho de campo eventualmente convergir a 1 jogador só, dado mãos suficientes.
  const last = points[points.length - 1], prev = points[points.length - 2];
  const slope = (last.frac - prev.frac) / (last.level - prev.level);
  return Math.max(0, last.frac + slope * (levelProgress - last.level));
}

// Progresso de nível "sem teto" — usado só pra alimentar a curva de decaimento do campo.
// state.level (exibido na tela) trava em TOURNAMENT_MAX_LEVEL (não faz sentido mostrar "nível
// 47" pro jogador, a fase final já é FT FINAL), mas a curva de decaimento do campo abstrato
// precisa continuar avançando de verdade mesmo depois disso, ou o torneio nunca terminaria com
// campos grandes (ver nota em targetFieldFraction).
function continuousLevelProgress(state, extraHands = 0) {
  const perLevel = handsPerLevel(state.config.handsPerLevelConfig);
  return 1 + (state.handsPlayed + extraHands) / perLevel;
}

// Decaimento estatístico do campo abstrato numa única mão: compara o CAMPO REAL de agora contra
// o alvo da curva logo DEPOIS desta mão (progresso contínuo dentro do nível) — nunca contra o
// alvo teórico anterior. Isso é o que torna o modelo autocorretivo: se o campo já ficou um pouco
// adiantado da curva (por sorte no arredondamento), a diferença fica menor ou até zero, e a
// simulação desacelera sozinha até a curva alcançar de novo — em vez de acumular erro pra sempre,
// que era o bug da primeira versão (comparava só ponto teórico contra ponto teórico, ignorando
// onde o campo realmente estava).
function stepFieldDecay(state, rng) {
  if (state.fieldRemaining <= 1) return 0;
  const progressAfter = continuousLevelProgress(state, 1);
  const targetAfter = targetFieldFraction(progressAfter) * state.config.fieldSize;
  const expectedBusts = Math.max(0, state.fieldRemaining - targetAfter);
  const wholeBusts = Math.floor(expectedBusts);
  const fractional = expectedBusts - wholeBusts;
  const busts = wholeBusts + (rng() < fractional ? 1 : 0);
  return Math.min(busts, state.fieldRemaining - 1);
}

function applyLevelUpIfNeeded(state) {
  const perLevel = handsPerLevel(state.config.handsPerLevelConfig);
  if (state.handsIntoLevel < perLevel) return;
  state.handsIntoLevel = 0;
  if (state.level < TOURNAMENT_MAX_LEVEL) state.level += 1;
}

function applyAddOnIfNeeded(state) {
  if (state.config.buyInMode !== "REBUY") return;
  if (!state.config.takesAddOn) return;
  if (state.heroAddOnUsed) return;
  if (state.level < ADDON_LEVEL) return;
  state.heroAddOnUsed = true;
  // Add-on = 20x o BB corrente NO NÍVEL DO ADD-ON (não o stack inicial do torneio) — reflete o
  // valor real das fichas naquele momento do torneio, já que os blinds já subiram bastante até
  // o nível 12.
  const addOnChips = blindsForLevel(ADDON_LEVEL).bb * 20;
  state.heroStack += addOnChips;
  state.totalChipsInPlay += addOnChips;
  state.log.push({ level: state.level, event: "ADD_ON", chips: addOnChips });
}

// Chamado quando o herói é eliminado NA MESA DELE. Decide se acaba o torneio (freezeout, ou
// rebuy fora do período) ou se ele volta pro jogo com stack novo (rebuy dentro do período).
function handleHeroBust(state) {
  const canRebuy = state.config.buyInMode === "REBUY" && state.level <= REBUY_CUTOFF_LEVEL;
  if (canRebuy) {
    state.heroRebuys += 1;
    state.heroStack = state.config.startingStack;
    state.totalChipsInPlay += state.config.startingStack;
    state.log.push({ level: state.level, event: "REBUY", chips: state.config.startingStack });
    return;
  }
  state.heroBusted = true;
  state.finished = true;
  state.finishRank = state.fieldRemaining; // saiu com esse tanto de gente ainda no campo
  state.log.push({ level: state.level, event: "BUST", finishRank: state.finishRank });
}

// Ponto de entrada por mão: recebe o resultado da mão do herói (produzido pela Fase 2 — motor de
// mão real). heroChipDelta é o saldo de fichas do herói NAQUELA mão (negativo se perdeu, positivo
// se ganhou, ou null/undefined se ele nem participou de fato — ex: já era all-in coberto — nesse
// caso heroBusted informa diretamente).
function advanceHand(state, { heroChipDelta = 0, heroBusted = false, bountyCollected = 0 } = {}, rng) {
  if (state.finished) return state;

  state.heroStack = Math.max(0, state.heroStack + heroChipDelta);
  if (state.config.tournamentType === "BOUNTY" && bountyCollected > 0) {
    state.heroBountyCollected += bountyCollected;
    // Bounty coletado é fichas de um jogador eliminado saindo do jogo — não é criação de fichas
    // novas, então não mexe no totalChipsInPlay (o valor em fichas dele já estava contado; ele
    // simplesmente vai para o herói via heroChipDelta, que a Fase 2 já deve refletir).
  }

  // Rotaciona o BTN uma posição a cada mão (sentido horário, 9-max).
  state.btnSeat = (state.btnSeat + 1) % 9;

  // A mão foi jogada de verdade independente do resultado (inclusive quando é a própria mão que
  // elimina o herói) — precisa contar aqui, ANTES de qualquer retorno antecipado por bust.
  // Bug real encontrado testando o relatório final: o rastreamento de decisões da Fase 3 já
  // conta essa mesma mão como jogada antes de chamar advanceHand, mas handsPlayed só era
  // incrementado depois do trecho de bust, que retorna cedo — o contador ficava sempre 1 a
  // menos que o real na última mão de todo torneio que termina em eliminação (quase sempre),
  // dando VPIP acima de 100% no relatório.
  state.handsPlayed += 1;
  state.handsIntoLevel += 1;

  const bustedNow = heroBusted || state.heroStack <= 0;
  if (bustedNow) {
    handleHeroBust(state);
    if (state.finished) return state;
  }

  // Campo abstrato encolhe conforme o decaimento estatístico — nunca abaixo de 1 (o campeão).
  const busts = stepFieldDecay(state, rng);
  state.fieldRemaining = Math.max(1, state.fieldRemaining - busts);

  applyLevelUpIfNeeded(state);
  applyAddOnIfNeeded(state);

  // Torneio como um todo termina quando só resta 1 jogador no campo INTEIRO — se for o herói,
  // ele é o campeão.
  if (state.fieldRemaining <= 1) {
    state.finished = true;
    state.finishRank = 1;
    state.log.push({ level: state.level, event: "CHAMPION" });
  }

  return state;
}

function isBubble(state) {
  return state.fieldRemaining > state.itmThreshold && state.fieldRemaining <= state.itmThreshold + 3;
}
function isFinalTable(state) {
  return state.fieldRemaining <= 9;
}
function isITM(state) {
  return state.fieldRemaining <= state.itmThreshold;
}

// ---------- Histórico de colocações (ranking entre torneios) ----------
// Um histograma simples { posição: quantas vezes terminou nela } — persistência (localStorage)
// fica por conta de quem chama isso (a tela, igual ao resto do app já faz), aqui só a lógica
// pura de acumular e formatar pra exibição.
function recordFinish(histogram, finishRank) {
  const updated = { ...histogram };
  updated[finishRank] = (updated[finishRank] || 0) + 1;
  return updated;
}
function summarizeRankingHistogram(histogram) {
  return Object.entries(histogram)
    .map(([rank, count]) => ({ rank: Number(rank), count }))
    .sort((a, b) => a.rank - b.rank);
}
function totalTournamentsPlayed(histogram) {
  return Object.values(histogram).reduce((a, b) => a + b, 0);
}

// ---------- Relatório final do torneio ----------
// Classifica o estilo de jogo pelo VPIP (% de mãos em que o herói entrou de vontade própria —
// não é um rótulo arbitrário, são as faixas convencionais usadas em qualquer HUD de poker.
function classifyPlayerStyle(vpipPercent) {
  if (vpipPercent < 14) return "NIT (excessivamente apertado)";
  if (vpipPercent < 20) return "TIGHT (apertado)";
  if (vpipPercent < 28) return "EQUILIBRADO";
  if (vpipPercent < 40) return "LOOSE (solto demais)";
  return "MANÍACO (joga mãos demais)";
}

// Sugestão de treino simples e orientada a dado real: olha o mistakeLog acumulado e aponta a
// posição/tipo de erro mais frequente — não inventa um plano de estudo, só aponta pra onde o
// próprio histórico do torneio mostrou mais vazamento.
function recommendTrainingFocus(mistakeLog) {
  if (!mistakeLog.length) return null;
  const byKey = {};
  for (const m of mistakeLog) {
    const key = `${m.position}|${m.mistakeType}`;
    byKey[key] = (byKey[key] || 0) + 1;
  }
  const [worstKey, count] = Object.entries(byKey).sort((a, b) => b[1] - a[1])[0];
  const [position, mistakeType] = worstKey.split("|");
  const label = mistakeType === "JOGOU_DEMAIS" ? "jogando mãos fracas demais" : "foldando mãos fortes demais";
  return { position, mistakeType, count, text: `Foco recomendado: TREINO POR POSIÇÃO (${position}) — ${label} nessa posição (${count} vezes no torneio).` };
}

// Projeção de colocação: uma ESTIMATIVA (não uma re-simulação do torneio inteiro) de onde o
// herói teria terminado se as mãos com erro tivessem, no mínimo, resultado neutro em vez do
// resultado real que tiveram. Pega o stack inicial + só o efeito das boas decisões (o stack
// "limpo"), compara com o stack médio do campo no momento em que ele saiu, e projeta uma
// colocação proporcionalmente melhor quanto maior esse stack limpo for em relação à média —
// nunca abaixo de 1º lugar, nunca pior que a colocação real (o "pior caso" da projeção é
// exatamente o que já aconteceu).
function estimateProjectedFinish(state, report) {
  const actualRank = state.finishRank;
  if (!actualRank || actualRank <= 1) return { hypotheticalStack: null, projectedRank: actualRank, avgStackAtElimination: null };
  const hypotheticalStack = Math.max(0, state.config.startingStack + report.chipsFromGoodDecisions);
  const avgStackAtElimination = state.totalChipsInPlay / Math.max(1, actualRank);
  if (hypotheticalStack <= 0 || avgStackAtElimination <= 0) return { hypotheticalStack, projectedRank: actualRank, avgStackAtElimination };
  const projectedRank = Math.max(1, Math.round((actualRank * avgStackAtElimination) / (avgStackAtElimination + hypotheticalStack)));
  return { hypotheticalStack, projectedRank, avgStackAtElimination };
}

function buildTournamentReport(state) {
  const decisionHands = state.handsAllCorrect + state.handsAllWrong + state.handsMixed;
  const pct = (n, d) => (d > 0 ? +((n / d) * 100).toFixed(1) : 0);
  const vpipPercent = pct(state.handsInvolved, state.handsPlayed);
  const netChipEffect = state.chipsFromGoodDecisions + state.chipsFromMistakes;
  const report = {
    handsPlayed: state.handsPlayed,
    handsInvolved: state.handsInvolved,
    vpipPercent,
    playerStyle: classifyPlayerStyle(vpipPercent),
    decisionsCount: state.decisionsCount,
    mistakesCount: state.mistakesCount,
    decisionHands,
    correctPercent: pct(state.handsAllCorrect, decisionHands),
    wrongPercent: pct(state.handsAllWrong, decisionHands),
    mixedPercent: pct(state.handsMixed, decisionHands),
    chipsFromGoodDecisions: state.chipsFromGoodDecisions,
    chipsFromMistakes: state.chipsFromMistakes,
    chipsAllWrong: state.chipsAllWrong,
    chipsMixed: state.chipsMixed,
    netChipEffect,
    winPercent: pct(state.showdownsWon, state.showdownsSeen),
    showdownsSeen: state.showdownsSeen,
    openCountByPosition: { ...state.openCountByPosition },
    finishRank: state.finishRank,
    heroBusted: state.heroBusted,
    heroRebuys: state.heroRebuys,
    recommendedTraining: recommendTrainingFocus(state.mistakeLog),
  };
  report.projectedFinish = estimateProjectedFinish(state, report);
  return report;
}

// Formata o relatório em texto corrido, no estilo pedido: "você tomou X% de decisões corretas,
// Y% erradas, Z% mistas... isso te custou/fez lucrar N fichas... você é um jogador ESTILO...
// jogou H mãos e venceu W%... abriu o jogo do UTG x vezes, MP y vezes, BTN n vezes..."
// Ordem de exibição das posições no relatório (mesma ordem de ação usada no resto do motor) —
// só uma constante pequena e local, não vale a pena importar do motor de mão só por causa disso.
const POSITION_DISPLAY_ORDER = ["UTG", "UTG1", "MP", "LJ", "HJ", "CO", "BTN", "SB", "BB"];

function formatTournamentReportText(report) {
  const lines = [];
  lines.push(`Durante o torneio você tomou ${report.correctPercent}% de decisões corretas, ${report.wrongPercent}% erradas e ${report.mixedPercent}% mistas.`);
  const effectWord = report.netChipEffect >= 0 ? "lucrar" : "custar";
  lines.push(`No saldo, isso te fez ${effectWord} ${Math.abs(report.netChipEffect).toLocaleString("pt-BR")} fichas (${report.chipsFromGoodDecisions.toLocaleString("pt-BR")} em mãos bem jogadas, ${report.chipsFromMistakes.toLocaleString("pt-BR")} em mãos com erro).`);
  lines.push(`Você é um jogador ${report.playerStyle} (entrou em ${report.vpipPercent}% das mãos).`);
  if (report.recommendedTraining) lines.push(report.recommendedTraining.text);
  lines.push(`Você jogou ${report.handsPlayed} mãos e venceu ${report.winPercent}% dos showdowns (${report.showdownsSeen} no total).`);
  const openParts = POSITION_DISPLAY_ORDER
    .filter((pos) => report.openCountByPosition[pos])
    .map((pos) => `${pos.toLowerCase()} ${report.openCountByPosition[pos]}x`);
  if (openParts.length) lines.push(`Abriu o jogo: ${openParts.join(", ")}.`);
  lines.push(`Terminou na posição ${report.finishRank ?? "—"}${report.heroRebuys ? ` (com ${report.heroRebuys} rebuy${report.heroRebuys > 1 ? "s" : ""})` : ""}.`);
  // Projeção de colocação: só faz sentido comparar quando havia margem de melhora (não é já o
  // 1º lugar) e existe alguma estimativa de stack "limpo" pra comparar.
  const proj = report.projectedFinish;
  if (proj && report.finishRank > 1 && proj.hypotheticalStack !== null) {
    if (proj.projectedRank < report.finishRank) {
      lines.push(`Projeção: sem as mãos com erro, seu stack estimado seria de ${Math.round(proj.hypotheticalStack).toLocaleString("pt-BR")} fichas — nesse ritmo, uma estimativa aproximada te colocaria por volta da posição ${proj.projectedRank}, contra a posição ${report.finishRank} real.`);
    } else {
      lines.push(`Projeção: mesmo sem as mãos com erro, a estimativa não aponta melhora relevante na colocação — o resultado real (posição ${report.finishRank}) já reflete bem o nível de jogo nesta sessão.`);
    }
  }
  return lines.join("\n");
}

export {
  TOURNAMENT_LEVEL_BANDS,
  TOURNAMENT_MAX_LEVEL,
  ADDON_LEVEL,
  REBUY_CUTOFF_LEVEL,
  FIELD_SIZES,
  STARTING_STACKS,
  HANDS_PER_LEVEL_OPTIONS,
  ACTION_TIMER_SEC,
  blindsForLevel,
  faseForLevel,
  handsPerLevel,
  computeItmThreshold,
  payoutPercentForRank,
  bountyPerPlayer,
  createTournamentConfig,
  initTournament,
  currentFase,
  currentBlinds,
  advanceHand,
  isBubble,
  isFinalTable,
  isITM,
  recordFinish,
  summarizeRankingHistogram,
  totalTournamentsPlayed,
  classifyPlayerStyle,
  recommendTrainingFocus,
  estimateProjectedFinish,
  buildTournamentReport,
  formatTournamentReportText,
};
