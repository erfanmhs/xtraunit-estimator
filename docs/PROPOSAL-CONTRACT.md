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

Nineteen plain-language clauses, defaults in `src/lib/proposal/profile.ts`:
agreement · the work & supervision · change orders · concealed conditions ·
allowances & selections · payment · completion & final payment · schedule ·
owner responsibilities · permits, inspections & code · site, safety & clean-up ·
hazardous materials · delays beyond either party's control · insurance ·
responsibility for claims · warranty & correction of work · termination ·
dispute resolution · general.

Numbers the company usually tunes are in the text on purpose so they are
visible: 10-day payment terms, 1.5 %/month late interest, 7-day suspension
notice, 10-day cure period, 10 % on termination for convenience, one-year
workmanship warranty, Los Angeles County mediation / arbitration.

## Cross-reference with AIA A105-2017

Read article by article against the AIA short-form owner–contractor agreement.

| AIA A105 article | Ours | Where |
|---|---|---|
| 1 Contract documents, hierarchy | yes | The agreement |
| 2 Commencement, substantial completion | yes | Completion & final payment; contract section dates |
| 3 Contract sum, adjusted only by change order | yes | The agreement, Change orders |
| 4 Progress payments, final payment, interest | yes (no retainage — see note) | Payment terms, Completion |
| 5 Contractor's and owner's insurance, waiver of subrogation | yes | Insurance; statutory CGL / WC sentences |
| 6 The work, intent, ownership of documents, notices by email | yes | The work & supervision, The agreement, General |
| 7 Owner: information, right to stop work, right to carry out work | yes | Owner responsibilities, Termination |
| 8 Contractor: review, supervision, labour/materials, warranty, taxes, permits, site, cutting/patching, clean-up, indemnity | yes | The work & supervision, Permits, Site safety & clean-up, Warranty, Responsibility for claims |
| 9 Architect as certifier and decider | left out on purpose | design-build: no third-party certifier |
| 10 Change orders, concealed conditions | yes | Change orders, Concealed conditions |
| 11 Time of the essence, delay notice, extensions | yes | Completion, Schedule, Delays |
| 12 Applications, certificates, substantial and final completion | yes (no certificates) | Completion & final payment |
| 13 Safety, hazardous materials | yes | Site safety & clean-up, Hazardous materials |
| 14 Correction of work, one year | yes | Warranty & correction of work |
| 15 Assignment, governing law, tests | yes | General |
| 16–17 Termination by contractor / by owner for cause / for convenience | yes | Termination |

Left out on purpose: the architect's role (A105 assumes one; a design-build
contractor is its own), **retainage** (A105 holds 5 %; on a California home
improvement contract, holding back money for work already done sits badly
with §7159's "may not collect for work not yet completed" logic — the
schedule of progress payments does the job instead), and the contractor's
right to demand proof of the owner's financing (art. 7.1.3 — reasonable on a
$150k+ job; heavy-handed on a kitchen).

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
