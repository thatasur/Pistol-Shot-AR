
// Import THREE to resolve namespace errors in interface definitions
import * as THREE from 'three';

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface HandLandmark extends Point {}

export interface GameState {
  score: number;
  combo: number;
  isGameOver: boolean;
  handDetected: boolean;
  loading: boolean;
  loadingProgress: number;
  statusMessage: string;
  lastHitTime: number;
  hitFlash: 'hit' | 'miss' | null;
}

export interface Enemy {
  id: string;
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spawnTime: number;
  isDying: boolean;
  points: number;
  type: string;
}

export interface FloatingText {
  id: string;
  text: string;
  position: THREE.Vector3;
  color: string;
  life: number; // 0 to 1
}

// MediaPipe global declarations
declare global {
  interface Window {
    Hands: any;
    Camera: any;
  }
}
