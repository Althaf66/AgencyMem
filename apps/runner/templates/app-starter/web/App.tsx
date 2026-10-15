// The app shell (sample-app.md section 9): a header with the clinic name from GET /api/clinic, the
// nav links, and the page of the current hash route.
import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { AdminPage } from "./pages/AdminPage.tsx";
import { BookPage } from "./pages/BookPage.tsx";
import { BookingPage } from "./pages/BookingPage.tsx";
import { DoctorsPage } from "./pages/DoctorsPage.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { SlotsPage } from "./pages/SlotsPage.tsx";
import { useRoute } from "./router.tsx";

const PAGES: Record<string, () => JSX.Element> = {
  "/": HomePage,
  "/doctors": DoctorsPage,
  "/slots": SlotsPage,
  "/book": BookPage,
  "/booking": BookingPage,
  "/admin": AdminPage,
};

const NAV: [string, string, string][] = [
  ["nav-home", "#/", "Home"],
  ["nav-doctors", "#/doctors", "Doctors"],
  ["nav-slots", "#/slots", "Slots"],
  ["nav-book", "#/book", "Book"],
  ["nav-booking", "#/booking", "My booking"],
  ["nav-admin", "#/admin", "Admin"],
];

export function App() {
  const route = useRoute();
  const [clinic, setClinic] = useState<{ name: string } | null>(null);
  useEffect(() => {
    api<{ name: string }>("/clinic").then(setClinic, () => setClinic(null));
  }, []);
  const Page = PAGES[route.path] ?? HomePage;
  return (
    <>
      <header>
        <strong data-testid="app-clinic-name">{clinic?.name ?? ""}</strong>
        <nav>
          {NAV.map(([testId, href, label]) => (
            <a key={testId} data-testid={testId} href={href}>
              {label}
            </a>
          ))}
        </nav>
      </header>
      <main>
        <Page />
      </main>
    </>
  );
}
