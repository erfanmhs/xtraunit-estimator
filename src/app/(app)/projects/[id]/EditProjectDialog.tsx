"use client";

/**
 * Edit a project's details without leaving the project.
 *
 * The details were only settable at create time, so a typo in a client's name
 * or a corrected address meant living with it. Same fields as the new-project
 * form, same validation on the server.
 */
import { updateProject } from "../actions";
import type { Project } from "@/types";

const FIELD =
  "w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-brand";
const LABEL = "text-xs uppercase tracking-wider text-muted";

const TYPES: [string, string][] = [
  ["multifamily", "Multifamily"],
  ["adu_addition", "ADU / Addition"],
  ["residential", "Residential"],
  ["commercial", "Commercial"],
  ["trade_work", "Trade work"],
  ["other", "Other"],
];

export default function EditProjectDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit project"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-heading text-lg text-foreground">Edit project</h2>

        <form action={updateProject} className="mt-4 flex flex-col gap-4">
          <input type="hidden" name="id" value={project.id} />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="e-name" className={LABEL}>
              Project name
            </label>
            <input
              id="e-name"
              name="name"
              required
              defaultValue={project.name}
              className={FIELD}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="e-client" className={LABEL}>
                Client
              </label>
              <input
                id="e-client"
                name="client_name"
                autoComplete="organization"
                defaultValue={project.client_name ?? ""}
                className={FIELD}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="e-type" className={LABEL}>
                Project type
              </label>
              <select
                id="e-type"
                name="project_type"
                defaultValue={project.project_type ?? ""}
                className={FIELD}
              >
                <option value="">Select…</option>
                {TYPES.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="e-address" className={LABEL}>
              Address
            </label>
            <input
              id="e-address"
              name="address"
              autoComplete="street-address"
              defaultValue={project.address ?? ""}
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="e-notes" className={LABEL}>
              Notes
            </label>
            <textarea
              id="e-notes"
              name="notes"
              rows={3}
              defaultValue={project.notes ?? ""}
              className={`${FIELD} resize-y`}
            />
          </div>

          {/* Save last, on the right — the end of the form is where the hand is. */}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm text-foreground transition-colors hover:border-brand"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
            >
              Save changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
