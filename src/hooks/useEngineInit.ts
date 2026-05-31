import { useState, useEffect } from 'react';
import { TIME_CONSTANTS } from '../constants';

export type InitStatus = 'loading' | 'ready' | 'error';

export interface InitLogItem {
    name: string;
    status: InitStatus;
}

export const useEngineInit = () => {
    const [initLog, setInitLog] = useState<InitLogItem[]>([
        { name: 'Core Analysis Engine', status: 'loading' },
        { name: 'Environment Calibration Engine', status: 'loading' },
        { name: 'Motion Tracking System', status: 'loading' },
    ]);
    const [isInitComplete, setIsInitComplete] = useState(false);
    const [initFailed, setInitFailed] = useState(false);

    useEffect(() => {
        let checkCount = 0;
        
        const initInterval = setInterval(() => {
            checkCount++;
            
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const poseReady = !!(window as any).Pose;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cvReady = (window as any).cv && (window as any).cv.Mat;

            setInitLog([
                { name: 'Core Analysis Engine', status: poseReady ? 'ready' : (checkCount >= TIME_CONSTANTS.INIT_MAX_CHECKS ? 'error' : 'loading') },
                { name: 'Environment Calibration Engine', status: cvReady ? 'ready' : (checkCount >= TIME_CONSTANTS.INIT_MAX_CHECKS ? 'error' : 'loading') },
                { name: 'Motion Tracking System', status: cvReady ? 'ready' : (checkCount >= TIME_CONSTANTS.INIT_MAX_CHECKS ? 'error' : 'loading') },
            ]);

            if (poseReady && cvReady) {
                clearInterval(initInterval);
                setTimeout(() => setIsInitComplete(true), 800); 
            } else if (checkCount >= TIME_CONSTANTS.INIT_MAX_CHECKS) {
                clearInterval(initInterval);
                setInitFailed(true);
            }
        }, TIME_CONSTANTS.INIT_CHECK_INTERVAL_MS);

        return () => clearInterval(initInterval);
    }, []);

    return {
        initLog,
        isInitComplete,
        initFailed
    };
};
