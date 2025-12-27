/**
 * 离线处理器
 * 处理离线状态下的用户体验
 */

import { NetworkService } from './networkService.js';

export class OfflineHandler {
    constructor() {
        this.networkService = NetworkService.getInstance();
        this.listeners = [];
        this.init();
    }

    init() {
        // 使用 NetworkService 统一管理网络事件
        this.networkService.on('online', () => {
            this.notifyListeners('online');
            this.showNetworkStatus('🌐 Connected', 'online');
        });

        this.networkService.on('offline', () => {
            this.notifyListeners('offline');
            this.showNetworkStatus('📡 Offline - Using cached data', 'offline');
        });

        // 初始状态提示
        if (!this.networkService.checkStatus()) {
            this.showNetworkStatus('📡 Offline Mode', 'offline');
        }
    }

    showNetworkStatus(message, status) {
        // 创建网络状态指示器
        let indicator = document.getElementById('network-indicator');

        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'network-indicator';
            document.body.appendChild(indicator);
        }

        const bgColor = status === 'online' ? 'rgba(34, 197, 94, 0.9)' : 'rgba(251, 146, 60, 0.9)';

        indicator.style.cssText = `
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            background: ${bgColor};
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 500;
            z-index: 10001;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            animation: slideDown 0.3s ease-out;
        `;

        indicator.textContent = message;

        // 添加动画
        if (!document.getElementById('network-indicator-style')) {
            const style = document.createElement('style');
            style.id = 'network-indicator-style';
            style.textContent = `
                @keyframes slideDown {
                    from {
                        transform: translateX(-50%) translateY(-50px);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(-50%) translateY(0);
                        opacity: 1;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        // 在线状态3秒后自动隐藏
        if (status === 'online') {
            setTimeout(() => {
                if (indicator && this.networkService.checkStatus()) {
                    indicator.style.opacity = '0';
                    indicator.style.transition = 'opacity 0.3s';
                    setTimeout(() => indicator.remove(), 300);
                }
            }, 3000);
        }
    }

    // 添加网络状态监听器
    addListener(callback) {
        this.listeners.push(callback);
    }

    // 通知所有监听器
    notifyListeners(status) {
        this.listeners.forEach(callback => callback(status));
    }

    // 检查资源是否可用（在缓存中）
    async isResourceCached(url) {
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            for (const cacheName of cacheNames) {
                const cache = await caches.open(cacheName);
                const response = await cache.match(url);
                if (response) {
                    return true;
                }
            }
        }
        return false;
    }

    // 获取缓存信息
    async getCacheInfo() {
        if (!('caches' in window)) {
            return null;
        }

        const cacheNames = await caches.keys();
        const info = [];

        for (const cacheName of cacheNames) {
            const cache = await caches.open(cacheName);
            const keys = await cache.keys();
            info.push({
                name: cacheName,
                count: keys.length,
                urls: keys.map(req => req.url)
            });
        }

        return info;
    }

    // 清理缓存
    async clearCache(cacheName = null) {
        if (!('caches' in window)) {
            return false;
        }

        if (cacheName) {
            return await caches.delete(cacheName);
        } else {
            const cacheNames = await caches.keys();
            const results = await Promise.all(
                cacheNames.map(name => caches.delete(name))
            );
            return results.every(result => result === true);
        }
    }
}
