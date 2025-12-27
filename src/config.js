// 应用配置文件

export const config = {
    // 镜像配置
    mirror: {
        // 是否使用HuggingFace镜像 (由用户在UI中选择)
        enabled: true,  // 默认开启镜像，首次访问即可走镜像
        // 镜像地址配置 - transformers.js v3 支持直接指定镜像 host
        // 【重要】请将下方的 URL 替换为您刚刚搭建的 Cloudflare Worker 域名 (例如 https://hf.your-domain.com)
        // 开发环境: 使用 Vite 代理避免 CORS 问题
        // 生产环境: 使用您的 Cloudflare Worker 自定义域名
        url: import.meta.env.VITE_HUGGINGFACE_MIRROR_URL
    },

    // 模型配置
    models: {
        asr: {
            id: 'Xenova/whisper-base',
            useLocal: false,
            localPath: '/models/whisper-base'
        },
        vision: {
            // 模型ID (使用官方HuggingFaceTB的公开模型)
            id: 'HuggingFaceTB/SmolVLM-500M-Instruct',
            // 是否使用本地模型 (移动端建议false,使用浏览器缓存)
            useLocal: false,
            // 本地模型路径 (如果useLocal为true)
            localPath: '/models/SmolVLM-500M-Instruct',
            // 设备偏好 (由用户在UI中选择)
            // 'auto': 自动选择（优先 webgpu，失败则 wasm）
            // 'webgpu': 强制使用 WebGPU (GPU加速)
            // 'wasm': 强制使用 WASM (CPU模式)
            devicePreference: 'auto',
            // 识图提示词配置
            prompts: {
                // 默认提示词 (简洁描述)
                default: 'Describe this image in 2-3 concise sentences.',
                // 其他可选提示词
                brief: 'Describe this image briefly.',
                detailed: 'Describe what you see in plain text, without any formatting or markdown. Be natural and conversational.',
                single: 'Describe in one sentence.',
                subject: "What's the main subject?"
            },
            // 当前使用的提示词 (从上面选择一个 key)
            currentPrompt: 'detailed'
        },
        tts: {
            // 模型ID (使用v1.0版本)
            id: 'onnx-community/Kokoro-82M-v1.0-ONNX',
            // 是否使用本地模型 (移动端建议false,使用浏览器缓存)
            useLocal: false,
            // 本地模型路径
            localPath: '/models/Kokoro-82M-ONNX',
            // 默认语音
            defaultVoice: 'af_heart',
            // 设备偏好 (由用户在UI中选择)
            // 'auto': 自动选择（优先 wasm，失败则 webgpu）
            // 'webgpu': 强制使用 WebGPU (GPU加速，但可能不稳定)
            // 'wasm': 强制使用 WASM (CPU模式，稳定)
            devicePreference: 'wasm'  // 默认 WASM（最稳定）
        },
        // 手动导入所需的文件列表
        fileLists: {
            asr: [
                'config.json',
                'preprocessor_config.json',
                'tokenizer_config.json',
                'generation_config.json',
                'vocab.json',
                'onnx/encoder_model.onnx',
                'onnx/decoder_model_merged.onnx'
            ],
            vision: [
                'config.json',
                'preprocessor_config.json',
                'tokenizer.json',
                'tokenizer_config.json',
                'onnx/model.onnx',
                'onnx/model_fp16.onnx'
            ],
            tts: [
                'config.json',
                'model.onnx'
            ]
        }
    },

    // 应用配置
    app: {
        // 处理间隔 (毫秒)
        // 移动端推荐: 旗舰机500ms, 中端机1000ms, 入门机2000ms
        processingInterval: 1000,  // 移动端优化默认值
        // 是否在后台加载TTS
        // false: 串行加载，等待 Vision + TTS 都完成才开始（更稳定，首次慢）
        // true: 并行加载，Vision 完成后立即可用，TTS 后台下载（体验更快）
        lazyLoadTTS: false,  // 改为串行加载
        // 内存优化选项
        memoryOptimization: {
            // 启用内存检查
            checkMemory: true,
            // 低内存设备自动跳过 TTS
            skipTTSOnLowMemory: true,
            // 定期触发垃圾回收提示
            periodicGC: false
        }
    }
};
