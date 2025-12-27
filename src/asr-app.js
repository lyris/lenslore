import { pipeline, env } from '@huggingface/transformers';
import { config } from './config.js';

class ASRApp {
    constructor() {
        this.pipe = null;
        this.audioBlob = null;
        this.isRecording = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.recordingStartTime = null;
        this.timerInterval = null;

        this.initElements();
        this.initEventListeners();
        this.applyMirrorPreferences();

        // 配置镜像服务器（必须在全局 env 设置）
        if (config.mirror.enabled && config.mirror.url) {
            env.remoteHost = config.mirror.url;
            env.remotePathTemplate = '{model}/resolve/{revision}/';
            console.warn(`[ASR App] ✅ Global mirror configured: ${config.mirror.url}`);
        }

        this.init();
    }

    initElements() {
        this.status = document.getElementById('status');
        this.statusText = document.getElementById('statusText');
        this.progressSection = document.getElementById('progressSection');
        this.progressFill = document.getElementById('progressFill');
        this.progressText = document.getElementById('progressText');

        this.audioFile = document.getElementById('audioFile');
        this.fileInputLabel = document.getElementById('fileInputLabel');
        this.recordButton = document.getElementById('recordButton');
        this.recordIcon = document.getElementById('recordIcon');
        this.recordText = document.getElementById('recordText');
        this.recordingIndicator = document.getElementById('recordingIndicator');
        this.recordingTimer = document.getElementById('recordingTimer');
        this.audioPlayer = document.getElementById('audioPlayer');

        this.modelSelect = document.getElementById('modelSelect');
        this.languageSelect = document.getElementById('languageSelect');
        this.transcribeButton = document.getElementById('transcribeButton');
        this.clearButton = document.getElementById('clearButton');

        this.resultWrapper = document.getElementById('resultWrapper');
        this.resultBox = document.getElementById('resultBox');
        this.copyButton = document.getElementById('copyButton');
    }

