import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/app.css";
import "./styles/extra.css";
import "./styles/v2/tokens.css";
import "./styles/v2/base.css";
import { App } from "./App";
import { RoleProvider, ToastProvider } from "./components/ui";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <RoleProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </RoleProvider>
    </BrowserRouter>
  </StrictMode>,
);
