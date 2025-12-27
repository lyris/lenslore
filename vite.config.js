import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // 将根目录设置为 'src'，这样开发服务器就能找到 index.html
  root: 'src',

  // .env 文件位置 - 在项目根目录而不是 src 目录
  envDir: '..',

  // 设置基础路径，用于部署到子目录
  // 开发环境使用 '/'，生产环境根据 BASE_URL 环境变量决定
  // 构建时使用: npm run build (默认 '/') 或 BASE_URL=/lenslore/ npm run build
  base: process.env.BASE_URL || '/',

  // PWA 相关配置 - 路径需要相对于 root 目录
  publicDir: '../public',

  // 构建配置
  build: {
    // 输出目录需要调整，以便在项目根目录下生成 'dist'
    outDir: '../dist',
    // 空目录
    emptyOutDir: true,
    // 生产环境优化
    minify: 'terser',
    terserOptions: {
      compress: {
        // 移除 console.log 但保留 console.error 和 console.warn
        pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.trace'],
        drop_debugger: true  // 移除 debugger 语句
      }
    },
    rollupOptions: {
      input: {
        // 路径需要使用绝对路径
        main: resolve(__dirname, 'src/index.html'),
        tts: resolve(__dirname, 'src/tts.html'),
        asr: resolve(__dirname, 'src/asr.html')
      },
      output: {
        // 手动代码分割 - 将 pinyin 相关库单独打包到 tts chunk
        manualChunks(id) {
          // pinyin 和 pinyin2ipa 只在 textToSpeech.js (完整版) 中使用
          // textToSpeechLite.js 不依赖这些库
          if (id.includes('node_modules/pinyin') || id.includes('node_modules/pinyin2ipa')) {
            return 'vendor-chinese'; // 单独打包中文依赖
          }
          // kokoro-js 和 transformers 被两个页面共享
          if (id.includes('node_modules/kokoro-js') || id.includes('node_modules/@huggingface/transformers')) {
            return 'vendor-ai'; // AI 模型相关库
          }
        }
      }
    }
  },

  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    }
    // 不使用代理：所有镜像请求通过 remote_host 配置直接访问远端服务器
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers']
  },
  resolve: {
    alias: {
      // 使用 pinyin2ipa 的浏览器构建版本,避免 CommonJS 模块问题
      'pinyin2ipa': 'pinyin2ipa/dist/pinyin2ipa.js'
    }
  }
});
