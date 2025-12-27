import { ModelImporter } from './modelImporter.js';
import { ImageAnalyzer } from './imageAnalyzer.js';
import { TextToSpeech } from './textToSpeechLite.js'; // 使用精简版 (无中文依赖)
import { CameraManager } from './cameraManager.js';
import { config } from './config.js';
import { MobileOptimizer } from './mobileOptimizer.js';
import { PWAManager } from './pwaManager.js';
import { OfflineHandler } from './offlineHandler.js';
import { MemoryManager } from './memoryManager.js';

class LensLoreApp {
    constructor() {
        this.imageAnalyzer = null;
        this.tts = null;
        this.cameraManager = null;
        this.isProcessing = false;
        this.animationFrameId = null;
        this.lastProcessTime = 0;
        this.intervalMs = config.app.processingInterval;
        this.audioEnabled = true;
        this.currentAudio = null;
        this.isProcessingThisSend = false;

        // 移动端优化
        this.mobileOptimizer = new MobileOptimizer(this);
        this.performanceMonitor = this.mobileOptimizer.createPerformanceMonitor();

        // PWA 管理
        this.pwaManager = new PWAManager();

        // 离线处理
        this.offlineHandler = new OfflineHandler();

        // 内存管理
        this.memoryManager = new MemoryManager();

        this.hasCamera = true;
        this.uploadedImage = null;

        this.initElements();
        this.initEventListeners();
        this.mobileOptimizer.applyMobileStyles();
        this.mobileOptimizer.preventZoom();
        this.init();
    }

    initElements() {
        this.video = document.getElementById('videoFeed');
        this.canvas = document.getElementById('canvas');
        this.subtitle = document.getElementById('subtitle');
        this.startButton = document.getElementById('startButton');
        this.audioStatus = document.getElementById('audioStatus');
        this.cameraToggle = document.getElementById('cameraToggle');
        this.uploadButton = document.getElementById('uploadButton');
        this.mirrorToggle = document.getElementById('mirrorToggle');
        this.deviceToggle = document.getElementById('deviceToggle');
        this.imageUpload = document.getElementById('imageUpload');
        this.loadingStatus = document.getElementById('loadingStatus');
        this.loadingText = document.getElementById('loadingText');
        this.loadingStage = document.getElementById('loadingStage');
        this.progressContainer = document.getElementById('progressContainer');
        this.bottomControls = document.getElementById('bottomControls');
        this.overallProgressFill = document.getElementById('overallProgressFill');

        // 多进度条管理
        this.progressBars = new Map(); // fileName -> { element, lastUpdate }

        // 设置 PWA 安装按钮
        const menuInstall = document.getElementById('menuInstall');
        if (menuInstall) {
            this.pwaManager.setInstallButton(menuInstall);
        }
    }

    initEventListeners() {
        this.startButton.addEventListener('click', () => this.toggleProcessing());
        this.audioStatus.addEventListener('click', () => this.toggleAudio());
        this.cameraToggle.addEventListener('click', () => this.switchCamera());
        this.uploadButton.addEventListener('click', () => this.imageUpload.click());
        // Mirror and device toggles are now in settings panel
        // this.mirrorToggle.addEventListener('click', () => this.toggleMirror());
        // this.deviceToggle.addEventListener('click', () => this.toggleDevice());
        this.imageUpload.addEventListener('change', (e) => this.handleImageUpload(e));

        // 初始化按钮状态 (no longer needed for hidden buttons)
        // this.updateMirrorButton();
        // this.updateDeviceButton();
    }

