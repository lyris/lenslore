import { TextToSpeech } from './textToSpeech.js';
import { config } from './config.js';
import { VOICES, VOICE_GROUPS } from './voices.js';

class TTSApp {
    constructor() {
        this.tts = null;
        this.currentAudio = null;
        this.isPlaying = false;
        this.lastAudioBlob = null;

        this.initElements();
        this.initEventListeners();
        this.applyMirrorPreferences();
        this.init();
    }

    initElements() {
        this.status = document.getElementById('status');
        this.statusText = document.getElementById('statusText');
        this.progressSection = document.getElementById('progressSection');
        this.progressFill = document.getElementById('progressFill');
        this.progressText = document.getElementById('progressText');
        this.textInput = document.getElementById('textInput');
        this.charCount = document.getElementById('charCount');
        this.voiceSelect = document.getElementById('voiceSelect');
        this.langSelect = document.getElementById('langSelect');
        this.speedSlider = document.getElementById('speedSlider');
        this.speedValue = document.getElementById('speedValue');
        this.speakButton = document.getElementById('speakButton');
        this.stopButton = document.getElementById('stopButton');
        this.highlightText = document.getElementById('highlightText');
        this.downloadSection = document.getElementById('downloadSection');
        this.downloadButton = document.getElementById('downloadButton');
    }

    initEventListeners() {
        this.textInput.addEventListener('input', () => this.updateCharCount());
        this.speakButton.addEventListener('click', () => this.speak());
        this.stopButton.addEventListener('click', () => this.stop());
        this.voiceSelect.addEventListener('change', () => this.onVoiceChange());
        this.langSelect.addEventListener('change', () => this.onLangChange());
        this.speedSlider.addEventListener('input', () => this.onSpeedChange());
        this.downloadButton.addEventListener('click', () => this.downloadAudio());
    }

    applyMirrorPreferences() {
        try {
            const defaultMirrorUrl = import.meta.env.VITE_HUGGINGFACE_MIRROR_URL || config.mirror.url;
            if (config.mirror.url && config.mirror.url.startsWith('/hf-mirror') && defaultMirrorUrl) {
                config.mirror.url = defaultMirrorUrl;
            }

            const savedMirror = localStorage.getItem('lenslore_mirror_enabled');
            if (savedMirror !== null) {
                config.mirror.enabled = savedMirror === 'true';
            }

            // 恢复 TTS 设备偏好
            const savedTTSDevice = localStorage.getItem('lenslore_tts_device_preference');
            if (savedTTSDevice !== null && ['auto', 'webgpu', 'wasm'].includes(savedTTSDevice)) {
                config.models.tts.devicePreference = savedTTSDevice;
                console.log(`[TTS App] Restored TTS device preference: ${config.models.tts.devicePreference}`);
            }

            console.log('[TTS App] Mirror prefs applied:', {
                enabled: config.mirror.enabled,
                url: config.mirror.url,
                ttsDevice: config.models.tts.devicePreference
            });
        } catch (e) {
            console.warn('[TTS App] Failed to apply mirror preferences:', e);
        }
    }

    markCached(type) {
        try {
            if (type) {
                localStorage.setItem(`lenslore_cached_${type}`, 'true');
            }
            const vision = localStorage.getItem('lenslore_cached_vision') === 'true';
            const tts = localStorage.getItem('lenslore_cached_tts') === 'true';
            const asr = localStorage.getItem('lenslore_cached_asr') === 'true';
            if (vision && tts && asr) {
                localStorage.setItem('lenslore_models_cached', 'true');
                localStorage.setItem('lenslore_cached_at', new Date().toISOString());
            }
        } catch (e) {
            console.warn('[TTS App] Failed to mark cache status:', e);
        }
    }

    onSpeedChange() {
        const speed = parseFloat(this.speedSlider.value);
        this.speedValue.textContent = `${speed.toFixed(1)}x`;
        console.log('[TTS App] Speed changed to:', speed);
    }

    onLangChange() {
        const lang = this.langSelect.value;
        if (lang === 'auto') {
            console.log('[TTS App] Language set to auto-detect from voice');
        } else {
            console.log('[TTS App] Language manually set to:', lang);
        }
    }

    updateCharCount() {
        const length = this.textInput.value.length;
        this.charCount.textContent = `${length} character${length !== 1 ? 's' : ''}`;
    }

    onVoiceChange() {
        if (this.tts) {
            this.tts.setVoice(this.voiceSelect.value);
            console.log('[TTS App] Voice changed to:', this.voiceSelect.value);
        }
    }

