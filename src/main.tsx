import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// --- MOUNTING LOGIC (INDUSTRIAL GRADE) ---
const init = () => {
    const container = document.getElementById('root');
    if (container) {
        const root = createRoot(container);
        root.render(<App />);
    } else {
        console.error("Critical Error: #root element not found in DOM.");
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}