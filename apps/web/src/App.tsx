import { useEffect, useState } from "react";
import { healthResponseSchema } from "@jewellery/shared";
import AccountMenu from "./AccountMenu";
import Login from "./Login";
import { AuthProvider, useAuth } from "./auth";
import { usePath } from "./router";
import CustomerList from "./customers/CustomerList";
import CustomerPage from "./customers/CustomerPage";
import { EditCustomerPage, NewCustomerPage, PickerDemoPage } from "./customers/pages";

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
    <div className="flex flex-col items-center justify-center gap-2 py-16">
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

function Page({ path }: { path: string }) {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "customers") {
    if (parts.length === 1) return <CustomerList />;
    if (parts[1] === "new") return <NewCustomerPage />;
    if (parts[2] === "edit") return <EditCustomerPage id={parts[1]!} />;
    return <CustomerPage id={parts[1]!} />;
  }
  if (parts[0] === "picker-demo") return <PickerDemoPage />;
  return <Home />;
}

function Shell() {
  const path = usePath();
  const inCustomers = path.startsWith("/customers");
  const link = (href: string, label: string, active: boolean) => (
    <a href={href} className={`px-3 py-1.5 rounded-lg text-sm ${active ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-100"}`}>
      {label}
    </a>
  );
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col">
      <header className="flex items-center justify-between gap-2 px-4 py-3 bg-white border-b border-stone-200">
        <nav className="flex items-center gap-2">
          <span className="font-semibold mr-2 max-sm:hidden">Jewellery Billing</span>
          {link("#/", "Home", path === "/")}
          {link("#/customers", "Customers", inCustomers)}
        </nav>
        <AccountMenu />
      </header>
      <main className="flex-1 w-full max-w-5xl mx-auto p-4">
        <Page path={path} />
      </main>
    </div>
  );
}

function Gate() {
  const { user } = useAuth();
  if (user === undefined) {
    return <main className="min-h-screen bg-stone-50 flex items-center justify-center text-stone-500">Loading...</main>;
  }
  return user ? <Shell /> : <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
