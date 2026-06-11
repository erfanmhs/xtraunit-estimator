import { redirect } from "next/navigation";

/**
 * The app's front door. Signed-out visitors are sent to /login by the proxy;
 * signed-in visitors land here and are forwarded to their Projects dashboard.
 */
export default function RootPage() {
  redirect("/projects");
}
