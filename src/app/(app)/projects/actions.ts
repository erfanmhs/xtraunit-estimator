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
