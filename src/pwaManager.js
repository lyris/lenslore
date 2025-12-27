/**
 * PWA 管理器
 * 处理 PWA 安装提示、离线检测等功能
 */

import { NetworkService } from './networkService.js';

export class PWAManager {
    constructor() {
        this.deferredPrompt = null;
        this.isInstalled = false;
        this.networkService = NetworkService.getInstance();
        this.installButton = null;

        this.init();
    }

    init() {
        // 检测是否已安装为 PWA
        this.checkIfInstalled();

        // 监听安装事件
        window.addEventListener('beforeinstallprompt', (e) => {
            console.log('[PWA] Install prompt available');
            e.preventDefault();
            this.deferredPrompt = e;
            
            if (this.installButton) {
                this.installButton.style.display = 'flex';
            }
        });

        // 监听安装完成
        window.addEventListener('appinstalled', () => {
            console.log('[PWA] App installed successfully');
            this.isInstalled = true;
            if (this.installButton) {
                this.installButton.style.display = 'none';
            }
            this.showNotification('✅ App installed! You can now use it offline.');
        });

        // 使用 NetworkService 统一管理网络事件
        this.networkService.on('online', () => {
            console.log('[PWA] Network: online');
            this.showNotification('🌐 Back online!', 2000);
        });

        this.networkService.on('offline', () => {
            console.log('[PWA] Network: offline');
            this.showNotification('📡 Offline mode - using cached data', 3000);
        });

        // Service Worker 更新检测
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                console.log('[PWA] Service Worker updated');
                this.showNotification('🔄 App updated! Refresh to see changes.', 5000);
            });
        }
    }

    setInstallButton(element) {
        this.installButton = element;
        
        // 如果已经有 deferredPrompt，立即显示按钮
        if (this.deferredPrompt) {
            this.installButton.style.display = 'flex';
        }
        
        this.installButton.addEventListener('click', async () => {
            if (!this.deferredPrompt) return;

            this.deferredPrompt.prompt();
            const { outcome } = await this.deferredPrompt.userChoice;
            console.log(`[PWA] User response: ${outcome}`);

            this.deferredPrompt = null;
            this.installButton.style.display = 'none';
        });
    }

    checkIfInstalled() {
        // 检测是否在独立窗口模式运行（已安装）
        if (window.matchMedia('(display-mode: standalone)').matches) {
            this.isInstalled = true;
            console.log('[PWA] Running as installed app');
        }

        // iOS Safari 检测
        if (window.navigator.standalone === true) {
            this.isInstalled = true;
            console.log('[PWA] Running as iOS web app');
        }
    }

    showNotification(message, duration = 3000) {
        // 创建通知提示
        const notification = document.createElement('div');
        notification.className = 'pwa-notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.85);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 10000;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            animation: fadeInOut ${duration}ms ease-in-out;
            max-width: 90vw;
            text-align: center;
        `;

        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeInOut {
                0% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                10% { opacity: 1; transform: translateX(-50%) translateY(0); }
                90% { opacity: 1; transform: translateX(-50%) translateY(0); }
                100% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
            }
        `;
        document.head.appendChild(style);

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
            style.remove();
        }, duration);
    }

    // 请求持久化存储（防止浏览器清理缓存）
    async requestPersistentStorage() {
        if (navigator.storage && navigator.storage.persist) {
            const isPersisted = await navigator.storage.persist();
            console.log(`[PWA] Persistent storage: ${isPersisted ? 'granted' : 'denied'}`);
            return isPersisted;
        }
        return false;
    }

    // 获取存储使用情况
    async getStorageEstimate() {
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            const usageInMB = (estimate.usage / 1024 / 1024).toFixed(2);
            const quotaInMB = (estimate.quota / 1024 / 1024).toFixed(2);
            console.log(`[PWA] Storage: ${usageInMB}MB / ${quotaInMB}MB`);
            return estimate;
        }
        return null;
    }

    // 检查 Service Worker 更新
    async checkForUpdates() {
        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.getRegistration();
            if (registration) {
                await registration.update();
                console.log('[PWA] Checked for updates');
            }
        }
    }
}
