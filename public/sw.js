// Service Worker for LensLore PWA
// Enables offline functionality and caching

const CACHE_NAME = 'lenslore-1.0.0-1766845335728';
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
  './assets/asr-B9du3Hwl.js',
  './assets/config-D56GOaQ9.js',
  './assets/main-CLX55aOe.js',
  './assets/ort-wasm-simd-threaded.jsep-B0T3yYHD.wasm',
  './assets/tts-DFWnvHXl.js',
  './assets/vendor-ai-fo6w6Voj.js',
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

// 辅助函数：规范化 HuggingFace URL，统一使用镜像 URL 作为缓存 key
// 这样可以确保无论请求来自 huggingface.co 还是 hf.bitags.com，都能命中同一个缓存
// 注意：transformers.js 已配置 env.remoteHost，实际请求会直接发往镜像
function normalizeHFUrl(urlString) {
  return urlString.replace('https://huggingface.co', 'https://hf.bitags.com');
}

// Fetch 事件：智能缓存策略
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 跨域请求（模型文件）：Service Worker 负责缓存管理
  // transformers.js 的 env.useBrowserCache 依赖 SW 的 fetch 拦截和缓存
  if (url.origin !== location.origin) {
    event.respondWith(
      caches.open(TRANSFORMERS_CACHE).then((cache) => {
        // 规范化 URL：统一使用镜像 URL 作为缓存 key
        const normalizedUrl = normalizeHFUrl(request.url);
        const cacheKey = new Request(normalizedUrl, {
          method: request.method,
          headers: request.headers
        });

        // 使用规范化的 URL 查询缓存
        return cache.match(cacheKey, { ignoreSearch: true }).then(async (cachedResponse) => {
          // 优先使用规范化 URL 查询
          if (cachedResponse) {
            console.log('[SW] ✅ Serving from cache (normalized):', url.pathname);
            return cachedResponse;
          }

          // 回退：尝试用原始请求查询（兼容旧缓存）
          const legacyResponse = await cache.match(request, { ignoreSearch: true });
          if (legacyResponse) {
            console.log('[SW] ✅ Serving from cache (legacy):', url.pathname);
            return legacyResponse;
          }

          // 缓存未命中，发起网络请求并缓存
          console.log('[SW] ⬇️  Fetching from network:', request.url);

          try {
            const response = await fetch(request);

            // 只缓存成功的响应
            if (response && response.status === 200) {
              // 克隆响应用于缓存（原始响应返回给调用者）
              const responseToCache = response.clone();

              // 原子性缓存写入
              try {
                await cache.put(cacheKey, responseToCache);
                console.log('[SW] ✅ Cached:', url.pathname);
              } catch (cacheError) {
                console.error('[SW] ❌ Cache write failed:', url.pathname, cacheError);
                // 删除可能不完整的缓存
                await cache.delete(cacheKey).catch(() => {});
              }
            }

            return response;
          } catch (error) {
            console.error('[SW] ❌ Fetch failed:', request.url, error);
            return new Response('Network error', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          }
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
