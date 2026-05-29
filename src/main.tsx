import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from './App';
import { wipeEngineGlobals } from './components/VideoAnalyzer';

// --- MOUNTING LOGIC (INDUSTRIAL GRADE) ---
let globalRoot: Root | null = null;
let currentContainer: HTMLElement | null = null;

const injectScripts = () => {
    // Re-inject MediaPipe dependencies
    const mpScripts = [
        "https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js",
        "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js",
        "https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js"
    ];
    mpScripts.forEach(src => {
        const s = document.createElement('script');
        s.src = src;
        s.crossOrigin = "anonymous";
        document.head.appendChild(s);
    });

    // Re-inject OpenCV
    // Patch Object.defineProperty to prevent Emscripten throwing getter
    if (!(window as any)._definePropertyPatched) {
        const _origDefineProperty = Object.defineProperty;
        Object.defineProperty = function(obj, prop, descriptor) {
            if (prop === 'arguments' && descriptor && descriptor.get && descriptor.get.toString().includes('arguments_')) {
                return obj;
            }
            return _origDefineProperty(obj, prop, descriptor);
        };
        (window as any)._definePropertyPatched = true;
    }

    const cvScript = document.createElement('script');
    cvScript.async = true;
    cvScript.src = "https://docs.opencv.org/4.10.0/opencv.js";
    cvScript.onload = () => { try { (window as any).cvDidLoad = true; } catch(e){} };
    document.head.appendChild(cvScript);
};

export const forceAppRemount = () => {
    if (globalRoot && currentContainer) {
        console.log("Performaing industrial-grade hot unmount/remount of React Engine.");
        
        // 1. Unmount the entire Application immediately to halt all async React lifecycles
        globalRoot.unmount();
        
        // 2. Wipe dirty engine statics (Memory Leak / Crash state prevention)
        wipeEngineGlobals();
        
        // 3. Fallback Navigation Attempts
        try {
            const currentUrl = new URL(window.location.href);
            currentUrl.searchParams.set('t', Date.now().toString());
            window.location.href = currentUrl.toString();
        } catch(e) {}
        try {
            window.location.reload();
        } catch(e) {}
        
        // 4. Safely reconstruct the App if navigation blocked
        setTimeout(() => {
            if (currentContainer && !document.hidden) {
                console.log("Browser reload bypassed by Sandbox. Restoring Core...");
                injectScripts();
                globalRoot = createRoot(currentContainer);
                globalRoot.render(<App />);
            }
        }, 300);
    } else {
        window.location.reload();
    }
};

const init = () => {
    const container = document.getElementById('root');
    currentContainer = container;
    if (container) {
        globalRoot = createRoot(container);
        globalRoot.render(<App />);
    } else {
        console.error("Critical Error: #root element not found in DOM.");
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}