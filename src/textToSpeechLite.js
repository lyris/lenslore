import { KokoroTTS } from 'kokoro-js';
import { config } from './config.js';
import { env } from '@huggingface/transformers';
import { VOICES } from './voices.js';

// 启用浏览器缓存优先策略（优先使用 Cache API 和 Service Worker）
env.useBrowserCache = true;
env.useFSCache = true;

// 配置镜像服务器（必须在全局 env 设置）
if (config.mirror.enabled && config.mirror.url) {
    env.remoteHost = config.mirror.url;
    env.remotePathTemplate = '{model}/resolve/{revision}/';
    console.warn(`[TextToSpeechLite] ✅ Global mirror configured: ${config.mirror.url}`);
}



/**
 * 合并多个 WAV Blob 文件
 * @param {Blob[]} blobs - 要合并的 WAV Blob 数组
 * @returns {Promise<Blob>} 合并后的 WAV Blob
 */
async function mergeWavBlobs(blobs) {
    if (blobs.length === 0) return null;
    if (blobs.length === 1) return blobs[0];

    console.warn(`[WAV Merge] Merging ${blobs.length} WAV files...`);

    // 读取所有 WAV 文件的 ArrayBuffer
    const buffers = await Promise.all(blobs.map(blob => blob.arrayBuffer()));

    // 解析第一个 WAV 文件的头部信息
    const firstBuffer = buffers[0];
    const view = new DataView(firstBuffer);

    // 检查是否是有效的 WAV 文件
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (riff !== 'RIFF') {
        console.error('[WAV Merge] Invalid WAV file: RIFF header not found');
        return blobs[0];
    }

    // 读取音频参数
    const channels = view.getUint16(22, true);
    const sampleRate = view.getUint32(24, true);
    const bitsPerSample = view.getUint16(34, true);

    console.warn(`[WAV Merge] Audio format: ${channels} channels, ${sampleRate}Hz, ${bitsPerSample}bit`);

    // 检查音频格式
    const audioFormat = view.getUint16(20, true);
    const isFloat = audioFormat === 3; // 3 = IEEE float
    console.warn(`[WAV Merge] Audio format code: ${audioFormat} (${isFloat ? 'IEEE Float' : 'PCM'})`);

    // 提取所有文件的音频数据（跳过 WAV 头部，标准 WAV 头部是 44 字节）
    const audioDataArrays = buffers.map((buffer, index) => {
        // 标准 WAV 文件头部是 44 字节
        const headerSize = 44;
        const dataSize = buffer.byteLength - headerSize;
        const audioData = new Uint8Array(buffer, headerSize, dataSize);
        console.warn(`[WAV Merge] File ${index + 1}: ${dataSize} bytes of audio data`);
        return audioData;
    });

    // 计算合并后的总大小
    const totalDataSize = audioDataArrays.reduce((sum, arr) => sum + arr.length, 0);
    console.warn(`[WAV Merge] Total audio data: ${totalDataSize} bytes`);

    // 创建新的 WAV 文件
    const wavBuffer = new ArrayBuffer(44 + totalDataSize);
    const wavView = new DataView(wavBuffer);
    const wavBytes = new Uint8Array(wavBuffer);

    // 写入 RIFF header
    wavView.setUint32(0, 0x52494646, false); // "RIFF"
    wavView.setUint32(4, 36 + totalDataSize, true); // file size - 8
    wavView.setUint32(8, 0x57415645, false); // "WAVE"

    // 写入 fmt chunk
    wavView.setUint32(12, 0x666d7420, false); // "fmt "
    wavView.setUint32(16, 16, true); // fmt chunk size
    wavView.setUint16(20, audioFormat, true); // audio format (preserve original format)
    wavView.setUint16(22, channels, true);
    wavView.setUint32(24, sampleRate, true);
    wavView.setUint32(28, sampleRate * channels * bitsPerSample / 8, true); // byte rate
    wavView.setUint16(32, channels * bitsPerSample / 8, true); // block align
    wavView.setUint16(34, bitsPerSample, true);

    // 写入 data chunk
    wavView.setUint32(36, 0x64617461, false); // "data"
    wavView.setUint32(40, totalDataSize, true);

    // 合并所有音频数据
    let offset = 44;
    for (const audioData of audioDataArrays) {
        wavBytes.set(audioData, offset);
        offset += audioData.length;
    }

    console.warn(`[WAV Merge] Merge complete: ${44 + totalDataSize} bytes total`);
    return new Blob([wavBuffer], { type: 'audio/wav' });
}

/**
 * 精简版 TextToSpeech 类 - 仅支持英文
 * 用于 index.html (ITT 页面)，不包含中文依赖 (pinyin/pinyin2ipa)
 */
