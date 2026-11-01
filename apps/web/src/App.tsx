import { useEffect, useState } from "react";
import { healthResponseSchema } from "@jewellery/shared";
import AccountMenu from "./AccountMenu";
import Login from "./Login";
import { AuthProvider, useAuth } from "./auth";
import { usePath } from "./router";
import CustomerList from "./customers/CustomerList";
import CustomerPage from "./customers/CustomerPage";
import { EditCustomerPage, NewCustomerPage, PickerDemoPage } from "./customers/pages";
import CalculatorPage from "./calculator/CalculatorPage";
import InvoiceList from "./invoice/InvoiceList";
import InvoicePage from "./invoice/InvoicePage";
import { EditInvoicePage, NewInvoicePage } from "./invoice/pages";
import RatesPage from "./rates/RatesPage";
import TodayRates from "./rates/TodayRates";
import SettingsPage from "./settings/SettingsPage";
import UsersPage from "./users/UsersPage";
import ForcePasswordChange from "./ForcePasswordChange";
import BusinessBanner from "./settings/BusinessBanner";

type ApiStatus = "checking" | "ok" | "unreachable";

function isHealthy(body: unknown): boolean {
  const parsed = healthResponseSchema.safeParse(body);
  return parsed.success && parsed.data.status === "ok" && parsed.data.db === "ok";
}

function Home() {
  const [status, setStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((body) => setStatus(isHealthy(body) ? "ok" : "unreachable"))
      .catch(() => setStatus("unreachable"));
  }, []);

  return (
    <div className="flex flex-col items-center gap-2 py-8">
      <div className="w-full max-w-xl mb-8">
        <BusinessBanner />
        <TodayRates />
      </div>
      <h1 className="text-3xl font-semibold">Jewellery Billing</h1>
      <p className="text-stone-600">
        API status:{" "}
        <span className={status === "ok" ? "text-green-700" : status === "checking" ? "" : "text-red-700"}>
          {status === "ok" ? "ok" : status === "checking" ? "checking..." : "API unreachable"}
        </span>
      </p>
    </div>
  );
}

function Page({ path, meId }: { path: string; meId: string }) {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "customers") {
    if (parts.length === 1) return <CustomerList />;
    if (parts[1] === "new") return <NewCustomerPage />;
    if (parts[2] === "edit") return <EditCustomerPage id={parts[1]!} />;
    return <CustomerPage id={parts[1]!} />;
  }
  if (parts[0] === "invoices") {
    if (parts.length === 1) return <InvoiceList />;
    if (parts[1] === "new") return <NewInvoicePage />;
    if (parts[2] === "edit") return <EditInvoicePage id={parts[1]!} />;
    return <InvoicePage id={parts[1]!} />;
  }
  if (parts[0] === "rates") return <RatesPage />;
  if (parts[0] === "settings") return <SettingsPage />;
  if (parts[0] === "users") return <UsersPage me={meId} />;
  if (parts[0] === "calculator") return <CalculatorPage />;
  if (parts[0] === "picker-demo") return <PickerDemoPage />;
  return <Home />;
}

function Shell() {
  const path = usePath();
  const { can, user } = useAuth();
  const inCustomers = path.startsWith("/customers");
  const inRates = path.startsWith("/rates");
  const inInvoices = path.startsWith("/invoices");
  const inSettings = path.startsWith("/settings");
  const inCalculator = path.startsWith("/calculator");
  const link = (href: string, label: string, active: boolean, extra = "") => (
    <a href={href} className={`px-2 sm:px-3 py-1.5 rounded-lg text-sm whitespace-nowrap ${extra} ${active ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-100"}`}>
      {label}
    </a>
  );
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col">
      <header className="flex items-center justify-between gap-2 px-2 sm:px-4 py-3 bg-white border-b border-stone-200">
        <nav className="flex items-center gap-1 sm:gap-2 min-w-0 overflow-x-auto">
          <span className="font-semibold mr-2 max-sm:hidden">Jewellery Billing</span>
          {link("#/", "Home", path === "/")}
          {can("invoices.view") && link("#/invoices", "Invoices", inInvoices)}
          {can("customers.view") && link("#/customers", "Customers", inCustomers)}
          {can("rates.view") && link("#/rates", "Rates", inRates)}
          {can("invoices.view") && link("#/calculator", "Calculator", inCalculator, "max-md:hidden")}
          {can("settings.view") && link("#/settings", "Settings", inSettings)}
          {can("users.manage") && link("#/users", "People", path.startsWith("/users"))}
        </nav>
        <AccountMenu />
      </header>
      <main className="flex-1 w-full max-w-5xl mx-auto p-4">
        <Page path={path} meId={user?.id ?? ""} />
      </main>
    </div>
  );
}

function Gate() {
  const { user } = useAuth();
  if (user === undefined) {
    return <main className="min-h-screen bg-stone-50 flex items-center justify-center text-stone-500">Loading...</main>;
  }
  if (user && user.mustChangePassword) return <ForcePasswordChange />;
  return user ? <Shell /> : <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
