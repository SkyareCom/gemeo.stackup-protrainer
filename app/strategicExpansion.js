// Expansão estratégica aditiva do STACKUP HOLD'EM PRO.
// Nenhuma entrada ou ID legado é alterado: os novos estados são anexados ao banco mestre.

export const TRAINING_GROUP_ORDER = [
  "FUNDAMENTOS PRÉ-FLOP",
  "DEFESA DE BB",
  "DEFESA DE BLINDS",
  "GUERRA DE BLINDS",
  "FLAT EM POSIÇÃO",
  "JOGANDO DO CO/BTN",
  "ACUMULANDO FICHAS",
  "LIMPERS E MULTIWAY",
  "MULTIWAY E LIMPERS",
  "3-BET / 4-BET / COLD ACTION",
  "JOGO DE 3-BET",
  "ALL-IN / ICM",
  "ALL-IN E STACK CURTO",
  "PKO / BOUNTY",
  "HEADS-UP 2-MAX",
  "PÓS-FLOP",
  "RIVER",
];

export const EXPANSION_PRESETS = [
  { key: "SB_EP", label: "SB x EP", group: "DEFESA DE BLINDS", heroPositions: ["SB"], scenario: "FACING_RAISE", openerGroup: ["UTG","UTG1","MP"], forceStreetPreflop: true },
  { key: "SB_MP", label: "SB x MP", group: "DEFESA DE BLINDS", heroPositions: ["SB"], scenario: "FACING_RAISE", openerGroup: ["MP1","LJ","HJ"], forceStreetPreflop: true },
  { key: "SB_LP", label: "SB x CO/BTN", group: "DEFESA DE BLINDS", heroPositions: ["SB"], scenario: "FACING_RAISE", openerGroup: ["CO","BTN"], forceStreetPreflop: true },
  { key: "BB_LIMPERS", label: "BB x LIMPERS", group: "LIMPERS E MULTIWAY", heroPositions: ["BB"], strategicNodes: ["BB_VS_LIMPERS"], forceStreetPreflop: true },
  { key: "SB_LIMP_CALL", label: "SB LIMP-CALL", group: "LIMPERS E MULTIWAY", heroPositions: ["SB"], scenario: "LIMP_RAISE", preferredAction: "CALL", forceStreetPreflop: true },
  { key: "SB_LIMP_RAISE", label: "SB LIMP-RAISE", group: "LIMPERS E MULTIWAY", heroPositions: ["SB"], scenario: "LIMP_RAISE", preferredAction: "RAISE", forceStreetPreflop: true },
  { key: "FACING_4BET", label: "FACING 4-BET", group: "3-BET / 4-BET / COLD ACTION", scenario: "FACING_3BET", preflopLevel: 4, forceStreetPreflop: true },
  { key: "COLD_ACTION", label: "COLD CALL / 4-BET", group: "3-BET / 4-BET / COLD ACTION", strategicNodes: ["COLD_CALL_3BET","COLD_4BET"], forceStreetPreflop: true },
  { key: "FOURBET_POST", label: "POTE 4-BET", group: "3-BET / 4-BET / COLD ACTION", postflopContext: "4BET_POT", forcePostflop: true },
  { key: "ICM_5_8", label: "ICM 5–8 BB", group: "ALL-IN / ICM", stackRange: [5,8], forceStreetPreflop: true },
  { key: "ICM_9_12", label: "ICM 9–12 BB", group: "ALL-IN / ICM", stackRange: [9,12], forceStreetPreflop: true },
  { key: "ICM_13_18", label: "ICM 13–18 BB", group: "ALL-IN / ICM", stackRange: [13,18], forceStreetPreflop: true },
  { key: "ICM_19_25", label: "ICM 19–25 BB", group: "ALL-IN / ICM", stackRange: [19,25], forceStreetPreflop: true },
  { key: "PKO_REAL", label: "PKO MATEMÁTICO", group: "PKO / BOUNTY", strategicNodes: ["PKO_KO"], requiresBounty: true, forceStreetPreflop: true },
  { key: "HU_REAL", label: "HEADS-UP 2-MAX", group: "HEADS-UP 2-MAX", tableStructure: "HU_2MAX", requiresTableSize: 2 },
  { key: "POST_MULTIWAY", label: "PÓS-FLOP MULTIWAY", group: "PÓS-FLOP", minParticipants: 3, forcePostflop: true },
  { key: "CHECK_RAISE", label: "CHECK-RAISE", group: "PÓS-FLOP", strategicNodes: ["CHECK_RAISE_FLOP","CHECK_RAISE_TURN"], forcePostflop: true },
  { key: "SEQUENTIAL", label: "LINHAS SEQUENCIAIS", group: "PÓS-FLOP", requiresLine: true, forcePostflop: true },
  { key: "RIVER_BLUFF_CATCH", label: "RIVER BLUFF CATCH", group: "RIVER", streetOnly: "RIVER", bluffCatch: true },
  { key: "OVERBET_RESPONSE", label: "CONTRA OVERBET", group: "RIVER", scenario: "BET_150", forcePostflop: true },
  { key: "BLOCK_BET", label: "BLOCK BET 20–25%", group: "RIVER", strategicNodes: ["BLOCK_BET_RIVER"], streetOnly: "RIVER" },
];