    async init() {
        try {
            console.log('[App] Starting initialization...');

            // 从 localStorage 恢复用户偏好
            this.restoreUserPreferences();

            // 检查内存 - 添加 try-catch 防止卡死
            try {
                const memoryCheck = this.memoryManager.checkMemory(300); // 需要至少 300MB
                if (!memoryCheck.sufficient) {
                    console.warn('[App] Memory warning:', memoryCheck.reason);
                    this.subtitle.textContent = `⚠️ ${memoryCheck.reason}`;

                    // 显示内存警告但允许继续
                    const continueAnyway = await Promise.race([
                        this.showMemoryWarning(memoryCheck),
                        new Promise(resolve => setTimeout(() => {
                            console.warn('[App] Memory warning timed out at Promise.race level');
                            resolve(true);
                        }, 15000))
                    ]);

                    if (!continueAnyway) {
                        this.startButton.textContent = 'Retry';
                        this.startButton.disabled = false;
                        return;
                    }
                }
            } catch (memError) {
                console.error('[App] Memory check error, continuing anyway:', memError);
                // 继续执行
            }

            // 检查网络和首次使用提示 - 添加超时保护
            if (this.mobileOptimizer.needsCoreModelsPrompt()) {
                try {
                    const shouldContinue = await Promise.race([
                        this.mobileOptimizer.checkNetworkAndWarn(),
                        new Promise(resolve => setTimeout(() => {
                            console.warn('[App] Network warning timed out, continuing');
                            resolve(true);
                        }, 15000))
                    ]);

                    if (!shouldContinue) {
                        this.subtitle.textContent = '⏸️ Waiting for WiFi connection...';
                        this.startButton.textContent = 'Retry';
                        this.startButton.disabled = false;
                        this.startButton.onclick = () => {
                            this.startButton.disabled = true;
                            this.init();
                        };
                        return;
                    }
                } catch (netError) {
                    console.error('[App] Network check error, continuing anyway:', netError);
                    // 继续执行
                }
            }

            // Initialize models first (don't block on camera)
            const isFirstTime = this.mobileOptimizer.needsCoreModelsPrompt();

            // 打印镜像状态
            console.log(`[App] HuggingFace Mirror: ${config.mirror.enabled ? 'ENABLED' : 'DISABLED'}`);
            if (config.mirror.enabled && config.mirror.url) {
                console.log(`[App] Mirror URL: ${config.mirror.url}`);
            }

            this.showLoading('Loading vision model', 0, 'Step 1/1');

            // 添加 try-catch 捕获内存分配错误
            try {
                this.imageAnalyzer = new ImageAnalyzer();
                await this.imageAnalyzer.init((progressInfo) => {
                    // 处理新的进度信息格式
                    let overallProgressText = '';
                    let detailText = '';

                    if (typeof progressInfo === 'object' && progressInfo.progress) {
                        const dtype = progressInfo.dtype.toUpperCase();
                        const device = progressInfo.device === 'webgpu' ? 'WebGPU' : 'WASM';
                        const currentAttempt = progressInfo.currentAttempt || 1;
                        const totalAttempts = progressInfo.totalAttempts || 1;

                        // 计算整体进度（确保只增不减）
                        let overallProgress = 0;
                        if (progressInfo.stage === 'attempt' || progressInfo.stage === 'fallback') {
                            // 尝试开始或降级：显示该尝试的起始位置
                            overallProgress = Math.floor(((currentAttempt - 1) / totalAttempts) * 100);
                        } else if (progressInfo.stage === 'processor' || progressInfo.stage === 'model') {
                            // 正常下载：Processor 和 Model 各占该尝试的一半
                            const progressMatch = progressInfo.progress.match(/(\d+)/);
                            const currentProgress = progressMatch ? parseInt(progressMatch[1]) : 0;

                            // 计算该尝试的总区间
                            const attemptStart = ((currentAttempt - 1) / totalAttempts) * 100;
                            const attemptEnd = (currentAttempt / totalAttempts) * 100;
                            const attemptRange = attemptEnd - attemptStart;

                            // Processor 占前 50%，Model 占后 50%
                            if (progressInfo.stage === 'processor') {
                                overallProgress = Math.floor(attemptStart + (currentProgress / 100) * (attemptRange * 0.5));
                            } else { // model
                                overallProgress = Math.floor(attemptStart + (attemptRange * 0.5) + (currentProgress / 100) * (attemptRange * 0.5));
                            }
                        }
                        overallProgressText = `${overallProgress}%`;

                        // 尝试信息
                        const attemptInfo = totalAttempts > 1
                            ? ` [Attempt ${currentAttempt}/${totalAttempts}]`
                            : '';

                        // 处理不同阶段
                        if (progressInfo.stage === 'attempt') {
                            detailText = `${progressInfo.attemptInfo}${attemptInfo}`;
                            // 不显示详细文件进度
                        } else if (progressInfo.stage === 'fallback') {
                            if (progressInfo.isDowngrade) {
                                detailText = `⚠️ ${progressInfo.attemptInfo}`;
                            } else {
                                detailText = progressInfo.attemptInfo;
                            }
                            // 不显示详细文件进度
                        } else if (progressInfo.stage === 'processor' || progressInfo.stage === 'model') {
                            // 正常加载进度（processor 或 model）
                            const stage = progressInfo.stage === 'processor' ? 'Processor' : 'Model';
                            detailText = `${stage} [${dtype}/${device}]${attemptInfo}`;

                            // 更新多进度条
                            if (progressInfo.fileName && progressInfo.fileName !== 'unknown') {
                                this.updateFileProgress(
                                    progressInfo.fileName,
                                    progressInfo.progress,
                                    progressInfo.stage,
                                    progressInfo.sizeInfo
                                );
                            }
                        }
                    } else {
                        // 兼容旧格式
                        overallProgressText = progressInfo.status || progressInfo.progress || progressInfo;
                        detailText = 'Step 1/1';
                    }

                    this.showLoading('Loading vision model', overallProgressText, detailText);
                });
            } catch (visionError) {
                console.error('[App] Vision model loading failed:', visionError);

                // 检查是否是内存错误
                if (visionError.message && visionError.message.includes('allocation')) {
                    throw new Error('Out of memory. Please close other apps and tabs, then try again.');
                }
                throw visionError;
            }

            // TTS 延迟加载 - 在后台加载，不阻塞主流程
            if (config.app.lazyLoadTTS) {
                console.log('[App] TTS will be loaded in background');
                // 不等待 TTS 加载，继续初始化
                this.loadTTSInBackground(isFirstTime);
            } else {
                // 立即加载 TTS
                this.showLoading('Loading speech model', 0, 'Step 2/2');
                this.tts = new TextToSpeech();
                await this.tts.init((progressInfo) => {
                    // 处理新的进度信息格式
                    let overallProgressText = '';
                    let detailText = '';

                    if (typeof progressInfo === 'object' && progressInfo.progress) {
                        const dtype = progressInfo.dtype.toUpperCase();
                        const device = progressInfo.device === 'webgpu' ? 'WebGPU' : 'WASM';
                        const currentAttempt = progressInfo.currentAttempt || 1;
                        const totalAttempts = progressInfo.totalAttempts || 1;

                        // 计算整体进度（跨所有尝试的0-100%）
                        let overallProgress = 0;
                        if (progressInfo.stage === 'attempt' || progressInfo.stage === 'fallback') {
                            // 尝试开始或降级：显示当前尝试的起始百分比
                            overallProgress = Math.floor(((currentAttempt - 1) / totalAttempts) * 100);
                        } else {
                            // 正常下载进度：将当前进度映射到该尝试的区间
                            const progressMatch = progressInfo.progress.match(/(\d+)/);
                            const currentProgress = progressMatch ? parseInt(progressMatch[1]) : 0;

                            // 计算该尝试的进度区间
                            const attemptStart = ((currentAttempt - 1) / totalAttempts) * 100;
                            const attemptEnd = (currentAttempt / totalAttempts) * 100;

                            // 将当前进度映射到该区间
                            overallProgress = Math.floor(attemptStart + (currentProgress / 100) * (attemptEnd - attemptStart));
                        }
                        overallProgressText = `${overallProgress}%`;

                        // 尝试信息
                        const attemptInfo = currentAttempt && totalAttempts > 1
                            ? ` [Attempt ${currentAttempt}/${totalAttempts}]`
                            : '';

                        // 处理不同阶段
                        if (progressInfo.stage === 'attempt') {
                            detailText = `${progressInfo.attemptInfo}${attemptInfo}`;
                        } else if (progressInfo.stage === 'fallback') {
                            if (progressInfo.isDowngrade) {
                                detailText = `⚠️ ${progressInfo.attemptInfo}`;
                            } else {
                                detailText = progressInfo.attemptInfo;
                            }
                        } else if (progressInfo.stage === 'tts') {
                            // 显示详细信息
                            detailText = `TTS Model [${dtype}/${device}]${attemptInfo}`;

                            // 更新多进度条
                            if (progressInfo.fileName && progressInfo.fileName !== 'unknown') {
                                this.updateFileProgress(
                                    progressInfo.fileName,
                                    progressInfo.progress,
                                    'tts',
                                    progressInfo.sizeInfo
                                );
                            }
                        }
                    } else {
                        // 兼容旧格式
                        overallProgressText = progressInfo.status || progressInfo.progress || progressInfo;
                        const ttsHint = isFirstTime ? ' (Downloading)' : ' (From cache)';
                        detailText = `Step 2/2${ttsHint}`;
                    }

                    this.showLoading('Loading speech model', overallProgressText, detailText);
                });

                // 标记 TTS 模型已缓存
                this.mobileOptimizer.markModelsCached('tts');
            }

            // 标记视觉模型已缓存
            this.mobileOptimizer.markModelsCached('vision');

            // 请求持久化存储（防止浏览器清理缓存）
            await this.pwaManager.requestPersistentStorage();

            // Initialize camera after models (non-blocking)
            this.showLoading('Initializing camera...', 100, 'Getting camera access...');
            try {
                this.cameraManager = new CameraManager(this.video);
                await this.cameraManager.init();

                // 更新底部控制栏和菜单中的相机切换按钮
                const menuCamera = document.getElementById('menuCamera');
                if (this.cameraManager.hasMultipleCameras()) {
                    this.cameraToggle.style.display = 'flex';
                    if (menuCamera) menuCamera.style.display = 'flex';
                } else {
                    this.cameraToggle.style.display = 'none';
                    if (menuCamera) menuCamera.style.display = 'none';
                }

                // 有摄像头时，字幕和控制栏显示在底部
                this.subtitle.classList.add('bottom-position');
                this.bottomControls.classList.add('bottom-position');

                this.hideLoading();
                this.subtitle.textContent = 'Ready! Click Start to begin.';
            } catch (cameraError) {
                console.warn('Camera initialization failed:', cameraError);
                this.hasCamera = false;
                this.hideLoading();
                this.subtitle.innerHTML = `
                    <div style="margin-bottom: 8px;">No camera.</div>
                    <div>Click <span class="clickable-icon" id="uploadIconInText">📁</span> to upload image.</div>
                `;
                // 为文字中的上传图标添加点击事件
                document.getElementById('uploadIconInText').addEventListener('click', () => {
                    this.imageUpload.click();
                });
                // 隐藏所有底部控制按钮（因为已经在文字中提供了上传功能）
                this.cameraToggle.style.display = 'none';
                this.uploadButton.style.display = 'none';
                this.audioStatus.style.display = 'none';

                // 隐藏菜单中的相机切换按钮
                const menuCamera = document.getElementById('menuCamera');
                if (menuCamera) menuCamera.style.display = 'none';
            }

            this.startButton.textContent = 'Start';
            this.startButton.disabled = false;
        } catch (error) {
            console.error('Initialization error:', error);
            this.subtitle.textContent = `Error: ${error.message}`;
            this.hideLoading();
        }
    }


