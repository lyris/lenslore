# LensLore - Browser-Based Vision & Speech

A pure browser-based image recognition and text-to-speech application that runs entirely on the client side using WebGPU.

**🚀 NEW: Progressive Web App (PWA) Support** - Install as a standalone app on mobile and desktop for complete offline access!

## Features

- **Image Recognition**: Uses SmolVLM-500M-Instruct via transformers.js for real-time image analysis
- **Text-to-Speech**: Uses Kokoro-82M TTS model for natural speech synthesis
- **Camera Support**: Real-time camera feed with front/back camera switching
- **No Server Required**: All processing happens in the browser using WebGPU
- **Privacy-First**: No data sent to external servers
- **Offline-Ready**: Models cached in browser for offline use after first load
- **PWA Support**: Install as standalone app, works completely offline
  - Add to home screen (iOS/Android)
  - Runs in standalone window (no browser UI)
  - Automatic updates
  - Persistent storage protection
- **Smart Loading**: 🆕 Lazy-load TTS in background for 25% faster startup
- **Resilient Download**: 🆕 Resumable download manager (for future optimizations)

## Technology Stack

- [Transformers.js](https://huggingface.co/docs/transformers.js) - Browser-based ML inference
- [Kokoro-js](https://github.com/thewh1teagle/kokoro-js) - Browser-based TTS
- [Vite](https://vitejs.dev/) - Fast development and build tool
- WebGPU - Hardware-accelerated ML inference

## Models Used

- **Vision**: [HuggingFaceTB/SmolVLM-500M-Instruct](https://huggingface.co/HuggingFaceTB/SmolVLM-500M-Instruct)
- **TTS**: [onnx-community/Kokoro-82M-v1.0-ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)

## Requirements

- Modern browser with WebGPU support (Chrome 113+, Edge 113+)
- Camera access permissions
- Sufficient RAM (~2GB recommended for models)

## Quick Start

### Installation

```bash
# Install dependencies
npm install

# Run development server
npm run dev
```

Visit `http://localhost:5173` in your browser.

### Build for Production

```bash
# Build for root path
npm run build

# Build for /lenslore/ subpath
npm run build:lenslore

# Build for /dist/ subpath
npm run build:dist

# Preview production build
npm run preview
```

## Usage

### Web Browser

1. Open the application in a WebGPU-compatible browser
2. Grant camera access when prompted
3. Wait for models to load (first load may take a few minutes - models are downloaded from HuggingFace CDN)
4. Models are automatically cached in browser for offline use
5. Click "Start" to begin real-time vision analysis
6. Toggle audio with the speaker icon
7. Switch cameras with the camera toggle icon (if multiple cameras available)

### PWA Installation (Recommended for Mobile)

**Android (Chrome/Edge):**

1. Visit the app URL in Chrome/Edge
2. Wait for models to download (one-time, ~330MB)
3. Tap the "Install" banner or menu → "Install app"
4. App will be added to your home screen
5. Launch from home screen - works completely offline!

**iOS (Safari):**

1. Visit the app URL in Safari
2. Wait for models to download (one-time, ~330MB)
3. Tap the Share button (□↑)
4. Select "Add to Home Screen"
5. Launch from home screen - works completely offline!

**Desktop (Chrome/Edge):**

1. Visit the app URL
2. Click the install icon (⊕) in the address bar
3. Click "Install" in the popup
4. App opens in standalone window

## Model Loading

### First Time Use

- Models (~300MB) are downloaded from HuggingFace CDN
- Download time: 3-5 minutes on WiFi, 5-10 minutes on 4G
- Recommend using WiFi for first load
- Models are cached in browser IndexedDB

### Subsequent Use

- Models load from browser cache (1-2 seconds)
- Works completely offline
- Zero network usage after first load
- Cache persists until browser data is cleared

### Mobile Use

Perfect for mobile offline scenarios:

- Download models once on WiFi
- Use anytime, anywhere (even in airplane mode)
- Zero data consumption after first load
- All processing happens locally

## Configuration

Configuration is in `src/config.js`:

```javascript
export const config = {
    // Mirror settings
    mirror: {
        enabled: false,  // Use official HuggingFace CDN
        url: 'https://huggingface.co'
    },

    // Model settings
    models: {
        vision: {
            id: 'HuggingFaceTB/SmolVLM-500M-Instruct',
            useLocal: false,  // Use browser cache (recommended)
            prompts: {
                detailed: 'Describe what you see...',
                // ... more prompts
            }
        },
        tts: {
            id: 'onnx-community/Kokoro-82M-v1.0-ONNX',
            useLocal: false,  // Use browser cache (recommended)
            defaultVoice: 'af_heart'
        }
    },

    // App settings
    app: {
        processingInterval: 1000,  // ms between captures
        lazyLoadTTS: true  // Load TTS in background
    }
};
```

## Project Structure

```
lenslore/
├── src/
│   ├── main.js              # Application entry point
│   ├── config.js            # Configuration
│   ├── imageAnalyzer.js     # Vision model integration
│   ├── textToSpeech.js      # TTS model integration
│   ├── cameraManager.js     # Camera management
│   ├── pwaManager.js        # PWA installation & management
│   ├── offlineHandler.js    # Offline status handling
│   ├── powerSaver.js        # Battery optimization
│   └── mobileOptimizer.js   # Mobile performance optimization
├── public/
│   ├── icons/               # PWA app icons
│   ├── manifest.json        # PWA manifest
│   └── sw.js                # Service Worker
├── ref/                     # Reference implementation (original server-based version)
├── scripts/
│   └── generate-icons.js    # PWA icon generator
├── index.html               # Main HTML file
├── vite.config.js           # Vite configuration
├── PWA-SETUP.md             # PWA setup guide
└── package.json             # Dependencies
```

## Browser Compatibility

| Browser     | WebGPU | PWA Install | Offline | Notes                    |
| ----------- | ------ | ----------- | ------- | ------------------------ |
| Chrome 113+ | ✅     | ✅          | ✅      | Full support             |
| Edge 113+   | ✅     | ✅          | ✅      | Full support             |
| Safari 16+  | ⚠️     | ✅          | ✅      | WebGPU partial support   |
| Firefox     | ⚠️     | ⚠️          | ✅      | WebGPU behind flag       |

## Performance Notes

- First load downloads models (~300MB total), subsequent loads use browser cache
- WebGPU provides hardware acceleration for faster inference
- Recommended 500-1000ms interval between captures for smooth performance
- Audio playback is skipped during processing to avoid overlaps
- Mobile devices: Adjust `processingInterval` based on device capability

## Troubleshooting

**Models not loading:**
- Ensure stable internet connection for first load
- Check browser console for specific errors
- Verify WebGPU support: visit `chrome://gpu/`

**Camera not working:**
- Grant camera permissions in browser settings
- Ensure HTTPS or localhost (required for camera access)
- Check if camera is not in use by another application

**Poor performance:**
- Increase `processingInterval` in `src/config.js`
- Close other browser tabs to free up memory
- Use a device with dedicated GPU for better WebGPU performance

**Offline not working:**

- Ensure models loaded successfully at least once
- Check browser IndexedDB is not disabled
- Don't clear browser data (will remove cached models)

## Advanced: Local Model Deployment

If you want to serve models from your own server (not recommended for low-bandwidth servers):

1. Download models using `huggingface-cli`:

```bash
pip install huggingface-hub

# Download SmolVLM
huggingface-cli download HuggingFaceTB/SmolVLM-500M-Instruct \
    --local-dir public/models/SmolVLM-500M-Instruct

# Download Kokoro TTS
huggingface-cli download onnx-community/Kokoro-82M-v1.0-ONNX \
    --local-dir public/models/Kokoro-82M-v1.0-ONNX
```

2. Update `src/config.js`:

```javascript
models: {
    vision: {
        useLocal: true,
        localPath: '/models/SmolVLM-256M-Instruct'
    },
    tts: {
        useLocal: true,
        localPath: '/models/Kokoro-82M-v1.0-ONNX'
    }
}
```

**Note**: This requires ~300MB server storage and bandwidth per user. Browser caching is more efficient.

## Migration from Server-Based Version

This project replaces the original server-based implementation (in `ref/` directory) with a pure browser-based solution:

| Original | Browser-Based |
|----------|---------------|
| llama-server + SmolVLM | transformers.js + SmolVLM-ONNX |
| Docker + Kokoro-82M | kokoro-js + Kokoro-ONNX |
| Caddy gateway | Direct browser access |
| Backend API calls | Local inference |
| Server resources | Client-side WebGPU |

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
