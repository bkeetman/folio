import { AppRouteViews } from "./app-routes/AppRouteViews";
import type { AppRoutesProps } from "./app-routes/types";

export function AppRoutes(props: AppRoutesProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <AppRouteViews {...props} />
    </section>
  );
}
