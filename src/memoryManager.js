/**
 * 内存管理器
 * 检测设备内存并提供优化建议
 */

export class MemoryManager {
    constructor() {
        this.deviceMemory = null;
        this.availableMemory = null;
        this.init();
    }

    init() {
        // 检测设备内存（Chrome/Edge 支持）
        if ('deviceMemory' in navigator) {
            this.deviceMemory = navigator.deviceMemory; // GB
            console.log(`[MemoryManager] Device memory: ${this.deviceMemory}GB`);
        } else {
            console.log('[MemoryManager] Device memory API not supported');
        }

        // 检测可用内存（实验性 API）
        if ('memory' in performance) {
            const memory = performance.memory;
            console.log('[MemoryManager] Memory usage:', {
                used: (memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + 'MB',
                total: (memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + 'MB',
                limit: (memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + 'MB'
            });
        }
    }

    /**
     * 检查是否有足够内存加载模型
     * @param {number} requiredMB - 需要的内存（MB）
     * @returns {object} { sufficient: boolean, reason: string }
     */
    checkMemory(requiredMB) {
        // 如果设备内存小于 2GB，可能不足
        if (this.deviceMemory && this.deviceMemory < 2) {
            return {
                sufficient: false,
                reason: `Low device memory (${this.deviceMemory}GB). Recommend 2GB+ for models.`,
                suggestion: 'Close other apps and tabs to free up memory.'
            };
        }

        // 检查 JS 堆内存
        if ('memory' in performance) {
            const memory = performance.memory;
            const availableMB = (memory.jsHeapSizeLimit - memory.usedJSHeapSize) / 1024 / 1024;

            if (availableMB < requiredMB) {
                return {
                    sufficient: false,
                    reason: `Insufficient memory. Required: ${requiredMB}MB, Available: ${availableMB.toFixed(0)}MB`,
                    suggestion: 'Close other tabs or apps to free up memory.'
                };
            }
        }

        return { sufficient: true };
    }

    /**
     * 获取推荐的模型大小
     * @returns {string} 'full' | 'quantized' | 'minimal'
     */
    getRecommendedModelSize() {
        if (!this.deviceMemory) {
            return 'full'; // 未知设备，使用完整模型
        }

        if (this.deviceMemory >= 4) {
            return 'full'; // 4GB+: 完整模型
        } else if (this.deviceMemory >= 2) {
            return 'quantized'; // 2-4GB: 量化模型
        } else {
            return 'minimal'; // <2GB: 最小模型
        }
    }

    /**
     * 获取设备性能等级
     * @returns {string} 'high' | 'medium' | 'low'
     */
    getPerformanceTier() {
        if (!this.deviceMemory) {
            return 'medium'; // 未知设备
        }

        if (this.deviceMemory >= 4) {
            return 'high';
        } else if (this.deviceMemory >= 2) {
            return 'medium';
        } else {
            return 'low';
        }
    }

    /**
     * 监控内存使用
     */
    monitorMemory() {
        if (!('memory' in performance)) {
            return null;
        }

        const memory = performance.memory;
        const usedMB = memory.usedJSHeapSize / 1024 / 1024;
        const totalMB = memory.totalJSHeapSize / 1024 / 1024;
        const limitMB = memory.jsHeapSizeLimit / 1024 / 1024;
        const usagePercent = (usedMB / limitMB) * 100;

        return {
            usedMB: usedMB.toFixed(2),
            totalMB: totalMB.toFixed(2),
            limitMB: limitMB.toFixed(2),
            usagePercent: usagePercent.toFixed(1)
        };
    }

    /**
     * 清理内存（提示浏览器进行 GC）
     */
    async requestGC() {
        // 尝试触发垃圾回收（仅在开发模式下有效）
        if (window.gc) {
            console.log('[MemoryManager] Requesting garbage collection...');
            window.gc();
        }

        // 清理一些可能的大对象引用
        if ('caches' in window) {
            // 不删除缓存，只是让浏览器知道我们需要内存
            console.log('[MemoryManager] Notifying browser of memory pressure');
        }
    }

    /**
     * 显示内存警告
     */
    showMemoryWarning(message, suggestion) {
        return {
            title: '⚠️ Memory Warning',
            message: message,
            suggestion: suggestion,
            actions: [
                { label: 'Close Other Tabs', action: 'close_tabs' },
                { label: 'Try Anyway', action: 'continue' },
                { label: 'Cancel', action: 'cancel' }
            ]
        };
    }

    /**
     * 获取优化建议
     */
    getOptimizationSuggestions() {
        const tier = this.getPerformanceTier();
        const suggestions = [];

        if (tier === 'low') {
            suggestions.push({
                title: 'Low Memory Device',
                tips: [
                    'Close other browser tabs',
                    'Close other apps running on your device',
                    'Consider using a device with more RAM',
                    'Try a lighter model if available'
                ]
            });
        } else if (tier === 'medium') {
            suggestions.push({
                title: 'Medium Memory Device',
                tips: [
                    'Close unnecessary tabs for better performance',
                    'Models will work but may be slower',
                    'Consider upgrading to a device with 4GB+ RAM for better experience'
                ]
            });
        }

        return suggestions;
    }
}
