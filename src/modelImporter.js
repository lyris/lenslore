import { config } from './config.js';

export class ModelImporter {
    constructor() {
        // 使用 transformers.js 的缓存名称，避免重复缓存
        this.MODEL_CACHE_NAME = 'transformers-cache';
    }

    /**
     * 获取缓存状态
     * @returns {Promise<Object>} { vision: boolean, tts: boolean }
     */
    async getCacheStatus() {
        const cache = await caches.open(this.MODEL_CACHE_NAME);
        const keys = await cache.keys();
        
        // 检查关键文件是否存在
        const visionId = config.models.vision.id;
        const ttsId = config.models.tts.id;
        const asrId = config.models.asr.id;

        const hasVision = keys.some(req => req.url.includes(visionId) && req.url.includes('model'));
        const hasTTS = keys.some(req => req.url.includes(ttsId) && req.url.includes('model'));
        const hasASR = keys.some(req => req.url.includes(asrId) && req.url.includes('model'));

        return { vision: hasVision, tts: hasTTS, asr: hasASR };
    }

    /**
     * 导入文件到缓存
     * @param {string} type 'vision' | 'tts' | 'asr'
     * @param {FileList} files 用户选择的文件列表
     * @param {function} progressCallback 进度回调
     */
    async importFiles(type, files, progressCallback) {
        if (!files || files.length === 0) return;

        const cache = await caches.open(this.MODEL_CACHE_NAME);
        const modelId = type === 'vision' ? config.models.vision.id : 
                       type === 'tts' ? config.models.tts.id : 
                       config.models.asr.id;
                       
        const fileList = Array.from(files);
        let importedCount = 0;

        for (const file of fileList) {
            // 构建目标 URL
            // HuggingFace URL 格式: https://huggingface.co/{model_id}/resolve/main/{filename}
            
            // 特殊处理：有些文件在子目录中 (如 onnx/model.onnx)
            let remoteFileName = file.name;
            
            // 简单的文件名匹配逻辑
            if (file.name.endsWith('.onnx')) {
                // Vision 和 ASR 的 ONNX 文件通常在 onnx/ 子目录下
                if ((type === 'vision' || type === 'asr') && !file.name.includes('/')) {
                    remoteFileName = `onnx/${file.name}`;
                }
            }

            const targetUrl = `https://huggingface.co/${modelId}/resolve/main/${remoteFileName}`;
            
            console.log(`[ModelImporter] Importing ${file.name} -> ${targetUrl}`);

            try {
                // 创建 Response 对象
                const response = new Response(file, {
                    status: 200,
                    statusText: 'OK',
                    headers: new Headers({
                        'Content-Type': 'application/octet-stream',
                        'Content-Length': file.size.toString()
                    })
                });

                // 写入缓存
                await cache.put(targetUrl, response);
                importedCount++;

                if (progressCallback) {
                    progressCallback(importedCount, fileList.length, file.name);
                }
            } catch (e) {
                console.error(`[ModelImporter] Failed to import ${file.name}:`, e);
                throw new Error(`Failed to write ${file.name} to cache: ${e.message}`);
            }
        }

        // 标记对应类型已缓存，并在三类都完成时标记总状态
        try {
            localStorage.setItem(`lenslore_cached_${type}`, 'true');
            const vision = localStorage.getItem('lenslore_cached_vision') === 'true';
            const tts = localStorage.getItem('lenslore_cached_tts') === 'true';
            const asr = localStorage.getItem('lenslore_cached_asr') === 'true';
            if (vision && tts && asr) {
                localStorage.setItem('lenslore_models_cached', 'true');
                localStorage.setItem('lenslore_cached_at', new Date().toISOString());
            }
        } catch (e) {
            console.warn('[ModelImporter] Failed to mark cache status:', e);
        }
        
        return importedCount;
    }

    /**
     * 格式化文件大小
     */
    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}
