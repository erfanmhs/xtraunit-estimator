import StageSkeleton from "@/components/StageSkeleton";

/**
 * Shown the instant this stage is opened, while its data loads. Without it the
 * app looked frozen on a phone and people tapped the stage again.
 */
export default function Loading() {
  return <StageSkeleton title="Project" rows={5} />;
}
