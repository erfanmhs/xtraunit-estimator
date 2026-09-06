import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import type { ProposalDoc } from "@/lib/proposal/model";
import PublicProposal from "./PublicProposal";

/**
 * The client's proposal link: /p/<token>. Public (no login) — the proxy lets
 * /p/ through, and the data comes from get_public_proposal(), which returns
 * only the one published snapshot that matches the token.
 */
type PublicDoc = ProposalDoc & {
  accepted_at: string | null;
  accepted_by: { name?: string; at?: string } | null;
};

async function fetchDoc(token: string): Promise<PublicDoc | null> {
  if (!/^[A-Za-z0-9_-]{24,}$/.test(token)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_proposal", { p_token: token });
  if (error || !data) return null;
  return data as PublicDoc;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const doc = await fetchDoc(token);
  return {
    title: doc ? `Proposal — ${doc.project.name}` : "Proposal",
    robots: { index: false, follow: false },
  };
}

export default async function PublicProposalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const doc = await fetchDoc(token);

  return (
    <main className="min-h-screen bg-neutral-100 py-0 text-neutral-900 sm:py-8">
      {doc ? (
        <PublicProposal
          token={token}
          doc={doc}
          accepted={
            doc.accepted_at
              ? { name: doc.accepted_by?.name ?? "the owner", at: doc.accepted_at }
              : null
          }
        />
      ) : (
        <div className="mx-auto max-w-md px-6 py-24 text-center">
          <p className="font-heading text-2xl font-semibold">This proposal link isn&apos;t active</p>
          <p className="mt-2 text-sm text-neutral-600">
            It may have been turned off or replaced. Please ask XtraUnit for a fresh link.
          </p>
        </div>
      )}
    </main>
  );
}
