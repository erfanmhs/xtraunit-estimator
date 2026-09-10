"use server";

/**
 * Project create/delete (server-side).
 * The database's access rules guarantee a user can only touch their own rows;
 * we also set owner_id from the signed-in user so new projects are theirs.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { projectInput, projectOrder } from "@/lib/validation";

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

/** Edit a project's details in place. */
export async function updateProject(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/projects");

  const parsed = projectInput.safeParse({
    name: String(formData.get("name") ?? ""),
    client_name: emptyToNull(formData.get("client_name")),
    address: emptyToNull(formData.get("address")),
    project_type: emptyToNull(formData.get("project_type")),
    notes: emptyToNull(formData.get("notes")),
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Please check the form.";
    redirect(`/projects/${id}?error=${encodeURIComponent(msg)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update(parsed.data)
    .eq("id", id);
  if (error) redirect(`/projects/${id}?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
  redirect(`/projects/${id}`);
}

/**
 * Copy a project so a similar job can start from a finished one.
 *
 * The scope and its prices come across, because that is the whole point — a
 * second ADU on the same block is 90% the same bid. The PLANS deliberately do
 * not: they are tens of megabytes of PDF belonging to a different address, and
 * a takeoff measured on those sheets would be wrong on the new job. So the
 * copy starts at "scope written, prices in, plans to upload".
 *
 * Prices are copied as `proposed`, never `confirmed`. A number carried over
 * from another project is a starting point someone still has to agree to, and
 * silently marking it confirmed would let a stale price reach a bid unchecked.
 */
export async function duplicateProject(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/projects");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: src } = await supabase
    .from("projects")
    .select("name,client_name,address,project_type,notes,region,gen_trades")
    .eq("id", id)
    .single();
  if (!src) redirect("/projects");

  const { data: copy, error } = await supabase
    .from("projects")
    .insert({ ...src, owner_id: user.id, name: `${src.name} (copy)` })
    .select("id")
    .single();
  if (error || !copy) redirect(`/projects/${id}`);

  const { data: lines } = await supabase
    .from("line_items")
    .select(
      "division_code,division_name,section_code,section_name,description,quantity,unit,source_kind,evidence,status,confidence,ai_generated,notes,sort_order,price_mode,cost_labor,cost_material,cost_sub,cost_equipment,cost_other,cost_total,price_source,price_note,price_confidence",
    )
    .eq("project_id", id);

  if (lines?.length) {
    await supabase.from("line_items").insert(
      lines.map((li) => ({
        ...li,
        project_id: copy.id,
        owner_id: user.id,
        plan_file_id: null, // the plans did not come with it
        price_status: hasAnyPrice(li) ? "proposed" : null,
        user_edited: false,
      })),
    );
  }

  revalidatePath("/projects");
  redirect(`/projects/${copy.id}`);
}

function hasAnyPrice(li: Record<string, unknown>): boolean {
  return [
    "cost_labor",
    "cost_material",
    "cost_sub",
    "cost_equipment",
    "cost_other",
    "cost_total",
  ].some((k) => typeof li[k] === "number" && (li[k] as number) !== 0);
}

/**
 * Archive ("minimize") a project, or bring it back.
 *
 * Nothing is deleted — the project and everything under it stay exactly as
 * they are, it just leaves the main list. Needs migration 0039; until that is
 * run the button is hidden, and if it is somehow called anyway the error is
 * swallowed rather than shown, because failing to tidy a list is not worth an
 * error screen.
 */
export async function setProjectArchived(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const archived = String(formData.get("archived") ?? "") === "true";
  if (!id) redirect("/projects");

  const supabase = await createClient();
  await supabase
    .from("projects")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);

  revalidatePath("/projects");
  redirect("/projects");
}

/**
 * Save the order the user dragged the list into (feedback A2/A3).
 *
 * `ids` is the whole visible list, top to bottom; each project gets its
 * position as `sort_order`. Row access rules mean a project that is not the
 * user's simply does not update, so a stray id is harmless. Nothing is
 * returned, nothing redirects and nothing revalidates: the list on screen is
 * already in this order, the next visit reads sort_order anyway, and a
 * revalidation here re-rendered the whole list mid-drag on a phone — which
 * is what left a card floating over the others (2026-09-10).
 */
export async function reorderProjects(ids: string[]): Promise<void> {
  const parsed = projectOrder.safeParse(ids);
  if (!parsed.success) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await Promise.all(
    parsed.data.map((id, i) =>
      supabase.from("projects").update({ sort_order: i + 1 }).eq("id", id),
    ),
  );
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
