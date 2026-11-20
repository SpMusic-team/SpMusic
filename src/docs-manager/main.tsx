import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

import "@/index.css"
import "./docs-manager.css"
import { App } from "./App"

const root = document.getElementById("docs-manager-root")

if (!root) throw new Error("Docs manager root element is missing")

createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <App />
      <Toaster richColors position="bottom-right" />
    </TooltipProvider>
  </StrictMode>,
)
