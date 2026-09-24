// Codivex — registro do Service Worker para instalação como PWA.

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js", {
        scope: "./"
      })
      .catch((error) => {
        console.warn(
          "Codivex: não foi possível registrar o Service Worker.",
          error
        );
      });
  });
}