export class TextToSpeech {
    constructor() {
        this.kokoro = null;
        this.modelId = config.models.tts.useLocal
            ? config.models.tts.localPath
            : config.models.tts.id;
        this.voice = config.models.tts.defaultVoice;
        this.initialized = false;
        this.initPromise = null;
    }

    async init(progressCallback) {
        if (this.initialized) {
            return this.kokoro;
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this._doInit(progressCallback);

        try {
            const result = await this.initPromise;
            this.initialized = true;
            return result;
        } catch (error) {
            this.initPromise = null;
            throw error;
        }
    }

    async _doInit(progressCallback) {
        const loadAttempts = [
            { dtype: 'fp32', device: 'webgpu', vramNeeded: '~600MB VRAM' },
            { dtype: 'fp32', device: 'wasm', vramNeeded: 'CPU mode (no GPU)' }
        ];

        const hasWebGPU = 'gpu' in navigator;
        if (!hasWebGPU) {
            console.warn('[TTS] No WebGPU support, using WASM directly');
            if (progressCallback) {
                progressCallback({
                    progress: 'Preparing',
                    stage: 'fallback',
                    dtype: 'fp32',
                    device: 'wasm',
                    attemptInfo: 'No WebGPU, using CPU mode',
                    currentAttempt: 1,
                    totalAttempts: 1
                });
            }
            return this.loadWithConfig('fp32', 'wasm', progressCallback, 1, 1);
        }

        for (let i = 0; i < loadAttempts.length; i++) {
            const { dtype, device, vramNeeded } = loadAttempts[i];

            try {
                console.log(`[TTS] 🔄 Attempt ${i + 1}/${loadAttempts.length}: ${dtype.toUpperCase()}/${device.toUpperCase()} (${vramNeeded})`);

                if (progressCallback) {
                    progressCallback({
                        progress: 'Starting',
                        stage: 'attempt',
                        dtype: dtype,
                        device: device,
                        attemptInfo: `Trying ${dtype.toUpperCase()}/${device.toUpperCase()} (${vramNeeded})`,
                        currentAttempt: i + 1,
                        totalAttempts: loadAttempts.length
                    });
                }

                await this.loadWithConfig(dtype, device, progressCallback, i + 1, loadAttempts.length);

                console.log(`✅ [TTS] Successfully loaded: ${dtype.toUpperCase()}/${device.toUpperCase()}`);
                return this.kokoro;

            } catch (error) {
                const errorMsg = error.message || '';
                console.error(`❌ [TTS] Failed ${dtype}/${device}:`, errorMsg);

                const isOOM = errorMsg.includes('allocation') ||
                             errorMsg.includes('out of memory') ||
                             errorMsg.includes('OOM') ||
                             errorMsg.includes('CreateBuffer') ||
                             errorMsg.includes('memory');

                if (isOOM && i < loadAttempts.length - 1) {
                    const nextAttempt = loadAttempts[i + 1];
                    console.warn(`⚠️ [TTS] GPU memory insufficient for ${dtype}/${device}, switching to CPU mode...`);

                    if (progressCallback) {
                        progressCallback({
                            progress: 'Downgrading',
                            stage: 'fallback',
                            dtype: dtype,
                            device: device,
                            attemptInfo: `VRAM insufficient, switching to CPU mode (${nextAttempt.dtype.toUpperCase()}/${nextAttempt.device.toUpperCase()})...`,
                            currentAttempt: i + 1,
                            totalAttempts: loadAttempts.length,
                            isDowngrade: true
                        });
                    }

                    continue;
                }

                if (i === loadAttempts.length - 1) {
                    throw new Error(`❌ Failed to load TTS model with all configurations. Last error: ${errorMsg}`);
                }

                throw error;
            }
        }
    }

    async loadWithConfig(dtype, device, progressCallback, currentAttempt, totalAttempts) {
        this.currentConfig = { dtype, device };

        const modelLoadOptions = {
            dtype: dtype,
            device: device,
            progress_callback: (progress) => {
                if (progressCallback) {
                    const percentage = progress.progress ?
                        Math.round(progress.progress) + '%' :
                        progress.status || '';

                    const fileName = progress.file || 'unknown';
                    const loaded = progress.loaded ? (progress.loaded / 1024 / 1024).toFixed(1) : 0;
                    const total = progress.total ? (progress.total / 1024 / 1024).toFixed(1) : 0;
                    const sizeInfo = total > 0 ? ` (${loaded}/${total}MB)` : '';

                    progressCallback({
                        progress: percentage,
                        stage: 'tts',
                        dtype: dtype,
                        device: device,
                        currentAttempt: currentAttempt,
                        totalAttempts: totalAttempts,
                        fileName: fileName,
                        sizeInfo: sizeInfo
                    });
                }
            }
        };

        // 镜像已在全局 env 配置，这里不需要单独设置

        this.kokoro = await KokoroTTS.from_pretrained(this.modelId, modelLoadOptions);

        // 关键：移除 kokoro 内部的语音验证，支持所有 54 个语音
        if (this.kokoro && this.kokoro._validate_voice) {
            console.log('[TTS] Patching voice validation to support all 54 voices');
            const originalValidate = this.kokoro._validate_voice.bind(this.kokoro);
            this.kokoro._validate_voice = function(voice) {
                // 扩展的语音列表 - 包含所有 54 个语音
                const allVoices = VOICES.map(v => v.id);

                if (!allVoices.includes(voice)) {
                    throw new Error(`Voice "${voice}" not found. Should be one of: ${allVoices.join(', ')}`);
                }

                // 不调用原始验证，直接返回
                return voice;
            };
        }
    }

    isReady() {
        return this.initialized && this.kokoro !== null;
    }

    /**
     * 根据语音名称自动推断语言代码
     */
    getLanguageFromVoice(voice) {
        const prefix = voice.substring(0, 2);
        const langMap = {
            'af': 'a',  // American English Female
            'am': 'a',  // American English Male
            'bf': 'b',  // British English Female
            'bm': 'b',  // British English Male
            'jf': 'j',  // Japanese Female
            'jm': 'j',  // Japanese Male
            'zf': 'z',  // Chinese Female (Mandarin)
            'zm': 'z',  // Chinese Male (Mandarin)
            'ef': 'e',  // Spanish Female
            'em': 'e',  // Spanish Male
            'ff': 'f',  // French Female
            'hf': 'h',  // Hindi Female
            'hm': 'h',  // Hindi Male
            'if': 'i',  // Italian Female
            'im': 'i',  // Italian Male
            'pf': 'p',  // Portuguese Female
            'pm': 'p'   // Portuguese Male
        };
        return langMap[prefix] || 'a'; // 默认英语
    }

    async speak(text, voice = null, options = {}) {
        if (this.initPromise && !this.initialized) {
            console.log('[TTS] Waiting for initialization to complete...');
            await this.initPromise;
        }

        if (!this.kokoro) {
            throw new Error('TTS model not initialized. Call init() first.');
        }

        try {
            const voiceToUse = voice || this.voice;
            const onSegmentStart = options.onSegmentStart || null;
            const speed = options.speed || 1.0;  // 默认速度为 1.0x

            // 自动根据语音推断语言，或使用用户指定的语言
            const detectedLang = this.getLanguageFromVoice(voiceToUse);
            const lang = options.lang || detectedLang;

            console.warn(`[🔍 TTS Language Debug] Voice: ${voiceToUse}`);
            console.warn(`[🔍 TTS Language Debug] Auto-detected language: ${detectedLang}`);
            console.warn(`[🔍 TTS Language Debug] User-specified language (options.lang): ${options.lang}`);
            console.warn(`[🔍 TTS Language Debug] Final language to use: ${lang}`);

            // Lite 版本：仅支持英文 (a/b)，其他语言抛出错误
            if (lang !== 'a' && lang !== 'b') {
                throw new Error(`This lite version only supports English. For other languages, please use the full TTS page.`);
            }

            const sentences = [];
            const allSentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);

            const sentencesPerSegment = 1;
            for (let i = 0; i < allSentences.length; i += sentencesPerSegment) {
                const segment = allSentences.slice(i, i + sentencesPerSegment).join(' ');
                sentences.push(segment);
            }

            console.log(`[TTS] Splitting text into ${sentences.length} segments`);

            const audioQueue = [];
            const allAudioBlobs = [];  // 收集所有音频 blob 用于下载
            let currentAudio = null;
            let isStopped = false;
            let isPlaying = false;
            let generationComplete = false;

            const playNext = async () => {
                if (isStopped) return;
                if (isPlaying) return;

                while (!isStopped && audioQueue.length === 0 && !generationComplete) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }

                if (isStopped || audioQueue.length === 0) {
                    isPlaying = false;
                    return;
                }

                isPlaying = true;
                const { audio, url, index, text: segmentText } = audioQueue.shift();
                currentAudio = audio;

                // 设置播放速度
                audio.playbackRate = speed;

                if (onSegmentStart) {
                    onSegmentStart(index, segmentText, sentences);
                }

                try {
                    await audio.play();

                    audio.addEventListener('ended', () => {
                        setTimeout(() => {
                            URL.revokeObjectURL(url);
                        }, 1000);
                        isPlaying = false;
                        playNext();
                    }, { once: true });
                } catch (error) {
                    console.error('[TTS] Error playing audio segment:', error);
                    setTimeout(() => {
                        URL.revokeObjectURL(url);
                    }, 1000);
                    isPlaying = false;
                    playNext();
                }
            };

            const generateAndPlay = async () => {
                for (let i = 0; i < sentences.length; i++) {
                    if (isStopped) break;

                    const sentence = sentences[i].trim();
                    if (!sentence) continue;

                    const segmentStartTime = performance.now();
                    console.warn(`[⏱️ TTS Segment ${i + 1}/${sentences.length}] Starting generation (${sentence.length} chars)`);

                    let audioUrl = null;
                    try {
                        const generateStartTime = performance.now();

                        console.warn(`[🔍 TTS Generation] Calling generation with text: "${sentence.substring(0, 50)}..."`);
                        console.warn(`[🔍 TTS Generation] Voice: ${voiceToUse}, Language code: ${lang}`);

                        // 英语：使用 generate 方法（包含音素化）
                        console.warn(`[🔍 TTS Generation] Using phonemization for English`);
                        const audioOutput = await this.kokoro.generate(sentence, {
                            voice: voiceToUse
                        });
                        console.warn(`[🔍 TTS Generation] English phonemization complete`);

                        const generateEndTime = performance.now();
                        const generateDuration = (generateEndTime - generateStartTime).toFixed(0);

                        const blobStartTime = performance.now();
                        const wavBlob = audioOutput.toBlob();
                        const blobEndTime = performance.now();
                        const blobDuration = (blobEndTime - blobStartTime).toFixed(0);

                        audioUrl = URL.createObjectURL(wavBlob);
                        const audio = new Audio(audioUrl);

                        const segmentEndTime = performance.now();
                        const segmentTotalDuration = (segmentEndTime - segmentStartTime).toFixed(0);

                        console.warn(`[⏱️ TTS Segment ${i + 1}] Generated in ${segmentTotalDuration}ms (generate: ${generateDuration}ms, blob: ${blobDuration}ms)`);

                        allAudioBlobs.push(wavBlob);  // 保存 blob 用于下载
                        audioQueue.push({ audio, url: audioUrl, index: i, text: sentence });

                        if (i === 0) {
                            console.warn('[⏱️ TTS] First segment ready, starting playback');
                            playNext();
                        }
                    } catch (error) {
                        const segmentEndTime = performance.now();
                        const segmentTotalDuration = (segmentEndTime - segmentStartTime).toFixed(0);
                        console.error(`[⏱️ TTS Segment ${i + 1}] Error after ${segmentTotalDuration}ms:`, error);
                        if (audioUrl) {
                            setTimeout(() => {
                                URL.revokeObjectURL(audioUrl);
                            }, 1000);
                        }
                    }
                }
                generationComplete = true;
                console.warn('[⏱️ TTS] All segments generated');
            };

            generateAndPlay();

            const controller = {
                get paused() {
                    return currentAudio ? currentAudio.paused : true;
                },
                pause() {
                    if (currentAudio) currentAudio.pause();
                },
                play() {
                    if (currentAudio) currentAudio.play();
                },
                stop() {
                    isStopped = true;
                    if (currentAudio) {
                        currentAudio.pause();
                        currentAudio.currentTime = 0;
                    }
                    audioQueue.forEach(({ url }) => {
                        setTimeout(() => {
                            URL.revokeObjectURL(url);
                        }, 1000);
                    });
                    audioQueue.length = 0;
                },
                addEventListener(event, handler) {
                    if (event === 'ended') {
                        let hasTriggered = false;
                        const checkEnded = () => {
                            if (audioQueue.length === 0 && currentAudio && currentAudio.ended) {
                                if (!hasTriggered) {
                                    hasTriggered = true;
                                    clearInterval(interval);
                                    handler();
                                }
                            }
                        };
                        const interval = setInterval(checkEnded, 100);
                        // 5分钟后强制清理（防止内存泄漏）
                        setTimeout(() => {
                            if (!hasTriggered) {
                                clearInterval(interval);
                            }
                        }, 300000);
                    }
                },
                async getAudioBlob() {
                    // 等待所有音频生成完成（不需要等播放完成）
                    while (!generationComplete && !isStopped) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }

                    if (allAudioBlobs.length === 0) return null;
                    if (allAudioBlobs.length === 1) return allAudioBlobs[0];

                    // 合并多个音频片段
                    console.warn('[TTS Download] Merging', allAudioBlobs.length, 'audio segments...');
                    return await mergeWavBlobs(allAudioBlobs);
                },
                getAllAudioBlobs() {
                    // 返回所有音频 blobs
                    return allAudioBlobs;
                }
            };

            return controller;
        } catch (error) {
            console.error('Error generating speech:', error);
            throw error;
        }
    }

    setVoice(voice) {
        this.voice = voice;
    }

    getAvailableVoices() {
        // 返回所有 54 个语音
        return VOICES.map(v => v.id);
    }
}
