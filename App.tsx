
import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { GoogleGenAI } from "@google/genai";
import { GameState, Enemy, FloatingText } from './types';
import { ENEMY_COUNT, SPAWN_RADIUS, SPEED_MIN, SPEED_MAX, AIM_ASSIST_RADIUS, AIM_ASSIST_STRENGTH, DETECTION_FREQ_MS, TRIGGER_THRESHOLD } from './constants';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>({
    score: 0,
    combo: 0,
    isGameOver: false,
    handDetected: false,
    loading: true,
    loadingProgress: 0,
    statusMessage: "Initializing neural uplink...",
    lastHitTime: 0,
    hitFlash: null
  });

  const [bgImage, setBgImage] = useState<string>('');
  const [isGeneratingBg, setIsGeneratingBg] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const enemiesRef = useRef<Enemy[]>([]);
  const laserRef = useRef<THREE.Line | null>(null);
  const crosshairRef = useRef<THREE.Mesh | null>(null);
  const vfxRef = useRef<FloatingText[]>([]);
  
  const lastDetectionRef = useRef<number>(0);
  const isTriggeredRef = useRef<boolean>(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const aiRef = useRef<any>(null);

  // AI Background Generation
  const generateBackground = useCallback(async (context: string) => {
    if (isGeneratingBg) return;
    setIsGeneratingBg(true);
    
    try {
      if (!aiRef.current) {
        aiRef.current = new GoogleGenAI({ apiKey: process.env.API_KEY });
      }

      const prompt = `A cinematic, ultra-high-definition tactical cyber-neon background for a VR shooting range. 
      Theme: ${context}. 
      Visuals: Glowing grid lines, futuristic data streams, bokeh neon lights, dark atmospheric depth, 8k resolution, sci-fi concept art. 
      No people, no UI elements, just the environment.`;

      const response = await aiRef.current.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [{ parts: [{ text: prompt }] }],
        config: { imageConfig: { aspectRatio: "16:9" } }
      });

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const base64Data = part.inlineData.data;
          setBgImage(`data:image/png;base64,${base64Data}`);
          break;
        }
      }
    } catch (err) {
      console.error("AI Generation Error:", err);
    } finally {
      setIsGeneratingBg(false);
    }
  }, [isGeneratingBg]);

  const playSound = (frequency: number, type: OscillatorType = 'sine', duration = 0.2, volume = 0.3) => {
    if (!audioContextRef.current) return;
    const ctx = audioContextRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + duration);
  };

  const spawnEnemy = useCallback(() => {
    if (!sceneRef.current) return;
    
    const rand = Math.random();
    let config = {
      color: 0xff3333,
      scale: 1.0,
      speedMult: 1.0,
      points: 100,
      type: 'normal'
    };

    if (rand < 0.1) {
      config = { color: 0x33ffff, scale: 1.0, speedMult: 1.3, points: 500, type: 'phantom' };
    } else if (rand < 0.25) {
      config = { color: 0xffff33, scale: 0.6, speedMult: 1.8, points: 250, type: 'racer' };
    } else if (rand < 0.45) {
      config = { color: 0xbb33ff, scale: 1.8, speedMult: 0.6, points: 150, type: 'titan' };
    }

    const geometry = new THREE.TorusGeometry(0.5, 0.15, 12, 48);
    const material = new THREE.MeshPhongMaterial({ 
      color: config.color, 
      emissive: config.color, 
      emissiveIntensity: 0.8,
      shininess: 100,
      transparent: true,
      opacity: 1.0
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(config.scale);
    
    const angle = Math.random() * Math.PI * 2;
    const x = Math.cos(angle) * SPAWN_RADIUS;
    const y = (Math.random() - 0.5) * 10;
    const z = -Math.sin(angle) * SPAWN_RADIUS;
    
    mesh.position.set(x, y, z);
    sceneRef.current.add(mesh);
    
    const baseSpeed = SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);
    const speed = baseSpeed * config.speedMult;
    const velocity = new THREE.Vector3(0, 0, 0)
      .sub(mesh.position)
      .normalize()
      .multiplyScalar(speed);
      
    enemiesRef.current.push({
      id: Math.random().toString(36),
      mesh,
      velocity,
      spawnTime: Date.now(),
      isDying: false,
      points: config.points,
      type: config.type
    });
  }, []);

  const initThree = () => {
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 0; 
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ 
      canvas: canvasRef.current!, 
      alpha: true,
      antialias: true 
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0xffffff, 1.5);
    pointLight.position.set(5, 5, 5);
    scene.add(pointLight);

    const laserGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -30)
    ]);
    const laserMaterial = new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.6 });
    const laser = new THREE.Line(laserGeometry, laserMaterial);
    scene.add(laser);
    laserRef.current = laser;

    const crosshairGeo = new THREE.RingGeometry(0.12, 0.15, 32);
    const crosshairMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
    const crosshair = new THREE.Mesh(crosshairGeo, crosshairMat);
    scene.add(crosshair);
    crosshairRef.current = crosshair;

    for (let i = 0; i < ENEMY_COUNT; i++) spawnEnemy();
  };

  const triggerFlash = (type: 'hit' | 'miss') => {
    setGameState(prev => ({ ...prev, hitFlash: type }));
    setTimeout(() => setGameState(prev => ({ ...prev, hitFlash: null })), 150);
  };

  const handleShoot = (direction: THREE.Vector3, origin: THREE.Vector3) => {
    playSound(150, 'square', 0.1, 0.4);
    
    if (laserRef.current) {
      const mat = laserRef.current.material as THREE.LineBasicMaterial;
      mat.opacity = 1.0;
      mat.color.setHex(0xffffff);
      setTimeout(() => {
        mat.opacity = 0.6;
        mat.color.setHex(0xff0000);
      }, 50);
    }

    const raycaster = new THREE.Raycaster(origin, direction);
    const hitEnemyIndex = enemiesRef.current.findIndex(e => {
      const intersections = raycaster.intersectObject(e.mesh);
      return intersections.length > 0;
    });

    if (hitEnemyIndex !== -1) {
      const enemy = enemiesRef.current[hitEnemyIndex];
      enemy.isDying = true;
      triggerFlash('hit');
      
      const comboBonus = Math.floor(gameState.combo / 5) * 50;
      const totalPoints = enemy.points + comboBonus;
      
      setGameState(prev => ({ 
        ...prev, 
        score: prev.score + totalPoints,
        combo: prev.combo + 1,
        lastHitTime: Date.now()
      }));
      
      playSound(600 + (gameState.combo * 20), 'sine', 0.3, 0.4);
      generateBackground(`successful neutralization, kinetic energy explosion, neon green pulse, data burst`);

      const hitPos = enemy.mesh.position.clone();
      vfxRef.current.push({
        id: Math.random().toString(),
        text: `+${totalPoints}${gameState.combo > 5 ? ' 🔥' : ''}`,
        position: hitPos,
        color: "#4ade80",
        life: 1.0
      });

      enemy.mesh.scale.multiplyScalar(2.0);
      (enemy.mesh.material as THREE.MeshPhongMaterial).emissive.setHex(0xffffff);
      
      setTimeout(() => {
        if (sceneRef.current) sceneRef.current.remove(enemy.mesh);
        enemiesRef.current = enemiesRef.current.filter(e => e.id !== enemy.id);
        spawnEnemy();
      }, 100);
    } else {
      triggerFlash('miss');
      setGameState(prev => ({ ...prev, combo: 0 }));
      playSound(100, 'sawtooth', 0.2, 0.2);
      generateBackground(`missed target, red warning glitch, tactical error, distorted neon`);

      const targetPos = origin.clone().add(direction.clone().multiplyScalar(15));
      vfxRef.current.push({
        id: Math.random().toString(),
        text: "MISS",
        position: targetPos,
        color: "#f87171",
        life: 1.0
      });
    }
  };

  const onResults = (results: any) => {
    const now = Date.now();
    if (now - lastDetectionRef.current < DETECTION_FREQ_MS) return;
    lastDetectionRef.current = now;

    try {
      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        setGameState(prev => prev.handDetected ? prev : { ...prev, handDetected: true });
        
        const landmarks = results.multiHandLandmarks[0];
        const indexTip = landmarks[8];
        const indexBase = landmarks[5];
        const thumbTip = landmarks[4];
        
        const gunOrigin = new THREE.Vector3(
          (indexBase.x - 0.5) * 12,
          -(indexBase.y - 0.5) * 12,
          -2
        );
        
        let aimDirection = new THREE.Vector3(
          (indexTip.x - indexBase.x),
          -(indexTip.y - indexBase.y),
          -0.5
        ).normalize();

        if (laserRef.current && crosshairRef.current) {
          laserRef.current.position.copy(gunOrigin);
          
          let finalAimDir = aimDirection.clone();
          let targetFound = false;
          
          enemiesRef.current.forEach(enemy => {
            if (enemy.isDying) return;
            const toEnemy = enemy.mesh.position.clone().sub(gunOrigin).normalize();
            const angle = finalAimDir.angleTo(toEnemy);
            
            if (angle < AIM_ASSIST_RADIUS * (Math.PI / 180) * 6) {
              finalAimDir.lerp(toEnemy, AIM_ASSIST_STRENGTH);
              targetFound = true;
            }
          });
          
          const mat = crosshairRef.current.material as THREE.MeshBasicMaterial;
          mat.color.setHex(targetFound ? 0xffff00 : 0x00ff00);
          crosshairRef.current.scale.setScalar(targetFound ? 1.6 + Math.sin(now * 0.01) * 0.2 : 1.0);

          const lookTarget = gunOrigin.clone().add(finalAimDir);
          laserRef.current.lookAt(lookTarget);
          
          const crosshairPos = gunOrigin.clone().add(finalAimDir.multiplyScalar(20));
          crosshairRef.current.position.copy(crosshairPos);
          crosshairRef.current.lookAt(cameraRef.current!.position);

          const dist = Math.sqrt(Math.pow(thumbTip.x - indexBase.x, 2) + Math.pow(thumbTip.y - indexBase.y, 2));
          
          if (dist < TRIGGER_THRESHOLD) {
            if (!isTriggeredRef.current) {
              isTriggeredRef.current = true;
              handleShoot(finalAimDir.normalize(), gunOrigin);
            }
          } else {
            isTriggeredRef.current = false;
          }
        }
      } else {
        setGameState(prev => !prev.handDetected ? prev : { ...prev, handDetected: false });
      }
    } catch (error) {
      console.error("Gesture processing error:", error);
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;

    initThree();

    const hands = new window.Hands({
      locateFile: (file: string) => `https://unpkg.com/@mediapipe/hands@0.4.1646424915/${file}`
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7
    });

    hands.onResults(onResults);

    const camera = new window.Camera(videoRef.current, {
      onFrame: async () => {
        await hands.send({ image: videoRef.current! });
      },
      width: 1280,
      height: 720
    });

    camera.start().then(() => {
      setGameState(prev => ({ ...prev, loading: false, statusMessage: "Uplink Established" }));
      generateBackground("initial tactical training environment, neon blue grid, futuristic hangar");
    });

    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        enemiesRef.current.forEach(enemy => {
          if (!enemy.isDying) {
            enemy.mesh.position.add(enemy.velocity);
            enemy.mesh.rotation.x += 0.02;
            enemy.mesh.rotation.y += 0.03;
            
            if (enemy.type === 'phantom') {
              const pulse = 1.0 + Math.sin(Date.now() * 0.005) * 0.2;
              enemy.mesh.scale.setScalar(pulse);
            }
          }

          if (enemy.mesh.position.length() > 30) {
            sceneRef.current?.remove(enemy.mesh);
            enemiesRef.current = enemiesRef.current.filter(e => e.id !== enemy.id);
            spawnEnemy();
          }
        });

        vfxRef.current = vfxRef.current.filter(v => {
          v.life -= 0.025;
          v.position.y += 0.04;
          return v.life > 0;
        });

        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      hands.close();
      if (rendererRef.current) rendererRef.current.dispose();
    };
  }, []);

  const handleStartAudio = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  };

  return (
    <div ref={containerRef} className="relative w-full h-full bg-black overflow-hidden select-none font-mono">
      {/* Screen Flash Effects */}
      <div className={`absolute inset-0 z-[40] pointer-events-none transition-opacity duration-150 ${gameState.hitFlash === 'hit' ? 'bg-green-500/20 opacity-100' : 'opacity-0'}`} />
      <div className={`absolute inset-0 z-[40] pointer-events-none transition-opacity duration-150 ${gameState.hitFlash === 'miss' ? 'bg-red-500/20 opacity-100' : 'opacity-0'}`} />

      {/* Background Layer: AI Image */}
      <div 
        className="absolute inset-0 bg-cover bg-center transition-all duration-1000 ease-in-out"
        style={{ 
          backgroundImage: bgImage ? `url(${bgImage})` : 'none',
          filter: 'brightness(0.5) contrast(1.2)'
        }}
      />

      {/* AI Generating Indicator */}
      {isGeneratingBg && (
        <div className="absolute bottom-10 right-10 z-[35] flex items-center gap-3">
          <div className="w-2 h-2 bg-cyan-400 rounded-full animate-ping" />
          <span className="text-cyan-400 text-[10px] uppercase tracking-[0.3em]">AI Painting Environment...</span>
        </div>
      )}

      {/* Hidden Camera Layer for MediaPipe */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover opacity-0 pointer-events-none"
        playsInline
        muted
      />

      <canvas ref={canvasRef} className="absolute inset-0 z-10 pointer-events-none" />

      {/* Main HUD */}
      <div className="absolute inset-0 z-20 pointer-events-none flex flex-col justify-between p-8">
        <div className="flex justify-between items-start pointer-events-auto">
          <div className="flex flex-col gap-2">
            <div className={`bg-black/80 backdrop-blur-xl border-l-4 border-red-500 p-4 shadow-[0_0_30px_rgba(239,68,68,0.3)] transition-transform duration-100 ${gameState.hitFlash === 'hit' ? 'scale-110' : 'scale-100'}`}>
              <h1 className="text-red-500 font-black text-xs tracking-widest uppercase italic opacity-70">Neural Range // v2.0-AI</h1>
              <div className="flex items-baseline gap-3">
                <span className="text-white text-3xl font-black">{gameState.score.toLocaleString()}</span>
                <span className="text-red-500 text-xs font-bold">PTS</span>
              </div>
            </div>
            
            {gameState.combo > 1 && (
              <div className="bg-white text-black font-black px-3 py-1 text-sm self-start animate-bounce uppercase tracking-tighter">
                Combo x{gameState.combo} {gameState.combo > 10 ? '🔥' : ''}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className={`transition-all duration-300 ${gameState.handDetected ? 'bg-green-500 shadow-[0_0_20px_#22c55e]' : 'bg-red-500 shadow-[0_0_10px_#ef4444]'} w-3 h-3 rounded-full`} />
            <span className="text-[10px] text-white/50 uppercase tracking-widest">Neural Sync</span>
          </div>
        </div>

        {/* Floating Text Container */}
        <div className="absolute inset-0 overflow-hidden">
          {vfxRef.current.map(v => (
             <div 
              key={v.id}
              className="absolute font-black pointer-events-none transition-all duration-300"
              style={{
                left: `${(v.position.x / 12 + 0.5) * 100}%`,
                top: `${(-v.position.y / 12 + 0.5) * 100}%`,
                color: v.color,
                opacity: v.life,
                transform: `translate(-50%, -50%) scale(${0.8 + v.life * 1.2}) translateY(${(1-v.life) * -100}px)`,
                textShadow: '0 0 10px rgba(0,0,0,0.5)'
              }}
            >
              <span className="text-2xl md:text-4xl">{v.text}</span>
            </div>
          ))}
        </div>

        {/* Tactical Overlay */}
        {!gameState.handDetected && !gameState.loading && (
          <div className="bg-black/90 backdrop-blur-md p-6 rounded-sm text-center mx-auto mb-12 border border-red-500/30 max-w-sm">
            <p className="text-red-500 font-black text-lg animate-pulse tracking-tighter uppercase italic">Link Lost // Calibrate Hand</p>
            <p className="text-white/40 text-[10px] mt-2 leading-tight uppercase tracking-widest">
              Position hand in view.<br/>Standard Pistol Gesture required.
            </p>
          </div>
        )}
      </div>

      {/* Loading Overlay */}
      {gameState.loading && (
        <div className="absolute inset-0 z-50 bg-black flex flex-col items-center justify-center">
          <div className="relative">
            <div className="w-24 h-24 border-2 border-red-500/20 rounded-full" />
            <div className="absolute inset-0 w-24 h-24 border-t-2 border-red-500 rounded-full animate-spin" />
          </div>
          <h2 className="text-white font-black tracking-[0.4em] uppercase mt-8 text-sm italic">{gameState.statusMessage}</h2>
          <div className="w-48 h-1 bg-white/10 mt-4 overflow-hidden">
            <div className="h-full bg-red-500 animate-[loading_2s_ease-in-out_infinite]" />
          </div>
        </div>
      )}

      {/* Interaction Interceptor */}
      {!audioContextRef.current && !gameState.loading && (
        <div className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-3xl flex flex-col items-center justify-center gap-8 p-12 text-center">
          <div className="space-y-2">
            <h1 className="text-white font-black text-6xl tracking-tighter uppercase italic">Neon<span className="text-red-500">Grip</span></h1>
            <p className="text-white/40 text-xs tracking-[0.5em] uppercase">AI Generated Combat Simulation</p>
          </div>
          <button 
            onClick={handleStartAudio}
            className="group relative px-16 py-6 overflow-hidden"
          >
            <div className="absolute inset-0 bg-red-600 group-hover:bg-red-500 transition-colors" />
            <div className="absolute inset-0 border-4 border-white opacity-0 group-hover:opacity-20 transition-opacity" />
            <span className="relative text-white font-black text-2xl tracking-widest uppercase italic">Initialize Neural Link</span>
          </button>
          <div className="text-[10px] text-white/30 uppercase tracking-[0.2em] max-w-xs space-y-1">
            <p>1. Camera Tracking Enabled (Invisible)</p>
            <p>2. AI Generates Environments on Interaction</p>
            <p>3. Hit Targets to Evolve the Simulation</p>
          </div>
        </div>
      )}

      <style>{`
        @keyframes loading {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};

export default App;
