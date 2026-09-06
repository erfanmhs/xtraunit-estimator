"use client";

/**
 * "Delete project" as an overflow-menu item — with a confirmation, which the
 * old top-right Delete button never had. Deleting removes the project and
 * everything under it (plans, takeoff, scope, pricing).
 */
import { deleteProject } from "../actions";
import { MenuItemStyle } from "@/components/OverflowMenu";

export default function DeleteProjectItem({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  return (
    <form
      action={deleteProject}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Delete "${name}" and everything in it — plans, takeoff, scope and pricing? This can't be undone.`,
          )
        )
          e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" role="menuitem" className={MenuItemStyle(true)}>
        Delete project…
      </button>
    </form>
  );
}
