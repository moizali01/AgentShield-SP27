// tracker.js
(function() {
    const ENDPOINT = '/tracker_endpoint'; // Update to your actual collection endpoint
    const BATCH_INTERVAL = 2000;
    let mutationQueue = [];

    // Generate a session ID for the current visit
    let sessionId = sessionStorage.getItem('panda_form_session');
    if (!sessionId) {
        sessionId = 'sess_' + Math.random().toString(36).substr(2, 9);
        sessionStorage.setItem('panda_form_session', sessionId);
    }

    // --- PART 1: DOM Mutation Observer ---
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            // Watch for class changes (specifically the 'visible' class in your form)
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                const target = mutation.target;
                
                if (target.classList && target.classList.contains('reveal-field')) {
                    const isNowVisible = target.classList.contains('visible');
                    const wasVisible = mutation.oldValue && mutation.oldValue.includes('visible');

                    // Only log when a field transitions from hidden to visible
                    if (isNowVisible && !wasVisible) {
                        mutationQueue.push({
                            type: 'field_revealed',
                            field_id: target.id,
                            timestamp: Date.now()
                        });
                    }
                }
            }
        });
    });

    // Wait for the DOM to load before observing
    document.addEventListener('DOMContentLoaded', () => {
        // Watch for the container of the dynamic fields
        const formContainer = document.getElementById('dynamic-form') || document.getElementById('pledge-form') || document.body;
        if (formContainer) {
            observer.observe(formContainer, {
                attributes: true,
                attributeOldValue: true,
                subtree: true,
                attributeFilter: ['class'] // Optimization: only watch class changes
            });
        }
    });

    // --- PART 2: Safe Interaction Tracking ---
    // Logs that an input was completed, without logging the actual keystrokes
    document.addEventListener('change', function(e) {
        const target = e.target;
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) {
            mutationQueue.push({
                type: 'field_completed',
                field_name: target.name || target.id,
                input_type: target.type,
                timestamp: Date.now()
            });
        }
    }, true);

    // --- PART 3: Batch Sender ---
    setInterval(() => {
        if (mutationQueue.length === 0) return;
        
        const batch = mutationQueue.splice(0, 50);
        
        // Console log for local testing purposes
        console.log("Tracker Batch Prepared:", batch);

        // Send the batch to the backend
        fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                session_id: sessionId, 
                url: window.location.pathname,
                events: batch 
            }),
            keepalive: true
        }).catch((err) => console.error("Tracker fetch error:", err));
    }, BATCH_INTERVAL);

    // --- PART 4: Mouse & Click Tracking ---
    let lastMouseMoveTime = 0;
    const MOUSE_THROTTLE = 40; 

    // Track continuous movement
    document.addEventListener('mousemove', (e) => {
        const now = Date.now();
        if (now - lastMouseMoveTime > MOUSE_THROTTLE) {
            mutationQueue.push({
                type: 'mouse_move',
                x: Math.round(e.pageX),
                y: Math.round(e.pageY),
                timestamp: now
            });
            lastMouseMoveTime = now;
        }
    });

    // Track physical clicks
    document.addEventListener('mousedown', (e) => {
        let btn = 'left';
        if (e.button === 1) btn = 'middle';
        if (e.button === 2) btn = 'right';

        mutationQueue.push({
            type: 'mouse_click',
            button: btn,
            x: Math.round(e.pageX),
            y: Math.round(e.pageY),
            target_element: e.target.tagName,
            target_id: e.target.id || '',
            is_trusted: e.isTrusted,
            timestamp: Date.now()
        });
    });

    // --- PART 5: Real-Time Input Tracking ---
    document.addEventListener('input', function(e) {
        const target = e.target;
        
        // Only target text fields
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') return;
        
        // Security fallback: never log password fields
        if (target.type === 'password') return; 

        mutationQueue.push({
            type: 'input_capture',
            field_name: target.name || target.id || 'unnamed_field',
            value: target.value,
            is_trusted: e.isTrusted,
            timestamp: Date.now()
        });
    }, true);

    // --- PART 6: Keypress Dwell Time Tracking ---
    // Temporary storage for keys currently being held down
    const activeKeys = {};

    document.addEventListener('keydown', (e) => {
        // Ignore auto-repeating events if the user holds a key down continuously
        if (e.repeat) return;
        
        // Store the start time using the physical key code (e.g., 'KeyA', 'Enter')
        activeKeys[e.code] = Date.now();
    }, true);

    document.addEventListener('keyup', (e) => {
        const startTime = activeKeys[e.code];
        
        if (startTime) {
            const duration = Date.now() - startTime;
            
            // Remove the key from active tracking once released
            delete activeKeys[e.code]; 
            
            // Push the duration to the queue
            mutationQueue.push({
                type: 'keypress_dwell_time',
                key: e.code, 
                duration_ms: duration,
                is_trusted: e.isTrusted,
                timestamp: Date.now()
            });
        }
    }, true);


})();