"use client";

/**
 * The project's "⋯" menu.
 *
 * It used to offer one thing — Delete — which meant the only action a project
 * had was the destructive one. It now carries the ordinary ones too: edit the
 * details, duplicate it for a similar job, archive it, and only then delete.
 *
 * Order matters. Everyday actions first, then the ones you rarely want, then
 * the one you can't undo, separated by a rule so a thumb travelling down the
 * list meets a break before it reaches Delete.
 */
import { useState } from "react";
import {
  duplicateProject,
  setProjectArchived,
  deleteProject,
} from "../actions";
import OverflowMenu, { MenuItemStyle } from "@/components/OverflowMenu";
import EditProjectDialog from "./EditProjectDialog";
import type { Project } from "@/types";

export default function ProjectMenu({
  project,
  canArchive,
  archived,
}: {
  project: Project;
  /** False until migration 0039 has been run — the column isn't there yet. */
  canArchive: boolean;
  archived: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <OverflowMenu label="Project actions">
        <button
          type="button"
          role="menuitem"
          className={MenuItemStyle()}
          onClick={() => setEditing(true)}
        >
          Edit details…
        </button>

        <form action={duplicateProject}>
          <input type="hidden" name="id" value={project.id} />
          <button type="submit" role="menuitem" className={MenuItemStyle()}>
            Duplicate
          </button>
        </form>

        {canArchive ? (
          <form action={setProjectArchived}>
            <input type="hidden" name="id" value={project.id} />
            <input type="hidden" name="archived" value={String(!archived)} />
            <button type="submit" role="menuitem" className={MenuItemStyle()}>
              {archived ? "Unarchive" : "Archive"}
            </button>
          </form>
        ) : null}

        <div className="my-1 border-t border-border" />

        <form
          action={deleteProject}
          onSubmit={(e) => {
            if (
              !window.confirm(
                `Delete "${project.name}" and everything in it — plans, takeoff, scope and pricing? This can't be undone.`,
              )
            )
              e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={project.id} />
          <button type="submit" role="menuitem" className={MenuItemStyle(true)}>
            Delete project…
          </button>
        </form>
      </OverflowMenu>

      {editing ? (
        <EditProjectDialog
          project={project}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </>
  );
}
