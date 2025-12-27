/**
 * 移动端优化模块
 * 提供震动反馈、屏幕唤醒、网络检测等功能
 */

export class MobileOptimizer {
    constructor(app) {
        this.app = app;
        this.wakeLock = null;
        this.isMobile = this.detectMobile();
    }

    detectMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    // 震动反馈
    vibrate(duration = 50) {
        if ('vibrate' in navigator) {
            navigator.vibrate(duration);
        }
    }

    // 请求屏幕保持唤醒
    async requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                this.wakeLock = await navigator.wakeLock.request('screen');
                console.log('Wake Lock active');

                // 监听释放事件
                this.wakeLock.addEventListener('release', () => {
                    console.log('Wake Lock released');
                });
            }
        } catch (err) {
            console.warn('Wake Lock error:', err.message);
        }
    }

    // 释放屏幕唤醒锁
    releaseWakeLock() {
        if (this.wakeLock) {
            this.wakeLock.release()
                .then(() => {
                    this.wakeLock = null;
                })
                .catch(err => {
                    console.warn('Wake Lock release error:', err);
                });
        }
    }

    // 检查网络类型
    getNetworkType() {
        if ('connection' in navigator) {
            const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            return {
                type: connection.type,              // 物理连接类型（wifi, cellular, ethernet等）
                effectiveType: connection.effectiveType,  // 有效连接类型（基于性能）
                downlink: connection.downlink,
                rtt: connection.rtt,
                saveData: connection.saveData
            };
        }
        return null;
    }

    // 检查是否应该警告用户关于数据使用
    async checkNetworkAndWarn() {
        const network = this.getNetworkType();

        // 记录用户网络类型（生产环境保留，用于用户分析）
        if (network) {
            console.warn('User Network Info:', {
                physicalType: network.type || 'unknown',
                effectiveType: network.effectiveType || 'unknown',
                downlink: network.downlink + ' Mbps',
                rtt: network.rtt + ' ms',
                saveData: network.saveData ? 'enabled' : 'disabled'
            });
        } else {
            console.warn('User Network Info: Network Information API not supported');
        }

        if (network) {
            // 优先检查物理连接类型
            const isCellular = network.type === 'cellular';
            const isSlowEffective = network.effectiveType === '3g' || network.effectiveType === '2g';
            const isSaveData = network.saveData;

            // 只在以下情况警告：
            // 1. 物理连接是移动网络（cellular）
            // 2. 开启了数据节省模式
            // 注意：WiFi连接即使effectiveType显示为3g也不警告
            if (isCellular || isSaveData) {
                const downloadSize = this.estimateDownloadSize();

                let message;
                if (isSaveData) {
                    message = `检测到数据节省模式开启。\n首次加载需下载约${downloadSize}模型。\n\n建议连接WiFi后使用。\n\n是否继续？`;
                } else if (isCellular) {
                    const effectiveInfo = isSlowEffective ? `（${network.effectiveType.toUpperCase()}网速）` : '';
                    message = `检测到移动数据网络${effectiveInfo}。\n首次加载需下载约${downloadSize}模型。\n\n建议连接WiFi后使用。\n\n是否继续？`;
                }

                return confirm(message);
            }
        }

        return true;
    }

    // 检查是否首次加载
    needsCoreModelsPrompt() {
        // 首屏提示只关注视觉+TTS；ASR 不纳入首次判断
        const flags = this.getCacheFlags();
        return !(flags.vision && flags.tts);
    }

    /**
     * 估算下载大小
     * 注意：实际会根据 GPU 显存自动降级
     * @returns {string} 下载大小估算
     */
    estimateDownloadSize() {
        const hasWebGPU = 'gpu' in navigator;

        // 策略：优先尝试 fp16，显存不足会自动降级
        // 这里显示最优情况（fp16）的下载大小

        // Vision: fp16 ~540MB
        const visionSize = 540;

        // TTS: fp16 ~163MB (WebGPU) 或 q8 ~90MB (WASM)
        const ttsSize = hasWebGPU ? 163 : 90;

        const totalMB = visionSize + ttsSize;

        if (totalMB >= 1000) {
            return `${(totalMB / 1024).toFixed(1)}GB`;
        } else {
            return `${totalMB}MB`;
        }
    }

    // 标记模型已缓存
    markModelsCached(type) {
        // type: 'vision' | 'tts' | 'asr' | undefined
        try {
            if (type) {
                localStorage.setItem(`lenslore_cached_${type}`, 'true');
            }
            this.updateAllCachedFlag();
        } catch (e) {
            console.warn('[Cache] Failed to mark models cached:', e);
        }
    }

    getCacheFlags() {
        return {
            vision: localStorage.getItem('lenslore_cached_vision') === 'true',
            tts: localStorage.getItem('lenslore_cached_tts') === 'true',
            asr: localStorage.getItem('lenslore_cached_asr') === 'true'
        };
    }

    updateAllCachedFlag() {
        const flags = this.getCacheFlags();
        const allCached = flags.vision && flags.tts && flags.asr;
        if (allCached) {
            localStorage.setItem('lenslore_models_cached', 'true');
            localStorage.setItem('lenslore_cached_at', new Date().toISOString());
        } else {
            // 旧键保留但不主动删除，防止历史兼容；仅在未全部完成时不再依赖它
        }
    }

    // 获取缓存时间
    getCachedTime() {
        return localStorage.getItem('lenslore_cached_at');
    }

    // 性能监控
    createPerformanceMonitor() {
        return {
            fps: 0,
            lastTime: Date.now(),
            frameCount: 0,
            slowFrames: 0,

            update() {
                this.frameCount++;
                const now = Date.now();

                if (now - this.lastTime >= 1000) {
                    this.fps = this.frameCount;

                    // 检测性能问题
                    if (this.fps < 1) {
                        this.slowFrames++;
                    } else {
                        this.slowFrames = 0;
                    }

                    this.frameCount = 0;
                    this.lastTime = now;

                    return this.fps;
                }

                return null;
            },

            shouldIncreaseInterval() {
                return this.slowFrames >= 3; // 连续3秒低性能
            }
        };
    }

    // 自动调整处理间隔
    autoAdjustInterval(monitor, currentInterval) {
        if (monitor.shouldIncreaseInterval() && currentInterval < 3000) {
            const newInterval = Math.min(currentInterval + 500, 3000);
            console.warn(`Performance low, increasing interval: ${currentInterval}ms → ${newInterval}ms`);
            return newInterval;
        }

        return currentInterval;
    }

    // 添加移动端样式
    applyMobileStyles() {
        if (!this.isMobile) return;

        const style = document.createElement('style');
        style.textContent = `
            @media (max-width: 768px) {
                #audioStatus,
                #cameraToggle {
                    width: 50px !important;
                    height: 50px !important;
                    font-size: 28px !important;
                }

                #startButton {
                    bottom: 40px !important;
                    padding: 18px 24px !important;
                    font-size: 22px !important;
                }

                #subtitle {
                    bottom: 110px !important;
                    font-size: 20px !important;
                    padding: 8px 15px !important;
                }

                #loadingStatus {
                    top: 70px !important;
                    max-width: 90% !important;
                    font-size: 15px !important;
                }

                /* 禁用文字选择 */
                body {
                    -webkit-user-select: none;
                    user-select: none;
                    -webkit-touch-callout: none;
                }

                /* 优化触摸高亮 */
                * {
                    -webkit-tap-highlight-color: rgba(0, 0, 0, 0.1);
                }
            }

            /* 横屏优化 */
            @media (max-width: 768px) and (orientation: landscape) {
                #startButton {
                    bottom: 20px !important;
                    padding: 12px 20px !important;
                    font-size: 18px !important;
                }

                #subtitle {
                    bottom: 70px !important;
                    font-size: 18px !important;
                }
            }
        `;

        document.head.appendChild(style);
    }

    // 禁止页面缩放
    preventZoom() {
        // 禁止双击缩放
        let lastTouchEnd = 0;
        document.addEventListener('touchend', (event) => {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) {
                event.preventDefault();
            }
            lastTouchEnd = now;
        }, false);

        // 禁止手势缩放
        document.addEventListener('gesturestart', (e) => {
            e.preventDefault();
        });
    }
}
