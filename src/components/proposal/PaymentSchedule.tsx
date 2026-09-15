/**
 * The payment schedule for a proposal that is NOT a California home
 * improvement contract — commercial work, or any job where a separate
 * contract carries the statutory blocks. The same deposit + phases the
 * home improvement section shows, without the statutory sentences and
 * without the $1,000 down payment cap (which applies only to home
 * improvement). Erfan, 2026-09-14: "a payment schedule option … for all
 * types of contracts."
 *
 * Reads from the doc only, so preview, client link and print agree.
 */
import type { ProposalDoc } from "@/lib/proposal/model";
import { scheduleGap } from "@/lib/proposal/contract";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function PaymentSchedule({ doc, contractPrice }: { doc: ProposalDoc; contractPrice: number }) {
  const c = doc.contract;
  const gap = scheduleGap(c, contractPrice);
  const phases = c.progress_payments;

  return (
    <div className="text-sm text-neutral-800">
      <p className="text-neutral-700">
        Contract price <span className="font-semibold">{usd.format(contractPrice)}</span> — the base bid plus the
        options selected at acceptance.
      </p>
      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-b border-neutral-300 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="py-1 pr-2">Payment</th>
            <th className="py-1 pr-2">Due when</th>
            <th className="py-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-neutral-200 align-top">
            <td className="py-1.5 pr-2 font-medium">Deposit</td>
            <td className="py-1.5 pr-2 text-neutral-700">At signing</td>
            <td className="py-1.5 text-right tabular-nums">{usd.format(c.downpayment)}</td>
          </tr>
          {phases.map((p, i) => (
            <tr key={i} className="border-b border-neutral-200 align-top">
              <td className="py-1.5 pr-2 font-medium">{p.phase || `Payment ${i + 1}`}</td>
              <td className="py-1.5 pr-2 text-neutral-700">{p.work}</td>
              <td className="py-1.5 text-right tabular-nums">{usd.format(p.amount)}</td>
            </tr>
          ))}
          {phases.length ? (
            <tr className="font-semibold">
              <td className="py-1.5 pr-2" colSpan={2}>
                Total
              </td>
              <td className="py-1.5 text-right tabular-nums">{usd.format(contractPrice - gap)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {!phases.length ? (
        <p className="mt-2 text-neutral-600">
          The balance is invoiced against work in place at the milestones in the timeline and is due within 10 days
          of each invoice; the final payment is due at completion.
        </p>
      ) : (
        <p className="mt-2 text-xs text-neutral-600">
          Each payment is invoiced when its phase is complete and is due within 10 days of the invoice.
        </p>
      )}
      {gap !== 0 && phases.length ? (
        <p className="print-hide mt-1 text-xs font-semibold text-red-800">
          Schedule is {gap > 0 ? "short" : "over"} by {usd.format(Math.abs(gap))} against the contract price — fix
          before sending.
        </p>
      ) : null}
    </div>
  );
}