    /**
     * 显示内存警告
     */
    async showMemoryWarning(memoryCheck) {
        return new Promise((resolve) => {
            let warningDiv = null;
            let timeout = null;

            try {
                warningDiv = document.createElement('div');

                // 添加超时保护：10秒后自动继续
                timeout = setTimeout(() => {
                    console.warn('[App] Memory warning dialog timeout, auto-continuing');
                    if (warningDiv && document.body.contains(warningDiv)) {
                        warningDiv.remove();
                    }
                    resolve(true); // 超时默认继续
                }, 10000);
                warningDiv.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: rgba(0, 0, 0, 0.95);
                    color: white;
                    padding: 25px;
                    border-radius: 12px;
                    z-index: 999999;
                    max-width: 90vw;
                    width: 400px;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                    pointer-events: auto;
                `;

                warningDiv.innerHTML = `
                    <div style="text-align: center;">
                        <div style="font-size: 48px; margin-bottom: 15px;">⚠️</div>
                        <h3 style="margin: 0 0 15px 0; color: #ffa500;">Low Memory Warning</h3>
                        <p style="margin: 10px 0; line-height: 1.6; font-size: 14px;">
                            ${memoryCheck.reason || 'Low memory detected'}
                        </p>
                        <p style="margin: 10px 0; line-height: 1.6; font-size: 13px; color: #ccc;">
                            ${memoryCheck.suggestion || 'Consider closing other tabs or apps'}
                        </p>
                        <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: center;">
                            <button id="memory-cancel" style="
                                padding: 10px 20px;
                                border: 1px solid #666;
                                background: transparent;
                                color: white;
                                border-radius: 6px;
                                cursor: pointer;
                                font-size: 14px;
                            ">Cancel</button>
                            <button id="memory-continue" style="
                                padding: 10px 20px;
                                border: none;
                                background: #ffa500;
                                color: white;
                                border-radius: 6px;
                                cursor: pointer;
                                font-weight: bold;
                                font-size: 14px;
                            ">Try Anyway</button>
                        </div>
                    </div>
                `;

                document.body.appendChild(warningDiv);

                // 使用 setTimeout 确保 DOM 已更新
                setTimeout(() => {
                    const continueBtn = document.getElementById('memory-continue');
                    const cancelBtn = document.getElementById('memory-cancel');

                    if (continueBtn) {
                        continueBtn.onclick = () => {
                            clearTimeout(timeout);
                            if (document.body.contains(warningDiv)) {
                                warningDiv.remove();
                            }
                            resolve(true);
                        };
                    }

                    if (cancelBtn) {
                        cancelBtn.onclick = () => {
                            clearTimeout(timeout);
                            if (document.body.contains(warningDiv)) {
                                warningDiv.remove();
                            }
                            resolve(false);
                        };
                    }

                    // 如果按钮未找到，自动继续
                    if (!continueBtn || !cancelBtn) {
                        console.error('[App] Memory warning buttons not found, auto-continuing');
                        clearTimeout(timeout);
                        if (document.body.contains(warningDiv)) {
                            warningDiv.remove();
                        }
                        resolve(true);
                    }
                }, 100);
            } catch (error) {
                console.error('[App] Error showing memory warning:', error);
                resolve(true); // 出错时默认继续
            }
        });
    }

    /**
     * 后台加载 TTS 模型
     */
    async loadTTSInBackground(isFirstTime) {
        console.log('[App] Loading TTS in background');

        try {
            this.tts = new TextToSpeech();
            await this.tts.init((progressInfo) => {
                // 处理新的进度信息格式
                if (typeof progressInfo === 'object' && progressInfo.progress) {
                    const dtype = progressInfo.dtype.toUpperCase();
                    const device = progressInfo.device === 'webgpu' ? 'WebGPU' : 'WASM';
                    const hint = isFirstTime ? '(downloading)' : '(cached)';

                    // 显示尝试和降级信息
                    if (progressInfo.stage === 'attempt') {
                        console.log(`[App] TTS ${progressInfo.attemptInfo}`);
                    } else if (progressInfo.stage === 'fallback') {
                        console.warn(`[App] TTS ${progressInfo.attemptInfo}`);
                    } else {
                        const attemptInfo = progressInfo.currentAttempt && progressInfo.totalAttempts > 1
                            ? ` [${progressInfo.currentAttempt}/${progressInfo.totalAttempts}]`
                            : '';
                        console.log(`[App] TTS loading [${dtype}/${device}]${attemptInfo}: ${progressInfo.progress} ${hint}`);
                    }
                } else {
                    const progressText = progressInfo.status || progressInfo.progress || progressInfo;
                    console.log(`[App] TTS loading: ${progressText}`);
                }
            });
            console.log('[App] TTS loaded successfully in background');

            // 标记 TTS 模型已缓存
            this.mobileOptimizer.markModelsCached('tts');

            // 显示提示（可选）
            if (this.pwaManager) {
                this.pwaManager.showNotification('🔊 Voice ready!', 2000);
            }
        } catch (error) {
            console.error('[App] Failed to load TTS in background:', error);

            // 检查是否是内存错误
            if (error.message && error.message.includes('allocation')) {
                console.warn('[App] TTS loading failed due to memory. Audio will be disabled.');
                if (this.pwaManager) {
                    this.pwaManager.showNotification('⚠️ Voice disabled (low memory)', 3000);
                }
            }
            // 静默失败，不影响主流程
        }
    }

    handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                this.uploadedImage = img;
                this.canvas.width = img.width;
                this.canvas.height = img.height;
                const context = this.canvas.getContext('2d');
                context.drawImage(img, 0, 0);

                // 在video元素上显示图片
                this.video.style.objectFit = 'contain';
                this.video.poster = e.target.result;

                this.subtitle.textContent = '📷 Image uploaded! Click Start to analyze.';

                // 停止之前的音频播放
                if (this.currentAudio) {
                    try {
                        if (typeof this.currentAudio.stop === 'function') {
                            this.currentAudio.stop();
                        }
                    } catch (e) {
                        console.log('[Debug] Failed to stop previous audio:', e);
                    }
                    this.currentAudio = null;
                }

                // 震动反馈
                this.mobileOptimizer.vibrate(50);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);

        // 清空 input 的 value，允许重复上传同一个文件
        event.target.value = '';
    }

    showLoading(text, _progress = null, details = '') {
        this.loadingStatus.style.display = 'block';
        this.loadingText.textContent = text;

        // 只显示阶段信息，不显示百分比
        if (details) {
            this.loadingStage.textContent = details;
        }
    }

    hideLoading() {
        this.loadingStatus.style.display = 'none';
        // 清空所有进度条
        this.clearAllProgressBars();
    }

    toggleAudio() {
        this.audioEnabled = !this.audioEnabled;

        // 更新底部控制栏按钮图标（开启: 🔊 关闭: 🔇）
        this.audioStatus.textContent = this.audioEnabled ? '🔊' : '🔇';

        // 更新菜单中的图标和文字
        const menuAudio = document.getElementById('menuAudio');
        if (menuAudio) {
            const menuIcon = menuAudio.querySelector('.menu-item-icon');
            const menuText = menuAudio.querySelector('span:last-child');
            if (menuIcon) menuIcon.textContent = this.audioEnabled ? '🔊' : '🔇';
            if (menuText) menuText.textContent = this.audioEnabled ? 'Disable Audio' : 'Enable Audio';
        }

        // 动画效果
        this.audioStatus.style.transform = 'scale(1.2)';
        setTimeout(() => {
            this.audioStatus.style.transform = 'scale(1)';
        }, 300);

        // 震动反馈
        this.mobileOptimizer.vibrate(30);

        if (!this.audioEnabled && this.currentAudio) {
            // 支持新的控制器对象和旧的 Audio 对象
            if (typeof this.currentAudio.stop === 'function') {
                this.currentAudio.stop();
            } else if (typeof this.currentAudio.pause === 'function') {
                this.currentAudio.pause();
            }
            // 清除当前音频引用
            this.currentAudio = null;
        }
    }

    toggleMirror() {
        config.mirror.enabled = !config.mirror.enabled;

        // 保存到 localStorage
        try {
            localStorage.setItem('lenslore_mirror_enabled', config.mirror.enabled ? 'true' : 'false');
        } catch (e) {
            console.warn('[Mirror] Failed to save preference:', e);
        }

        this.updateMirrorButton();

        // 震动反馈
        this.mobileOptimizer.vibrate(30);

        // 提示用户需要重新加载
        const status = config.mirror.enabled ? 'enabled' : 'disabled';
        const message = config.mirror.enabled
            ? '🌐 Mirror enabled. Please reload the page to apply changes.'
            : '🌐 Mirror disabled. Using direct HuggingFace access.';

        console.log(`[Mirror] ${status}`);

        // 显示提示信息
        this.subtitle.textContent = message;
        setTimeout(() => {
            if (this.subtitle.textContent === message) {
                this.subtitle.textContent = '';
            }
        }, 3000);
    }

    updateMirrorButton() {
        if (config.mirror.enabled) {
            this.mirrorToggle.classList.add('enabled');
            this.mirrorToggle.textContent = '●';
            this.mirrorToggle.title = 'HuggingFace mirror: ON (Click to disable)';
        } else {
            this.mirrorToggle.classList.remove('enabled');
            this.mirrorToggle.textContent = '○';
            this.mirrorToggle.title = 'HuggingFace mirror: OFF (Click to enable)';
        }
    }

    toggleDevice() {
        // 循环切换：auto → webgpu → wasm → auto
        const preferences = ['auto', 'webgpu', 'wasm'];
        const currentIndex = preferences.indexOf(config.models.vision.devicePreference);
        const nextIndex = (currentIndex + 1) % preferences.length;
        config.models.vision.devicePreference = preferences[nextIndex];

        // 保存到 localStorage
        try {
            localStorage.setItem('lenslore_device_preference', config.models.vision.devicePreference);
        } catch (e) {
            console.warn('[Device] Failed to save preference:', e);
        }

        this.updateDeviceButton();
        this.mobileOptimizer.vibrate(30);

        const prefName = {
            'auto': 'Auto (WebGPU → WASM)',
            'webgpu': 'WebGPU (GPU only)',
            'wasm': 'WASM (CPU only)'
        }[config.models.vision.devicePreference];

        const message = `⚙ Device: ${prefName}. Please reload models to apply.`;
        console.log(`[Device] ${config.models.vision.devicePreference}`);
        this.subtitle.textContent = message;

        setTimeout(() => {
            if (this.subtitle.textContent === message) {
                this.subtitle.textContent = '';
            }
        }, 3000);
    }

    updateDeviceButton() {
        // 移除所有状态类
        this.deviceToggle.classList.remove('webgpu', 'wasm');

        const pref = config.models.vision.devicePreference;
        if (pref === 'auto') {
            this.deviceToggle.textContent = '⚙';
            this.deviceToggle.title = 'Device: Auto (WebGPU → WASM fallback)';
        } else if (pref === 'webgpu') {
            this.deviceToggle.classList.add('webgpu');
            this.deviceToggle.textContent = '⚡';
            this.deviceToggle.title = 'Device: WebGPU only (GPU accelerated)';
        } else if (pref === 'wasm') {
            this.deviceToggle.classList.add('wasm');
            this.deviceToggle.textContent = '🔧';
            this.deviceToggle.title = 'Device: WASM only (CPU mode)';
        }
    }

    restoreUserPreferences() {
        try {
            // 确保镜像 URL 使用远端域名（不再使用本地 /hf-mirror 代理）
            const defaultMirrorUrl = import.meta.env.VITE_HUGGINGFACE_MIRROR_URL || 'https://hf.bitags.com';
            if (config.mirror.url && config.mirror.url.startsWith('/hf-mirror')) {
                config.mirror.url = defaultMirrorUrl;
                console.warn(`[Preferences] Mirror URL updated to remote host: ${config.mirror.url}`);
            }

            // 恢复镜像偏好
            const savedMirror = localStorage.getItem('lenslore_mirror_enabled');
            if (savedMirror !== null) {
                config.mirror.enabled = savedMirror === 'true';
                console.log(`[Preferences] Restored mirror: ${config.mirror.enabled}`);
            }

            // 恢复设备偏好
            const savedDevice = localStorage.getItem('lenslore_device_preference');
            if (savedDevice !== null && ['auto', 'webgpu', 'wasm'].includes(savedDevice)) {
                config.models.vision.devicePreference = savedDevice;
                console.log(`[Preferences] Restored device: ${config.models.vision.devicePreference}`);
            }

            // 更新UI按钮以反映恢复的状态（只在元素存在时更新）
            if (this.mirrorToggle) {
                this.updateMirrorButton();
            }
            if (this.deviceToggle) {
                this.updateDeviceButton();
            }

            console.log('[Preferences] User preferences restored from localStorage');
        } catch (e) {
            console.warn('[Preferences] Failed to restore preferences:', e);
        }
    }

    // 多进度条管理方法
    updateFileProgress(fileName, progressPercentage, stage, sizeInfo) {
        if (!fileName || fileName === 'unknown') {
            return; // 跳过未知文件
        }

        const fileKey = `${stage}_${fileName}`;
        const now = Date.now();

        // 如果进度条不存在，创建新的
        if (!this.progressBars.has(fileKey)) {
            const progressItem = this.createProgressBar(fileName, stage);
            this.progressContainer.appendChild(progressItem);
            this.progressBars.set(fileKey, {
                element: progressItem,
                lastUpdate: now
            });
        }

        // 更新进度条
        const progressData = this.progressBars.get(fileKey);

        // 检查元素是否存在
        if (!progressData || !progressData.element) {
            console.error('[Progress] Progress data or element missing for:', fileKey);
            return;
        }

        const progressFill = progressData.element.querySelector('.progress-fill');
        const progressPercentageEl = progressData.element.querySelector('.progress-percentage');
        const progressFileName = progressData.element.querySelector('.progress-file-name');

        // 检查子元素是否存在
        if (!progressFill || !progressPercentageEl || !progressFileName) {
            console.error('[Progress] Child elements missing for:', fileKey, {
                fill: !!progressFill,
                percentage: !!progressPercentageEl,
                fileName: !!progressFileName
            });
            return;
        }

        // 更新进度值
        let percentage = parseInt(progressPercentage) || 0;

        // 检测完成状态：transformers.js 可能发送 "done" 或 "ready" 状态
        const isDone = typeof progressPercentage === 'string' &&
                      (progressPercentage.toLowerCase() === 'done' ||
                       progressPercentage.toLowerCase() === 'ready');

        // 检测下载状态：transformers.js 发送 "download" 或 "initiate" 状态
        const isDownloading = typeof progressPercentage === 'string' &&
                             (progressPercentage.toLowerCase() === 'download' ||
                              progressPercentage.toLowerCase() === 'initiate');

        // 检测缓存加载：如果 sizeInfo 显示已完成（loaded === total）但 percentage 是 0
        // 这通常意味着文件从缓存加载，transformers.js 没有触发进度回调
        if (sizeInfo && percentage === 0) {
            const match = sizeInfo.match(/\((\d+\.?\d*)\s*\/\s*(\d+\.?\d*)/);
            if (match) {
                const loaded = parseFloat(match[1]);
                const total = parseFloat(match[2]);
                if (loaded === total && total > 0) {
                    // 文件已完全加载（从缓存），设置为 100%
                    percentage = 100;
                } else if (loaded > 0 && total > 0) {
                    // 根据实际下载大小计算进度
                    percentage = Math.floor((loaded / total) * 100);
                }
            }
        }

        // 如果收到 "done" 或 "ready" 状态，设置为 100%
        if (isDone) {
            percentage = 100;
        }

        // 更新进度条和文字 - 统一显示百分比
        progressFill.style.width = `${percentage}%`;
        progressPercentageEl.textContent = `${percentage}%`;
        // 0% 时保持脉冲动画以指示下载活动
        progressFill.style.animation = (isDownloading && percentage === 0)
            ? 'pulse 1.5s ease-in-out infinite'
            : 'none';

        // 更新文件名和大小信息
        if (sizeInfo) {
            progressFileName.textContent = `📥 ${fileName}${sizeInfo}`;
        }

        // 如果完成，标记为完成状态（但不移除）
        if (percentage >= 100) {
            progressFill.classList.add('complete');
        }

        progressData.lastUpdate = now;
    }

    createProgressBar(fileName, stage) {
        const progressItem = document.createElement('div');
        progressItem.className = 'progress-item';

        const progressLabel = document.createElement('div');
        progressLabel.className = 'progress-label';

        const fileNameSpan = document.createElement('span');
        fileNameSpan.className = 'progress-file-name';
        fileNameSpan.textContent = `📥 ${fileName}`;

        const percentageSpan = document.createElement('span');
        percentageSpan.className = 'progress-percentage';
        percentageSpan.textContent = '0%';

        progressLabel.appendChild(fileNameSpan);
        progressLabel.appendChild(percentageSpan);

        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';

        const progressFill = document.createElement('div');
        progressFill.className = `progress-fill ${stage}`;
        progressFill.style.width = '0%';

        progressBar.appendChild(progressFill);
        progressItem.appendChild(progressLabel);
        progressItem.appendChild(progressBar);

        return progressItem;
    }

    removeProgressBar(fileKey) {
        if (this.progressBars.has(fileKey)) {
            const progressData = this.progressBars.get(fileKey);
            const element = progressData.element;

            // 添加移除动画
            element.classList.add('removing');

            // 动画完成后移除元素
            setTimeout(() => {
                if (element.parentNode) {
                    element.parentNode.removeChild(element);
                }
                this.progressBars.delete(fileKey);
            }, 300);
        }
    }

    clearAllProgressBars() {
        // 清空所有进度条
        for (const [fileKey] of this.progressBars) {
            this.removeProgressBar(fileKey);
        }
    }

    async switchCamera() {
        if (!this.cameraManager || !this.cameraManager.hasMultipleCameras()) return;

        // 震动反馈
        this.mobileOptimizer.vibrate(50);

        await this.cameraManager.toggleCamera();

        // Restart processing if active
        if (this.isProcessing) {
            this.stopProcessing();
            setTimeout(() => this.startProcessing(), 100);
        }
    }

    toggleProcessing() {
        // 震动反馈
        this.mobileOptimizer.vibrate(50);

        if (this.isProcessing) {
            this.stopProcessing();
        } else {
            this.startProcessing();
        }
    }

    async startProcessing() {
        this.isProcessing = true;
        this.startButton.textContent = 'Stop';
        this.startButton.classList.remove('start');
        this.startButton.classList.add('stop');
        this.subtitle.textContent = 'Processing started...';

        // 请求屏幕保持唤醒
        await this.mobileOptimizer.requestWakeLock();

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // 如果是上传的图片,只处理一次
        if (this.uploadedImage) {
            if (!this.isProcessingThisSend) {
                this.processFrame();
            }
            return;
        }

        // 使用 requestAnimationFrame 替代 setInterval
        const loop = (timestamp) => {
            if (!this.isProcessing) return;

            // 检查是否达到时间间隔
            // 如果是第一次运行 (lastProcessTime=0) 或者间隔已过
            if (!this.lastProcessTime || timestamp - this.lastProcessTime >= this.intervalMs) {
                if (!this.isProcessingThisSend) {
                    this.processFrame();
                    this.lastProcessTime = timestamp;
                }
            }

            // 继续下一帧
            this.animationFrameId = requestAnimationFrame(loop);
        };

        // 启动循环
        this.lastProcessTime = 0;
        this.animationFrameId = requestAnimationFrame(loop);
    }

    stopProcessing() {
        this.isProcessing = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.startButton.textContent = 'Start';
        this.startButton.classList.remove('stop');
        this.startButton.classList.add('start');

        if (this.currentAudio) {
            this.currentAudio.pause();
        }

        // 释放屏幕唤醒锁
        this.mobileOptimizer.releaseWakeLock();

        this.subtitle.textContent = 'Processing stopped.';
    }

    cleanMarkdown(text) {
        // 移除 Markdown 格式标识，保留纯文本
        return text
            // 移除代码块标记
            .replace(/```[\s\S]*?```/g, '')
            .replace(/`[^`]*`/g, '')
            // 移除标题标记
            .replace(/^#{1,6}\s+/gm, '')
            // 移除加粗和斜体标记
            .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
            .replace(/\*\*(.+?)\*\*/g, '$1')
            .replace(/\*(.+?)\*/g, '$1')
            .replace(/___(.+?)___/g, '$1')
            .replace(/__(.+?)__/g, '$1')
            .replace(/_(.+?)_/g, '$1')
            // 移除列表标记
            .replace(/^\s*[-*+]\s+/gm, '')
            .replace(/^\s*\d+\.\s+/gm, '')
            // 移除链接格式 [text](url) -> text
            .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
            // 移除图片标记
            .replace(/!\[([^\]]*)\]\([^\)]+\)/g, '$1')
            // 移除引用标记
            .replace(/^>\s+/gm, '')
            // 移除水平分割线
            .replace(/^[\s-*_]{3,}$/gm, '')
            // 压缩多个空行为一个
            .replace(/\n{3,}/g, '\n\n')
            // 清理首尾空白
            .trim();
    }

    updateSubtitleWithHighlight(segments, currentIndex) {
        // 清空字幕内容
        this.subtitle.innerHTML = '';

        // 创建容器用于包裹所有片段
        const container = document.createElement('div');
        container.style.cssText = 'max-width: 100%; word-wrap: break-word;';

        // 智能显示策略：只显示相关的片段，避免内容过多
        // 显示：已完成的最后1句 + 当前句 + 未来的2句
        const showPrevious = 1;
        const showNext = 2;
        const startIndex = Math.max(0, currentIndex - showPrevious);
        const endIndex = Math.min(segments.length, currentIndex + showNext + 1);

        // 如果有被省略的前面内容，显示省略号
        if (startIndex > 0) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '... ';
            ellipsis.className = 'segment completed';
            ellipsis.style.opacity = '0.5';
            container.appendChild(ellipsis);
        }

        // 为每个片段创建 span 元素
        for (let index = startIndex; index < endIndex; index++) {
            const segment = segments[index];
            const span = document.createElement('span');
            span.textContent = segment;
            span.className = 'segment';

            // 当前正在朗读的片段放大显示
            if (index === currentIndex) {
                span.classList.add('current');
            } else if (index < currentIndex) {
                // 已播放的片段
                span.classList.add('completed');
            }

            container.appendChild(span);

            // 片段之间添加空格
            if (index < endIndex - 1) {
                container.appendChild(document.createTextNode(' '));
            }
        }

        // 如果有被省略的后面内容，显示省略号
        if (endIndex < segments.length) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = ' ...';
            ellipsis.className = 'segment';
            ellipsis.style.opacity = '0.5';
            container.appendChild(ellipsis);
        }

        this.subtitle.appendChild(container);

        // 不需要滚动，因为我们只显示相关片段
    }

