// Kokoro TTS 语音列表定义

export const VOICES = [
    // 🇺🇸 American English - Female
    { id: 'af_heart', name: 'Heart', gender: 'Female', lang: 'en-us', grade: 'A', recommended: true },
    { id: 'af_bella', name: 'Bella', gender: 'Female', lang: 'en-us', grade: 'A-' },
    { id: 'af_nicole', name: 'Nicole', gender: 'Female', lang: 'en-us', grade: 'B-' },
    { id: 'af_aoede', name: 'Aoede', gender: 'Female', lang: 'en-us', grade: 'C+' },
    { id: 'af_kore', name: 'Kore', gender: 'Female', lang: 'en-us', grade: 'C+' },
    { id: 'af_sarah', name: 'Sarah', gender: 'Female', lang: 'en-us', grade: 'C+' },
    { id: 'af_alloy', name: 'Alloy', gender: 'Female', lang: 'en-us', grade: 'C' },
    { id: 'af_nova', name: 'Nova', gender: 'Female', lang: 'en-us', grade: 'C' },
    { id: 'af_sky', name: 'Sky', gender: 'Female', lang: 'en-us', grade: 'C-' },
    { id: 'af_jessica', name: 'Jessica', gender: 'Female', lang: 'en-us', grade: 'D' },
    { id: 'af_river', name: 'River', gender: 'Female', lang: 'en-us', grade: 'D' },

    // 🇺🇸 American English - Male
    { id: 'am_michael', name: 'Michael', gender: 'Male', lang: 'en-us', grade: 'C+' },
    { id: 'am_fenrir', name: 'Fenrir', gender: 'Male', lang: 'en-us', grade: 'C+' },
    { id: 'am_puck', name: 'Puck', gender: 'Male', lang: 'en-us', grade: 'C+' },
    { id: 'am_echo', name: 'Echo', gender: 'Male', lang: 'en-us', grade: 'D' },
    { id: 'am_eric', name: 'Eric', gender: 'Male', lang: 'en-us', grade: 'D' },
    { id: 'am_liam', name: 'Liam', gender: 'Male', lang: 'en-us', grade: 'D' },
    { id: 'am_onyx', name: 'Onyx', gender: 'Male', lang: 'en-us', grade: 'D' },
    { id: 'am_santa', name: 'Santa', gender: 'Male', lang: 'en-us', grade: 'D-' },
    { id: 'am_adam', name: 'Adam', gender: 'Male', lang: 'en-us', grade: 'F+' },

    // 🇬🇧 British English - Female
    { id: 'bf_emma', name: 'Emma', gender: 'Female', lang: 'en-gb', grade: 'B-' },
    { id: 'bf_isabella', name: 'Isabella', gender: 'Female', lang: 'en-gb', grade: 'C' },
    { id: 'bf_alice', name: 'Alice', gender: 'Female', lang: 'en-gb', grade: 'D' },
    { id: 'bf_lily', name: 'Lily', gender: 'Female', lang: 'en-gb', grade: 'D' },

    // 🇬🇧 British English - Male
    { id: 'bm_fable', name: 'Fable', gender: 'Male', lang: 'en-gb', grade: 'C' },
    { id: 'bm_george', name: 'George', gender: 'Male', lang: 'en-gb', grade: 'C' },
    { id: 'bm_lewis', name: 'Lewis', gender: 'Male', lang: 'en-gb', grade: 'D+' },
    { id: 'bm_daniel', name: 'Daniel', gender: 'Male', lang: 'en-gb', grade: 'D' },

    // 🇯🇵 Japanese - Female
    { id: 'jf_alpha', name: 'Alpha', gender: 'Female', lang: 'ja', grade: 'C+' },
    { id: 'jf_gongitsune', name: 'Gongitsune', gender: 'Female', lang: 'ja', grade: 'C' },
    { id: 'jf_tebukuro', name: 'Tebukuro', gender: 'Female', lang: 'ja', grade: 'C' },
    { id: 'jf_nezumi', name: 'Nezumi', gender: 'Female', lang: 'ja', grade: 'C-' },

    // 🇯🇵 Japanese - Male
    { id: 'jm_kumo', name: 'Kumo', gender: 'Male', lang: 'ja', grade: 'C-' },

    // 🇨🇳 Mandarin Chinese - Female
    { id: 'zf_xiaobei', name: 'Xiaobei (小贝)', gender: 'Female', lang: 'zh', grade: 'D' },
    { id: 'zf_xiaoni', name: 'Xiaoni (小妮)', gender: 'Female', lang: 'zh', grade: 'D' },
    { id: 'zf_xiaoxiao', name: 'Xiaoxiao (小晓)', gender: 'Female', lang: 'zh', grade: 'D' },
    { id: 'zf_xiaoyi', name: 'Xiaoyi (小伊)', gender: 'Female', lang: 'zh', grade: 'D' },

    // 🇨🇳 Mandarin Chinese - Male
    { id: 'zm_yunjian', name: 'Yunjian (云剑)', gender: 'Male', lang: 'zh', grade: 'D' },
    { id: 'zm_yunxi', name: 'Yunxi (云希)', gender: 'Male', lang: 'zh', grade: 'D' },
    { id: 'zm_yunxia', name: 'Yunxia (云霞)', gender: 'Male', lang: 'zh', grade: 'D' },
    { id: 'zm_yunyang', name: 'Yunyang (云洋)', gender: 'Male', lang: 'zh', grade: 'D' },

    // 🇪🇸 Spanish
    { id: 'ef_dora', name: 'Dora', gender: 'Female', lang: 'es' },
    { id: 'em_alex', name: 'Alex', gender: 'Male', lang: 'es' },
    { id: 'em_santa', name: 'Santa', gender: 'Male', lang: 'es' },

    // 🇫🇷 French
    { id: 'ff_siwis', name: 'Siwis', gender: 'Female', lang: 'fr', grade: 'B-' },

    // 🇮🇳 Hindi
    { id: 'hf_alpha', name: 'Alpha', gender: 'Female', lang: 'hi', grade: 'C' },
    { id: 'hf_beta', name: 'Beta', gender: 'Female', lang: 'hi', grade: 'C' },
    { id: 'hm_omega', name: 'Omega', gender: 'Male', lang: 'hi', grade: 'C' },
    { id: 'hm_psi', name: 'Psi', gender: 'Male', lang: 'hi', grade: 'C' },

    // 🇮🇹 Italian
    { id: 'if_sara', name: 'Sara', gender: 'Female', lang: 'it', grade: 'C' },
    { id: 'im_nicola', name: 'Nicola', gender: 'Male', lang: 'it', grade: 'C' },

    // 🇧🇷 Brazilian Portuguese
    { id: 'pf_dora', name: 'Dora', gender: 'Female', lang: 'pt' },
    { id: 'pm_alex', name: 'Alex', gender: 'Male', lang: 'pt' },
    { id: 'pm_santa', name: 'Santa', gender: 'Male', lang: 'pt' }
];

export const VOICE_GROUPS = {
    'en-us-f': '🇺🇸 American English - Female',
    'en-us-m': '🇺🇸 American English - Male',
    'en-gb-f': '🇬🇧 British English - Female',
    'en-gb-m': '🇬🇧 British English - Male',
    'ja-f': '🇯🇵 Japanese - Female',
    'ja-m': '🇯🇵 Japanese - Male',
    'zh-f': '🇨🇳 Mandarin Chinese - Female',
    'zh-m': '🇨🇳 Mandarin Chinese - Male',
    'es': '🇪🇸 Spanish',
    'fr': '🇫🇷 French',
    'hi': '🇮🇳 Hindi',
    'it': '🇮🇹 Italian',
    'pt': '🇧🇷 Brazilian Portuguese'
};
