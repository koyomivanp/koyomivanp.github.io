// 大島橙也ポートフォリオ Service Worker
// キャッシュ名のバージョンを上げると、古いキャッシュが破棄されて更新が反映される。
const CACHE = "touya-portfolio-v3";

// 最初にまとめてキャッシュしておく中心的なファイル（アプリシェル）。
const PRECACHE = [
  "./",
  "./index.html",
  "./artwork.html",
  "./manifest.webmanifest",
  "./profile.jpg",
  "./feri.jpg",
  "./pel.jpg",
  "./scarlet.jpg",
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

  // それ以外（画像・CSS・JS など）はキャッシュがあればすぐ返しつつ、裏で取り直して次回に反映する。
  // （キャッシュ優先のままだと、CSS や画像を更新しても再訪した人に古いものが出続けるため）
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(request).then((cached) => {
        const fresh = fetch(request)
          .then((res) => {
            if (res && res.status === 200 && res.type === "basic") cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || fresh;
      })
    )
  );
});
