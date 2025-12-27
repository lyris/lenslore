import { AutoProcessor, AutoModelForVision2Seq, env, RawImage } from '@huggingface/transformers';
import { config } from './config.js';

// Configure transformers.js
env.allowLocalModels = config.models.vision.useLocal;
env.allowRemoteModels = true;
env.backends.onnx.wasm.numThreads = 1;

// 启用浏览器缓存优先策略（优先使用 Cache API 和 Service Worker）
env.useBrowserCache = true;
env.useFSCache = true;

// 配置镜像服务器（必须在全局 env 设置，不能在 from_pretrained 的 options 里设置）
if (config.mirror.enabled && config.mirror.url) {
    env.remoteHost = config.mirror.url;
    // HuggingFace 的标准路径模板是 {model}/resolve/{revision}/
    // 我们的镜像也遵循这个格式
    env.remotePathTemplate = '{model}/resolve/{revision}/';
    console.warn(`[ImageAnalyzer] ✅ Global mirror configured: ${config.mirror.url}`);
} else {
    console.warn(`[ImageAnalyzer] ⚠️ Using default HuggingFace host (mirror not enabled)`);
}

// 已移除分块下载功能（不稳定，已删除）



export class ImageAnalyzer {
    constructor() {
        this.model = null;
        this.processor = null;
        this.modelId = config.models.vision.useLocal
            ? config.models.vision.localPath
            : config.models.vision.id;
    }