    downloadAudio() {
        if (!this.lastAudioBlob) {
            console.warn('[TTS App] No audio to download');
            return;
        }

        const voice = this.voiceSelect.value;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `tts-${voice}-${timestamp}.wav`;

        const url = URL.createObjectURL(this.lastAudioBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log(`[TTS App] Downloaded audio as: ${filename}`);
    }

    populateVoiceSelect() {
        this.voiceSelect.innerHTML = '';
        
        // 简单的映射：lang-gender -> group key
        // 例如 'en-us' + 'Female' -> 'en-us-f'
        const getGroupKey = (voice) => {
            const lang = voice.lang; // e.g. 'en-us'
            const gender = voice.gender === 'Female' ? 'f' : 'm';
            return `${lang}-${gender}`;
        };

        // 按组整理语音
        const groupedVoices = {};
        VOICES.forEach(voice => {
            const key = getGroupKey(voice);
            if (!groupedVoices[key]) groupedVoices[key] = [];
            groupedVoices[key].push(voice);
        });

        // 遍历预定义的组顺序
        Object.entries(VOICE_GROUPS).forEach(([key, label]) => {
            if (groupedVoices[key]) {
                const group = document.createElement('optgroup');
                group.label = label;

                groupedVoices[key].forEach(voice => {
                    const option = document.createElement('option');
                    option.value = voice.id;
                    
                    let text = voice.name;
                    if (voice.grade) text += ` (Grade: ${voice.grade})`;
                    if (voice.recommended) text += ' ⭐';
                    
                    option.textContent = text;
                    group.appendChild(option);
                });

                this.voiceSelect.appendChild(group);
            }
        });

        // 设置默认值
        const defaultVoice = config.models.tts.defaultVoice || 'af_heart';
        this.voiceSelect.value = defaultVoice;
    }

    async init() {
        try {
            this.showStatus('loading', 'Loading TTS model...');
            this.progressSection.classList.add('active');

            console.log('[TTS App] Starting TTS initialization...');

            this.tts = new TextToSpeech();
            await this.tts.init((progressInfo) => {
                if (typeof progressInfo === 'object' && progressInfo.progress) {
                    const dtype = progressInfo.dtype.toUpperCase();
                    const device = progressInfo.device === 'webgpu' ? 'WebGPU' : 'WASM';
                    const currentAttempt = progressInfo.currentAttempt || 1;
                    const totalAttempts = progressInfo.totalAttempts || 1;

                    // 计算整体进度
                    let overallProgress = 0;
                    if (progressInfo.stage === 'attempt' || progressInfo.stage === 'fallback') {
                        overallProgress = Math.floor(((currentAttempt - 1) / totalAttempts) * 100);
                    } else {
                        const progressMatch = progressInfo.progress.match(/(\d+)/);
                        const currentProgress = progressMatch ? parseInt(progressMatch[1]) : 0;
                        const attemptStart = ((currentAttempt - 1) / totalAttempts) * 100;
                        const attemptEnd = (currentAttempt / totalAttempts) * 100;
                        overallProgress = Math.floor(attemptStart + (currentProgress / 100) * (attemptEnd - attemptStart));
                    }

                    // 更新进度条
                    this.progressFill.style.width = `${overallProgress}%`;

                    // 尝试信息
                    const attemptInfo = currentAttempt && totalAttempts > 1
                        ? ` [Attempt ${currentAttempt}/${totalAttempts}]`
                        : '';

                    // 处理不同阶段
                    let detailText = '';
                    if (progressInfo.stage === 'attempt') {
                        detailText = `${progressInfo.attemptInfo}${attemptInfo}`;
                    } else if (progressInfo.stage === 'fallback') {
                        if (progressInfo.isDowngrade) {
                            detailText = `⚠️ ${progressInfo.attemptInfo}`;
                        } else {
                            detailText = progressInfo.attemptInfo;
                        }
                    } else if (progressInfo.stage === 'tts') {
                        detailText = `Loading [${dtype}/${device}]${attemptInfo}`;
                        if (progressInfo.fileName && progressInfo.fileName !== 'unknown') {
                            detailText += ` - ${progressInfo.fileName}${progressInfo.sizeInfo || ''}`;
                        }
                    }

                    this.progressText.textContent = `${overallProgress}% - ${detailText}`;
                    this.statusText.textContent = 'Loading TTS model...';
                } else {
                    // 兼容旧格式
                    const progressText = progressInfo.status || progressInfo.progress || progressInfo;
                    this.progressText.textContent = progressText;
                }
            });

            console.log('[TTS App] TTS initialized successfully');
            this.markCached('tts');

            this.showStatus('ready', '✅ Ready! Enter text and click Speak.');
            this.progressSection.classList.remove('active');

            // 动态填充语音列表
            this.populateVoiceSelect();

            // 启用控件
            this.textInput.disabled = false;
            this.voiceSelect.disabled = false;
            this.langSelect.disabled = false;
            this.speedSlider.disabled = false;
            this.speakButton.disabled = false;

            // 初始化字符计数
            this.updateCharCount();

        } catch (error) {
            console.error('[TTS App] Initialization error:', error);
            this.showStatus('error', `❌ Error: ${error.message}`);
            this.progressSection.classList.remove('active');
        }
    }

    showStatus(type, message) {
        // 移除所有状态类
        this.status.classList.remove('loading', 'ready', 'error', 'speaking');
        // 添加新状态类
        this.status.classList.add(type);
        this.statusText.textContent = message;
    }

    updateHighlightText(segments, currentIndex) {
        // 清空高亮文本
        this.highlightText.innerHTML = '';

        // 为每个片段创建 span 元素
        segments.forEach((segment, index) => {
            const span = document.createElement('span');
            span.textContent = segment;
            span.className = 'segment';

            // 当前正在朗读的片段高亮显示
            if (index === currentIndex) {
                span.classList.add('current');
            } else if (index < currentIndex) {
                // 已经播放过的片段标记为已完成（保持正常样式）
                span.classList.add('completed');
            }

            this.highlightText.appendChild(span);

            // 片段之间添加空格
            if (index < segments.length - 1) {
                this.highlightText.appendChild(document.createTextNode(' '));
            }
        });

        // 显示高亮文本容器
        this.highlightText.classList.add('active');

        // 滚动到当前片段
        const currentSpan = this.highlightText.querySelector('.segment.current');
        if (currentSpan) {
            setTimeout(() => {
                currentSpan.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            }, 100);
        }
    }

    async speak() {
        const text = this.textInput.value.trim();

        if (!text) {
            this.showStatus('error', '⚠️ Please enter some text first!');
            return;
        }

        if (!this.tts || !this.tts.isReady()) {
            this.showStatus('error', '⚠️ TTS model not ready yet!');
            return;
        }

        // 停止之前的播放
        if (this.currentAudio) {
            this.stop();
        }

        // 隐藏之前的下载按钮
        this.downloadSection.style.display = 'none';
        this.lastAudioBlob = null;

        try {
            this.isPlaying = true;
            this.speakButton.disabled = true;
            this.stopButton.disabled = false;
            this.showStatus('speaking', '🎤 Speaking...');

            const voice = this.voiceSelect.value;
            const langValue = this.langSelect.value;
            const lang = langValue === 'auto' ? undefined : langValue;
            const speed = parseFloat(this.speedSlider.value);

            console.log(`[TTS App] Starting speech: "${text.substring(0, 50)}..." with voice: ${voice}, language: ${langValue}, speed: ${speed}x`);

            const startTime = performance.now();

            this.currentAudio = await this.tts.speak(text, voice, {
                lang: lang,  // 传入语言参数
                speed: speed,  // 传入速度参数
                onSegmentStart: (index, currentSegment, allSegments) => {
                    console.log(`[TTS App] Playing segment ${index + 1}/${allSegments.length}: "${currentSegment}"`);
                    this.updateHighlightText(allSegments, index);
                }
            });

            const duration = (performance.now() - startTime).toFixed(0);
            console.log(`[TTS App] Speech controller created in ${duration}ms`);

            // 异步获取合并后的音频 blob（等待所有片段生成完成）
            this.currentAudio.getAudioBlob().then(blob => {
                if (blob && this.currentAudio) {
                    this.lastAudioBlob = blob;
                    this.downloadSection.style.display = 'block';
                    console.log('[TTS App] Audio blob available for download');
                }
            }).catch(error => {
                console.error('[TTS App] Failed to get audio blob:', error);
            });

            // 监听播放结束（使用 once: true 确保只触发一次）
            this.currentAudio.addEventListener('ended', () => {
                console.log('[TTS App] Speech completed');
                this.onSpeechEnd();
            }, { once: true });

        } catch (error) {
            console.error('[TTS App] Speech error:', error);
            this.showStatus('error', `❌ Error: ${error.message}`);
            this.speakButton.disabled = false;
            this.stopButton.disabled = true;
            this.isPlaying = false;
        }
    }

    stop() {
        if (this.currentAudio) {
            console.log('[TTS App] Stopping speech');
            this.currentAudio.stop();
            this.currentAudio = null;
        }
        this.onSpeechEnd();
    }

    onSpeechEnd() {
        this.isPlaying = false;
        this.speakButton.disabled = false;
        this.stopButton.disabled = true;
        this.showStatus('ready', '✅ Ready! Enter text and click Speak.');

        // 移除所有 current 类以停止动画，并标记为完成
        const segments = this.highlightText.querySelectorAll('.segment');
        segments.forEach(segment => {
            // 先移除 current 类
            segment.classList.remove('current');
            // 强制浏览器重新计算样式（触发 reflow）
            void segment.offsetHeight;
            // 再添加 completed 类
            if (!segment.classList.contains('completed')) {
                segment.classList.add('completed');
            }
        });

        // Don't hide highlight text to prevent page jumping
        // this.highlightText.classList.remove('active');
        console.log('[TTS App] Speech ended');
    }
}

// 初始化应用
window.addEventListener('DOMContentLoaded', () => {
    const app = new TTSApp();

    // 暴露到全局用于调试
    window.ttsApp = app;
    console.log('[TTS App] Application initialized. Access via window.ttsApp');
});
