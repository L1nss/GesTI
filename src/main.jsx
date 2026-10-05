import { Component, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./App.css";
import App, { ToastProvider } from "./App.jsx";
import { captureAppError } from "./supabaseApi.js";

function clearSavedData() {
  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith("tigest-"))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Segue o fluxo mesmo sem acesso ao armazenamento.
  }
  window.location.reload();
}

class ErrorBoundary extends Component {
  state = { error: null };

  componentDidCatch(error) {
    void captureAppError(error);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", background: "#faf9f7", color: "#26272b", padding: 24 }}>
        <div style={{ maxWidth: 560, display: "grid", gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>O GesTI encontrou um erro ao iniciar</h1>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", background: "#f1efec", border: "1px solid #e2dfda", borderRadius: 10, padding: 14, fontSize: 13, overflow: "auto" }}>{String(error?.stack || error)}</pre>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={() => window.location.reload()} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid #c9c5be", background: "#fff", cursor: "pointer" }}>Recarregar página</button>
            <button type="button" onClick={clearSavedData} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: "#4f46e5", color: "#fff", cursor: "pointer" }}>Limpar dados salvos e recarregar</button>
          </div>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
