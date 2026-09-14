import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import PlanViewer from "./PlanViewer";
import type { PlanFile } from "@/types";

/**
 * A first guess at the device from the request, so the FIRST paint is
 * already the phone layout. The viewer decides phone/desktop from the
 * screen with matchMedia, which only runs after the JavaScript arrives —
 * on a phone over 5G that is seconds of the desktop layout (sheet list on
 * the left, measurements panel on the right, no drawing) before it flips
 * (Erfan, 2026-09-10). The screen still has the final say once it loads.
 */
function deviceGuess(h: Headers): { phone: boolean; coarse: boolean } {
  const ua = h.get("user-agent") ?? "";
  const chMobile = h.get("sec-ch-ua-mobile"); // "?1" on mobile Chrome
  const phone = chMobile === "?1" || /iPhone|iPod|Android.*Mobile|Windows Phone|Mobi/i.test(ua);
  const tablet = /iPad|Android(?!.*Mobile)|Tablet/i.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua));
  return { phone, coarse: phone || tablet };
}

export default async function PlanViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; planId: string }>;
  searchParams: Promise<{ sheet?: string }>;
}) {
  const { id, planId } = await params;
  const { sheet } = await searchParams;
  const device = deviceGuess(await headers());

  const supabase = await createClient();
  const { data: pf } = await supabase
    .from("plan_files")
    .select("*")
    .eq("id", planId)
    .maybeSingle();
  if (!pf) notFound();

  // Tiered select so the page works whatever migrations have run:
  // full (with ledger, 0024) → named (with name, 0006) → minimal.
  // Ordered by page, then creation — so a cropped sheet (0035) lists right
  // after the page it was cut from.
  const order = { ascending: true } as const;
  const cropped = await supabase
    .from("sheets")
    .select(
      "id,page_number,name,label,notes,discipline,scale_x,scale_y,scale_preset,ledger,crop,source_sheet_id,created_at",
    )
    .eq("plan_file_id", planId)
    .order("page_number", order)
    .order("created_at", order);
  let sheetsData = cropped.data;
  if (cropped.error) {
    const full = await supabase
      .from("sheets")
      .select(
        "id,page_number,name,label,notes,discipline,scale_x,scale_y,scale_preset,ledger",
      )
      .eq("plan_file_id", planId)
      .order("page_number", order);
    sheetsData = full.data as typeof cropped.data;
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
      ) as typeof cropped.data; // older shapes lack name/ledger/crop — optional on Sheet
    }
  }

  // Every plan set in the project, oldest first (the order the project page's
  // Takeoff tab uses), so the viewer can roll from the last sheet of one set
  // into the first of the next without a trip back to the project page
  // (Erfan, 2026-09-13 — a set uploaded as one PDF per sheet is many sets).
  const { data: siblingRows } = await supabase
    .from("plan_files")
    .select("id,file_name,created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: true });
  const siblingIds = (siblingRows ?? []).map((r) => r.id as string);
  const { data: countRows } = siblingIds.length
    ? await supabase.from("sheets").select("plan_file_id").in("plan_file_id", siblingIds)
    : { data: [] as { plan_file_id: string }[] };
  const counts = new Map<string, number>();
  for (const r of countRows ?? []) counts.set(r.plan_file_id, (counts.get(r.plan_file_id) ?? 0) + 1);
  const siblings = (siblingRows ?? []).map((r) => ({
    id: r.id as string,
    file_name: r.file_name as string,
    sheets: counts.get(r.id as string) ?? 0,
  }));

  return (
    <PlanViewer
      projectId={id}
      planFile={pf as PlanFile}
      sheets={sheetsData ?? []}
      siblings={siblings}
      initialSheet={sheet === "last" ? "last" : "first"}
      initialPhone={device.phone}
      initialCoarse={device.coarse}
    />
  );
}
