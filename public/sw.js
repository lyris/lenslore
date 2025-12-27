// Service Worker for LensLore PWA
// Enables offline functionality and caching

const CACHE_NAME = 'lenslore-1.0.0-1766839212354';
const RUNTIME_CACHE = 'lenslore-runtime';
// transformers.js 使用自己的缓存：'transformers-cache'
const TRANSFORMERS_CACHE = 'transformers-cache';



// 核心应用文件（需要预缓存）
// 使用构建产物路径，避免生产环境缓存不存在的 ./src/*.js
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './assets/asr-ZnmCJDD3.js',
  './assets/config-D56GOaQ9.js',
  './assets/main-B8Z1YOEV.js',
  './assets/ort-wasm-simd-threaded.jsep-B0T3yYHD.wasm',
  './assets/tts-CNKLlAIp.js',
  './assets/vendor-ai-B8xga8Jq.js',
  './assets/vendor-chinese-D42sZK8o.js',
  './assets/voices-B3UZyF-f.js'
];

// 安装事件：预缓存核心文件
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  console.log('[SW] Cache name:', CACHE_NAME);


  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching core assets');
      // 使用 Promise.all() 严格模式：所有文件必须成功缓存，否则安装失败
      // 这样可以避免部分缓存导致应用异常
      return Promise.all(
        CORE_ASSETS.map(url =>
          cache.add(url).then(() => {
            console.log(`[SW] ✅ Cached: ${url}`);
          }).catch(err => {
            console.error(`[SW] ❌ Failed to cache ${url}:`, err);
            throw err; // 重新抛出错误，导致整个安装失败
          })
        )
      );
    }).then(() => {
      console.log('[SW] ✅ All core assets cached successfully');
      // 强制激活新的 Service Worker
      return self.skipWaiting();
    }).catch((error) => {
      console.error('[SW] ❌ Installation failed:', error);
      throw error; // 安装失败，浏览器会在稍后重试
    })
  );
});

// 激活事件：清理旧缓存（保留模型相关缓存）
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');

  // 保留的缓存名称列表
  const preservedCaches = [
    CACHE_NAME,              // 当前应用缓存
    RUNTIME_CACHE,           // 运行时缓存
    TRANSFORMERS_CACHE,      // transformers.js 内部使用的缓存
    'kokoro-voices'          // kokoro.js 可能使用的缓存
  ];

  event.waitUntil(
    // 第一步：检查新缓存的完整性
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Checking cache completeness...');
      // 检查所有核心资源是否都已缓存
      return Promise.all(
        CORE_ASSETS.map(url => cache.match(url))
      ).then((responses) => {
        const missingAssets = [];
        CORE_ASSETS.forEach((url, index) => {
          if (!responses[index]) {
            missingAssets.push(url);
          }
        });

        if (missingAssets.length > 0) {
          console.warn('[SW] ⚠️ Cache incomplete! Missing assets:', missingAssets);
          console.warn('[SW] ⚠️ Keeping old cache to prevent app breakage');
          return false; // 缓存不完整
        }

        console.log('[SW] ✅ Cache is complete, safe to delete old caches');
        return true; // 缓存完整
      });
    }).then((isCacheComplete) => {
      // 第二步：只有在新缓存完整的情况下才删除旧缓存
      if (!isCacheComplete) {
        console.log('[SW] Skipping old cache deletion due to incomplete new cache');
        return self.clients.claim();
      }

      return caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => !preservedCaches.includes(name))
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      }).then(() => {
        console.log('[SW] Preserved model caches:', preservedCaches.slice(2).join(', '));
        // 立即接管所有页面
        return self.clients.claim();
      });
    })
  );
});

// Fetch 事件：智能缓存策略
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 跨域请求（模型文件）：优先从 transformers.js 缓存读取
  // 模型下载由主应用的 remote_host 配置控制，SW 只负责缓存查询
  if (url.origin !== location.origin) {
    event.respondWith(
      caches.open(TRANSFORMERS_CACHE).then((cache) => {
        return cache.match(request, { ignoreSearch: true }).then((cachedResponse) => {
          if (cachedResponse) {
            console.log('[SW] ✅ Serving from cache:', url.pathname);
            return cachedResponse;
          }

          // 如果请求的是 huggingface.co，重定向到镜像
          let actualRequest = request;
          if (url.hostname === 'huggingface.co') {
            // 使用自建 Cloudflare Worker 镜像（支持 CORS）
            const mirrorUrl = url.href.replace('https://huggingface.co', 'https://hf.bitags.com');
            console.log('[SW] 🔄 Redirecting to mirror:', url.href, '->', mirrorUrl);
            actualRequest = new Request(mirrorUrl, {
              method: request.method,
              headers: request.headers,
              mode: 'cors',
              credentials: 'omit',
              cache: request.cache,
              redirect: 'follow'
            });
          }

          // 缓存未命中，直接网络请求（transformers.js 会自动缓存）
          console.log('[SW] ⬇️  Fetching:', actualRequest.url);
          return fetch(actualRequest).then((response) => {
            // 缓存响应（使用原始请求 URL 作为 key）
            if (response && response.status === 200) {
              cache.put(request, response.clone());
            }
            return response;
          }).catch((error) => {
            console.error('[SW] Fetch failed:', actualRequest.url, error);
            return new Response('Network error', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
        });
      })
    );
    return;
  }

  // 本地资源：缓存优先，失败则网络
  event.respondWith(
    // 使用 ignoreSearch 忽略 URL 查询参数，提高缓存命中率
    caches.match(request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        // 后台更新缓存（stale-while-revalidate）
        fetch(request).then((response) => {
          if (response && response.status === 200 && request.method === 'GET') {
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, response);
            });
          }
        }).catch(() => {
          // 忽略后台更新失败
        });
        return cachedResponse;
      }

      // 缓存不存在，从网络获取
      return fetch(request).then((response) => {
        // 只缓存成功的 GET 请求
        if (response && response.status === 200 && request.method === 'GET') {
          const responseToCache = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return response;
      }).catch((error) => {
        console.error('[SW] Fetch failed for local resource:', url.pathname, error);
        // 返回离线页面或错误提示
        return new Response('Offline', {
          status: 503,
          statusText: 'Service Unavailable'
        });
      });
    })
  );
});

// 消息处理：支持手动控制 Service Worker
self.addEventListener('message', (event) => {
  // 跳过等待，立即激活新版本
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // 清除所有缓存（用于调试）
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => caches.delete(name))
        );
      }).then(() => {
        return self.clients.matchAll();
      }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'CACHE_CLEARED' });
        });
      })
    );
  }
});
