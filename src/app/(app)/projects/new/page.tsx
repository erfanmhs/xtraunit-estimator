import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { createProject } from "../actions";

const FIELD =
  "rounded-md border border-border bg-background px-3 py-2.5 text-foreground placeholder:text-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40";
const LABEL = "text-xs font-medium uppercase tracking-wider text-muted";

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        className="border-b border-border px-6 py-5 sm:px-8"
        title="New Project"
        subtitle="The basics now — plans, takeoff, and pricing come next."
      />

      <div className="p-4 sm:p-8">
        <form
          action={createProject}
          className="flex max-w-2xl flex-col gap-5 rounded-xl glass p-4 sm:p-6"
        >
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-brand-soft"
            >
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className={LABEL}>
              Project name *
            </label>
            <input
              id="name"
              name="name"
              required
              placeholder="e.g. Erwin St — 12-unit apartments"
              className={FIELD}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="client_name" className={LABEL}>
                Client
              </label>
              <input id="client_name" name="client_name" autoComplete="organization" className={FIELD} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="project_type" className={LABEL}>
                Project type
              </label>
              <select
                id="project_type"
                name="project_type"
                defaultValue=""
                className={FIELD}
              >
                <option value="">Select…</option>
                <option value="multifamily">Multifamily</option>
                <option value="adu_addition">ADU / Addition</option>
                <option value="residential">Residential</option>
                <option value="commercial">Commercial</option>
                <option value="trade_work">Trade work</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="address" className={LABEL}>
              Address
            </label>
            <input id="address" name="address" autoComplete="street-address" className={FIELD} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="notes" className={LABEL}>
              Notes
            </label>
            <textarea id="notes" name="notes" rows={3} spellCheck className={FIELD} />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
            >
              Create project
            </button>
            <Link
              href="/projects"
              className="rounded-md border border-border px-4 py-2.5 text-sm text-foreground transition-colors hover:border-brand hover:text-brand-soft"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
