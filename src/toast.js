import { createContext, useContext } from "react";

/* Contexto dos toasts. Fica separado do ToastProvider (componente em
   shared.jsx) para que arquivos que só disparam avisos não importem
   componentes nem bibliotecas de animação. */
export const ToastContext = createContext(() => {});

export function useToast() {
  return useContext(ToastContext);
}
