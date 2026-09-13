# The proposal as a contract

**What this is.** When a client accepts a proposal in the document (typed
name = signature), that proposal is the contract. For work on someone's
home, California fixes what that contract must contain — Business &
Professions Code §7159, amended for 2026 by AB 1327 (email cancellation,
contractor contact block) and SB 517 (subcontractor disclosure). The app
now produces that document. This file says what is statutory (do not
edit), what is ours (edit freely in Settings), and what an attorney should
still read once.

Not legal advice. Written from the statute and standard residential
practice (AIA A105-2017 for the general clauses); one review by a
California construction attorney before the first real send is the right
cost for what it protects.

## Two kinds of proposal

| | Home improvement | Commercial / other |
|---|---|---|
| When | Residential, ADU / addition, multifamily projects (default on; the editor can switch it) | Commercial, trade work, other |
| Sections | 01–05 as before, **06 Home improvement contract**, 07 About, 08 Accept | 01–05, 06 About, 07 Accept |
| Contract price shown | Base bid + options selected at acceptance | — |

## What the statute prescribes (in `src/lib/proposal/contract.ts`, verbatim)

In the order the section prints:

1. Heading **Home Improvement**, and the sentence *You are entitled to a completely filled in copy…* (12-pt bold).
2. **Contractor** block — name, license, address, email, phone — preceded by the 2026 sentence that the Notice of Cancellation may be sent to that address or email.
3. **Contract Price**.
4. **Description of the Project and Description of the Significant Materials to be Used and Equipment to be Installed** — points at sections 02–03 and the incorporated documents.
5. **Downpayment** — the amount, and *THE DOWNPAYMENT MAY NOT EXCEED $1,000 OR 10 PERCENT…* (12-pt bold). The app warns in the editor and the document when the amount is over the cap.
6. **Schedule of Progress Payments** — phase / work / amount table, the *IT IS AGAINST THE LAW…* statement (12-pt bold), and the lien-release promise. The app warns until down payment + phases = contract price.
7. **Approximate Start Date / Approximate Completion Date**.
8. **List of Documents to be Incorporated into the Contract**.
9. **Note About Extra Work and Change Orders** — the statutory sentence.
10. **Subcontractors** — the Yes / No box and, on Yes, the SB 517 disclaimer; then the performance-and-payment-bond notice.
11. **Commercial General Liability Insurance (CGL)** and **Workers' Compensation Insurance** — the sentence chosen by the answers in Settings (carrier and phone are filled in from there).
12. **Mechanics Lien Warning** — verbatim.
13. **Information about the Contractors State License Board (CSLB)** — verbatim, 12-pt.
14. **Three-Day Right to Cancel** (Five-Day when the buyer is 65 or older) — 12-pt bold, verbatim.
15. **Notice of Cancellation** — the form, printed twice on separate pages.

The seven-day right to cancel for disaster-area repair contracts is not
implemented; if the company ever takes that work, add it before signing.

## What is ours (Settings → Proposal profile → Terms & conditions)

Fourteen plain-language clauses, defaults in `src/lib/proposal/profile.ts`:
agreement · change orders · concealed conditions · allowances & selections ·
payment · schedule · owner responsibilities · permits, inspections & code ·
hazardous materials · delays beyond either party's control · insurance &
liability · warranty · termination · dispute resolution.

Numbers the company usually tunes are in the text on purpose so they are
visible: 10-day payment terms, 1.5 %/month late interest, 7-day suspension
notice, 10-day cure period, 10 % on termination for convenience, one-year
workmanship warranty, Los Angeles County mediation / arbitration.

## Attorney checklist (one sitting)

- [ ] The general clauses above: anything unenforceable or unwise for a
      contractor of this size in California (arbitration + attorney's fees;
      limitation of consequential damages; termination-for-convenience fee).
- [ ] Payment clause vs. §7159: the schedule of progress payments must
      describe each phase; retention language was removed for home
      improvement work — confirm.
- [ ] Whether multifamily should default to a home improvement contract
      (§7151 "residential property") or stay commercial.
- [ ] Typed-name acceptance as the buyer's signature and the contractor's
      countersignature (the statute wants both parties' signatures and a
      dated copy to the buyer before work starts — the app dates the
      acceptance and the document is the copy; confirm this is enough, or
      add a countersignature step).
- [ ] Senior buyers: the five-day notice depends on the editor's checkbox.
- [ ] Home Solicitation Sales Act: contracts negotiated away from the
      contractor's office — the right to cancel covers it; confirm nothing
      else is needed.
- [ ] Prevailing wage / public works: excluded by the license note; confirm.

## Sources

- B&P §7159 text — leginfo.legislature.ca.gov (lawCode=BPC, sectionNum=7159)
- CSLB, Home Improvement Contracts: Warnings and Exceptions
- Smith Currie, "New California Home Improvement Contract Laws for 2026" (AB 1327, SB 517)
- AIA A105-2017 summary (concealed conditions, substantial completion, termination)
