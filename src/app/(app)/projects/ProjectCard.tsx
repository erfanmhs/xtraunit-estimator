"use client";

/**
 * Swipe actions on a project card.
 *
 * Everything else in the app opens its actions with a left swipe; the project
 * list was the one place that did not, so the only way to act on a project was
 * to open it first (feedback A1).
 *
 * The card itself stays a server component — it is passed in as `children`, so
 * none of the project data or formatting crosses into the client bundle. This
 * wrapper only adds the gesture and the actions.
 */
import { useState } from "react";
import SwipeRow from "@/components/SwipeRow";
import EditProjectDialog from "./[id]/EditProjectDialog";
import { useReorder } from "./ProjectGrid";
import { duplicateProject, setProjectArchived, deleteProject } from "./actions";
import type { Project } from "@/types";

export default function ProjectCard({
  project,
  canArchive,
  children,
}: {
  project: Project;
  /** False until migration 0039 has been run — the column isn't there yet. */
  canArchive: boolean;
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const reorder = useReorder();

  function withId() {
    const fd = new FormData();
    fd.set("id", project.id);
    return fd;
  }

  async function run(fn: (fd: FormData) => Promise<void>, fd: FormData) {
    if (busy) return; // one action at a time — these navigate when they finish
    setBusy(true);
    try {
      await fn(fd);
    } finally {
      setBusy(false);
    }
  }

  const archived = !!(project as { archived_at?: string | null }).archived_at;

  const actions = [
    { label: "Edit", onClick: () => setEditing(true) },
    ...(canArchive
      ? [
          {
            label: archived ? "Unarchive" : "Archive",
            onClick: () => {
              const fd = withId();
              fd.set("archived", String(!archived));
              void run(setProjectArchived, fd);
            },
          },
        ]
      : []),
  ];

  // Duplicate and Delete are in the hold menu only. Delete is the one action
  // here that cannot be undone, and a swipe is too easy to land by accident on
  // a list you scroll past every day.
  const sheetActions = [
    ...actions,
    // iOS puts "Edit Home Screen" in the hold menu; same idea here.
    { label: "Reorder projects", onClick: reorder.start },
    { label: "Duplicate", onClick: () => void run(duplicateProject, withId()) },
    {
      label: "Delete project…",
      tone: "danger" as const,
      onClick: () => {
        if (
          window.confirm(
            `Delete "${project.name}" and everything in it — plans, takeoff, scope and pricing? This can't be undone.`,
          )
        )
          void run(deleteProject, withId());
      },
    },
  ];

  // While the list is being rearranged the card is a drag handle, not a row
  // with actions — a swipe would fight the drag.
  if (reorder.editing) return <>{children}</>;

  return (
    <>
      <SwipeRow actions={actions} sheetActions={sheetActions}>
        {children}
      </SwipeRow>
      {editing ? (
        <EditProjectDialog project={project} onClose={() => setEditing(false)} />
      ) : null}
    </>
  );
}
