/**
 * 404 screen — shown when a URL doesn't match any page (a bad link, an old
 * bookmark, a deleted project). Renders inside the root layout, so it uses the
 * normal brand styling.
 */
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md rounded-xl glass p-8 text-center">
        <p className="font-heading text-5xl text-brand">404</p>
        <h1 className="mt-2 font-heading text-2xl text-foreground">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-muted">
          That page doesn&apos;t exist or may have moved.
        </p>
        <Link
          href="/projects"
          className="mt-6 inline-block rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
        >
          Back to projects
        </Link>
      </div>
    </div>
  );
}
