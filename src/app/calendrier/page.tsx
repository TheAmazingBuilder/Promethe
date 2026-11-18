import { AppPage } from "../app-page";

/** Legacy French pathname — renders the view, then
 * LegacyHashRedirect replaces it with the canonical English URL. */
export default function Page() {
  return <AppPage />;
}