    async init(progressCallback) {
        // 根据用户偏好决定加载策略
        const devicePref = config.models.vision.devicePreference;
        const hasWebGPU = 'gpu' in navigator;

        // 根据偏好和浏览器能力确定加载尝试列表
        let loadAttempts = [];

        if (devicePref === 'webgpu') {
            // 强制 WebGPU
            if (!hasWebGPU) {
                throw new Error('WebGPU not supported in this browser. Please switch to Auto or WASM mode.');
            }
            loadAttempts = [{ dtype: 'fp32', device: 'webgpu', vramNeeded: '~1.6GB VRAM' }];
        } else if (devicePref === 'wasm') {
            // 强制 WASM
            loadAttempts = [{ dtype: 'fp32', device: 'wasm', vramNeeded: 'CPU mode (no GPU)' }];
        } else {
            // 自动模式：优先 WebGPU，失败则 WASM
            if (hasWebGPU) {
                loadAttempts = [
                    { dtype: 'fp32', device: 'webgpu', vramNeeded: '~1.6GB VRAM' },
                    { dtype: 'fp32', device: 'wasm', vramNeeded: 'CPU mode (no GPU)' }
                ];
            } else {
                console.warn('[ImageAnalyzer] No WebGPU support, using WASM directly');
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
        }

        // 依次尝试每个配置
        for (let i = 0; i < loadAttempts.length; i++) {
            const { dtype, device, vramNeeded } = loadAttempts[i];

            try {
                console.log(`[ImageAnalyzer] 🔄 Attempt ${i + 1}/${loadAttempts.length}: ${dtype.toUpperCase()}/${device.toUpperCase()} (${vramNeeded})`);

                // 通知用户当前尝试
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

                console.log(`✅ [ImageAnalyzer] Successfully loaded: ${dtype.toUpperCase()}/${device.toUpperCase()}`);
                return this.model;

            } catch (error) {
                const errorMsg = error.message || '';
                console.error(`❌ [ImageAnalyzer] Failed ${dtype}/${device}:`, errorMsg);

                // 检查是否应该尝试降级到下一个配置
                const shouldFallback =
                    // 显存/内存不足错误
                    errorMsg.includes('allocation') ||
                    errorMsg.includes('out of memory') ||
                    errorMsg.includes('OOM') ||
                    errorMsg.includes('CreateBuffer') ||
                    errorMsg.includes('Aborted') ||  // WASM/WebGPU 内存分配失败
                    errorMsg.includes('memory') ||
                    // WebGPU 不可用错误
                    errorMsg.includes('no available backend') ||
                    errorMsg.includes('Failed to get GPU adapter') ||
                    errorMsg.includes('enable-unsafe-webgpu') ||
                    errorMsg.includes('webgpu');

                if (shouldFallback && i < loadAttempts.length - 1) {
                    const nextAttempt = loadAttempts[i + 1];

                    // 判断失败原因
                    const isWebGPUUnavailable = errorMsg.includes('backend') ||
                                               errorMsg.includes('GPU adapter') ||
                                               errorMsg.includes('webgpu');

                    const reason = isWebGPUUnavailable ?
                        'WebGPU unavailable' :
                        'GPU memory insufficient';

                    console.warn(`⚠️ [ImageAnalyzer] ${reason} for ${dtype}/${device}, switching to CPU mode...`);

                    // 通知用户：切换到 CPU 模式
                    if (progressCallback) {
                        progressCallback({
                            progress: 'Downgrading',
                            stage: 'fallback',
                            dtype: dtype,
                            device: device,
                            attemptInfo: `${reason}, switching to CPU mode (${nextAttempt.dtype.toUpperCase()}/${nextAttempt.device.toUpperCase()})...`,
                            currentAttempt: i + 1,
                            totalAttempts: loadAttempts.length,
                            isDowngrade: true
                        });
                    }

                    // 继续下一个配置
                    continue;
                }

                if (i === loadAttempts.length - 1) {
                    // 所有配置都失败了
                    throw new Error(`❌ Failed to load vision model with all configurations. Please try refreshing the page. Last error: ${errorMsg}`);
                }

                // 继续尝试下一个配置（即使不是已知的可降级错误）
                if (i < loadAttempts.length - 1) {
                    console.warn(`⚠️ [ImageAnalyzer] Unknown error for ${dtype}/${device}, trying next configuration...`);
                    continue;
                }

                // 最后一次尝试失败，抛出错误
                throw error;
            }
        }
    }

    /**
     * 使用指定配置加载模型
     */
    async loadWithConfig(dtype, device, progressCallback, currentAttempt, totalAttempts) {
        // 存储配置
        this.currentConfig = { dtype, device };

        // 动态构建模型加载选项
        const modelOptions = {
            progress_callback: (progress) => {
                if (progressCallback) {
                    const percentage = progress.progress ?
                        Math.round(progress.progress) + '%' :
                        progress.status || '';

                    // 提取文件名和大小信息
                    const fileName = progress.file || 'unknown';
                    const loaded = progress.loaded ? (progress.loaded / 1024 / 1024).toFixed(1) : 0;
                    const total = progress.total ? (progress.total / 1024 / 1024).toFixed(1) : 0;
                    const sizeInfo = total > 0 ? ` (${loaded}/${total}MB)` : '';

                    progressCallback({
                        progress: percentage,
                        stage: 'processor',
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

        // Load processor (镜像已在全局 env 配置，这里不需要单独设置)
        this.processor = await AutoProcessor.from_pretrained(this.modelId, modelOptions);

        // 为模型加载准备选项，并复用/添加镜像配置
        const modelLoadOptions = {
            dtype: dtype,
            device: device,
            progress_callback: (progress) => {
                if (progressCallback) {
                    const percentage = progress.progress ?
                        Math.round(progress.progress) + '%' :
                        progress.status || '';

                    // 提取文件名和大小信息
                    const fileName = progress.file || 'unknown';
                    const loaded = progress.loaded ? (progress.loaded / 1024 / 1024).toFixed(1) : 0;
                    const total = progress.total ? (progress.total / 1024 / 1024).toFixed(1) : 0;
                    const sizeInfo = total > 0 ? ` (${loaded}/${total}MB)` : '';

                    progressCallback({
                        progress: percentage,
                        stage: 'model',
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

        // Load model (镜像已在全局 env 配置，这里不需要单独设置)
        this.model = await AutoModelForVision2Seq.from_pretrained(this.modelId, modelLoadOptions);
    }


    async analyze(imageCanvas, prompt = 'What do you see?') {
        if (!this.model || !this.processor) {
            throw new Error('Model not initialized. Call init() first.');
        }

        try {
            // Convert canvas to RawImage
            const imageUrl = imageCanvas.toDataURL();
            const image = await RawImage.fromURL(imageUrl);

            // Prepare messages in the format expected by SmolVLM
            const messages = [
                {
                    role: 'user',
                    content: [
                        { type: 'image', image: imageUrl },
                        { type: 'text', text: prompt }
                    ]
                }
            ];

            // Apply chat template to format the prompt
            const text = this.processor.apply_chat_template(messages, {
                add_generation_prompt: true
            });

            // Process inputs (tokenize text and encode image)
            const inputs = await this.processor(text, [image]);

            // Generate response
            const output = await this.model.generate({
                ...inputs,
                max_new_tokens: 1500,  // 增加到500个token,避免截断
                do_sample: false,
                repetition_penalty: 1.1
            });

            // Decode the generated tokens
            const decoded = this.processor.batch_decode(output, {
                skip_special_tokens: true
            });

            let response = decoded[0] || 'No response generated';

            // 提取 Assistant 的回复部分
            // 格式通常是: "User:\n\nWhat do you see?\nAssistant: [回复内容]"
            const assistantMatch = response.match(/Assistant:\s*([\s\S]*)/);
            if (assistantMatch && assistantMatch[1]) {
                response = assistantMatch[1].trim();
            }

            return response;
        } catch (error) {
            console.error('Error analyzing image:', error);
            throw error;
        }
    }
}
