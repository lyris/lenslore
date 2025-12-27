/**
 * 网络状态服务 - 单例模式
 * 统一管理网络状态检测和事件分发
 */
export class NetworkService {
    constructor() {
        if (NetworkService.instance) {
            return NetworkService.instance;
        }

        this.listeners = new Map(); // eventType -> Set of callbacks
        this.isOnline = navigator.onLine;

        // 绑定事件处理器
        this.handleOnline = this.handleOnline.bind(this);
        this.handleOffline = this.handleOffline.bind(this);

        // 添加全局监听器
        window.addEventListener('online', this.handleOnline);
        window.addEventListener('offline', this.handleOffline);

        NetworkService.instance = this;
    }

    /**
     * 获取单例实例
     */
    static getInstance() {
        if (!NetworkService.instance) {
            NetworkService.instance = new NetworkService();
        }
        return NetworkService.instance;
    }

    /**
     * 处理在线事件
     */
    handleOnline() {
        this.isOnline = true;
        this.emit('online');
        this.emit('statusChange', true);
    }

    /**
     * 处理离线事件
     */
    handleOffline() {
        this.isOnline = false;
        this.emit('offline');
        this.emit('statusChange', false);
    }

    /**
     * 检查当前网络状态
     */
    checkStatus() {
        return this.isOnline;
    }

    /**
     * 添加事件监听器
     * @param {string} eventType - 'online' | 'offline' | 'statusChange'
     * @param {Function} callback - 回调函数
     */
    on(eventType, callback) {
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, new Set());
        }
        this.listeners.get(eventType).add(callback);
    }

    /**
     * 移除事件监听器
     * @param {string} eventType - 事件类型
     * @param {Function} callback - 回调函数
     */
    off(eventType, callback) {
        if (this.listeners.has(eventType)) {
            this.listeners.get(eventType).delete(callback);
        }
    }

    /**
     * 触发事件
     * @param {string} eventType - 事件类型
     * @param {*} data - 事件数据
     */
    emit(eventType, data) {
        if (this.listeners.has(eventType)) {
            this.listeners.get(eventType).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`[NetworkService] Error in ${eventType} callback:`, error);
                }
            });
        }
    }

    /**
     * 获取网络类型信息
     */
    getConnectionInfo() {
        if ('connection' in navigator) {
            const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            return {
                type: connection.type,
                effectiveType: connection.effectiveType,
                downlink: connection.downlink,
                rtt: connection.rtt,
                saveData: connection.saveData
            };
        }
        return null;
    }

    /**
     * 检查是否是慢速网络
     */
    isSlowConnection() {
        const info = this.getConnectionInfo();
        if (!info) return false;

        // 物理蜂窝网络或开启了省流模式
        if (info.type === 'cellular' || info.saveData) {
            return true;
        }

        // 基于性能的慢速判断
        return info.effectiveType === 'slow-2g' || info.effectiveType === '2g';
    }

    /**
     * 清理资源
     */
    destroy() {
        window.removeEventListener('online', this.handleOnline);
        window.removeEventListener('offline', this.handleOffline);
        this.listeners.clear();
        NetworkService.instance = null;
    }
}
