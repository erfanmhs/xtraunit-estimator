import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PlanViewer from "./PlanViewer";
import type { PlanFile } from "@/types";

export default async function PlanViewerPage({
  params,
}: {
  params: Promise<{ id: string; planId: string }>;
}) {
  const { id, planId } = await params;

  const supabase = await createClient();
  const { data: pf } = await supabase
    .from("plan_files")
    .select("*")
    .eq("id", planId)
    .maybeSingle();
  if (!pf) notFound();

  // Tiered select so the page works whatever migrations have run:
  // full (with ledger, 0024) → named (with name, 0006) → minimal.
  const order = { ascending: true } as const;
  const full = await supabase
    .from("sheets")
    .select(
      "id,page_number,name,label,notes,discipline,scale_x,scale_y,scale_preset,ledger",
    )
    .eq("plan_file_id", planId)
    .order("page_number", order);
  let sheetsData = full.data;
  if (full.error) {
    const named = await supabase
      .from("sheets")
      .select("id,page_number,name,label,notes,scale_x,scale_y,scale_preset")
      .eq("plan_file_id", planId)
      .order("page_number", order);
    sheetsData = (
      named.error
        ? (
            await supabase
              .from("sheets")
              .select("id,page_number,label,notes,scale_x,scale_y,scale_preset")
              .eq("plan_file_id", planId)
              .order("page_number", order)
          ).data
        : named.data
    ) as typeof full.data; // older shapes lack name/ledger — optional on Sheet
  }

  return (
    <PlanViewer
      projectId={id}
      planFile={pf as PlanFile}
      sheets={sheetsData ?? []}
    />
  );
}
