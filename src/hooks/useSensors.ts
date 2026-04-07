import { useState, useEffect, useRef } from 'react';

export interface SensorData {
  orientation: 'landscape' | 'portrait' | 'unknown';
  batteryLevel: number | null;
  isCharging: boolean | null;
  isFlat: boolean | null;
  isMoving: boolean;
  isOnline: boolean;
  offlineCount: number;
  lastHiddenDuration: number;
  recentTaps: number;
  distanceMoved: number | null;
  illuminance: number | null;
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3; // metres
  const phi1 = lat1 * Math.PI/180;
  const phi2 = lat2 * Math.PI/180;
  const deltaPhi = (lat2-lat1) * Math.PI/180;
  const deltaLambda = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

export function useSensors(isActive: boolean): SensorData {
  const [sensors, setSensors] = useState<SensorData>({
    orientation: 'unknown',
    batteryLevel: null,
    isCharging: null,
    isFlat: null,
    isMoving: false,
    isOnline: navigator.onLine,
    offlineCount: 0,
    lastHiddenDuration: 0,
    recentTaps: 0,
    distanceMoved: null,
    illuminance: null,
  });

  const tapTimes = useRef<number[]>([]);

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

    // 3. Device Orientation (Flatness)
    const handleDeviceOrientation = (event: DeviceOrientationEvent) => {
      const { beta, gamma } = event;
      if (beta !== null && gamma !== null) {
        const isFlat = Math.abs(beta) < 5 && Math.abs(gamma) < 5;
        setSensors(s => ({ ...s, isFlat }));
      }
    };
    window.addEventListener('deviceorientation', handleDeviceOrientation);

    // 4. Device Motion (Shaking)
    let moveTimeout: any;
    const handleMotion = (event: DeviceMotionEvent) => {
      const acc = event.acceleration;
      if (acc && (Math.abs(acc.x || 0) > 15 || Math.abs(acc.y || 0) > 15 || Math.abs(acc.z || 0) > 15)) {
        setSensors(s => ({ ...s, isMoving: true }));
        clearTimeout(moveTimeout);
        moveTimeout = setTimeout(() => setSensors(s => ({ ...s, isMoving: false })), 1000);
      }
    };
    window.addEventListener('devicemotion', handleMotion);

    // 5. Online Status
    const handleOffline = () => setSensors(s => ({ ...s, isOnline: false, offlineCount: s.offlineCount + 1 }));
    const handleOnline = () => setSensors(s => ({ ...s, isOnline: true }));
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    // 6. Visibility (Ghost)
    let hiddenStartTime = 0;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenStartTime = Date.now();
      } else {
        if (hiddenStartTime > 0) {
          const duration = (Date.now() - hiddenStartTime) / 1000;
          setSensors(s => ({ ...s, lastHiddenDuration: duration }));
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 7. Taps (Sequence)
    const handleTap = () => {
      const now = Date.now();
      tapTimes.current.push(now);
      tapTimes.current = tapTimes.current.filter(t => now - t <= 2000);
      setSensors(s => ({ ...s, recentTaps: tapTimes.current.length }));
    };
    window.addEventListener('touchstart', handleTap);
    window.addEventListener('click', handleTap);

    // 8. Geolocation (Anchor)
    let initialCoords: GeolocationCoordinates | null = null;
    let watchId: number | null = null;
    if ('geolocation' in navigator) {
      watchId = navigator.geolocation.watchPosition((pos) => {
        if (!initialCoords) {
          initialCoords = pos.coords;
          setSensors(s => ({ ...s, distanceMoved: 0 }));
        } else {
          const dist = calculateDistance(initialCoords.latitude, initialCoords.longitude, pos.coords.latitude, pos.coords.longitude);
          setSensors(s => ({ ...s, distanceMoved: dist }));
        }
      }, console.error, { enableHighAccuracy: true });
    }

    // 9. Light Sensor (Proximity fallback)
    if ('AmbientLightSensor' in window) {
      try {
        const sensor = new (window as any).AmbientLightSensor();
        sensor.addEventListener('reading', () => {
          setSensors(s => ({ ...s, illuminance: sensor.illuminance }));
        });
        sensor.start();
      } catch (e) { console.error("Light sensor not available", e); }
    }

    return () => {
      window.removeEventListener('orientationchange', updateOrientation);
      window.screen?.orientation?.removeEventListener('change', updateOrientation);
      window.removeEventListener('deviceorientation', handleDeviceOrientation);
      window.removeEventListener('devicemotion', handleMotion);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('touchstart', handleTap);
      window.removeEventListener('click', handleTap);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      clearTimeout(moveTimeout);
    };
  }, [isActive]);

  return sensors;
}
