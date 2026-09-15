import { describe, expect, it } from "vitest";
import {
  cancelDays,
  cglStatement,
  defaultContract,
  downpaymentCap,
  hasPaymentSchedule,
  noticeOfCancellationText,
  resolveContract,
  rightToCancelHeading,
  rightToCancelText,
  scheduleGap,
  workersCompStatement,
} from "./contract";

describe("payment schedule outside home improvement", () => {
  it("is off by default and reads back from a stored block", () => {
    expect(defaultContract("commercial").payment_schedule).toBe(false);
    expect(resolveContract({ payment_schedule: true }, "commercial").payment_schedule).toBe(true);
    expect(resolveContract({ payment_schedule: "yes" }, "commercial").payment_schedule).toBe(true);
    expect(resolveContract({}, "commercial").payment_schedule).toBe(false);
  });
  it("shows its own section only when ticked and not a home improvement contract", () => {
    expect(hasPaymentSchedule(resolveContract({ payment_schedule: true }, "commercial"))).toBe(true);
    expect(hasPaymentSchedule(resolveContract({ payment_schedule: true, home_improvement: true }, "residential"))).toBe(false);
    expect(hasPaymentSchedule(resolveContract({}, "commercial"))).toBe(false);
    expect(hasPaymentSchedule(undefined)).toBe(false);
  });
});

describe("scheduleGap", () => {
  it("balances against the whole-dollar price the client sees", () => {
    const c = resolveContract({ downpayment: 5000, progress_payments: [{ phase: "A", work: "", amount: 22692 }] }, "commercial");
    expect(scheduleGap(c, 27692.4)).toBe(0);
    expect(scheduleGap(c, 27700)).toBe(8);
    expect(scheduleGap(c, 27600)).toBe(-92);
  });
});

describe("home improvement contract — the numbers the statute fixes", () => {
  it("caps the down payment at $1,000 or 10 %, whichever is LESS", () => {
    expect(downpaymentCap(5_000)).toBe(500);
    expect(downpaymentCap(10_000)).toBe(1000);
    expect(downpaymentCap(250_000)).toBe(1000);
    expect(downpaymentCap(0)).toBe(0);
  });
  it("gives seniors five days, everyone else three", () => {
    expect(cancelDays(false)).toBe(3);
    expect(cancelDays(true)).toBe(5);
    expect(rightToCancelHeading(3)).toBe("Three-Day Right to Cancel");
    expect(rightToCancelHeading(5)).toBe("Five-Day Right to Cancel");
    expect(rightToCancelText(5)).toContain("within five business days");
    expect(rightToCancelText(5)).toContain("midnight of the fifth business day");
    expect(noticeOfCancellationText(3)).toContain("within three business days");
  });
  it("checks that down payment plus progress payments equals the price", () => {
    const c = {
      ...defaultContract("residential"),
      downpayment: 1000,
      progress_payments: [
        { phase: "Demo", work: "Demolition complete", amount: 9_000 },
        { phase: "Rough", work: "Framing and rough-ins inspected", amount: 30_000 },
      ],
    };
    expect(scheduleGap(c, 40_000)).toBe(0);
    expect(scheduleGap(c, 45_000)).toBe(5_000);
    expect(scheduleGap(c, 39_000)).toBe(-1_000);
  });
});

describe("which projects are home improvement contracts", () => {
  it("defaults on for residential work and off for commercial", () => {
    expect(defaultContract("residential").home_improvement).toBe(true);
    expect(defaultContract("adu_addition").home_improvement).toBe(true);
    expect(defaultContract("commercial").home_improvement).toBe(false);
    expect(defaultContract(null).home_improvement).toBe(false);
  });
  it("reads a stored block and tolerates junk", () => {
    const c = resolveContract(
      { home_improvement: false, senior: "yes", downpayment: "900", progress_payments: [{ phase: "A", amount: "5" }, null] },
      "residential",
    );
    expect(c.home_improvement).toBe(false); // an explicit choice wins over the type default
    expect(c.senior).toBe(true);
    expect(c.downpayment).toBe(900);
    expect(c.progress_payments).toEqual([{ phase: "A", work: "", amount: 5 }]);
    expect(resolveContract(null, "residential").home_improvement).toBe(true);
  });
});

describe("insurance statements pick the statute's sentence", () => {
  const base = { cgl: "carried" as const, cgl_carrier: "State Fund", cgl_phone: "800-555-0100", workers_comp: "employees" as const };
  it("names the carrier and phone when insurance is carried", () => {
    expect(cglStatement("XtraUnit", base)).toBe(
      "XtraUnit carries commercial general liability insurance written by State Fund. You may call State Fund at 800-555-0100 to check the contractor's insurance coverage.",
    );
    expect(cglStatement("", { ...base, cgl: "none" })).toBe("This contractor does not carry commercial general liability insurance.");
    expect(cglStatement("XtraUnit", { ...base, cgl: "self" })).toBe("XtraUnit is self-insured.");
  });
  it("states workers' comp or the exemption", () => {
    expect(workersCompStatement("XtraUnit", base)).toBe("XtraUnit carries workers' compensation insurance for all employees.");
    expect(workersCompStatement("XtraUnit", { ...base, workers_comp: "exempt" })).toBe(
      "XtraUnit has no employees and is exempt from workers' compensation requirements.",
    );
  });
});
