"use client";

import ProposalDocument, { type AcceptedInfo } from "@/components/proposal/ProposalDocument";
import type { ProposalDoc } from "@/lib/proposal/model";
import { acceptProposal } from "./actions";

export default function PublicProposal({
  token,
  doc,
  accepted,
}: {
  token: string;
  doc: ProposalDoc;
  accepted: AcceptedInfo;
}) {
  return (
    <ProposalDocument
      doc={doc}
      mode="public"
      accepted={accepted}
      onAccept={(input) => acceptProposal({ token, ...input })}
    />
  );
}
