// 大島橙也ポートフォリオ Service Worker
// キャッシュ名のバージョンを上げると、古いキャッシュが破棄されて更新が反映される。
const CACHE = "touya-portfolio-v1";

// 最初にまとめてキャッシュしておく中心的なファイル（アプリシェル）。
const PRECACHE = [
  "./",
  "./index.html",
  "./artwork.html",
  "./manifest.webmanifest",
  "./profile.jpg",
  "./feri.jpg",
  "./pel.jpg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // GET 以外（フォーム送信など）はそのままネットワークへ。
  if (request.method !== "GET") return;

  // ページ遷移はネットワーク優先。オフライン時はキャッシュ→最後にトップへフォールバック。
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("./index.html"))
        )
    );
    return;
  }

  // それ以外（画像・CSS・JS など）はキャッシュ優先、無ければ取得してキャッシュ。
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      });
    })
  );
});
