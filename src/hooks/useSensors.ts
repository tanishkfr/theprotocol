import { useState, useEffect } from 'react';

export interface SensorData {
  orientation: 'landscape' | 'portrait' | 'unknown';
  batteryLevel: number | null;
  isCharging: boolean | null;
  isFlat: boolean | null;
}

export function useSensors(): SensorData {
  const [sensors, setSensors] = useState<SensorData>({
    orientation: 'unknown',
    batteryLevel: null,
    isCharging: null,
    isFlat: null,
  });

  useEffect(() => {
    // Orientation
    const updateOrientation = () => {
      const type = window.screen?.orientation?.type || 'unknown';
      setSensors(s => ({ ...s, orientation: type.includes('landscape') ? 'landscape' : 'portrait' }));
    };
    updateOrientation();
    window.addEventListener('orientationchange', updateOrientation);
    window.screen?.orientation?.addEventListener('change', updateOrientation);

    // Battery
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

    // Flatness (Device Orientation)
    const handleDeviceOrientation = (event: DeviceOrientationEvent) => {
      const { beta, gamma } = event;
      if (beta !== null && gamma !== null) {
        // beta is front-to-back tilt in degrees, where front is positive
        // gamma is left-to-right tilt in degrees, where right is positive
        const isFlat = Math.abs(beta) < 5 && Math.abs(gamma) < 5;
        setSensors(s => ({ ...s, isFlat }));
      }
    };
    
    // Request permission for iOS 13+ devices
    const requestDeviceOrientation = async () => {
      if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
        try {
          const permissionState = await (DeviceOrientationEvent as any).requestPermission();
          if (permissionState === 'granted') {
            window.addEventListener('deviceorientation', handleDeviceOrientation);
          }
        } catch (error) {
          console.error('Error requesting device orientation permission:', error);
        }
      } else {
        window.addEventListener('deviceorientation', handleDeviceOrientation);
      }
    };

    // We can't auto-request permission on iOS, it needs a user gesture.
    // We'll just add the listener for non-iOS devices for now.
    window.addEventListener('deviceorientation', handleDeviceOrientation);

    return () => {
      window.removeEventListener('orientationchange', updateOrientation);
      window.screen?.orientation?.removeEventListener('change', updateOrientation);
      window.removeEventListener('deviceorientation', handleDeviceOrientation);
    };
  }, []);

  return sensors;
}
