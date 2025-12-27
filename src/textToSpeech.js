import { KokoroTTS } from 'kokoro-js';
import { config } from './config.js';
import { env } from '@huggingface/transformers';
import { pinyin } from 'pinyin';
// 使用浏览器构建版本的 pinyin2ipa (UMD 格式)
// 注意: Vite 会通过 alias 配置将其指向 dist/pinyin2ipa.js
import pinyin2ipaModule from 'pinyin2ipa';
const pinyin2ipa = pinyin2ipaModule.default || pinyin2ipaModule;
import { VOICES } from './voices.js';

// 启用浏览器缓存优先策略（优先使用 Cache API 和 Service Worker）
env.useBrowserCache = true;
env.useFSCache = true;

// 配置镜像服务器（必须在全局 env 设置）
if (config.mirror.enabled && config.mirror.url) {
    // transformers.js v3 需要同时设置这些属性
    env.remoteHost = config.mirror.url;
    env.remotePathTemplate = '{model}/resolve/{revision}/';

    // 对于 HuggingFace 镜像，需要确保 URL 格式正确
    // 如果镜像 URL 包含完整路径模板，直接使用
    if (config.mirror.url.includes('{model}')) {
        env.remotePathTemplate = config.mirror.url;
        env.remoteHost = '';
    }

    console.warn(`[TextToSpeech] ✅ Global mirror configured:`);
    console.warn(`[TextToSpeech]   remoteHost: ${env.remoteHost}`);
    console.warn(`[TextToSpeech]   remotePathTemplate: ${env.remotePathTemplate}`);
    console.warn(`[TextToSpeech]   Expected URL format: ${env.remoteHost}/${env.remotePathTemplate.replace('{model}', 'MODEL_ID').replace('{revision}', 'REVISION')}`);

    // 验证 env 对象是否被正确设置
    console.warn(`[TextToSpeech] env object check:`, {
        useBrowserCache: env.useBrowserCache,
        useFSCache: env.useFSCache,
        remoteHost: env.remoteHost,
        remotePathTemplate: env.remotePathTemplate,
        backends: env.backends
    });
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
 * 扩展的 TextToSpeech 类，支持所有 54 个 Kokoro 语音
 * 通过移除语音验证来支持原始模型的所有语音
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
        // 根据用户配置选择设备（从 config 或 localStorage 读取）
        const devicePreference = config.models.tts?.devicePreference || 'wasm'; // 默认 WASM（更稳定）
        const hasWebGPU = 'gpu' in navigator;

        let loadAttempts = [];

        if (devicePreference === 'webgpu') {
            // 用户强制使用 WebGPU
            if (!hasWebGPU) {
                throw new Error('WebGPU not supported in this browser. Please switch to Auto or WASM mode in Settings.');
            }
            loadAttempts = [{ dtype: 'fp32', device: 'webgpu', vramNeeded: '~600MB VRAM' }];
            console.warn('[TTS] User preference: WebGPU mode');
        } else if (devicePreference === 'wasm') {
            // 用户强制使用 WASM
            loadAttempts = [{ dtype: 'fp32', device: 'wasm', vramNeeded: 'CPU mode (no GPU)' }];
            console.warn('[TTS] User preference: WASM mode (most stable)');
        } else {
            // 自动模式：优先 WASM（因为 WebGPU 有已知问题），失败则尝试 WebGPU
            // 注意：这里优先 WASM 而不是 WebGPU，因为 WebGPU 有 Float32Array 对齐问题
            if (hasWebGPU) {
                loadAttempts = [
                    { dtype: 'fp32', device: 'wasm', vramNeeded: 'CPU mode (no GPU)' },
                    { dtype: 'fp32', device: 'webgpu', vramNeeded: '~600MB VRAM' }
                ];
                console.warn('[TTS] Auto mode: trying WASM first (WebGPU has known stability issues)');
            } else {
                loadAttempts = [{ dtype: 'fp32', device: 'wasm', vramNeeded: 'CPU mode (no GPU)' }];
                console.warn('[TTS] No WebGPU support, using WASM directly');
            }
        }

        // 如果只有一个选项或强制模式，直接加载
        if (loadAttempts.length === 1 || devicePreference !== 'auto') {
            const { dtype, device } = loadAttempts[0];
            if (progressCallback) {
                progressCallback({
                    progress: 'Preparing',
                    stage: 'fallback',
                    dtype: dtype,
                    device: device,
                    attemptInfo: `Using ${device.toUpperCase()} mode`,
                    currentAttempt: 1,
                    totalAttempts: 1
                });
            }
            return this.loadWithConfig(dtype, device, progressCallback, 1, 1);
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

        // 在加载选项中也添加镜像配置（某些版本的 transformers.js 需要这样做）
        if (config.mirror.enabled && config.mirror.url) {
            // 尝试通过 session 选项传递镜像配置
            modelLoadOptions.session = {
                remoteHost: config.mirror.url,
                remotePathTemplate: '{model}/resolve/{revision}/'
            };
            console.warn(`[TextToSpeech] Adding mirror config to model load options`);
        }

        this.kokoro = await KokoroTTS.from_pretrained(this.modelId, modelLoadOptions);

        // 关键：移除 kokoro 内部的语音验证，支持所有 54 个语音
        if (this.kokoro && this.kokoro._validate_voice) {
            console.warn('[TTS] Patching voice validation to support all 54 voices');
            this.kokoro._validate_voice = function(voice) {
                // 扩展的语音列表 - 包含所有 54 个语音
                const allVoices = VOICES.map(v => v.id);

                if (!allVoices.includes(voice)) {
                    throw new Error(`Voice "${voice}" not found. Should be one of: ${allVoices.join(', ')}`);
                }

                // 返回语音ID的首字符（语言代码：'a' for American English, 'b' for British, etc）
                // 这是 kokoro.js 内部 generate() 方法需要的返回值
                return voice.at(0);
            };
        }

        // 测试：尝试实际生成一小段音频来验证
        try {
            console.warn('[TTS] Testing audio generation with short text...');
            const testVoice = config.models.tts.defaultVoice || 'af_heart';
            const testText = "Hi";  // 非常短的文本

            // 尝试实际生成音频
            const testAudio = await this.kokoro.generate(testText, { voice: testVoice });
            console.warn('[TTS] Test generation successful, audio type:', testAudio.constructor.name);
            console.warn('[TTS] Audio has toBlob method:', typeof testAudio.toBlob === 'function');
        } catch (testError) {
            console.error('[TTS] Test generation failed:', testError);
            console.error('[TTS] Error message:', testError.message);
            console.error('[TTS] This indicates a problem with kokoro.js or the voice files');
        }
    }

    isReady() {
        return this.initialized && this.kokoro !== null;
    }

    /**
     * 中文文本转 IPA phonemes
     * @param {string} text 中文文本
     * @returns {string} IPA phonemes
     */
    chineseToIPA(text) {
        try {
            // 第一步：中文字符 → pinyin (with tone numbers like zhong1)
            const pinyinResult = pinyin(text, {
                style: pinyin.STYLE_TONE2,  // 数字声调的拼音 (zhong1 guo2) - pinyin2ipa更好支持
                heteronym: false,            // 不显示多音字的所有读音
                segment: true                // 启用分词
            });

            // pinyin() 返回二维数组: [['zhong1'], ['guo2']]
            // 将其扁平化并用空格连接: "zhong1 guo2"
            const pinyinText = pinyinResult.map(item => item[0]).join(' ');

            console.warn(`[🔍 Chinese G2P] Original text: "${text}"`);
            console.warn(`[🔍 Chinese G2P] Pinyin (TONE2): "${pinyinText}"`);

            // 第二步：pinyin → IPA (逐个转换以处理失败的情况)
            const pinyinArray = pinyinText.split(' ');
            const ipaArray = [];

            for (let py of pinyinArray) {
                const ipa = pinyin2ipa(py);
                if (ipa && ipa.trim()) {
                    ipaArray.push(ipa.trim());
                } else {
                    // 如果 pinyin2ipa 无法转换，使用原始拼音
                    console.warn(`[🔍 Chinese G2P] Warning: Failed to convert "${py}", using original`);
                    ipaArray.push(py);
                }
            }

            let ipaText = ipaArray.join(' ');

            // 在 IPA 末尾添加句子结束标记，帮助模型识别句子边界
            ipaText = ipaText.trim() + ' .';

            console.warn(`[🔍 Chinese G2P] IPA: "${ipaText}"`);

            return ipaText;
        } catch (error) {
            console.error('[Chinese G2P] Error:', error);
            // 如果转换失败，返回原文本
            return text;
        }
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
                        console.warn(`[🔍 TTS Generation] Language code type: ${typeof lang}, value: "${lang}"`);
                        console.warn(`[🔍 TTS Generation] Comparison check: lang === 'a'? ${lang === 'a'}, lang === 'b'? ${lang === 'b'}`);

                        let audioOutput;

                        // 所有语言统一使用 generate 方法（kokoro 会自动处理音素化）
                        console.warn(`[🔍 TTS Generation] Calling generate method...`);
                        try {
                            audioOutput = await this.kokoro.generate(sentence, {
                                voice: voiceToUse
                            });
                            console.warn(`[🔍 TTS Generation] Generate complete, audio type:`, audioOutput.constructor.name);
                        } catch (generateError) {
                            console.error(`[🔍 TTS Generation] Generate failed:`, generateError);
                            console.error(`[🔍 TTS Generation] Error stack:`, generateError.stack);
                            throw generateError;
                        }

                        // 保留旧的分支逻辑以便调试
                        if (false && (lang === 'a' || lang === 'b')) {
                            // 英语：使用 generate 方法（包含音素化）
                            console.warn(`[🔍 TTS Generation] Branch: Using phonemization for English`);
                            audioOutput = await this.kokoro.generate(sentence, {
                                voice: voiceToUse
                            });
                            console.warn(`[🔍 TTS Generation] English phonemization complete`);
                        } else if (false) {
                            // 非英语：需要特殊处理
                            console.warn(`[🔍 TTS Generation] Branch: Non-English language (${lang})`);

                            let textToTokenize = sentence;

                            // 中文需要特殊的 G2P 转换
                            if (lang === 'z') {
                                console.warn(`[🔍 TTS Generation] Chinese detected, performing G2P conversion...`);
                                textToTokenize = this.chineseToIPA(sentence);
                                console.warn(`[🔍 TTS Generation] After G2P: "${textToTokenize}"`);
                            } else {
                                console.warn(`[🔍 TTS Generation] Language ${lang} - using direct text tokenization`);
                            }

                            // Tokenize IPA/phonemes
                            const tokenResult = this.kokoro.tokenizer(textToTokenize, {
                                truncation: true
                            });
                            console.warn(`[🔍 TTS Generation] input_ids dims:`, tokenResult.input_ids.dims);
                            console.warn(`[🔍 TTS Generation] input_ids data (first 20):`, Array.from(tokenResult.input_ids.data).slice(0, 20));

                            audioOutput = await this.kokoro.generate_from_ids(tokenResult.input_ids, {
                                voice: voiceToUse
                            });
                            console.warn(`[🔍 TTS Generation] Non-English generation complete`);
                        }

                        console.warn(`[🔍 TTS Generation] Audio generated successfully`);

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