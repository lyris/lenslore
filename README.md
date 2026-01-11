# LensLore - 纯浏览器端识图与语音播报

一个完全运行在浏览器端的图像识别和语音合成应用，使用 WebGPU 加速，无需服务器支持。

**🚀 核心特性：PWA 渐进式 Web 应用** - 可安装为独立应用，支持完全离线使用！

## ✨ 主要特性

- **📷 图像识别**：使用 SmolVLM-500M-Instruct 模型（通过 transformers.js）进行实时图像分析
- **🔊 语音合成**：使用 Kokoro-82M TTS 模型进行自然语音播报
- **📱 摄像头支持**：实时摄像头画面，支持前后摄像头切换
- **🚫 无需服务器**：所有处理都在浏览器中使用 WebGPU 完成
- **🔒 隐私优先**：不向外部服务器发送任何数据
- **📦 离线就绪**：首次加载后模型缓存在浏览器中，完全离线可用
- **📲 PWA 支持**：可安装为独立应用，完全离线工作
  - 添加到主屏幕（iOS/Android）
  - 独立窗口运行（无浏览器界面）
  - 自动更新
  - 持久化存储保护
- **🌐 镜像支持**：支持 HuggingFace 镜像（国内可配置代理加速下载）
- **⚡ 智能加载**：优化的模型加载策略，更快启动
- **🔄 断点续传**：支持下载中断后恢复（未来优化）

## 🛠️ 技术栈

