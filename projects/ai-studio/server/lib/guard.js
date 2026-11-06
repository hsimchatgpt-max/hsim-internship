import { GeminiError } from './gemini.js';
import { getSettings } from './settings.js';
import { usageToday } from './ledger.js';
import { PAID_KINDS, loadStatus } from './models.js';
import { estimate } from './pricing.js';

/**
 * Policy gate. Called before EVERY model call that could cost money or consume quota.
 *  - free-class kinds (text, tts): allowed, subject to the local daily cap.
 *  - paid-class kinds (image, video, music): refused unless settings.allowPaid is on, a rate is configured,
 *    the estimate fits the daily USD ceiling, AND the caller passes an explicit confirmation for this call.
 */
export function assertAllowed({ kind, model, units = 1, confirmed = false }) {
  const s = getSettings();
  const used = usageToday().kinds[kind]?.requests || 0;
  const cap = s.limits[kind];
  const capCheck = () => { if (cap !== undefined && used >= cap) throw new GeminiError('limit_reached', `Daily ${kind} limit reached (${used}/${cap}). Raise it in API Settings if you want to continue.`); };
  if (!PAID_KINDS.has(kind)) capCheck();

  const st = model ? loadStatus()[model] : null;
  if (!PAID_KINDS.has(kind)) {
    if (st?.status === 'needs_billing')
      throw new GeminiError('tier_blocked', `${model} is not available on your current plan (quota 0). Choose another model or enable billing.`);
    return { paid: false };
  }

  const est = estimate(kind, units);
  if (!s.allowPaid) throw new GeminiError('confirmation_required', `${kind} generation is a paid-class feature and is disabled. Enable "Allow paid generation" in API Settings first.`, { estimate: est });
  if (!est.priced) throw new GeminiError('confirmation_required', `Set the ${kind} price in API Settings so the cost can be estimated before generating.`, { estimate: est });
  capCheck();
  const spent = usageToday().estPaidUsd || 0;
  if (spent + est.usd > s.maxPaidUsdPerDay)
    throw new GeminiError('limit_reached', `Estimated paid spend today ($${spent.toFixed(2)}) + this request ($${est.usd}) would exceed your daily ceiling ($${s.maxPaidUsdPerDay}).`, { estimate: est });
  if (!confirmed) throw new GeminiError('confirmation_required', `Confirmation required: ${units} × ${est.unit} ≈ $${est.usd}.`, { estimate: est });
  return { paid: true, estimate: est };
}
