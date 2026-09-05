"use server";

/**
 * Project create/delete (server-side).
 * The database's access rules guarantee a user can only touch their own rows;
 * we also set owner_id from the signed-in user so new projects are theirs.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { projectInput } from "@/lib/validation";

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s.length ? s : null;
}

export async function createProject(formData: FormData) {
  // Validate + bound the form input before it reaches the database.
  const parsed = projectInput.safeParse({
    name: String(formData.get("name") ?? ""),
    client_name: emptyToNull(formData.get("client_name")),
    address: emptyToNull(formData.get("address")),
    project_type: emptyToNull(formData.get("project_type")),
    notes: emptyToNull(formData.get("notes")),
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Please check the form.";
    redirect(`/projects/new?error=${encodeURIComponent(msg)}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("projects")
    .insert({
      owner_id: user.id,
      ...parsed.data,
    })
    .select("id")
    .single();

  if (error) {
    redirect(`/projects/new?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/projects");
  redirect(`/projects/${data.id}`);
}

export async function deleteProject(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/projects");

  const supabase = await createClient();
  await supabase.from("projects").delete().eq("id", id);

  revalidatePath("/projects");
  redirect("/projects");
}

// ── Stage progress (powers the project tabs in the left rail) ───────────────

export type StageState = "done" | "partial" | "todo";
export type ProjectProgress = {
  name: string | null;
  firstPlanId: string | null; // where the Takeoff tab points
  plans: StageState;
  takeoff: StageState;
  scope: StageState;
  pricing: StageState;
  estimate: StageState;
  proposal: StageState;
};

/**
 * Cheap "where does this project stand" read for the rail's stage tabs: six
 * count/exists checks, all RLS-scoped. Any table that isn't there yet just
 * reads as "todo" — never an error in the menu.
 */
export async function getProjectProgress(
  projectId: string,
): Promise<ProjectProgress | null> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: project } = await supabase
    .from("projects")
    .select("id,name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return null;

  // A head-only count; a missing table/column just reads as 0, never an error.
  const headCount = async (
    q: PromiseLike<{ count: number | null; error: unknown }>,
  ): Promise<number> => {
    const { count: n, error } = await q;
    return error ? 0 : (n ?? 0);
  };
  const countOf = (table: string) =>
    supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);

  const [firstPlan, measurements, lines, confirmed, priced, estimate, proposal] =
    await Promise.all([
      supabase
        .from("plan_files")
        .select("id")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      headCount(countOf("measurements")),
      headCount(countOf("line_items")),
      headCount(countOf("line_items").eq("price_status", "confirmed")),
      headCount(countOf("line_items").eq("price_status", "proposed")),
      supabase.from("estimates").select("id").eq("project_id", projectId).maybeSingle(),
      supabase.from("proposals").select("id").eq("project_id", projectId).maybeSingle(),
    ]);

  const firstPlanId = firstPlan.error ? null : (firstPlan.data?.id ?? null);
  return {
    name: project.name ?? null,
    firstPlanId,
    plans: firstPlanId ? "done" : "todo",
    takeoff: measurements > 0 ? "done" : "todo",
    scope: lines > 0 ? "done" : "todo",
    pricing: confirmed > 0 ? "done" : priced > 0 ? "partial" : "todo",
    estimate: !estimate.error && estimate.data ? "done" : "todo",
    proposal: !proposal.error && proposal.data ? "done" : "todo",
  };
}
