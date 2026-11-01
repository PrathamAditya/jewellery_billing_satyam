import { useEffect, useState } from "react";

/** A tiny hash router: "#/customers/123/edit". No extra library needed for a handful of screens. */
export function usePath(): string {
  const read = () => window.location.hash.replace(/^#/, "") || "/";
  const [path, setPath] = useState(read);
  useEffect(() => {
    const on = () => setPath(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return path;
}

export function navigate(path: string) {
  window.location.hash = path;
}
