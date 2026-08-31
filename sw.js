// Service worker do NLH Trainer Pro One.
// Objetivo: (1) tornar o app instalável (critério do Chrome exige um SW com
// handler de fetch), (2) dar resiliência offline básica para quem já abriu
// o app antes, sem depender dos nomes de arquivo gerados pelo build (vinext).
//
// Estratégia: "stale-while-revalidate" para navegações e assets estáticos —
// serve do cache instantaneamente quando existe, e atualiza o cache em
// segundo plano a cada visita. Não cacheia respostas não-OK, não-GET, nem
// chamadas de API (mantém dados sempre frescos quando houver rede).

const CACHE_NAME = "nlh-trainer-shell-v1";
const OFFLINE_URL = "/";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isCacheable(request, response) {
  if (request.method !== "GET") return false;
  if (!response || !response.ok) return false;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return false;
  return true;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // não intercepta terceiros
  if (url.pathname.startsWith("/api/")) return; // dados dinâmicos: sempre rede

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);

      const networkFetch = fetch(request)
        .then((response) => {
          if (isCacheable(request, response)) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => undefined);

      if (cached) {
        // Serve o cache na hora e atualiza em segundo plano.
        networkFetch;
        return cached;
      }

      const fresh = await networkFetch;
      if (fresh) return fresh;

      // Sem cache e sem rede: para navegação, cai no shell salvo.
      if (request.mode === "navigate") {
        const fallback = await cache.match(OFFLINE_URL);
        if (fallback) return fallback;
      }
      return new Response("Offline e sem versão em cache ainda.", {
        status: 503,
        statusText: "Offline",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    })
  );
});

// Permite que a página force a ativação de uma nova versão do SW
// (ex.: botão "atualizar" no app) via navigator.serviceWorker.controller.postMessage({type:"SKIP_WAITING"})
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
