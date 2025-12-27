/**
 * 电源管理模块 - 移动端优化
 * 自动检测空闲、页面切换,节省电池
 */

export class PowerSaver {
    constructor(app) {
        this.app = app;
        this.idleTimeout = null;
        this.idleTime = 60000; // 60秒无操作自动暂停
        this.wasProcessing = false;
        this.setupListeners();
    }

    setupListeners() {
        // 监听用户活动
        const events = ['touchstart', 'touchmove', 'click', 'touchend'];
        events.forEach(event => {
            document.addEventListener(event, () => this.resetIdleTimer());
        });

        // 监听页面可见性变化
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.onPageHidden();
            } else {
                this.onPageVisible();
            }
        });

        // 初始化空闲计时器
        this.resetIdleTimer();
    }

    resetIdleTimer() {
        clearTimeout(this.idleTimeout);

        // 只有在处理中才启动空闲检测
        if (this.app.isProcessing) {
            this.idleTimeout = setTimeout(() => {
                this.onIdle();
            }, this.idleTime);
        }
    }

    onIdle() {
        if (this.app.isProcessing) {
            console.log('Auto-paused due to inactivity');
            this.app.stopProcessing();
            this.app.subtitle.textContent = '⏸️ Auto-paused (idle). Tap Start to resume.';
        }
    }

    onPageHidden() {
        // 页面切到后台时自动暂停
        if (this.app.isProcessing) {
            console.log('Page hidden, pausing...');
            this.wasProcessing = true;
            this.app.stopProcessing();
        }
    }

    onPageVisible() {
        // 页面回到前台时提示
        if (this.wasProcessing) {
            console.log('Page visible again');
            this.app.subtitle.textContent = '👋 Welcome back! Tap Start to resume.';
            this.wasProcessing = false;
        }
    }

    destroy() {
        clearTimeout(this.idleTimeout);
    }
}