const STACK_BUCKETS = [[5,8],[9,12],[13,18],[19,25]];
const STACK_NAMES = ["5_8","9_12","13_18","19_25"];
const LINE_DEFINITIONS = [
  ["CBET_FLOP_CHECK_TURN","TURN",["BET_FLOP","CHECK_TURN"]],
  ["DELAYED_CBET_TURN","TURN",["CHECK_FLOP","BET_TURN"]],
  ["DOUBLE_BARREL","TURN",["BET_FLOP","BET_TURN"]],
  ["TRIPLE_BARREL","RIVER",["BET_FLOP","BET_TURN","BET_RIVER"]],
  ["PROBE_BET","TURN",["CHECK_FLOP","PROBE_TURN"]],
  ["DONK_BET","FLOP",["DONK_FLOP"]],
  ["CHECK_RAISE_FLOP","FLOP",["CHECK_FLOP","RAISE_FLOP"]],
  ["CHECK_RAISE_TURN","TURN",["CALL_FLOP","CHECK_TURN","RAISE_TURN"]],
  ["BET_CHECKCHECK_RIVER","RIVER",["BET_FLOP","CHECK_TURN","CHECK_TURN","DECISION_RIVER"]],
  ["CALL_CALL_BLUFFCATCH","RIVER",["CALL_FLOP","CALL_TURN","BLUFF_CATCH_RIVER"]],
  ["RAISE_FLOP_BARREL","TURN",["RAISE_FLOP","BET_TURN"]],
];

const representativeBucket = (street, index) => {
  const byStreet = {
    FLOP: ["TOP_PAIR_TOP_KICKER","FLUSH_DRAW","MIDDLE_PAIR","AIR"],
    TURN: ["TOP_PAIR_TOP_KICKER","OESD","MIDDLE_PAIR","AIR"],
    RIVER: ["TOP_PAIR_TOP_KICKER","MIDDLE_PAIR","MISSED_FLUSH_DRAW","AIR"],
  };
  const list = byStreet[street];
  return list[index % list.length];
};

