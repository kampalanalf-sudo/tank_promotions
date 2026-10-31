import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

function showError(message: string) {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `<div style="font-family:sans-serif;max-width:560px;margin:15vh auto;padding:24px;line-height:1.6;color:#222">
    <h1 style="font-size:22px">Something went wrong loading the site</h1>
    <p>Please send this error to your developer:</p>
    <pre style="white-space:pre-wrap;background:#f3f3f3;padding:12px;border-radius:8px;font-size:13px"></pre>
    <button id="tank-reset" style="margin-top:12px;padding:10px 16px;border:0;border-radius:8px;background:#111;color:#fff">Reset saved data and reload</button>
  </div>`;
  root.querySelector("pre")!.textContent = message;
  root.querySelector("#tank-reset")!.addEventListener("click", () => {
    localStorage.clear();
    location.hash = "";
    location.reload();
  });
}

window.addEventListener("error", (event) => showError(String(event.error?.stack || event.message)));
window.addEventListener("unhandledrejection", (event) => showError(String(event.reason?.stack || event.reason)));

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    showError(String(error.stack || error.message));
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