    initEventListeners() {
        this.audioFile.addEventListener('change', (e) => this.handleFileUpload(e));
        this.recordButton.addEventListener('click', () => this.toggleRecording());
        this.transcribeButton.addEventListener('click', () => this.transcribe());
        this.clearButton.addEventListener('click', () => this.clear());
        this.copyButton.addEventListener('click', () => this.copyResult());
        this.modelSelect.addEventListener('change', () => this.onModelChange());
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

            console.log('[ASR App] Mirror prefs applied:', {
                enabled: config.mirror.enabled,
                url: config.mirror.url
            });
        } catch (e) {
            console.warn('[ASR App] Failed to apply mirror preferences:', e);
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
            console.warn('[ASR App] Failed to mark cache status:', e);
        }
    }

    async init() {
        try {
            this.showStatus('loading', 'Loading ASR model...');
            this.progressSection.classList.add('active');

            console.log('[ASR App] Starting ASR initialization...');
            console.log('[ASR App] Selected model:', this.modelSelect.value);

            // Configure transformers.js environment
            env.allowLocalModels = false;
            env.allowRemoteModels = true;

            // 启用浏览器缓存优先策略（优先使用 Cache API 和 Service Worker）
            env.useBrowserCache = true;
            env.useFSCache = true;



            // Try WebGPU first, fallback to WASM
            let device = 'webgpu';
            let dtype = 'fp16';

            try {
                // Test WebGPU availability
                if (!navigator.gpu) {
                    throw new Error('WebGPU not available');
                }
                console.log('[ASR App] WebGPU is available, using GPU acceleration');
            } catch (error) {
                console.warn('[ASR App] WebGPU not available, falling back to WASM:', error.message);
                device = 'wasm';
                dtype = 'q8';
            }

            const modelId = this.modelSelect.value;

            // For transformers.js v3, configure dtype based on device
            const pipelineOptions = {
                dtype: device === 'webgpu' ? 'fp16' : 'fp32',
                device: device,
                progress_callback: (progress) => {
                    if (progress.status === 'progress') {
                        const percentage = Math.round((progress.loaded / progress.total) * 100);
                        this.progressFill.style.width = `${percentage}%`;

                        const fileName = progress.file || 'model files';
                        const loaded = (progress.loaded / (1024 * 1024)).toFixed(1);
                        const total = (progress.total / (1024 * 1024)).toFixed(1);

                        this.progressText.textContent = `Loading ${fileName}: ${loaded}MB / ${total}MB (${percentage}%)`;
                    } else if (progress.status === 'done') {
                        const fileName = progress.file || 'file';
                        this.progressText.textContent = `✓ Loaded ${fileName}`;
                    } else if (progress.status === 'ready') {
                        this.progressText.textContent = '✓ Model ready';
                    } else {
                        this.progressText.textContent = progress.status;
                    }
                }
            };

            // 镜像已在全局 env 配置，这里不需要单独设置

            this.pipe = await pipeline('automatic-speech-recognition', modelId, pipelineOptions);

            console.log('[ASR App] ASR model loaded successfully');
            console.log('[ASR App] Using device:', device, 'dtype:', dtype);

            this.showStatus('ready', `✅ Ready! Model: ${modelId.split('/')[1]} (${device.toUpperCase()})`);
            this.progressSection.classList.remove('active');

            // 标记 ASR 模型已缓存
            this.markCached('asr');

            // Enable controls
            this.audioFile.disabled = false;
            this.recordButton.disabled = false;
            this.modelSelect.disabled = false;
            this.languageSelect.disabled = false;
            this.clearButton.disabled = false;

            // Re-enable transcribe button if audio exists (for model switching)
            if (this.audioBlob) {
                this.transcribeButton.disabled = false;
                console.log('[ASR App] Audio exists, transcribe button enabled');
            }

        } catch (error) {
            console.error('[ASR App] Initialization error:', error);

            // Provide user-friendly error messages
            let friendlyMessage = '';
            if (error.message.includes('Unsupported model type')) {
                friendlyMessage = '❌ Model loading failed. The model may still be downloading or incomplete. Please wait and try again.';
            } else if (error.message.includes('network') || error.message.includes('fetch')) {
                friendlyMessage = '❌ Network error. Please check your internet connection and try again.';
            } else if (error.message.includes('memory') || error.message.includes('allocation')) {
                friendlyMessage = '❌ Out of memory. Try using a smaller model or close other browser tabs.';
            } else {
                friendlyMessage = `❌ Error: ${error.message}`;
            }

            this.showStatus('error', friendlyMessage);
            this.progressSection.classList.remove('active');

            // Re-enable controls so user can try again
            this.modelSelect.disabled = false;
            this.clearButton.disabled = false;
        }
    }

    async onModelChange() {
        // Reload the model when selection changes
        // Keep the uploaded audio, only reload the model
        this.pipe = null;

        // Disable controls during reload
        this.audioFile.disabled = true;
        this.recordButton.disabled = true;
        this.transcribeButton.disabled = true;
        this.clearButton.disabled = true;
        this.modelSelect.disabled = true;
        this.languageSelect.disabled = true;

        await this.init();
    }

    showStatus(type, message) {
        this.status.classList.remove('loading', 'ready', 'error', 'transcribing');
        this.status.classList.add(type);
        this.statusText.textContent = message;
    }

    handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        console.log('[ASR App] File uploaded:', file.name, file.type, file.size);

        this.audioBlob = file;
        this.audioPlayer.src = URL.createObjectURL(file);
        this.audioPlayer.classList.add('active');
        this.transcribeButton.disabled = false;

        this.fileInputLabel.textContent = `✓ ${file.name}`;
        this.showStatus('ready', '✅ Audio loaded. Click Transcribe to convert to text.');
    }

    async toggleRecording() {
        if (this.isRecording) {
            await this.stopRecording();
        } else {
            await this.startRecording();
        }
    }

    async startRecording() {
        try {
            console.log('[ASR App] Requesting microphone access...');
            // Use simpler audio constraints for better compatibility
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            this.audioChunks = [];
            this.mediaRecorder = new MediaRecorder(stream);

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                this.audioBlob = audioBlob;
                this.audioPlayer.src = URL.createObjectURL(audioBlob);
                this.audioPlayer.classList.add('active');
                this.transcribeButton.disabled = false;

                console.log('[ASR App] Recording saved:', audioBlob.size, 'bytes');

                // Stop all tracks
                stream.getTracks().forEach(track => track.stop());
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            this.recordingStartTime = Date.now();

            // Update UI
            this.recordButton.classList.add('recording');
            this.recordIcon.textContent = '⏹';
            this.recordText.textContent = 'Stop Recording';
            this.recordingIndicator.classList.add('active');

            // Start timer
            this.timerInterval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
                const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
                const seconds = (elapsed % 60).toString().padStart(2, '0');
                this.recordingTimer.textContent = `${minutes}:${seconds}`;
            }, 1000);

            this.showStatus('ready', '🎙️ Recording... Click Stop when finished.');
            console.log('[ASR App] Recording started');

        } catch (error) {
            console.error('[ASR App] Microphone access error:', error);
            this.showStatus('error', `❌ Microphone error: ${error.message}`);
        }
    }

    async stopRecording() {
        if (!this.mediaRecorder || !this.isRecording) return;

        this.mediaRecorder.stop();
        this.isRecording = false;

        // Update UI
        this.recordButton.classList.remove('recording');
        this.recordIcon.textContent = '⏺';
        this.recordText.textContent = 'Start Recording';
        this.recordingIndicator.classList.remove('active');

        // Stop timer
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        this.showStatus('ready', '✅ Recording complete. Click Transcribe to convert to text.');
        console.log('[ASR App] Recording stopped');
    }

    async transcribe() {
        if (!this.audioBlob) {
            this.showStatus('error', '⚠️ Please upload or record audio first!');
            return;
        }

        if (!this.pipe) {
            this.showStatus('error', '⚠️ ASR model not ready yet!');
            return;
        }

        try {
            this.transcribeButton.disabled = true;
            this.showStatus('transcribing', '🎤 Transcribing audio...');
            this.progressSection.classList.add('active');

            console.log('[ASR App] Starting transcription...');
            const startTime = performance.now();

            // Convert blob to array buffer
            const arrayBuffer = await this.audioBlob.arrayBuffer();

            // Decode audio
            const audioContext = new AudioContext({ sampleRate: 16000 });
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            // Get audio data (mono channel)
            const audio = audioBuffer.getChannelData(0);

            console.log('[ASR App] Audio prepared:', {
                duration: audioBuffer.duration.toFixed(2) + 's',
                sampleRate: audioBuffer.sampleRate,
                length: audio.length
            });

            // Prepare generation options
            const language = this.languageSelect.value;
            const generateOptions = {
                language: language === 'auto' ? undefined : language,
                task: 'transcribe',
                return_timestamps: false,
                chunk_length_s: 30,
                stride_length_s: 5
            };

            // Remove undefined values to avoid parameter issues
            if (generateOptions.language === undefined) {
                delete generateOptions.language;
            }

            console.log('[ASR App] Generation options:', generateOptions);

            // Progress tracking
            let lastProgress = 0;
            const progressInterval = setInterval(() => {
                lastProgress += 2;
                if (lastProgress > 95) lastProgress = 95;
                this.progressFill.style.width = `${lastProgress}%`;
                this.progressText.textContent = `Processing audio... ${lastProgress}%`;
            }, 200);

            // Run transcription
            const result = await this.pipe(audio, generateOptions);

            clearInterval(progressInterval);
            this.progressFill.style.width = '100%';

            const duration = (performance.now() - startTime).toFixed(0);
            console.log('[ASR App] Transcription completed in', duration + 'ms');
            console.log('[ASR App] Result:', result);

            // Display result
            const text = result.text || result;
            this.resultBox.textContent = text.trim();
            this.resultWrapper.classList.add('active');

            this.showStatus('ready', `✅ Transcription complete! (${duration}ms)`);
            this.progressSection.classList.remove('active');
            this.transcribeButton.disabled = false;

        } catch (error) {
            console.error('[ASR App] Transcription error:', error);

            // Provide user-friendly error messages
            let friendlyMessage = '';
            if (error.message.includes('out of memory') || error.message.includes('allocation')) {
                friendlyMessage = '❌ Out of memory. Try using a smaller model, shorter audio, or close other browser tabs.';
            } else if (error.message.includes('Invalid') || error.message.includes('parameter')) {
                friendlyMessage = '❌ Audio format error. Please try a different audio file or re-record.';
            } else if (error.message.includes('decode') || error.message.includes('audio')) {
                friendlyMessage = '❌ Failed to decode audio. The file may be corrupted or in an unsupported format.';
            } else if (error.message.includes('model')) {
                friendlyMessage = '❌ Model error. The model may be incomplete. Try switching to a different model.';
            } else {
                friendlyMessage = `❌ Transcription failed: ${error.message}`;
            }

            this.showStatus('error', friendlyMessage);
            this.progressSection.classList.remove('active');
            this.transcribeButton.disabled = false;
        }
    }

    clear() {
        // Clear audio
        this.audioBlob = null;
        this.audioPlayer.src = '';
        this.audioPlayer.classList.remove('active');
        this.audioFile.value = '';
        this.fileInputLabel.textContent = '📤 Choose Audio File';

        // Clear result
        this.resultBox.textContent = '';
        this.resultWrapper.classList.remove('active');

        // Disable transcribe button
        this.transcribeButton.disabled = true;

        this.showStatus('ready', '✅ Cleared. Ready for new audio.');
        console.log('[ASR App] Cleared all data');
    }

    copyResult() {
        const text = this.resultBox.textContent;
        if (!text) return;

        navigator.clipboard.writeText(text).then(() => {
            console.log('[ASR App] Text copied to clipboard');
            const originalText = this.copyButton.textContent;
            this.copyButton.textContent = '✓ Copied!';
            setTimeout(() => {
                this.copyButton.textContent = originalText;
            }, 2000);
        }).catch(error => {
            console.error('[ASR App] Copy failed:', error);
            this.showStatus('error', '❌ Failed to copy text');
        });
    }
}

// Initialize app
window.addEventListener('DOMContentLoaded', () => {
    const app = new ASRApp();

    // Expose to global for debugging
    window.asrApp = app;
    console.log('[ASR App] Application initialized. Access via window.asrApp');
});