- [Transformers.js](https://huggingface.co/docs/transformers.js) `3.8.1` - 浏览器端机器学习推理
- [Kokoro-js](https://github.com/thewh1teagle/kokoro-js) `1.2.1` - 浏览器端语音合成
- [Vite](https://vitejs.dev/) `5.4.21` - 快速开发和构建工具
- WebGPU - 硬件加速的机器学习推理
- Service Worker + IndexedDB - PWA 离线支持

## 🤖 使用的模型

- **视觉模型**: [HuggingFaceTB/SmolVLM-500M-Instruct](https://huggingface.co/HuggingFaceTB/SmolVLM-500M-Instruct) (~250MB)
- **语音模型**: [onnx-community/Kokoro-82M-v1.0-ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) (~80MB)
- **总计**: ~330MB (首次下载，之后从浏览器缓存加载)

## 📋 系统要求

- 支持 WebGPU 的现代浏览器（Chrome 113+、Edge 113+）
- 摄像头访问权限
- 足够的内存（推荐 2GB 以上用于模型加载）
- 首次使用需要稳定的网络连接（下载模型）

## 🚀 快速开始

### 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

访问浏览器打开 `http://localhost:5173`

### 生产构建

```bash
# 构建到 /lenslore/ 子路径（默认）
npm run build

# 预览构建结果
npm run preview

# 部署到服务器
npm run deploy
```

构建后的文件在 `dist/` 目录，需要通过 HTTPS 部署才能使用 PWA 功能。

## 📖 使用指南

### 浏览器中使用

1. 在支持 WebGPU 的浏览器中打开应用
2. 授予摄像头访问权限
3. 等待模型加载（首次加载需要几分钟 - 从 HuggingFace CDN 下载模型）
4. 模型自动缓存到浏览器，供离线使用
5. 点击"开始"按钮开始实时视觉分析
6. 点击扬声器图标切换语音播报
7. 点击摄像头切换图标切换前后摄像头（如果有多个摄像头）

### PWA 安装（推荐移动端使用）

**Android (Chrome/Edge)：**

1. 在 Chrome/Edge 中访问应用 URL
2. 等待模型下载（首次，约 330MB）
3. 点击"安装"横幅或菜单 → "安装应用"
4. 应用将添加到主屏幕
5. 从主屏幕启动 - 完全离线工作！

**iOS (Safari)：**

1. 在 Safari 中访问应用 URL
2. 等待模型下载（首次，约 330MB）
3. 点击分享按钮 (□↑)
4. 选择"添加到主屏幕"
5. 从主屏幕启动 - 完全离线工作！

**桌面端 (Chrome/Edge)：**

1. 访问应用 URL
2. 点击地址栏中的安装图标 (⊕)
3. 在弹窗中点击"安装"
4. 应用在独立窗口中打开

## 📥 模型加载说明

### 首次使用

- 模型（约 330MB）从 HuggingFace CDN 下载
- 下载时间：WiFi 约 3-5 分钟，4G 约 5-10 分钟
- **国内用户**：可配置镜像源加速下载（见配置章节）
- 推荐使用 WiFi 进行首次加载
- 模型缓存在浏览器 IndexedDB 中

### 后续使用

- 模型从浏览器缓存加载（1-2 秒）
- 完全离线工作
- 首次加载后零网络使用
- 缓存持久化，直到手动清除浏览器数据

### 移动端使用场景

非常适合移动端离线场景：

- WiFi 环境下载一次模型
- 随时随地使用（甚至飞行模式下）
- 首次加载后零流量消耗
- 所有处理都在本地完成

## ⚙️ 配置说明

配置文件位于 [src/config.js](src/config.js)，主要配置项：

### 镜像配置（国内用户推荐）

```javascript
mirror: {
    enabled: true,  // 是否启用镜像
    url: import.meta.env.VITE_HUGGINGFACE_MIRROR_URL  // 镜像地址
}
```

**配置镜像：**

1. 复制 `.env.example` 为 `.env`
2. 设置 `VITE_HUGGINGFACE_MIRROR_URL` 为你的 Cloudflare Worker 域名
3. 或使用公共镜像服务（如 `https://hf-mirror.com`）

### 模型配置

```javascript
models: {
    vision: {
        id: 'HuggingFaceTB/SmolVLM-500M-Instruct',
        devicePreference: 'auto',  // 'auto' | 'webgpu' | 'wasm'
        prompts: {
            detailed: 'Describe what you see...',
            brief: 'Describe this image briefly.',
            // ... 更多提示词
        },
        currentPrompt: 'detailed'  // 当前使用的提示词
    },
    tts: {
        id: 'onnx-community/Kokoro-82M-v1.0-ONNX',
        devicePreference: 'wasm',  // TTS 推荐使用 wasm（更稳定）
        defaultVoice: 'af_heart'
    }
}
```

### 应用配置

```javascript
app: {
    processingInterval: 1000,  // 处理间隔（毫秒）
    lazyLoadTTS: false,  // 是否后台加载 TTS
    memoryOptimization: {
        checkMemory: true,  // 内存检查
        skipTTSOnLowMemory: true  // 低内存时跳过 TTS
    }
}
```

**性能调优建议：**

- 旗舰手机：`processingInterval: 500`
- 中端手机：`processingInterval: 1000`（默认）
- 入门手机：`processingInterval: 2000`

## 📁 项目结构

```text
lenslore/
├── src/
│   ├── main.js              # 应用入口
│   ├── config.js            # 配置文件
│   ├── imageAnalyzer.js     # 视觉模型集成
│   ├── textToSpeech.js      # TTS 模型集成
│   ├── cameraManager.js     # 摄像头管理
│   ├── pwaManager.js        # PWA 安装和管理
│   ├── offlineHandler.js    # 离线状态处理
│   ├── powerSaver.js        # 电池优化
│   └── mobileOptimizer.js   # 移动端性能优化
├── public/
│   ├── icons/               # PWA 应用图标
│   ├── manifest.json        # PWA 清单
│   └── sw.js                # Service Worker
├── ref/                     # 参考实现（原服务器端版本）
├── scripts/
│   ├── generate-icons.js    # PWA 图标生成器
│   ├── update-sw-core-assets.js  # SW 资源更新
│   └── deploy.js            # 部署脚本
├── index.html               # 主 HTML 文件
├── vite.config.js           # Vite 配置
├── PWA-SETUP.md             # PWA 设置指南
├── CLAUDE.md                # 项目开发说明
└── package.json             # 依赖配置
```

## 🌐 浏览器兼容性

| 浏览器      | WebGPU | PWA 安装 | 离线使用 | 备注                    |
| ----------- | ------ | -------- | -------- | ----------------------- |
| Chrome 113+ | ✅     | ✅       | ✅       | 完全支持                |
| Edge 113+   | ✅     | ✅       | ✅       | 完全支持                |
| Safari 16+  | ⚠️     | ✅       | ✅       | WebGPU 部分支持         |
| Firefox     | ⚠️     | ⚠️       | ✅       | WebGPU 需启用 Flag      |

## ⚡ 性能说明

- 首次加载下载模型（约 330MB），后续从浏览器缓存加载
- WebGPU 提供硬件加速，推理速度更快
- 推荐捕获间隔 500-1000ms 以保持流畅性能
- 处理期间跳过语音播放，避免重叠
- 移动设备：根据设备性能调整 `processingInterval`
- 低内存设备自动跳过 TTS 加载

## 🔧 故障排除

### 模型无法加载

- 确保首次加载时有稳定的网络连接
- 检查浏览器控制台查看具体错误
- 验证 WebGPU 支持：访问 `chrome://gpu/`
- **国内用户**：配置镜像源（见配置章节）
- 尝试清除浏览器缓存后重新加载

### 摄像头无法工作

- 在浏览器设置中授予摄像头权限
- 确保使用 HTTPS 或 localhost（摄像头访问必需）
- 检查摄像头是否被其他应用占用
- 尝试刷新页面重新请求权限

### 性能较差

- 增加 [src/config.js](src/config.js) 中的 `processingInterval`
- 关闭其他浏览器标签页释放内存
- 使用带独立 GPU 的设备以获得更好的 WebGPU 性能
- 关闭语音播报以节省资源

### 离线功能无法使用

- 确保模型至少成功加载过一次
- 检查浏览器 IndexedDB 未被禁用
- 不要清除浏览器数据（会删除缓存的模型）
- 检查 Service Worker 是否正常注册

## 🔬 高级：本地模型部署

如果你想从自己的服务器提供模型（不推荐低带宽服务器）：

### 1. 下载模型

使用 `huggingface-cli` 下载模型：

```bash
pip install huggingface-hub

# 下载 SmolVLM 视觉模型
huggingface-cli download HuggingFaceTB/SmolVLM-500M-Instruct \
    --local-dir public/models/SmolVLM-500M-Instruct

# 下载 Kokoro TTS 模型
huggingface-cli download onnx-community/Kokoro-82M-v1.0-ONNX \
    --local-dir public/models/Kokoro-82M-v1.0-ONNX
```

### 2. 修改配置

更新 [src/config.js](src/config.js)：

```javascript
models: {
    vision: {
        useLocal: true,
        localPath: '/models/SmolVLM-500M-Instruct'
    },
    tts: {
        useLocal: true,
        localPath: '/models/Kokoro-82M-v1.0-ONNX'
    }
}
```

**注意**：这需要约 330MB 服务器存储空间，并且每个用户都会消耗带宽。浏览器缓存方式更高效。

## 📦 从服务器版本迁移

本项目替代了原有的服务器端实现（位于 `ref/` 目录），采用纯浏览器端方案：

| 原有方案               | 浏览器端方案                   |
| ---------------------- | ------------------------------ |
| llama-server + SmolVLM | transformers.js + SmolVLM-ONNX |
| Docker + Kokoro-82M    | kokoro-js + Kokoro-ONNX        |
| Caddy 网关             | 浏览器直接访问                 |
| 后端 API 调用          | 本地推理                       |
| 服务器资源             | 客户端 WebGPU                  |
| 需要服务器运维         | 静态文件托管即可               |

**优势：**

- ✅ 无需维护服务器和 Docker 容器
- ✅ 无需 GPU 服务器（用户设备提供算力）
- ✅ 完全离线可用
- ✅ 零服务器运行成本
- ✅ 更好的隐私保护

## 📝 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 🤝 贡献

欢迎贡献！请提交 Issue 或 Pull Request。

## 📚 相关文档

- [PWA 设置指南](PWA-SETUP.md) - PWA 配置详细说明
- [CLAUDE.md](CLAUDE.md) - 项目开发说明和未来计划
- [参考实现](ref/) - 原服务器端实现代码

## 🔗 相关链接

- [Transformers.js 文档](https://huggingface.co/docs/transformers.js)
- [Kokoro-js GitHub](https://github.com/thewh1teagle/kokoro-js)
- [SmolVLM 模型](https://huggingface.co/HuggingFaceTB/SmolVLM-500M-Instruct)
- [Kokoro TTS 模型](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)

---

Made with ❤️ using transformers.js and kokoro-js
