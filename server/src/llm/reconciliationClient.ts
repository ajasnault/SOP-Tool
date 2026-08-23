import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
// Le helper zodOutputFormat du SDK attend spécifiquement l'API zod v4 (exposée
// via le sous-chemin "zod/v4" par ce paquet zod 3.25+, distincte de l'import
// "zod" par défaut en v3 utilisé ailleurs dans le projet, ex. ingestion/validate.ts).
import { z } from "zod/v4";
import { getLlmModel } from "../config.js";
import type { ReconciliationContext } from "../calc/reconciliation.js";
import { computeResultingGaps, type ReconciliationAction, type RecalcResult } from "../calc/reconciliationRecalc.js";
import { RECONCILIATION_SYSTEM_PROMPT } from "./reconciliationPrompt.js";

export interface ReconciliationOption {
  title: string;
  type: "lissage_temporel" | "ouverture_ligne" | "fermeture_ligne" | "mixte";
  description_bullets: string[];
  months_concerned: string[];
  actions: ReconciliationAction[];
  missing_data_warning: string | null;
}

export type ReconciliationOptionWithGaps = ReconciliationOption & { resulting_gaps: RecalcResult[] };

export interface ReconciliationGenerationResult {
  model: string;
  options: ReconciliationOptionWithGaps[];
  recommendedOptionIndex: number;
  recommendationJustification: string;
}

export type GenerationOutcome =
  | { ok: true; result: ReconciliationGenerationResult }
  | { ok: false; errorType: "missing_api_key" | "auth" | "rate_limit" | "timeout" | "connection" | "invalid_response" | "api_error"; message: string };

/**
 * Le schéma de sortie structurée est construit PAR APPEL à partir du contexte
 * réel (pas un schéma statique) : les identifiants (mois, machine, ligne,
 * site) sont contraints par z.enum() aux valeurs effectivement présentes dans
 * le contexte fourni au LLM. Sans ça, le LLM pourrait reformuler/tronquer un
 * identifiant (casse, espace, paraphrase) et la reconciliation avec
 * `computeResultingGaps` échouerait silencieusement (unavailable_reason) —
 * ici c'est structurellement impossible : une valeur hors domaine fait
 * échouer la validation Zod, donc échoue proprement (invalid_response) au
 * lieu de produire un recalcul silencieusement vide.
 */
function buildResponseSchema(context: ReconciliationContext) {
  const months = context.unfrozenMonths;
  const machineIds = [...new Set(context.capacityGaps.map((g) => g.machine_id))];
  const lines = [...new Set(context.lineUtilizationTrend.map((l) => l.production_line))];
  const sites = [...new Set(context.lineUtilizationTrend.map((l) => l.site).filter((s): s is string => s !== null))];

  // z.enum() exige un tableau non vide ; le repli sur z.string() ci-dessous ne
  // s'active que si le contexte lui-même n'a aucune valeur pour ce domaine
  // (ex. site filtré sans aucune ligne) — dans ce cas il n'y a de toute façon
  // rien de réel à désigner, donc rien à contraindre.
  const monthType = months.length > 0 ? z.enum(months as [string, ...string[]]) : z.string();
  const machineType = machineIds.length > 0 ? z.enum(machineIds as [string, ...string[]]) : z.string();
  const lineType = lines.length > 0 ? z.enum(lines as [string, ...string[]]) : z.string();
  const siteType = sites.length > 0 ? z.enum(sites as [string, ...string[]]) : z.string();

  const actionSchema = z.object({
    action_type: z.enum(["lissage_temporel", "ouverture_ligne", "fermeture_ligne"]),
    machine_id: machineType.nullable(),
    from_month: monthType.nullable(),
    to_month: monthType.nullable(),
    production_line: lineType.nullable(),
    site: siteType.nullable(),
    target_production_line: lineType.nullable(),
    target_site: siteType.nullable(),
    months: z.array(monthType),
  });

  const optionSchema = z.object({
    title: z.string(),
    type: z.enum(["lissage_temporel", "ouverture_ligne", "fermeture_ligne", "mixte"]),
    description_bullets: z.array(z.string()).min(1).max(6),
    months_concerned: z.array(monthType),
    actions: z.array(actionSchema).max(4),
    missing_data_warning: z.string().nullable(),
  });

  return z.object({
    options: z.array(optionSchema).min(2).max(3),
    recommended_option_index: z.number().int().min(0).max(2),
    recommendation_justification: z.string(),
  });
}

/**
 * Appelle le LLM avec le contexte chiffré (voir buildReconciliationContext) et
 * recalcule les gaps résultants de chaque action désignée (jamais par le LLM
 * lui-même — voir reconciliationRecalc.ts). Ne jette jamais : toute erreur
 * (clé absente, timeout, erreur API) revient comme un résultat typé explicite
 * pour que la route puisse répondre clairement, sans échec silencieux.
 */
export async function generateReconciliationOptions(context: ReconciliationContext): Promise<GenerationOutcome> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      errorType: "missing_api_key",
      message: "ANTHROPIC_API_KEY absente de l'environnement (.env). Voir server/.env.example.",
    };
  }

  const model = getLlmModel();
  const client = new Anthropic();
  const schema = buildResponseSchema(context);

  try {
    const response = await client.messages.parse({
      model,
      max_tokens: 16000,
      system: RECONCILIATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(context) }],
      output_config: { format: zodOutputFormat(schema) },
    });

    if (!response.parsed_output) {
      return { ok: false, errorType: "invalid_response", message: "Le LLM n'a pas renvoyé de sortie structurée exploitable." };
    }

    const parsed = response.parsed_output as z.infer<ReturnType<typeof buildResponseSchema>>;
    const options: ReconciliationOptionWithGaps[] = parsed.options.map((option) => ({
      ...option,
      actions: option.actions as ReconciliationAction[],
      resulting_gaps: option.actions.map((action) => computeResultingGaps(action as ReconciliationAction, context)),
    }));

    return {
      ok: true,
      result: {
        model,
        options,
        recommendedOptionIndex: parsed.recommended_option_index,
        recommendationJustification: parsed.recommendation_justification,
      },
    };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, errorType: "auth", message: "Clé API Anthropic invalide ou refusée par l'API." };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, errorType: "rate_limit", message: "Limite de débit atteinte sur l'API Anthropic — réessayer plus tard." };
    }
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      return { ok: false, errorType: "timeout", message: "Timeout lors de l'appel à l'API Anthropic." };
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return { ok: false, errorType: "connection", message: "Impossible de joindre l'API Anthropic (réseau)." };
    }
    if (err instanceof Anthropic.APIError) {
      return { ok: false, errorType: "api_error", message: `Erreur API Anthropic (${err.status}) : ${err.message}` };
    }
    return { ok: false, errorType: "api_error", message: `Erreur inattendue lors de la génération : ${(err as Error).message}` };
  }
}