    stopSubtitleAnimation() {
        // 移除所有字幕片段的动画类，保留纯文本内容
        console.log('[App] Stopping subtitle animation');
        const segments = this.subtitle.querySelectorAll('.segment');
        console.log('[App] Found', segments.length, 'subtitle segments');
        segments.forEach(segment => {
            // 先移除 current 类，停止动画
            segment.classList.remove('current');
            // 强制浏览器重新计算样式（触发 reflow）
            void segment.offsetHeight;
            // 再标记为已完成
            if (!segment.classList.contains('completed')) {
                segment.classList.add('completed');
            }
        });
    }

    captureImage() {
        // 如果有上传的图片,使用上传的图片
        if (this.uploadedImage) {
            return this.canvas;
        }

        // 否则从摄像头捕获
        if (!this.video.videoWidth || this.video.readyState < this.video.HAVE_METADATA) {
            console.warn('Video stream not ready for capture');
            return null;
        }

        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        const context = this.canvas.getContext('2d');
        context.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

        return this.canvas;
    }

    async processFrame() {
        // 性能监控
        if (!this.uploadedImage) {
            const fps = this.performanceMonitor.update();
            if (fps !== null) {
                // 自动调整处理间隔
                const newInterval = this.mobileOptimizer.autoAdjustInterval(
                    this.performanceMonitor,
                    this.intervalMs
                );

                if (newInterval !== this.intervalMs) {
                    this.intervalMs = newInterval;
                    // rAF 循环会自动使用新的间隔，无需重启
                }
            }
        }

        if (!this.isProcessing) return;

        // 如果音频正在播放,跳过本次处理(避免打断)
        if (this.audioEnabled && this.currentAudio) {
            try {
                if (!this.currentAudio.paused) {
                    return;
                }
            } catch (e) {
                // 控制器对象可能还未完全初始化,继续处理
                console.log('[Debug] Audio controller not ready yet');
            }
        }

        this.isProcessingThisSend = true;

        try {
            const canvas = this.captureImage();
            if (!canvas) {
                this.subtitle.textContent = 'Failed to capture image';
                this.isProcessingThisSend = false;
                return;
            }

            // 从配置中获取提示词
            const promptKey = config.models.vision.currentPrompt;
            const prompt = config.models.vision.prompts[promptKey] || config.models.vision.prompts.default;

            // ⏱️ ITT 开始
            const ittStartTime = performance.now();
            const response = await this.imageAnalyzer.analyze(canvas, prompt);
            const ittEndTime = performance.now();
            const ittDuration = (ittEndTime - ittStartTime).toFixed(0);

            // 在控制台输出 ITT 结果和耗时
            console.warn(`[⏱️ ITT] Completed in ${ittDuration}ms`);
            console.warn('[ITT Result]', response);

            if (!this.isProcessing) {
                this.isProcessingThisSend = false;
                return;
            }

            // 清理 Markdown 格式，获取纯文本
            const fullText = this.cleanMarkdown(response);
            this.subtitle.textContent = fullText;

            // TTS 朗读 (不等待完成,立即返回控制器)
            if (this.audioEnabled) {
                // 检查 TTS 是否已加载并准备好
                console.warn(`[⏱️ TTS Check] TTS exists: ${!!this.tts}, TTS ready: ${this.tts ? this.tts.isReady() : 'N/A'}`);
                if (!this.tts || !this.tts.isReady()) {
                    console.warn('[TTS] Not ready yet, skipping speech');
                    this.subtitle.textContent = fullText + ' (Voice loading...)';
                } else {
                    // ⏱️ TTS 开始计时
                    const ttsStartTime = performance.now();
                    console.warn(`[⏱️ TTS] Starting speech generation (text length: ${fullText.length} chars)`);

                    // 停止之前的音频(如果有)
                    if (this.currentAudio) {
                        try {
                            if (typeof this.currentAudio.stop === 'function') {
                                this.currentAudio.stop();
                            } else if (typeof this.currentAudio.pause === 'function') {
                                this.currentAudio.pause();
                            }
                        } catch (e) {
                            console.log('[Debug] Failed to stop previous audio:', e);
                        }
                    }

                    try {
                        // 不使用 await,让 TTS 在后台运行
                        this.tts.speak(fullText, null, {
                            onSegmentStart: (index, _currentSegment, allSegments) => {
                                // 当有多个片段时，高亮当前正在朗读的片段
                                this.updateSubtitleWithHighlight(allSegments, index);
                            }
                        }).then(controller => {
                            this.currentAudio = controller;
                            const ttsEndTime = performance.now();
                            const ttsDuration = (ttsEndTime - ttsStartTime).toFixed(0);
                            console.warn(`[⏱️ TTS] Speech controller created in ${ttsDuration}ms`);

                            // 如果是上传的图片，在这里添加 ended 监听器
                            if (this.uploadedImage) {
                                controller.addEventListener('ended', () => {
                                    console.log('[App] TTS ended for uploaded image');
                                    this.mobileOptimizer.releaseWakeLock();
                                    this.stopSubtitleAnimation();
                                    this.subtitle.innerHTML = `
                                        <div style="margin-bottom: 8px;">No camera.</div>
                                        <div>Click <span class="clickable-icon" id="uploadIconInText">📁</span> to upload image.</div>
                                    `;
                                    const uploadIcon = document.getElementById('uploadIconInText');
                                    if (uploadIcon) {
                                        uploadIcon.addEventListener('click', () => {
                                            this.imageUpload.click();
                                        });
                                    }
                                });
                            }
                        }).catch(ttsError => {
                            const ttsEndTime = performance.now();
                            const ttsDuration = (ttsEndTime - ttsStartTime).toFixed(0);
                            console.error(`[⏱️ TTS] Error after ${ttsDuration}ms:`, ttsError);
                            
                            // 如果出错且是上传图片模式，确保释放资源
                            if (this.uploadedImage) {
                                this.mobileOptimizer.releaseWakeLock();
                            }
                        });
                    } catch (ttsError) {
                        const ttsEndTime = performance.now();
                        const ttsDuration = (ttsEndTime - ttsStartTime).toFixed(0);
                        console.error(`[⏱️ TTS] Error starting speech after ${ttsDuration}ms:`, ttsError);
                    }
                }
            } else {
                console.log('[TTS] Audio is disabled');
            }

            // 如果是上传的图片,处理完后自动停止（但保留识别结果的显示）
            if (this.uploadedImage) {
                // 停止处理循环
                this.isProcessing = false;
                if (this.animationFrameId) {
                    cancelAnimationFrame(this.animationFrameId);
                    this.animationFrameId = null;
                }
                this.startButton.textContent = 'Start';
                this.startButton.classList.remove('stop');
                this.startButton.classList.add('start');

                // 注意：如果启用了音频，wakelock 的释放和字幕重置已经在 tts.speak 的 then 块中处理
                // 如果音频被禁用或 TTS 未运行，立即释放
                if (!this.audioEnabled || !this.tts || !this.tts.isReady()) {
                    this.mobileOptimizer.releaseWakeLock();
                }
            }
        } catch (error) {
            console.error('Error processing frame:', error);
            if (this.isProcessing) {
                this.subtitle.textContent = `Error: ${error.message}`;
            }
        } finally {
            this.isProcessingThisSend = false;
        }
    }
}

