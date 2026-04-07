import { useState, useEffect, useRef } from 'react';

export interface SensorData {
  orientation: 'landscape' | 'portrait' | 'unknown';
  batteryLevel: number | null;
  isCharging: boolean | null;
  isFlat: boolean | null;
  isDark: boolean | null;
  isHumming: boolean | null;
  isSilent: boolean | null;
  isMoving: boolean | null;
  lastTapTime: number;
  cameraFrameBase64: string | null;
}

export function useSensors(isActive: boolean): SensorData {
  const [sensors, setSensors] = useState<SensorData>({
    orientation: 'unknown',
    batteryLevel: null,
    isCharging: null,
    isFlat: null,
    isDark: null,
    isHumming: null,
    isSilent: null,
    isMoving: null,
    lastTapTime: 0,
    cameraFrameBase64: null,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number>(0);

  useEffect(() => {
    if (!isActive) return;

    // 1. Orientation
    const updateOrientation = () => {
      const type = window.screen?.orientation?.type || 'unknown';
      setSensors(s => ({ ...s, orientation: type.includes('landscape') ? 'landscape' : 'portrait' }));
    };
    updateOrientation();
    window.addEventListener('orientationchange', updateOrientation);
    window.screen?.orientation?.addEventListener('change', updateOrientation);

    // 2. Battery
    if ('getBattery' in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        const updateBattery = () => {
          setSensors(s => ({
            ...s,
            batteryLevel: Math.round(battery.level * 100),
            isCharging: battery.charging
          }));
        };
        updateBattery();
        battery.addEventListener('levelchange', updateBattery);
        battery.addEventListener('chargingchange', updateBattery);
      });
    }

    // 3. Device Orientation (Flatness) & Motion (Stillness)
    const handleDeviceOrientation = (event: DeviceOrientationEvent) => {
      const { beta, gamma } = event;
      if (beta !== null && gamma !== null) {
        const isFlat = Math.abs(beta) < 5 && Math.abs(gamma) < 5;
        setSensors(s => ({ ...s, isFlat }));
      }
    };

    const handleDeviceMotion = (event: DeviceMotionEvent) => {
      const acc = event.acceleration;
      if (acc && acc.x !== null && acc.y !== null && acc.z !== null) {
        const totalMotion = Math.abs(acc.x) + Math.abs(acc.y) + Math.abs(acc.z);
        setSensors(s => ({ ...s, isMoving: totalMotion > 1.5 }));
      }
    };

    window.addEventListener('deviceorientation', handleDeviceOrientation);
    window.addEventListener('devicemotion', handleDeviceMotion);

    // 4. Rhythm (Taps)
    const handleTap = () => {
      setSensors(s => ({ ...s, lastTapTime: Date.now() }));
    };
    window.addEventListener('touchstart', handleTap);
    window.addEventListener('click', handleTap);

    // 5. A/V Setup (Camera & Mic)
    const setupAV = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
        
        const video = document.createElement('video');
        video.srcObject = stream;
        video.play();
        videoRef.current = video;

        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        canvasRef.current = canvas;

        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioCtxRef.current = audioCtx;
        analyserRef.current = analyser;

        const pollAV = () => {
          if (videoRef.current && canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
              ctx.drawImage(videoRef.current, 0, 0, 64, 64);
              const frameData = canvasRef.current.toDataURL('image/jpeg', 0.5);
              
              const imgData = ctx.getImageData(0, 0, 64, 64).data;
              let sum = 0;
              for (let i = 0; i < imgData.length; i += 4) {
                sum += (imgData[i] + imgData[i+1] + imgData[i+2]) / 3;
              }
              const avgBrightness = sum / (imgData.length / 4);
              
              setSensors(s => ({ 
                ...s, 
                isDark: avgBrightness < 15,
                cameraFrameBase64: frameData
              }));
            }
          }

          if (analyserRef.current) {
            const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
            analyserRef.current.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avgVolume = sum / dataArray.length;

            setSensors(s => ({
              ...s,
              isHumming: avgVolume > 30,
              isSilent: avgVolume < 10
            }));
          }

          animationFrameRef.current = requestAnimationFrame(pollAV);
        };
        pollAV();

      } catch (err) {
        console.error("A/V Permission denied", err);
      }
    };
    setupAV();

    return () => {
      window.removeEventListener('orientationchange', updateOrientation);
      window.screen?.orientation?.removeEventListener('change', updateOrientation);
      window.removeEventListener('deviceorientation', handleDeviceOrientation);
      window.removeEventListener('devicemotion', handleDeviceMotion);
      window.removeEventListener('touchstart', handleTap);
      window.removeEventListener('click', handleTap);
      cancelAnimationFrame(animationFrameRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close();
      if (videoRef.current && videoRef.current.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, [isActive]);

  return sensors;
}