export function buildStrategicExpansionEntries(fase, street) {
  const entries = [];
  if (street === "PRE-FLOP") {
    for (const [stackIndex, stackRange] of STACK_BUCKETS.entries()) {
      for (const limperCount of [1,2,3]) {
        for (const limperGroup of ["EP","MP","LP"]) entries.push({
          scenario: "ISOLATE_LIMPERS", strategicNode: "BB_VS_LIMPERS", position: "BB",
          handType: "DYNAMIC", participantCount: limperCount + 1, limperCount, limperGroup,
          stackBucket: STACK_NAMES[stackIndex], stackRange, preflopLevel: 2, additive: true,
        });
      }
      for (const strategicNode of ["COLD_CALL_3BET","COLD_4BET"]) {
        for (const position of ["CO","BTN","SB","BB"]) for (const openerGroup of ["EP","MP","LP"]) entries.push({
          scenario: "FACING_3BET", strategicNode, position, openerGroup, handType: "DYNAMIC",
          participantCount: strategicNode === "COLD_CALL_3BET" ? 4 : 3,
          stackBucket: STACK_NAMES[stackIndex], stackRange, preflopLevel: strategicNode === "COLD_4BET" ? 4 : 3, additive: true,
        });
      }
      for (const huNode of ["HU_RFI","HU_LIMP","HU_BB_VS_LIMP","HU_BB_VS_RAISE","HU_3BET","HU_FACING_3BET","HU_4BET","HU_PUSH_FOLD"]) entries.push({
        scenario: huNode === "HU_RFI" ? "RFI" : huNode === "HU_PUSH_FOLD" ? "OPEN_SHOVE" : huNode === "HU_FACING_3BET" ? "FACING_3BET" : huNode === "HU_BB_VS_RAISE" ? "FACING_RAISE" : huNode === "HU_3BET" ? "FACING_RAISE" : huNode === "HU_4BET" ? "FACING_3BET" : "ISOLATE_LIMPERS",
        strategicNode: huNode, position: huNode.startsWith("HU_BB") ? "BB" : "SB", handType: "DYNAMIC",
        participantCount: 2, tableStructure: "HU_2MAX", rangeProfile: "HU", stackBucket: STACK_NAMES[stackIndex], stackRange,
        preflopLevel: huNode === "HU_4BET" ? 4 : huNode.includes("3BET") ? 3 : 2, additive: true,
      });
      for (const coversVillain of [true,false]) for (const availableBounties of [1,2]) entries.push({
        scenario: "FACING_SHOVE", strategicNode: "PKO_KO", position: "BB", handType: "DYNAMIC", participantCount: availableBounties + 1,
        stackBucket: STACK_NAMES[stackIndex], stackRange, coversVillain, availableBounties,
        heroBountyBB: 5 + stackIndex * 2, villainBountyBB: 8 + availableBounties * 4, preflopLevel: 5, additive: true,
      });
    }
    return entries;
  }

  LINE_DEFINITIONS.filter(([,targetStreet]) => targetStreet === street).forEach(([lineKey,,actionHistory], lineIndex) => {
    for (const context of ["SINGLE_RAISED","3BET_POT","4BET_POT"]) for (const participantCount of [2,3,4]) for (const spr of ["DEEP","MEDIUM","SHALLOW"]) entries.push({
      position: lineIndex % 2 ? "BB" : "BTN", scenario: lineKey.includes("CHECK") ? "BET_50" : "CHECKED",
      bucket: representativeBucket(street, lineIndex), spr, participantCount, context,
      preflopLevel: context === "4BET_POT" ? 4 : context === "3BET_POT" ? 3 : 2,
      strategicNode: lineKey.includes("CHECK_RAISE") ? lineKey : "SEQUENTIAL_LINE", lineKey, actionHistory, additive: true,
    });
  });

  if (street === "RIVER") for (const sizing of [0.20,0.25]) for (const responseNode of ["LEAD","FACE_RAISE","FOLD_RAISE","CALL_RAISE","BLUFF_TRANSFORM"]) for (const blockerClass of ["NUT_BLOCKER","SECOND_BLOCKER","NO_BLOCKER"]) entries.push({
    position: "BTN", scenario: responseNode.includes("RAISE") ? "BET_50" : "CHECKED", bucket: responseNode === "BLUFF_TRANSFORM" ? "MISSED_FLUSH_DRAW" : "MIDDLE_PAIR", spr: "MEDIUM",
    participantCount: 2, context: "SINGLE_RAISED", preflopLevel: 2, strategicNode: "BLOCK_BET_RIVER",
    blockBetSizing: sizing, responseNode, blockerClass,
    actionHistory: responseNode.includes("RAISE") ? [`BLOCK_BET_${Math.round(sizing * 100)}`,"VILLAIN_RAISE","DECISION_RIVER"] : ["RIVER_DECISION"], additive: true,
  });

  for (const scenario of ["CHECKED","BET_50","BET_100"]) for (const spr of ["DEEP","MEDIUM","SHALLOW"]) entries.push({
    position: "SB", scenario, bucket: representativeBucket(street, scenario.length), spr, participantCount: 2,
    tableStructure: "HU_2MAX", rangeProfile: "HU", context: "SINGLE_RAISED", preflopLevel: 2,
    strategicNode: "HU_POSTFLOP", actionHistory: street === "FLOP" ? [] : ["HU_PREVIOUS_STREET"], additive: true,
  });
  return entries;
}

