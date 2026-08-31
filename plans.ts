/**
 * Fonte única de verdade dos planos comerciais do NLH Trainer Pro One.
 *
 * Usado tanto no cliente (mostrar/ocultar UI, badges "PRO") quanto no
 * servidor (gating de verdade nas rotas de API — ver `canUseFeature` e
 * `checkDailyDecisionLimit`, que devem ser chamados em toda rota que serve
 * um recurso pago, nunca só confiar no que o cliente manda).
 *
 * Preços definidos em 28/08/2026: mensal R$34,90, semestral R$199,90
 * (corrigido de R$219,90 — não fazia sentido ser mais caro que 6x o
 * mensal), anual R$299,90. Oferta de fundador: R$19,90/mês nos primeiros
 * 6 meses para os primeiros assinantes. ELITE e plano de coaches ainda não
 * são vendidos — aparecem como "Em breve".
 */

export type PlanId = "free" | "pro";
export type BillingCycle = "monthly" | "semiannual" | "annual";

export const PRICING = {
  free: { priceCents: 0 },
  pro: {
    monthly: { priceCents: 3490, label: "Mensal" },
    semiannual: { priceCents: 19990, label: "Semestral", effectiveMonthlyCents: 3332 },
    annual: { priceCents: 29990, label: "Anual", effectiveMonthlyCents: 2499 },
  },
  founderOffer: {
    priceCents: 1990,
    durationMonths: 6,
    description: "Oferta de fundador: R$19,90/mês nos primeiros 6 meses (mensal padrão depois)",
  },
  trial: {
    days: 7,
    orDecisionsCap: 50,
    description: "7 dias de PRO OU 50 decisões completas, o que vier primeiro — sem exigir cartão",
  },
} as const;

/**
 * Matriz de acesso por recurso. Cada chave é um "feature flag" que tanto a
 * UI quanto as rotas de API consultam. Mantenha isso e a UI sempre
 * derivadas desta mesma tabela — nunca duplique os limites em outro lugar.
 */
export const FEATURE_MATRIX = {
  dailyDecisionLimit: { free: 10, pro: null }, // null = ilimitado
  streetsAllowed: { free: ["PRE_FLOP"], pro: ["PRE_FLOP", "FLOP", "TURN", "RIVER"] },
  explanationLevel: { free: "resumida", pro: "completa_25_indicadores" },
  rangeComparison: { free: false, pro: true },
  specificTrainings: { free: "limitados", pro: "todos" },
  leakFinder: { free: false, pro: true },
  provaMode: { free: false, pro: true },
  tournamentMode: { free: false, pro: true },
  historyLimit: { free: 20, pro: null },
  shareableReports: { free: false, pro: true },
} as const;

export type FeatureKey = keyof typeof FEATURE_MATRIX;

/** Estado mínimo de assinatura que o gating precisa enxergar. */
export interface SubscriptionState {
  plan: PlanId;
  status: "trialing" | "active" | "past_due" | "canceled" | "expired";
}

/** Um plano só concede os benefícios de PRO se estiver realmente ativo. */
function effectivePlan(sub: SubscriptionState): PlanId {
  if (sub.plan === "pro" && (sub.status === "active" || sub.status === "trialing")) {
    return "pro";
  }
  return "free"; // past_due / canceled / expired caem pro Gratuito automaticamente
}

/**
 * Checagem de acesso a um recurso booleano/qualitativo. Para recursos
 * numéricos (limite diário, histórico), use os valores de FEATURE_MATRIX
 * diretamente com `effectivePlan`.
 */
export function canUseFeature(sub: SubscriptionState, feature: FeatureKey): boolean {
  const plan = effectivePlan(sub);
  const value = FEATURE_MATRIX[feature][plan];
  return value === true || value === "todos" || value === "completa_25_indicadores";
}

export function getDailyDecisionLimit(sub: SubscriptionState): number | null {
  return FEATURE_MATRIX.dailyDecisionLimit[effectivePlan(sub)];
}

export function getHistoryLimit(sub: SubscriptionState): number | null {
  return FEATURE_MATRIX.historyLimit[effectivePlan(sub)];
}
