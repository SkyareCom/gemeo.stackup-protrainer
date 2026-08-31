"use client";

import { useEffect } from "react";

/**
 * Registra o service worker do PWA no cliente. Fica isolado num componente
 * "use client" separado para não transformar o layout inteiro em client
 * component. Falha em silêncio (não deve nunca quebrar o app) em
 * navegadores sem suporte ou em ambientes sem HTTPS (ex.: preview local).
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Silencioso: SW é uma melhoria progressiva, não pode derrubar o app.
      });
    };

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
