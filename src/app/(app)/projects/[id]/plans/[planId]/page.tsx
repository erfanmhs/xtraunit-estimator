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

  // Try with the optional `name` column; fall back if migration 0006 hasn't run.
  const named = await supabase
    .from("sheets")
    .select("id,page_number,name,label,notes,scale_x,scale_y,scale_preset")
    .eq("plan_file_id", planId)
    .order("page_number", { ascending: true });
  const sheetsData = named.error
    ? (
        await supabase
          .from("sheets")
          .select("id,page_number,label,notes,scale_x,scale_y,scale_preset")
          .eq("plan_file_id", planId)
          .order("page_number", { ascending: true })
      ).data
    : named.data;

  return (
    <PlanViewer
      projectId={id}
      planFile={pf as PlanFile}
      sheets={sheetsData ?? []}
    />
  );
}
