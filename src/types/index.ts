/**
 * Shared TypeScript types for the app.
 * These mirror the database tables created in supabase/migrations.
 */

export type ProjectStatus = "draft" | "in_progress" | "sent" | "won" | "lost";

/** A job to bid — one row in the `projects` table. */
export type Project = {
  id: string;
  owner_id: string;
  name: string;
  client_name: string | null;
  address: string | null;
  project_type: string | null;
  status: ProjectStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** An uploaded plan file — one row in the `plan_files` table. */
export type PlanFile = {
  id: string;
  project_id: string;
  owner_id: string;
  file_name: string;
  storage_path: string;
  size_bytes: number | null;
  mime_type: string | null;
  created_at: string;
};

/** A signed-in user — one row in the `profiles` table. */
export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  created_at: string;
};