export function strategicSignature(entry) {
  const normalize = value => Array.isArray(value) ? value.join(">") : value ?? "-";
  return [
    entry.fase, entry.street, entry.tableStructure || "STANDARD", entry.position,
    normalize(entry.openerGroup || entry.openerPos), normalize(entry.villainPositions || entry.villainPos),
    entry.strategicNode || entry.scenario, entry.preflopLevel || 2, entry.stackBucket || "DYNAMIC",
    entry.participantCount || 2, entry.context || "SINGLE_RAISED", entry.spr || "-",
    entry.blockBetSizing || entry.scenario || "-", entry.handType || entry.bucket || "DYNAMIC",
    entry.boardTexture || "DYNAMIC", normalize(entry.actionHistory), entry.coversVillain ?? "-",
    entry.availableBounties || "-", entry.icmBucket || entry.fase || "-",
    entry.limperCount || "-", entry.limperGroup || "-", entry.responseNode || "-", entry.blockerClass || "-",
  ].join("|");
}

export function matchesExpansionPreset(entry, preset) {
  if (preset.streetOnly && entry.street !== preset.streetOnly) return false;
  if (preset.forcePostflop && entry.street === "PRE-FLOP") return false;
  if (preset.heroPositions && !preset.heroPositions.includes(entry.position)) return false;
  if (preset.scenario && entry.scenario !== preset.scenario) return false;
  if (preset.preflopLevel && entry.preflopLevel !== preset.preflopLevel) return false;
  if (preset.postflopContext) {
    const realContext = entry.preflopLevel === 4 ? "4BET_POT" : entry.context;
    if (realContext !== preset.postflopContext) return false;
  }
  if (preset.minParticipants && (entry.participantCount || 2) < preset.minParticipants) return false;
  if (preset.tableStructure && entry.tableStructure !== preset.tableStructure) return false;
  if (preset.strategicNodes && !preset.strategicNodes.includes(entry.strategicNode)) return false;
  if (preset.stackRange) {
    if (!Array.isArray(entry.stackRange)) return false;
    if (entry.stackRange[0] !== preset.stackRange[0] || entry.stackRange[1] !== preset.stackRange[1]) return false;
  }
  if (preset.requiresLine && !entry.lineKey) return false;
  if (preset.bluffCatch && !(entry.street === "RIVER" && entry.scenario !== "CHECKED" && ["MIDDLE_PAIR","TOP_PAIR_TOP_KICKER","OVERPAIR"].includes(entry.bucket))) return false;
  return true;
}

export function bountyDecisionAdjustment(spot, equityRequired) {
  const bounty = spot.bountyState;
  if (!bounty) return { adjustedEquityRequired: equityRequired, knockoutValueBB: 0 };
  const coverage = bounty.coversVillain ? 1 : 0;
  const knockoutValueBB = coverage * bounty.villainBountyBB * Math.max(1, bounty.availableBounties) * 0.5;
  const traditionalRisk = Math.max(1, (spot.callChips || 0) / Math.max(1, spot.bb));
  const adjustedEquityRequired = Math.max(1, equityRequired - (knockoutValueBB / (traditionalRisk + knockoutValueBB)) * 18);
  return { adjustedEquityRequired, knockoutValueBB };
}