// Initialize app when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    const app = new LensLoreApp();

    // 汉堡菜单逻辑
    const menuButton = document.getElementById('menuButton');
    const dropdownMenu = document.getElementById('dropdownMenu');
    const menuSettings = document.getElementById('menuSettings');
    const menuAbout = document.getElementById('menuAbout');

    // 切换菜单显示
    menuButton.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownMenu.classList.toggle('active');
    });

    // 点击页面其他地方关闭菜单
    document.addEventListener('click', () => {
        dropdownMenu.classList.remove('active');
    });

    // 阻止菜单内部点击冒泡
    dropdownMenu.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // 设置面板逻辑
    const settingsPanel = document.getElementById('settingsPanel');
    const settingsClose = document.getElementById('settingsClose');
    const settingsSave = document.getElementById('settingsSave');
    const customPromptTextarea = document.getElementById('customPrompt');
    const promptOptions = document.querySelectorAll('.prompt-option');
    const mirrorToggleInput = document.getElementById('mirrorToggleInput');
    const chunkedToggleInput = document.getElementById('chunkedToggleInput');
    const deviceSelect = document.getElementById('deviceSelect');

    // 模型导入逻辑
    const modelImporter = new ModelImporter();
    const visionStatus = document.getElementById('visionStatus');
    const ttsStatus = document.getElementById('ttsStatus');
    const asrStatus = document.getElementById('asrStatus');
    const visionFilesInput = document.getElementById('visionFiles');
    const ttsFilesInput = document.getElementById('ttsFiles');
    const asrFilesInput = document.getElementById('asrFiles');
    const importVisionBtn = document.getElementById('importVisionBtn');
    const importTTSBtn = document.getElementById('importTTSBtn');
    const importASRBtn = document.getElementById('importASRBtn');

    const updateCacheStatus = async () => {
        if (!visionStatus || !ttsStatus || !asrStatus) return;
        const status = await modelImporter.getCacheStatus();
        
        const setStatus = (el, isCached) => {
            el.textContent = isCached ? '✅ Cached' : '❌ Not Cached';
            el.style.color = isCached ? '#2ecc71' : '#e74c3c';
            el.style.fontWeight = 'bold';
        };

        setStatus(visionStatus, status.vision);
        setStatus(ttsStatus, status.tts);
        setStatus(asrStatus, status.asr);
    };

    const handleImport = async (type, fileInput, btn) => {
        const files = fileInput.files;
        if (files.length === 0) {
            alert('Please select files first!');
            return;
        }

        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Importing...';

        try {
            const count = await modelImporter.importFiles(type, files, (current, total, filename) => {
                btn.textContent = `${current}/${total}`;
            });
            
            alert(`Successfully imported ${count} files! Please reload the page to use the models.`);
            updateCacheStatus();
            fileInput.value = ''; // Clear input
        } catch (error) {
            alert(`Import failed: ${error.message}`);
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    };

    if (importVisionBtn) {
        importVisionBtn.addEventListener('click', () => handleImport('vision', visionFilesInput, importVisionBtn));
    }
    
    if (importTTSBtn) {
        importTTSBtn.addEventListener('click', () => handleImport('tts', ttsFilesInput, importTTSBtn));
    }
    
    if (importASRBtn) {
        importASRBtn.addEventListener('click', () => handleImport('asr', asrFilesInput, importASRBtn));
    }

    // 从菜单切换摄像头
    const menuCamera = document.getElementById('menuCamera');
    menuCamera.addEventListener('click', () => {
        dropdownMenu.classList.remove('active');
        app.switchCamera();
    });

    // 从菜单切换音频
    const menuAudio = document.getElementById('menuAudio');
    menuAudio.addEventListener('click', () => {
        dropdownMenu.classList.remove('active');
        app.toggleAudio();
    });

    // PWA 安装按钮点击 (关闭菜单)
    const menuInstall = document.getElementById('menuInstall');
    if (menuInstall) {
        menuInstall.addEventListener('click', () => {
            dropdownMenu.classList.remove('active');
        });
    }

    // 打开设置面板（从菜单）
    menuSettings.addEventListener('click', () => {
        dropdownMenu.classList.remove('active');
        settingsPanel.classList.add('active');
        
        // 更新模型缓存状态
        updateCacheStatus();

        // 加载当前 prompt 设置
        const currentPrompt = config.models.vision.currentPrompt;
        const radio = document.getElementById(`prompt-${currentPrompt}`);
        if (radio) {
            radio.checked = true;
            updatePromptSelection(currentPrompt);
        }
        // 如果是 custom，加载自定义内容
        if (currentPrompt === 'custom' && config.models.vision.prompts.custom) {
            customPromptTextarea.value = config.models.vision.prompts.custom;
        }

        // 加载镜像设置
        mirrorToggleInput.checked = config.mirror.enabled;

        // 加载设备偏好设置
        deviceSelect.value = config.models.vision.devicePreference;
    });

    // 打开 About 面板（从菜单）
    const aboutPanel = document.getElementById('aboutPanel');
    const aboutClose = document.getElementById('aboutClose');

    menuAbout.addEventListener('click', () => {
        dropdownMenu.classList.remove('active');
        aboutPanel.classList.add('active');
    });

    // 关闭 About 面板
    const closeAbout = () => {
        aboutPanel.classList.remove('active');
    };
    aboutClose.addEventListener('click', closeAbout);
    aboutPanel.addEventListener('click', (e) => {
        if (e.target === aboutPanel) {
            closeAbout();
        }
    });

    // 关闭设置面板
    const closeSettings = () => {
        settingsPanel.classList.remove('active');
    };
    settingsClose.addEventListener('click', closeSettings);
    settingsPanel.addEventListener('click', (e) => {
        if (e.target === settingsPanel) closeSettings();
    });

    // 更新选中样式和显示/隐藏 custom prompt 输入框
    const updatePromptSelection = (promptKey) => {
        promptOptions.forEach(option => {
            if (option.dataset.prompt === promptKey) {
                option.classList.add('selected');
            } else {
                option.classList.remove('selected');
            }
        });

        // 显示/隐藏 custom prompt 输入框
        const customPromptSection = document.querySelector('.custom-prompt-section');
        if (customPromptSection) {
            customPromptSection.style.display = promptKey === 'custom' ? 'block' : 'none';
        }
    };

    // 监听 prompt 选项点击
    promptOptions.forEach(option => {
        option.addEventListener('click', () => {
            const radio = option.querySelector('input[type="radio"]');
            radio.checked = true;
            updatePromptSelection(option.dataset.prompt);
        });
    });

    // 自动保存：Mirror 设置
    mirrorToggleInput.addEventListener('change', () => {
        const oldMirrorEnabled = config.mirror.enabled;
        config.mirror.enabled = mirrorToggleInput.checked;
        console.log('[Settings] Mirror auto-saved:', config.mirror.enabled);

        // 保存到 localStorage
        try {
            localStorage.setItem('lenslore_mirror_enabled', config.mirror.enabled ? 'true' : 'false');
        } catch (e) {
            console.warn('[Settings] Failed to save mirror preference:', e);
        }

        // 通知 Service Worker
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'SET_MIRROR',
                enabled: config.mirror.enabled,
                url: config.mirror.url
            });
            console.warn(`[Settings] Notified SW mirror status: ${config.mirror.enabled}`);
            console.warn(`[Settings] Mirror URL: ${config.mirror.url}`);
        }

        // 显示自动保存提示
        showAutoSaveNotification('Mirror setting auto-saved!', oldMirrorEnabled !== config.mirror.enabled);
    });


    // 自动保存：Device 设置
    deviceSelect.addEventListener('change', () => {
        const oldDevicePreference = config.models.vision.devicePreference;
        config.models.vision.devicePreference = deviceSelect.value;
        console.log('[Settings] Device preference auto-saved:', config.models.vision.devicePreference);

        // 保存到 localStorage
        try {
            localStorage.setItem('lenslore_device_preference', config.models.vision.devicePreference);
        } catch (e) {
            console.warn('[Settings] Failed to save device preference:', e);
        }

        // 显示自动保存提示
        showAutoSaveNotification('Device preference auto-saved!', oldDevicePreference !== config.models.vision.devicePreference);
    });

    // 自动保存通知函数
    const showAutoSaveNotification = (message, needsReload) => {
        // 创建通知元素
        const notification = document.createElement('div');
        notification.textContent = needsReload ? `${message} Refresh page to apply.` : message;
        notification.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: ${needsReload ? '#ff9800' : '#2ecc71'};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10001;
            font-size: 14px;
            font-weight: 500;
            animation: slideIn 0.3s ease-out;
        `;

        // 添加动画样式
        if (!document.getElementById('autoSaveAnimation')) {
            const style = document.createElement('style');
            style.id = 'autoSaveAnimation';
            style.textContent = `
                @keyframes slideIn {
                    from {
                        transform: translateX(400px);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
                @keyframes slideOut {
                    from {
                        transform: translateX(0);
                        opacity: 1;
                    }
                    to {
                        transform: translateX(400px);
                        opacity: 0;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(notification);

        // 3秒后移除
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    };

    // 保存 Prompt 设置（手动保存按钮）
    // 注意：Mirror 和 Device 设置已自动保存，此按钮只保存 Prompt 设置
    settingsSave.addEventListener('click', () => {
        const selectedRadio = document.querySelector('input[name="prompt"]:checked');
        if (!selectedRadio) return;

        const promptKey = selectedRadio.value;

        // 如果选择了 custom，保存自定义 prompt
        if (promptKey === 'custom') {
            const customPrompt = customPromptTextarea.value.trim();
            if (!customPrompt) {
                alert('Please enter a custom prompt!');
                return;
            }
            config.models.vision.prompts.custom = customPrompt;
        }

        // 更新当前 prompt
        config.models.vision.currentPrompt = promptKey;
        console.log('[Settings] Prompt updated to:', promptKey);

        // 关闭设置面板
        closeSettings();

        // 显示提示
        alert('✅ Prompt setting saved!');
    });

    // 暴露 TTS 测试函数到全局,方便在控制台调试
    window.testTTS = async (text = "Hello world. This is a test.") => {
        console.log('[TTS Test] Starting test with text:', text);
        try {
            if (!app.tts) {
                console.error('[TTS Test] TTS not initialized yet. Please wait for app to load.');
                return;
            }
            const controller = await app.tts.speak(text);
            console.log('[TTS Test] Speech started successfully');
            return controller;
        } catch (error) {
            console.error('[TTS Test] Error:', error);
            throw error;
        }
    };

    console.log('[Debug] TTS test function available. Usage: testTTS("your text here")');
});
