/**
 * "AI this month: $3.40 of $25" — one quiet line under an AI button, so the
 * budget is never a surprise. Amber from 80 %, red at the limit (where the
 * server will refuse the next run anyway). Nothing shown when there is no
 * dollar budget configured. Server-rendered: the page passes the numbers.
 */
import type { AiSpendMonth } from "@/lib/ai-usage";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function AiBudgetNote({ spend, className = "" }: { spend: AiSpendMonth; className?: string }) {
  if (spend.budgetUsd <= 0) return null;
  const over = spend.fraction >= 1;
  const warm = spend.fraction >= 0.8;
  const tone = over ? "text-brand-soft" : warm ? "text-amber-300" : "text-muted";
  return (
    <p className={`text-xs ${tone} ${className}`} title="Rolling 30 days, per user. Set AI_MONTHLY_BUDGET_USD on Render to change it.">
      AI this month: {usd.format(spend.spentUsd)} of {usd.format(spend.budgetUsd)}
      {over ? " · budget used — generation will wait until older runs age out" : warm ? " · getting close" : ""}
    </p>
  );
}
