export class CameraManager {
    constructor(videoElement) {
        this.video = videoElement;
        this.stream = null;
        this.currentFacingMode = 'environment';
        this.videoDevices = [];
    }

    async init() {
        try {
            await this.checkDevices();
            await this.startCamera();
            return true;
        } catch (error) {
            console.error('Error initializing camera:', error);
            throw new Error(`Camera access denied: ${error.name}`);
        }
    }

    async checkDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.videoDevices = devices.filter(device => device.kind === 'videoinput');
            console.log(`Found ${this.videoDevices.length} video devices`);
        } catch (error) {
            console.error('Error enumerating devices:', error);
            this.videoDevices = [];
        }
    }

    hasMultipleCameras() {
        return this.videoDevices.length > 1;
    }

    async startCamera() {
        try {
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
            }

            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: this.currentFacingMode,
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });

            this.video.srcObject = this.stream;

            await new Promise((resolve) => {
                this.video.onloadedmetadata = () => {
                    resolve();
                };
            });

            console.log('Camera started successfully');
            return this.stream;
        } catch (error) {
            console.error('Error starting camera:', error);
            throw error;
        }
    }

    async toggleCamera() {
        if (!this.hasMultipleCameras()) {
            console.warn('Only one camera available');
            return;
        }

        this.currentFacingMode = this.currentFacingMode === 'environment' ? 'user' : 'environment';
        await this.startCamera();
    }

    stop() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
    }
}
